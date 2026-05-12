import type { AgentMode } from './types';
import type { PlayerView } from '../shared/view-models';
import type { PlayerAction } from '../shared/types';

// Safe logger. Never prints hole cards in `match` mode. In `training` mode
// hole cards are summarized as counts only. In `debug` mode they may be
// printed in full — `debug` MUST NOT be used when Wes can see the terminal.
export function logDecision(
  mode: AgentMode,
  view: PlayerView,
  action: PlayerAction,
  rationale: string,
  posted: boolean,
  strategy?: string,
  latencyMs?: number,
): void {
  const legal = view.legalActions
    ? Object.entries({
        fold: view.legalActions.fold,
        check: view.legalActions.check,
        call: view.legalActions.call,
        bet: view.legalActions.canBet,
        raise: view.legalActions.canRaise,
      })
        .filter(([, ok]) => ok)
        .map(([k]) => k)
        .join(',')
    : 'none';
  const base = [
    `hand=${view.handId}`,
    `street=${view.street}`,
    `pot=${view.pot}`,
    `currentBet=${view.currentBet}`,
    `legal=${legal}`,
    `action=${actionStr(action)}`,
    `source=${strategyToSource(strategy)}`,
  ];
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
    base.push(`latencyMs=${Math.max(0, Math.round(latencyMs))}`);
  }
  base.push(posted ? 'posted' : 'dry-run');
  if (mode === 'debug') {
    base.push(`holeCards=${view.you.cards.map((c) => `${c.rank}${c.suit}`).join('')}`);
    base.push(`rationale=${rationale}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[agent] ${base.join(' ')}`);
}

// Maps a strategy name to a single source-marker that makes it obvious in
// logs whether a real bridge call produced the action or fell back. Required
// because earlier launcher output was ambiguous: every action looked like
// "openclaw-bridge" simply because the chain was configured that way, even
// though /decide was returning 502 and the LLM/rules strategy was posting.
export function strategyToSource(strategy: string | undefined): string {
  if (!strategy) return 'unknown';
  switch (strategy) {
    case 'openclaw-bridge': return 'openclaw-bridge';
    case 'fast-live': return 'fast-live';
    case 'rules-shortcut': return 'rules-shortcut';
    case 'rules': return 'fallback-rules';
    case 'safe-fallback': return 'fallback-safe';
    case 'llm': return 'fallback-llm';
  }
  // Provider-specific llm strategies are named "llm:anthropic" / "llm:openai-compatible".
  if (strategy.startsWith('llm:')) return 'fallback-llm';
  return `fallback-${strategy}`;
}

export function logInfo(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[agent] ${message}`);
}

export function logError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[agent] error: ${msg}`);
}

function actionStr(a: PlayerAction): string {
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
      return a.type;
    case 'bet':
    case 'raise':
      return `${a.type}:${a.amount}`;
  }
}
