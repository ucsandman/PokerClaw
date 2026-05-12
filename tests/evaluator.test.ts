import { describe, it, expect } from 'vitest';
import { evaluateBestHand, compareHands } from '../shared/evaluator';
import { parseCard } from '../shared/cards';

const c = (s: string) => s.split(' ').map(parseCard);

describe('evaluator categories', () => {
  it('high card', () => {
    const r = evaluateBestHand(c('Ah Kd 9c 7s 5h 3d 2c'));
    expect(r.category).toBe('high-card');
    expect(r.rank[0]).toBe(1);
  });

  it('pair', () => {
    const r = evaluateBestHand(c('Ah As Kd Qc 7s 3d 2c'));
    expect(r.category).toBe('pair');
  });

  it('two pair', () => {
    const r = evaluateBestHand(c('Ah As Kd Kc 7s 3d 2c'));
    expect(r.category).toBe('two-pair');
  });

  it('trips', () => {
    const r = evaluateBestHand(c('Ah As Ac Kc 7s 3d 2c'));
    expect(r.category).toBe('trips');
  });

  it('wheel straight A-2-3-4-5', () => {
    const r = evaluateBestHand(c('Ah 2s 3d 4c 5h Kh 9d'));
    expect(r.category).toBe('straight');
    expect(r.rank[1]).toBe(5); // 5-high wheel
  });

  it('regular straight', () => {
    const r = evaluateBestHand(c('9h Ts Jd Qc Kh 2d 3c'));
    expect(r.category).toBe('straight');
    expect(r.rank[1]).toBe(13); // K-high
  });

  it('flush', () => {
    const r = evaluateBestHand(c('Ah 9h 6h 4h 2h Kd Qs'));
    expect(r.category).toBe('flush');
  });

  it('full house', () => {
    const r = evaluateBestHand(c('Ah As Ac Kc Kh 7s 2c'));
    expect(r.category).toBe('full-house');
  });

  it('quads', () => {
    const r = evaluateBestHand(c('Ah As Ac Ad Kc 7s 2c'));
    expect(r.category).toBe('quads');
  });

  it('straight flush', () => {
    const r = evaluateBestHand(c('5h 6h 7h 8h 9h 2d Kc'));
    expect(r.category).toBe('straight-flush');
    expect(r.rank[1]).toBe(9);
  });

  it('steel wheel (A-5 straight flush)', () => {
    const r = evaluateBestHand(c('Ah 2h 3h 4h 5h Kd Qc'));
    expect(r.category).toBe('straight-flush');
    expect(r.rank[1]).toBe(5);
  });
});

describe('evaluator tiebreakers', () => {
  it('higher kicker wins with same pair', () => {
    const a = evaluateBestHand(c('Ah As Kd 7c 5h 3d 2c'));
    const b = evaluateBestHand(c('Ah As Qd 7c 5h 3d 2c'));
    expect(compareHands(a, b)).toBe(1);
  });

  it('higher trip rank wins', () => {
    const a = evaluateBestHand(c('Kh Ks Kc 7c 5h 3d 2c'));
    const b = evaluateBestHand(c('Qh Qs Qc Ac 5h 3d 2c'));
    expect(compareHands(a, b)).toBe(1);
  });

  it('flush kicker compares full 5 ranks', () => {
    const a = evaluateBestHand(c('Ah Kh 9h 6h 4h Ts 2d'));
    const b = evaluateBestHand(c('Ah Kh 9h 6h 3h Ts 2d'));
    expect(compareHands(a, b)).toBe(1);
  });

  it('full house: higher trip beats higher pair', () => {
    const a = evaluateBestHand(c('Kh Ks Kc 2d 2h 3s 4c'));
    const b = evaluateBestHand(c('Qh Qs Qc Ad Ah 3s 4c'));
    expect(compareHands(a, b)).toBe(1);
  });

  it('quads kicker tiebreak', () => {
    const a = evaluateBestHand(c('5h 5s 5c 5d Ah 2c 3d'));
    const b = evaluateBestHand(c('5h 5s 5c 5d Kh 2c 3d'));
    expect(compareHands(a, b)).toBe(1);
  });

  it('identical hands tie', () => {
    const a = evaluateBestHand(c('Ah Kh Qh Jh Th 2c 3d'));
    const b = evaluateBestHand(c('Ad Kd Qd Jd Td 4c 5s'));
    expect(compareHands(a, b)).toBe(0);
  });
});
