import type { OpponentProfile } from '../shared/view-models';

// Resolves the opponent display profile from environment variables.
//
// Resolution order:
//   1. Explicit POKERCLAW_OPPONENT_NAME overrides everything.
//   2. POKERCLAW_OPPONENT_FROM_OPENCLAW carries the agent identity that the
//      launcher (poker.py) fetched at boot via `openclaw agents list --json`.
//      The launcher sets POKERCLAW_OPPONENT_NAME etc. directly when it has
//      values, so step 2 is really "the env was populated, so source=openclaw"
//      when this flag is set.
//   3. Strategy-appropriate default:
//        rules           → "Rule Bot"          🎲
//        fast-live       → model name          ⚡
//        openclaw-bridge → "OpenClaw Agent"    🦞 (when launcher couldn't fetch)
//        unset           → "Opponent"          🤖
//
// The returned profile is always defined — callers can rely on `name` being
// a non-empty string.
export function resolveOpponentProfile(env: NodeJS.ProcessEnv): OpponentProfile {
  const name = (env.POKERCLAW_OPPONENT_NAME ?? '').trim();
  const emoji = (env.POKERCLAW_OPPONENT_EMOJI ?? '').trim() || undefined;
  const theme = (env.POKERCLAW_OPPONENT_THEME ?? '').trim() || undefined;
  const avatarUrl = (env.POKERCLAW_OPPONENT_AVATAR ?? '').trim() || undefined;
  const fromOpenclaw =
    (env.POKERCLAW_OPPONENT_FROM_OPENCLAW ?? '').trim().toLowerCase() === 'true';

  if (name) {
    return {
      name,
      emoji,
      theme,
      avatarUrl,
      source: fromOpenclaw ? 'openclaw' : 'config',
    };
  }

  const strategy = (env.POKERCLAW_STRATEGY ?? '').trim().toLowerCase();
  if (strategy === 'rules') {
    return { name: 'Rule Bot', emoji: '🎲', theme: 'blue', source: 'default' };
  }
  if (strategy === 'fast-live') {
    const model =
      (env.POKERCLAW_FAST_MODEL ?? '').trim() ||
      (env.POKERCLAW_AGENT_MODEL ?? '').trim() ||
      'Fast Bot';
    return { name: model, emoji: '⚡', theme: 'gold', source: 'default' };
  }
  if (strategy === 'openclaw-bridge') {
    return { name: 'OpenClaw Agent', emoji: '🦞', theme: 'red', source: 'default' };
  }
  return { name: 'Opponent', emoji: '🤖', theme: 'gold', source: 'default' };
}
