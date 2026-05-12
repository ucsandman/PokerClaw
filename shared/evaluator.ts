import type { Card, HandRankCategory, HandRankDescription, Suit } from './types';
import { rankValue } from './cards';

// Evaluates the best 5-card hand out of any 5..7 cards. Returns a description
// with a comparable rank vector and the five cards making up the best hand.
//
// Rank-vector convention: [category, ...tiebreakers], compared lexicographically.
// Category numbers:
//   1 high-card, 2 pair, 3 two-pair, 4 trips, 5 straight,
//   6 flush, 7 full-house, 8 quads, 9 straight-flush.
export function evaluateBestHand(cards: Card[]): HandRankDescription {
  if (cards.length < 5) {
    throw new Error(`evaluateBestHand requires >=5 cards, got ${cards.length}`);
  }
  const sorted = cards.slice().sort((a, b) => rankValue(b.rank) - rankValue(a.rank));

  const bySuit = new Map<Suit, Card[]>();
  for (const c of sorted) {
    const list = bySuit.get(c.suit);
    if (list) list.push(c); else bySuit.set(c.suit, [c]);
  }

  // 1. Straight flush
  for (const suited of bySuit.values()) {
    if (suited.length >= 5) {
      const sf = findStraight(suited);
      if (sf) {
        return makeRank('straight-flush', [9, sf.high], sf.cards);
      }
    }
  }

  const byRank = new Map<number, Card[]>();
  for (const c of sorted) {
    const v = rankValue(c.rank);
    const list = byRank.get(v);
    if (list) list.push(c); else byRank.set(v, [c]);
  }
  // Groups sorted by count desc then rank desc.
  const groups = Array.from(byRank.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return b[0] - a[0];
  });

  // 2. Quads
  if (groups[0][1].length === 4) {
    const quadRank = groups[0][0];
    const quadCards = groups[0][1];
    const kicker = sorted.find((c) => rankValue(c.rank) !== quadRank)!;
    return makeRank('quads', [8, quadRank, rankValue(kicker.rank)], [...quadCards, kicker]);
  }

  // 3. Full house (trips + pair, or two trips collapsed)
  if (groups[0][1].length >= 3) {
    const tripRank = groups[0][0];
    const tripCards = groups[0][1].slice(0, 3);
    for (let i = 1; i < groups.length; i++) {
      if (groups[i][1].length >= 2) {
        const pairRank = groups[i][0];
        const pairCards = groups[i][1].slice(0, 2);
        return makeRank('full-house', [7, tripRank, pairRank], [...tripCards, ...pairCards]);
      }
    }
  }

  // 4. Flush
  for (const suited of bySuit.values()) {
    if (suited.length >= 5) {
      const top5 = suited.slice(0, 5);
      return makeRank('flush', [6, ...top5.map((c) => rankValue(c.rank))], top5);
    }
  }

  // 5. Straight
  const st = findStraight(sorted);
  if (st) {
    return makeRank('straight', [5, st.high], st.cards);
  }

  // 6. Trips
  if (groups[0][1].length === 3) {
    const tripRank = groups[0][0];
    const tripCards = groups[0][1];
    const kickers = sorted.filter((c) => rankValue(c.rank) !== tripRank).slice(0, 2);
    return makeRank(
      'trips',
      [4, tripRank, ...kickers.map((c) => rankValue(c.rank))],
      [...tripCards, ...kickers],
    );
  }

  // 7. Two pair
  if (groups[0][1].length === 2 && groups[1]?.[1].length === 2) {
    const p1 = groups[0][0];
    const p2 = groups[1][0];
    const p1Cards = groups[0][1];
    const p2Cards = groups[1][1];
    const kicker = sorted.find(
      (c) => rankValue(c.rank) !== p1 && rankValue(c.rank) !== p2,
    )!;
    return makeRank(
      'two-pair',
      [3, p1, p2, rankValue(kicker.rank)],
      [...p1Cards, ...p2Cards, kicker],
    );
  }

  // 8. Pair
  if (groups[0][1].length === 2) {
    const pairRank = groups[0][0];
    const pairCards = groups[0][1];
    const kickers = sorted.filter((c) => rankValue(c.rank) !== pairRank).slice(0, 3);
    return makeRank(
      'pair',
      [2, pairRank, ...kickers.map((c) => rankValue(c.rank))],
      [...pairCards, ...kickers],
    );
  }

  // 9. High card
  const top5 = sorted.slice(0, 5);
  return makeRank('high-card', [1, ...top5.map((c) => rankValue(c.rank))], top5);
}

// Returns -1, 0, or +1 comparing two hand descriptions.
export function compareHands(a: HandRankDescription, b: HandRankDescription): number {
  const len = Math.max(a.rank.length, b.rank.length);
  for (let i = 0; i < len; i++) {
    const av = a.rank[i] ?? 0;
    const bv = b.rank[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function makeRank(
  category: HandRankCategory,
  rank: number[],
  bestFive: Card[],
): HandRankDescription {
  return { category, rank, bestFive };
}

// Finds the best straight in a card list sorted high → low. Wheel (A-2-3-4-5)
// is handled by treating an ace as also a "1". Returns the high card value
// and the five cards making the straight, or null if no straight exists.
function findStraight(sortedDesc: Card[]): { high: number; cards: Card[] } | null {
  const firstOfRank = new Map<number, Card>();
  for (const c of sortedDesc) {
    const v = rankValue(c.rank);
    if (!firstOfRank.has(v)) firstOfRank.set(v, c);
  }
  const values = Array.from(firstOfRank.keys()).sort((a, b) => b - a);
  const withWheel = values.slice();
  if (values.includes(14)) withWheel.push(1);

  for (let i = 0; i <= withWheel.length - 5; i++) {
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (withWheel[i + k] - withWheel[i + k + 1] !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const high = withWheel[i];
      const seq = [withWheel[i], withWheel[i + 1], withWheel[i + 2], withWheel[i + 3], withWheel[i + 4]];
      const cards = seq.map((v) => firstOfRank.get(v === 1 ? 14 : v)!);
      return { high, cards };
    }
  }
  return null;
}
