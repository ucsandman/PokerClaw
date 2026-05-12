// Core domain types for PokerClaw. Kept dependency-free so server, UI, and
// tests can all import this module.

export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'T' | 'J' | 'Q' | 'K' | 'A';

export type Card = { rank: Rank; suit: Suit };

export type PlayerId = 'wes' | 'moltfire';

export type PlayerState = {
  id: PlayerId;
  stack: number;
  committedThisStreet: number;
  committedThisHand: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
};

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

// `amount` for bet/raise is the TOTAL committed for the current street
// after the action (not the delta from prior commitment).
export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number };

export type ActionRecord = {
  handId: number;
  street: Street;
  player: PlayerId;
  action: PlayerAction;
  // Total chips the actor has committed to the pot this street AFTER acting.
  committedAfter: number;
  // Pot size after the action was applied.
  potAfter: number;
};

export type HandResultReason = 'fold' | 'showdown';

export type HandResult = {
  winner: PlayerId | 'tie';
  reason: HandResultReason;
  potAwarded: number;
  // Revealed hole cards (only populated after the hand is complete).
  reveal: Record<PlayerId, Card[]>;
  // Best 5-card hand description, only on showdown.
  showdown?: {
    wes: HandRankDescription;
    moltfire: HandRankDescription;
  };
};

export type HandRankCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'quads'
  | 'straight-flush';

export type HandRankDescription = {
  category: HandRankCategory;
  // Numeric rank vector used for tie-breaking. Higher tuple wins lexicographically.
  rank: number[];
  // The five cards making up the best hand, ordered for display.
  bestFive: Card[];
};

export type GameState = {
  handId: number;
  // Trusted-server-only. NEVER expose through authorized views.
  deck: Card[];
  board: Card[];
  players: Record<PlayerId, PlayerState>;
  button: PlayerId;
  // Blind schedule consulted by startNewHand to set the next hand's blinds.
  // Stored on GameState so the engine is self-contained between hands.
  blindSchedule: import('./blinds').BlindSchedule;
  smallBlind: number;
  bigBlind: number;
  pot: number;
  street: Street;
  // Current bet to call on this street (max committedThisStreet across players).
  currentBet: number;
  // Total commitment a raise must reach to be legal, i.e. lastRaiseTo + lastRaiseSize.
  minRaiseTo: number;
  // The size of the most recent legal raise on this street. Used to compute minRaiseTo.
  lastRaiseSize: number;
  lastAggressor: PlayerId | null;
  // Whether the player has voluntarily acted in the current betting round.
  // Blind posting does NOT count as having acted (BB still has option preflop).
  hasActedThisRound: Record<PlayerId, boolean>;
  currentActor: PlayerId | null;
  actionHistory: ActionRecord[];
  handComplete: boolean;
  result?: HandResult;
};

export type SessionConfig = {
  startingStack: number;
  // Optional. When omitted, the engine uses DEFAULT_BLIND_SCHEDULE.
  // Tests can pass a single-level schedule to lock blinds in place.
  blindSchedule?: import('./blinds').BlindSchedule;
};

export const OTHER: Record<PlayerId, PlayerId> = {
  wes: 'moltfire',
  moltfire: 'wes',
};
