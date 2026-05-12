import type { Strategy, StrategyDecision, StrategyInput } from '../types';

// Cheap "obvious spot" shortcut. Runs BEFORE any model call so trivial,
// zero-cost decisions don't burn a 1-3s LLM round-trip.
//
// Hard safety rules (enforced here AND mirrored in tests):
//   - Only ever returns `check`. Never call, bet, raise, or fold.
//   - Only fires when checking is legal AND there is no chip pressure
//     (currentBet matched, toCall == 0).
//   - Returns `null` (decline) on ANY all-in spot, any unusually large pot,
//     or any spot where the legal action set includes raise/bet but not
//     check. The fast model handles those.
//
// Why so conservative? "Obviously check" is the only HU spot where a snap
// decision is strictly better than a thoughtful one. Auto-call / auto-raise
// shortcuts would leak EV the moment we're wrong about the spot.
export const ruleShortcutStrategy: Strategy = {
  name: 'rules-shortcut',
  async decide(input: StrategyInput): Promise<StrategyDecision> {
    if (!isObviousCheckSpot(input)) return null;
    return { action: { type: 'check' }, rationale: 'free check' };
  },
};

// Pure predicate; exported for tests.
export function isObviousCheckSpot(input: StrategyInput): boolean {
  const legal = input.legalActions;
  // Need check available. If check isn't legal, we're facing chip pressure.
  if (!legal.check) return false;
  // Defense in depth: if the dealer says we owe chips, never shortcut.
  const toCall = input.currentBet - input.myCommittedThisStreet;
  if (toCall > 0) return false;
  // Don't shortcut all-in spots — even when checking is technically free,
  // the contract says we never auto-act through any all-in dynamic.
  if (input.myStack === 0) return false;
  if (input.opponentStack === 0) return false;
  // Unusually large pot heuristic: pot >= 20 BB. At those stakes the
  // decision deserves the model even if it's "just" a check on a brick.
  // Tournament late-stage spots in particular care about timing tells, but
  // playability beats tells — we just don't want to shortcut every big-pot
  // river check. (Threshold tuned via tests; raise via env if needed.)
  if (input.pot >= input.bigBlind * 20) return false;
  return true;
}
