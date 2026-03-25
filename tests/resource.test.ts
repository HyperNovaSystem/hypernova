import { describe, it, expect, beforeEach } from 'vitest';
import { defineResource, ResourceStore } from '../src/core/resource.js';

describe('ResourceStore', () => {
  let store: ResourceStore;

  beforeEach(() => {
    store = new ResourceStore();
  });

  it('insert and get a resource', () => {
    const Score = defineResource<number>('Score');
    store.insert(Score, 100);
    expect(store.get(Score)).toBe(100);
  });

  it('has returns true for inserted resources', () => {
    const R = defineResource<string>('R');
    expect(store.has(R)).toBe(false);
    store.insert(R, 'value');
    expect(store.has(R)).toBe(true);
  });

  it('throws when getting a missing resource', () => {
    const Missing = defineResource<number>('Missing');
    expect(() => store.get(Missing)).toThrow('Resource not found: Missing');
  });

  it('overwrites existing resource on re-insert', () => {
    const R = defineResource<number>('R');
    store.insert(R, 1);
    store.insert(R, 2);
    expect(store.get(R)).toBe(2);
  });

  it('remove deletes a resource', () => {
    const R = defineResource<number>('R');
    store.insert(R, 42);
    store.remove(R);
    expect(store.has(R)).toBe(false);
  });

  it('clear removes all resources', () => {
    const A = defineResource<number>('A');
    const B = defineResource<string>('B');
    store.insert(A, 1);
    store.insert(B, 'x');
    store.clear();
    expect(store.has(A)).toBe(false);
    expect(store.has(B)).toBe(false);
  });

  it('BUG: two resources with same name alias each other (DESIGN-3)', () => {
    // This documents the known bug: ResourceStore keys by name string
    const R1 = defineResource<number>('Shared');
    const R2 = defineResource<string>('Shared');
    store.insert(R1, 42);
    // R2 reads R1's value because they share the same name
    expect(store.get(R2)).toBe(42);
  });
});
