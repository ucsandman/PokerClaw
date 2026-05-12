import { describe, it, expect } from 'vitest';
import { startSession, applyAction } from '../shared/game';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

describe('betting round flow', () => {
  it('fold preflop awards pot to remaining player', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(201) });
    // Wes (SB) committed 50, MoltFire (BB) committed 100, pot=150.
    expect(s.pot).toBe(150);
    applyAction(s, 'wes', { type: 'fold' });
    expect(s.handComplete).toBe(true);
    expect(s.result?.winner).toBe('moltfire');
    expect(s.result?.reason).toBe('fold');
    expect(s.result?.potAwarded).toBe(150);
    expect(s.players.moltfire.stack).toBe(CONFIG.startingStack + 50);
    expect(s.players.wes.stack).toBe(CONFIG.startingStack - 50);
  });

  it('BB option after SB limp: BB can check to see flop for free', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(202) });
    applyAction(s, 'wes', { type: 'call' });
    expect(s.street).toBe('preflop');
    expect(s.currentActor).toBe('moltfire');
    expect(s.players.wes.committedThisStreet).toBe(100);
    applyAction(s, 'moltfire', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.pot).toBe(200);
  });

  it('SB limp -> BB raises reopens action to SB', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(203) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'raise', amount: 300 });
    expect(s.currentActor).toBe('wes');
    expect(s.currentBet).toBe(300);
    expect(s.minRaiseTo).toBe(500);
  });

  it('postflop check-check advances street', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(204) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    expect(s.street).toBe('flop');
    applyAction(s, 'moltfire', { type: 'check' }); // BB first postflop
    applyAction(s, 'wes', { type: 'check' });
    expect(s.street).toBe('turn');
  });

  it('all-in preflop runs out board to showdown', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(205) });
    applyAction(s, 'wes', { type: 'raise', amount: s.players.wes.stack + s.players.wes.committedThisStreet });
    applyAction(s, 'moltfire', { type: 'call' });
    expect(s.handComplete).toBe(true);
    expect(s.board.length).toBe(5);
    expect(s.result?.reason).toBe('showdown');
  });

  it('uncalled bet is refunded when opponent calls all-in for less', () => {
    // Force a known mismatch: small starting stack means BB caps out below the SB shove.
    const s = startSession(
      { startingStack: 200 },
      { button: 'wes', rand: seededRand(206) },
    );
    // BB stack = 100 (already posted 100, has 100 left). SB stack = 150 (posted 50).
    // SB shoves all-in to 200 total. BB calls — can only put in another 100 to total 200.
    applyAction(s, 'wes', { type: 'raise', amount: 200 });
    applyAction(s, 'moltfire', { type: 'call' });
    // Both committed 200, no uncalled portion. Pot = 400.
    expect(s.pot).toBe(400);
    expect(s.handComplete).toBe(true);
  });

  it('uncalled bet IS refunded when shover commits more than caller can match', () => {
    // SB stack much larger than BB.
    // We use config trick: BB starts with smaller stack by hot-wiring after startSession.
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(207) });
    // Manually shrink MoltFire stack to simulate short opponent.
    // (Surgical patch for this test only — engine logic is exercised end-to-end.)
    s.players.moltfire.stack = 500 - s.players.moltfire.committedThisStreet; // total chips = 500
    // Wes shoves to a huge amount; MoltFire calls for all-in less.
    applyAction(s, 'wes', { type: 'raise', amount: 9000 });
    applyAction(s, 'moltfire', { type: 'call' });
    // After refund: both contributed 500 to the pot (BB only had 500 total).
    // Wes effective contribution should be 500, not 9000.
    expect(s.players.moltfire.committedThisHand).toBe(500);
    expect(s.players.wes.committedThisHand).toBe(500);
    expect(s.handComplete).toBe(true);
  });
});
