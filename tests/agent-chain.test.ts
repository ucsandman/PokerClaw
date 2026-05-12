import { describe, it, expect } from 'vitest';
import { decideViaChain } from '../agent/strategy';
import { ruleStrategy } from '../agent/strategy/rules';
import { safeFallbackStrategy } from '../agent/strategy/safe';
import { buildStrategyInput } from '../agent/strategy-input';
import { viewForPlayer } from '../shared/view-models';
import { startSession, applyAction } from '../shared/game';
import { seededRand } from './seeded-rand';
import type { Strategy } from '../agent/types';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

const declines: Strategy = {
  name: 'declines',
  async decide() {
    return null;
  },
};

const illegal: Strategy = {
  name: 'illegal',
  async decide() {
    // Pretend to return something; chain just consumes whatever's first
    return { action: { type: 'fold' }, rationale: 'illegal-mock' };
  },
};

describe('strategy chain fallback', () => {
  it('skips a declining LLM and uses rules', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(601) });
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const result = await decideViaChain([declines, ruleStrategy, safeFallbackStrategy], input);
    expect(result.strategy).toBe('rules');
    expect(result.decision).not.toBeNull();
  });

  it('uses the first strategy that returns a decision', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(602) });
    applyAction(s, 'wes', { type: 'call' });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const result = await decideViaChain([illegal, ruleStrategy], input);
    expect(result.strategy).toBe('illegal');
    expect(result.decision?.action).toEqual({ type: 'fold' });
  });
});

describe('safe fallback strategy', () => {
  it('checks when possible', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(603) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    // flop, BB (MoltFire) to act, no bet → check available
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const d = await safeFallbackStrategy.decide(input);
    expect(d?.action).toEqual({ type: 'check' });
  });

  it('folds to expensive pressure', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(604) });
    // Wes raises to 1000 — MoltFire (BB) is facing a 900-chip call, far above 1bb.
    applyAction(s, 'wes', { type: 'raise', amount: 1000 });
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const d = await safeFallbackStrategy.decide(input);
    expect(d?.action).toEqual({ type: 'fold' });
  });

  it('calls a cheap bet (<= 1bb to call)', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(605) });
    // SB limps to 100. BB has option — but here we want MoltFire facing a small bet.
    // Reach the flop check-check-bet line: SB call, BB check, flop SB checks, BB bets small.
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    // flop. BB (moltfire) acts first. Make MoltFire check, then Wes bet 50 (< bb).
    applyAction(s, 'moltfire', { type: 'check' });
    // Wes betting 50 would be illegal: minBetTo on flop = bigBlind (100).
    // Instead simulate the cheap-call case by reaching turn with a tiny commitment.
    applyAction(s, 'wes', { type: 'bet', amount: 100 });
    // MoltFire now faces a 100 bet — exactly 1 BB. callTo=100, toCall=100, which is
    // <= bigBlind → safe fallback should CALL, not fold.
    const input = buildStrategyInput(viewForPlayer(s, 'moltfire'), 'match');
    const d = await safeFallbackStrategy.decide(input);
    expect(d?.action).toEqual({ type: 'call' });
  });
});
