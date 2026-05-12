import type { Strategy, StrategyDecision, StrategyInput } from '../types';
import { parseCard } from '../../shared/cards';
import { evaluateBestHand } from '../../shared/evaluator';
import type { PlayerAction } from '../../shared/types';

// Level 0: deterministic toy bot. Goals:
//  - never picks an illegal action (clamps to legal min/max).
//  - plays reasonably enough to test the full table loop.
//  - never randomizes (keeps tests deterministic).
//
// Preflop ranges are hand-strength bands; postflop uses evaluator category
// on the made hand. Bet sizes are 2/3 pot, clamped to legal range.
export const ruleStrategy: Strategy = {
  name: 'rules',
  async decide(input: StrategyInput): Promise<StrategyDecision> {
    const action = pickAction(input);
    return { action, rationale: 'rule-based' };
  },
};

function pickAction(input: StrategyInput): PlayerAction {
  if (input.street === 'preflop') {
    return preflopAction(input, handStrength(input));
  }
  return postflopAction(input);
}

// -----------------------------------------------------------------------
// Preflop
// -----------------------------------------------------------------------

function preflopAction(input: StrategyInput, strength: number): PlayerAction {
  const legal = input.legalActions;
  // strength roughly in [0, 1]. Strong premium ~ >0.8; junk < 0.3.
  if (strength >= 0.8 && legal.canRaise) {
    return clampedRaise(input, threeXOpen(input));
  }
  if (strength >= 0.5) {
    if (legal.call) return { type: 'call' };
    if (legal.check) return { type: 'check' };
  }
  // Weak hand: free check if possible, otherwise face-bet fold.
  if (legal.check) return { type: 'check' };
  if (legal.call && callIsCheap(input)) return { type: 'call' };
  if (legal.fold) return { type: 'fold' };
  if (legal.check) return { type: 'check' };
  return { type: 'fold' };
}

// 3x open total commit. We can't pump arbitrary amounts — legal.minRaiseTo
// is the floor and legal.maxRaiseTo is the all-in ceiling.
function threeXOpen(input: StrategyInput): number {
  return Math.max(input.legalActions.minRaiseTo, input.bigBlind * 3);
}

function callIsCheap(input: StrategyInput): boolean {
  const toCall = input.currentBet - input.myCommittedThisStreet;
  return toCall <= input.bigBlind * 2;
}

// -----------------------------------------------------------------------
// Postflop
// -----------------------------------------------------------------------

function postflopAction(input: StrategyInput): PlayerAction {
  const legal = input.legalActions;
  const made = evaluateMadeHand(input);
  // Categories ordered by strength.
  const order: Record<string, number> = {
    'high-card': 0,
    pair: 1,
    'two-pair': 2,
    trips: 3,
    straight: 4,
    flush: 5,
    'full-house': 6,
    quads: 7,
    'straight-flush': 8,
  };
  const cat = order[made.category] ?? 0;

  if (cat >= 2) {
    // Two pair or better: value bet/raise.
    if (legal.canRaise) return clampedRaise(input, twoThirdsPot(input));
    if (legal.canBet) return clampedBet(input, twoThirdsPot(input));
    if (legal.call) return { type: 'call' };
  }
  if (cat === 1) {
    // Pair: bet small or check-call.
    if (legal.canBet) return clampedBet(input, halfPot(input));
    if (legal.call && callIsCheap(input)) return { type: 'call' };
    if (legal.check) return { type: 'check' };
    if (legal.fold) return { type: 'fold' };
  }
  // High card: try to see a free card. Fold to pressure.
  if (legal.check) return { type: 'check' };
  if (legal.fold) return { type: 'fold' };
  if (legal.call) return { type: 'call' };
  return { type: 'fold' };
}

function halfPot(input: StrategyInput): number {
  return Math.floor(input.pot * 0.5);
}

function twoThirdsPot(input: StrategyInput): number {
  return Math.floor(input.pot * 0.66);
}

// -----------------------------------------------------------------------
// Bet/raise amount sizing — `amount` is total commit-to for the street.
// -----------------------------------------------------------------------

function clampedBet(input: StrategyInput, sizingChips: number): PlayerAction {
  const legal = input.legalActions;
  // sizing is chips to add to the pot (delta), translate to total-commit.
  const totalCommit = input.myCommittedThisStreet + Math.max(sizingChips, input.bigBlind);
  const clamped = clamp(totalCommit, legal.minBetTo, legal.maxBetTo);
  return { type: 'bet', amount: clamped };
}

function clampedRaise(input: StrategyInput, totalCommitTarget: number): PlayerAction {
  const legal = input.legalActions;
  const clamped = clamp(totalCommitTarget, legal.minRaiseTo, legal.maxRaiseTo);
  return { type: 'raise', amount: clamped };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// -----------------------------------------------------------------------
// Hand-strength heuristics.
// -----------------------------------------------------------------------

function handStrength(input: StrategyInput): number {
  if (input.myHoleCards.length !== 2) return 0;
  const a = parseCard(input.myHoleCards[0]);
  const b = parseCard(input.myHoleCards[1]);
  const aRank = rankValueLocal(a.rank);
  const bRank = rankValueLocal(b.rank);
  const high = Math.max(aRank, bRank);
  const low = Math.min(aRank, bRank);
  const suited = a.suit === b.suit;
  const pair = aRank === bRank;
  if (pair) {
    // Pocket pairs: 22 ~ 0.55, AA ~ 1.0
    return 0.55 + (aRank - 2) / (14 - 2) * 0.45;
  }
  // Non-pair: high card dominates, suited & connectedness add a bonus.
  let s = (high - 2) / 12 * 0.55 + (low - 2) / 12 * 0.25;
  if (suited) s += 0.06;
  if (high - low === 1) s += 0.04;
  // Cap.
  return Math.min(s, 0.79);
}

function rankValueLocal(r: string): number {
  switch (r) {
    case 'A': return 14;
    case 'K': return 13;
    case 'Q': return 12;
    case 'J': return 11;
    case 'T': return 10;
    default: return Number(r);
  }
}

function evaluateMadeHand(input: StrategyInput) {
  const cards = [
    parseCard(input.myHoleCards[0]),
    parseCard(input.myHoleCards[1]),
    ...input.board.map(parseCard),
  ];
  if (cards.length < 5) {
    return { category: 'high-card' as const, rank: [], bestFive: [] };
  }
  return evaluateBestHand(cards);
}
