import { describe, it, expect } from 'vitest';
import { getBlindsForHand, getBlindDisplay, DEFAULT_BLIND_SCHEDULE } from '../shared/blinds';

describe('blind schedule', () => {
  it('hands 1-10 use 50/100', () => {
    for (let h = 1; h <= 10; h++) {
      const l = getBlindsForHand(h);
      expect(l.smallBlind).toBe(50);
      expect(l.bigBlind).toBe(100);
      expect(l.level).toBe(1);
    }
  });

  it('hand 11 starts level 2 (75/150)', () => {
    const l = getBlindsForHand(11);
    expect(l.level).toBe(2);
    expect(l.smallBlind).toBe(75);
    expect(l.bigBlind).toBe(150);
  });

  it('hand 21 starts level 3 (100/200)', () => {
    const l = getBlindsForHand(21);
    expect(l.level).toBe(3);
    expect(l.smallBlind).toBe(100);
    expect(l.bigBlind).toBe(200);
  });

  it('hand 71+ caps at level 8 (500/1000)', () => {
    expect(getBlindsForHand(71).level).toBe(8);
    expect(getBlindsForHand(999).level).toBe(8);
    expect(getBlindsForHand(999).bigBlind).toBe(1000);
  });

  it('clamps non-positive hand IDs to level 1', () => {
    expect(getBlindsForHand(0).level).toBe(1);
    expect(getBlindsForHand(-5).level).toBe(1);
  });
});

describe('blind display info', () => {
  it('reports next level countdown at level 1', () => {
    const d = getBlindDisplay(8);
    expect(d.level).toBe(1);
    expect(d.handsUntilNextLevel).toBe(3); // hand 8 → next bump at hand 11
    expect(d.nextLevel).toBe(2);
    expect(d.nextSmallBlind).toBe(75);
    expect(d.nextBigBlind).toBe(150);
  });

  it('reports 1 hand until next level on the hand before a bump', () => {
    const d = getBlindDisplay(10);
    expect(d.handsUntilNextLevel).toBe(1);
  });

  it('reports zero next-level data at the cap', () => {
    const d = getBlindDisplay(75);
    expect(d.level).toBe(8);
    expect(d.nextLevel).toBeNull();
    expect(d.nextSmallBlind).toBeNull();
    expect(d.nextBigBlind).toBeNull();
    expect(d.handsUntilNextLevel).toBe(0);
  });

  it('schedule is internally consistent (each level starts after the previous)', () => {
    for (let i = 1; i < DEFAULT_BLIND_SCHEDULE.length; i++) {
      expect(DEFAULT_BLIND_SCHEDULE[i].fromHand).toBeGreaterThan(
        DEFAULT_BLIND_SCHEDULE[i - 1].fromHand,
      );
      expect(DEFAULT_BLIND_SCHEDULE[i].bigBlind).toBeGreaterThanOrEqual(
        DEFAULT_BLIND_SCHEDULE[i - 1].bigBlind,
      );
    }
  });
});
