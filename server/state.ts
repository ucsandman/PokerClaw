import type { GameState, PlayerAction, PlayerId, SessionConfig } from '../shared/types';
import { applyAction, startSession, startNewHand } from '../shared/game';
import type { AgentStatus } from '../shared/view-models';
import { TrainingSession, type HandSnapshot, type TrainingStatus } from './training';

// Heartbeats older than this are considered stale (the agent has stopped or
// crashed). Picked to be ~3-4x the agent's default poll interval.
const AGENT_HEARTBEAT_TTL_MS = 5000;

// Trusted-dealer in-memory session. Holds the live GameState and exposes a
// narrow surface so route handlers cannot accidentally leak full state.
//
// Nothing here writes the live deck or hidden hole cards to disk or logs.
export class Session {
  private state: GameState;
  private readonly config: SessionConfig;
  private lastAgentStatus: AgentStatus | null = null;
  private lastAgentHeartbeatAt = 0;
  private readonly training = new TrainingSession();
  // Stacks at the start of the current hand. Snapshotting needs them so the
  // reviewer can see how each hand began (the engine only keeps current state).
  private handStartingStacks: Record<PlayerId, number>;

  constructor(config: SessionConfig) {
    this.config = config;
    this.state = startSession(config);
    this.handStartingStacks = this.captureStartingStacks();
  }

  private captureStartingStacks(): Record<PlayerId, number> {
    return {
      wes: this.state.players.wes.stack + this.state.players.wes.committedThisHand,
      moltfire:
        this.state.players.moltfire.stack + this.state.players.moltfire.committedThisHand,
    };
  }

  // Authorized read access for view-models. The caller (route handler) is
  // expected to pipe this through viewForPlayer to scrub hidden info.
  rawState(): GameState {
    return this.state;
  }

  applyPlayerAction(playerId: PlayerId, action: PlayerAction): void {
    applyAction(this.state, playerId, action);
    // The action may have completed the hand (fold or final showdown). Capture
    // into the training buffer if so.
    if (this.state.handComplete) {
      this.training.captureIfComplete(this.state, this.handStartingStacks);
    }
  }

  startNextHand(): void {
    if (!this.state.handComplete) {
      throw new Error('Current hand is still in progress.');
    }
    // Defensive: snapshot the just-completed hand in case it hasn't been
    // captured yet (e.g. action came from a path that bypassed
    // applyPlayerAction). No-op if already captured.
    this.training.captureIfComplete(this.state, this.handStartingStacks);
    this.state = startNewHand(this.state);
    this.handStartingStacks = this.captureStartingStacks();
  }

  reset(): void {
    this.state = startSession(this.config);
    this.handStartingStacks = this.captureStartingStacks();
  }

  // ---- Training session --------------------------------------------------

  startTraining(): void {
    this.training.start();
  }

  endTraining(): HandSnapshot[] {
    // Catch the in-flight hand if it happens to be complete and not yet
    // captured. Mid-hand state is intentionally NOT included — a half-played
    // hand is not reviewable.
    if (this.state.handComplete) {
      this.training.captureIfComplete(this.state, this.handStartingStacks);
    }
    return this.training.end();
  }

  trainingBuffer(): HandSnapshot[] {
    return this.training.buffer();
  }

  trainingStatus(): TrainingStatus {
    return this.training.status();
  }

  // ---- Agent status ------------------------------------------------------

  recordAgentHeartbeat(status: AgentStatus): void {
    this.lastAgentStatus = status;
    this.lastAgentHeartbeatAt = Date.now();
  }

  // Returns the current agent status with `connected` recomputed against
  // the heartbeat TTL. Returns undefined if no heartbeat has ever arrived.
  getAgentStatus(): AgentStatus | undefined {
    if (!this.lastAgentStatus) return undefined;
    const fresh = Date.now() - this.lastAgentHeartbeatAt <= AGENT_HEARTBEAT_TTL_MS;
    return { ...this.lastAgentStatus, connected: fresh };
  }
}
