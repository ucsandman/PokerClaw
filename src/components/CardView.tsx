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

const RED_SUITS = new Set<Card['suit']>(['d', 'h']);

export function CardView({ card }: { card: CardOrHidden }) {
  if (isHidden(card)) {
    return <div className="card card-back" aria-label="hidden card" />;
  }
  const red = RED_SUITS.has(card.suit);
  return (
    <div className={`card ${red ? 'red' : 'black'}`} aria-label={`${card.rank}${card.suit}`}>
      <div className="card-rank">{card.rank}</div>
      <div className="card-suit">{SUIT_GLYPH[card.suit]}</div>
    </div>
  );
}
