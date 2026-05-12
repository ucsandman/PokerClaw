import type { PlayerAction } from '../shared/types';
import type { LegalActions } from '../shared/actions';

export type AgentMode = 'match' | 'training' | 'debug';

// Explicit strategy selection. `fast-live` is the default playable path;
// `openclaw-bridge` keeps the slower OpenClaw CLI route for review/tank/
// identity work; `rules` is the deterministic toy bot with no model.
export type StrategyMode = 'fast-live' | 'openclaw-bridge' | 'rules';

// LLM provider selection. `off` means no LLM is used — the chain skips
// straight to the rule strategy.
export type LLMProvider = 'anthropic' | 'openai-compatible' | 'off';

export type LLMConfig = {
  provider: Exclude<LLMProvider, 'off'>;
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

// Fast-live strategy config. Reuses the same provider/key/url as LLMConfig
// but with a stricter timeout (<=5s) and a small retry budget so a malformed
// model response gets one repair attempt before falling through.
export type FastLiveConfig = {
  provider: Exclude<LLMProvider, 'off'>;
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
};

// MoltFire OpenClaw bridge sidecar config. The agent never talks to OpenClaw
// directly — only to a localhost sidecar over HTTP. The sidecar owns OpenClaw
// credentials and session-send wiring.
export type BridgeConfig = {
  url: string;            // e.g. http://127.0.0.1:5179
  timeoutMs: number;      // per-/decide call timeout
  sessionLabel: string;   // labeled OpenClaw session the sidecar should target
};

export type AgentConfig = {
  serverUrl: string;
  pollMs: number;
  mode: AgentMode;
  // Which top-level strategy chain to build. Defaults to 'fast-live' when
  // missing; buildStrategyChain and describeStartup infer 'openclaw-bridge'
  // for back-compat when `bridge` is set but `strategy` is absent.
  strategy?: StrategyMode;
  // Cheap rule shortcuts run before any model call in fast-live mode (only
  // for trivial zero-cost spots — never auto-calls or auto-raises).
  // Defaults to true when missing.
  ruleShortcutsEnabled?: boolean;
  // If true, choose an action but do NOT post it to the server.
  dryRun: boolean;
  // When true, only the primary strategy is built into the chain. Primary
  // failure produces no action — the agent logs the failure and waits.
  // Required for launcher-path verification: with fallback enabled, a broken
  // primary path is hidden by lower-tier strategies posting actions instead.
  // Optional; defaults to false.
  disableFallback?: boolean;
  // Present only when a provider is configured and model/key are set.
  llm?: LLMConfig;
  // Present only when POKERCLAW_AGENT_BRIDGE_ENABLED=true.
  bridge?: BridgeConfig;
  // Fast direct-model path. Resolved when a provider + key are configured;
  // model + timeout + retries can be overridden via POKERCLAW_FAST_*.
  fastLive?: FastLiveConfig;
};

// Strategies return either a concrete action or `null` if they decline (the
// caller falls back to the next strategy in the chain).
export type StrategyDecision =
  | { action: PlayerAction; rationale: string; tableTalk?: string }
  | null;

export type Strategy = {
  name: string;
  decide: (input: StrategyInput) => Promise<StrategyDecision>;
};

// One element of the public, sanitized action history passed to strategies.
// No card data is ever included — actions only.
export type PublicActionRecord = {
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
  player: 'wes' | 'moltfire';
  action:
    | { type: 'fold' }
    | { type: 'check' }
    | { type: 'call' }
    | { type: 'bet'; amount: number }
    | { type: 'raise'; amount: number };
  potAfter: number;
};

// Limit what each strategy sees so we can't accidentally pass GameState.
// The agent never has access to GameState anyway — but this is belt-and-braces.
export type StrategyInput = {
  pot: number;
  currentBet: number;
  minRaiseTo: number;
  bigBlind: number;
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
  myStack: number;
  myCommittedThisStreet: number;
  opponentStack: number;
  opponentCommittedThisStreet: number;
  // Effective stacks at start of decision = min of remaining stacks for
  // common heuristics. Kept here so each strategy doesn't recompute.
  effectiveStack: number;
  board: string[];        // serialized "Th" / "Ac" strings — public board only
  myHoleCards: string[];  // serialized hole cards (agent process only)
  legalActions: LegalActions;
  mode: AgentMode;
  // Sanitized public history of every action this hand. No card content.
  publicActionHistory: PublicActionRecord[];
};
