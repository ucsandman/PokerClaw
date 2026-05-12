import { describe, it, expect, vi } from 'vitest';
import { buildStrategyChain } from '../agent/strategy';
import { loadAgentConfig, describeStartup } from '../agent/config';
import { strategyToSource } from '../agent/log';
import { AgentRunner, type AgentClientLike } from '../agent/runner';
import type { AgentConfig, Strategy } from '../agent/types';
import type { PlayerView } from '../shared/view-models';
import type { PlayerAction } from '../shared/types';

const BASE_ENV: NodeJS.ProcessEnv = {
  POKERCLAW_AGENT_MODE: 'match',
  POKERCLAW_AGENT_POLL_MS: '750',
  POKERCLAW_SERVER_URL: 'http://127.0.0.1:3001',
  POKERCLAW_AGENT_BRIDGE_ENABLED: 'true',
  POKERCLAW_AGENT_BRIDGE_URL: 'http://127.0.0.1:5179',
  POKERCLAW_AGENT_BRIDGE_SESSION_LABEL: 'moltfire-pokerclaw',
};

describe('POKERCLAW_DISABLE_FALLBACK env parsing', () => {
  it('defaults to false when unset', () => {
    const cfg = loadAgentConfig(BASE_ENV, []);
    expect(cfg.disableFallback).toBe(false);
  });

  it('parses "1", "true", and "yes" as true (case-insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
      const cfg = loadAgentConfig({ ...BASE_ENV, POKERCLAW_DISABLE_FALLBACK: v }, []);
      expect(cfg.disableFallback).toBe(true);
    }
  });

  it('treats "0", "false", "no", and empty as false', () => {
    for (const v of ['0', 'false', 'no', '']) {
      const cfg = loadAgentConfig({ ...BASE_ENV, POKERCLAW_DISABLE_FALLBACK: v }, []);
      expect(cfg.disableFallback).toBe(false);
    }
  });
});

describe('buildStrategyChain with disableFallback', () => {
  it('collapses to just the bridge when disableFallback=true and bridge configured', () => {
    const cfg: AgentConfig = {
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      disableFallback: true,
      bridge: {
        url: 'http://127.0.0.1:5179',
        timeoutMs: 15000,
        sessionLabel: 'moltfire-pokerclaw',
      },
    };
    const chain = buildStrategyChain(cfg);
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('openclaw-bridge');
  });

  it('builds full fallback chain when disableFallback=false', () => {
    const cfg: AgentConfig = {
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      disableFallback: false,
      bridge: {
        url: 'http://127.0.0.1:5179',
        timeoutMs: 15000,
        sessionLabel: 'moltfire-pokerclaw',
      },
    };
    const chain = buildStrategyChain(cfg);
    expect(chain.length).toBeGreaterThan(1);
    expect(chain[0].name).toBe('openclaw-bridge');
    // Last entry is always the safe fallback so the agent can produce *something*.
    expect(chain[chain.length - 1].name).toBe('safe-fallback');
  });

  it('ignores disableFallback when no bridge is configured (no other safety net to disable)', () => {
    const cfg: AgentConfig = {
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      disableFallback: true,
      // No bridge.
    };
    const chain = buildStrategyChain(cfg);
    // Still includes rules + safe-fallback so the agent isn't completely dead
    // in a no-bridge configuration. Disable-fallback only governs the bridge
    // configuration; if you didn't configure a bridge, there's nothing to gate.
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });
});

describe('describeStartup with disableFallback', () => {
  it('reports fallback=disabled when bridge is configured and fallback is disabled', () => {
    const cfg: AgentConfig = {
      serverUrl: 'http://127.0.0.1:3001',
      pollMs: 750,
      mode: 'match',
      dryRun: false,
      disableFallback: true,
      bridge: {
        url: 'http://127.0.0.1:5179',
        timeoutMs: 15000,
        sessionLabel: 'moltfire-pokerclaw',
      },
    };
    const line = describeStartup(cfg);
    expect(line).toContain('strategy=openclaw-bridge');
    expect(line).toContain('fallback=disabled');
  });
});

describe('strategyToSource — log marker mapping', () => {
  it('maps openclaw-bridge to source=openclaw-bridge', () => {
    expect(strategyToSource('openclaw-bridge')).toBe('openclaw-bridge');
  });

  it('maps llm/rules/safe-fallback to fallback-* markers', () => {
    expect(strategyToSource('llm')).toBe('fallback-llm');
    expect(strategyToSource('rules')).toBe('fallback-rules');
    expect(strategyToSource('safe-fallback')).toBe('fallback-safe');
  });

  it('falls back to unknown for missing strategy and prefixes anything else with fallback-', () => {
    expect(strategyToSource(undefined)).toBe('unknown');
    expect(strategyToSource('mystery')).toBe('fallback-mystery');
  });
});

// -----------------------------------------------------------------------
// Runner integration: with disableFallback=true and a bridge that returns
// null (simulating /decide failure), the runner must NOT post an action.
// This is the property that lets us verify the bridge is doing real work
// during launcher tests — fallback can't hide a broken bridge.
// -----------------------------------------------------------------------

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

function makeClient(state: PlayerView): AgentClientLike & { posts: PlayerAction[] } {
  const posts: PlayerAction[] = [];
  return {
    posts,
    async getState() { return state; },
    async postAction(a) { posts.push(a); return state; },
  };
}

describe('runner + disableFallback: bridge failure produces no post', () => {
  it('returns kind=no-strategy and never posts when the only strategy declines', async () => {
    const bridgeStub: Strategy = {
      name: 'openclaw-bridge',
      async decide() { return null; }, // simulates /decide returning 502
    };
    const client = makeClient(makeView());
    const log = { decision: vi.fn(), error: vi.fn() };
    const runner = new AgentRunner({
      client,
      chain: [bridgeStub], // disableFallback => only the bridge
      mode: 'match',
      dryRun: false,
      log,
    });
    const result = await runner.tick();
    expect(result.kind).toBe('no-strategy');
    expect(client.posts).toEqual([]);
    expect(log.decision).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('records source=openclaw-bridge in the decision log when the bridge wins', async () => {
    const bridgeStub: Strategy = {
      name: 'openclaw-bridge',
      async decide() { return { action: { type: 'check' }, rationale: 'control' }; },
    };
    const client = makeClient(makeView());
    const log = { decision: vi.fn(), error: vi.fn() };
    const runner = new AgentRunner({
      client, chain: [bridgeStub], mode: 'match', dryRun: false, log,
    });
    const result = await runner.tick();
    expect(result.kind).toBe('posted');
    expect(log.decision).toHaveBeenCalledOnce();
    // 6th arg of logDecision is the strategy name.
    const call = (log.decision as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[5]).toBe('openclaw-bridge');
  });
});
