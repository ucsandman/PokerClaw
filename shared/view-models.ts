import type {
  ActionRecord,
  Card,
  GameState,
  HandResult,
  PlayerId,
  PlayerState,
  Street,
} from './types';
import { legalActionsFor, type LegalActions } from './actions';
import { getBlindDisplay, type BlindDisplay } from './blinds';

// Snapshot of the locally-running MoltFire agent. Populated by the server
// when the agent posts a heartbeat to /api/agent/status. Optional everywhere
// — the UI degrades gracefully if no agent is connected.
export type AgentStatus = {
  connected: boolean;             // false when heartbeat is stale
  strategy: 'fast-live' | 'openclaw-bridge' | 'llm' | 'rules' | 'unknown';
  provider?: 'anthropic' | 'openai-compatible';
  model?: string;
  mode: 'match' | 'training' | 'debug';
  // Dedicated MoltFire OpenClaw session label, present only when the
  // openclaw-bridge strategy is configured.
  sessionLabel?: string;
  // ISO timestamp of the last heartbeat the server saw.
  lastHeartbeat?: string;
};

// Per-player public view of an opponent. Hole cards are present only when
// authorized for reveal (showdown or hand-end reveal).
export type OpponentView = {
  id: PlayerId;
  stack: number;
  committedThisStreet: number;
  committedThisHand: number;
  folded: boolean;
  allIn: boolean;
  // Two cards when revealed at showdown; otherwise an array of "back" markers
  // matching the count of cards the opponent actually holds. The view never
  // contains real card data before reveal.
  cards: Array<Card | { hidden: true }>;
};

export type SelfView = Omit<OpponentView, 'cards'> & {
  cards: Card[];
};

export type PlayerView = {
  handId: number;
  street: Street;
  board: Card[];
  pot: number;
  smallBlind: number;
  bigBlind: number;
  button: PlayerId;
  currentBet: number;
  minRaiseTo: number;
  currentActor: PlayerId | null;
  you: SelfView;
  opponent: OpponentView;
  actionHistory: ActionRecord[];
  legalActions: LegalActions | null;
  handComplete: boolean;
  result?: HandResult;
  // Current blind-level info + countdown to next level. Public, safe.
  tournament: BlindDisplay;
  // Live status of the MoltFire agent. Public, safe.
  agentStatus?: AgentStatus;
  // Active training-session status (UI toggle + hand counter). Optional —
  // older clients ignore the field gracefully. Card-free by construction.
  training?: TrainingStatusPublic;
  // Display profile for the opponent. UI renders name + emoji + theme from
  // this field. Falls back to a generic "Opponent" when absent.
  opponentProfile?: OpponentProfile;
};

// Public training status carried on the view. No card data, no deck info.
// Mirrors server/training.ts:TrainingStatus but kept in shared so the UI can
// import without depending on server code.
export type TrainingStatusPublic = {
  active: boolean;
  startedAt: number | null;
  handCount: number;
};

// Display profile for the opponent (the non-Wes seat). Resolved from
// environment variables on the server — populated automatically from the
// configured OpenClaw agent's identity when the openclaw-bridge strategy
// is active, or falls back to strategy-appropriate defaults (e.g. "Rule Bot"
// in rules mode, the model name in fast-live mode).
export type OpponentProfile = {
  name: string;
  emoji?: string;
  // Free-form theme color hint from OpenClaw's set-identity (e.g. "red").
  // The UI maps it to a CSS variable when it recognizes the name.
  theme?: string;
  // Optional avatar URL or data URI. The UI falls back to the CSS-only
  // avatar (or the emoji) when absent.
  avatarUrl?: string;
  // Where the profile came from. Useful for the UI to show a small badge
  // ("from your OpenClaw agent") and for tests.
  source: 'openclaw' | 'config' | 'default';
};

// Optional second-argument to viewForPlayer carrying ambient session info
// the engine itself doesn't track.
export type ViewContext = {
  agentStatus?: AgentStatus;
  training?: TrainingStatusPublic;
  opponentProfile?: OpponentProfile;
};

// Returns the authorized view of the game state for `viewer`. Never returns
// the opponent's hole cards, deck order, or any future board cards.
//
// The implementation does NOT include `state.deck` in the output object at
// all. This keeps deck order off the wire even if a future change forgets to
// strip it explicitly.
export function viewForPlayer(
  state: GameState,
  viewer: PlayerId,
  ctx: ViewContext = {},
): PlayerView {
  const me = state.players[viewer];
  const opp = state.players[viewer === 'wes' ? 'moltfire' : 'wes'];

  const revealOpponent = shouldRevealHoleCards(state, opp);

  const opponentCards: Array<Card | { hidden: true }> = revealOpponent
    ? opp.holeCards.slice()
    : opp.holeCards.map(() => ({ hidden: true as const }));

  return {
    handId: state.handId,
    street: state.street,
    // board is intentionally the cards already on the table. Future board
    // cards are still in state.deck and NEVER copied here.
    board: state.board.slice(),
    pot: state.pot,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    button: state.button,
    currentBet: state.currentBet,
    minRaiseTo: state.minRaiseTo,
    currentActor: state.currentActor,
    you: selfView(me),
    opponent: {
      id: opp.id,
      stack: opp.stack,
      committedThisStreet: opp.committedThisStreet,
      committedThisHand: opp.committedThisHand,
      folded: opp.folded,
      allIn: opp.allIn,
      cards: opponentCards,
    },
    actionHistory: state.actionHistory.slice(),
    legalActions: legalActionsFor(state, viewer),
    handComplete: state.handComplete,
    result: state.result,
    tournament: getBlindDisplay(state.handId, state.blindSchedule),
    agentStatus: ctx.agentStatus,
    training: ctx.training,
    opponentProfile: ctx.opponentProfile,
  };
}

function selfView(p: PlayerState): SelfView {
  return {
    id: p.id,
    stack: p.stack,
    committedThisStreet: p.committedThisStreet,
    committedThisHand: p.committedThisHand,
    folded: p.folded,
    allIn: p.allIn,
    cards: p.holeCards.slice(),
  };
}

function shouldRevealHoleCards(state: GameState, opponent: PlayerState): boolean {
  if (!state.handComplete) return false;
  if (!state.result) return false;
  // On a fold the loser's cards are NOT revealed. result.reveal stores the
  // canonical reveal set for each player.
  return state.result.reveal[opponent.id].length > 0;
}
