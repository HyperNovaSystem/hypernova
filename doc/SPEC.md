# HyperNova Engine
## A Modular Simulation Engine

> An ECS-first, WebGPU-powered simulation engine built for browsers and Electron — equally suited to games, interactive simulations, and data-driven visualization and control-systems.

---

## Table of Contents

### Core Design

1. [Design Philosophy](./01-design-philosophy.md) — Simulation-first, composition over inheritance, ship only what you use, DX as a feature
2. [Architecture Overview](./02-architecture-overview.md) — Simulation loop, headless mode, time control, package boundary rules

### Engine Core

3. [ECS-First Architecture](./03-ecs-architecture.md) — Entities, components, systems, queries, scheduling, resources, hierarchy
4. [Modular Package System](./04-package-system.md) — `@nova/core`, renderer, physics, input, audio, assets, tilemap, particles, animation, UI, net, recorder, devtools

### Rendering & Type System

5. [Renderer — WebGPU First](./05-renderer.md) — WebGPU, fallback strategy, render pipeline, compute shaders, custom materials
6. [TypeScript From the Ground Up](./06-typescript.md) — Type safety, events, generic components, build tooling

### Simulation

7. [Physics — Rapier2D (WASM)](./07-physics.md) — Why Rapier, configuration, collision events
8. [Async Asset Pipeline](./08-asset-pipeline.md) — Loading lifecycle, progressive loading, dev mode hot reload

### Multiplayer & Persistence

9. [Networking Primitives](./09-networking.md) — Architecture patterns, snapshot serialization, clock sync
10. [Persistent State](./10-persistent-state.md) — `@nova/persist`, save/load, storage backends

### Concurrency & Native Access

11. [Background Workers](./11-background-workers.md) — Tasks, jobs, streams, ECS integration, data transfer
12. [Native Module Bridge](./12-native-bridge.md) — `@nova/native`, design sketch (future)

### Authoring & DX

13. [Developer Experience](./13-developer-experience.md) — HMR, devtools panel, parameter tuning, CLI
14. [Scenes, Prefabs & Serialization](./14-scenes-prefabs.md) — Prefabs, inheritance, scene files, ECS integration
15. [Visual Editor](./15-visual-editor.md) — In-line editing, architecture, round-trip persistence

### Runtime

16. [Game States & Scene Transitions](./16-game-states.md) — State machine, resource guard pattern, transitions
17. [Performance Discipline](./17-performance.md) — Zero allocations per frame, spatial indexing
18. [Packaging & Distribution](./18-packaging.md) — Web target, Electron target, local server target, export configuration

### Engine Framework

19. [Plugin System](./19-plugin-system.md) — Plugin interface, EngineBuilder, dependencies, composition
20. [Error Handling](./20-error-handling.md) — Result type, error codes, severity, diagnostics

### Appendices

- [Appendix A: Minimal Example](./appendix-a-examples.md) — Headless simulation and browser-rendered variants
- [Appendix B: Comparison with Existing Frameworks](./appendix-b-comparison.md)
- [Appendix C: Target Performance Budgets](./appendix-c-performance-budgets.md)
- [Appendix D: Future — Parallel System Execution](./appendix-d-parallel-execution.md)

---

*HyperNova* is a working title.
This spec is a living document and will evolve as implementation reveals constraints and opportunities.


---

# 1. Design Philosophy

HyperNova is designed around four core principles:

- **Simulation-first, game-capable.** The core engine is a deterministic simulation loop with an ECS world. Rendering, input, and audio are optional plugins. A simulation runs identically headless in Node.js and rendered in a browser. Games are simulations with a renderer attached — not the other way around.
- **Composition over inheritance.** Simulation objects are assembled from small, reusable data components — not deep class hierarchies. Behavior emerges from systems that operate on component data.
- **Ship only what you use.** The engine is a collection of focused packages. The core is tiny. Everything else — physics, audio, tilemaps, networking, rendering — is opt-in. Tree-shaking works because the architecture demands it.
- **Developer experience is a feature.** Hot reload, visual inspectors, type safety, parameter tuning panels, and fast iteration loops are not afterthoughts. They are load-bearing parts of the design.

---

# 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Simulation Loop                         │
│  ┌──────────┐  ┌────────────────────────┐  ┌───────────────┐ │
│  │  Input   │  │     Fixed Update       │  │   Render      │ │
│  │  Gather  │-→│  ┌──────────────────┐  │-→│ (interpolated,│ │
│  │(optional)│  │  │ Stage: pre-phys  │  │  │   optional)   │ │
│  └──────────┘  │  │  Batch 0: A, B   │  │  └───────────────┘ │
│                │  │  Batch 1: C      │  │                    │
│                │  └──────────────────┘  │                    │
│                │  ┌──────────────────┐  │                    │
│                │  │ Stage: physics   │  │                    │
│                │  │  ... next stage  │  │                    │
│                │  └──────────────────┘  │                    │
│                └────────────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
        │               │                        │
        ▼               ▼                        ▼
┌──────────────────────────────────────────────────────────┐
│                        ECS World                         │
│                                                          │
│  Entities:    [0, 1, 2, 3, 4, ...]                       │
│  Components:  Position | Velocity | Sprite | ...  (SoA)  │
│  Systems:     MovementSystem → PhysicsSystem → ...       │
│  Resources:   Time | Random | Parameters | ...           │
│                                                          │
│  Queries:     world.query(Position, Velocity)            │
└──────────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
 ┌────────────┐  ┌──────────────┐  ┌──────────────┐
 │  @nova/    │  │  @nova/      │  │  @nova/      │
 │  input     │  │  physics-    │  │  renderer-   │
 │ (optional) │  │  rapier      │  │  webgpu      │
 └────────────┘  └──────────────┘  │ (optional)   │
                                   └──────────────┘
```

## Simulation Loop

The simulation loop uses a **fixed timestep with optional interpolated rendering**, the gold standard for deterministic simulation:

- **Input** (optional) — When `@nova/input` is installed, polls and buffers all input events from the current frame. Skipped in headless mode.
- **Fixed Update** — Runs simulation logic at a constant rate (configurable, default 60 Hz). Multiple fixed steps may run per frame if the frame budget allows, or none if the frame arrives early. All gameplay logic, physics, and AI run here. The accumulator is capped at `maxSubstepsPerFrame * fixedTimestep` (default: 4 steps) to prevent death spirals — excess time is dropped and the simulation slows relative to wall clock. A `BudgetExceeded` event is emitted when steps are dropped (see [Error Handling](./20-error-handling.md)).
- **Render** (optional) — When `@nova/renderer-webgpu` is installed, runs once per frame at display refresh rate. Interpolates between the previous and current simulation state for smooth visuals even when the simulation rate and display rate differ. Skipped entirely in headless mode.
- **Output** — Not a separate stage. Haptics, sound, and other side effects are triggered by systems within the fixed update stages (typically `gameplay` or `post-physics`) to maintain synchronization with the simulation.

This separation is critical for determinism (networking, replays, batch simulation runs) and decouples visual smoothness from simulation accuracy.

## Headless Mode

The simulation loop supports running without a renderer, canvas, or browser. This is essential for:
- **Automated testing** — run simulation logic in Node.js / CI without a GPU
- **Server-side simulation** — authoritative multiplayer servers
- **Batch runs** — parameter sweeps, Monte Carlo analysis, AI training
- **Deterministic replay validation** — compare headless output across platforms

```typescript
const engine = new Engine({ headless: true, fixedTimestep: 1/60 });
engine.addPlugin(PhysicsPlugin({ gravity: { x: 0, y: 400 } }));
// No renderer, no canvas. Plugins that require a GPU are skipped.

engine.tick();              // advance one fixed step synchronously
engine.tickN(1000);         // advance 1000 steps
engine.tickUntil(() =>      // advance until predicate returns true
  Health.current[boss] <= 0
);
```

In headless mode:
- `requestAnimationFrame` is not used. The loop is driven by explicit `tick()` calls.
- The `Time` resource updates normally (`dt`, `elapsed`, `frame` all advance).
- Events, commands, and stage flushes execute identically to rendered mode.
- Plugins that require a GPU (renderer, particles) gracefully no-op when `headless: true`.

Game code does not need to know whether it is running headless. The ECS world, systems, and simulation behave identically in both modes.

## Time Control

The engine provides time scaling for pause, slow-motion, fast-forward, and frame stepping:

```typescript
engine.setTimeScale(0);     // paused — render continues, fixed update produces zero steps
engine.setTimeScale(0.5);   // slow-motion — half as many fixed steps per frame
engine.setTimeScale(2.0);   // fast-forward — twice as many steps (capped by maxSubstepsPerFrame)
engine.setTimeScale(1.0);   // normal

engine.step();              // advance exactly one fixed step (works at any timeScale, including 0)
```

**Determinism is preserved.** `dt` within systems is always the fixed timestep — it does not change with `timeScale`. Time scaling only affects how many fixed steps the accumulator produces per frame. A simulation run at 2x produces the same state sequence as one run at 1x — it just gets there faster in wall-clock time.

The `Time` resource exposes:

```typescript
interface TimeResource {
  readonly dt: number;        // fixed timestep (e.g. 1/60) — never changes
  readonly elapsed: number;   // total simulation time (sum of all dt)
  readonly frame: number;     // simulation tick count
  readonly timeScale: number; // current time scale (0 = paused)
  readonly wallTime: number;  // real wall-clock time since engine.start()
}
```

## Package Boundary Rules

Packages communicate through the ECS world and well-defined interfaces. No package may import internals from another package. The dependency graph flows strictly downward:

```
@nova/core          — ECS, simulation loop, events, math, scenes, spatial index, PRNG, parameters
  ├── @nova/input          — Keyboard, mouse, gamepad, touch
  ├── @nova/renderer-webgpu — WebGPU renderer + WebGL2 fallback + compute pipeline
  ├── @nova/physics-rapier  — Rapier2D WASM physics
  ├── @nova/audio           — Web Audio API abstraction
  ├── @nova/assets          — Async asset pipeline
  ├── @nova/animation       — Sprite animation, tweening, state machines
  ├── @nova/tilemap         — Tilemap loading and rendering
  ├── @nova/particles       — GPU-accelerated particle systems
  ├── @nova/ui              — In-game UI (layout, widgets, interaction)
  ├── @nova/net             — Networking primitives
  ├── @nova/recorder        — Time-series data recording and replay
  ├── @nova/workers         — Background worker pool & services
  ├── @nova/persist         — Save/load snapshots
  ├── @nova/native          — Native module bridge (Electron/local target only)
  └── @nova/devtools        — Inspector, profiler, parameter panel, visual editor
```

---

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

**Canonical generation/handle semantics:** generation is stored as a full `Uint16` counter per slot (0–65535). Handles pack only the lower 12 bits (`genLow12 = generation & 0x0fff`) into `(genLow12 << 20) | index`. On recycle, the full 16-bit stored generation increments (wrapping at 65535→0). A handle is valid only if (a) the slot is currently alive and (b) its packed 12-bit generation matches the slot's current low 12 bits. Once generation advances, older handles become stale; after 4096 recycles, low-12 bits can repeat, but dead-slot checks and generation comparison at API boundaries still prevent use-after-destroy in normal lifecycle usage.

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

---

# 4. Modular Package System

## `@nova/core`

The only required package. Runs in browsers, Node.js, Electron, and headless environments.

Contains:
- ECS world, entity management, global SoA component storage
- Generational entity IDs with stale-handle detection
- Entity hierarchy (Parent/Children, transform propagation)
- System scheduler (dependency-graph ordering, sequential batch execution) and stage pipeline
- Simulation loop (fixed timestep + optional render interpolation)
- Headless mode (`tick()`, `tickN()`, `tickUntil()`) — no DOM or GPU required
- Time control (`setTimeScale()`, `step()`) — pause, slow-motion, fast-forward
- Deterministic PRNG (`Random` resource — seeded xoshiro256**)
- Simulation parameters (`defineParameter()`, `Parameters` resource, presets)
- Event system (`defineEvent` type tokens, stage-boundary double-buffered, pull-based)
- Math library (Vec2, Mat3, AABB, Color, lerp/clamp/remap utilities)
- Typed resource storage
- Scene loading and prefab instantiation
- Spatial index (uniform grid, optional quadtree)
- Plugin system (`EngineBuilder`, dependency resolution, topological sort)

Approximate bundle size target: **< 25 KB** gzipped.

## `@nova/renderer-webgpu`

Optional renderer targeting WebGPU with automatic WebGL2 fallback. Not required — the engine runs headless without it.

- **Automatic batching.** Sprites with the same texture and blend mode are batched into a single draw call. No manual batch management.
- **Render graph.** A lightweight render graph manages pass ordering, resource lifetimes, and clear/resolve operations. Custom post-processing passes slot into the graph.
- **Sprite rendering.** Textured quads with support for atlases, nine-slices, tiling, tint, and alpha.
- **Tilemap rendering.** GPU-instanced tilemap rendering with frustum culling — only visible tiles are submitted.
- **Text.** SDF (Signed Distance Field) text rendering for resolution-independent, styleable text with outlines and shadows.
- **Camera.** Multiple cameras with independent viewports, zoom, rotation, and render-to-texture.
- **Custom shaders.** Define custom materials with raw WGSL (WebGPU) or GLSL (WebGL2 fallback).
- **Compute pipeline.** Define and dispatch compute shaders for GPU-side simulation (boids, fluid dynamics, spatial hashing, procedural generation). Async readback for GPU→CPU data transfer. See [Renderer](./05-renderer.md) for the compute API.
- **GPUDevice access.** Advanced users can access the underlying `GPUDevice` for custom render/compute passes.

The renderer reads `Sprite`, `WorldTransform`, `RenderOrder`, `TilemapLayer`, and `Camera` components from the ECS world. It does not own simulation objects.

**`RenderOrder` component:** Controls draw order (z-index equivalent). Entities are sorted by `layer` (integer, lower draws first), then by texture/blend mode for batching. Default layer is 0.

```typescript
const RenderOrder = defineComponent({ layer: Types.i32 });  // built-in, from @nova/renderer-webgpu
```

## `@nova/physics-rapier`

Wraps [Rapier2D](https://rapier.rs/) (Rust → WASM) as the default physics engine.
- Rigid bodies: dynamic, kinematic, static
- Colliders: circle, box, capsule, convex polygon, heightfield, trimesh
- Joints: revolute, prismatic, fixed, rope
- Collision events piped into the ECS event system (`CollisionStart`, `CollisionEnd`)
- Raycasting and shape-casting queries
- Deterministic simulation (identical results given identical inputs)

**Sync model:** A `PhysicsSyncSystem` copies `Position`/`Rotation` from ECS to Rapier before stepping, and copies results back after.  The Rapier world is a resource, not a component — there's one physics world, not one per entity.

```typescript
import { PhysicsPlugin, RigidBody, Collider } from '@nova/physics-rapier';

engine.addPlugin(PhysicsPlugin({ gravity: { x: 0, y: -9.81 } }));

const crate = world.spawn();
world.addComponent(crate, Position, { x: 100, y: 50 });
world.addComponent(crate, RigidBody, { type: 'dynamic' });
world.addComponent(crate, Collider, { shape: 'box', width: 32, height: 32 });
```

## `@nova/input`

Unified input abstraction across keyboard, mouse, gamepad, and touch.
- **Action mapping.** Define logical actions ("jump", "fire", "move_left") and bind them to physical inputs.  Multiple bindings per action.  Rebindable at runtime.
- **Analog axes.** Gamepad sticks and composite WASD → Vec2 with configurable dead zones and curves.
- **Buffered input.** Input events are buffered and consumed during the fixed update, ensuring no inputs are lost between frames.
- **Gesture recognition.** Touch gestures (tap, swipe, pinch, long-press) as first-class events.

```typescript
const actions = defineActions({
  jump: [Key.Space, GamepadButton.South],
  fire: [MouseButton.Left, GamepadButton.RightTrigger],
  move: [
    compositeAxis(Key.A, Key.D, Key.W, Key.S),
    gamepadAxis(GamepadAxis.LeftStick),
  ],
});

// In a system
if (input.justPressed('jump')) { /* ... */ }
const dir = input.axis('move'); // Vec2
```

## `@nova/audio`

Web Audio API abstraction with spatial audio and music management.
- **Sound effects.** Pooled audio sources with volume, pitch, pan, and spatial positioning.
- **Music.** Streaming playback with crossfade transitions between tracks.
- **Mixer.** Channel groups (master, sfx, music, ui) with independent volume controls.
- **Audio context resume.** Automatic handling of browser autoplay policies — queues sounds until user interaction unlocks the context.

## `@nova/assets`

Modern async asset pipeline.
- **Declarative manifests.** Define what a scene needs; the loader fetches, decodes, and caches assets before the scene starts.
- **Streaming.** Large assets (spritesheets, audio) can stream progressively.  The game can start before everything is loaded.
- **Hot reload.** In dev mode, file changes on disk trigger asset reload without restarting the game.
- **Format support.** Images (PNG, WebP, AVIF), audio (OGG, MP3, WAV), data (JSON, TOML, binary), spritesheets (TexturePacker, Aseprite), tilemaps (Tiled TMX/JSON, LDtk).

```typescript
const manifest = defineManifest({
  textures: {
    player: 'assets/player.png',
    tileset: 'assets/tileset.webp',
  },
  audio: {
    bgm: { src: 'assets/music.ogg', stream: true },
    jump: 'assets/sfx/jump.wav',
  },
  tilemaps: {
    level1: 'assets/levels/level1.ldtk',
  },
});

const result = await engine.loadManifest(manifest);
// loadManifest returns Result<ManifestAssets, AssetLoadReport>
// After a successful load, assets are ready — direct typed access:
const playerTexture = result.value.textures.player;

// For individually loaded or streamed assets, use AssetHandle<T>
// which provides status/value/fallback (see Error Handling):
const bgm = assets.get('bgm'); // AssetHandle<AudioBuffer> — may still be streaming
renderer.playMusic(bgm.value ?? bgm.fallback);
```

## `@nova/tilemap`

Tilemap loading, querying, and rendering.

- Parses Tiled (TMX/JSON) and LDtk formats.
- Object layers → ECS entities with components derived from custom properties.
- Tile collision shapes → physics colliders automatically.
- Efficient GPU-instanced rendering via the renderer package.
- Runtime tile manipulation (set/get/fill/flood).

## `@nova/particles`

GPU-accelerated particle systems.

- Particle simulation runs in a compute shader (WebGPU) or vertex shader (WebGL2 fallback).
- Emitter components define spawn rate, lifetime, velocity curves, color gradients, size over life, gravity, turbulence.
- Millions of particles with near-zero CPU cost.

## `@nova/animation`

Sprite animation, tweening, and state machines.

- **Sprite animation.** Frame-based animation from sprite sheet sequences. Configurable frame rate, loop modes (loop, once, ping-pong), and events on specific frames.
- **Tweening.** Animate any numeric component field over time with easing curves (linear, ease-in/out, cubic, elastic, bounce, custom Bezier). Chainable sequences and parallel groups.
- **Animation state machine.** Declare states (idle, run, jump, fall) with transition conditions based on component data. States bind to sprite animations and blend between them.
- **Skeletal animation.** Spine and DragonBones import for bone-driven 2D animation with mesh deformation.

```typescript
import { defineAnimation, Tween, AnimationState } from '@nova/animation';

// Sprite animation from a sheet
const walkAnim = defineAnimation({
  texture: 'player',
  frames: [0, 1, 2, 3, 4, 5],
  frameRate: 12,
  loop: true,
});

// Tweening
Tween.to(entity, Position, { x: 500 }, {
  duration: 0.5,
  easing: 'easeOutCubic',
  onComplete: () => { /* ... */ },
});

// State machine — transition conditions receive the entity ID
const playerAnimations = defineAnimationState({
  initial: 'idle',
  states: {
    idle: { animation: idleAnim, transitions: [
      { to: 'run', when: (eid) => Math.abs(Velocity.x[eid]) > 0.1 },
    ]},
    run: { animation: walkAnim, transitions: [
      { to: 'idle', when: (eid) => Math.abs(Velocity.x[eid]) < 0.1 },
      { to: 'jump', when: (eid) => Velocity.y[eid] < -1 },
    ]},
    jump: { animation: jumpAnim, transitions: [
      { to: 'fall', when: (eid) => Velocity.y[eid] > 0 },
    ]},
  },
});
```

## `@nova/ui`

Lightweight in-game UI rendered by the engine — not HTML overlays.

- **Layout.** Flexbox-inspired layout engine for positioning UI elements relative to screen or world space.
- **Widgets.** Text labels, buttons, sliders, progress bars, panels, scroll views. All ECS entities with UI components.
- **Styling.** Declarative style objects with nine-slice backgrounds, font selection, colors, padding, and margin.
- **Interaction.** Click, hover, focus events routed through the input system. Keyboard/gamepad navigation for accessibility.
- **Screen-space and world-space.** UI can be anchored to the screen (HUD) or attached to entities in the world (health bars, name tags).

```typescript
import { UIPanel, UIText, UIButton, Anchor } from '@nova/ui';

const hud = world.spawn()
  .add(UIPanel, { anchor: Anchor.TopLeft, padding: 8 })
  .withChild(child => child
    .add(UIText, { text: 'Score: 0', font: 'default', size: 16 })
  );

const pauseButton = world.spawn()
  .add(UIButton, { text: 'Pause', onClick: 'pause-game' })
  .add(Anchor, { screen: 'top-right', offsetX: -16, offsetY: 16 });
```

HTML overlays remain available for devtools and complex forms. `@nova/ui` is for game UI that needs to be rendered at game frame rate and styled consistently with the game's art.

## `@nova/net`

Networking primitives — not a full multiplayer framework, but the foundational building blocks.

- **State snapshots.** Serialize/deserialize the ECS world (or a filtered subset) into compact binary buffers.
- **Input buffering and playback.** Record and replay input streams for lockstep or rollback networking.
- **Interpolation helpers.** Smooth remote entity positions between snapshot ticks.
- **Transport agnostic.** Provides a `Transport` interface — implement it with WebSocket, WebRTC DataChannel, or a mock for testing.
- **Clock sync.** Lightweight NTP-style clock synchronization between client and server.

## `@nova/persist`

Save/load simulation state via typed array snapshots.

- **Save/Load API.** `save(name)`, `load(name)`, `quickSave()`, `quickLoad()`, `listSnapshots()`, `deleteSnapshot(name)`.
- **Storage backends.** IndexedDB (web), filesystem (local/Electron), in-memory (testing).
- **Component control.** Components persist by default; opt out via `{ persist: false }`.
- **PRNG seed.** The `Random` resource seed is included in snapshots for deterministic restore.
- **Events.** `SaveCompleted` / `LoadCompleted` events for UI feedback.

v2+ deferred: SQLite continuous mirroring, cloud saves, crash recovery.

## `@nova/recorder`

Time-series data recording and replay for simulation analysis.

- **Recording.** Configure which components to record, at what sample rate, in what format (binary or JSON).
- **API.** `start()`, `stop()`, `export()` (returns `Blob`), `getTimeline(component, entityFilter)`.
- **Replay.** `loadRecording()`, `getFrame(tick)` — timeline scrub for frame-by-frame playback.
- **Export.** CSV export for external analysis (spreadsheets, Python, R, notebooks).
- **Devtools integration.** Timeline scrub bar and recording controls in the devtools panel.

```typescript
import { RecorderPlugin } from '@nova/recorder';

engine.addPlugin(RecorderPlugin({
  components: [Position, Health],   // what to record
  sampleRate: 10,                   // every 10th tick
  format: 'binary',
}));

// In game code:
const recorder = resources.get(Recorder);
recorder.start();
// ... run simulation ...
recorder.stop();
const blob = recorder.export();     // download or analyze
```

## `@nova/devtools`

Development and debugging tools, completely tree-shaken from production builds.

- **Entity Inspector.** Browse all entities, view/edit their components in real time.
- **System Profiler.** Per-system execution time graph. Identify bottlenecks instantly.
- **Parameter Panel.** Auto-generated sliders/inputs from `defineParameter()` metadata, grouped by category. Preset save/load.
- **Physics Debug Overlay.** Render collider shapes, AABBs, contact points, joints.
- **Asset Browser.** View all loaded assets, their memory usage, and reload individually.
- **Console.** In-game console for running commands, spawning entities, toggling systems.
- **State Snapshot Viewer.** Inspect and diff world state between frames (invaluable for networking debugging).
- **Recording Controls.** Start/stop recording, timeline scrub, CSV export (when `@nova/recorder` is installed).

The devtools panel is rendered as an HTML overlay, independent of the simulation canvas, using a lightweight UI framework (Preact or vanilla DOM).
It communicates with the engine via a message protocol, enabling remote debugging (connect devtools from another browser tab or device).

---

# 5. Renderer — WebGPU First (Optional)

The renderer is an optional plugin. HyperNova simulations run headless without it. When installed, the renderer reads ECS components and draws to a canvas.

## Why WebGPU

WebGPU provides compute shaders, better draw call performance, explicit resource management, and a modern API that maps well to Vulkan/Metal/D3D12.

Key wins for a simulation engine:
- **Compute shaders** for GPU-side simulation (boids, fluid dynamics, spatial hashing), particle systems, pathfinding offload, and procedural generation.
- **Reduced driver overhead** — fewer draw calls matter less, but batching is still free performance.
- **Storage buffers** — pass arbitrary data to shaders without texture encoding hacks.

## Fallback Strategy

The renderer provides a WebGL2 backend with the same rendering API surface.
Feature detection at startup selects the best available backend.
Compute-dependent features (GPU particles, GPU spatial hash, custom compute passes) gracefully degrade to CPU implementations on WebGL2.

## Render Pipeline

```
1. Cull         — Frustum cull against camera AABB
2. Sort         — Sort by layer → texture → blend mode → depth
3. Batch        — Merge consecutive compatible sprites into batches
4. Upload       — Stream vertex/instance data to GPU buffers
5. Draw         — Issue batched draw calls
6. Post-process — Bloom, color grading, CRT shader, etc. (optional)
7. Present      — Composite to canvas
```

## Custom Materials

Users can define custom materials for special rendering effects:

```typescript
const waterMaterial = defineMaterial({
  shader: `
    @fragment
    fn main(@location(0) uv: vec2f, @builtin(position) pos: vec4f) -> @location(0) vec4f {
      let time = uniforms.elapsed;
      let distortion = sin(uv.y * 20.0 + time * 3.0) * 0.01;
      return textureSample(tex, samp, uv + vec2f(distortion, 0.0));
    }
  `,
  uniforms: {
    elapsed: Types.f32,
  },
});
```

## Compute Pipeline

For GPU-accelerated simulation, the renderer exposes a compute shader API:

```typescript
import { defineCompute } from '@nova/renderer-webgpu';

const BoidCompute = defineCompute({
  shader: `
    struct Boid { pos: vec2f, vel: vec2f }

    @group(0) @binding(0) var<storage, read> boids_in: array<Boid>;
    @group(0) @binding(1) var<storage, read_write> boids_out: array<Boid>;

    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) id: vec3u) {
      let i = id.x;
      // ... flocking logic ...
      boids_out[i] = updated;
    }
  `,
  buffers: {
    boids_in: 'storage',
    boids_out: 'storage',
  },
  dispatch: (count: number) => [Math.ceil(count / 256), 1, 1],
});

// In a system:
const renderer = resources.get(RendererState);
renderer.dispatch(BoidCompute, { boids_in: bufA, boids_out: bufB });
renderer.readback(bufB, cpuArray);  // async GPU→CPU transfer
```

On WebGL2, compute-dependent systems fall back to CPU implementations. The engine emits a `ComputeFallback` diagnostic at startup when this happens.

## GPUDevice Access

Advanced users can access the underlying `GPUDevice` for custom render or compute passes that go beyond the `defineCompute` / `defineMaterial` APIs:

```typescript
const renderer = resources.get(RendererState);
const device = renderer.device;    // GPUDevice | null (null on WebGL2 or headless)
const queue = renderer.queue;      // GPUQueue | null
```

This is an escape hatch — not the primary API. Code using raw `GPUDevice` is not portable to the WebGL2 fallback.

---

# 6. TypeScript From the Ground Up

## Non-Negotiable Type Safety

Every public API surface is strictly typed.
The engine is authored in TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.

## Events

Events are defined with `defineEvent<T>()`, consumed with pull-based iteration, and participate in system scheduling — no strings, no callbacks, no allocations.

Runtime simulation events are owned by `@nova/core` and stored in deterministic ring buffers. `mitt` is reserved for non-simulation event buses (editor panels, devtools UI callbacks, other tooling surfaces) where callback ergonomics matter more than deterministic scheduling.

### Defining Events

```typescript
import { defineEvent } from '@nova/core';

const CollisionStart = defineEvent<{
  entityA: Entity;
  entityB: Entity;
  normal: Vec2;
  impulse: number;
}>();

const CollisionEnd = defineEvent<{
  entityA: Entity;
  entityB: Entity;
}>();

const EntityDestroyed = defineEvent<{ entity: Entity }>();
```

`defineEvent<T>()` returns a type token (like `defineResource<T>()`). The generic parameter defines the payload shape. No string key is needed — the token is the identity.

### Emitting and Reading Events

Systems declare event dependencies for scheduling analysis, then use `events.emit()` and `events.read()`:

```typescript
const DamageSystem = defineSystem({
  name: 'Damage',
  query: query(Health).write(Health),
  events: { read: [CollisionStart], write: [EntityDestroyed] },
  execute({ events, commands }) {
    for (const c of events.read(CollisionStart)) {
      // c is Readonly<{ entityA: Entity; entityB: Entity; normal: Vec2; impulse: number }>
      const target = c.entityB;
      Health.current[target] -= c.impulse;
      if (Health.current[target] <= 0) {
        events.emit(EntityDestroyed, { entity: target });
        commands.destroy(target);
      }
    }
  },
});
```

### EventAccessor Interface

The `events` field on the system context provides:

```typescript
interface EventAccessor {
  read<T>(token: EventToken<T>): Iterable<Readonly<T>>;
  count<T>(token: EventToken<T>): number;
  hasAny<T>(token: EventToken<T>): boolean;
  emit<T>(token: EventToken<T>, payload: T): void;
}
```

`read()` and `count()` only work for event types declared in the system's `events.read`. `emit()` only works for types in `events.write`. Violations throw in debug mode and are no-ops in production.

### Storage

Event data is stored in pre-allocated ring buffers — zero heap allocation in steady state. Events with only numeric fields can optionally use an SoA ring (typed arrays, like component storage). Events with complex payloads (strings, nested objects) use an object-pool ring. Buffer capacity is configurable per event type:

```typescript
const HighFreqEvent = defineEvent<{ value: number }>({ capacity: 1024 });
```

Default capacity: 256. Overflow behavior is configurable per event type:

```typescript
const SimCriticalEvent = defineEvent<{ tick: number }>({
  capacity: 512,
  overflow: 'grow',        // default in dev: grow buffer, log warning
});

const TelemetryEvent = defineEvent<{ value: number }>({
  capacity: 1024,
  overflow: 'drop-oldest', // production default: overwrite oldest
});

const DeterministicEvent = defineEvent<{ state: number }>({
  capacity: 256,
  overflow: 'halt',        // halt the engine — for events that must not be lost
});
```

- `'grow'` — grows the buffer (one-time allocation, logs warning). Default in dev mode.
- `'drop-oldest'` — overwrites the oldest events. Default in production mode.
- `'halt'` — calls `engine.halt()` with a fatal error. Use for simulation-critical events where data loss would break determinism.

### External Observation (Devtools Only)

For tooling that needs callback-based observation outside the ECS pipeline:

```typescript
engine.observe(CollisionStart, (event) => {
  devtoolsPanel.logCollision(event);
});
```

`engine.observe()` runs post-frame, is non-deterministic, and is tree-shaken from production builds. It is not for game logic.

## Generic Components

Component access is fully typed through the schema definition:

```typescript
const pos = world.get(entity, Position);
// pos is { x: number, y: number } — no `any`, no casting
```

## Build Tooling

The recommended setup is Vite with the HyperNova plugin:

```typescript
// vite.config.ts
import { novaPlugin } from '@nova/vite-plugin';

export default defineConfig({
  plugins: [novaPlugin()],
});
```

The plugin handles WASM loading (Rapier), asset manifest generation, dev server with HMR, and production tree-shaking with devtools stripping.

---

# 7. Physics — Rapier2D (WASM)

## Why Rapier Over JS Physics

| Concern | Arcade (Phaser) | Matter.js | Rapier2D (WASM) |
|---|---|---|---|
| Performance | Fast but limited | Moderate | Excellent |
| Determinism | No | No | Yes |
| Collision shapes | AABB only | Convex, compound | Full suite |
| Continuous collision | No | Partial | Yes (CCD) |
| Joints/constraints | No | Yes | Yes |
| WASM | N/A | N/A | ~200 KB |

Rapier's determinism is critical for networking (rollback netcode requires identical simulation results given identical inputs) and for replays/testing.

## Physics Configuration

```typescript
engine.addPlugin(PhysicsPlugin({
  gravity: { x: 0, y: 400 },       // pixels/sec²
  timestep: 1 / 60,                  // matches fixed update
  substeps: 2,                       // solver iterations per step
  ccd: true,                         // continuous collision detection
  pixelsPerMeter: 50,                // unit conversion
}));
```

## Collision Events

Collision events flow through the typed event system, not callbacks:

```typescript
import { CollisionStart, CollisionEnd } from '@nova/physics-rapier';

const CollisionResponseSystem = defineSystem({
  name: 'CollisionResponse',
  events: { read: [CollisionStart, CollisionEnd] },
  execute({ events, commands }) {
    for (const collision of events.read(CollisionStart)) {
      // collision is Readonly<{ entityA: Entity; entityB: Entity; normal: Vec2; impulse: number }>
      if (world.has(collision.entityA, Projectile) && world.has(collision.entityB, Health)) {
        commands.set(collision.entityB, Health, { current: Health.current[collision.entityB] - 10 });
      }
    }
  },
});
```

---

# 8. Async Asset Pipeline

## Loading Lifecycle

```
Define Manifest → Fetch → Decode → Process → Cache → Ready
                    │        │         │
                    │        │         └─ Atlas packing, mipmap gen
                    │        └─ Image decode, audio decode, JSON parse
                    └─ HTTP fetch with progress tracking
```

## Progressive Loading

Games can define **load priorities** and start rendering before all assets are ready:

```typescript
const manifest = defineManifest({
  // Priority 0: loaded before anything renders
  critical: {
    ui_atlas: 'assets/ui.webp',
    font: 'assets/font.fnt',
  },
  // Priority 1: loaded during splash screen
  gameplay: {
    player: 'assets/player.png',
    enemies: 'assets/enemies.png',
  },
  // Priority 2: streamed in the background during gameplay
  ambient: {
    bgm: { src: 'assets/music.ogg', stream: true },
    particles: 'assets/particles.png',
  },
});
```

## Dev Mode Hot Reload

In development, the asset pipeline watches source files and hot-reloads changed assets without restarting the game.
A texture change appears on screen within milliseconds.
Tilemap edits in Tiled or LDtk are reflected live.

---

# 9. Networking Primitives

## Architecture Patterns Supported

HyperNova doesn't impose a networking architecture.
Instead, it provides primitives that support common patterns:

**Authoritative Server (Client-Server)**
- Server runs the ECS world as the source of truth (headless mode, no renderer).
- Clients send inputs, receive state snapshots.
- `@nova/net` provides snapshot serialization, delta compression, and interpolation.

**Rollback Netcode (Peer-to-Peer)**
- Each peer runs a local simulation.
- Inputs are exchanged and applied retroactively.
- `@nova/net` provides world state save/restore, input buffer management, and resimulation helpers.
- Rapier's determinism + seeded PRNG (`Random` resource) makes rollback reliable.

## Snapshot Serialization

v1 uses JSON for snapshot serialization (simple, debuggable). A custom binary format with delta compression and quantization is a v2 optimization — the SoA layout makes this a natural evolution (typed arrays are already contiguous, serialization is close to memcpy), but should be informed by profiling of the JSON path first.

```typescript
import { WorldSerializer } from '@nova/net';

const serializer = new WorldSerializer(world, {
  // Only sync these components over the network
  components: [Position, Velocity, Health, SpriteIndex],
});

const snapshot = serializer.serialize();     // Uint8Array (JSON-encoded in v1)
serializer.deserialize(snapshot);            // apply to world
const delta = serializer.serializeDelta(previousSnapshot); // only changed data
```

## Clock Synchronization

```typescript
import { ClockSync } from '@nova/net';

const clock = new ClockSync(transport);
await clock.sync(); // exchanges timestamps, calculates offset and RTT

const serverTime = clock.now();       // estimated server time
const rtt = clock.roundTripTime;      // smoothed RTT
const jitter = clock.jitter;          // RTT variance
```

---

# 9.5 Persistent State — `@nova/persist`

## Overview

Save/load in HyperNova exploits the SoA arena: all component data is already contiguous typed arrays.
No per-entity traversal, no serialization.

`@nova/persist` is an opt-in plugin that provides save/load via bulk typed array snapshots stored in IndexedDB (web) or the filesystem (local target).

## Core Design

**Save** = copy each persistent component's typed array into a snapshot blob, plus the PRNG seed from the `Random` resource. For a simulation with 20 component fields and 50K entities: 20 bulk copies, not 50K entity walks.

**Load** = restore snapshot blobs into the arena's typed arrays + restore PRNG seed + invalidate query caches. The simulation resumes deterministically from the saved state.

```typescript
// Save
persist.save('checkpoint-3');
// Internally: for each persistent column → typedArray.slice() → store blob
// Emit SaveCompleted event when done

// Load
persist.load('checkpoint-3');
// Internally: pause loop → bulk restore blobs → invalidate queries → resume
// Emit LoadCompleted event
```

## Component Persistence Control

Components persist by default. Opt out per-component:

```typescript
const Position = defineComponent({ x: Types.f32, y: Types.f32 });           // persists
const ParticleVelocity = defineComponent(
  { x: Types.f32, y: Types.f32 },
  { persist: false }                                                         // transient
);
```

Resources do **not** persist by default. Opt in via plugin config.

## Public API

```typescript
interface PersistStore {
  save(name: string, metadata?: Record<string, unknown>): void;
  load(name: string): void;
  quickSave(): void;
  quickLoad(): void;
  listSnapshots(): SnapshotInfo[];
  deleteSnapshot(name: string): void;
}
```

## Storage Backend

| Target | Backend | Notes |
|--------|---------|-------|
| Web | IndexedDB | Blob storage, works everywhere |
| Electron | Filesystem (via IPC) | Same as local, accessed through preload bridge |
| Local (Node.js) | Filesystem (JSON + binary blobs) | Simple file-based snapshots |
| Testing / Headless | In-memory | No persistence, fast tests and batch runs |

## Plugin Configuration

```typescript
engine.addPlugin(PersistPlugin({
  dbName: 'my-game',
  exclude: [ParticleVelocity, DebugOverlay],
  resources: [GameState, QuestLog],
  maxSnapshots: 100,
}));
```

## Events

```typescript
const SaveCompleted = defineEvent<{ name: string; tick: number; durationMs: number }>();
const LoadCompleted = defineEvent<{ name: string; tick: number; durationMs: number }>();
```

## Future (v2+)

The following capabilities are deferred to after the core engine is proven:
- **SQLite-backed continuous mirroring** — background sync of dirty columns to SQLite BLOBs for crash recovery
- **Cloud saves** — via Turso embedded replicas or similar
- **Time-travel debugging** — per-tick delta logging for stepping backwards in devtools
- **Editor undo/redo** — micro-snapshots of modified columns

The memcpy-to-BLOB design insight (one SQL row per column, not per entity) remains the intended migration path when continuous mirroring is needed.

---

# 10. Background Workers

## Overview

GPU compute shaders handle massively parallel work (particles, spatial hashing), but many CPU-bound tasks — pathfinding, AI decision trees, procedural generation, data serialization — need to run off the main thread without blocking the game loop.

> **Note:** This section covers **asynchronous background tasks** — work that runs independently of the frame loop with results arriving on the next frame.  ECS system execution itself runs sequentially on the main thread (see [System Scheduling](./03-ecs-architecture.md#system-scheduling)).

`@nova/workers` provides a typed worker system with three patterns:

| Pattern | API | Worker Lifetime | Example Use Cases |
|---------|-----|-----------------|-------------------|
| **Task** | `defineTask()` | Borrows a pooled worker, returns when done | Pathfinding, proc-gen, serialization |
| **Job** | `defineJob()` | Persistent, timer-driven | Autosave, heartbeat, telemetry, GC |
| **Stream** | `defineStream()` | Persistent, data-driven | Audio analysis, chunk loading, network queues |

All three patterns funnel results through a single `WorkerResultBuffer` resource, drained by a `WorkerSyncSystem` at a deterministic point in the stage pipeline. Worker results are never injected mid-frame.

## Architecture

```
Main Thread                              Worker Thread(s)
──────────                               ────────────────
Game Loop:                               Pool (generic, shared):
  input stage                              Worker 0 ◄── task queue (FIFO)
  worker-sync stage  ◄── ResultBuffer ◄──  Worker 1
  pre-physics stage                        Worker N
  physics stage
  gameplay stage   ──► submit tasks ──►   Services (dedicated):
  render-prep stage                        Autosave Job (timer)
                                           Audio Stream (data)
```

Workers are created from Blob URLs — no separate worker files required.
Task handler function bodies are serialized and registered with each pool worker at startup.
The Vite plugin can optionally extract handlers into real worker modules for source-map support.

## One-Shot Tasks

Tasks are pure functions dispatched to a pool of generic Web Workers.
Any pooled worker can execute any registered task.

```typescript
import { defineTask } from '@nova/workers';

const PathfindTask = defineTask({
  name: 'pathfind',
  execute(input: { grid: Float32Array; width: number; height: number;
                    sx: number; sy: number; ex: number; ey: number }) {
    // A* runs entirely in the worker — no DOM, no shared state
    const path = astar(input.grid, input.width, input.height,
                       input.sx, input.sy, input.ex, input.ey);
    return { path };
  },
  // Zero-copy: transfer ArrayBuffer ownership instead of copying
  inputTransferables: (input) => [input.grid.buffer],
  outputTransferables: (output) => [output.path.buffer],
});
```

Submitting a task returns a `TaskTicket` — a lightweight, non-blocking result handle.
Tickets are **not** Promises (to prevent `await` inside systems).
The `WorkerSyncSystem` polls tickets and emits results as typed events via the `WorkerResult` event token.

```typescript
// In a system's execute function:
const pool = resources.get(WorkerPool);
const ticket = pool.submit(PathfindTask, {
  grid: navGrid.data.slice(), // clone for transfer
  width: navGrid.width, height: navGrid.height,
  sx: Position.x[eid], sy: Position.y[eid],
  ex: targetX, ey: targetY,
});
// Result arrives via WorkerResult event on the next frame
```

**Pool configuration:**

- Size defaults to `navigator.hardwareConcurrency - 1` (minimum 1).
- Tasks execute in submission order (FIFO queue).
- Configurable timeout per task (override with `timeout` in `defineTask()`, default: pool-level `taskTimeout`). Exceeded tasks transition to `'timedOut'` status. The stuck worker is terminated and replaced automatically.

> **Transferred buffer loss:** When a task transfers an `ArrayBuffer` (ownership moves to the worker) and the worker is terminated for timeout, that buffer is irrecoverably lost. Use `SharedArrayBuffer` for data that must survive worker failures, or clone the data before transfer if the cost is acceptable.

## Periodic Jobs

Jobs are timer-driven workers that run on a fixed interval, independent of the game loop.
They run on dedicated workers (not the pool) to avoid blocking one-shot tasks.

```typescript
import { defineJob } from '@nova/workers';

const AutosaveJob = defineJob({
  name: 'autosave',
  interval: 30_000, // every 30 seconds
  init: () => ({ saveCount: 0 }),
  tick(state) {
    state.saveCount++;
    // Can use fetch() from the worker
    return { saved: true, count: state.saveCount };
  },
});

const HeartbeatJob = defineJob({
  name: 'heartbeat',
  interval: 5_000,
  init: () => ({ lastPing: 0 }),
  tick(state) {
    state.lastPing = Date.now();
    return { timestamp: state.lastPing };
  },
});
```

## Streaming Pipelines

Streams are persistent workers that process a continuous flow of data.
They maintain state across messages and can produce output for each input chunk.

```typescript
import { defineStream } from '@nova/workers';

const AudioAnalysisStream = defineStream({
  name: 'audio-analysis',
  init: () => ({
    fftBuffer: new Float32Array(1024),
    beatThreshold: 0.8,
  }),
  process(state, input: { samples: Float32Array; sampleRate: number }) {
    const energy = computeEnergy(input.samples);
    return { energy, isBeat: energy > state.beatThreshold };
  },
  inputTransferables: (input) => [input.samples.buffer],
});

const ChunkLoaderStream = defineStream({
  name: 'chunk-loader',
  init: () => ({ cache: new Map() }),
  process(state, input: { chunkX: number; chunkY: number; seed: number }) {
    const key = `${input.chunkX},${input.chunkY}`;
    if (state.cache.has(key)) return state.cache.get(key);
    const tiles = generateChunk(input.chunkX, input.chunkY, input.seed);
    state.cache.set(key, tiles);
    return { chunkX: input.chunkX, chunkY: input.chunkY, tiles };
  },
  outputTransferables: (output) => [output.tiles.buffer],
});
```

Streams are fed data from the main thread via a `ServiceHandle`:

```typescript
const audioStream = services.startStream(AudioAnalysisStream);
// In a system:
audioStream.send({ samples: audioSamples, sampleRate: 44100 });
```

## ECS Integration

Results from all worker types flow through the same path:
1. Workers post results to the main thread.
2. Results accumulate in the `WorkerResultBuffer` resource.
3. The `WorkerSyncSystem` drains the buffer during the `worker-sync` stage and emits `WorkerResult` events.
4. Game systems read `WorkerResult` via the standard event API and apply data to components.

```typescript
import { WorkerResult } from '@nova/workers';

const ApplyPathfindingSystem = defineSystem({
  name: 'ApplyPathfinding',
  query: query(PathRequest, Position),
  events: { read: [WorkerResult] },
  execute({ events }) {
    for (const result of events.read(WorkerResult)) {
      if (result.taskName !== 'pathfind') continue;
      if (result.status === 'timedOut') {
        // Task exceeded timeout — worker was replaced, transferred buffers are lost
        continue;
      }
      if (result.status !== 'resolved') continue;
      const { entityId, path } = result.data as PathfindResult;
      PathFollower.waypointCount[entityId] = path.length / 2;
      // Copy path into component storage...
    }
  },
});
```

**Recommended stage ordering with workers:**

```typescript
engine.addStage('input',        [InputGatherSystem]);
engine.addStage('worker-sync',  [WorkerSyncSystem]);
engine.addStage('pre-physics',  [MovementSystem, AISystem, ApplyPathfindingSystem]);
engine.addStage('physics',      [PhysicsSyncSystem, PhysicsStepSystem]);
engine.addStage('spatial',      [SpatialIndexSystem]);
engine.addStage('post-physics', [CollisionResponseSystem]);
engine.addStage('gameplay',     [DamageSystem, DeathSystem, SpawnSystem]);
engine.addStage('render-prep',  [SpriteAnimationSystem, CameraSystem]);
```

Tasks submitted during `gameplay` are processed by workers between frames and consumed at the start of the next frame's `worker-sync` stage. This guarantees deterministic behavior.

## Data Transfer

Three tiers, preferred in order:

| Tier | Mechanism | Best For |
|------|-----------|----------|
| **SharedArrayBuffer** | True zero-copy shared memory (requires `crossOriginIsolated`) | Large persistent data: navmeshes, spatial grids |
| **Transferable** | Zero-copy ownership transfer (sender loses access) | One-shot data: pathfinding grids, generated chunks |
| **Structured Clone** | Deep copy via `postMessage` | Small objects, scalar results |

`@nova/workers` provides a `SharedBuffer` utility for persistent shared memory with typed array views and automatic fallback to regular `ArrayBuffer` when `SharedArrayBuffer` is unavailable.

Transferable objects are auto-detected by walking the message payload for `ArrayBuffer` instances.
Explicit `inputTransferables`/`outputTransferables` functions on task/stream definitions provide fine-grained control.

## Graceful Degradation

When `Worker` is unavailable (embedded webviews, restricted environments), the entire API surface still works:
- Tasks execute synchronously on the main thread.
- Jobs run via `setInterval` on the main thread.
- Streams process inline when `send()` is called.
- Results still flow through `WorkerResultBuffer` and are consumed by `WorkerSyncSystem` on the next frame — preserving the 1-frame-delay contract.

Game code behaves identically regardless of worker availability.
Performance degrades (heavy tasks block the main thread), but correctness and determinism are preserved.

## Plugin

```typescript
import { WorkersPlugin, defineTask, defineJob, defineStream } from '@nova/workers';

engine.addPlugin(WorkersPlugin({
  pool: { size: 4, taskTimeout: 3000 },
  tasks: [PathfindTask, ProcGenTask],
  jobs: [AutosaveJob, HeartbeatJob],
  streams: [AudioAnalysisStream],
}));
```

The plugin creates the worker pool, service manager, result buffer resource, and inserts the `worker-sync` stage automatically.
Cleanup (worker termination) is registered on engine dispose.

---

# 10.5 Native Module Bridge (`@nova/native`) — Future

> **Scope note:** `@nova/native` is deferred to Phase 4+. This section captures the design intent for when native module access is needed. The core engine and web target do not depend on it.

## Overview

`@nova/native` provides a typed bridge between browser-side simulation code and native Node.js / Electron modules (serial ports, GPIO, USB HID, filesystem, native windows). The transport layer depends on the deployment target:

| Target | Transport | Notes |
|--------|-----------|-------|
| **Electron** | Electron IPC (`contextBridge`) | Fastest — direct process communication, no network |
| **Local (.exe)** | WebSocket to embedded Node.js server | Same-machine localhost, ~0.1ms latency |
| **Web** | Graceful degradation | `NativeBridge.available` is `false`, calls return immediately-rejected tickets |

## Design Sketch

- **Server / Main Process:** `defineNativeService({ name, init, methods, dispose })` — async methods callable from simulation code, `emit()` for streaming data to renderer process
- **Client:** `defineNativeClient<T>({ name })` — typed proxy, calls return `NativeTicket` (not Promise), results arrive via `NativeResult` / `NativeStream` events
- **ECS integration:** `NativeSyncSystem` drains results in a `native-sync` stage (after `worker-sync`), same pattern as `@nova/workers`
- **Wire protocol:** JSON text frames for control, binary frames with 4-byte header for high-frequency data
- **Electron optimization:** When running in Electron, the bridge uses `ipcRenderer.invoke()` / `ipcMain.handle()` instead of WebSocket — no serialization overhead for structured-cloneable data

Full design details will be specified when this feature enters active development.

---

# 11. Developer Experience

## Hot Module Replacement

The Vite plugin enables HMR for simulation code:
- **System hot reload.** Change a system's `execute` function → the running simulation swaps it in without losing world state.
- **Component schema changes.** Adding a field to a component triggers a world migration — existing entities get default values for the new field.
- **Asset hot reload.** Change a PNG on disk → the texture updates on screen.
- **Scene hot reload.** Edit a `.nova.json` scene file → entities are diffed and patched in-place without restarting. These need to include the version number of the engine they were created with.
- **Parameter hot reload.** Change a `defineParameter()` default or range → the parameter panel updates live.

## Devtools Panel

The devtools panel is an HTML overlay activated with a keybind (`` ` `` by default) or launched in a separate window.

**Entity Inspector:**
- Searchable entity list with component filters
- Click an entity to view/edit all its components
- Highlight the selected entity on the simulation canvas
- Create/destroy entities from the inspector

**System Profiler:**
- Per-system execution time as a rolling graph
- Stage and batch timeline: shows execution order, per-system duration, and per-batch wall time
- Dependency graph visualization: which systems are independent, serialization edges between batches
- Frame time breakdown: input, fixed update, render
- Alert when frame budget is exceeded

**Parameter Panel:**
- Auto-generated sliders, inputs, and color pickers from `defineParameter()` metadata
- Grouped by category (`group` field)
- Range-constrained with configurable step size
- Preset save/load — save current parameter values as a named JSON preset, load presets to switch configurations instantly
- Real-time updates — changing a parameter immediately affects the next simulation tick

**Physics Debug:**
- Toggle collider shape rendering
- Show contact points and normals
- Show AABB tree
- Pause/step physics simulation

**Recording Controls** (when `@nova/recorder` is active):
- Start/stop recording
- Timeline scrub bar for playback
- Frame-by-frame stepping through recorded data
- CSV export button

**Network Inspector** (when `@nova/net` is active):
- Bandwidth graph (bytes sent/received per second)
- Snapshot diff viewer
- Simulated latency/jitter/packet loss controls

## Headless Testing

Since the engine supports headless mode, simulation logic can be tested without a browser:

```bash
npx vitest                           # run unit tests for systems in Node.js
npx nova test --headless             # run a simulation scenario headlessly, assert outcomes
```

Systems are pure functions of component data — they can be tested in isolation by creating a headless `Engine`, spawning test entities, ticking, and asserting state.

## CLI

```bash
npx nova create my-project           # scaffold with template selection (game, simulation, visualization)
npx nova add physics-rapier          # add a package
npx nova dev                         # start dev server with HMR + devtools + parameter panel
npx nova build                       # production build (tree-shaken, devtools stripped)
npx nova export                      # export for web (default)
npx nova export --target web         # static build for self-hosting
npx nova export --target web --pwa   # + service worker + manifest (installable, offline)
npx nova export --target web --zip   # .zip for itch.io upload
npx nova export --target electron    # Electron desktop app (.dmg, .exe, .AppImage)
npx nova export --target local       # standalone .exe with embedded server + native bridge
```

The `export` command is detailed in [Packaging & Distribution](./18-packaging.md).

---

# 12. Scenes, Prefabs & Serialization

## Overview

A **scene** is a declarative description of entities, their components, and their hierarchy. Scenes are stored as `.nova.json` files — human-readable, diffable, and editable by hand or by the visual editor.

A **prefab** is a reusable entity template. Scenes reference prefabs by name and may override specific fields per instance.

## Prefabs

Prefabs are defined in code and registered with the engine:

```typescript
import { definePrefab } from '@nova/core';

const CratePrefab = definePrefab('Crate', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'crate', width: 32, height: 32 },
  RigidBody: { type: 'dynamic' },
  Collider: { shape: 'box', width: 32, height: 32 },
});

// Spawn with defaults
const crate1 = world.spawn(CratePrefab);

// Spawn with overrides
const crate2 = world.spawn(CratePrefab, {
  Position: { x: 200, y: 100 },
});
```

Prefabs can include children:

```typescript
const PlayerPrefab = definePrefab('Player', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'player', width: 32, height: 32 },
  Player: {},
  children: [
    { name: 'Sword', components: {
      Position: { x: 16, y: 0 },
      Sprite: { texture: 'sword', width: 16, height: 16 },
    }},
  ],
});
```

### Prefab Inheritance (`extends`) — v1.1

> **Phasing note:** v1 ships flat prefabs with spawn-time overrides (the `definePrefab` + `world.spawn(Prefab, overrides)` pattern above). `extends` and `includes` are v1.1 features — the design is captured here for completeness, but implementation is deferred until flat prefabs prove insufficient.

### Prefab Inheritance (`extends`)

A prefab can extend exactly one base prefab, inheriting all components and children. The derived prefab overrides inherited values via shallow merge per component and may add new components. Chains are allowed.

```typescript
const EnemyPrefab = definePrefab('Enemy', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'enemy', width: 32, height: 32 },
  Health: { current: 100, max: 100 },
  AI: { behavior: 'patrol' },
  children: [
    { name: 'Shadow', components: {
      Sprite: { texture: 'shadow', width: 32, height: 8 },
      Position: { x: 0, y: 28 },
    }},
  ],
});

const BossEnemyPrefab = definePrefab('BossEnemy', {
  extends: EnemyPrefab,
  // Override specific fields — shallow merge per component
  Sprite: { texture: 'boss', width: 64, height: 64 },
  Health: { current: 500, max: 500 },
  // Add new components
  Boss: { phase: 1 },
  // Inherited unchanged: Position, AI, children (Shadow)
});

// Chains work — MegaBoss inherits from BossEnemy which inherits from Enemy
const MegaBossPrefab = definePrefab('MegaBoss', {
  extends: BossEnemyPrefab,
  Health: { current: 2000, max: 2000 },
  Boss: { phase: 1, enrageThreshold: 0.25 },
});
```

> Convention: inheritance chains deeper than 3 are a code smell. Prefer composition via `includes` for mixing orthogonal behaviors.

### Prefab Composition (`includes`)

A prefab can include multiple other prefabs to compose orthogonal behaviors. Included prefabs are merged left-to-right; later includes override earlier ones for conflicting fields. The defining prefab's own declarations always win.

```typescript
const DamageableMixin = definePrefab('Damageable', {
  Health: { current: 100, max: 100 },
  HitFlash: { duration: 0.1, color: '#ff0000' },
});

const LootableMixin = definePrefab('Lootable', {
  LootTable: { table: 'default', dropChance: 0.5 },
});

const AnimatedMixin = definePrefab('Animated', {
  AnimationState: { current: 'idle', speed: 1.0 },
});

const TreasureChestPrefab = definePrefab('TreasureChest', {
  includes: [DamageableMixin, LootableMixin, AnimatedMixin],
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'chest', width: 32, height: 32 },
  Health: { current: 50, max: 50 },  // overrides DamageableMixin
  Collider: { shape: 'box', width: 32, height: 32 },
});
```

### Combined `extends` + `includes`

Both mechanisms can be used together:

```typescript
const SkeletonPrefab = definePrefab('Skeleton', {
  extends: EnemyPrefab,
  includes: [DamageableMixin, LootableMixin],
  Sprite: { texture: 'skeleton', width: 32, height: 32 },
  AI: { behavior: 'chase' },
  // Health from DamageableMixin overrides EnemyPrefab's Health
  // LootTable from LootableMixin
  // Position from EnemyPrefab base
  // Sprite from own declaration overrides everything
});
```

### Merge Semantics

Components are resolved via **shallow object merge per component** — matching the existing spawn-override behavior. Given components `A = { x: 1, y: 2 }` and `B = { y: 3, z: 4 }`, the merge `A + B` produces `{ x: 1, y: 3, z: 4 }`.

Layers are applied in deterministic order, each overriding the previous:

```
Layer 0:  extends chain (deepest ancestor first, resolved recursively)
Layer 1:  includes[0]
Layer 2:  includes[1]
...
Layer N:  includes[last]
Layer N+1: Own declarations (always win)
```

**Children** merge by `name` across layers using the same component-merge rule. Children without a `name` are never merged — they are always appended. New children from later layers are appended after inherited children.

**Component removal** is intentionally unsupported. A derived prefab cannot remove a component from its base or includes — this would break the "is-a" contract of `extends` and the "has-a" contract of `includes`. If an entity should not have a particular component, create a new prefab that does not extend/include the one that defines it.

**Resolution** happens once at `definePrefab()` time. The result is a flattened component map cached on the `PrefabToken`. There is no per-spawn resolution cost.

**Circular references** in `extends` chains or `includes` graphs are detected at `definePrefab()` time and throw a fatal error.

**Diamond includes** (A includes B and C, both of which include D) are allowed. D's components appear once — the leftmost occurrence establishes the baseline, and subsequent occurrences are no-ops since D is already merged.

### Spawn-Time Child Overrides

The `world.spawn()` API accepts an optional `childOverrides` key for overriding inherited children's components:

```typescript
const boss = world.spawn(BossEnemyPrefab, {
  Position: { x: 500, y: 200 },
  childOverrides: {
    'Shadow': { Sprite: { texture: 'boss-shadow', width: 64, height: 8 } },
  },
});
```

The `childOverrides` key is reserved and cannot conflict with component names (component names are PascalCase by convention; `childOverrides` is camelCase).

## Scene Files

Scene files are JSON documents that describe a collection of entities:

```json
{
  "name": "Level1",
  "engineVersion": "1.0.0",
  "entities": [
    {
      "name": "Player",
      "prefab": "Player",
      "components": {
        "Position": { "x": 400, "y": 300 }
      }
    },
    {
      "name": "Crate1",
      "prefab": "Crate",
      "components": {
        "Position": { "x": 100, "y": 200 }
      }
    },
    {
      "name": "Background",
      "components": {
        "Position": { "x": 0, "y": 0 },
        "Sprite": { "texture": "background", "width": 800, "height": 600 },
        "RenderOrder": { "layer": -10 }
      },
      "children": []
    }
  ],
  "resources": {}
}
```

**Scene versioning:** The `engineVersion` field records which engine version created the file. On load, the scene loader compares it against the current engine version. If the versions differ, any registered scene migrations run in order (oldest-first) to transform the JSON before entity spawning. Migrations are pure functions: `(sceneJson: object, fromVersion: string) => object`. In both `dev` and `production` error modes, a missing `engineVersion` field emits a warning. This keeps the migration system simple — no schema registry, just an ordered list of transform functions.

When a scene references a prefab, only the **overridden fields** are stored in the scene file.
This keeps scene files small and means updating a prefab definition automatically updates all instances that haven't overridden that field.

**Cascade behavior**: Overrides are computed against the **resolved** (flattened) prefab, not against any particular layer in the inheritance chain. If a base prefab changes a default value, all scene instances whose overrides do not explicitly set that field will pick up the new value automatically.

Scene entities may include `childOverrides` to override component values on inherited children without redefining the entire child hierarchy:

```json
{
  "name": "MyBoss",
  "prefab": "BossEnemy",
  "components": {
    "Position": { "x": 500, "y": 200 }
  },
  "childOverrides": {
    "Shadow": {
      "components": {
        "Sprite": { "texture": "boss-shadow", "width": 64, "height": 8 }
      }
    }
  }
}
```

## Scene Loading

```typescript
import { loadScene, unloadScene } from '@nova/core';

// Load a scene — spawns all entities, returns handles
const level = await loadScene(engine, 'assets/scenes/level1.nova.json');

// Access named entities
const player = level.getEntity('Player');

// Unload — destroys all entities from this scene
unloadScene(engine, level);
```

## ECS Integration

Scenes add metadata components to spawned entities:

```typescript
// Automatically added to scene-spawned entities
const Name = defineComponent({ value: Types.string });
const SceneEntity = defineComponent({
  sceneId: Types.string,    // which scene file
  entityIndex: Types.u32,   // index within the scene
});
const PrefabInstance = defineComponent({
  prefabId: Types.string,   // concrete prefab name (e.g. 'BossEnemy', not the chain)
});
```

`PrefabInstance.prefabId` stores the **concrete** prefab name only. Inheritance lineage is a definition-time concern resolved before spawning. The editor and tooling can look up the full chain from the prefab registry via `PrefabToken.base` and `PrefabToken.includes`.

The `EditorOnly` tag component marks entities that exist only in development mode and are stripped from production builds.

---

# 13. Visual Editor (In-Line Editing)

> **Phasing note:** The visual editor is Phase 3 scope. v1 ships with a basic entity inspector (view/edit component values in real-time) and system profiler as part of `@nova/devtools`. The full visual editor with round-trip file persistence, viewport gizmos, and prefab editing is a Phase 3 deliverable. The design below captures the full vision.

## Design Goal

**Projects built with HyperNova can be edited in code OR via a visual UI.** The visual editor is not a separate application — it's a mode of `@nova/devtools` that runs alongside the game during development. Changes flow bidirectionally: edits in the visual editor write to scene files on disk, and edits to scene files in a code editor update the running game via HMR.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  Code Editor │ ◄───────────────► │  Vite Dev Server  │
│  (VS Code)   │   file watch       │  @nova/vite-plugin│
└──────────────┘                   └────────┬─────────┘
                                            │ HMR
                                            ▼
┌──────────────────────────────────────────────────────┐
│                 Browser                               │
│  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │  Game Canvas        │  │  Visual Editor Panels   │ │
│  │  + Viewport Gizmos  │  │  (HTML overlay)         │ │
│  │                     │  │                          │ │
│  │  [translate] [rotate│  │  Scene Hierarchy         │ │
│  │   scale handles]    │  │  Inspector               │ │
│  │                     │  │  Prefab Editor           │ │
│  └─────────┬──────────┘  │  Asset Browser            │ │
│            │              └────────────┬─────────────┘ │
│            │  ECS read/write           │               │
│            ▼                           ▼               │
│  ┌──────────────────────────────────────────────────┐ │
│  │            Live ECS World                         │ │
│  └──────────────────────┬───────────────────────────┘ │
│                         │ persist                      │
│                         ▼                              │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Scene Files (.nova.json) — written via dev server│ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## What's Editable via UI vs Code-Only

| Editable in Visual Editor | Code-Only |
|---|---|
| Entity creation, destruction, hierarchy | System logic (`execute` functions) |
| Component values (position, size, color...) | Custom component schemas (`defineComponent`) |
| Prefab instantiation + override editing | Query construction |
| Scene composition (place entities in world) | Plugin configuration |
| Tilemap painting | Shader code |
| Physics collider shape tweaking | Worker task/job/stream handlers |
| Sprite and animation assignment | Networking logic |
| Input action binding | |

**Principle:** data is editable via UI, logic is code-only. The editor never generates or modifies TypeScript source files.

## Editor Panels

**Scene Hierarchy:**
- Tree view of all entities, grouped by scene and prefab origin
- Drag-and-drop reparenting (changes `Parent` component)
- Right-click context menu: create entity, add component, duplicate, delete
- Search/filter by component type or entity name
- Multi-select for bulk operations (move, delete, reparent)

**Inspector** (the core of in-line editing):
- Select an entity → see all its components as editable form fields
- Type-specific field editors generated from component schemas:

| Component Type | Editor Widget |
|---|---|
| `Types.f32` / `Types.i32` | Number input with drag-to-scrub |
| `Vec2` | XY inputs + draggable gizmo on canvas |
| `Color` | Color picker with hex/RGBA input |
| `Types.bool` | Checkbox |
| `Types.string` | Text field |
| `Enum` / tag union | Dropdown selector |
| Texture / asset ref | Asset picker with preview thumbnail |

- Changes apply immediately to the live ECS world (no "apply" button)
- "Reset to prefab default" per-field when the entity is a prefab instance (resets to the resolved default, considering the full inheritance chain)
- **Lineage breadcrumb**: when inspecting a prefab instance, show the inheritance chain (e.g. `Enemy > BossEnemy`) with clickable links to navigate to parent prefab definitions
- **Field provenance**: each component field indicates its source layer — *inherited* (dimmed), *own* (normal), or *overridden* (bold, with reset icon)
- Add/remove component buttons

**Viewport Gizmos:**
- Translate, rotate, and scale handles rendered on the game canvas over the selected entity
- Snap-to-grid with configurable grid size (hold Shift for fine control)
- Multi-entity selection with bounding box
- Gizmos are rendered in a separate overlay pass — they don't affect game rendering

**Prefab Editor:**
- Create a prefab from any entity or selection of entities
- Edit prefab defaults — all non-overridden instances update live
- Override tracking: fields that differ from the prefab are marked with a visual indicator
- "Apply to prefab" button to push instance overrides back to the prefab definition
- **Lineage view**: display the `extends` chain and `includes` list for the selected prefab
- **Effective component table**: show all components on the resolved prefab with source annotations (which layer each field originates from)
- Children inherited from a base are visually distinguished from children defined directly on the prefab

## Round-Trip Persistence

The core challenge: how do visual edits become files the developer commits to source control?

**Solution:** Scene files (`.nova.json`) are the persistence layer. The visual editor writes to them, and they are the single source of truth for entity data.

1. **UI → Disk:** When the developer modifies a value in the inspector or drags an entity in the viewport, the editor sends the change to the Vite dev server via WebSocket. The dev server applies a JSON patch to the corresponding `.nova.json` file on disk.

2. **Disk → UI:** The Vite dev server watches `.nova.json` files via `chokidar`. When a file changes (from the code editor or external tooling), it pushes the update to the browser via HMR. The scene loader diffs the old and new scene data and patches the live ECS world — no full reload needed.

3. **Conflict handling:** Last-write-wins with an undo stack. External file changes trigger a "scene updated externally" toast in the editor. The undo stack tracks editor operations, not file states, so Ctrl+Z works intuitively.

4. **What's NOT persisted to scene files:** Runtime-only state (particle positions, physics velocities, animation playback state). Only initial/default component values are stored.

## Activation

```typescript
// In engine config
const engine = new Engine({
  width: 800,
  height: 600,
  editor: true,              // enables visual editor panels + scene persistence
  maxSubstepsPerFrame: 4,    // cap fixed update accumulator (see Error Handling)
  errorMode: 'dev',           // 'dev' | 'production' (see Error Handling)
});

// Or via URL parameter:  ?editor=true
// Or via the devtools console:  engine.enableEditor()
```

The visual editor is part of `@nova/devtools` and is completely tree-shaken from production builds.

---

# 14. Game States & Scene Transitions

## State Machine

Games need high-level state management — menu → playing → paused → game over. HyperNova provides a stack-based state machine. States are **lifecycle and scene containers**, not system containers. All systems are registered globally in the stage pipeline; state-aware systems read the `StateStack` resource to decide whether to run.

### Defining States

```typescript
import { defineState, StatePlugin, StateStack } from '@nova/core';

const MenuState = defineState({
  name: 'Menu',
  scene: 'assets/scenes/menu.nova.json',
  onEnter({ engine }) {
    // Called when this state becomes the active (top-of-stack) state
    // Insert state-scoped resources here
    engine.world.insertResource(MenuData, { selectedIndex: 0 });
  },
  onExit({ engine }) {
    // Called when this state is removed from the stack
    // Clean up state-scoped resources here
    engine.world.removeResource(MenuData);
  },
});

const PlayingState = defineState({
  name: 'Playing',
  scene: 'assets/scenes/level1.nova.json',
  onEnter({ engine }) { /* ... */ },
  onPause({ engine }) { /* called when another state pushes on top */ },
  onResume({ engine }) { /* called when the state above pops */ },
});

engine.addPlugin(StatePlugin({ initial: MenuState }));

// Transition between states
engine.states.push(PlayingState);      // push onto stack (Menu pauses)
engine.states.pop();                   // pop back to Menu
engine.states.switch(GameOverState);   // replace top of stack
```

### Global Systems & the Resource Guard Pattern

All systems are globally registered via `addStage()` / `addSystem()` and run every frame. Systems that should only execute in certain game states guard on the `StateStack` resource:

```typescript
const MenuInputSystem = defineSystem({
  name: 'MenuInput',
  resources: { read: [StateStack, InputState], write: [] },
  execute({ resources }) {
    const states = resources.get(StateStack);
    if (states.current.name !== 'Menu') return;
    // ... menu-specific input handling
  },
});

const PlayerMovementSystem = defineSystem({
  name: 'PlayerMovement',
  query: query(Position, Velocity).write(Position, Velocity),
  resources: { read: [StateStack], write: [] },
  execute({ entities, resources }) {
    const states = resources.get(StateStack);
    if (states.current.name !== 'Playing') return;
    // ... gameplay movement logic
  },
});
```

This keeps the stage pipeline static — no systems are added or removed at runtime. The scheduler's dependency graph is built once at startup and remains stable across state transitions.

### StateStack Resource

`StatePlugin` provides the `StateStack` resource:

```typescript
interface StateStack {
  readonly current: StateToken;          // top-of-stack (active state)
  readonly stack: ReadonlyArray<StateToken>;  // full stack, bottom to top
  push(state: StateToken, options?: TransitionOptions): void;
  pop(options?: TransitionOptions): void;
  switch(state: StateToken, options?: TransitionOptions): void;
}
```

### State Lifecycle

State transitions are **deferred commands** — they are queued when called and applied at the next stage-boundary command flush, guaranteeing no lifecycle callbacks fire mid-stage.

**`push(NewState)`:**
1. `currentState.onPause()` is called.
2. `NewState`'s scene is loaded (if `scene` is specified).
3. `NewState.onEnter()` is called.
4. `StateStack.current` now points to `NewState`.

**`pop()`:**
1. `topState.onExit()` is called.
2. `topState`'s scene entities are destroyed (unless marked persistent).
3. `previousState.onResume()` is called.
4. `StateStack.current` now points to `previousState`.

**`switch(NewState)`:**
Equivalent to `pop()` then `push(NewState)`, executed atomically within a single command flush.

## Scene Transitions

States can optionally define transition effects:

```typescript
engine.states.switch(PlayingState, {
  transition: 'fade',   // built-in: fade, slide, wipe, none
  duration: 0.5,
});
```

---

# 15. Performance Discipline

## Zero Allocations Per Frame

In steady state (no entity spawning/destroying), the engine targets **zero heap allocations per frame** to avoid GC pauses.

Strategies:
- **Ring-buffered events** — each `defineEvent` type is backed by a pre-allocated ring buffer (SoA typed arrays for numeric-only payloads, object-pool ring for complex payloads). Emit advances a write cursor; read iterates without allocation. Buffers are cleared by cursor reset at frame boundary — no deallocation.
- **Pre-allocated typed arrays** for component storage (field arrays allocated once at startup, sized to `maxEntities`)
- **Reusable Vec2/Mat3 scratch objects** in math operations — the math library provides a `scratch` API that returns pooled temporaries
- **No closures in hot paths** — system execute functions receive context via parameters, not captured variables; events are pull-based (no callback registration)

The `@nova/devtools` profiler tracks allocations per frame and alerts when the budget is exceeded.

## Spatial Indexing

For worlds larger than the viewport, efficient spatial queries are critical for culling, proximity checks, and broad-phase collision outside of Rapier.

`@nova/core` provides:

- **Uniform grid** — O(1) insertion/removal, O(neighbors) query. Best for entities of similar size. Default for most simulations.
- **Quadtree** (optional) — better for worlds with entities of wildly varying sizes.

```typescript
import { SpatialIndex } from '@nova/core';

const spatial = world.getResource(SpatialIndex);

// Caller-owned result buffer — zero allocation per query
const results = new Uint32Array(256);           // reuse across frames
const count = spatial.queryAABB(x - 100, y - 100, x + 100, y + 100, results);
for (let i = 0; i < count; i++) {
  const eid = results[i];
  // ... process nearby entity
}
```

The spatial index is automatically maintained by a `SpatialIndexSystem` that runs in the dedicated `spatial` stage (immediately after `physics`, before `post-physics`). It reads `Position` and optionally `AABB`/`Collider` for bounds. Because physics is the last stage that modifies positions, all subsequent stages — `post-physics`, `gameplay`, and `render-prep` — see current-frame spatial data.

---

# 16. Packaging & Distribution

HyperNova simulations are browser-first, but distribution needs vary. The `nova export` command provides three targets that all consume the same Vite production build:

```
nova build (Vite production)
     │
     ▼
  dist/  (static HTML/JS/CSS/WASM/assets)
     │
     ├──▶  --target web        → deploy-ready static bundle
     ├──▶  --target electron   → desktop app with native integration
     └──▶  --target local      → standalone .exe with embedded server + native bridge
```

## 16.1 Web Target (Default)

`nova export --target web` produces a self-contained static directory for deployment to any HTTP server or hosting platform.

**Output:**
```
dist/
  index.html
  assets/
    main-[hash].js          # tree-shaken, minified
    main-[hash].css
    rapier_bg-[hash].wasm   # if @nova/physics-rapier used
    images/
    audio/
  manifest.json             # asset manifest for preloading
  _headers                  # Netlify header config
  .htaccess                 # Apache header config
```

**Hosting requirements:**
- HTTPS (required for WebGPU — all major hosting platforms provide this)
- `.wasm` served with `Content-Type: application/wasm`
- For `SharedArrayBuffer` support (`@nova/workers`), the server must send:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`

The export generates `_headers` (Netlify format) and `.htaccess` (Apache) with the correct COOP/COEP headers. Nginx and Caddy snippets are printed to the console.

**PWA mode** (`nova export --target web --pwa`):
- Generates `manifest.webmanifest` with app name, icons, `display: fullscreen`, theme color
- Generates a service worker that precaches all assets from the manifest
- App becomes installable via browser's "Install App" prompt
- Fully offline-capable after first visit

**itch.io mode** (`nova export --target web --zip`):
- Produces a `.zip` with `index.html` at root (itch.io requirement)
- All asset paths relative

## 16.2 Electron Target (Desktop App)

`nova export --target electron` produces a native desktop application using Electron. This is the recommended target for simulation tools, editors, dashboards, and any application that needs native OS integration.

**Capabilities beyond web:**

| Feature | Details |
|---------|---------|
| Native window chrome | Frameless window, custom titlebar, always-on-top |
| System tray | Minimize to tray, tray menu, notifications |
| File system | `dialog.showOpenDialog()`, direct file read/write |
| Multi-window | Separate windows for devtools, parameter panels, data views |
| Native menus | OS menu bar with keyboard shortcuts |
| Auto-update | `electron-updater` for automatic update delivery |
| GPU context | Chromium's GPU stack — WebGPU without browser restrictions |
| Offline | Built-in — no server required |

**Architecture:**
```
┌────────────────────────────┐
│  Electron Main Process     │
│  - Window management       │
│  - @nova/native services   │
│  - File system access      │
│  - IPC message routing     │
└──────────────┬─────────────┘
               │ contextBridge / IPC
┌──────────────┴─────────────┐
│  Renderer Process          │
│  - HyperNova Engine        │
│  - Simulation + Rendering  │
│  - Devtools panel          │
└────────────────────────────┘
```

**`@nova/native` integration:** In Electron, the native bridge uses Electron IPC instead of WebSocket — faster, no localhost server required. `defineNativeService` methods run in the main process. `defineNativeClient` calls are routed via `contextBridge`.

**Preload script:** A generated preload script exposes a minimal, typed API via `contextBridge.exposeInMainWorld()`:
```typescript
// Automatically generated — no manual Electron boilerplate
window.nova = {
  native: { invoke, on, off },     // @nova/native IPC
  fs: { readFile, writeFile, ... }, // if @nova/persist uses filesystem
  dialog: { open, save },          // file dialogs
  app: { quit, setTitle },         // window management
};
```

**Build process:**
1. Run `nova build` (Vite production)
2. Generate Electron main process script (~200 lines)
3. Generate preload script with `contextBridge` bindings
4. Bundle with `electron-builder` or `electron-forge`
5. Produce platform-specific outputs (.dmg, .exe installer, .AppImage, .deb)

**Output:**
```
release/
  MySimulation.dmg         # macOS
  MySimulation-Setup.exe   # Windows installer
  MySimulation.AppImage    # Linux
```

**Binary size:** ~80–120 MB (Electron runtime + Chromium + game assets). Compressed: ~40–60 MB.

## 16.3 Local Server Target (Standalone Executable)

`nova export --target local` produces a single executable that embeds the simulation files and a minimal HTTP server. On launch it serves the simulation on localhost and opens the user's default browser. This is a lighter alternative to Electron when native OS integration is not needed.

**Technology:** Node.js Single Executable Application (SEA), built into Node.js 20+. The entire dist directory and a ~240-line server (HTTP + WebSocket) are embedded into the Node.js binary via `sea.getRawAsset()`.

**Runtime behavior:**
1. Probe for a free port starting at 7700 (sequential scan, `127.0.0.1` only)
2. Start `node:http` serving embedded assets with correct MIME types and COOP/COEP headers
3. Initialize the `@nova/native` service registry and load configured native services
4. Listen for WebSocket upgrade on `/__nova` for the native module bridge
5. Open the default browser to `http://127.0.0.1:{port}`
6. Console displays: `Simulation running at http://127.0.0.1:7700 — press Ctrl+C to quit`
7. Graceful shutdown on `SIGINT`/`SIGTERM` (calls `dispose()` on all native services)

**Embedded server details:**
- Raw `node:http` + `ws` (pure JS WebSocket library, ~25 KB, no native dependencies)
- MIME type map covers `.html`, `.js`, `.css`, `.wasm`, `.png`, `.jpg`, `.webp`, `.avif`, `.ogg`, `.mp3`, `.wav`, `.json`
- `.wasm` → `application/wasm` (required for `WebAssembly.instantiateStreaming`)
- COOP/COEP headers on all responses (enables `SharedArrayBuffer`)
- SPA fallback: unknown routes serve `index.html`
- WebSocket on `/__nova`: native service bridge for `@nova/native` (see [Native Module Bridge](./12-native-bridge.md))

**Native module support:** When the simulation uses `@nova/native` services (see [Native Module Bridge](./12-native-bridge.md)), the server loads the configured service modules and routes WebSocket messages to them. Native Node.js addons (`.node` files compiled from C/C++) cannot be embedded in the SEA blob — they are shipped in an `addons/` directory alongside the executable. The server resolves native module `require()` calls relative to the executable's directory.

**WebGPU:** `127.0.0.1` is a secure context in all browsers — WebGPU works without HTTPS.

**Build process:**
1. Run `nova build` (Vite production)
2. Bundle server script to single CJS file via esbuild (native addon requires marked as external)
3. Collect native addon `.node` files into `addons/` (via `prebuild-install` for prebuilt binaries, `node-gyp` fallback)
4. Rewrite native module require paths to resolve relative to the executable
5. Generate SEA config (enumerate all files in `dist/`, map to asset keys)
6. Run `node --build-sea` to produce the executable
7. (Optional) `rcedit` to set custom icon on Windows

**Output:**
```
release/
  mysimulation.exe         # SEA binary (simulation + server embedded)
  addons/                  # native addon files (only if @nova/native used)
    serialport.node
    other-binding.node
```

**Binary size:** ~50–75 MB (Node.js binary ~50 MB + simulation assets). Compressed: ~25–40 MB. Native addons add their own size (typically 1–5 MB each).

## 16.4 Export Configuration

```typescript
// nova.config.ts
export default {
  name: 'My Simulation',
  width: 800,
  height: 600,
  icon: './assets/icon.png',

  export: {
    web: {
      pwa: false,        // generate service worker + manifest
      zip: false,        // produce itch.io zip
    },
    electron: {
      frameless: false,   // frameless window (custom titlebar)
      tray: false,        // system tray support
      autoUpdate: false,  // electron-updater integration
    },
    local: {
      port: 7700,        // preferred starting port
      openBrowser: true,  // auto-open browser on launch
      native: {          // @nova/native service configuration (optional)
        services: ['./services/serial.service'],
      },
    },
  },
};
```

**CLI flags:**
```bash
nova export --target <web|electron|local>
            --out ./release          # output directory
            --name "My Simulation"   # executable/app name
            --icon ./icon.png        # app icon
            --pwa                    # web only: enable PWA
            --zip                    # web only: produce zip
            --platform <win32|darwin|linux>  # electron/local: target OS
```

## 16.5 Vite Plugin Requirements

For all export targets to work correctly, `@nova/vite-plugin` must:
- Set `base: './'` (relative paths) in production builds — relative paths are required for the local target's embedded server and Electron's file:// protocol
- Emit a WASM loader that falls back to `WebAssembly.instantiate(arrayBuffer)` when `instantiateStreaming` fails (handles missing MIME type gracefully)

## 16.6 Comparison

| Dimension | Web | Electron | Local (.exe) |
|---|---|---|---|
| Output size | Game only | ~80–120 MB | ~50–75 MB |
| Distribution | URL | Installer / DMG | Download .exe + addons/ |
| WebGPU guaranteed | No | Yes (Chromium) | No (user's browser) |
| Offline | PWA mode | Yes | Yes |
| Native APIs | None | Full (via IPC) | Via `@nova/native` WS bridge |
| File dialogs | No | Yes | No |
| System tray | No | Yes | No |
| Multi-window | No | Yes | No |
| Auto-update | Redeploy | electron-updater | Manual |
| Mobile | Yes | No | No |
| Build deps | None | electron-builder | None |
| Save to disk | IndexedDB | Filesystem (IPC) | Via `@nova/native` service |

---

# 17. Plugin System

Every optional subsystem in HyperNova — renderer, physics, input, workers, native bridge, game states — integrates through the same plugin protocol. A plugin is a **named setup function** that receives a registration context and returns an optional cleanup function. No classes, no inheritance, no registration ceremonies — just a function that tells the engine what to set up.

The ECS world itself is the integration layer. Plugins communicate at runtime through components, resources, and events — not through each other.

## 17.1 Plugin Interface

```typescript
interface Plugin {
  readonly name: string;
  readonly depends?: string[];
  install(app: EngineBuilder): PluginResult | Promise<PluginResult>;
}

type PluginResult = void | CleanupFn | EngineError;
type CleanupFn = () => void;
```

Three fields, one required method. If `install()` returns an `EngineError`, the engine collects it and halts before the first frame — after all plugins have attempted installation, so the developer sees ALL failures at once.

| Field | Purpose |
|-------|---------|
| `name` | Unique string identifier. Used for dependency resolution, debugging, hot-reload targeting. |
| `depends` | Plugin names that must install before this one. Omit for no dependencies. |
| `install` | Called once during engine setup. Receives a restricted builder. May return a cleanup function. May be async (WASM loading, WebSocket connections). |

## 17.2 EngineBuilder

Plugins receive `EngineBuilder` — a restricted projection of `Engine` that exposes only registration APIs, not runtime controls like `start()`, `stop()`, or `dispose()`.

```typescript
interface EngineBuilder {
  readonly world: World;

  // Components — allocate SoA columns in the arena (see Error Handling)
  registerComponent(...components: Component[]): Result<void, EngineError>;

  // Resources — typed singleton state
  insertResource<T>(token: ResourceToken<T>, value: T): void;
  getResource<T>(token: ResourceToken<T>): T;

  // Events — type-safe ring-buffered channels
  defineEvent<T>(schema?: EventSchema<T>): EventToken<T>;

  // Stages — create stage, optionally with initial systems and ordering
  addStage(name: string, systems?: SystemDef[], options?: StageOptions): void;

  // Systems — add to an existing stage
  addSystem(stage: string, ...systems: SystemDef[]): void;

  // Sub-plugins — composable plugin groups
  addPlugin(plugin: Plugin): void;

  // Inline cleanup — for conditional or multi-step disposal
  onDispose(fn: CleanupFn): void;
}

interface StageOptions {
  after?: string;   // insert after this stage
  before?: string;  // insert before this stage
}
```

`Engine` implements `EngineBuilder`. During install, plugins see only the builder surface; the engine downcasts internally.

## 17.3 Configurable Plugins (Factory Pattern)

Most plugins accept configuration. The convention is a factory function that validates eagerly and returns a `Plugin`:

```typescript
function PhysicsPlugin(config: PhysicsConfig): Plugin {
  // Validate config at creation time — fail fast, not at install time
  if (config.substeps != null && (config.substeps < 1 || config.substeps > 8)) {
    throw new Error('physics: substeps must be 1–8');
  }

  let rapierWorld: RapierWorld;

  return {
    name: 'physics',
    depends: ['core'],

    async install(app) {
      const rapier = await import('@dimforge/rapier2d');
      rapierWorld = rapier.World.new(config.gravity ?? { x: 0, y: 400 });

      const reg = app.registerComponent(RigidBody, Collider);
      if (!reg.ok) return reg.error;  // arena exhausted → propagate to engine

      app.insertResource(PhysicsWorld, rapierWorld);
      app.defineEvent(CollisionStart);
      app.defineEvent(CollisionEnd);
      app.addStage('physics', [PhysicsSyncSystem, PhysicsStepSystem], { after: 'pre-physics' });

      return () => rapierWorld.free();
    },
  };
}
```

Simple plugins that need no configuration can be plain objects:

```typescript
const FPSPlugin: Plugin = {
  name: 'fps',
  install(app) {
    app.insertResource(FPSCounter, { frames: 0, fps: 0 });
    app.addSystem('render-prep', FPSCounterSystem);
  },
};
```

## 17.4 Dependency Resolution

Plugin dependencies are resolved after all `addPlugin()` calls complete (or lazily at `engine.start()`):

1. **Flatten** — Collect all plugins, including sub-plugins registered via `app.addPlugin()` inside composite install functions.
2. **Deduplicate** — Duplicate names are an error. This forces explicit intent and prevents silent config conflicts.
3. **Graph** — Build a directed graph from `depends` arrays.
4. **Validate** — Every dependency must exist. Cycles are a hard error.
5. **Sort** — Topological sort yields install order.
6. **Install** — Call each `install()` sequentially in sorted order, awaiting async installs.
7. **Dispose** — On `engine.dispose()`, call cleanups in reverse install order.

Error messages are explicit:

| Condition | Error |
|-----------|-------|
| Duplicate name | `Plugin "physics" already installed` |
| Missing dependency | `Plugin "gameplay" depends on "physics" which is not installed` |
| Circular dependency | `Circular plugin dependency: physics → gameplay → physics` |

## 17.5 Stage Ordering

Stages use constraint-based ordering resolved via topological sort. The canonical core stages are:

```
input → worker-sync → native-sync → pre-physics → physics →
spatial → post-physics → gameplay → render-prep
```

Plugins insert custom stages using `after` / `before` constraints:

```typescript
app.addStage('my-ai', [AIDecisionSystem, AIActionSystem], { after: 'post-physics', before: 'gameplay' });
```

Systems can also be omitted (stage-only) or added to an existing stage later:

```typescript
app.addStage('my-ai', [], { after: 'post-physics' });  // create empty stage
app.addSystem('my-ai', AIDecisionSystem);                // add system later
app.addSystem('gameplay', MyCustomSystem);                // add to existing stage
```

Rules:
- Contradictory constraints produce an error with a clear message.
- Adding systems to an existing stage via `addSystem()` is always valid.
- Calling `addStage` with an existing name merges ordering constraints (does not recreate the stage).

## 17.6 Plugin Composition

A plugin can install other plugins, enabling bundle patterns:

```typescript
function DefaultPlugins(config?: {
  renderer?: RendererConfig;
  input?: InputConfig;
  physics?: PhysicsConfig;
}): Plugin {
  return {
    name: 'defaults',
    install(app) {
      app.addPlugin(RendererPlugin(config?.renderer));
      app.addPlugin(InputPlugin(config?.input));
      if (config?.physics) {
        app.addPlugin(PhysicsPlugin(config.physics));
      }
    },
  };
}

// One-liner setup
engine.addPlugin(DefaultPlugins({
  physics: { gravity: { x: 0, y: 400 } },
}));
```

Sub-plugins participate in the same dependency resolution as top-level plugins. A composite plugin's own `depends` array is additive with its children's.

## 17.7 Conditional Activation

Plugins handle platform differences internally — no special framework mechanism needed:

```typescript
function NativePlugin(config: NativeConfig): Plugin {
  return {
    name: 'native',
    install(app) {
      if (typeof WebSocket === 'undefined') return;  // graceful no-op on web

      const bridge = new NativeBridge(config);
      app.insertResource(NativeBridgeToken, bridge);
      app.addStage('native-sync', [NativeSyncSystem], { after: 'worker-sync' });

      return () => bridge.close();
    },
  };
}
```

When a plugin no-ops, it installs nothing — no stages, no systems, no resources. Downstream plugins that depend on its resources should check availability via `app.getResource()` or guard their own behavior.

**Headless mode:** Plugins that require a GPU or browser DOM should check `app.config.headless` and no-op gracefully:

```typescript
function RendererPlugin(config?: RendererConfig): Plugin {
  return {
    name: 'renderer',
    install(app) {
      if (app.config.headless) return;  // no-op in headless mode
      // ... set up WebGPU, canvas, render systems ...
    },
  };
}
```

This pattern ensures the same simulation code — including all `addPlugin()` calls — works in both rendered and headless mode. The simulation doesn't need conditional plugin registration.

## 17.8 Hot Reload (Dev Mode)

During development, plugins can be swapped without restarting the engine:

```typescript
engine.reloadPlugin(PhysicsPlugin(newConfig));
```

The reload sequence:
1. Match existing plugin by `name`.
2. Call old plugin's cleanup function(s).
3. Call new plugin's `install()` — systems are replaced, resources re-inserted.
4. Resume game loop.

Component data and entity state are preserved across plugin reloads. Resource values are replaced only if the new plugin calls `insertResource` for the same token. PRNG state (`Random` resource) is also preserved.

## 17.9 Canonical Plugin Map

Every `@nova/*` package that touches the engine loop exposes a plugin:

| Plugin | Package | Stages | Resources | Key Components | Headless? |
|--------|---------|--------|-----------|----------------|-----------|
| `RendererPlugin` | `@nova/renderer-webgpu` | render-prep | RenderContext | Sprite, Camera, RenderOrder | No-op |
| `PhysicsPlugin` | `@nova/physics-rapier` | physics | PhysicsWorld | RigidBody, Collider | Works |
| `InputPlugin` | `@nova/input` | input | InputState | — | No-op |
| `AudioPlugin` | `@nova/audio` | — | AudioMixer | — | No-op |
| `WorkersPlugin` | `@nova/workers` | worker-sync | WorkerPool, WorkerResultBuffer | — | Works |
| `PersistPlugin` | `@nova/persist` | — | PersistStore | — | Works |
| `RecorderPlugin` | `@nova/recorder` | — | Recorder | — | Works |
| `NativePlugin` | `@nova/native` | native-sync | NativeBridge, NativeResultBuffer | — | Works |
| `StatePlugin` | `@nova/core` | — | StateStack | — | Works |

All are optional. The core engine runs with zero plugins — just a world and a simulation loop. "Headless?" indicates whether the plugin functions in headless mode (no browser/GPU).

## 17.10 Design Rationale

**Why not classes?** A plugin is data + a function. Classes add ceremony (constructors, `this` binding, inheritance chains) without benefit. Factory functions compose naturally and close over configuration.

**Why no `provides` declaration?** The `install()` function is the source of truth — it registers components, resources, events, stages, and systems directly. A separate manifest would duplicate this information and drift. Static analysis tools can introspect `install()` calls in a future pass without changing the plugin interface.

**Why no plugin-to-plugin communication channel?** The ECS world is the communication channel. Resources hold shared state; events carry messages; components tag entities. A plugin bus would create a parallel universe of state outside the ECS, breaking the "single source of truth" principle.

**Why no numeric ordering / priority?** Dependency declarations and stage constraints compose correctly under topological sort. Numeric priorities are fragile — they break when two independent plugins pick the same number, and they obscure intent ("why is this 50?").

**Why error on duplicate names (not silently deduplicate)?** Silent deduplication hides config conflicts. If `DefaultPlugins` installs `InputPlugin()` and the user also installs `InputPlugin({ custom: true })`, the first-wins behavior silently drops the custom config. Explicit errors force deliberate choices.

---

# 18. Error Handling

## Philosophy

HyperNova avoids exceptions at runtime. After `engine.start()`, no engine API throws. Errors are values — the type system forces the designer to handle them. But this is kept tractable: **hot paths are infallible by construction**, and only seven APIs require error checking. Everything else just works.

The key insight is a split between **hot paths** (per-frame, per-entity) and **boundary paths** (setup, I/O, async results):

| Path | Examples | Error Model |
|------|----------|-------------|
| Hot | `Position.x[eid]`, `events.read()`, `events.emit()` | Cannot fail. Queries only return live entities. Ring buffers always accept writes. |
| Boundary | `registerComponent()`, `loadManifest()`, `world.spawn()` | Returns `Result<T, EngineError>`. Caller must check. |
| Async result | `TaskTicket`, `NativeTicket` | Status field on ticket + typed event. |
| Frame-level | Physics budget, event ring overflow | `BudgetExceeded` event. No return value — it's an observation, not a per-call failure. |

**One exception:** Plugin factory config validation (e.g., `PhysicsPlugin({ substeps: -1 })`) throws synchronously. This runs before `engine.start()` — there is no game loop to protect, and a stack trace pointing at the bad config is the most helpful response.

## 18.1 Result Type

```typescript
type Result<T, E = EngineError> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };
```

TypeScript's control flow analysis narrows correctly:

```typescript
const r = app.registerComponent(Position, Velocity);
if (!r.ok) {
  // r.error: EngineError — must handle
  return r.error;
}
// r.value: void — safe to continue
```

There is no `.unwrap()`. If the developer wants to crash, they call `engine.halt()` explicitly.

Common errors are pre-allocated as frozen singletons — returning an error is a pointer copy, not a heap allocation.

## 18.2 Error Codes

```typescript
const enum Err {
  None = 0,

  // 0x01xx — Fatal (engine cannot continue)
  ArenaFull       = 0x0100,
  MaxEntities     = 0x0101,
  WasmInitFailed  = 0x0102,

  // 0x02xx — Recoverable (operation failed, engine continues)
  AssetNotFound       = 0x0200,
  AssetCorrupt        = 0x0201,
  AssetTimeout        = 0x0202,
  BridgeDisconnected  = 0x0210,
  BridgeCallFailed    = 0x0211,
  WorkerTimeout       = 0x0220,
  WorkerCrashed       = 0x0221,

  // 0x03xx — Budget (performance threshold exceeded)
  PhysicsBudgetExceeded = 0x0300,
  SystemBudgetExceeded  = 0x0301,
  EventRingOverflow     = 0x0302,

  // 0x04xx — Validation (bad input, engine substitutes defaults)
  InvalidConfig      = 0x0400,
  UnknownComponent   = 0x0401,
  StaleEntityHandle  = 0x0402,
  SceneParseError    = 0x0403,
}
```

## 18.3 Severity & EngineError

```typescript
const enum Severity {
  Fatal       = 0,  // Engine cannot continue. Game loop stops.
  Recoverable = 1,  // Operation failed but engine continues. Caller must handle.
  Budget      = 2,  // Performance threshold exceeded. Engine adapts. Diagnostics notified.
  Validation  = 3,  // Input data invalid. Engine substitutes defaults. Diagnostics notified.
}

interface EngineError {
  readonly severity: Severity;
  readonly code: Err;
  readonly message: string;    // human-readable in dev, empty string in prod
  readonly source?: string;    // package name: '@nova/core', '@nova/physics-rapier', etc.
}
```

Pre-allocated singletons for common errors:

```typescript
const ERRORS = {
  arenaFull: Object.freeze({
    severity: Severity.Fatal,
    code: Err.ArenaFull,
    message: 'Component arena exhausted: maxByteLength reached',
    source: '@nova/core',
  }),
  maxEntities: Object.freeze({
    severity: Severity.Fatal,
    code: Err.MaxEntities,
    message: 'Maximum entity count reached',
    source: '@nova/core',
  }),
  // ... one per common error
} satisfies Record<string, EngineError>;
```

## 18.4 Error Modes

The engine supports two error modes, controlling how non-fatal issues are surfaced:

```typescript
const engine = new Engine({
  errorMode: 'dev',       // default for `nova dev`
  // or: 'production'     // default for `nova build`
});
```

| Behavior | Dev | Production |
|----------|-----|------------|
| Asset 404 | Use fallback, log warning to console + Diag | Use fallback, emit `EngineWarning` event |
| Unknown component in scene | Skip, log warning | Skip, emit `EngineWarning` |
| Event ring overflow | Grow buffer once, log warning | Overwrite oldest, emit warning |
| Arena >90% at startup | Log warning | Emit warning |
| Stale entity handle used | Log to Diag | No-op |
| Config validation (post-start) | Log, use default | Use default, emit warning |

**Dev** is for development and prototyping — things just work, missing assets get placeholders, warnings go to console and Diag ring.

**Production** is for shipping — fallbacks are still used, but `EngineWarning` events are emitted so game code can respond (show retry UI, degrade gracefully). Console logging is minimized.


## 18.5 APIs That Return Results

Only these APIs require error checking. Everything else is infallible by construction:

| API | Returns | Failure Reason |
|-----|---------|----------------|
| `app.registerComponent()` | `Result<void, EngineError>` | Arena allocation exceeded |
| `world.trySpawn()` | `Result<Entity, EngineError>` | `maxEntities` reached |
| `loadManifest()` | `Result<ManifestAssets, AssetLoadReport>` | Network/parse failures |
| `loadScene()` | `Result<SceneHandle, AssetLoadReport>` | Network/parse/unknown component |
| `pool.submit()` | `TaskTicket` (status field) | Pool exhausted, worker crashed |
| `bridge.call()` | `NativeTicket` (status field) | Disconnected, timeout |
| Plugin `install()` | `PluginResult` | WASM load failure, resource unavailable |

## 18.6 Asset Error Handling

Every asset type has a built-in fallback that is always valid:

| Asset Type | Fallback |
|-----------|----------|
| Texture | 2x2 magenta/black checkerboard |
| Audio | Silent buffer (1 sample) |
| Tilemap | Empty tilemap (0 layers) |
| JSON data | `{}` |
| Font | Built-in 8x8 bitmap font |

Assets expose a three-state handle:

```typescript
const enum AssetStatus {
  Loading = 0,
  Ready   = 1,
  Failed  = 2,
}

interface AssetHandle<T> {
  readonly status: AssetStatus;
  readonly value: T | undefined;         // defined only when Ready
  readonly error: EngineError | undefined; // defined only when Failed
  readonly fallback: T;                   // always defined
}
```

Systems always get usable data:

```typescript
execute({ resources }) {
  const assets = resources.get(AssetStore);
  const tex = assets.get('player');              // AssetHandle<Texture>
  renderer.drawSprite(tex.value ?? tex.fallback, x, y);  // never undefined
}
```

Asset failure events flow through the standard event system:

```typescript
const AssetLoaded = defineEvent<{ key: string; type: string }>();
const AssetFailed = defineEvent<{ key: string; type: string; error: EngineError }>();
```

## 18.7 Diagnostics Resource

The engine provides a pre-allocated ring-buffered diagnostics log:

```typescript
interface DiagnosticLog {
  log(severity: Severity, code: Err, detail?: string): void;
  drain(): Iterable<DiagEntry>;
  readonly count: number;
}

interface DiagEntry {
  readonly frame: number;
  readonly severity: Severity;
  readonly code: Err;
  readonly detail: string;
  readonly timestamp: number;   // performance.now()
}
```

- Always available as a resource (inserted by the core engine, not a plugin).
- Ring capacity: 256 entries (oldest overwritten). Zero allocation in steady state.
- In production builds, `Diag.log()` is a no-op (tree-shaken). The ring buffer is not allocated.
- Devtools drains each frame and displays entries with severity coloring.

## 18.8 `engine.halt()`

For fatal errors that stop the engine:

```typescript
engine.halt(error: EngineError): never;
```

1. Cancels `requestAnimationFrame` — game loop stops.
2. Calls all registered dispose/cleanup functions in reverse plugin install order.
3. Emits `EngineHalted` event (observable via `engine.observe()` for devtools).
4. In dev mode, renders a diagnostic overlay on the canvas showing the error.
5. Throws an `Error` as the final action — after all cleanup is complete. This ensures the browser devtools console shows the failure. Nothing catches it.

## 18.9 Engine-Level Events

```typescript
const EngineWarning    = defineEvent<{ code: Err; message: string; source: string }>();
const BudgetExceeded   = defineEvent<{ system: string; budget: number; actual: number; dropped: number }>();
const AssetFailed      = defineEvent<{ key: string; type: string; error: EngineError }>();
const BridgeDisconnected = defineEvent<{ reason: string }>();
const BridgeReconnected  = defineEvent<{}>();
const WorkerTimeout    = defineEvent<{ taskName: string; ticketId: number; elapsed: number }>();
const EngineHalted     = defineEvent<{ error: EngineError }>();
```

These flow through the standard event system. In `production` mode, systems can read `EngineWarning` to implement game-level error handling (retry UI, fallback behavior, etc.). In `dev` mode, warnings are also logged to `Diag`.

## 18.10 Helper Utilities

```typescript
/** Unwrap or halt — for developers who want crash-on-error */
function must<T>(result: Result<T, EngineError>, engine: Engine): T {
  if (result.ok) return result.value;
  engine.halt(result.error);  // typed as `never`, so TypeScript narrows correctly
}

/** Unwrap or use default — for lenient prototyping */
function orDefault<T>(result: Result<T, EngineError>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
```

## 18.11 Design Rationale

**Why discriminated unions, not `(value, err)` tuples?** TypeScript cannot narrow `val` based on `err === null` in destructured tuples. The `{ ok, value }` / `{ ok, error }` pattern gets correct control flow analysis.

**Why no `.unwrap()`?** Unwrap reintroduces exceptions. The whole point is to avoid them. `must()` is explicit — it requires passing the engine, making the halt visible in the code.

**Why events for budget warnings, not Results?** Budget issues are per-frame observations, not per-call failures. No single system "caused" the budget to be exceeded. Events are the natural broadcast mechanism.

**Why pre-allocated error singletons?** Common errors are known at compile time. Returning a frozen singleton is a pointer copy — zero allocation even in error paths.

**Why two error modes?** `dev` optimizes feedback speed during development; `production` minimizes logging noise while preserving observable warnings for runtime handling.

**Why keep exceptions for plugin config?** Plugin factories run once, synchronously, before `engine.start()`. An immediate throw with a stack trace pointing at `PhysicsPlugin({ substeps: -1 })` is the fastest path to fixing the bug.

---

# Appendix A: Minimal Examples

## A.1 Headless Simulation (Node.js)

A deterministic flocking simulation that runs without a browser, canvas, or renderer:

```typescript
import {
  Engine, defineComponent, defineSystem, defineParameter,
  query, Random, Parameters, Types,
} from '@nova/core';

// Components
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Boid = defineComponent({});

// Parameters
const BoidSpeed = defineParameter({
  name: 'Boid Speed', type: 'f32', default: 100, range: [10, 500], group: 'Simulation',
});
const BoidCount = defineParameter({
  name: 'Boid Count', type: 'u32', default: 200, range: [10, 10000], group: 'Simulation',
});

// Systems
const FlockingSystem = defineSystem({
  name: 'Flocking',
  query: query(Boid, Position, Velocity).write(Velocity).read(Position),
  resources: { read: [Random, Parameters] },
  execute({ entities, resources }) {
    const rng = resources.get(Random);
    const speed = resources.get(Parameters).get(BoidSpeed);
    for (const eid of entities) {
      // simplified — real flocking would use spatial queries
      Velocity.x[eid] += (rng.rangeFloat(-1, 1)) * 10;
      Velocity.y[eid] += (rng.rangeFloat(-1, 1)) * 10;
      const len = Math.sqrt(Velocity.x[eid] ** 2 + Velocity.y[eid] ** 2);
      if (len > 0) {
        Velocity.x[eid] = (Velocity.x[eid] / len) * speed;
        Velocity.y[eid] = (Velocity.y[eid] / len) * speed;
      }
    }
  },
});

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

// Headless bootstrap
const engine = new Engine({ headless: true, seed: 42 });

engine.addStage('simulation', [FlockingSystem]);
engine.addStage('movement', [MovementSystem]);

// Spawn boids
for (let i = 0; i < 200; i++) {
  const rng = engine.world.getResource(Random);
  engine.world.spawn()
    .add(Position, { x: rng.rangeFloat(0, 800), y: rng.rangeFloat(0, 600) })
    .add(Velocity, { x: 0, y: 0 })
    .add(Boid, {});
}

// Run 1000 ticks — deterministic, reproducible
engine.tickN(1000);

// Assert state (for testing or analysis)
console.log(`Tick ${engine.world.getResource(Time).frame}`);
console.log(`Boid 0: (${Position.x[0].toFixed(1)}, ${Position.y[0].toFixed(1)})`);
```

This produces identical output on every run because:
- The seed is fixed (`42`)
- The timestep is fixed (1/60)
- The PRNG is deterministic (xoshiro256**)
- No `Math.random()` is used

## A.2 Browser-Rendered Variant

The same simulation, but with a renderer and input — adding just three lines:

```typescript
import {
  Engine, defineComponent, definePrefab, defineSystem, defineResource,
  defineState, query, loadScene, Types, StatePlugin,
} from '@nova/core';
import { RendererPlugin, Sprite } from '@nova/renderer-webgpu';
import { InputPlugin, InputState, compositeAxis } from '@nova/input';

// Components
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Player = defineComponent({});

// Prefab
const PlayerPrefab = definePrefab('Player', {
  Position: { x: 400, y: 300 },
  Velocity: { x: 0, y: 0 },
  Sprite: { texture: 'player', width: 32, height: 32 },
  Player: {},
});

// Systems
const PlayerInputSystem = defineSystem({
  name: 'PlayerInput',
  query: query(Player, Velocity),
  resources: { read: [InputState] },
  execute({ entities, resources }) {
    const input = resources.get(InputState);
    const dir = input.axis('move');
    for (const eid of entities) {
      Velocity.x[eid] = dir.x * 200;
      Velocity.y[eid] = dir.y * 200;
    }
  },
});

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

// Bootstrap — renderer and input are optional plugins
const engine = new Engine({ width: 800, height: 600, editor: true });
engine.addPlugin(RendererPlugin());
engine.addPlugin(InputPlugin({
  actions: {
    move: [compositeAxis('KeyA', 'KeyD', 'KeyW', 'KeyS')],
  },
}));

engine.addStage('input', [PlayerInputSystem]);
engine.addStage('movement', [MovementSystem]);

// Spawn from prefab (or load a scene file for the same result)
engine.world.spawn(PlayerPrefab);

engine.start();
```

## A.3 Scene-Based Variant

The same game using a scene file instead of imperative spawning:

**`assets/scenes/game.nova.json`:**
```json
{
  "name": "Game",
  "entities": [
    { "name": "Player", "prefab": "Player", "components": { "Position": { "x": 400, "y": 300 } } }
  ]
}
```

**`main.ts`:**
```typescript
// ... same engine setup as above ...
await loadScene(engine, 'assets/scenes/game.nova.json');
engine.start();
```

The scene file can be edited by hand, in VS Code, or in the visual editor — all three paths produce the same result.

---

# Appendix B: Comparison with Existing Frameworks

> **Note:** This comparison reflects the design specification, not current implementation status. Features listed for HyperNova are planned capabilities — not shipped features. This table serves as design rationale, showing where HyperNova intends to differentiate.

| Feature | Phaser 3 | Excalibur.js | PixiJS | HyperNova (planned) |
|---|---|---|---|---|
| Architecture | OOP/Scene | OOP/Actor | Renderer only | ECS |
| TypeScript | Retrofitted | Native | Native | Native (strict) |
| Renderer | WebGL1 | WebGL2/Canvas | WebGL2 | WebGPU + WebGL2 |
| Physics | Arcade/Matter | Arcade | None | Rapier2D (WASM) |
| Bundle (core) | ~1 MB | ~300 KB | ~200 KB | < 25 KB |
| Tree-shakeable | Partial | Yes | Yes | Yes |
| Headless mode | No | No | No | Yes (Node.js / CI) |
| Time control | No | No | N/A | Pause / slow-mo / fast-forward |
| Deterministic PRNG | No | No | N/A | Seeded xoshiro256** |
| Scene/Prefab | JSON scenes | Built-in | None | `.nova.json` + prefabs |
| Animation | Built-in | Built-in | None | Sprite, tween, state machine |
| In-game UI | DOM-based | Built-in | None | ECS-driven |
| Visual Editor | None | None | None | Built-in (in-line editing) |
| Networking | None | None | None | Primitives |
| Data recording | None | None | None | Time-series + CSV export |
| Compute shaders | None | None | None | WebGPU compute pipeline |
| System Scheduling | None | None | None | Dependency-graph batching |
| Background Workers | None | None | None | Web Worker pool + services |
| Devtools | Plugin | Built-in | Plugin | Built-in + parameter panel |
| Deterministic | No | No | N/A | Yes |
| Electron target | No | No | No | Yes |

---

# Appendix C: Target Performance Budgets

| Metric | Target |
|---|---|
| Core bundle (gzipped) | < 25 KB |
| Full engine (all packages, gzipped) | < 180 KB |
| 10,000 sprites @ 60 FPS | ✓ desktop, ✓ mobile |
| 100,000 particles @ 60 FPS | ✓ WebGPU, degraded WebGL2 |
| Fixed update jitter | < 1 ms variance |
| Heap allocations (steady state) | 0 per frame |
| Scheduler graph build (per stage) | < 0.1 ms |
| Scheduler batch execution overhead | < 0.01 ms per batch |
| Spatial index query (1000 entities) | < 0.1 ms |
| Input latency (keypress → render) | < 2 frames |
| Scene load (100 entities) | < 50 ms |
| Scene hot-reload (diff + patch) | < 16 ms (within 1 frame) |
| Dev server cold start | < 500 ms |
| HMR system swap | < 100 ms |
| Editor round-trip (UI edit → disk → HMR) | < 200 ms |
| Worker pool startup | < 50 ms |
| Task round-trip (Transferable) | < 1 ms overhead |
| Task round-trip (structured clone) | < 5 ms overhead |

---

# Appendix D: Future — Parallel System Execution

Parallel execution of independent ECS system batches across Web Workers was evaluated during the design phase and **deferred** due to three critical barriers:

1. **`Atomics.wait()` is prohibited on the main browser thread.** The natural barrier mechanism (main thread blocks until workers complete a batch) throws `TypeError` in all browsers. The only non-blocking alternative — `Atomics.waitAsync()` — turns frame execution into an async chain that breaks the single-rAF-callback guarantee and adds 0.1–0.5ms latency per barrier, exceeding the overhead of the work being parallelized.

2. **Module scope isolation.** System `execute` functions reference module-level component variables (`Position.x[eid]`). Web Workers run in separate JavaScript contexts with independent module instances. Resolving component references across thread boundaries requires a non-trivial runtime registration system that no existing TypeScript ECS has successfully shipped.

3. **Resources are JavaScript objects.** `SharedArrayBuffer` only holds flat numeric data. Resources containing `Map`, `Set`, or class instances cannot be shared across workers. Any system that reads or writes a resource — the majority of non-trivial systems — is pinned to the main thread.

**Performance reality:** For parallelism to break even (4 workers, ~0.3ms realistic dispatch+barrier overhead), each batch must do >0.4ms of sequential work. A movement system on 1000 entities takes ~0.03ms. Typical 2D games lack sufficient per-batch workload.

**Viable future path: Scheduler-on-Worker.** If parallelism is revisited, the most promising architecture is running the entire ECS tick on a dedicated scheduler worker (which CAN use `Atomics.wait()`), with the main thread serving as a thin render client. This avoids the main-thread blocking prohibition entirely and simplifies resource sharing since all ECS state lives in worker scope. This would be a significant architectural change that should only be pursued once the sequential engine is proven and profiling reveals a genuine CPU bottleneck in system execution.

The current architecture preserves the option: dependency-graph batching is already computed, SoA component storage is cache-friendly, and the arena allocator can be backed by `SharedArrayBuffer` when needed. Game code does not change — only the scheduler's execution strategy would.

---

*HyperNova* is a working title.
This spec is a living document and will evolve as implementation reveals constraints and opportunities.
