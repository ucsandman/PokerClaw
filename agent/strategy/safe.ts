import type { Strategy, StrategyDecision, StrategyInput } from '../types';

// Last-resort strategy: always produces a legal action, no information needed.
// Ladder per MOLTFIRE_POKER_AGENT_CONTRACT.md:
//   1. check if legal
//   2. call if legal AND the call is cheap (<= one big blind)
//   3. fold if legal
//   4. otherwise decline (return null)
//
// This must NEVER return an illegal action. The rule strategy already always
// produces a legal action, so this is mainly a safety net for the LLM path.
export const safeFallbackStrategy: Strategy = {
  name: 'safe-fallback',
  async decide(input: StrategyInput): Promise<StrategyDecision> {
    const legal = input.legalActions;
    if (legal.check) {
      return { action: { type: 'check' }, rationale: 'safe: check' };
    }
    const toCall = legal.callTo - input.myCommittedThisStreet;
    if (legal.call && toCall <= input.bigBlind) {
      return { action: { type: 'call' }, rationale: 'safe: cheap call' };
    }
    if (legal.fold) {
      return { action: { type: 'fold' }, rationale: 'safe: fold' };
    }
    return null;
  },
};
