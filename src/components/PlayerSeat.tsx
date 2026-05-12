import type { PlayerId } from '../../shared/types';
import type { OpponentProfile, OpponentView, SelfView } from '../../shared/view-models';
import { CardView } from './CardView';
import { Avatar } from './Avatar';
import { ChipStack } from './ChipStack';
import { fmtBB } from '../fmt';

type Props = {
  label: string;
  player: PlayerId;
  seat: SelfView | OpponentView;
  isCurrentActor: boolean;
  isButton: boolean;
  isWinner: boolean;
  bigBlind: number;
  // Only set for the opponent seat — drives emoji, theme tint, and avatar URL.
  profile?: OpponentProfile;
};

// Format chip counts with thousands separators. Stable across locales.
function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

const KNOWN_THEMES = new Set(['red', 'blue', 'green', 'purple', 'gold']);

export function PlayerSeat({
  label,
  player,
  seat,
  isCurrentActor,
  isButton,
  isWinner,
  bigBlind,
  profile,
}: Props) {
  const theme = profile?.theme?.toLowerCase().trim();
  const themeClass = theme && KNOWN_THEMES.has(theme) ? `theme-${theme}` : '';
  const seatClass = [
    'seat',
    `seat-${player}`,
    isCurrentActor ? 'seat-active' : '',
    isWinner ? 'seat-winner' : '',
    seat.folded ? 'seat-folded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={seatClass}>
      <div className="seat-row seat-row-top">
        <div className="seat-identity">
          <Avatar
            player={player}
            active={isCurrentActor}
            glyph={profile?.emoji}
            ariaName={profile ? `${profile.name} avatar` : undefined}
            avatarUrl={profile?.avatarUrl}
            theme={profile?.theme}
          />
          <div className={`seat-name-block ${themeClass}`.trim()}>
            <span className="seat-name">{label}</span>
            <div className="seat-tags">
              {seat.folded && <span className="seat-tag tag-fold">FOLD</span>}
              {seat.allIn && <span className="seat-tag tag-allin">ALL-IN</span>}
              {isWinner && <span className="seat-tag tag-winner">WIN</span>}
            </div>
          </div>
        </div>
        <div className="seat-cards">
          {seat.cards.length === 0 ? (
            <div className="seat-cards-empty">—</div>
          ) : (
            seat.cards.map((c, i) => <CardView key={i} card={c} />)
          )}
        </div>
      </div>
      <div className="seat-row seat-row-stack">
        <div className="seat-stack">
          <div className="seat-stack-top">
            <ChipStack amount={seat.stack} variant="stack" />
            <span className="seat-stack-bb">{fmtBB(seat.stack, bigBlind)}</span>
          </div>
          <div className="seat-stack-chips">{fmtChips(seat.stack)} chips</div>
        </div>
        {isButton && (
          <div className="dealer-chip" aria-label="Dealer button">D</div>
        )}
        {seat.committedThisStreet > 0 && (
          <div className="seat-bet">
            <ChipStack amount={seat.committedThisStreet} variant="bet" />
            <div className="seat-bet-chip">
              <span className="seat-bet-amount">{fmtBB(seat.committedThisStreet, bigBlind)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
