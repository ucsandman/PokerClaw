import { describe, it, expect, vi } from 'vitest';
import { AgentRunner, type AgentClientLike } from '../agent/runner';
import { isStaleActionError } from '../agent/errors';
import type { PlayerAction } from '../shared/types';
import type { PlayerView } from '../shared/view-models';
import type { Strategy } from '../agent/types';

// --- Test fixtures --------------------------------------------------------

function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    handId: 1,
    street: 'preflop',
    board: [],
    pot: 150,
    smallBlind: 50,
    bigBlind: 100,
    button: 'wes',
    currentBet: 100,
    minRaiseTo: 200,
    currentActor: 'moltfire',
    you: {
      id: 'moltfire',
      stack: 9900,
      committedThisStreet: 100,
      committedThisHand: 100,
      folded: false,
      allIn: false,
      cards: [],
    },
    opponent: {
      id: 'wes',
      stack: 9950,
      committedThisStreet: 50,
      committedThisHand: 50,
      folded: false,
      allIn: false,
      cards: [],
    },
    actionHistory: [],
    legalActions: {
      fold: true,
      check: true,
      call: false,
      callTo: 100,
      canBet: false,
      canRaise: true,
      minBetTo: 0,
      maxBetTo: 0,
      minRaiseTo: 200,
      maxRaiseTo: 9900,
    },
    handComplete: false,
    tournament: {
      level: 1,
      smallBlind: 50,
      bigBlind: 100,
      nextLevel: 2,
      nextSmallBlind: 75,
      nextBigBlind: 150,
      handsUntilNextLevel: 10,
    },
    ...overrides,
  };
}

// Strategy that always picks the same action and tracks invocations.
function makeFixedStrategy(action: PlayerAction): Strategy & { calls: number } {
  return {
    name: 'fixed',
    calls: 0,
    async decide() {
      this.calls++;
      return { action, rationale: 'test' };
    },
  } as Strategy & { calls: number };
}

// Strategy that suspends on `gate` until the test resolves it.
function makeGatedStrategy(action: PlayerAction): {
  strategy: Strategy;
  release: () => void;
  calls: () => number;
} {
  let resolveGate: (() => void) | null = null;
  let calls = 0;
  const strategy: Strategy = {
    name: 'gated',
    async decide() {
      calls++;
      await new Promise<void>((r) => {
        resolveGate = r;
      });
      return { action, rationale: 'gated' };
    },
  };
  return {
    strategy,
    release: () => resolveGate?.(),
    calls: () => calls,
  };
}

// Mock client that returns canned state and records posts.
function makeClient(opts: {
  state: PlayerView | (() => PlayerView);
  postBehavior?: (action: PlayerAction) => Promise<PlayerView>;
}): AgentClientLike & {
  posts: PlayerAction[];
} {
  const posts: PlayerAction[] = [];
  return {
    posts,
    async getState() {
      return typeof opts.state === 'function' ? opts.state() : opts.state;
    },
    async postAction(action) {
      posts.push(action);
      if (opts.postBehavior) return opts.postBehavior(action);
      return typeof opts.state === 'function' ? opts.state() : opts.state;
    },
  };
}

function makeLogSpies() {
  return {
    decision: vi.fn(),
    error: vi.fn(),
  };
}

// --- Stale-error helper ---------------------------------------------------

describe('isStaleActionError', () => {
  it('matches the dealer error messages we expect', () => {
    expect(isStaleActionError(new Error('Not your turn.'))).toBe(true);
    expect(isStaleActionError(new Error('Hand is complete.'))).toBe(true);
    expect(isStaleActionError(new Error('Cannot check facing a bet.'))).toBe(true);
    expect(isStaleActionError(new Error('Cannot call.'))).toBe(true);
    expect(isStaleActionError(new Error('Cannot raise.'))).toBe(true);
  });

  it('does NOT match transient network failures', () => {
    expect(isStaleActionError(new Error('fetch failed'))).toBe(false);
    expect(isStaleActionError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isStaleActionError(new Error('timeout'))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isStaleActionError('Not your turn')).toBe(true);
    expect(isStaleActionError(null)).toBe(false);
    expect(isStaleActionError(undefined)).toBe(false);
  });
});

// --- AgentRunner ----------------------------------------------------------

describe('AgentRunner', () => {
  it('posts on a fresh spot and consumes the key on success', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client = makeClient({ state: makeView() });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });

    const r1 = await runner.tick();
    expect(r1.kind).toBe('posted');
    expect(client.posts).toEqual([{ type: 'check' }]);
    expect(log.decision).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();

    // Second tick on the SAME spot must not invoke the strategy again.
    const r2 = await runner.tick();
    expect(r2.kind).toBe('skipped');
    expect(strategy.calls).toBe(1);
    expect(client.posts.length).toBe(1);
  });

  it('does NOT act when it is not MoltFire\'s turn', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client = makeClient({ state: makeView({ currentActor: 'wes' }) });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });
    const result = await runner.tick();
    expect(result).toEqual({ kind: 'idle', reason: 'not-my-turn' });
    expect(strategy.calls).toBe(0);
    expect(client.posts.length).toBe(0);
  });

  it('does NOT act when the hand is complete', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client = makeClient({ state: makeView({ handComplete: true }) });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });
    const result = await runner.tick();
    expect(result).toEqual({ kind: 'idle', reason: 'hand-complete' });
    expect(strategy.calls).toBe(0);
  });

  it('consumes the decision key after a stale-action server rejection (no retries)', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client = makeClient({
      state: makeView(),
      postBehavior: async () => {
        throw new Error('Not your turn.');
      },
    });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });

    const r1 = await runner.tick();
    expect(r1.kind).toBe('stale-rejected');
    expect(log.error).toHaveBeenCalledOnce();

    // Same spot — runner must NOT re-decide or re-post.
    const r2 = await runner.tick();
    expect(r2.kind).toBe('skipped');
    expect(strategy.calls).toBe(1);
    expect(client.posts.length).toBe(1);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('does NOT consume the key on a transient network error — retries next tick', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    let attempts = 0;
    const client = makeClient({
      state: makeView(),
      postBehavior: async () => {
        attempts++;
        if (attempts === 1) throw new Error('fetch failed');
        return makeView({ currentActor: 'wes' }); // post succeeds 2nd time
      },
    });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });

    const r1 = await runner.tick();
    expect(r1.kind).toBe('transient-error');
    expect(strategy.calls).toBe(1);

    const r2 = await runner.tick();
    expect(r2.kind).toBe('posted');
    expect(strategy.calls).toBe(2);
    expect(client.posts.length).toBe(2);
  });

  it('in-flight guard prevents two overlapping decisions for the same key', async () => {
    const gated = makeGatedStrategy({ type: 'check' });
    const client = makeClient({ state: makeView() });
    const log = makeLogSpies();
    const runner = new AgentRunner({
      client,
      chain: [gated.strategy],
      mode: 'match',
      dryRun: false,
      log,
    });

    // Start a tick but do NOT await it — its strategy is gated.
    const firstTick = runner.tick();
    // Give the microtask queue a chance to enter the in-flight section.
    await new Promise((r) => setImmediate(r));
    expect(gated.calls()).toBe(1);
    expect(runner._inFlightDecisionKey).not.toBeNull();

    // A second tick should see the in-flight guard and return immediately.
    const second = await runner.tick();
    expect(second).toEqual({ kind: 'skipped', reason: 'in-flight' });
    expect(gated.calls()).toBe(1); // strategy NOT called again

    // Release the gate, finish first tick.
    gated.release();
    const first = await firstTick;
    expect(first.kind).toBe('posted');
    expect(client.posts.length).toBe(1);
    expect(runner._inFlightDecisionKey).toBeNull();
  });

  it('dry-run consumes the key but does NOT post', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client = makeClient({ state: makeView() });
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: true, log });

    const r1 = await runner.tick();
    expect(r1.kind).toBe('dry-run');
    expect(client.posts.length).toBe(0);

    const r2 = await runner.tick();
    expect(r2.kind).toBe('skipped');
    expect(strategy.calls).toBe(1);
  });

  it('reports fetch-failure and clears in-flight state', async () => {
    const strategy = makeFixedStrategy({ type: 'check' });
    const client: AgentClientLike = {
      async getState() {
        throw new Error('ECONNREFUSED');
      },
      async postAction() {
        return makeView();
      },
    };
    const log = makeLogSpies();
    const runner = new AgentRunner({ client, chain: [strategy], mode: 'match', dryRun: false, log });
    const result = await runner.tick();
    expect(result).toEqual({ kind: 'idle', reason: 'fetch-failed' });
    expect(log.error).toHaveBeenCalledOnce();
    expect(runner._inFlightDecisionKey).toBeNull();
  });
});
