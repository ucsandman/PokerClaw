import { describe, it, expect } from 'vitest';
import { startSession, applyAction } from '../shared/game';
import { viewForPlayer } from '../shared/view-models';
import { cardId } from '../shared/cards';
import { seededRand } from './seeded-rand';

const CONFIG = { smallBlind: 50, bigBlind: 100, startingStack: 10000 };

// Recursively walks an object and collects every value that looks like a card
// ({rank,suit}). Used to detect "card leakage" anywhere in a serialized view.
function collectCards(value: unknown): string[] {
  const found: string[] = [];
  const visit = (v: unknown) => {
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.rank === 'string' && typeof o.suit === 'string') {
      found.push(`${o.rank}${o.suit}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    Object.values(o).forEach(visit);
  };
  visit(value);
  return found;
}

describe('privacy view-models', () => {
  it('Wes view does not include MoltFire hole cards before showdown', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(101) });
    const moltCards = new Set(s.players.moltfire.holeCards.map(cardId));
    const view = viewForPlayer(s, 'wes');
    const serialized = JSON.parse(JSON.stringify(view));
    const cards = collectCards(serialized);
    for (const id of moltCards) {
      expect(cards).not.toContain(id);
    }
  });

  it('MoltFire view does not include Wes hole cards before showdown', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(102) });
    const wesCards = new Set(s.players.wes.holeCards.map(cardId));
    const view = viewForPlayer(s, 'moltfire');
    const serialized = JSON.parse(JSON.stringify(view));
    const cards = collectCards(serialized);
    for (const id of wesCards) {
      expect(cards).not.toContain(id);
    }
  });

  it('neither view contains deck order or future board cards', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(103) });
    const futureBoard = new Set(s.deck.map(cardId));
    for (const viewer of ['wes', 'moltfire'] as const) {
      const view = viewForPlayer(s, viewer);
      const serialized = JSON.parse(JSON.stringify(view));
      // Fail if the view contains a "deck" property anywhere.
      expect(JSON.stringify(serialized)).not.toMatch(/"deck"/);
      const cards = collectCards(serialized);
      for (const id of futureBoard) {
        expect(cards).not.toContain(id);
      }
    }
  });

  it('opponent cards are represented as hidden markers, count matches actual hole cards', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(104) });
    const view = viewForPlayer(s, 'wes');
    expect(view.opponent.cards.length).toBe(2);
    for (const c of view.opponent.cards) {
      expect((c as { hidden?: boolean }).hidden).toBe(true);
      expect((c as { rank?: unknown }).rank).toBeUndefined();
      expect((c as { suit?: unknown }).suit).toBeUndefined();
    }
  });

  it('after showdown, both views may include revealed hole cards', () => {
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(105) });
    // Run all-in line to force showdown: SB shoves, BB calls.
    applyAction(s, 'wes', { type: 'raise', amount: s.players.wes.stack + s.players.wes.committedThisStreet });
    applyAction(s, 'moltfire', { type: 'call' });
    expect(s.handComplete).toBe(true);
    expect(s.result?.reason).toBe('showdown');

    const wesCards = new Set(s.players.wes.holeCards.map(cardId));
    const moltCards = new Set(s.players.moltfire.holeCards.map(cardId));

    const wesView = viewForPlayer(s, 'wes');
    const moltView = viewForPlayer(s, 'moltfire');
    const wesViewCards = collectCards(JSON.parse(JSON.stringify(wesView)));
    const moltViewCards = collectCards(JSON.parse(JSON.stringify(moltView)));

    // After showdown both views should contain both players' real cards.
    for (const id of wesCards) {
      expect(wesViewCards).toContain(id);
      expect(moltViewCards).toContain(id);
    }
    for (const id of moltCards) {
      expect(wesViewCards).toContain(id);
      expect(moltViewCards).toContain(id);
    }
  });

  it('reveals both players hole cards after a fold (study-mode UX)', () => {
    // PokerClaw is single-player practice; seeing the opponent's folded
    // cards is much more useful than the live-poker convention of hiding
    // them. Both holes are revealed only AFTER the hand completes — during
    // the hand the opponent's cards are still strictly hidden.
    const s = startSession(CONFIG, { button: 'wes', rand: seededRand(106) });
    const wesCards = new Set(s.players.wes.holeCards.map(cardId));
    const moltCards = new Set(s.players.moltfire.holeCards.map(cardId));

    // Before the fold, opponent's cards must not be in the view.
    const midHandView = viewForPlayer(s, 'moltfire');
    const midHandCards = collectCards(JSON.parse(JSON.stringify(midHandView)));
    for (const id of wesCards) expect(midHandCards).not.toContain(id);

    applyAction(s, 'wes', { type: 'fold' });
    expect(s.handComplete).toBe(true);

    // After the fold, both views include both players' cards.
    const wesView = viewForPlayer(s, 'wes');
    const moltView = viewForPlayer(s, 'moltfire');
    const wesViewCards = collectCards(JSON.parse(JSON.stringify(wesView)));
    const moltViewCards = collectCards(JSON.parse(JSON.stringify(moltView)));
    for (const id of wesCards) {
      expect(wesViewCards).toContain(id);
      expect(moltViewCards).toContain(id);
    }
    for (const id of moltCards) {
      expect(wesViewCards).toContain(id);
      expect(moltViewCards).toContain(id);
    }
  });
});
