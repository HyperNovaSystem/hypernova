import { COMP_ID, COMP_NAME, COMP_SCHEMA, COMP_IS_TAG } from './types.js';
import type { ComponentId, ComponentSchema, ComponentDef, TypedArrayConstructor, TypedArray } from './types.js';

let nextComponentId: ComponentId = 0;

/**
 * Define a new component with SoA storage.
 *
 * Fields are accessible directly on the returned object:
 *   const Position = defineComponent('Position', { x: Types.f32, y: Types.f32 });
 *   Position.x[eid] = 42;  // direct typed array access
 *
 * Tag components (empty schema) use zero storage, tracked by archetype bitmask only.
 */
export function defineComponent<S extends ComponentSchema>(
  name: string,
  schema: S,
): ComponentDef<S> {
  const id = nextComponentId++;

  if (id >= 64) {
    throw new Error('Maximum 64 component types supported (bitmask limit)');
  }

  const isTag = Object.keys(schema).length === 0;

  // Create the component object with symbol-keyed metadata
  // Field arrays are assigned directly on the object (after initComponentStorage)
  const comp: any = {
    [COMP_ID]: id,
    [COMP_NAME]: name,
    [COMP_SCHEMA]: schema,
    [COMP_IS_TAG]: isTag,
  };

  return comp as ComponentDef<S>;
}

/**
 * Initialize component field storage for a given max entity count.
 * Creates typed arrays for each field and assigns them directly to the component.
 */
export function initComponentStorage(
  comp: ComponentDef,
  maxEntities: number,
): void {
  if (comp[COMP_IS_TAG]) return;

  for (const [fieldName, TypedArrayCtor] of Object.entries(comp[COMP_SCHEMA])) {
    (comp as any)[fieldName] =
      new (TypedArrayCtor as TypedArrayConstructor)(maxEntities);
  }
}

/**
 * Set component field values for an entity.
 */
export function setComponentValues<S extends ComponentSchema>(
  comp: ComponentDef<S>,
  entity: number,
  values?: Partial<{ [K in keyof S]: number }>,
): void {
  if (comp[COMP_IS_TAG] || !values) return;

  for (const [fieldName, value] of Object.entries(values)) {
    const arr = (comp as any)[fieldName] as TypedArray | undefined;
    if (arr) {
      arr[entity] = value as number;
    }
  }
}

/**
 * Clear component field values for an entity (zero them out).
 */
export function clearComponentValues(comp: ComponentDef, entity: number): void {
  if (comp[COMP_IS_TAG]) return;

  for (const fieldName of Object.keys(comp[COMP_SCHEMA])) {
    const arr = (comp as any)[fieldName] as TypedArray | undefined;
    if (arr) {
      arr[entity] = 0;
    }
  }
}

/**
 * Reset the component ID counter (for testing only).
 */
export function resetComponentIds(): void {
  nextComponentId = 0;
}
