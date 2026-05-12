import type { PlayerId } from '../../shared/types';

type Props = {
  player: PlayerId;
  size?: 'sm' | 'md';
  active?: boolean;
};

// Pure-CSS avatars. Wes is a calm blue/gold human placeholder; MoltFire is
// the ember/orange "AI flame" placeholder. No external image assets are used
// per the local-only constraint — all visuals are CSS gradients.
export function Avatar({ player, size = 'md', active = false }: Props) {
  const isWes = player === 'wes';
  const cls = [
    'avatar',
    `avatar-${size}`,
    isWes ? 'avatar-wes' : 'avatar-moltfire',
    active ? 'avatar-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} aria-label={isWes ? 'Wes avatar' : 'MoltFire avatar'}>
      <span className="avatar-glyph">{isWes ? 'W' : '🔥'}</span>
    </div>
  );
}
