import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../src/core/entity.js';

describe('EntityManager', () => {
  let em: EntityManager;

  beforeEach(() => {
    em = new EntityManager(100);
  });

  describe('spawn', () => {
    it('returns sequential indices starting at 0', () => {
      expect(em.spawn()).toBe(0);
      expect(em.spawn()).toBe(1);
      expect(em.spawn()).toBe(2);
    });

    it('increments count', () => {
      expect(em.count).toBe(0);
      em.spawn();
      expect(em.count).toBe(1);
      em.spawn();
      expect(em.count).toBe(2);
    });

    it('throws when maxEntities is reached', () => {
      const small = new EntityManager(2);
      small.spawn();
      small.spawn();
      expect(() => small.spawn()).toThrow('Entity limit reached (2)');
    });
  });

  describe('destroy', () => {
    it('marks entity as not alive', () => {
      const eid = em.spawn();
      expect(em.isAlive(eid)).toBe(true);
      em.destroy(eid);
      expect(em.isAlive(eid)).toBe(false);
    });

    it('decrements count', () => {
      const eid = em.spawn();
      em.spawn();
      expect(em.count).toBe(2);
      em.destroy(eid);
      expect(em.count).toBe(1);
    });

    it('is idempotent for already-dead entities', () => {
      const eid = em.spawn();
      em.destroy(eid);
      expect(em.count).toBe(0);
      em.destroy(eid); // should not decrement again
      expect(em.count).toBe(0);
    });

    it('ignores invalid indices', () => {
      em.destroy(-1);
      em.destroy(999);
      expect(em.count).toBe(0);
    });
  });

  describe('recycling', () => {
    it('recycles destroyed slots', () => {
      const a = em.spawn();
      const b = em.spawn();
      em.destroy(a);
      const c = em.spawn(); // should reuse slot 0
      expect(c).toBe(a);
      expect(em.isAlive(c)).toBe(true);
    });

    it('allows spawning up to maxEntities after recycling', () => {
      const small = new EntityManager(2);
      const a = small.spawn();
      small.spawn();
      small.destroy(a);
      const c = small.spawn(); // recycle slot
      expect(c).toBe(a);
    });
  });

  describe('generational handles', () => {
    it('packs and validates handles', () => {
      const eid = em.spawn();
      const handle = em.packHandle(eid);
      expect(em.validateHandle(handle)).toBe(true);
    });

    it('invalidates handles after destroy', () => {
      const eid = em.spawn();
      const handle = em.packHandle(eid);
      em.destroy(eid);
      expect(em.validateHandle(handle)).toBe(false);
    });

    it('invalidates old handle after recycle', () => {
      const eid = em.spawn();
      const oldHandle = em.packHandle(eid);
      em.destroy(eid);
      const recycled = em.spawn(); // same index, new generation
      expect(recycled).toBe(eid);
      expect(em.validateHandle(oldHandle)).toBe(false);

      const newHandle = em.packHandle(recycled);
      expect(em.validateHandle(newHandle)).toBe(true);
    });

    it('unpackIndex extracts the correct index', () => {
      const eid = em.spawn();
      const handle = em.packHandle(eid);
      expect(EntityManager.unpackIndex(handle)).toBe(eid);
    });
  });

  describe('isAlive', () => {
    it('returns false for never-spawned indices', () => {
      expect(em.isAlive(0)).toBe(false);
      expect(em.isAlive(50)).toBe(false);
    });

    it('returns false for negative indices', () => {
      expect(em.isAlive(-1)).toBe(false);
    });

    it('returns false for out-of-range indices', () => {
      expect(em.isAlive(200)).toBe(false);
    });
  });

  describe('aliveEntities', () => {
    it('iterates all alive entities', () => {
      em.spawn();
      em.spawn();
      em.spawn();
      em.destroy(1);

      const alive = [...em.aliveEntities()];
      expect(alive).toEqual([0, 2]);
    });

    it('returns empty for fresh manager', () => {
      expect([...em.aliveEntities()]).toEqual([]);
    });
  });

  describe('getAliveEntities', () => {
    it('returns array of alive entities', () => {
      em.spawn();
      em.spawn();
      em.spawn();
      em.destroy(1);

      expect(em.getAliveEntities()).toEqual([0, 2]);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      em.spawn();
      em.spawn();
      em.destroy(0);
      em.reset();

      expect(em.count).toBe(0);
      expect([...em.aliveEntities()]).toEqual([]);

      // Can spawn fresh again from index 0
      expect(em.spawn()).toBe(0);
    });
  });
});
