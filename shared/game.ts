import type {
  ActionRecord,
  GameState,
  HandResult,
  PlayerAction,
  PlayerId,
  PlayerState,
  SessionConfig,
} from './types';
import { OTHER } from './types';
import { shuffledDeck } from './deck';
import { evaluateBestHand, compareHands } from './evaluator';
import { validateAction } from './actions';
import { DEFAULT_BLIND_SCHEDULE, getBlindsForHand, type BlindSchedule } from './blinds';

// Creates the initial game state for a brand-new session (hand #1).
// `button` defaults to 'wes' so MoltFire is the big blind in hand 1. The button
// alternates each new hand.
export function startSession(
  config: SessionConfig,
  options: { button?: PlayerId; rand?: () => number } = {},
): GameState {
  const button: PlayerId = options.button ?? 'wes';
  const schedule: BlindSchedule = config.blindSchedule ?? DEFAULT_BLIND_SCHEDULE;
  const seedLevel = getBlindsForHand(1, schedule);
  const players: Record<PlayerId, PlayerState> = {
    wes: emptyPlayer('wes', config.startingStack),
    moltfire: emptyPlayer('moltfire', config.startingStack),
  };
  return startNewHand(
    {
      handId: 0,
      deck: [],
      board: [],
      players,
      button,
      blindSchedule: schedule,
      smallBlind: seedLevel.smallBlind,
      bigBlind: seedLevel.bigBlind,
      pot: 0,
      street: 'complete',
      currentBet: 0,
      minRaiseTo: 0,
      lastRaiseSize: 0,
      lastAggressor: null,
      hasActedThisRound: { wes: false, moltfire: false },
      currentActor: null,
      actionHistory: [],
      handComplete: true,
    },
    options.rand,
  );
}

// Starts the next hand using the running stacks from the previous hand.
// Alternates the button. Resets per-hand state. Posts blinds.
export function startNewHand(prev: GameState, rand: () => number = Math.random): GameState {
  if (!prev.handComplete && prev.handId !== 0) {
    throw new Error('Cannot start a new hand until the current hand completes.');
  }
  const wesStack = prev.players.wes.stack;
  const moltStack = prev.players.moltfire.stack;
  if (wesStack <= 0 || moltStack <= 0) {
    throw new Error('Cannot start hand: a player is out of chips.');
  }

  const handId = prev.handId + 1;
  // Alternate button. First hand uses prev.button as-is (the seed).
  const button: PlayerId = handId === 1 ? prev.button : OTHER[prev.button];
  const sb: PlayerId = button;        // heads-up: button is small blind
  const bb: PlayerId = OTHER[button];

  // Pull THIS hand's blinds from the schedule. Hand-1 blinds are anchored
  // at session start; subsequent hands may climb the schedule.
  const schedule = prev.blindSchedule ?? DEFAULT_BLIND_SCHEDULE;
  const level = getBlindsForHand(handId, schedule);
  const smallBlind = level.smallBlind;
  const bigBlind = level.bigBlind;

  const deck = shuffledDeck(rand);
  const players: Record<PlayerId, PlayerState> = {
    wes: emptyPlayer('wes', wesStack),
    moltfire: emptyPlayer('moltfire', moltStack),
  };
  // Deal two hole cards each (alternating, dealer convention not material since deck is shuffled).
  players[sb].holeCards = [deck.pop()!, deck.pop()!];
  players[bb].holeCards = [deck.pop()!, deck.pop()!];

  // Post blinds (capped to stack — short stacks post all-in for the blind).
  const sbPost = Math.min(smallBlind, players[sb].stack);
  const bbPost = Math.min(bigBlind, players[bb].stack);
  commit(players[sb], sbPost);
  commit(players[bb], bbPost);
  const pot = sbPost + bbPost;
  const currentBet = Math.max(sbPost, bbPost);

  const state: GameState = {
    handId,
    deck,
    board: [],
    players,
    button,
    blindSchedule: schedule,
    smallBlind,
    bigBlind,
    pot,
    street: 'preflop',
    currentBet,
    minRaiseTo: currentBet + bigBlind, // minimum legal raise total
    lastRaiseSize: bigBlind,
    lastAggressor: null,
    hasActedThisRound: { wes: false, moltfire: false },
    currentActor: sb, // heads-up preflop: SB/button acts first
    actionHistory: [],
    handComplete: false,
  };

  // If either player is already all-in from the blind (rare with normal stacks),
  // skip straight to runout. Not expected for default 10k/50/100, but safe.
  maybeAdvanceForAllIn(state);
  return state;
}

function emptyPlayer(id: PlayerId, stack: number): PlayerState {
  return {
    id,
    stack,
    committedThisStreet: 0,
    committedThisHand: 0,
    holeCards: [],
    folded: false,
    allIn: false,
  };
}

function commit(p: PlayerState, amount: number): void {
  const real = Math.min(amount, p.stack);
  p.stack -= real;
  p.committedThisStreet += real;
  p.committedThisHand += real;
  if (p.stack === 0) p.allIn = true;
}

// Applies an action mutating `state`. Throws on illegal action — callers
// should call validateAction first to convert to a user-facing error.
export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: PlayerAction,
): void {
  const err = validateAction(state, playerId, action);
  if (err) throw new Error(err);

  const me = state.players[playerId];
  switch (action.type) {
    case 'fold': {
      me.folded = true;
      pushAction(state, playerId, action);
      finishHandByFold(state, OTHER[playerId]);
      return;
    }
    case 'check': {
      state.hasActedThisRound[playerId] = true;
      pushAction(state, playerId, action);
      break;
    }
    case 'call': {
      const toCall = state.currentBet - me.committedThisStreet;
      commit(me, toCall); // clamps to stack — short call goes all-in for less
      state.pot = computePot(state);
      state.hasActedThisRound[playerId] = true;
      pushAction(state, playerId, action);
      break;
    }
    case 'bet': {
      const delta = action.amount - me.committedThisStreet;
      commit(me, delta);
      state.pot = computePot(state);
      const raiseSize = action.amount - state.currentBet;
      state.currentBet = action.amount;
      state.lastRaiseSize = Math.max(state.lastRaiseSize, raiseSize);
      state.minRaiseTo = state.currentBet + state.lastRaiseSize;
      state.lastAggressor = playerId;
      // A new bet reopens action: opponent has not yet acted on this new bet.
      state.hasActedThisRound = { wes: false, moltfire: false };
      state.hasActedThisRound[playerId] = true;
      pushAction(state, playerId, action);
      break;
    }
    case 'raise': {
      const delta = action.amount - me.committedThisStreet;
      commit(me, delta);
      state.pot = computePot(state);
      const raiseSize = action.amount - state.currentBet;
      const isFullRaise = raiseSize >= state.lastRaiseSize;
      state.currentBet = action.amount;
      if (isFullRaise) {
        state.lastRaiseSize = raiseSize;
        state.minRaiseTo = state.currentBet + state.lastRaiseSize;
        state.lastAggressor = playerId;
        state.hasActedThisRound = { wes: false, moltfire: false };
        state.hasActedThisRound[playerId] = true;
      } else {
        // Short all-in raise: does not reopen action for a prior aggressor who
        // has already matched. In heads-up MVP we still mark me acted; opponent
        // must still act on the new amount (they always have less committed).
        state.hasActedThisRound[playerId] = true;
        // Opponent must respond to the raise to a higher amount.
        state.hasActedThisRound[OTHER[playerId]] = false;
        state.lastAggressor = playerId;
      }
      pushAction(state, playerId, action);
      break;
    }
  }

  if (state.handComplete) return;

  if (isBettingRoundComplete(state)) {
    advanceStreet(state);
  } else {
    state.currentActor = OTHER[playerId];
  }
}

function pushAction(state: GameState, playerId: PlayerId, action: PlayerAction): void {
  const record: ActionRecord = {
    handId: state.handId,
    street: state.street,
    player: playerId,
    action,
    committedAfter: state.players[playerId].committedThisStreet,
    potAfter: state.pot,
  };
  state.actionHistory.push(record);
}

function computePot(state: GameState): number {
  return state.players.wes.committedThisHand + state.players.moltfire.committedThisHand;
}

function isBettingRoundComplete(state: GameState): boolean {
  const wes = state.players.wes;
  const molt = state.players.moltfire;
  if (wes.folded || molt.folded) return true;
  const wesCanAct = canStillAct(wes, state.currentBet, state.hasActedThisRound.wes);
  const moltCanAct = canStillAct(molt, state.currentBet, state.hasActedThisRound.moltfire);
  return !wesCanAct && !moltCanAct;
}

function canStillAct(p: PlayerState, currentBet: number, hasActed: boolean): boolean {
  if (p.folded || p.allIn) return false;
  // Owes chips to match the bet → must call/raise/fold.
  if (p.committedThisStreet < currentBet) return true;
  // Matched but never acted (e.g. BB option preflop, or first-to-act on a new street).
  return !hasActed;
}

// If commitments on the street don't match (because someone went all-in for
// less than the call), refund the uncalled excess to the player who over-bet.
function refundUncalledBet(state: GameState): void {
  const wes = state.players.wes;
  const molt = state.players.moltfire;
  const diff = wes.committedThisStreet - molt.committedThisStreet;
  if (diff === 0) return;
  if (diff > 0) {
    wes.stack += diff;
    wes.committedThisStreet -= diff;
    wes.committedThisHand -= diff;
  } else {
    const amt = -diff;
    molt.stack += amt;
    molt.committedThisStreet -= amt;
    molt.committedThisHand -= amt;
  }
  state.pot = computePot(state);
}

function advanceStreet(state: GameState): void {
  // If the betting round ended with mismatched commitments (someone all-in
  // for less than the call), refund the uncalled excess before moving on.
  refundUncalledBet(state);
  // Reset per-street state.
  state.players.wes.committedThisStreet = 0;
  state.players.moltfire.committedThisStreet = 0;
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.minRaiseTo = state.bigBlind;
  state.lastAggressor = null;
  state.hasActedThisRound = { wes: false, moltfire: false };

  switch (state.street) {
    case 'preflop':
      dealBoard(state, 3);
      state.street = 'flop';
      break;
    case 'flop':
      dealBoard(state, 1);
      state.street = 'turn';
      break;
    case 'turn':
      dealBoard(state, 1);
      state.street = 'river';
      break;
    case 'river':
      runShowdown(state);
      return;
    case 'showdown':
    case 'complete':
      return;
  }

  // Postflop heads-up: non-button (BB) acts first.
  const bb = OTHER[state.button];
  state.currentActor = bb;
  maybeAdvanceForAllIn(state);
}

function dealBoard(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    const card = state.deck.pop();
    if (!card) throw new Error('Deck exhausted dealing board.');
    state.board.push(card);
  }
}

// If both players are already all-in (or one is all-in and the other has
// matched), there is no further action this street: deal remaining streets
// straight through to showdown.
function maybeAdvanceForAllIn(state: GameState): void {
  if (state.handComplete) return;
  const wes = state.players.wes;
  const molt = state.players.moltfire;
  const noFurtherAction =
    (wes.allIn || molt.allIn) &&
    wes.committedThisStreet === molt.committedThisStreet;
  if (!noFurtherAction) return;
  state.currentActor = null;
  // Run out the remaining board streets without action.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.street === 'preflop') {
      dealBoard(state, 3);
      state.street = 'flop';
    } else if (state.street === 'flop') {
      dealBoard(state, 1);
      state.street = 'turn';
    } else if (state.street === 'turn') {
      dealBoard(state, 1);
      state.street = 'river';
    } else if (state.street === 'river') {
      runShowdown(state);
      return;
    } else {
      return;
    }
  }
}

function finishHandByFold(state: GameState, winner: PlayerId): void {
  state.currentActor = null;
  state.players[winner].stack += state.pot;
  const result: HandResult = {
    winner,
    reason: 'fold',
    potAwarded: state.pot,
    // On a fold, we do NOT reveal the folder's hole cards.
    reveal: {
      wes: winner === 'wes' ? state.players.wes.holeCards : [],
      moltfire: winner === 'moltfire' ? state.players.moltfire.holeCards : [],
    },
  };
  state.result = result;
  state.street = 'complete';
  state.handComplete = true;
}

function runShowdown(state: GameState): void {
  state.currentActor = null;
  state.street = 'showdown';

  const wesEval = evaluateBestHand([...state.players.wes.holeCards, ...state.board]);
  const moltEval = evaluateBestHand([...state.players.moltfire.holeCards, ...state.board]);
  const cmp = compareHands(wesEval, moltEval);

  let winner: PlayerId | 'tie';
  if (cmp > 0) winner = 'wes';
  else if (cmp < 0) winner = 'moltfire';
  else winner = 'tie';

  let potAwarded = state.pot;
  if (winner === 'tie') {
    // Split pot. Odd chip goes to the player out of position (non-button).
    const half = Math.floor(state.pot / 2);
    const remainder = state.pot - half * 2;
    state.players.wes.stack += half;
    state.players.moltfire.stack += half;
    if (remainder > 0) {
      state.players[OTHER[state.button]].stack += remainder;
    }
    potAwarded = state.pot;
  } else {
    state.players[winner].stack += state.pot;
  }

  state.result = {
    winner,
    reason: 'showdown',
    potAwarded,
    reveal: {
      wes: state.players.wes.holeCards,
      moltfire: state.players.moltfire.holeCards,
    },
    showdown: { wes: wesEval, moltfire: moltEval },
  };
  state.street = 'complete';
  state.handComplete = true;
}

// Test-only export used to introspect betting-round logic.
export const _internals = { isBettingRoundComplete };
