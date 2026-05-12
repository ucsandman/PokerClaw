import type { Card } from './types';
import { RANKS, SUITS } from './cards';

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

// Fisher-Yates shuffle. `rand` defaults to Math.random; tests can pass a seeded RNG.
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function shuffledDeck(rand: () => number = Math.random): Card[] {
  return shuffle(freshDeck(), rand);
}
