import { describe, it, expect } from 'vitest';
import { ruleShortcutStrategy, isObviousCheckSpot } from '../agent/strategy/rule-shortcut';
import { buildStrategyInput } from '../agent/strategy-input';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { seededRand } from './seeded-rand';
import type { StrategyInput } from '../agent/types';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function moltfireBigBlindFlopCheck(seed: number): StrategyInput {
  // Reach a flop spot where MoltFire (BB) is first to act with no bet.
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'call' });        // SB limp
  applyAction(s, 'moltfire', { type: 'check' });  // BB option check
  // Now on the flop. MoltFire (out of position) acts first, check legal.
  return buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
}

function moltfireFacingPreflopRaise(amount: number, seed: number): StrategyInput {
  // Wes raises preflop. MoltFire faces a call — check is NOT legal.
  const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed) });
  applyAction(s, 'wes', { type: 'raise', amount });
  return buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
}

describe('rule-shortcut strategy — safe trivial check', () => {
  it('checks when check is legal and there is no chip pressure', async () => {
    const input = moltfireBigBlindFlopCheck(3001);
    expect(input.legalActions.check).toBe(true);
    const decision = await ruleShortcutStrategy.decide(input);
    expect(decision).not.toBeNull();
    expect(decision!.action).toEqual({ type: 'check' });
  });

  it('declines when check is not legal (facing a raise preflop)', async () => {
    const input = moltfireFacingPreflopRaise(300, 3002);
    expect(input.legalActions.check).toBe(false);
    const decision = await ruleShortcutStrategy.decide(input);
    expect(decision).toBeNull();
  });

  it('declines when facing a large bet — never auto-calls', async () => {
    const input = moltfireFacingPreflopRaise(2500, 3003);
    expect(input.legalActions.check).toBe(false);
    expect(input.legalActions.call).toBe(true);
    const decision = await ruleShortcutStrategy.decide(input);
    expect(decision).toBeNull();
  });

  it('never returns a raise even when raise is legal', async () => {
    // Free check spot also has raise as a legal option, but shortcut MUST
    // only ever choose `check`.
    const input = moltfireBigBlindFlopCheck(3004);
    expect(input.legalActions.canBet || input.legalActions.canRaise).toBe(true);
    const decision = await ruleShortcutStrategy.decide(input);
    expect(decision?.action.type).toBe('check');
  });

  it('declines all-in spots even when check is somehow legal', () => {
    const base = moltfireBigBlindFlopCheck(3005);
    // Pretend MoltFire is all-in (stack 0). The shortcut must bail rather
    // than auto-acting through an all-in dynamic.
    const allIn: StrategyInput = { ...base, myStack: 0 };
    expect(isObviousCheckSpot(allIn)).toBe(false);
  });

  it('declines when the opponent is all-in', () => {
    const base = moltfireBigBlindFlopCheck(3006);
    const oppAllIn: StrategyInput = { ...base, opponentStack: 0 };
    expect(isObviousCheckSpot(oppAllIn)).toBe(false);
  });

  it('declines unusually-large-pot spots (>=20 BB)', () => {
    const base = moltfireBigBlindFlopCheck(3007);
    const bigPot: StrategyInput = { ...base, pot: base.bigBlind * 25 };
    expect(isObviousCheckSpot(bigPot)).toBe(false);
  });

  it('declines if the dealer says we owe chips even when check claims to be legal (paranoid guard)', () => {
    const base = moltfireBigBlindFlopCheck(3008);
    // Construct an inconsistent input: check=true but currentBet > committed.
    // The shortcut must trust the chip math over the flag, since auto-checking
    // when we actually owe chips would be a dealer rejection.
    const inconsistent: StrategyInput = {
      ...base,
      currentBet: base.myCommittedThisStreet + base.bigBlind,
    };
    expect(isObviousCheckSpot(inconsistent)).toBe(false);
  });
});
