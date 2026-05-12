import type { PlayerView } from '../shared/view-models';
import type { ActionRecord } from '../shared/types';
import type { AgentMode, PublicActionRecord, StrategyInput } from './types';

// Project the authorized PlayerView into the StrategyInput passed to
// strategies. This is the single point where we serialize the view, so all
// strategies (rule + LLM) see exactly the same fields.
export function buildStrategyInput(view: PlayerView, mode: AgentMode): StrategyInput {
  if (!view.legalActions) {
    throw new Error('buildStrategyInput called without legalActions');
  }
  return {
    pot: view.pot,
    currentBet: view.currentBet,
    minRaiseTo: view.minRaiseTo,
    bigBlind: view.bigBlind,
    street: view.street,
    myStack: view.you.stack,
    myCommittedThisStreet: view.you.committedThisStreet,
    opponentStack: view.opponent.stack,
    opponentCommittedThisStreet: view.opponent.committedThisStreet,
    effectiveStack: Math.min(view.you.stack, view.opponent.stack),
    board: view.board.map((c) => `${c.rank}${c.suit}`),
    myHoleCards: view.you.cards.map((c) => `${c.rank}${c.suit}`),
    legalActions: view.legalActions,
    mode,
    publicActionHistory: sanitizeHistory(view.actionHistory),
  };
}

// Strips card data from action history. ActionRecord today only contains
// actions (no card data), but we still build a fresh shape so a future field
// addition can't accidentally leak through.
function sanitizeHistory(records: ActionRecord[]): PublicActionRecord[] {
  return records.map((r) => ({
    street: r.street,
    player: r.player,
    action: r.action,
    potAfter: r.potAfter,
  }));
}
