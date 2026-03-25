import { describe, it, expect, beforeEach } from 'vitest';
import { Engine, Time } from '../src/core/engine.js';
import { defineComponent, resetComponentIds } from '../src/core/component.js';
import { defineSystem } from '../src/core/system.js';
import { query } from '../src/core/query.js';
import { RandomResource } from '../src/core/random.js';
import { Types } from '../src/core/types.js';

describe('Engine', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  describe('construction', () => {
    it('creates with default config', () => {
      const engine = new Engine();
      expect(engine.config.maxEntities).toBe(50_000);
      expect(engine.config.fixedTimestep).toBeCloseTo(1 / 60);
      expect(engine.config.maxSubstepsPerFrame).toBe(4);
      expect(engine.config.headless).toBe(false);
      expect(engine.config.timeScale).toBe(1);
      engine.dispose();
    });

    it('creates with custom config', () => {
      const engine = new Engine({
        maxEntities: 1000,
        fixedTimestep: 1 / 30,
        headless: true,
        seed: 42,
      });
      expect(engine.config.maxEntities).toBe(1000);
      expect(engine.config.fixedTimestep).toBeCloseTo(1 / 30);
      expect(engine.config.headless).toBe(true);
      expect(engine.config.seed).toBe(42);
      engine.dispose();
    });

    it('initializes Time resource', () => {
      const engine = new Engine();
      const time = engine.world.getResource(Time);
      expect(time.dt).toBeCloseTo(1 / 60);
      expect(time.elapsed).toBe(0);
      expect(time.frame).toBe(0);
      expect(time.timeScale).toBe(1);
      engine.dispose();
    });

    it('initializes Random resource', () => {
      const engine = new Engine({ seed: 42 });
      const rng = engine.world.getResource(RandomResource);
      expect(rng).toBeDefined();
      expect(rng.float).toBeDefined();
      engine.dispose();
    });
  });

  describe('headless tick', () => {
    it('tick advances one frame', () => {
      const engine = new Engine({ headless: true });
      engine.tick();
      const time = engine.world.getResource(Time);
      expect(time.frame).toBe(1);
      expect(time.elapsed).toBeCloseTo(1 / 60);
      engine.dispose();
    });

    it('tickN advances N frames', () => {
      const engine = new Engine({ headless: true });
      engine.tickN(10);
      const time = engine.world.getResource(Time);
      expect(time.frame).toBe(10);
      expect(time.elapsed).toBeCloseTo(10 / 60, 5);
      engine.dispose();
    });

    it('tickUntil stops when predicate is true', () => {
      const engine = new Engine({ headless: true });
      let count = 0;

      engine.world.addStage('update', [
        defineSystem({
          name: 'counter',
          execute: () => { count++; },
        }),
      ]);

      engine.tickUntil(() => count >= 5);
      expect(count).toBe(5);
      engine.dispose();
    });

    it('tickUntil respects maxTicks safety', () => {
      const engine = new Engine({ headless: true });
      let count = 0;

      engine.world.addStage('update', [
        defineSystem({
          name: 'counter',
          execute: () => { count++; },
        }),
      ]);

      engine.tickUntil(() => false, 50);
      expect(count).toBe(50);
      engine.dispose();
    });

    it('step advances exactly one tick', () => {
      const engine = new Engine({ headless: true });
      engine.step();
      const time = engine.world.getResource(Time);
      expect(time.frame).toBe(1);
      engine.dispose();
    });
  });

  describe('time control', () => {
    it('setTimeScale / getTimeScale', () => {
      const engine = new Engine({ headless: true });
      engine.setTimeScale(2);
      expect(engine.getTimeScale()).toBe(2);
      engine.dispose();
    });

    it('setTimeScale updates the Time resource', () => {
      const engine = new Engine({ headless: true });
      engine.setTimeScale(0.5);
      const time = engine.world.getResource(Time);
      expect(time.timeScale).toBe(0.5);
      engine.dispose();
    });
  });

  describe('plugin system', () => {
    it('installs plugins', () => {
      const engine = new Engine({ headless: true });
      let installed = false;

      engine.addPlugin({
        name: 'test-plugin',
        install: () => { installed = true; },
      });

      expect(installed).toBe(true);
      engine.dispose();
    });

    it('prevents duplicate plugin installation', () => {
      const engine = new Engine({ headless: true });
      let count = 0;

      const plugin = {
        name: 'test-plugin',
        install: () => { count++; },
      };

      engine.addPlugin(plugin);
      engine.addPlugin(plugin);
      expect(count).toBe(1);
      engine.dispose();
    });

    it('checks plugin dependencies', () => {
      const engine = new Engine({ headless: true });

      expect(() => {
        engine.addPlugin({
          name: 'dependent',
          depends: ['missing-dep'],
          install: () => {},
        });
      }).toThrow('depends on "missing-dep"');

      engine.dispose();
    });

    it('allows plugins when dependencies are met', () => {
      const engine = new Engine({ headless: true });

      engine.addPlugin({
        name: 'base',
        install: () => {},
      });

      engine.addPlugin({
        name: 'dependent',
        depends: ['base'],
        install: () => {},
      });

      // No error
      engine.dispose();
    });

    it('runs cleanup functions on dispose in reverse order', () => {
      const engine = new Engine({ headless: true });
      const log: string[] = [];

      engine.addPlugin({
        name: 'first',
        install: () => () => log.push('first-cleanup'),
      });
      engine.addPlugin({
        name: 'second',
        install: () => () => log.push('second-cleanup'),
      });

      engine.dispose();
      expect(log).toEqual(['second-cleanup', 'first-cleanup']);
    });
  });

  describe('AppBuilder interface', () => {
    it('registerComponent delegates to world', () => {
      const engine = new Engine({ headless: true });
      const C = defineComponent('C', { v: Types.f32 });
      engine.registerComponent(C);
      // Should not throw when adding component to entity
      const eid = engine.world.spawn();
      engine.world.addComponent(eid, C, { v: 42 });
      expect(C.v[eid]).toBe(42);
      engine.dispose();
    });

    it('addStage delegates to world', () => {
      const engine = new Engine({ headless: true });
      const log: string[] = [];
      engine.addStage('test', [
        defineSystem({ name: 'sys', execute: () => log.push('ran') }),
      ]);
      engine.tick();
      expect(log).toEqual(['ran']);
      engine.dispose();
    });

    it('insertResource delegates to world', async () => {
      const engine = new Engine({ headless: true });
      const { defineResource } = await import('../src/core/resource.js');
      const R = defineResource<number>('R');
      engine.insertResource(R, 42);
      expect(engine.world.getResource(R)).toBe(42);
      engine.dispose();
    });
  });

  describe('interpolation alpha', () => {
    it('returns 0 when no time has accumulated', () => {
      const engine = new Engine({ headless: true });
      expect(engine.getInterpolationAlpha()).toBe(0);
      engine.dispose();
    });
  });

  describe('determinism', () => {
    it('two engines with same seed produce identical results', () => {
      const Pos = defineComponent('Position', { x: Types.f32 });

      const run = (seed: number) => {
        resetComponentIds();
        const pos = defineComponent('Pos', { x: Types.f32 });
        const engine = new Engine({ headless: true, seed, maxEntities: 100 });

        const eid = engine.world.spawn();
        engine.world.addComponent(eid, pos, { x: 0 });

        engine.world.addStage('update', [
          defineSystem({
            name: 'mover',
            query: query(pos),
            execute: (ctx) => {
              const rng = ctx.resources.get(RandomResource);
              for (const e of ctx.entities) {
                pos.x[e] += rng.float();
              }
            },
          }),
        ]);

        engine.tickN(100);
        const result = pos.x[eid];
        engine.dispose();
        return result;
      };

      const a = run(12345);
      const b = run(12345);
      expect(a).toBe(b);
    });
  });
});
