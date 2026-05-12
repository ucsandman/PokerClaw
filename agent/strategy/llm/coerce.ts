import type { PlayerAction } from '../../../shared/types';
import type { LegalActions } from '../../../shared/actions';

// Validates a model-proposed action against the legalActions block.
// Bet/raise amounts are CLAMPED to [min,max]. We accept reasonable
// sizing intent rather than rejecting on minor numeric drift.
// Returns null when the action is unrecognized or fundamentally illegal
// (e.g. checking when there is a bet to call).
export function coerceAction(raw: unknown, legal: LegalActions): PlayerAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { type?: unknown; amount?: unknown };
  switch (r.type) {
    case 'fold':
      return legal.fold ? { type: 'fold' } : null;
    case 'check':
      return legal.check ? { type: 'check' } : null;
    case 'call':
      return legal.call ? { type: 'call' } : null;
    case 'bet': {
      if (!legal.canBet) return null;
      const amt = clampAmount(r.amount, legal.minBetTo, legal.maxBetTo);
      if (amt === null) return null;
      return { type: 'bet', amount: amt };
    }
    case 'raise': {
      if (!legal.canRaise) return null;
      const amt = clampAmount(r.amount, legal.minRaiseTo, legal.maxRaiseTo);
      if (amt === null) return null;
      return { type: 'raise', amount: amt };
    }
    default:
      return null;
  }
}

function clampAmount(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
