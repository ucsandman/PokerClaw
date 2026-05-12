import type { HandRankCategory, HandResult } from '../../shared/types';
import { ChipStack } from './ChipStack';

const CATEGORY_LABEL: Record<HandRankCategory, string> = {
  'high-card': 'High card',
  'pair': 'Pair',
  'two-pair': 'Two pair',
  'trips': 'Three of a kind',
  'straight': 'Straight',
  'flush': 'Flush',
  'full-house': 'Full house',
  'quads': 'Four of a kind',
  'straight-flush': 'Straight flush',
};

function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

export function ResultBanner({
  result,
  opponentName = 'Opponent',
}: {
  result: HandResult;
  opponentName?: string;
}) {
  const isTie = result.winner === 'tie';
  const who = result.winner === 'wes' ? 'Wes' : result.winner === 'moltfire' ? opponentName : null;
  const reasonLabel = result.reason === 'fold' ? 'Won uncontested' : 'Showdown';

  const showdown = result.showdown;

  return (
    <div className="result-banner">
      <div className="result-banner-bar" />
      <div className="result-banner-body">
        <div className="result-banner-left">
          <ChipStack amount={result.potAwarded} variant="pot" />
        </div>
        <div className="result-banner-center">
          <div className="result-eyebrow">{reasonLabel}</div>
          <div className="result-headline">
            {isTie ? 'Split pot' : `${who} wins`}
            <span className="result-amount"> {fmtChips(result.potAwarded)} chips</span>
          </div>
          {showdown && (
            <div className="result-detail">
              <span className="result-detail-side">
                <span className="result-detail-name">Wes</span>
                <span className="result-detail-cat">
                  {CATEGORY_LABEL[showdown.wes.category]}
                </span>
              </span>
              <span className="result-detail-sep" aria-hidden="true">vs</span>
              <span className="result-detail-side">
                <span className="result-detail-name">{opponentName}</span>
                <span className="result-detail-cat">
                  {CATEGORY_LABEL[showdown.moltfire.category]}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
