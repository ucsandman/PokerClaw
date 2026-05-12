// Hand-count-based blind schedule for PokerClaw. Levels are determined by
// the hand number (handId), not wall-clock time, so local sessions are
// reproducible and easy to test.
//
// Each level entry says: "starting at this hand, the blinds are these".
// The next level entry's `fromHand` defines when the current level ends.

export type BlindLevel = {
  level: number;
  fromHand: number;     // first handId at which this level applies (1-indexed)
  smallBlind: number;
  bigBlind: number;
};

export type BlindSchedule = readonly BlindLevel[];

// Default tournament schedule (matches UI_POLISH_AND_TOURNAMENT_PASS.md).
export const DEFAULT_BLIND_SCHEDULE: BlindSchedule = [
  { level: 1, fromHand: 1,  smallBlind:  50, bigBlind:  100 },
  { level: 2, fromHand: 11, smallBlind:  75, bigBlind:  150 },
  { level: 3, fromHand: 21, smallBlind: 100, bigBlind:  200 },
  { level: 4, fromHand: 31, smallBlind: 150, bigBlind:  300 },
  { level: 5, fromHand: 41, smallBlind: 200, bigBlind:  400 },
  { level: 6, fromHand: 51, smallBlind: 300, bigBlind:  600 },
  { level: 7, fromHand: 61, smallBlind: 400, bigBlind:  800 },
  { level: 8, fromHand: 71, smallBlind: 500, bigBlind: 1000 },
];

// Returns the level entry that applies to `handId`.
// Hand IDs <= 0 collapse to level 1.
export function getBlindsForHand(
  handId: number,
  schedule: BlindSchedule = DEFAULT_BLIND_SCHEDULE,
): BlindLevel {
  const hand = Math.max(1, handId);
  let current = schedule[0];
  for (const level of schedule) {
    if (hand >= level.fromHand) current = level;
    else break;
  }
  return current;
}

export type BlindDisplay = {
  level: number;
  smallBlind: number;
  bigBlind: number;
  // null when there is no next level (we're at the cap).
  nextLevel: number | null;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
  // Hands until the level increase, 0 when no next level exists.
  handsUntilNextLevel: number;
};

// Display payload for the tournament header.
export function getBlindDisplay(
  handId: number,
  schedule: BlindSchedule = DEFAULT_BLIND_SCHEDULE,
): BlindDisplay {
  const hand = Math.max(1, handId);
  const current = getBlindsForHand(hand, schedule);
  const next = schedule.find((l) => l.fromHand > hand);
  return {
    level: current.level,
    smallBlind: current.smallBlind,
    bigBlind: current.bigBlind,
    nextLevel: next?.level ?? null,
    nextSmallBlind: next?.smallBlind ?? null,
    nextBigBlind: next?.bigBlind ?? null,
    handsUntilNextLevel: next ? next.fromHand - hand : 0,
  };
}
