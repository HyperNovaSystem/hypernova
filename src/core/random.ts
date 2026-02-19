import { defineResource } from './resource.js';
import type { ResourceToken } from './types.js';

/**
 * Deterministic PRNG using xoshiro128** algorithm.
 * (128-bit state fits cleanly in JS numbers without BigInt overhead)
 *
 * Seeded, deterministic, serializable. Provides the Random resource.
 */
export class Random {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // Initialize state from seed using SplitMix32
    let s = seed | 0;
    this.s0 = Random.splitmix32(s); s = this.s0;
    this.s1 = Random.splitmix32(s); s = this.s1;
    this.s2 = Random.splitmix32(s); s = this.s2;
    this.s3 = Random.splitmix32(s);

    // Ensure state is not all zeros
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = 1;
    }
  }

  private static splitmix32(s: number): number {
    s = (s + 0x9e3779b9) | 0;
    s = Math.imul(s ^ (s >>> 16), 0x85ebca6b);
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
    return (s ^ (s >>> 16)) >>> 0;
  }

  private static rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  private next(): number {
    const result = (Math.imul(Random.rotl(Math.imul(this.s1, 5), 7), 9)) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;

    this.s2 ^= t;
    this.s3 = Random.rotl(this.s3, 11);

    // Keep all values as unsigned 32-bit
    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    this.s3 >>>= 0;

    return result;
  }

  /** Random float in [0, 1) */
  float(): number {
    return this.next() / 0x100000000;
  }

  /** Random integer in [min, max] (inclusive) */
  range(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }

  /** Random float in [min, max) */
  rangeFloat(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Random boolean with given probability (default 0.5) */
  chance(probability: number = 0.5): boolean {
    return this.float() < probability;
  }

  /** Pick a random element from an array */
  pick<T>(array: readonly T[]): T {
    return array[this.range(0, array.length - 1)];
  }

  /** Fisher-Yates in-place shuffle */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.range(0, i);
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  /** Random unit vector scaled by magnitude */
  vec2(magnitude: number = 1): { x: number; y: number } {
    const angle = this.float() * Math.PI * 2;
    return {
      x: Math.cos(angle) * magnitude,
      y: Math.sin(angle) * magnitude,
    };
  }

  /** Create an independent sub-stream (deterministic fork) */
  fork(label: string): Random {
    // Hash the label to create a seed offset
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = Math.imul(hash ^ label.charCodeAt(i), 0x5bd1e995);
      hash ^= hash >>> 15;
    }
    return new Random(this.next() ^ hash);
  }

  /** Get serializable state */
  getState(): { s0: number; s1: number; s2: number; s3: number } {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  /** Restore from serialized state */
  setState(state: { s0: number; s1: number; s2: number; s3: number }): void {
    this.s0 = state.s0;
    this.s1 = state.s1;
    this.s2 = state.s2;
    this.s3 = state.s3;
  }
}

/** Resource token for the Random PRNG */
export const RandomResource: ResourceToken<Random> = defineResource<Random>('Random');
