import { describe, it, expect } from 'vitest';
import { freshDeck, shuffle, shuffledDeck } from '../shared/deck';
import { cardId } from '../shared/cards';

describe('deck', () => {
  it('contains exactly 52 unique cards', () => {
    const d = freshDeck();
    expect(d.length).toBe(52);
    const ids = new Set(d.map(cardId));
    expect(ids.size).toBe(52);
  });

  it('shuffle preserves contents', () => {
    const d = shuffle(freshDeck(), seededRand(1));
    expect(d.length).toBe(52);
    expect(new Set(d.map(cardId)).size).toBe(52);
  });

  it('shuffledDeck produces a permutation', () => {
    const d = shuffledDeck(seededRand(7));
    const ids = d.map(cardId);
    const baseline = freshDeck().map(cardId);
    expect(new Set(ids)).toEqual(new Set(baseline));
  });
});

// Small mulberry32 RNG so deck shuffles are deterministic in tests.
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
