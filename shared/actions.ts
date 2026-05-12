import type { GameState, PlayerAction, PlayerId } from './types';

// Pure helpers describing what actions are legal for a given player. The state
// machine in game.ts uses these to validate before applying any action.

export type LegalActions = {
  fold: boolean;
  check: boolean;
  call: boolean;
  // Total committed amount the call would bring the actor to.
  callTo: number;
  // True if the actor may bet (no current bet on this street).
  canBet: boolean;
  // True if the actor may raise (there is a current bet on this street).
  canRaise: boolean;
  // Minimum legal "amount" for a bet (total commit on this street).
  minBetTo: number;
  // Maximum legal "amount" for a bet on this street (all-in shove total).
  maxBetTo: number;
  // Minimum legal "amount" for a raise (total commit on this street).
  minRaiseTo: number;
  // Maximum legal "amount" for a raise on this street (all-in shove total).
  maxRaiseTo: number;
};

export function legalActionsFor(state: GameState, playerId: PlayerId): LegalActions | null {
  if (state.handComplete) return null;
  if (state.currentActor !== playerId) return null;

  const me = state.players[playerId];
  if (me.folded || me.allIn) return null;

  const toCall = Math.max(0, state.currentBet - me.committedThisStreet);
  const callTo = me.committedThisStreet + Math.min(toCall, me.stack);

  // Max we can ever commit this street is current commitment + whole stack.
  const maxTo = me.committedThisStreet + me.stack;

  // "Facing a bet" really means owing chips to match it. If currentBet > 0 but
  // we have already matched (BB option preflop), check is legal and bet is too.
  const facingBet = toCall > 0;

  if (!facingBet) {
    const minBetTo = Math.min(state.currentBet + state.bigBlind, maxTo);
    return {
      fold: true,
      check: true,
      call: false,
      callTo: me.committedThisStreet,
      canBet: state.currentBet === 0 && me.stack > 0,
      canRaise: state.currentBet > 0 && maxTo > state.currentBet,
      minBetTo: state.currentBet === 0 ? Math.min(state.bigBlind, maxTo) : 0,
      maxBetTo: state.currentBet === 0 ? maxTo : 0,
      minRaiseTo: state.currentBet > 0 ? minBetTo : 0,
      maxRaiseTo: state.currentBet > 0 ? maxTo : 0,
    };
  }

  // Owing chips: must call/raise/fold.
  const minRaiseTo = Math.min(state.minRaiseTo, maxTo);
  return {
    fold: true,
    check: false,
    call: me.stack > 0,
    callTo,
    canBet: false,
    canRaise: maxTo > state.currentBet,
    minBetTo: 0,
    maxBetTo: 0,
    minRaiseTo,
    maxRaiseTo: maxTo,
  };
}

// Validates an action against legal actions. Returns null if legal, otherwise a
// short error message describing why the action is illegal.
export function validateAction(
  state: GameState,
  playerId: PlayerId,
  action: PlayerAction,
): string | null {
  if (state.handComplete) return 'Hand is complete.';
  if (state.currentActor !== playerId) return 'Not your turn.';

  const legal = legalActionsFor(state, playerId);
  if (!legal) return 'No legal action available.';
  const me = state.players[playerId];

  switch (action.type) {
    case 'fold':
      return legal.fold ? null : 'Cannot fold.';
    case 'check':
      return legal.check ? null : 'Cannot check facing a bet.';
    case 'call':
      return legal.call ? null : 'Cannot call.';
    case 'bet': {
      if (!legal.canBet) return 'Cannot bet (there is already a bet to call).';
      if (!Number.isFinite(action.amount)) return 'Bet amount must be a number.';
      if (!Number.isInteger(action.amount)) return 'Bet amount must be a whole-chip integer.';
      const maxTo = me.committedThisStreet + me.stack;
      if (action.amount < legal.minBetTo && action.amount !== maxTo) {
        return `Bet must be at least ${legal.minBetTo} (or all-in).`;
      }
      if (action.amount > legal.maxBetTo) return `Bet exceeds stack (max ${legal.maxBetTo}).`;
      return null;
    }
    case 'raise': {
      if (!legal.canRaise) return 'Cannot raise.';
      if (!Number.isFinite(action.amount)) return 'Raise amount must be a number.';
      if (!Number.isInteger(action.amount)) return 'Raise amount must be a whole-chip integer.';
      if (action.amount <= state.currentBet) {
        return `Raise must exceed current bet of ${state.currentBet}.`;
      }
      const maxTo = me.committedThisStreet + me.stack;
      // Short all-in raises (below minRaiseTo) are only allowed when going all-in.
      if (action.amount < legal.minRaiseTo && action.amount !== maxTo) {
        return `Raise must be at least ${legal.minRaiseTo} (or all-in).`;
      }
      if (action.amount > legal.maxRaiseTo) return `Raise exceeds stack (max ${legal.maxRaiseTo}).`;
      return null;
    }
  }
}
