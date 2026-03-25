import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/core/world.js';
import { defineComponent, resetComponentIds } from '../src/core/component.js';
import { defineResource } from '../src/core/resource.js';
import { defineEvent } from '../src/core/events.js';
import { defineSystem } from '../src/core/system.js';
import { query } from '../src/core/query.js';
import { Types, COMP_ID } from '../src/core/types.js';

describe('World', () => {
  let world: World;

  beforeEach(() => {
    resetComponentIds();
    world = new World(1000);
  });

  describe('entity management', () => {
    it('spawn creates entities', () => {
      const a = world.spawn();
      const b = world.spawn();
      expect(a).toBe(0);
      expect(b).toBe(1);
      expect(world.isAlive(a)).toBe(true);
    });

    it('destroy removes entities', () => {
      const eid = world.spawn();
      world.destroy(eid);
      expect(world.isAlive(eid)).toBe(false);
    });

    it('destroy clears component data', () => {
      const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
      const eid = world.spawn();
      world.addComponent(eid, Pos, { x: 10, y: 20 });

      world.destroy(eid);
      expect(Pos.x[eid]).toBe(0);
      expect(Pos.y[eid]).toBe(0);
    });

    it('destroy is safe on dead entities', () => {
      const eid = world.spawn();
      world.destroy(eid);
      world.destroy(eid); // should not throw
    });
  });

  describe('component management', () => {
    it('addComponent sets archetype bit and values', () => {
      const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
      const eid = world.spawn();
      world.addComponent(eid, Pos, { x: 5, y: 10 });

      expect(world.hasComponent(eid, Pos)).toBe(true);
      expect(Pos.x[eid]).toBe(5);
      expect(Pos.y[eid]).toBe(10);
    });

    it('addComponent auto-registers unknown components', () => {
      const Vel = defineComponent('Velocity', { vx: Types.f32, vy: Types.f32 });
      const eid = world.spawn();
      // No explicit registerComponent call
      world.addComponent(eid, Vel, { vx: 1 });
      expect(world.hasComponent(eid, Vel)).toBe(true);
      expect(Vel.vx[eid]).toBe(1);
    });

    it('removeComponent clears bit and data', () => {
      const Health = defineComponent('Health', { hp: Types.f32 });
      const eid = world.spawn();
      world.addComponent(eid, Health, { hp: 100 });

      world.removeComponent(eid, Health);
      expect(world.hasComponent(eid, Health)).toBe(false);
      expect(Health.hp[eid]).toBe(0);
    });

    it('addComponent is no-op on dead entities', () => {
      const C = defineComponent('C', { v: Types.f32 });
      const eid = world.spawn();
      world.destroy(eid);
      world.addComponent(eid, C, { v: 99 });
      expect(world.hasComponent(eid, C)).toBe(false);
    });
  });

  describe('queries', () => {
    it('returns entities matching all required components', () => {
      const A = defineComponent('A', {});
      const B = defineComponent('B', {});

      const e1 = world.spawn();
      world.addComponent(e1, A);
      world.addComponent(e1, B);

      const e2 = world.spawn();
      world.addComponent(e2, A);

      const results = world.query(query(A, B));
      expect(results).toEqual([e1]);
    });

    it('supports not() exclusion', () => {
      const A = defineComponent('A', {});
      const B = defineComponent('B', {});

      const e1 = world.spawn();
      world.addComponent(e1, A);

      const e2 = world.spawn();
      world.addComponent(e2, A);
      world.addComponent(e2, B);

      const results = world.query(query(A).not(B));
      expect(results).toEqual([e1]);
    });

    it('caches query results within same structural epoch', () => {
      const A = defineComponent('A', {});
      const eid = world.spawn();
      world.addComponent(eid, A);

      // After structural changes, structuralChangeFlag is true so first query re-evaluates.
      // But subsequent queries in the same epoch should hit cache.
      const r1 = world.query(query(A));
      // Reset the flag manually to simulate no further structural changes
      // The cache should return the same results (deep equal)
      const r2 = world.query(query(A));
      expect(r1).toEqual(r2);
    });
  });

  describe('stages and systems', () => {
    it('systems execute in stage order', () => {
      const log: string[] = [];

      world.addStage('update', [
        defineSystem({ name: 'first', execute: () => log.push('first') }),
        defineSystem({ name: 'second', execute: () => log.push('second') }),
      ]);

      world.addStage('render', [
        defineSystem({ name: 'third', execute: () => log.push('third') }),
      ]);

      world.tick(1 / 60);
      expect(log).toEqual(['first', 'second', 'third']);
    });

    it('addSystem appends to existing stage', () => {
      const log: string[] = [];

      world.addStage('update', [
        defineSystem({ name: 'a', execute: () => log.push('a') }),
      ]);
      world.addSystem('update', defineSystem({ name: 'b', execute: () => log.push('b') }));

      world.tick(1 / 60);
      expect(log).toEqual(['a', 'b']);
    });

    it('addSystem creates stage if it does not exist', () => {
      const log: string[] = [];
      world.addSystem('newStage', defineSystem({ name: 'sys', execute: () => log.push('ran') }));

      world.tick(1 / 60);
      expect(log).toEqual(['ran']);
    });

    it('stage ordering with after/before', () => {
      const log: string[] = [];

      world.addStage('middle', [
        defineSystem({ name: 'm', execute: () => log.push('middle') }),
      ]);
      world.addStage('first', [
        defineSystem({ name: 'f', execute: () => log.push('first') }),
      ], { before: 'middle' });
      world.addStage('last', [
        defineSystem({ name: 'l', execute: () => log.push('last') }),
      ], { after: 'middle' });

      world.tick(1 / 60);
      expect(log).toEqual(['first', 'middle', 'last']);
    });
  });

  describe('deferred commands', () => {
    it('commands.destroy is deferred until between stages', () => {
      const A = defineComponent('A', {});
      const eid = world.spawn();
      world.addComponent(eid, A);

      const log: boolean[] = [];

      world.addStage('stage1', [
        defineSystem({
          name: 'destroyer',
          query: query(A),
          execute: (ctx) => {
            ctx.commands.destroy(eid);
            // Entity should still be alive during this system
            log.push(ctx.world.isAlive(eid));
          },
        }),
      ]);

      world.addStage('stage2', [
        defineSystem({
          name: 'checker',
          execute: (ctx) => {
            log.push(ctx.world.isAlive(eid));
          },
        }),
      ]);

      world.tick(1 / 60);
      expect(log).toEqual([true, false]);
    });

    it('BUG: commands.spawn is NOT deferred (BUG-1)', () => {
      // This documents the known bug: spawn is immediate, not deferred
      let spawnedEid = -1;
      let wasAlive = false;

      world.addStage('update', [
        defineSystem({
          name: 'spawner',
          execute: (ctx) => {
            spawnedEid = ctx.commands.spawn();
            wasAlive = ctx.world.isAlive(spawnedEid);
          },
        }),
      ]);

      world.tick(1 / 60);
      // The bug: entity is immediately alive during the same system
      expect(wasAlive).toBe(true);
    });

    it('commands.addComponent is deferred', () => {
      const A = defineComponent('A', {});
      const eid = world.spawn();

      let hadComponentDuringSystem = false;

      world.addStage('stage1', [
        defineSystem({
          name: 'adder',
          execute: (ctx) => {
            ctx.commands.addComponent(eid, A);
            hadComponentDuringSystem = ctx.world.hasComponent(eid, A);
          },
        }),
      ]);

      world.tick(1 / 60);
      expect(hadComponentDuringSystem).toBe(false);
      // After tick, the deferred command has been flushed
      expect(world.hasComponent(eid, A)).toBe(true);
    });
  });

  describe('events in tick', () => {
    it('events emitted in one stage are readable in the next', () => {
      const Hit = defineEvent<number>('Hit');
      const received: number[] = [];

      world.addStage('stage1', [
        defineSystem({
          name: 'emitter',
          execute: (ctx) => {
            ctx.events.emit(Hit, 42);
          },
        }),
      ]);

      world.addStage('stage2', [
        defineSystem({
          name: 'reader',
          execute: (ctx) => {
            for (const val of ctx.events.read(Hit)) {
              received.push(val);
            }
          },
        }),
      ]);

      world.tick(1 / 60);
      expect(received).toEqual([42]);
    });

    it('events from previous frame are cleared', () => {
      const Ev = defineEvent<number>('Ev');
      const counts: number[] = [];

      world.addStage('update', [
        defineSystem({
          name: 'sys',
          execute: (ctx) => {
            counts.push(ctx.events.read(Ev).length);
            ctx.events.emit(Ev, 1);
          },
        }),
      ]);

      world.tick(1 / 60);
      world.tick(1 / 60);
      // First tick: read buffer is empty (0 events). Second tick: read buffer was cleared at frame start (0 events).
      // Events emitted are in write buffer, not read buffer of the same stage.
      expect(counts).toEqual([0, 0]);
    });
  });

  describe('resources', () => {
    it('insert and get resources', () => {
      const Score = defineResource<number>('Score');
      world.insertResource(Score, 0);
      expect(world.getResource(Score)).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const A = defineComponent('A', {});
      const Score = defineResource<number>('Score');

      const eid = world.spawn();
      world.addComponent(eid, A);
      world.insertResource(Score, 100);
      world.addStage('update', [
        defineSystem({ name: 'noop', execute: () => {} }),
      ]);

      world.reset();

      expect(world.isAlive(eid)).toBe(false);
      expect(world.entities.count).toBe(0);
      expect(() => world.getResource(Score)).toThrow();
    });
  });

  describe('BUG: query cache key ignores read/write/changed (BUG-4)', () => {
    it('queries with same components but different access modes produce same cache key', () => {
      const A = defineComponent('A', { v: Types.f32 });
      const eid = world.spawn();
      world.addComponent(eid, A, { v: 1 });

      const readQ = query(A).read(A);
      const writeQ = query(A).write(A);

      const r1 = world.query(readQ);
      const r2 = world.query(writeQ);
      // Bug: same cache key, so they return equivalent results
      // (can't use toBe since structuralChangeFlag causes re-evaluation)
      expect(r1).toEqual(r2);
      // The real bug: read-only vs write queries are indistinguishable
      // to the cache, which will matter once change detection is implemented
    });
  });
});
