import type { BlindDisplay } from '../../shared/blinds';

type Props = {
  handId: number;
  tournament: BlindDisplay;
};

// Slim header that mirrors the "tournament info" strip on real poker clients.
// Shows level, current blinds, and how soon the next level kicks in.
export function TournamentHeader({ handId, tournament }: Props) {
  const t = tournament;
  let countdown: string;
  if (t.nextLevel === null) {
    countdown = 'max level';
  } else if (t.handsUntilNextLevel === 1) {
    countdown = 'next hand';
  } else {
    countdown = `next in ${t.handsUntilNextLevel} hands`;
  }
  return (
    <div className="tournament-header">
      <div className="tournament-cell">
        <div className="tournament-label">Level</div>
        <div className="tournament-value">{t.level}</div>
      </div>
      <div className="tournament-cell">
        <div className="tournament-label">Blinds</div>
        <div className="tournament-value">{t.smallBlind} / {t.bigBlind}</div>
      </div>
      <div className="tournament-cell">
        <div className="tournament-label">Next level</div>
        <div className="tournament-value tournament-next">
          {t.nextLevel !== null ? `${t.nextSmallBlind} / ${t.nextBigBlind}` : '—'}
          <span className="tournament-countdown">{countdown}</span>
        </div>
      </div>
      <div className="tournament-cell tournament-cell-hand">
        <div className="tournament-label">Hand</div>
        <div className="tournament-value">#{handId}</div>
      </div>
    </div>
  );
}
