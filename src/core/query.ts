import { COMP_ID } from './types.js';
import type { ComponentDef, QueryDef, EntityIndex } from './types.js';

/**
 * Build a query definition using a fluent API.
 *
 * query(Position, Velocity).read(Position).write(Velocity).not(IsDead)
 */
export function query(...components: ComponentDef[]): QueryBuilder {
  return new QueryBuilder(components);
}

class QueryBuilder implements QueryDef {
  components: ComponentDef[];
  readComponents: ComponentDef[] = [];
  writeComponents: ComponentDef[] = [];
  notComponents: ComponentDef[] = [];
  changedComponents: ComponentDef[] = [];

  constructor(components: ComponentDef[]) {
    this.components = components;
    // By default, all queried components are readable
    this.readComponents = [...components];
  }

  read(...comps: ComponentDef[]): this {
    for (const c of comps) {
      if (!this.readComponents.includes(c)) {
        this.readComponents.push(c);
      }
    }
    return this;
  }

  write(...comps: ComponentDef[]): this {
    for (const c of comps) {
      if (!this.writeComponents.includes(c)) {
        this.writeComponents.push(c);
      }
    }
    return this;
  }

  not(...comps: ComponentDef[]): this {
    for (const c of comps) {
      if (!this.notComponents.includes(c)) {
        this.notComponents.push(c);
      }
    }
    return this;
  }

  changed(...comps: ComponentDef[]): this {
    for (const c of comps) {
      if (!this.changedComponents.includes(c)) {
        this.changedComponents.push(c);
      }
    }
    return this;
  }
}

/**
 * Archetype-based query executor.
 * Matches entities whose component bitmask includes all required
 * components and excludes all "not" components.
 */
export class QueryExecutor {
  private archetypes: Uint32Array; // 2 u32s per entity for 64-bit mask
  private maxEntities: number;

  constructor(maxEntities: number) {
    this.maxEntities = maxEntities;
    // Two u32 words per entity to support up to 64 components
    this.archetypes = new Uint32Array(maxEntities * 2);
  }

  /**
   * Add a component bit to an entity's archetype.
   */
  addBit(entity: EntityIndex, componentId: number): void {
    const word = componentId < 32 ? 0 : 1;
    const bit = componentId < 32 ? componentId : componentId - 32;
    this.archetypes[entity * 2 + word] |= (1 << bit);
  }

  /**
   * Remove a component bit from an entity's archetype.
   */
  removeBit(entity: EntityIndex, componentId: number): void {
    const word = componentId < 32 ? 0 : 1;
    const bit = componentId < 32 ? componentId : componentId - 32;
    this.archetypes[entity * 2 + word] &= ~(1 << bit);
  }

  /**
   * Check if an entity has a specific component.
   */
  hasBit(entity: EntityIndex, componentId: number): boolean {
    const word = componentId < 32 ? 0 : 1;
    const bit = componentId < 32 ? componentId : componentId - 32;
    return (this.archetypes[entity * 2 + word] & (1 << bit)) !== 0;
  }

  /**
   * Clear all bits for an entity (on destroy).
   */
  clearEntity(entity: EntityIndex): void {
    this.archetypes[entity * 2] = 0;
    this.archetypes[entity * 2 + 1] = 0;
  }

  /**
   * Execute a query against a set of alive entities.
   */
  execute(queryDef: QueryDef, aliveEntities: EntityIndex[]): EntityIndex[] {
    // Build bitmasks for required and excluded components
    let reqLo = 0, reqHi = 0;
    let notLo = 0, notHi = 0;

    for (const comp of queryDef.components) {
      const id = comp[COMP_ID];
      if (id < 32) reqLo |= (1 << id);
      else reqHi |= (1 << (id - 32));
    }

    for (const comp of queryDef.notComponents) {
      const id = comp[COMP_ID];
      if (id < 32) notLo |= (1 << id);
      else notHi |= (1 << (id - 32));
    }

    const results: EntityIndex[] = [];

    for (const eid of aliveEntities) {
      const lo = this.archetypes[eid * 2];
      const hi = this.archetypes[eid * 2 + 1];

      // Must have all required bits
      if ((lo & reqLo) !== reqLo) continue;
      if ((hi & reqHi) !== reqHi) continue;

      // Must not have any excluded bits
      if ((lo & notLo) !== 0) continue;
      if ((hi & notHi) !== 0) continue;

      results.push(eid);
    }

    return results;
  }

  /**
   * Reset all archetype data.
   */
  reset(): void {
    this.archetypes.fill(0);
  }
}
