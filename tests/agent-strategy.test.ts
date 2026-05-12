import { describe, it, expect } from 'vitest';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { legalActionsFor } from '../shared/actions';
import { ruleStrategy } from '../agent/strategy/rules';
import { buildStrategyInput } from '../agent/strategy-input';
import type { GameState, PlayerAction } from '../shared/types';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

function buildInput(state: GameState) {
  const view = viewForPlayer(state, 'moltfire');
  return buildStrategyInput(view, 'match');
}

function isLegal(state: GameState, action: PlayerAction): boolean {
  // The rule strategy can only ever produce one of these action types.
  const legal = legalActionsFor(state, 'moltfire');
  if (!legal) return false;
  switch (action.type) {
    case 'fold':
      return legal.fold;
    case 'check':
      return legal.check;
    case 'call':
      return legal.call;
    case 'bet':
      return legal.canBet && action.amount >= legal.minBetTo && action.amount <= legal.maxBetTo;
    case 'raise':
      return legal.canRaise && action.amount >= legal.minRaiseTo && action.amount <= legal.maxRaiseTo;
  }
}

async function play(state: GameState): Promise<PlayerAction> {
  const decision = await ruleStrategy.decide(buildInput(state));
  if (!decision) throw new Error('rule strategy declined');
  return decision.action;
}

describe('rule strategy', () => {
  it('returns a legal action preflop when MoltFire is the BB facing a limp', async () => {
    // Wes (SB/BTN) limps. Action now to MoltFire (BB).
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(401) });
    applyAction(s, 'wes', { type: 'call' });
    expect(s.currentActor).toBe('moltfire');
    const a = await play(s);
    expect(isLegal(s, a)).toBe(true);
  });

  it('returns a legal action postflop after preflop check-call', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(402) });
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.currentActor).toBe('moltfire');
    const a = await play(s);
    expect(isLegal(s, a)).toBe(true);
  });

  it('returns a legal action when facing a raise', async () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(403) });
    applyAction(s, 'wes', { type: 'raise', amount: 300 });
    expect(s.currentActor).toBe('moltfire');
    const a = await play(s);
    expect(isLegal(s, a)).toBe(true);
    expect(a.type).not.toBe('check'); // facing a bet, check would be illegal
  });

  it('produces legal actions across many randomized seeds', async () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = startSession(CONFIG, { button: 'wes', rand: seededRand(seed * 31) });
      // Walk a few turns where MoltFire is the actor and confirm legality.
      while (!s.handComplete) {
        if (s.currentActor !== 'moltfire') {
          // Have Wes play passively: call/check/fold.
          const wesLegal = legalActionsFor(s, 'wes')!;
          if (wesLegal.check) applyAction(s, 'wes', { type: 'check' });
          else if (wesLegal.call) applyAction(s, 'wes', { type: 'call' });
          else applyAction(s, 'wes', { type: 'fold' });
          continue;
        }
        const a = await play(s);
        expect(isLegal(s, a)).toBe(true);
        applyAction(s, 'moltfire', a);
      }
    }
  });
});
