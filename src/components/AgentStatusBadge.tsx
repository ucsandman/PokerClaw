import type { AgentStatus } from '../../shared/view-models';

type Props = {
  status?: AgentStatus;
  // True when it's MoltFire's turn; UI uses this to render "thinking…".
  moltfireToAct: boolean;
};

export function AgentStatusBadge({ status, moltfireToAct }: Props) {
  if (!status || !status.connected) {
    return (
      <div className="agent-badge agent-offline">
        <span className="agent-dot" />
        Agent offline
      </div>
    );
  }
  const strategyLabel =
    status.strategy === 'openclaw-bridge'
      ? `OpenClaw · ${status.sessionLabel ?? 'moltfire-pokerclaw'}`
      : status.strategy === 'fast-live'
      ? `Fast · ${status.model ?? status.provider ?? 'model'}`
      : status.strategy === 'llm'
      ? `LLM · ${status.provider ?? 'unknown'}`
      : status.strategy === 'rules'
      ? 'Rule bot'
      : 'Agent';

  return (
    <div className="agent-badge agent-online">
      <span className="agent-dot agent-dot-online" />
      <span className="agent-strategy">{strategyLabel}</span>
      {moltfireToAct && <span className="agent-thinking">thinking…</span>}
    </div>
  );
}
