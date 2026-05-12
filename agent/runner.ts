import type { PlayerAction } from '../shared/types';
import type { PlayerView } from '../shared/view-models';
import type { AgentMode, Strategy } from './types';
import { decideViaChain } from './strategy';
import { buildStrategyInput } from './strategy-input';
import { isStaleActionError } from './errors';

// Narrow interface the runner needs from a client. Tests can pass a mock.
export interface AgentClientLike {
  getState(): Promise<PlayerView>;
  postAction(action: PlayerAction): Promise<PlayerView>;
}

export type RunnerLog = {
  decision: (
    mode: AgentMode,
    view: PlayerView,
    action: PlayerAction,
    rationale: string,
    posted: boolean,
    strategy?: string,
    latencyMs?: number,
  ) => void;
  error: (err: unknown) => void;
};

export type AgentRunnerOpts = {
  client: AgentClientLike;
  chain: Strategy[];
  mode: AgentMode;
  dryRun: boolean;
  log: RunnerLog;
};

// Outcome of a single tick. Returned for tests; production callers ignore it.
export type TickResult =
  | { kind: 'idle'; reason: 'hand-complete' | 'not-my-turn' | 'no-legal-actions' | 'fetch-failed' }
  | { kind: 'skipped'; reason: 'already-consumed' | 'in-flight' }
  | { kind: 'posted'; action: PlayerAction; strategy: string }
  | { kind: 'dry-run'; action: PlayerAction; strategy: string }
  | { kind: 'no-strategy' }
  | { kind: 'stale-rejected'; action: PlayerAction }
  | { kind: 'transient-error' };

// Builds the decision-uniqueness key used to dedupe per spot. Identical to
// the one historically inlined in agent/index.ts.
export function decisionKey(v: PlayerView): string {
  return JSON.stringify({
    handId: v.handId,
    street: v.street,
    actionCount: v.actionHistory.length,
    actor: v.currentActor,
    currentBet: v.currentBet,
    pot: v.pot,
  });
}

// AgentRunner owns the per-tick decision logic. Two pieces of state:
//   - lastDecisionKey:    keys we've already acted on (or have given up on
//                         after a stale rejection). Skip without re-deciding.
//   - inFlightDecisionKey: a key whose strategy call is currently in progress.
//                         Even with the sequential loop in index.ts this is a
//                         belt-and-braces guard against concurrent ticks.
//
// Key consumption rules (per AGENT_RACE_BUGFIX.md §3):
//   - successful post  → consume key
//   - dry run          → consume key
//   - stale rejection  → consume key (log once, never retry that spot)
//   - transient error  → do NOT consume; the loop will try again next tick
//   - no strategy      → do NOT consume; same reason
export class AgentRunner {
  private lastDecisionKey: string | null = null;
  private inFlightDecisionKey: string | null = null;

  constructor(private readonly opts: AgentRunnerOpts) {}

  // Test-only accessors. Kept narrow on purpose.
  get _lastDecisionKey(): string | null { return this.lastDecisionKey; }
  get _inFlightDecisionKey(): string | null { return this.inFlightDecisionKey; }

  async tick(): Promise<TickResult> {
    let view: PlayerView;
    try {
      view = await this.opts.client.getState();
    } catch (err) {
      this.opts.log.error(err);
      return { kind: 'idle', reason: 'fetch-failed' };
    }

    if (view.handComplete) return { kind: 'idle', reason: 'hand-complete' };
    if (view.currentActor !== 'moltfire') return { kind: 'idle', reason: 'not-my-turn' };
    if (!view.legalActions) return { kind: 'idle', reason: 'no-legal-actions' };

    const key = decisionKey(view);
    if (key === this.lastDecisionKey) return { kind: 'skipped', reason: 'already-consumed' };
    if (key === this.inFlightDecisionKey) return { kind: 'skipped', reason: 'in-flight' };

    this.inFlightDecisionKey = key;
    try {
      const input = buildStrategyInput(view, this.opts.mode);
      const decideStarted = Date.now();
      const { decision, strategy } = await decideViaChain(this.opts.chain, input);
      const latencyMs = Date.now() - decideStarted;
      if (!decision) {
        this.opts.log.error(new Error('no strategy produced an action'));
        return { kind: 'no-strategy' };
      }

      if (this.opts.dryRun) {
        this.opts.log.decision(
          this.opts.mode,
          view,
          decision.action,
          `${strategy}/${decision.rationale}`,
          false,
          strategy,
          latencyMs,
        );
        this.lastDecisionKey = key;
        return { kind: 'dry-run', action: decision.action, strategy };
      }

      try {
        await this.opts.client.postAction(decision.action);
        this.lastDecisionKey = key;
        this.opts.log.decision(
          this.opts.mode,
          view,
          decision.action,
          `${strategy}/${decision.rationale}`,
          true,
          strategy,
          latencyMs,
        );
        return { kind: 'posted', action: decision.action, strategy };
      } catch (err) {
        if (isStaleActionError(err)) {
          // Consume the key so we don't retry every tick. Log once.
          this.lastDecisionKey = key;
          this.opts.log.error(err);
          return { kind: 'stale-rejected', action: decision.action };
        }
        // Transient failure (network, etc.) — do NOT consume; retry next tick.
        this.opts.log.error(err);
        return { kind: 'transient-error' };
      }
    } finally {
      if (this.inFlightDecisionKey === key) {
        this.inFlightDecisionKey = null;
      }
    }
  }
}
