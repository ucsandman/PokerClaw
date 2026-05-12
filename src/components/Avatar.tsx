import type { PlayerId } from '../../shared/types';

type Props = {
  player: PlayerId;
  size?: 'sm' | 'md';
  active?: boolean;
  // For the opponent seat: glyph (emoji) + accessible name override + optional
  // image URL. When `avatarUrl` is set, an <img> renders inside the avatar
  // frame and the glyph is hidden. `theme` adds a theme-* class so the CSS
  // gradient retints to match the opponent's identity color.
  glyph?: string;
  ariaName?: string;
  avatarUrl?: string;
  theme?: string;
};

const KNOWN_AVATAR_THEMES = new Set(['red', 'blue', 'green', 'purple', 'gold']);

// Pure-CSS avatars. Wes is a calm blue/gold human placeholder; the opponent
// gets a CSS gradient with the opponent's emoji glyph (configured from
// OpenClaw's set-identity, or a strategy-default fallback). When the operator
// has set an avatar URL we render it as an <img> inside the same frame.
export function Avatar({
  player,
  size = 'md',
  active = false,
  glyph,
  ariaName,
  avatarUrl,
  theme,
}: Props) {
  const isWes = player === 'wes';
  const t = theme?.toLowerCase().trim();
  const themeCls = !isWes && t && KNOWN_AVATAR_THEMES.has(t) ? `theme-${t}` : '';
  const cls = [
    'avatar',
    `avatar-${size}`,
    isWes ? 'avatar-wes' : 'avatar-opponent',
    themeCls,
    active ? 'avatar-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const aria = ariaName ?? (isWes ? 'Wes avatar' : 'Opponent avatar');
  const displayGlyph = isWes ? 'W' : (glyph ?? '🤖');
  return (
    <div className={cls} aria-label={aria}>
      {avatarUrl && !isWes ? (
        <img className="avatar-img" src={avatarUrl} alt="" />
      ) : (
        <span className="avatar-glyph">{displayGlyph}</span>
      )}
    </div>
  );
}
