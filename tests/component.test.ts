import { describe, it, expect, beforeEach } from 'vitest';
import {
  defineComponent, initComponentStorage,
  setComponentValues, clearComponentValues, resetComponentIds,
} from '../src/core/component.js';
import { Types, COMP_ID, COMP_NAME, COMP_SCHEMA, COMP_IS_TAG } from '../src/core/types.js';

describe('defineComponent', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  it('assigns sequential IDs', () => {
    const A = defineComponent('A', { x: Types.f32 });
    const B = defineComponent('B', { y: Types.f32 });
    expect(A[COMP_ID]).toBe(0);
    expect(B[COMP_ID]).toBe(1);
  });

  it('stores name and schema', () => {
    const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
    expect(Pos[COMP_NAME]).toBe('Position');
    expect(Pos[COMP_SCHEMA]).toEqual({ x: Float32Array, y: Float32Array });
  });

  it('detects tag components (empty schema)', () => {
    const Tag = defineComponent('IsEnemy', {});
    expect(Tag[COMP_IS_TAG]).toBe(true);

    const Comp = defineComponent('Health', { hp: Types.f32 });
    expect(Comp[COMP_IS_TAG]).toBe(false);
  });

  it('throws at 64-component limit', () => {
    for (let i = 0; i < 64; i++) {
      defineComponent(`C${i}`, {});
    }
    expect(() => defineComponent('C64', {})).toThrow('Maximum 64 component types');
  });
});

describe('initComponentStorage', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  it('creates typed arrays for each field', () => {
    const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
    initComponentStorage(Pos, 100);

    expect(Pos.x).toBeInstanceOf(Float32Array);
    expect(Pos.y).toBeInstanceOf(Float32Array);
    expect(Pos.x.length).toBe(100);
  });

  it('does nothing for tag components', () => {
    const Tag = defineComponent('Tag', {});
    initComponentStorage(Tag, 100);
    // No field arrays should exist
    expect(Object.keys(Tag).length).toBe(0);
  });

  it('supports different typed array types', () => {
    const Mixed = defineComponent('Mixed', {
      a: Types.f32,
      b: Types.i32,
      c: Types.u8,
      d: Types.u16,
      e: Types.u32,
      f: Types.bool,
    });
    initComponentStorage(Mixed, 10);

    expect(Mixed.a).toBeInstanceOf(Float32Array);
    expect(Mixed.b).toBeInstanceOf(Int32Array);
    expect(Mixed.c).toBeInstanceOf(Uint8Array);
    expect(Mixed.d).toBeInstanceOf(Uint16Array);
    expect(Mixed.e).toBeInstanceOf(Uint32Array);
    expect(Mixed.f).toBeInstanceOf(Uint8Array);
  });
});

describe('setComponentValues', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  it('sets field values for an entity', () => {
    const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
    initComponentStorage(Pos, 100);

    setComponentValues(Pos, 5, { x: 10, y: 20 });
    expect(Pos.x[5]).toBe(10);
    expect(Pos.y[5]).toBe(20);
  });

  it('sets partial values', () => {
    const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
    initComponentStorage(Pos, 100);

    setComponentValues(Pos, 3, { x: 42 });
    expect(Pos.x[3]).toBe(42);
    expect(Pos.y[3]).toBe(0); // default
  });

  it('is a no-op for tag components', () => {
    const Tag = defineComponent('Tag', {});
    // Should not throw
    setComponentValues(Tag, 0, undefined);
  });

  it('is a no-op when values is undefined', () => {
    const Pos = defineComponent('Position', { x: Types.f32 });
    initComponentStorage(Pos, 10);
    setComponentValues(Pos, 0, undefined);
    expect(Pos.x[0]).toBe(0);
  });
});

describe('clearComponentValues', () => {
  beforeEach(() => {
    resetComponentIds();
  });

  it('zeros out all fields for an entity', () => {
    const Pos = defineComponent('Position', { x: Types.f32, y: Types.f32 });
    initComponentStorage(Pos, 100);

    Pos.x[7] = 100;
    Pos.y[7] = 200;
    clearComponentValues(Pos, 7);

    expect(Pos.x[7]).toBe(0);
    expect(Pos.y[7]).toBe(0);
  });

  it('does not affect other entities', () => {
    const Pos = defineComponent('Position', { x: Types.f32 });
    initComponentStorage(Pos, 100);

    Pos.x[0] = 10;
    Pos.x[1] = 20;
    clearComponentValues(Pos, 0);

    expect(Pos.x[0]).toBe(0);
    expect(Pos.x[1]).toBe(20);
  });
});

describe('resetComponentIds', () => {
  it('resets the ID counter so new components start at 0', () => {
    resetComponentIds();
    const A = defineComponent('A', {});
    expect(A[COMP_ID]).toBe(0);

    resetComponentIds();
    const B = defineComponent('B', {});
    expect(B[COMP_ID]).toBe(0);
  });
});
