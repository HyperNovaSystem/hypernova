import { describe, it, expect } from 'vitest';
import { Random } from '../src/core/random.js';

describe('Random', () => {
  describe('determinism', () => {
    it('same seed produces identical sequences', () => {
      const a = new Random(12345);
      const b = new Random(12345);

      for (let i = 0; i < 100; i++) {
        expect(a.float()).toBe(b.float());
      }
    });

    it('different seeds produce different sequences', () => {
      const a = new Random(1);
      const b = new Random(2);

      const valuesA = Array.from({ length: 10 }, () => a.float());
      const valuesB = Array.from({ length: 10 }, () => b.float());
      expect(valuesA).not.toEqual(valuesB);
    });
  });

  describe('float', () => {
    it('returns values in [0, 1)', () => {
      const rng = new Random(42);
      for (let i = 0; i < 1000; i++) {
        const v = rng.float();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('range', () => {
    it('returns integers in [min, max]', () => {
      const rng = new Random(42);
      for (let i = 0; i < 1000; i++) {
        const v = rng.range(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
        expect(Number.isInteger(v)).toBe(true);
      }
    });
  });

  describe('rangeFloat', () => {
    it('returns floats in [min, max)', () => {
      const rng = new Random(42);
      for (let i = 0; i < 1000; i++) {
        const v = rng.rangeFloat(2.0, 5.0);
        expect(v).toBeGreaterThanOrEqual(2.0);
        expect(v).toBeLessThan(5.0);
      }
    });
  });

  describe('chance', () => {
    it('returns booleans', () => {
      const rng = new Random(42);
      const results = Array.from({ length: 100 }, () => rng.chance(0.5));
      expect(results.some(v => v === true)).toBe(true);
      expect(results.some(v => v === false)).toBe(true);
    });

    it('chance(0) always returns false', () => {
      const rng = new Random(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.chance(0)).toBe(false);
      }
    });

    it('chance(1) always returns true', () => {
      const rng = new Random(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.chance(1)).toBe(true);
      }
    });
  });

  describe('pick', () => {
    it('returns an element from the array', () => {
      const rng = new Random(42);
      const arr = ['a', 'b', 'c'];
      for (let i = 0; i < 50; i++) {
        expect(arr).toContain(rng.pick(arr));
      }
    });
  });

  describe('shuffle', () => {
    it('returns the same array (in-place)', () => {
      const rng = new Random(42);
      const arr = [1, 2, 3, 4, 5];
      const result = rng.shuffle(arr);
      expect(result).toBe(arr);
    });

    it('is deterministic', () => {
      const a = new Random(42);
      const b = new Random(42);
      const arrA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arrB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      a.shuffle(arrA);
      b.shuffle(arrB);
      expect(arrA).toEqual(arrB);
    });

    it('preserves all elements', () => {
      const rng = new Random(42);
      const arr = [1, 2, 3, 4, 5];
      rng.shuffle(arr);
      expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('vec2', () => {
    it('returns a vector with the given magnitude', () => {
      const rng = new Random(42);
      for (let i = 0; i < 100; i++) {
        const v = rng.vec2(5);
        const mag = Math.sqrt(v.x * v.x + v.y * v.y);
        expect(mag).toBeCloseTo(5, 5);
      }
    });

    it('defaults to magnitude 1', () => {
      const rng = new Random(42);
      const v = rng.vec2();
      const mag = Math.sqrt(v.x * v.x + v.y * v.y);
      expect(mag).toBeCloseTo(1, 5);
    });
  });

  describe('fork', () => {
    it('creates an independent sub-stream', () => {
      const rng = new Random(42);
      const fork1 = rng.fork('physics');
      const fork2 = rng.fork('ai');

      // Different labels should produce different sub-streams
      const vals1 = Array.from({ length: 10 }, () => fork1.float());
      const vals2 = Array.from({ length: 10 }, () => fork2.float());
      expect(vals1).not.toEqual(vals2);
    });

    it('same label from same state produces identical forks', () => {
      const a = new Random(42);
      const b = new Random(42);

      const forkA = a.fork('test');
      const forkB = b.fork('test');

      for (let i = 0; i < 20; i++) {
        expect(forkA.float()).toBe(forkB.float());
      }
    });
  });

  describe('state serialization', () => {
    it('getState and setState reproduce the same sequence', () => {
      const rng = new Random(42);
      // Advance a bit
      for (let i = 0; i < 50; i++) rng.float();

      const state = rng.getState();
      const next5 = Array.from({ length: 5 }, () => rng.float());

      // Restore state
      rng.setState(state);
      const replayed5 = Array.from({ length: 5 }, () => rng.float());

      expect(replayed5).toEqual(next5);
    });
  });
});
