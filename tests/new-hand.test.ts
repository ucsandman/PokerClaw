import { describe, it, expect } from 'vitest';
import { startSession, startNewHand, applyAction } from '../shared/game';
import { cardId } from '../shared/cards';
import { seededRand } from './seeded-rand';

const CONFIG = { startingStack: 10000 };

describe('new hand', () => {
  it('deals two cards to each player with no duplicates and reserves rest for board', () => {
    const s = startSession(CONFIG, { rand: seededRand(42) });
    expect(s.players.wes.holeCards.length).toBe(2);
    expect(s.players.moltfire.holeCards.length).toBe(2);
    const all = [
      ...s.players.wes.holeCards,
      ...s.players.moltfire.holeCards,
      ...s.board,
      ...s.deck,
    ].map(cardId);
    expect(all.length).toBe(52);
    expect(new Set(all).size).toBe(52);
    expect(s.board.length).toBe(0);
    expect(s.deck.length).toBe(48);
  });

  it('posts the correct blinds', () => {
    const s = startSession(CONFIG, { rand: seededRand(1) });
    const sb = s.button; // heads-up: button is SB
    const bb = sb === 'wes' ? 'moltfire' : 'wes';
    expect(s.players[sb].committedThisStreet).toBe(50);
    expect(s.players[bb].committedThisStreet).toBe(100);
    expect(s.players[sb].stack).toBe(CONFIG.startingStack - 50);
    expect(s.players[bb].stack).toBe(CONFIG.startingStack - 100);
    expect(s.pot).toBe(150);
    expect(s.currentBet).toBe(100);
  });

  it('heads-up preflop: button/SB acts first', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(2) });
    expect(s.currentActor).toBe('wes');
    expect(s.button).toBe('wes');
  });

  it('button alternates each hand', () => {
    const s1 = startSession(CONFIG, { button: 'wes', rand: seededRand(3) });
    expect(s1.button).toBe('wes');
    applyAction(s1, 'wes', { type: 'fold' });
    expect(s1.handComplete).toBe(true);
    const s2 = startNewHand(s1, seededRand(4));
    expect(s2.button).toBe('moltfire');
  });

  it('postflop: non-button (BB) acts first', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(5) });
    // SB calls 50 → BB checks. Round complete, advance to flop.
    applyAction(s, 'wes', { type: 'call' });
    applyAction(s, 'moltfire', { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.currentActor).toBe('moltfire'); // BB acts first postflop
  });

  it('uses the tournament schedule: hand 11 posts 75/150 blinds', () => {
    // Fast-forward through ten hands of folds to reach hand 11. Each hand
    // ends immediately via SB fold, button alternates, blinds escalate.
    let state = startSession(CONFIG, { button: 'wes', rand: seededRand(10) });
    for (let i = 0; i < 10; i++) {
      // Whoever is SB this hand folds preflop.
      applyAction(state, state.currentActor!, { type: 'fold' });
      expect(state.handComplete).toBe(true);
      state = startNewHand(state, seededRand(11 + i));
    }
    expect(state.handId).toBe(11);
    expect(state.smallBlind).toBe(75);
    expect(state.bigBlind).toBe(150);
    const bb = state.button === 'wes' ? 'moltfire' : 'wes';
    expect(state.players[bb].committedThisStreet).toBe(150);
    expect(state.players[state.button].committedThisStreet).toBe(75);
  });
});
