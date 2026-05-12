import type { Card, Rank, Suit } from './types';

export const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
] as const;

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'] as const;

// Numeric value used for hand evaluation. Ace is 14 (and synthetically 1 for wheels).
export function rankValue(r: Rank): number {
  switch (r) {
    case '2': return 2;
    case '3': return 3;
    case '4': return 4;
    case '5': return 5;
    case '6': return 6;
    case '7': return 7;
    case '8': return 8;
    case '9': return 9;
    case 'T': return 10;
    case 'J': return 11;
    case 'Q': return 12;
    case 'K': return 13;
    case 'A': return 14;
  }
}

export function cardId(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`Invalid card string: ${s}`);
  const rank = s[0] as Rank;
  const suit = s[1] as Suit;
  if (!RANKS.includes(rank)) throw new Error(`Invalid rank: ${s}`);
  if (!SUITS.includes(suit)) throw new Error(`Invalid suit: ${s}`);
  return { rank, suit };
}
