import { describe, it, expect, beforeEach } from 'vitest';
import { defineEvent, EventStore } from '../src/core/events.js';

describe('EventStore', () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  it('events are not readable in the same stage they are emitted', () => {
    const Damage = defineEvent<{ amount: number }>('Damage');
    store.emit(Damage, { amount: 10 });
    expect(store.read(Damage)).toEqual([]);
  });

  it('events become readable after flushStage', () => {
    const Damage = defineEvent<{ amount: number }>('Damage');
    store.emit(Damage, { amount: 10 });
    store.flushStage();
    expect(store.read(Damage)).toEqual([{ amount: 10 }]);
  });

  it('accumulates events across multiple emits', () => {
    const Hit = defineEvent<number>('Hit');
    store.emit(Hit, 1);
    store.emit(Hit, 2);
    store.flushStage();
    expect(store.read(Hit)).toEqual([1, 2]);
  });

  it('events from multiple stages accumulate in the read buffer', () => {
    const Ev = defineEvent<string>('Ev');

    store.emit(Ev, 'a');
    store.flushStage();

    store.emit(Ev, 'b');
    store.flushStage();

    expect(store.read(Ev)).toEqual(['a', 'b']);
  });

  it('clearFrame clears all buffers', () => {
    const Ev = defineEvent<number>('Ev');
    store.emit(Ev, 1);
    store.flushStage();
    expect(store.read(Ev)).toEqual([1]);

    store.clearFrame();
    expect(store.read(Ev)).toEqual([]);
  });

  it('returns empty array for never-emitted event types', () => {
    const Never = defineEvent<void>('Never');
    expect(store.read(Never)).toEqual([]);
  });

  it('different event types are independent', () => {
    const A = defineEvent<number>('A');
    const B = defineEvent<string>('B');

    store.emit(A, 42);
    store.emit(B, 'hello');
    store.flushStage();

    expect(store.read(A)).toEqual([42]);
    expect(store.read(B)).toEqual(['hello']);
  });

  it('clear removes all data and buffers', () => {
    const Ev = defineEvent<number>('Ev');
    store.emit(Ev, 1);
    store.flushStage();
    store.clear();

    expect(store.read(Ev)).toEqual([]);
  });
});
