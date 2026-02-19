/** Raw entity index (u32) used for direct typed array access */
export type EntityIndex = number;

/** Packed entity handle: (generation << 20) | index */
export type Entity = number;

/** Component ID assigned at defineComponent() time */
export type ComponentId = number;

/** Typed array constructors for component fields */
export const Types = {
  f32: Float32Array,
  i32: Int32Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  bool: Uint8Array,
} as const;

export type TypeName = keyof typeof Types;
export type TypedArrayConstructor = (typeof Types)[TypeName];
export type TypedArray = InstanceType<TypedArrayConstructor>;

/** Schema definition for a component */
export type ComponentSchema = Record<string, TypedArrayConstructor>;

/** Symbols for component metadata to avoid index signature conflicts */
export const COMP_ID = Symbol('comp_id');
export const COMP_NAME = Symbol('comp_name');
export const COMP_SCHEMA = Symbol('comp_schema');
export const COMP_IS_TAG = Symbol('comp_is_tag');

/**
 * A defined component with SoA field arrays accessible directly.
 * e.g., Position.x[eid] where Position.x is a Float32Array
 *
 * Metadata is stored via symbols to avoid index signature conflicts.
 */
export type ComponentDef<S extends ComponentSchema = ComponentSchema> = {
  readonly [COMP_ID]: ComponentId;
  readonly [COMP_NAME]: string;
  readonly [COMP_SCHEMA]: S;
  readonly [COMP_IS_TAG]: boolean;
} & {
  [K in keyof S]: InstanceType<S[K]>;
};

/** System execution context */
export interface SystemContext {
  entities: EntityIndex[];
  dt: number;
  resources: ResourceAccessor;
  events: EventAccessor;
  commands: Commands;
  world: WorldLike;
}

/** Resource type token */
export interface ResourceToken<T> {
  readonly __brand: unique symbol;
  readonly name: string;
}

/** Resource accessor for systems */
export interface ResourceAccessor {
  get<T>(token: ResourceToken<T>): T;
  has<T>(token: ResourceToken<T>): boolean;
}

/** Event type token */
export interface EventToken<T> {
  readonly __brand: unique symbol;
  readonly name: string;
}

/** Event accessor for systems */
export interface EventAccessor {
  emit<T>(token: EventToken<T>, data: T): void;
  read<T>(token: EventToken<T>): readonly T[];
}

/** Deferred commands */
export interface Commands {
  spawn(): EntityIndex;
  destroy(entity: EntityIndex): void;
  addComponent<S extends ComponentSchema>(entity: EntityIndex, comp: ComponentDef<S>, values?: Partial<{ [K in keyof S]: number }>): void;
  removeComponent(entity: EntityIndex, comp: ComponentDef): void;
}

/** Plugin interface */
export interface Plugin {
  name: string;
  depends?: string[];
  install(app: AppBuilder): void | (() => void);
}

/** App builder for plugin installation */
export interface AppBuilder {
  registerComponent(comp: ComponentDef): void;
  addStage(name: string, systems: SystemDef[], options?: StageOptions): void;
  addSystem(stage: string, system: SystemDef): void;
  insertResource<T>(token: ResourceToken<T>, value: T): void;
  addPlugin(plugin: Plugin): void;
}

/** System definition */
export interface SystemDef {
  name: string;
  query?: QueryDef;
  resources?: { read?: ResourceToken<unknown>[]; write?: ResourceToken<unknown>[] };
  execute: (ctx: SystemContext) => void;
}

/** Query definition */
export interface QueryDef {
  components: ComponentDef[];
  readComponents: ComponentDef[];
  writeComponents: ComponentDef[];
  notComponents: ComponentDef[];
  changedComponents: ComponentDef[];
}

/** Stage options */
export interface StageOptions {
  sequential?: boolean;
  after?: string;
  before?: string;
}

/** Minimal world interface for system context */
export interface WorldLike {
  spawn(): EntityIndex;
  destroy(entity: EntityIndex): void;
  isAlive(entity: EntityIndex): boolean;
  addComponent<S extends ComponentSchema>(entity: EntityIndex, comp: ComponentDef<S>, values?: Partial<{ [K in keyof S]: number }>): void;
  removeComponent(entity: EntityIndex, comp: ComponentDef): void;
  hasComponent(entity: EntityIndex, comp: ComponentDef): boolean;
  query(queryDef: QueryDef): EntityIndex[];
}

/** Engine configuration */
export interface EngineConfig {
  maxEntities?: number;
  fixedTimestep?: number;
  maxSubstepsPerFrame?: number;
  headless?: boolean;
  seed?: number;
  timeScale?: number;
}
