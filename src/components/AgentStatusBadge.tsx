import type { AgentStatus } from '../../shared/view-models';

type Props = {
  status?: AgentStatus;
  // True when it's the opponent's turn; UI uses this to render "thinking…".
  moltfireToAct: boolean;
  // Display name for the opponent (resolved from OpponentProfile upstream).
  opponentName?: string;
};

export function AgentStatusBadge({ status, moltfireToAct, opponentName }: Props) {
  if (!status || !status.connected) {
    return (
      <div className="agent-badge agent-offline">
        <span className="agent-dot" />
        Agent offline
      </div>
    );
  }
  const who = opponentName ? `${opponentName} · ` : '';
  const strategyLabel =
    status.strategy === 'openclaw-bridge'
      ? `${who}OpenClaw`
      : status.strategy === 'fast-live'
      ? `${who}Fast`
      : status.strategy === 'llm'
      ? `${who}LLM`
      : status.strategy === 'rules'
      ? `${who || ''}Rule bot`
      : `${who || ''}Agent`;

  return (
    <div className="agent-badge agent-online">
      <span className="agent-dot agent-dot-online" />
      <span className="agent-strategy">{strategyLabel}</span>
      {moltfireToAct && <span className="agent-thinking">thinking…</span>}
    </div>
  );
}
