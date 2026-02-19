import type { EntityIndex } from './types.js';

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1; // 0xFFFFF
const GEN_MASK_12 = 0xFFF; // lower 12 bits of generation for handle packing

/**
 * Entity manager with generational IDs and free-list recycling.
 *
 * Entities are u32 indices into typed arrays. A separate Uint16Array
 * tracks generation counters. Destroyed indices are recycled via a free list.
 */
export class EntityManager {
  readonly maxEntities: number;

  /** Full 16-bit generation counter per slot */
  private generations: Uint16Array;

  /** Whether each slot is currently alive */
  private alive: Uint8Array;

  /** Free list of recycled indices */
  private freeList: number[] = [];

  /** Next fresh index (never been used) */
  private nextFresh: number = 0;

  /** Current count of alive entities */
  private _count: number = 0;

  constructor(maxEntities: number) {
    this.maxEntities = maxEntities;
    this.generations = new Uint16Array(maxEntities);
    this.alive = new Uint8Array(maxEntities);
  }

  get count(): number {
    return this._count;
  }

  /**
   * Spawn a new entity. Returns the raw index.
   * Throws if maxEntities is reached.
   */
  spawn(): EntityIndex {
    let index: number;

    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else if (this.nextFresh < this.maxEntities) {
      index = this.nextFresh++;
      this.generations[index] = 1; // first generation
    } else {
      throw new Error(`Entity limit reached (${this.maxEntities})`);
    }

    this.alive[index] = 1;
    this._count++;
    return index;
  }

  /**
   * Destroy an entity by index. Increments generation and recycles the slot.
   */
  destroy(index: EntityIndex): void {
    if (index < 0 || index >= this.nextFresh || !this.alive[index]) return;

    this.alive[index] = 0;
    // Increment full 16-bit generation, wrapping at 65535→0
    this.generations[index] = (this.generations[index] + 1) & 0xFFFF;
    this.freeList.push(index);
    this._count--;
  }

  /**
   * Check if an entity index is currently alive.
   */
  isAlive(index: EntityIndex): boolean {
    return index >= 0 && index < this.nextFresh && this.alive[index] === 1;
  }

  /**
   * Pack an entity index into a handle with generation.
   * handle = (genLow12 << 20) | index
   */
  packHandle(index: EntityIndex): number {
    const gen = this.generations[index] & GEN_MASK_12;
    return (gen << INDEX_BITS) | (index & INDEX_MASK);
  }

  /**
   * Unpack a handle into its index.
   */
  static unpackIndex(handle: number): EntityIndex {
    return handle & INDEX_MASK;
  }

  /**
   * Validate a handle against the current generation.
   */
  validateHandle(handle: number): boolean {
    const index = handle & INDEX_MASK;
    if (!this.isAlive(index)) return false;
    const packedGen = (handle >>> INDEX_BITS) & GEN_MASK_12;
    const currentGen = this.generations[index] & GEN_MASK_12;
    return packedGen === currentGen;
  }

  /**
   * Iterate all alive entity indices.
   */
  *aliveEntities(): IterableIterator<EntityIndex> {
    for (let i = 0; i < this.nextFresh; i++) {
      if (this.alive[i]) yield i;
    }
  }

  /**
   * Get all alive entity indices as an array.
   */
  getAliveEntities(): EntityIndex[] {
    const result: EntityIndex[] = [];
    for (let i = 0; i < this.nextFresh; i++) {
      if (this.alive[i]) result.push(i);
    }
    return result;
  }

  /**
   * Reset all entity state (for testing/reload).
   */
  reset(): void {
    this.generations.fill(0);
    this.alive.fill(0);
    this.freeList.length = 0;
    this.nextFresh = 0;
    this._count = 0;
  }
}
