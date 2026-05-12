import { describe, it, expect } from 'vitest';
import { startSession, applyAction } from '../shared/game';
import { validateAction } from '../shared/actions';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

describe('legal actions', () => {
  it('rejects out-of-turn action', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(11) });
    // It is Wes's turn preflop (SB/button).
    expect(s.currentActor).toBe('wes');
    const err = validateAction(s, 'moltfire', { type: 'call' });
    expect(err).toMatch(/not your turn/i);
    expect(() => applyAction(s, 'moltfire', { type: 'call' })).toThrow();
  });

  it('rejects check facing a bet', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(12) });
    // SB faces a BB raise — checking is illegal.
    const err = validateAction(s, 'wes', { type: 'check' });
    expect(err).toMatch(/cannot check/i);
    expect(() => applyAction(s, 'wes', { type: 'check' })).toThrow();
  });

  it('rejects under-raise (not all-in)', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(13) });
    // currentBet = 100, minRaiseTo = 200. Raise to 150 is illegal (not all-in).
    const err = validateAction(s, 'wes', { type: 'raise', amount: 150 });
    expect(err).toMatch(/at least 200/i);
  });

  it('accepts a legal min-raise', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(14) });
    expect(validateAction(s, 'wes', { type: 'raise', amount: 200 })).toBeNull();
    applyAction(s, 'wes', { type: 'raise', amount: 200 });
    expect(s.currentBet).toBe(200);
  });

  it('allows short all-in raise even below the min-raise threshold', () => {
    // Wes has a tiny stack so his "raise" is an all-in shove smaller than minRaiseTo.
    const s = startSession(
      { startingStack: 175 },
      { button: 'wes', rand: seededRand(15) },
    );
    // After blinds: wes committed 50, stack 125. Max commit = 175 (all-in).
    // minRaiseTo = 200, but wes can only shove to 175 — must be permitted.
    expect(validateAction(s, 'wes', { type: 'raise', amount: 175 })).toBeNull();
  });

  it('rejects bet larger than stack', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(16) });
    // First put no bet by reaching flop quickly.
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.currentActor).toBe('moltfire');
    const tooBig = s.players.moltfire.stack + 1;
    expect(validateAction(s, 'moltfire', { type: 'bet', amount: tooBig })).toMatch(/exceeds stack/i);
  });

  it('rejects bet of non-integer or non-finite amount', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(17) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    expect(validateAction(s, 'moltfire', { type: 'bet', amount: 100.5 })).toMatch(/whole-chip/i);
    expect(validateAction(s, 'moltfire', { type: 'bet', amount: Number.NaN })).toMatch(/number/i);
  });

  it('rejects action after hand complete', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(18) });
    applyAction(s, 'wes', { type: 'fold' });
    expect(s.handComplete).toBe(true);
    expect(validateAction(s, 'moltfire', { type: 'check' })).toMatch(/hand is complete/i);
  });
});
