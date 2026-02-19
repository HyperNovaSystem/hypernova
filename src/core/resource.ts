import type { ResourceToken } from './types.js';

/**
 * Define a typed resource token.
 * Resources are global singletons stored on the world.
 */
export function defineResource<T>(name: string): ResourceToken<T> {
  return { name } as ResourceToken<T>;
}

/**
 * Resource storage. Maps resource tokens to values.
 */
export class ResourceStore {
  private store = new Map<string, unknown>();

  insert<T>(token: ResourceToken<T>, value: T): void {
    this.store.set(token.name, value);
  }

  get<T>(token: ResourceToken<T>): T {
    const value = this.store.get(token.name);
    if (value === undefined) {
      throw new Error(`Resource not found: ${token.name}`);
    }
    return value as T;
  }

  has<T>(token: ResourceToken<T>): boolean {
    return this.store.has(token.name);
  }

  remove<T>(token: ResourceToken<T>): void {
    this.store.delete(token.name);
  }

  clear(): void {
    this.store.clear();
  }
}
