import { describe, it, expect } from 'vitest';
import { startSession, applyAction } from '../shared/game';
import { evaluateBestHand, compareHands } from '../shared/evaluator';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

describe('showdown', () => {
  it('runs all five board cards and awards pot consistently with evaluator', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(301) });
    applyAction(s, 'wes', { type: 'raise', amount: s.players.wes.stack + s.players.wes.committedThisStreet });
    applyAction(s, 'moltfire', { type: 'call' });
    expect(s.handComplete).toBe(true);
    expect(s.board.length).toBe(5);

    const wesEval = evaluateBestHand([...s.players.wes.holeCards, ...s.board]);
    const moltEval = evaluateBestHand([...s.players.moltfire.holeCards, ...s.board]);
    const cmp = compareHands(wesEval, moltEval);
    const expected = cmp > 0 ? 'wes' : cmp < 0 ? 'moltfire' : 'tie';
    expect(s.result?.winner).toBe(expected);
  });

  it('total chips conserved across a hand', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(302) });
    const before = s.players.wes.stack + s.players.moltfire.stack + s.pot;
    applyAction(s, 'wes', { type: 'raise', amount: 1000 });
    applyAction(s, 'moltfire', { type: 'call' });
    // From flop on, both check it down.
    while (!s.handComplete) {
      const actor = s.currentActor!;
      applyAction(s, actor, { type: 'check' });
    }
    const after = s.players.wes.stack + s.players.moltfire.stack;
    expect(after).toBe(before);
  });
});
