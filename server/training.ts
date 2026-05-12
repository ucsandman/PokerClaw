import type { ActionRecord, Card, GameState, HandResult, PlayerId } from '../shared/types';

// Per-hand snapshot stored in the training buffer. Carries enough public state
// for the reviewer to reconstruct the hand. Hole cards follow the same privacy
// rules as the live view-model:
//   - Wes's hole cards are always included (the student needs to study their
//     own play).
//   - MoltFire's hole cards are included ONLY when revealed at showdown.
export type HandSnapshot = {
  handId: number;
  button: PlayerId;
  smallBlind: number;
  bigBlind: number;
  startingStacks: Record<PlayerId, number>;
  endingStacks: Record<PlayerId, number>;
  wesHoleCards: Card[];
  moltfireHoleCards: Card[] | null;
  board: Card[];
  actionHistory: ActionRecord[];
  result: HandResult;
};

// Public summary the UI consumes — never contains card data.
export type TrainingStatus = {
  active: boolean;
  startedAt: number | null;
  handCount: number;
};

// Active training buffer. Lives on the Session — discarded on reset.
export class TrainingSession {
  private active = false;
  private startedAt: number | null = null;
  private hands: HandSnapshot[] = [];
  private captured = new Set<number>();

  start(): void {
    this.active = true;
    this.startedAt = Date.now();
    this.hands = [];
    this.captured.clear();
  }

  // Returns the captured buffer and clears active state. The buffer remains
  // available for /api/training/review until a subsequent start() wipes it.
  end(): HandSnapshot[] {
    this.active = false;
    return [...this.hands];
  }

  status(): TrainingStatus {
    return {
      active: this.active,
      startedAt: this.startedAt,
      handCount: this.hands.length,
    };
  }

  buffer(): HandSnapshot[] {
    return [...this.hands];
  }

  // Snapshots the just-completed hand from `state`. No-op if training is not
  // active, if the hand is not complete, or if this handId was already
  // captured (defensive against double-capture from multiple call sites).
  captureIfComplete(state: GameState, startingStacks: Record<PlayerId, number>): void {
    if (!this.active) return;
    if (!state.handComplete || !state.result) return;
    if (this.captured.has(state.handId)) return;
    this.captured.add(state.handId);

    // Privacy: include MoltFire's hole cards ONLY when they were revealed at
    // showdown. result.reveal is populated by the engine based on the
    // hand-end path (showdown reveals both, fold reveals only the caller).
    const reveal = state.result.reveal;
    const moltShown = Array.isArray(reveal?.moltfire) && reveal.moltfire.length > 0;

    this.hands.push({
      handId: state.handId,
      button: state.button,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      startingStacks: { ...startingStacks },
      endingStacks: {
        wes: state.players.wes.stack,
        moltfire: state.players.moltfire.stack,
      },
      wesHoleCards: state.players.wes.holeCards.map((c) => ({ ...c })),
      moltfireHoleCards: moltShown
        ? state.players.moltfire.holeCards.map((c) => ({ ...c }))
        : null,
      board: state.board.map((c) => ({ ...c })),
      actionHistory: state.actionHistory.map((r) => ({ ...r, action: { ...r.action } })),
      result: {
        ...state.result,
        reveal: {
          wes: (reveal.wes ?? []).map((c) => ({ ...c })),
          moltfire: (reveal.moltfire ?? []).map((c) => ({ ...c })),
        },
      },
    });
  }
}
