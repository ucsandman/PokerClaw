import type {
  BridgeConfig,
  PublicActionRecord,
  Strategy,
  StrategyDecision,
  StrategyInput,
} from '../types';
import type { LegalActions } from '../../shared/actions';
import { coerceAction } from './llm/coerce';

// MoltFire OpenClaw Bridge strategy adapter.
//
// Talks to the localhost bridge sidecar (bridge/moltfire-bridge.mjs) over
// HTTP. The sidecar — not this file — is responsible for actually contacting
// the dedicated MoltFire OpenClaw session. Keeping that wall here means:
//   - PokerClaw never imports OpenClaw internals or credentials.
//   - The sidecar can be swapped or run in dry-run mode without changing
//     the agent.
//   - Any failure here returns `null` so the chain falls through to the LLM
//     strategy and then the rule strategy.
//
// Privacy:
//   - The outgoing /decide body carries only the public/authorized fields
//     already present in StrategyInput (which itself is filtered upstream).
//   - The wire shape sent to the sidecar matches MOLTFIRE_OPENCLAW_BRIDGE.md:
//     publicHandContext { handId?, street, pot, ..., myHoleCards, board,
//                         legalActions, actionHistory }
//   - This adapter never logs request/response bodies — only short, public
//     error reasons in case of failure.

export type BridgeDecideRequest = {
  mode: 'match' | 'training' | 'debug';
  publicHandContext: {
    street: StrategyInput['street'];
    pot: number;
    currentBet: number;
    bigBlind: number;
    myStack: number;
    opponentStack: number;
    myCommittedThisStreet: number;
    opponentCommittedThisStreet: number;
    effectiveStack: number;
    board: string[];          // public board only
    myHoleCards: string[];    // agent's own cards (never opponent's)
    actionHistory: PublicActionRecord[];
    legalActions: LegalActions;
    sessionLabel: string;
  };
};

export type BridgeDecideResponse = {
  action?: unknown;
  rationale?: unknown;
  tableTalk?: unknown;
};

export function makeBridgeStrategy(cfg: BridgeConfig): Strategy {
  return {
    name: 'openclaw-bridge',
    async decide(input: StrategyInput): Promise<StrategyDecision> {
      try {
        const payload = buildBridgeRequest(input, cfg.sessionLabel);
        const text = await postDecide(cfg, payload);
        if (!text) return null;
        const body = safeJsonParse(text);
        if (!body) return null;
        const action = coerceAction((body as BridgeDecideResponse).action, input.legalActions);
        if (!action) return null;
        const rationale =
          typeof (body as BridgeDecideResponse).rationale === 'string'
            ? ((body as BridgeDecideResponse).rationale as string)
            : 'openclaw-bridge';
        const tableTalk =
          typeof (body as BridgeDecideResponse).tableTalk === 'string'
            ? ((body as BridgeDecideResponse).tableTalk as string)
            : undefined;
        return { action, rationale, tableTalk };
      } catch {
        // Network/timeout/unexpected — chain falls through to the LLM, then
        // rules. No body, no stack trace logged here: the runner's error
        // hook handles that surface, and we explicitly do NOT echo the
        // bridge body anywhere because it might include free-form rationale.
        return null;
      }
    },
  };
}

// Builds the strict-shape /decide payload. Pure function for tests.
export function buildBridgeRequest(input: StrategyInput, sessionLabel: string): BridgeDecideRequest {
  return {
    mode: input.mode,
    publicHandContext: {
      street: input.street,
      pot: input.pot,
      currentBet: input.currentBet,
      bigBlind: input.bigBlind,
      myStack: input.myStack,
      opponentStack: input.opponentStack,
      myCommittedThisStreet: input.myCommittedThisStreet,
      opponentCommittedThisStreet: input.opponentCommittedThisStreet,
      effectiveStack: input.effectiveStack,
      board: [...input.board],
      myHoleCards: [...input.myHoleCards],
      actionHistory: [...input.publicActionHistory],
      legalActions: input.legalActions,
      sessionLabel,
    },
  };
}

async function postDecide(cfg: BridgeConfig, payload: BridgeDecideRequest): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
