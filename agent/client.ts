import type { PlayerAction } from '../shared/types';
import type { AgentStatus, PlayerView } from '../shared/view-models';

// Thin HTTP client. The agent communicates with the dealer through the
// public state/action endpoints, plus a heartbeat endpoint so the UI can
// show what strategy is driving MoltFire and whether the agent is online.
export class AgentClient {
  constructor(private readonly baseUrl: string) {}

  async getState(): Promise<PlayerView> {
    const res = await fetch(`${this.baseUrl}/api/ai/state`);
    if (!res.ok) throw new Error(`state ${res.status}`);
    return (await res.json()) as PlayerView;
  }

  async postAction(action: PlayerAction): Promise<PlayerView> {
    const res = await fetch(`${this.baseUrl}/api/ai/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: string }).error ?? `action ${res.status}`);
    }
    return body as PlayerView;
  }

  // Lightweight fire-and-forget heartbeat. Errors are swallowed because the
  // agent should keep playing even if the dealer briefly disagrees about
  // status.
  async postStatus(status: Omit<AgentStatus, 'connected' | 'lastHeartbeat'>): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/agent/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status),
      });
    } catch {
      // ignore — heartbeat is best-effort
    }
  }
}
