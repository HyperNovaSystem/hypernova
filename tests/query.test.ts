import { describe, it, expect, beforeEach } from 'vitest';
import { query, QueryExecutor } from '../src/core/query.js';
import { defineComponent, resetComponentIds } from '../src/core/component.js';
import { Types, COMP_ID } from '../src/core/types.js';

describe('query builder', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  it('builds a query with required components', () => {
    const A = defineComponent('A', { v: Types.f32 });
    const B = defineComponent('B', { v: Types.f32 });
    const q = query(A, B);

    expect(q.components).toEqual([A, B]);
    expect(q.readComponents).toEqual([A, B]); // default: all required are readable
  });

  it('supports .not() exclusion', () => {
    const A = defineComponent('A', {});
    const B = defineComponent('B', {});
    const q = query(A).not(B);

    expect(q.components).toEqual([A]);
    expect(q.notComponents).toEqual([B]);
  });

  it('supports .write() access', () => {
    const A = defineComponent('A', { v: Types.f32 });
    const q = query(A).write(A);

    expect(q.writeComponents).toEqual([A]);
  });

  it('supports .changed() filter', () => {
    const A = defineComponent('A', { v: Types.f32 });
    const q = query(A).changed(A);

    expect(q.changedComponents).toEqual([A]);
  });

  it('deduplicates components in read/write/not/changed', () => {
    const A = defineComponent('A', {});
    const q = query(A).read(A).read(A).not(A); // intentional: not(A) is weird but shouldn't dupe

    expect(q.readComponents.length).toBe(1);
    expect(q.notComponents.length).toBe(1);
  });
});

describe('QueryExecutor', () => {
  let qe: QueryExecutor;

  beforeEach(() => {
    resetComponentIds();
    qe = new QueryExecutor(100);
  });

  describe('addBit / hasBit / removeBit', () => {
    it('tracks component bits per entity', () => {
      qe.addBit(0, 3);
      expect(qe.hasBit(0, 3)).toBe(true);
      expect(qe.hasBit(0, 4)).toBe(false);
      expect(qe.hasBit(1, 3)).toBe(false);
    });

    it('removes bits', () => {
      qe.addBit(0, 5);
      qe.removeBit(0, 5);
      expect(qe.hasBit(0, 5)).toBe(false);
    });

    it('handles component IDs in the upper 32-bit word (32-63)', () => {
      qe.addBit(0, 33);
      expect(qe.hasBit(0, 33)).toBe(true);
      expect(qe.hasBit(0, 1)).toBe(false);

      qe.addBit(0, 63);
      expect(qe.hasBit(0, 63)).toBe(true);
    });
  });

  describe('clearEntity', () => {
    it('clears all bits for an entity', () => {
      qe.addBit(0, 0);
      qe.addBit(0, 5);
      qe.addBit(0, 33);
      qe.clearEntity(0);

      expect(qe.hasBit(0, 0)).toBe(false);
      expect(qe.hasBit(0, 5)).toBe(false);
      expect(qe.hasBit(0, 33)).toBe(false);
    });
  });

  describe('execute', () => {
    it('matches entities with all required components', () => {
      const A = defineComponent('A', {});
      const B = defineComponent('B', {});

      // Entity 0 has A and B
      qe.addBit(0, A[COMP_ID]);
      qe.addBit(0, B[COMP_ID]);

      // Entity 1 has only A
      qe.addBit(1, A[COMP_ID]);

      const q = query(A, B);
      const results = qe.execute(q, [0, 1]);
      expect(results).toEqual([0]);
    });

    it('excludes entities with .not() components', () => {
      const A = defineComponent('A', {});
      const B = defineComponent('B', {});

      qe.addBit(0, A[COMP_ID]);
      qe.addBit(1, A[COMP_ID]);
      qe.addBit(1, B[COMP_ID]);

      const q = query(A).not(B);
      const results = qe.execute(q, [0, 1]);
      expect(results).toEqual([0]);
    });

    it('returns all alive entities when query has no requirements', () => {
      const q = query();
      const results = qe.execute(q, [0, 1, 2]);
      expect(results).toEqual([0, 1, 2]);
    });

    it('returns empty when no entities match', () => {
      const A = defineComponent('A', {});
      const q = query(A);
      const results = qe.execute(q, [0, 1]);
      expect(results).toEqual([]);
    });
  });

  describe('reset', () => {
    it('clears all archetype data', () => {
      qe.addBit(0, 0);
      qe.addBit(5, 10);
      qe.reset();

      expect(qe.hasBit(0, 0)).toBe(false);
      expect(qe.hasBit(5, 10)).toBe(false);
    });
  });
});
