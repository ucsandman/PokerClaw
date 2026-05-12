import type { Card } from '../../shared/types';

type CardOrHidden = Card | { hidden: true };

function isHidden(c: CardOrHidden): c is { hidden: true } {
  return (c as { hidden?: boolean }).hidden === true;
}

const SUIT_GLYPH: Record<Card['suit'], string> = {
  c: '♣',
  d: '♦',
  h: '♥',
  s: '♠',
};

// 4-color deck convention: each suit gets its own color so suits are
// distinguishable at a glance without reading the glyph.
//   spades   = black/dark slate
//   hearts   = red
//   diamonds = blue
//   clubs    = green
const SUIT_CLASS: Record<Card['suit'], string> = {
  s: 'suit-spade',
  h: 'suit-heart',
  d: 'suit-diamond',
  c: 'suit-club',
};

export function CardView({ card }: { card: CardOrHidden }) {
  if (isHidden(card)) {
    return <div className="card card-back" aria-label="hidden card" />;
  }
  return (
    <div
      className={`card ${SUIT_CLASS[card.suit]}`}
      aria-label={`${card.rank}${card.suit}`}
    >
      <div className="card-rank">{card.rank}</div>
      <div className="card-suit">{SUIT_GLYPH[card.suit]}</div>
    </div>
  );
}
