# 3. ECS-First Architecture

## Overview

HyperNova's ECS is the backbone of the engine.
Every simulation object is an entity (a numeric ID).
All data lives in components (plain typed arrays).
All logic lives in systems (functions that query and mutate component data).

## Entities

An entity is identified by a **u32 index** (0 to `maxEntities - 1`) used directly as a typed array index.
A separate `Uint16Array` tracks **generation counters** per index.
When an entity is destroyed and its index recycled, the generation increments.
Any handle still holding the old generation is detected as stale, preventing use-after-destroy bugs.

External entity handles encode both index and generation into a single safe JavaScript integer:
`handle = (generation << 20) | index`, supporting up to ~1M entities and 4096 generations before wrap.
Internal hot-path code uses the raw index for array access. The generation check happens only at API boundaries (stale handle detection).

```typescript
const player = world.spawn();        // index: 0, generation: 1
const enemy = world.spawn();         // index: 1, generation: 1
world.destroy(enemy);
const reused = world.spawn();        // index: 1, generation: 2
world.isAlive(enemy);                // false — generation mismatch
```

Entities have no data and no behavior of their own.
They are created, destroyed, and recycled by the world.

`world.spawn()` returns an `Entity` directly. If `maxEntities` is reached, the engine halts (fatal error). For cases where exhaustion is expected and recoverable, `world.trySpawn()` returns `Result<Entity, EngineError>`. The builder pattern (`world.spawn().add(...)`) chains on the direct `spawn()` API.

## Components

Components are pure data with no methods.
They are defined as schemas and stored internally as Struct-of-Arrays (SoA) for cache-friendly access.

```typescript
import { defineComponent, Types } from '@nova/core';

const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

const Health = defineComponent({
  current: Types.f32,
  max: Types.f32,
});

// Tag components (no data, just flags — zero arena allocation, tracked by archetype bitmask only)
const IsPlayer = defineComponent({});
const IsDead = defineComponent({});
```

Component storage uses **global Struct-of-Arrays (column-per-field)** under the hood.
Each field defined in a component schema becomes a single global typed array sized to `maxEntities`.
`Position.x` is one `Float32Array`, `Position.y` is another.
Entity IDs index directly into these arrays — `Position.x[eid]` is a single typed array read with no indirection.

This gives us:
- **Direct access** — `Position.x[eid]` works exactly as written, with no entity-to-row lookup.
- **Cache-friendly iteration** — systems iterate a list of matching entity IDs; sequential field access within a single array is prefetcher-friendly.
- **Zero-cost component add/remove** — adding or removing a component flips a bit in the entity's archetype mask. No data is moved between tables.

Destroyed entity indices are recycled via a free list. The typed arrays have "holes" at destroyed indices, but this is harmless — iteration uses query result lists, never raw array walks. For the entity counts typical of 2D simulations (<100K), the memory overhead of pre-allocated arrays is negligible.

> **Entity limit.** The handle packing `(gen << 20) | index` supports ~1M entities with 4096 generations. For simulations exceeding 1M agents, use raw SoA arrays managed by a custom system (bypassing entity overhead), or GPU compute buffers via `@nova/renderer-webgpu`. GPU particles and tilemaps are not entities — they live in GPU buffers with no entity limit.

**String fields** (`Types.string`) use string interning: a global `StringTable` maps strings to integer indices, and `Types.string` fields are backed by `Uint32Array` storing intern indices (index 0 = empty string). String resolution is deferred to point-of-use. The StringTable grows monotonically — interned strings are never freed. For the typical use case (scene metadata, entity names, prefab IDs), the table size is bounded by content and doesn't grow per-frame. If a use case requires frequent unique strings, use a resource (`Map<Entity, string>`) instead of a `Types.string` component field.

**Archetype query resolution.** Each entity has an archetype — a bitmask representing its current set of components. When a query like `world.query(Position, Velocity)` executes, the engine finds all entities whose archetype mask includes both component bits and returns their IDs. Archetype masks update only when components are added or removed (not per-frame). Query results are cached and invalidated on structural changes.

## Systems

Systems are functions registered with the world.
They declare which components they read and write via `query(...).read(...).write(...)`, enabling automatic scheduling and dependency analysis. Component access declarations live on the query — there are no separate top-level `reads`/`writes` fields.

Every system's `execute` receives a single **context object** with a consistent shape:

```typescript
import { defineSystem, query } from '@nova/core';

const MovementSystem = defineSystem({
  name: 'Movement',
  query: query(Position, Velocity).write(Position).read(Velocity),
  execute({ entities, dt }) {
    for (const eid of entities) {
      Position.x[eid] += Velocity.x[eid] * dt;
      Position.y[eid] += Velocity.y[eid] * dt;
    }
  },
});
```

The context object always provides:

| Field | Type | Description |
|---|---|---|
| `entities` | `Entity[]` | Entities matching the system's query |
| `dt` | `number` | Fixed timestep delta (seconds) |
| `resources` | `Resources` | Typed resource access |
| `events` | `EventAccessor` | Typed event read/emit (see [Events](./06-typescript.md#events)) |
| `commands` | `Commands` | Deferred entity spawn/destroy/modify |

## Queries

Queries select entities that match a component signature.
They support filtering, optional components, and change detection.

```typescript
// All entities with Position AND Velocity
const movers = world.query(Position, Velocity);

// All entities with Health but NOT IsDead
const alive = world.query(Health).not(IsDead);

// Only entities whose Health changed this frame
const damaged = world.query(Health).changed(Health);
```

`.changed(Component)` uses **double-buffered snapshot comparison**: at frame end, each tracked field's live typed array is copied into a snapshot (`snapshot.set(liveArray)` — a memcpy). At query resolution time, `liveArray[eid] !== snapshot[eid]` is checked per archetype-matched entity. Multi-field components short-circuit on first difference.

Snapshots are allocated **only** for components referenced in a `.changed()` query — zero cost when unused. The scheduler's write-set serves as a free coarse pre-filter: if no system that writes the component ran this frame, the comparison is skipped entirely.

This comparison utility is shared with `@nova/net` delta compression and `@nova/devtools` time-travel debugging.

## System Scheduling

Systems are organized into stages that run in a defined order within each fixed update:

```typescript
const engine = new Engine();

engine.addStage('input', [InputGatherSystem]);
engine.addStage('pre-physics', [MovementSystem, AISystem]);
engine.addStage('physics', [PhysicsSyncSystem, PhysicsStepSystem]);
engine.addStage('spatial', [SpatialIndexSystem]);
engine.addStage('post-physics', [CollisionResponseSystem]);
engine.addStage('gameplay', [DamageSystem, DeathSystem, SpawnSystem]);
engine.addStage('render-prep', [SpriteAnimationSystem, CameraSystem]);
```

Within a stage, the scheduler builds a **dependency graph** from each system's read/write declarations.
Two systems conflict if either writes a component or resource that the other reads or writes.
Non-conflicting systems are grouped into **independent batches** via topological sort.

The scheduler executes batches sequentially on the main thread:

```
Stage: pre-physics
  Batch 0: [MovementSystem, AISystem]   → execute sequentially
  Batch 1: [CollisionPrepSystem]        → execute sequentially
  ... next stage
```

1. **Build batches** — topological sort of the dependency graph (computed once at stage construction, rebuilt only when systems are added or removed).
2. **Execute** — for each batch, run all systems in the batch sequentially on the main thread.
3. **Flush commands** — deferred commands (entity spawn/destroy, component add/remove) are flushed between stages. No structural changes occur mid-stage.
4. **Repeat** — until all batches in the stage are complete, then flush commands and advance to the next stage.

The dependency graph and batching are valuable even without parallelism: they guarantee correct execution ordering and prevent accidental data races, making it safe to add or reorder systems without worrying about implicit dependencies.

**Explicit ordering.** A stage can be forced into registration-order execution (skipping dependency analysis) when systems must run in a specific sequence:

```typescript
engine.addStage('gameplay', [DamageSystem, DeathSystem, SpawnSystem], {
  sequential: true, // force registration-order execution
});
```

**Command flush semantics.** Deferred commands are flushed **between stages**, not between batches within a stage. This means all systems within a stage see a consistent world — no entity will appear or disappear mid-stage. Commands are applied in the order they were issued (per system registration order within the stage).

**Event visibility.** Each event type (see [Events](./06-typescript.md#events)) is backed by a double-buffered ring: a **write** buffer and a **read** buffer. Systems emit into the write buffer via `events.emit()`; systems consume from the read buffer via `events.read()`. At each stage boundary the write buffer is merged into the read buffer so that events emitted in stage N become visible to systems in stage N+1 and all later stages within the same frame. Events emitted within a stage are *not* visible to sibling systems in that stage. At the frame boundary all buffers are cleared (cursor reset — no deallocation). This prevents ordering-dependent behavior within a stage while preserving deterministic cross-stage communication.

The `@nova/devtools` profiler visualizes stage and batch execution timelines, highlights per-system execution time, and reports frame budget usage.

> **Workers.** HyperNova uses Web Workers for **background tasks** — pathfinding, proc-gen, autosave — via `@nova/workers` ([Background Workers](./11-background-workers.md)).  These are async operations with results arriving on the next frame via the event system.  ECS system execution itself runs on the main thread.  See [Background Workers](./11-background-workers.md) for the worker architecture.

## Component Storage

Component field arrays (the global typed arrays that hold all component data) are allocated from a contiguous `ArrayBuffer` arena at `defineComponent()` time.  Each field gets a typed array view (`Float32Array`, `Uint32Array`, etc.) over a region of the arena, sized to `maxEntities`.

```
Component storage arena
┌──────────────────────────────────────────────────────────┐
│  Position.x   Float32Array[maxEntities]                  │
│  Position.y   Float32Array[maxEntities]                  │
│  Velocity.x   Float32Array[maxEntities]                  │
│  Velocity.y   Float32Array[maxEntities]                  │
│  Health.cur   Float32Array[maxEntities]                   │
│  Health.max   Float32Array[maxEntities]                   │
│  ... one array per defined component field                │
└──────────────────────────────────────────────────────────┘
```

**Why an arena?** Allocating all component storage from a single buffer provides:
- **Cache locality** — field arrays are packed contiguously, improving prefetch behavior.
- **Predictable memory usage** — one large allocation instead of many small typed arrays. For 50K max entities with 20 `f32` fields: 4 MB.
- **WASM interop** — the arena can be backed by `SharedArrayBuffer` if needed, enabling future WASM system implementations to operate directly on component memory without copying.
- **Stability** — field arrays are allocated once at startup, sized to `maxEntities`. No per-frame growth or reallocation. All typed array views remain valid for the lifetime of the engine.
- **Growth** — the arena uses a growable `ArrayBuffer` (ES2024 `ArrayBuffer.prototype.resize()`) with a pre-declared `maxByteLength`, reserved for late-registered components. Typed array views over a resizable buffer automatically track the new size. When `resize()` is unavailable, the arena falls back to allocate-and-copy (only triggered by `defineComponent()` after startup, never during gameplay).

The arena is sized with a configurable initial capacity and max capacity:

```typescript
const engine = new Engine({
  maxEntities: 50_000,                   // default: 50,000 — sets typed array sizes
  arenaInitialSize: 4 * 1024 * 1024,   // 4 MB initial
  arenaMaxSize: 64 * 1024 * 1024,      // 64 MB ceiling
});
```

## Resources

Global singleton data that doesn't belong to any entity — time, input state, physics world handle — is stored as **typed resources** on the world.

Resources are defined with `defineResource` for full type safety — no string keys.

```typescript
import { defineResource } from '@nova/core';

const Time = defineResource<{ dt: number; elapsed: number; frame: number }>();
const InputState = defineResource<{ axes: Map<string, Vec2>; pressed: Set<string> }>();

world.insertResource(Time, { dt: 0, elapsed: 0, frame: 0 });
world.insertResource(InputState, inputState);

// Access in systems — fully typed, no casting
const time = world.getResource(Time);  // { dt: number; elapsed: number; frame: number }
```

Systems declare resource access in their definition for scheduling analysis:

```typescript
const TimerSystem = defineSystem({
  name: 'Timer',
  resources: { read: [Time], write: [] },
  execute({ resources }) {
    const time = resources.get(Time);
    // ...
  },
});
```

## Deterministic PRNG

`Math.random()` is non-deterministic across engines and sessions. Any simulation that uses randomness — AI decisions, particle spawning, procedural generation, damage rolls — must use the engine's seeded PRNG to preserve determinism.

`@nova/core` provides a `Random` resource backed by a seeded xoshiro256** implementation:

```typescript
import { Random } from '@nova/core';

const rng = resources.get(Random);
rng.float();                // [0, 1)
rng.range(1, 6);            // integer in [1, 6]
rng.rangeFloat(0.5, 2.0);   // float in [0.5, 2.0)
rng.vec2(magnitude);         // random unit vector * magnitude
rng.chance(0.3);             // true 30% of the time
rng.pick(array);             // random element
rng.shuffle(array);          // Fisher-Yates in-place
rng.fork('ai');              // independent sub-stream (deterministic, named)
```

The seed is stored in the `Random` resource and is:
- Included in `@nova/persist` snapshots (deterministic restore)
- Transmitted with `@nova/net` state sync (deterministic multiplayer)
- Set explicitly for deterministic runs: `new Engine({ seed: 42 })`
- Defaults to `Date.now()` when not specified

Systems that need independent random sequences use `rng.fork(label)` to create sub-streams that don't interfere with each other's consumption order.

## Simulation Parameters

Simulations benefit from runtime-configurable parameters — sliders for gravity, spawn rates, AI weights, etc. `@nova/core` provides a typed parameter API with metadata for automatic UI generation:

```typescript
import { defineParameter, Parameters } from '@nova/core';

const Gravity = defineParameter({
  name: 'Gravity',
  type: 'f32',
  default: 400,
  range: [0, 2000],
  step: 10,
  group: 'Physics',
});

const SpawnRate = defineParameter({
  name: 'Spawn Rate',
  type: 'f32',
  default: 5,
  range: [0, 100],
  group: 'Simulation',
});

// In a system:
const params = resources.get(Parameters);
const g = params.get(Gravity);        // number — fully typed
const rate = params.get(SpawnRate);
```

Parameters are typed resources with additional metadata (`range`, `step`, `group`) that `@nova/devtools` uses to auto-generate a tuning panel. Parameter presets can be saved/loaded as JSON files.

Parameters can be changed at runtime without restarting the simulation. In headless mode, parameters are set via the `Engine` config or loaded from a preset file:

```typescript
const engine = new Engine({
  headless: true,
  parameters: { Gravity: 800, 'Spawn Rate': 20 },
});
```

## Entity Hierarchy

Simulations and games universally need parent-child relationships — a weapon attached to a character, UI elements nested in panels, particles anchored to an emitter.

HyperNova provides hierarchy through built-in components:

```typescript
import { Parent, Children } from '@nova/core';

// Attach a weapon to the player
const sword = world.spawn();
world.addComponent(sword, Position, { x: 16, y: 0 });
world.addComponent(sword, Parent, { entity: player });
// Children component is automatically added/updated on the parent
```

**Transform model:** `Position` is always **local** — relative to the entity's parent (or world-space if no parent). A built-in `TransformPropagationSystem` runs in `render-prep` and computes `WorldTransform` (absolute position/rotation/scale) by walking the parent chain. The renderer reads `WorldTransform` for drawing. Gameplay systems read/write `Position` (local). Physics syncs to `Position`.

For root entities (no parent), `Position` = world position and `WorldTransform` mirrors it directly (no transform math).

```typescript
// Position is the local transform — always present on placed entities
const Position = defineComponent({ x: Types.f32, y: Types.f32 });

// WorldTransform is computed by TransformPropagationSystem — read-only for game code
const WorldTransform = defineComponent({ x: Types.f32, y: Types.f32, rotation: Types.f32, scaleX: Types.f32, scaleY: Types.f32 });
```

**Destroy cascades:** Destroying a parent entity destroys all descendants. This can be disabled per-entity with the `OrphanOnDestroy` tag component.

**Spawn builder for hierarchies:**

```typescript
world.spawn()
  .add(Position, { x: 400, y: 300 })
  .add(Sprite, { texture: 'player', width: 32, height: 32 })
  .add(Player, {})
  .withChild(child => child
    .add(Position, { x: 16, y: 0 })
    .add(Sprite, { texture: 'sword', width: 16, height: 16 })
  );
```
