import { EntityManager } from './entity.js';
import { initComponentStorage, setComponentValues, clearComponentValues } from './component.js';
import { QueryExecutor } from './query.js';
import { ResourceStore } from './resource.js';
import { EventStore } from './events.js';
import { COMP_ID } from './types.js';
import type {
  EntityIndex, ComponentDef, ComponentSchema, QueryDef,
  ResourceToken, EventToken, SystemDef, StageOptions,
  SystemContext, WorldLike, Commands,
} from './types.js';

interface DeferredCommand {
  type: 'spawn' | 'destroy' | 'addComponent' | 'removeComponent';
  entity: EntityIndex;
  component?: ComponentDef;
  values?: Record<string, number>;
}

interface Stage {
  name: string;
  systems: SystemDef[];
  options: StageOptions;
}

/**
 * The ECS World. Manages entities, components, systems, resources, and events.
 */
export class World implements WorldLike {
  readonly entities: EntityManager;
  readonly queryExecutor: QueryExecutor;
  readonly resources: ResourceStore;
  readonly events: EventStore;

  private maxEntities: number;
  private registeredComponents: ComponentDef[] = [];
  private stages: Stage[] = [];
  private deferredCommands: DeferredCommand[] = [];

  /** Cache for query results, invalidated on structural changes */
  private queryCache = new Map<string, EntityIndex[]>();
  private structuralChangeFlag = false;

  constructor(maxEntities: number = 50_000) {
    this.maxEntities = maxEntities;
    this.entities = new EntityManager(maxEntities);
    this.queryExecutor = new QueryExecutor(maxEntities);
    this.resources = new ResourceStore();
    this.events = new EventStore();
  }

  // ─── Entity Management ───

  spawn(): EntityIndex {
    const eid = this.entities.spawn();
    this.structuralChangeFlag = true;
    return eid;
  }

  destroy(entity: EntityIndex): void {
    if (!this.entities.isAlive(entity)) return;
    this.queryExecutor.clearEntity(entity);
    // Clear component data for all registered components
    for (const comp of this.registeredComponents) {
      clearComponentValues(comp, entity);
    }
    this.entities.destroy(entity);
    this.structuralChangeFlag = true;
  }

  isAlive(entity: EntityIndex): boolean {
    return this.entities.isAlive(entity);
  }

  // ─── Component Management ───

  registerComponent<S extends ComponentSchema>(comp: ComponentDef<S>): void {
    if (this.registeredComponents.includes(comp)) return;
    initComponentStorage(comp, this.maxEntities);
    this.registeredComponents.push(comp);
  }

  addComponent<S extends ComponentSchema>(
    entity: EntityIndex,
    comp: ComponentDef<S>,
    values?: Partial<{ [K in keyof S]: number }>,
  ): void {
    if (!this.entities.isAlive(entity)) return;

    // Auto-register the component if not already registered
    if (!this.registeredComponents.includes(comp)) {
      this.registerComponent(comp);
    }

    this.queryExecutor.addBit(entity, comp[COMP_ID]);
    if (values) {
      setComponentValues(comp, entity, values);
    }
    this.structuralChangeFlag = true;
  }

  removeComponent(entity: EntityIndex, comp: ComponentDef): void {
    if (!this.entities.isAlive(entity)) return;
    this.queryExecutor.removeBit(entity, comp[COMP_ID]);
    clearComponentValues(comp, entity);
    this.structuralChangeFlag = true;
  }

  hasComponent(entity: EntityIndex, comp: ComponentDef): boolean {
    return this.queryExecutor.hasBit(entity, comp[COMP_ID]);
  }

  // ─── Queries ───

  query(queryDef: QueryDef): EntityIndex[] {
    // Generate cache key from component IDs
    const key = this.getQueryKey(queryDef);

    if (!this.structuralChangeFlag && this.queryCache.has(key)) {
      return this.queryCache.get(key)!;
    }

    const alive = this.entities.getAliveEntities();
    const results = this.queryExecutor.execute(queryDef, alive);
    this.queryCache.set(key, results);
    return results;
  }

  private getQueryKey(queryDef: QueryDef): string {
    const req = queryDef.components.map(c => c[COMP_ID]).sort().join(',');
    const not = queryDef.notComponents.map(c => c[COMP_ID]).sort().join(',');
    return `${req}|${not}`;
  }

  // ─── Stages & Systems ───

  addStage(name: string, systems: SystemDef[], options: StageOptions = {}): void {
    // Check for "after" and "before" constraints
    let insertIndex = this.stages.length;

    if (options.after) {
      const afterIdx = this.stages.findIndex(s => s.name === options.after);
      if (afterIdx !== -1) insertIndex = afterIdx + 1;
    }
    if (options.before) {
      const beforeIdx = this.stages.findIndex(s => s.name === options.before);
      if (beforeIdx !== -1) insertIndex = Math.min(insertIndex, beforeIdx);
    }

    this.stages.splice(insertIndex, 0, { name, systems, options });
  }

  addSystem(stageName: string, system: SystemDef): void {
    const stage = this.stages.find(s => s.name === stageName);
    if (stage) {
      stage.systems.push(system);
    } else {
      this.addStage(stageName, [system]);
    }
  }

  // ─── Tick ───

  /**
   * Execute one simulation tick. Runs all stages in order,
   * flushing events and deferred commands between stages.
   */
  tick(dt: number): void {
    // Clear events from last frame
    this.events.clearFrame();
    this.structuralChangeFlag = false;

    const commands = this.createCommands();

    for (const stage of this.stages) {
      // Run all systems in the stage
      for (const system of stage.systems) {
        const entities = system.query
          ? this.query(system.query)
          : [];

        const ctx: SystemContext = {
          entities,
          dt,
          resources: this.resources,
          events: this.events,
          commands,
          world: this,
        };

        system.execute(ctx);
      }

      // Flush events between stages
      this.events.flushStage();

      // Flush deferred commands between stages
      this.flushCommands();
    }

    // Clear query cache at end of tick
    this.queryCache.clear();
  }

  private createCommands(): Commands {
    return {
      spawn: () => {
        const eid = this.spawn();
        return eid;
      },
      destroy: (entity: EntityIndex) => {
        this.deferredCommands.push({ type: 'destroy', entity });
      },
      addComponent: <S extends ComponentSchema>(entity: EntityIndex, comp: ComponentDef<S>, values?: Partial<{ [K in keyof S]: number }>) => {
        this.deferredCommands.push({
          type: 'addComponent',
          entity,
          component: comp,
          values: values as Record<string, number>,
        });
      },
      removeComponent: (entity: EntityIndex, comp: ComponentDef) => {
        this.deferredCommands.push({ type: 'removeComponent', entity, component: comp });
      },
    };
  }

  private flushCommands(): void {
    for (const cmd of this.deferredCommands) {
      switch (cmd.type) {
        case 'destroy':
          this.destroy(cmd.entity);
          break;
        case 'addComponent':
          if (cmd.component) {
            this.addComponent(cmd.entity, cmd.component, cmd.values as any);
          }
          break;
        case 'removeComponent':
          if (cmd.component) {
            this.removeComponent(cmd.entity, cmd.component);
          }
          break;
      }
    }
    this.deferredCommands.length = 0;
  }

  // ─── Resource Shortcuts ───

  insertResource<T>(token: ResourceToken<T>, value: T): void {
    this.resources.insert(token, value);
  }

  getResource<T>(token: ResourceToken<T>): T {
    return this.resources.get(token);
  }

  // ─── Reset ───

  reset(): void {
    this.entities.reset();
    this.queryExecutor.reset();
    this.resources.clear();
    this.events.clear();
    this.stages.length = 0;
    this.deferredCommands.length = 0;
    this.queryCache.clear();
    this.registeredComponents.length = 0;
  }
}
