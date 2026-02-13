# HyperNova Engine — A Modern TypeScript Game Engine

> A modular, ECS-first, WebGPU-powered 2D game engine built for the modern web.

---

## 1. Design Philosophy

HyperNova is designed around three core principles:

- **Composition over inheritance.** Game objects are assembled from small, reusable data components — not deep class hierarchies. Behavior emerges from systems that operate on component data.
- **Ship only what you use.** The engine is a collection of focused packages. The core is tiny. Everything else — physics, audio, tilemaps, networking — is opt-in. Tree-shaking works because the architecture demands it.
- **Developer experience is a feature.** Hot reload, visual inspectors, type safety, and fast iteration loops are not afterthoughts. They are load-bearing parts of the design.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Game Loop                            │
│  ┌──────────┐  ┌────────────────────────┐  ┌──────────────┐ │
│  │  Input   │  │     Fixed Update       │  │   Render     │ │
│  │  Gather  │→ │  ┌──────────────────┐  │→ │ (interpolated│ │
│  └──────────┘  │  │ Stage: pre-phys  │  │  └──────────────┘ │
│                │  │  Batch 0: A, B   │  │                    │
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
┌──────────────────────────────────────────────────────────────┐
│                        ECS World                              │
│                                                               │
│  Entities:    [0, 1, 2, 3, 4, ...]                            │
│  Components:  Position | Velocity | Sprite | ...  (SoA)      │
│  Systems:     MovementSystem → PhysicsSystem → ...            │
│                                                               │
│  Queries:     world.query(Position, Velocity)                 │
└──────────────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
┌────────────┐  ┌──────────────┐  ┌────────────────┐
│  @nova/    │  │  @nova/      │  │  @nova/        │
│  input     │  │  physics-    │  │  renderer-     │
│            │  │  rapier      │  │  webgpu        │
└────────────┘  └──────────────┘  └────────────────┘
```

### Game Loop

The game loop uses a **fixed timestep with interpolated rendering**, the gold standard for deterministic simulation:

- **Input** — Polls and buffers all input events from the current frame.
- **Fixed Update** — Runs simulation logic at a constant rate (default 60 Hz).  Multiple fixed steps may run per frame if the frame budget allows, or none if the frame arrives early.  All gameplay logic, physics, and AI run here.
- **Render** — Runs once per frame at display refresh rate. Interpolates between the previous and current simulation state for smooth visuals even when the simulation rate and display rate differ.
- **Output** - Haptics, sound, and other side effects are triggered during the fixed update to maintain synchronization with the simulation.

This separation is critical for determinism (networking, replays) and decouples visual smoothness from simulation accuracy.

### Package Boundary Rules

Packages communicate through the ECS world and well-defined interfaces. No package may import internals from another package. The dependency graph flows strictly downward:

```
@nova/core          — ECS, game loop, events, math, scenes, spatial index
  ├── @nova/input          — Keyboard, mouse, gamepad, touch
  ├── @nova/renderer-webgpu — WebGPU renderer + WebGL2 fallback
  ├── @nova/physics-rapier  — Rapier2D WASM physics
  ├── @nova/audio           — Web Audio API abstraction
  ├── @nova/assets          — Async asset pipeline
  ├── @nova/animation       — Sprite animation, tweening, state machines
  ├── @nova/tilemap         — Tilemap loading and rendering
  ├── @nova/particles       — GPU-accelerated particle systems
  ├── @nova/ui              — In-game UI (layout, widgets, interaction)
  ├── @nova/net             — Networking primitives
  ├── @nova/workers         — Background worker pool & services
  └── @nova/devtools        — Inspector, profiler, visual editor
```

---

## 3. ECS-First Architecture

### Overview

HyperNova's ECS is the backbone of the engine.
Every game object is an entity (a numeric ID).
All data lives in components (plain typed arrays).
All logic lives in systems (functions that query and mutate component data).

### Entities

An entity is a **generational identifier** — a `u32` index packed with a `u16` generation counter.
When an entity is destroyed and its index recycled, the generation increments.
Any handle still holding the old generation is detected as stale, preventing use-after-destroy bugs.

```typescript
const player = world.spawn();        // Entity { index: 0, generation: 1 }
const enemy = world.spawn();         // Entity { index: 1, generation: 1 }
world.destroy(enemy);
const reused = world.spawn();        // Entity { index: 1, generation: 2 }
world.isAlive(enemy);                // false — generation mismatch
```

Entities have no data and no behavior of their own.
They are created, destroyed, and recycled by the world.

### Components

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

// Tag components (no data, just flags)
const IsPlayer = defineComponent({});
const IsDead = defineComponent({});
```

Component storage uses **archetype-based Struct-of-Arrays** under the hood.
Entities that share the same set of component types are grouped into an archetype.
Within each archetype, each component field is stored as a contiguous typed array — e.g., all `Position.x` values for entities with `[Position, Velocity, Sprite]` live in one `Float32Array`.

This gives us the best of both worlds:
- **Cache-friendly iteration** — systems iterate dense, packed arrays within an archetype.
- **No holes on destroy** — destroying an entity swap-removes it from its archetype table. No sparse gaps.
- **Fast component add/remove** — moving an entity between archetypes is an O(1) table move per component.

Adding or removing a component on an entity changes its archetype, which means a move between tables. This is fast but not free — component churn within a single frame should be minimized in hot paths.

### Systems

Systems are functions registered with the world.
They declare which components they read and write, enabling automatic scheduling and dependency analysis.

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
| `events` | `Events` | Typed event reader/writer |
| `commands` | `Commands` | Deferred entity spawn/destroy/modify |

### Queries

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

### System Scheduling

Systems are organized into stages that run in a defined order within each fixed update:

```typescript
const engine = new Engine();

engine.addStage('input', [InputGatherSystem]);
engine.addStage('pre-physics', [MovementSystem, AISystem]);
engine.addStage('physics', [PhysicsSyncSystem, PhysicsStepSystem]);
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

**Event visibility.** Events emitted by systems in a given stage are visible to systems in subsequent stages within the same frame. Events emitted by systems within the same stage are buffered and not visible to sibling systems — they become available at the next stage boundary. This prevents ordering-dependent behavior within a stage.

The `@nova/devtools` profiler visualizes stage and batch execution timelines, highlights per-system execution time, and reports frame budget usage.

> **Workers.** HyperNova uses Web Workers for **background tasks** — pathfinding, proc-gen, autosave — via `@nova/workers` (§10).  These are async operations with results arriving on the next frame via the event bus.  ECS system execution itself runs on the main thread.  See §10 for the worker architecture.

### Component Storage

Archetype tables (the contiguous typed arrays that hold component fields) are allocated from a contiguous `ArrayBuffer` arena.  When an archetype is created or grows, it allocates a region from the arena and creates typed array views (`Float32Array`, `Uint32Array`, etc.) over it.

```
Component storage arena
┌──────────────────────────────────────────────────────────┐
│  Archetype [Position, Velocity]                          │
│  ┌─────────────┬─────────────┬──────────┬──────────┐    │
│  │ Position.x  │ Position.y  │ Vel.x    │ Vel.y    │    │
│  │ Float32Array│ Float32Array│ Float32A │ Float32A │    │
│  └─────────────┴─────────────┴──────────┴──────────┘    │
│  Archetype [Position, Sprite, Health]                    │
│  ┌─────────────┬─────────────┬──────────┬──────────┐    │
│  │ Position.x  │ Position.y  │ Sprite   │ Health   │    │
│  │ Float32Array│ Float32Array│ ...      │ ...      │    │
│  └─────────────┴─────────────┴──────────┴──────────┘    │
│  ... more archetypes                                     │
└──────────────────────────────────────────────────────────┘
```

**Why an arena?** Allocating all component storage from a single buffer provides:
- **Cache locality** — archetype tables are packed contiguously, improving prefetch behavior.
- **Predictable memory usage** — one large allocation instead of many small typed arrays.
- **WASM interop** — the arena can be backed by `SharedArrayBuffer` if needed, enabling future WASM system implementations to operate directly on component memory without copying.
- **Growth** — the arena uses a growable `ArrayBuffer` (ES2024 `ArrayBuffer.prototype.resize()`) with a pre-declared `maxByteLength`. Typed array views over a resizable buffer automatically track the new size. When `resize()` is unavailable, the arena falls back to allocate-and-copy.

The arena is sized with a configurable initial capacity and max capacity:

```typescript
const engine = new Engine({
  arenaInitialSize: 4 * 1024 * 1024,   // 4 MB initial
  arenaMaxSize: 64 * 1024 * 1024,      // 64 MB ceiling
});
```

### Resources

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

### Entity Hierarchy

Games universally need parent-child relationships — a sword attached to a player, UI elements nested in panels, particles anchored to an emitter.

HyperNova provides hierarchy through built-in components:

```typescript
import { Parent, Children } from '@nova/core';

// Attach a weapon to the player
const sword = world.spawn();
world.addComponent(sword, Position, { x: 16, y: 0 });
world.addComponent(sword, Parent, { entity: player });
// Children component is automatically added/updated on the parent
```

**Transform propagation:** A built-in `TransformPropagationSystem` runs in `render-prep` and computes world-space transforms from local transforms + parent chain.  Systems read `LocalTransform` (position/rotation/scale relative to parent) and the engine produces `WorldTransform` (absolute).

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

## 4. Modular Package System

### `@nova/core`

The only required package.
Contains:
- ECS world, entity management, archetype-based component storage
- Generational entity IDs with stale-handle detection
- Entity hierarchy (Parent/Children, transform propagation)
- System scheduler (dependency-graph ordering, sequential batch execution) and stage pipeline
- Game loop (fixed timestep + render interpolation)
- Event bus (typed, synchronous within a frame)
- Math library (Vec2, Mat3, AABB, Color, lerp/clamp/remap utilities)
- Typed resource storage
- Scene loading and prefab instantiation
- Spatial index (uniform grid, optional quadtree)

Approximate bundle size target: **< 20 KB** gzipped.

### `@nova/renderer-webgpu`

Primary renderer targeting WebGPU with automatic WebGL2 fallback.

- **Automatic batching.** Sprites with the same texture and blend mode are batched into a single draw call.  No manual batch management.
- **Render graph.** A lightweight render graph manages pass ordering, resource lifetimes, and clear/resolve operations.  Custom post-processing passes slot into the graph.
- **Sprite rendering.** Textured quads with support for atlases, nine-slices, tiling, tint, and alpha.
- **Tilemap rendering.** GPU-instanced tilemap rendering.  A 1000×1000 tilemap renders in a single draw call.
- **Text.** SDF (Signed Distance Field) text rendering for resolution-independent, styleable text with outlines and shadows.
- **Camera.** Multiple cameras with independent viewports, zoom, rotation, and render-to-texture.
- **Custom shaders.** Define custom materials with a shader graph or raw WGSL/GLSL.

The renderer reads `Sprite`, `Transform`, `TilemapLayer`, and `Camera` components from the ECS world. It does not own game objects.

### `@nova/physics-rapier`

Wraps [Rapier2D](https://rapier.rs/) (Rust → WASM) as the default physics engine.
- Rigid bodies: dynamic, kinematic, static
- Colliders: circle, box, capsule, convex polygon, heightfield, trimesh
- Joints: revolute, prismatic, fixed, rope
- Collision events piped into the ECS event bus
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

### `@nova/input`

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

### `@nova/audio`

Web Audio API abstraction with spatial audio and music management.
- **Sound effects.** Pooled audio sources with volume, pitch, pan, and spatial positioning.
- **Music.** Streaming playback with crossfade transitions between tracks.
- **Mixer.** Channel groups (master, sfx, music, ui) with independent volume controls.
- **Audio context resume.** Automatic handling of browser autoplay policies — queues sounds until user interaction unlocks the context.

### `@nova/assets`

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

const assets = await engine.loadManifest(manifest);
const playerTexture = assets.textures.player; // fully typed
```

### `@nova/tilemap`

Tilemap loading, querying, and rendering.

- Parses Tiled (TMX/JSON) and LDtk formats.
- Object layers → ECS entities with components derived from custom properties.
- Tile collision shapes → physics colliders automatically.
- Efficient GPU-instanced rendering via the renderer package.
- Runtime tile manipulation (set/get/fill/flood).

### `@nova/particles`

GPU-accelerated particle systems.

- Particle simulation runs in a compute shader (WebGPU) or vertex shader (WebGL2 fallback).
- Emitter components define spawn rate, lifetime, velocity curves, color gradients, size over life, gravity, turbulence.
- Millions of particles with near-zero CPU cost.

### `@nova/animation`

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

// State machine
const playerAnimations = defineAnimationState({
  initial: 'idle',
  states: {
    idle: { animation: idleAnim, transitions: [
      { to: 'run', when: ({ Velocity }) => Math.abs(Velocity.x[eid]) > 0.1 },
    ]},
    run: { animation: walkAnim, transitions: [
      { to: 'idle', when: ({ Velocity }) => Math.abs(Velocity.x[eid]) < 0.1 },
      { to: 'jump', when: ({ Velocity }) => Velocity.y[eid] < -1 },
    ]},
    jump: { animation: jumpAnim, transitions: [
      { to: 'fall', when: ({ Velocity }) => Velocity.y[eid] > 0 },
    ]},
  },
});
```

### `@nova/ui`

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

### `@nova/net`

Networking primitives — not a full multiplayer framework, but the foundational building blocks.

- **State snapshots.** Serialize/deserialize the ECS world (or a filtered subset) into compact binary buffers.
- **Input buffering and playback.** Record and replay input streams for lockstep or rollback networking.
- **Interpolation helpers.** Smooth remote entity positions between snapshot ticks.
- **Transport agnostic.** Provides a `Transport` interface — implement it with WebSocket, WebRTC DataChannel, or a mock for testing.
- **Clock sync.** Lightweight NTP-style clock synchronization between client and server.

### `@nova/devtools`

Development and debugging tools, completely tree-shaken from production builds.

- **Entity Inspector.** Browse all entities, view/edit their components in real time.
- **System Profiler.** Per-system execution time graph. Identify bottlenecks instantly.
- **Physics Debug Overlay.** Render collider shapes, AABBs, contact points, joints.
- **Asset Browser.** View all loaded assets, their memory usage, and reload individually.
- **Console.** In-game console for running commands, spawning entities, toggling systems.
- **State Snapshot Viewer.** Inspect and diff world state between frames (invaluable for networking debugging).

The devtools panel is rendered as an HTML overlay, independent of the game canvas, using a lightweight UI framework (Preact or vanilla DOM).
It communicates with the engine via a message protocol, enabling remote debugging (connect devtools from another browser tab or device).

---

## 5. Renderer — WebGPU First

### Why WebGPU

WebGPU provides compute shaders, better draw call performance, explicit resource management, and a modern API that maps well to Vulkan/Metal/D3D12.

For a 2D engine, the key wins are:
- **Compute shaders** for particle simulation, GPU-side spatial hashing, pathfinding offload, and procedural generation.
- **Reduced driver overhead** — fewer draw calls matter less, but batching is still free performance.
- **Storage buffers** — pass arbitrary data to shaders without texture encoding hacks.

### Fallback Strategy

WebGPU availability (as of 2025) is strong on Chrome and Edge, growing on Firefox and Safari.
The renderer provides a WebGL2 backend with the same API surface.
Feature detection at startup selects the best available backend.
Compute-dependent features (GPU particles, GPU spatial hash) gracefully degrade to CPU implementations on WebGL2.

### Render Pipeline

```
1. Cull         — Frustum cull against camera AABB
2. Sort         — Sort by layer → texture → blend mode → depth
3. Batch        — Merge consecutive compatible sprites into batches
4. Upload       — Stream vertex/instance data to GPU buffers
5. Draw         — Issue batched draw calls
6. Post-process — Bloom, color grading, CRT shader, etc. (optional)
7. Present      — Composite to canvas
```

### Custom Materials

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

---

## 6. TypeScript From the Ground Up

### Non-Negotiable Type Safety

Every public API surface is strictly typed.
The engine is authored in TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.

### Typed Events

Events use discriminated unions — no stringly-typed event names.

```typescript
type GameEvent =
  | { type: 'collision'; entityA: Entity; entityB: Entity; normal: Vec2 }
  | { type: 'entity-destroyed'; entity: Entity }
  | { type: 'asset-loaded'; key: string; asset: unknown };

// Listeners are type-narrowed automatically
world.on('collision', (event) => {
  // event is typed as { type: 'collision', entityA: Entity, ... }
});
```

### Generic Components

Component access is fully typed through the schema definition:

```typescript
const pos = world.get(entity, Position);
// pos is { x: number, y: number } — no `any`, no casting
```

### Build Tooling

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

## 7. Physics — Rapier2D (WASM)

### Why Rapier Over JS Physics

| Concern | Arcade (Phaser) | Matter.js | Rapier2D (WASM) |
|---|---|---|---|
| Performance | Fast but limited | Moderate | Excellent |
| Determinism | No | No | Yes |
| Collision shapes | AABB only | Convex, compound | Full suite |
| Continuous collision | No | Partial | Yes (CCD) |
| Joints/constraints | No | Yes | Yes |
| WASM | N/A | N/A | ~200 KB |

Rapier's determinism is critical for networking (rollback netcode requires identical simulation results given identical inputs) and for replays/testing.

### Physics Configuration

```typescript
engine.addPlugin(PhysicsPlugin({
  gravity: { x: 0, y: 400 },       // pixels/sec²
  timestep: 1 / 60,                  // matches fixed update
  substeps: 2,                       // solver iterations per step
  ccd: true,                         // continuous collision detection
  pixelsPerMeter: 50,                // unit conversion
}));
```

### Collision Events

Collision events flow through the ECS event bus, not callbacks:

```typescript
const CollisionResponseSystem = defineSystem({
  name: 'CollisionResponse',
  events: ['collision-start', 'collision-end'],
  execute({ events, commands }) {
    for (const { entityA, entityB, normal, impulse } of events.get('collision-start')) {
      if (world.has(entityA, Projectile) && world.has(entityB, Health)) {
        // apply damage via commands (deferred until end of stage)
        commands.set(entityB, Health, { current: Health.current[entityB] - 10 });
      }
    }
  },
});
```

---

## 8. Async Asset Pipeline

### Loading Lifecycle

```
Define Manifest → Fetch → Decode → Process → Cache → Ready
                    │        │         │
                    │        │         └─ Atlas packing, mipmap gen
                    │        └─ Image decode, audio decode, JSON parse
                    └─ HTTP fetch with progress tracking
```

### Progressive Loading

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

### Dev Mode Hot Reload

In development, the asset pipeline watches source files and hot-reloads changed assets without restarting the game.
A texture change appears on screen within milliseconds.
Tilemap edits in Tiled or LDtk are reflected live.

---

## 9. Networking Primitives

### Architecture Patterns Supported

HyperNova doesn't impose a networking architecture.
Instead, it provides primitives that support common patterns:

**Authoritative Server (Client-Server)**
- Server runs the ECS world as the source of truth.
- Clients send inputs, receive state snapshots.
- `@nova/net` provides snapshot serialization, delta compression, and interpolation.

**Rollback Netcode (Peer-to-Peer)**
- Each peer runs a local simulation.
- Inputs are exchanged and applied retroactively.
- `@nova/net` provides world state save/restore, input buffer management, and resimulation helpers.
- Rapier's determinism makes rollback reliable.

### Snapshot Serialization

```typescript
import { WorldSerializer } from '@nova/net';

const serializer = new WorldSerializer(world, {
  // Only sync these components over the network
  components: [Position, Velocity, Health, SpriteIndex],
  // Quantize positions to reduce bandwidth
  quantize: { Position: { x: 0.1, y: 0.1 } },
});

const snapshot = serializer.serialize();     // Uint8Array
serializer.deserialize(snapshot);            // apply to world
const delta = serializer.serializeDelta(previousSnapshot); // only changed data
```

### Clock Synchronization

```typescript
import { ClockSync } from '@nova/net';

const clock = new ClockSync(transport);
await clock.sync(); // exchanges timestamps, calculates offset and RTT

const serverTime = clock.now();       // estimated server time
const rtt = clock.roundTripTime;      // smoothed RTT
const jitter = clock.jitter;          // RTT variance
```

---

## 10. Background Workers

### Overview

GPU compute shaders handle massively parallel work (particles, spatial hashing), but many CPU-bound tasks — pathfinding, AI decision trees, procedural generation, data serialization — need to run off the main thread without blocking the game loop.

> **Note:** This section covers **asynchronous background tasks** — work that runs independently of the frame loop with results arriving on the next frame.  ECS system execution itself runs sequentially on the main thread (see System Scheduling, §3).

`@nova/workers` provides a typed worker system with three patterns:

| Pattern | API | Worker Lifetime | Example Use Cases |
|---------|-----|-----------------|-------------------|
| **Task** | `defineTask()` | Borrows a pooled worker, returns when done | Pathfinding, proc-gen, serialization |
| **Job** | `defineJob()` | Persistent, timer-driven | Autosave, heartbeat, telemetry, GC |
| **Stream** | `defineStream()` | Persistent, data-driven | Audio analysis, chunk loading, network queues |

All three patterns funnel results through a single `WorkerResultBuffer` resource, drained by a `WorkerSyncSystem` at a deterministic point in the stage pipeline. Worker results are never injected mid-frame.

### Architecture

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

### One-Shot Tasks

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
The `WorkerSyncSystem` polls tickets and emits results as events.

```typescript
// In a system's execute function:
const pool = resources.get<WorkerPool>('workerPool');
const ticket = pool.submit(PathfindTask, {
  grid: navGrid.data.slice(), // clone for transfer
  width: navGrid.width, height: navGrid.height,
  sx: Position.x[eid], sy: Position.y[eid],
  ex: targetX, ey: targetY,
});
// Result arrives via 'worker:result' event on the next frame
```

**Pool configuration:**

- Size defaults to `navigator.hardwareConcurrency - 1` (minimum 1).
- Tasks execute in submission order (FIFO queue).
- Configurable timeout per task — exceeded tasks are failed, and the stuck worker is terminated and replaced.

### Periodic Jobs

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

### Streaming Pipelines

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

### ECS Integration

Results from all worker types flow through the same path:
1. Workers post results to the main thread.
2. Results accumulate in the `WorkerResultBuffer` resource.
3. The `WorkerSyncSystem` drains the buffer during the `worker-sync` stage.
4. Each result is emitted as a `worker:result` event on the typed event bus.
5. Game systems subscribe to `worker:result` and apply data to components.

```typescript
const ApplyPathfindingSystem = defineSystem({
  name: 'ApplyPathfinding',
  query: query(PathRequest, Position),
  events: ['worker:result'],
  execute({ events }) {
    for (const event of events.get('worker:result')) {
      if (event.source !== 'pathfind') continue;
      const { entityId, path } = event.data as PathfindResult;
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
engine.addStage('post-physics', [CollisionResponseSystem]);
engine.addStage('gameplay',     [DamageSystem, DeathSystem, SpawnSystem]);
engine.addStage('render-prep',  [SpriteAnimationSystem, CameraSystem]);
```

Tasks submitted during `gameplay` are processed by workers between frames and consumed at the start of the next frame's `worker-sync` stage. This guarantees deterministic behavior.

### Data Transfer

Three tiers, preferred in order:

| Tier | Mechanism | Best For |
|------|-----------|----------|
| **SharedArrayBuffer** | True zero-copy shared memory (requires `crossOriginIsolated`) | Large persistent data: navmeshes, spatial grids |
| **Transferable** | Zero-copy ownership transfer (sender loses access) | One-shot data: pathfinding grids, generated chunks |
| **Structured Clone** | Deep copy via `postMessage` | Small objects, scalar results |

`@nova/workers` provides a `SharedBuffer` utility for persistent shared memory with typed array views and automatic fallback to regular `ArrayBuffer` when `SharedArrayBuffer` is unavailable.

Transferable objects are auto-detected by walking the message payload for `ArrayBuffer` instances.
Explicit `inputTransferables`/`outputTransferables` functions on task/stream definitions provide fine-grained control.

### Graceful Degradation

When `Worker` is unavailable (embedded webviews, restricted environments), the entire API surface still works:
- Tasks execute synchronously on the main thread.
- Jobs run via `setInterval` on the main thread.
- Streams process inline when `send()` is called.
- Results still flow through `WorkerResultBuffer` and are consumed by `WorkerSyncSystem` on the next frame — preserving the 1-frame-delay contract.

Game code behaves identically regardless of worker availability.
Performance degrades (heavy tasks block the main thread), but correctness and determinism are preserved.

### Plugin

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

## 11. Developer Experience

### Hot Module Replacement

The Vite plugin enables HMR for game code:
- **System hot reload.** Change a system's `execute` function → the running game swaps it in without losing world state.
- **Component schema changes.** Adding a field to a component triggers a world migration — existing entities get default values for the new field.
- **Asset hot reload.** Change a PNG on disk → the texture updates on screen.
- **Scene hot reload.** Edit a `.nova.json` scene file → entities are diffed and patched in-place without restarting.

### Devtools Panel

The devtools panel is an HTML overlay activated with a keybind (`` ` `` by default) or launched in a separate window.

**Entity Inspector:**
- Searchable entity list with component filters
- Click an entity to view/edit all its components
- Highlight the selected entity on the game canvas
- Create/destroy entities from the inspector

**System Profiler:**
- Per-system execution time as a rolling graph
- Stage and batch timeline: shows execution order, per-system duration, and per-batch wall time
- Dependency graph visualization: which systems are independent, serialization edges between batches
- Frame time breakdown: input, fixed update, render
- Alert when frame budget is exceeded

**Physics Debug:**
- Toggle collider shape rendering
- Show contact points and normals
- Show AABB tree
- Pause/step physics simulation

**Network Inspector** (when `@nova/net` is active):
- Bandwidth graph (bytes sent/received per second)
- Snapshot diff viewer
- Simulated latency/jitter/packet loss controls

### CLI

```bash
npx nova create my-game          # scaffold a new project
npx nova add physics-rapier      # add a package
npx nova dev                     # start dev server with HMR + visual editor
npx nova build                   # production build (tree-shaken, devtools stripped)
npx nova export --target electron # package as desktop app
```

---

## 12. Scenes, Prefabs & Serialization

### Overview

A **scene** is a declarative description of entities, their components, and their hierarchy. Scenes are stored as `.nova.json` files — human-readable, diffable, and editable by hand or by the visual editor.

A **prefab** is a reusable entity template. Scenes reference prefabs by name and may override specific fields per instance.

### Prefabs

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

### Scene Files

Scene files are JSON documents that describe a collection of entities:

```json
{
  "name": "Level1",
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

When a scene references a prefab, only the **overridden fields** are stored in the scene file.
This keeps scene files small and means updating a prefab definition automatically updates all instances that haven't overridden that field.

### Scene Loading

```typescript
import { loadScene, unloadScene } from '@nova/core';

// Load a scene — spawns all entities, returns handles
const level = await loadScene(engine, 'assets/scenes/level1.nova.json');

// Access named entities
const player = level.getEntity('Player');

// Unload — destroys all entities from this scene
unloadScene(engine, level);
```

### ECS Integration

Scenes add metadata components to spawned entities:

```typescript
// Automatically added to scene-spawned entities
const Name = defineComponent({ value: Types.string });
const SceneEntity = defineComponent({
  sceneId: Types.string,    // which scene file
  entityIndex: Types.u32,   // index within the scene
});
const PrefabInstance = defineComponent({
  prefabId: Types.string,   // which prefab, if any
});
```

The `EditorOnly` tag component marks entities that exist only in development mode and are stripped from production builds.

---

## 13. Visual Editor (In-Line Editing)

### Design Goal

**Projects built with HyperNova can be edited in code OR via a visual UI.** The visual editor is not a separate application — it's a mode of `@nova/devtools` that runs alongside the game during development. Changes flow bidirectionally: edits in the visual editor write to scene files on disk, and edits to scene files in a code editor update the running game via HMR.

### Architecture

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

### What's Editable via UI vs Code-Only

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

### Editor Panels

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
- "Reset to prefab default" per-field when the entity is a prefab instance
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

### Round-Trip Persistence

The core challenge: how do visual edits become files the developer commits to source control?

**Solution:** Scene files (`.nova.json`) are the persistence layer. The visual editor writes to them, and they are the single source of truth for entity data.

1. **UI → Disk:** When the developer modifies a value in the inspector or drags an entity in the viewport, the editor sends the change to the Vite dev server via WebSocket. The dev server applies a JSON patch to the corresponding `.nova.json` file on disk.

2. **Disk → UI:** The Vite dev server watches `.nova.json` files via `chokidar`. When a file changes (from the code editor or external tooling), it pushes the update to the browser via HMR. The scene loader diffs the old and new scene data and patches the live ECS world — no full reload needed.

3. **Conflict handling:** Last-write-wins with an undo stack. External file changes trigger a "scene updated externally" toast in the editor. The undo stack tracks editor operations, not file states, so Ctrl+Z works intuitively.

4. **What's NOT persisted to scene files:** Runtime-only state (particle positions, physics velocities, animation playback state). Only initial/default component values are stored.

### Activation

```typescript
// In engine config
const engine = new Engine({
  width: 800,
  height: 600,
  editor: true,  // enables visual editor panels + scene persistence
});

// Or via URL parameter:  ?editor=true
// Or via the devtools console:  engine.enableEditor()
```

The visual editor is part of `@nova/devtools` and is completely tree-shaken from production builds.

---

## 14. Game States & Scene Transitions

### State Machine

Games need high-level state management — menu → playing → paused → game over. HyperNova provides a simple state stack:

```typescript
import { defineState, StatePlugin } from '@nova/core';

const MenuState = defineState({
  name: 'Menu',
  scene: 'assets/scenes/menu.nova.json',
  onEnter({ engine }) {
    // Set up menu-specific systems, show UI
  },
  onExit({ engine }) {
    // Tear down menu state
  },
  systems: [MenuInputSystem, MenuRenderSystem],
});

const PlayingState = defineState({
  name: 'Playing',
  scene: 'assets/scenes/level1.nova.json',
  onEnter({ engine }) { /* ... */ },
  onPause({ engine }) { /* called when another state pushes on top */ },
  onResume({ engine }) { /* called when the state above pops */ },
  systems: [PlayerInputSystem, MovementSystem, PhysicsStepSystem],
});

engine.addPlugin(StatePlugin({ initial: MenuState }));

// Transition between states
engine.states.push(PlayingState);      // push onto stack (Menu pauses)
engine.states.pop();                   // pop back to Menu
engine.states.switch(GameOverState);   // replace top of stack
```

### Scene Transitions

States can optionally define transition effects:

```typescript
engine.states.switch(PlayingState, {
  transition: 'fade',   // built-in: fade, slide, wipe, none
  duration: 0.5,
});
```

---

## 15. Performance Discipline

### Zero Allocations Per Frame

In steady state (no entity spawning/destroying), the engine targets **zero heap allocations per frame** to avoid GC pauses.

Strategies:
- **Object pooling** for events, query result iterators, and worker messages
- **Pre-allocated typed arrays** for component storage (archetype tables are allocated in chunks)
- **Reusable Vec2/Mat3 scratch objects** in math operations — the math library provides a `scratch` API that returns pooled temporaries
- **No closures in hot paths** — system execute functions receive context via parameters, not captured variables

The `@nova/devtools` profiler tracks allocations per frame and alerts when the budget is exceeded.

### Spatial Indexing

For worlds larger than the viewport, efficient spatial queries are critical for culling, proximity checks, and broad-phase collision outside of Rapier.

`@nova/core` provides:

- **Uniform grid** — O(1) insertion/removal, O(neighbors) query. Best for entities of similar size. Default for most games.
- **Quadtree** (optional) — better for worlds with entities of wildly varying sizes.

```typescript
import { SpatialIndex } from '@nova/core';

const spatial = world.getResource(SpatialIndex);
const nearby = spatial.query(new AABB(x - 100, y - 100, x + 100, y + 100));
// Returns entity IDs within the bounding box
```

The spatial index is automatically maintained by a `SpatialIndexSystem` that runs in `render-prep`. It reads `Position` and optionally `AABB`/`Collider` for bounds.

---

## Appendix A: Minimal Example

```typescript
import {
  Engine, defineComponent, definePrefab, defineSystem, defineResource,
  defineState, query, loadScene, Types, StatePlugin,
} from '@nova/core';
import { RendererPlugin, Sprite } from '@nova/renderer-webgpu';
import { InputPlugin, InputState } from '@nova/input';

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

// Bootstrap
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

### Appendix A.2: Scene-Based Variant

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

## Appendix B: Comparison with Existing Frameworks

| Feature | Phaser 3 | Excalibur.js | PixiJS | HyperNova |
|---|---|---|---|---|
| Architecture | OOP/Scene | OOP/Actor | Renderer only | ECS |
| TypeScript | Retrofitted | Native | Native | Native (strict) |
| Renderer | WebGL1 | WebGL2/Canvas | WebGL2 | WebGPU + WebGL2 |
| Physics | Arcade/Matter | Arcade | None | Rapier2D (WASM) |
| Bundle (core) | ~1 MB | ~300 KB | ~200 KB | < 20 KB |
| Tree-shakeable | Partial | Yes | Yes | Yes |
| Scene/Prefab | JSON scenes | Built-in | None | `.nova.json` + prefabs |
| Animation | Built-in | Built-in | None | Sprite, tween, state machine |
| In-game UI | DOM-based | Built-in | None | ECS-driven |
| Visual Editor | None | None | None | Built-in (in-line editing) |
| Networking | None | None | None | Primitives |
| System Scheduling | None | None | None | Dependency-graph batching |
| Background Workers | None | None | None | Web Worker pool + services |
| Devtools | Plugin | Built-in | Plugin | Built-in + visual editor |
| Deterministic | No | No | N/A | Yes |

---

## Appendix C: Target Performance Budgets

| Metric | Target |
|---|---|
| Core bundle (gzipped) | < 20 KB |
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

## Appendix D: Future — Parallel System Execution

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
