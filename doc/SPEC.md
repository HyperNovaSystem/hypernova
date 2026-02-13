# Nova Engine — A Modern TypeScript Game Engine

> A modular, ECS-first, WebGPU-powered 2D game engine built for the modern web.

---

## 1. Design Philosophy

Nova is designed around three core principles:

- **Composition over inheritance.** Game objects are assembled from small, reusable data components — not deep class hierarchies. Behavior emerges from systems that operate on component data.
- **Ship only what you use.** The engine is a collection of focused packages. The core is tiny. Everything else — physics, audio, tilemaps, networking — is opt-in. Tree-shaking works because the architecture demands it.
- **Developer experience is a feature.** Hot reload, visual inspectors, type safety, and fast iteration loops are not afterthoughts. They are load-bearing parts of the design.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Game Loop                        │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────┐  │
│  │  Input     │  │  Fixed    │  │  Render         │  │
│  │  Gather    │→ │  Update   │→ │  (interpolated) │  │
│  └───────────┘  └───────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
┌──────────────────────────────────────────────────────┐
│                   ECS World                           │
│                                                      │
│  Entities:    [0, 1, 2, 3, 4, ...]                   │
│  Components:  Position | Velocity | Sprite | ...     │
│  Systems:     MovementSystem → PhysicsSystem → ...   │
│                                                      │
│  Queries:     world.query(Position, Velocity)        │
└──────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
┌────────────┐  ┌──────────────┐  ┌────────────────┐
│  @nova/     │  │  @nova/      │  │  @nova/        │
│  input      │  │  physics-    │  │  renderer-     │
│             │  │  rapier      │  │  webgpu        │
└────────────┘  └──────────────┘  └────────────────┘
```

### Game Loop

The game loop uses a **fixed timestep with interpolated rendering**, the gold standard for deterministic simulation:

- **Input Gather** — Polls and buffers all input events from the current frame.
- **Fixed Update** — Runs simulation logic at a constant rate (default 60 Hz). Multiple fixed steps may run per frame if the frame budget allows, or none if the frame arrives early. All gameplay logic, physics, and AI run here.
- **Render** — Runs once per frame at display refresh rate. Interpolates between the previous and current simulation state for smooth visuals even when the simulation rate and display rate differ.

This separation is critical for determinism (networking, replays) and decouples visual smoothness from simulation accuracy.

### Package Boundary Rules

Packages communicate through the ECS world and well-defined interfaces. No package may import internals from another package. The dependency graph flows strictly downward:

```
@nova/core          — ECS, game loop, events, math
  ├── @nova/input          — Keyboard, mouse, gamepad, touch
  ├── @nova/renderer-webgpu — WebGPU renderer + WebGL2 fallback
  ├── @nova/physics-rapier  — Rapier2D WASM physics
  ├── @nova/audio           — Web Audio API abstraction
  ├── @nova/assets          — Async asset pipeline
  ├── @nova/tilemap         — Tilemap loading and rendering
  ├── @nova/particles       — GPU-accelerated particle systems
  ├── @nova/net             — Networking primitives
  └── @nova/devtools        — Inspector, profiler, debug overlays
```

---

## 3. ECS-First Architecture

### Overview

Nova's ECS is the backbone of the engine. Every game object is an entity (a numeric ID). All data lives in components (plain typed arrays). All logic lives in systems (functions that query and mutate component data).

### Entities

An entity is just a `u32` identifier. It has no data and no behavior of its own. Entities are created, destroyed, and recycled by the world.

```typescript
const player = world.spawn();
const enemy = world.spawn();
world.destroy(enemy);
```

### Components

Components are pure data with no methods. They are defined as schemas and stored internally as Struct-of-Arrays (SoA) for cache-friendly access.

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

Component storage uses typed arrays under the hood. A world with 10,000 entities that have `Position` stores two contiguous `Float32Array` buffers — one for `x`, one for `y`. This layout is essential for performance at scale.

### Systems

Systems are functions registered with the world. They declare which components they read and write, enabling automatic scheduling and parallelism detection.

```typescript
import { defineSystem, query } from '@nova/core';

const MovementSystem = defineSystem({
  name: 'Movement',
  query: query(Position, Velocity).write(Position).read(Velocity),
  execute(entities, { Position, Velocity }, dt) {
    for (const eid of entities) {
      Position.x[eid] += Velocity.x[eid] * dt;
      Position.y[eid] += Velocity.y[eid] * dt;
    }
  },
});
```

### Queries

Queries select entities that match a component signature. They support filtering, optional components, and change detection.

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

Within a stage, systems with non-overlapping read/write sets may run concurrently (future optimization path).

### Resources

Global singleton data that doesn't belong to any entity — time, input state, physics world handle — is stored as **resources** on the world.

```typescript
world.insertResource('time', { dt: 0, elapsed: 0, frame: 0 });
world.insertResource('input', inputState);

// Access in systems
const time = world.getResource<TimeResource>('time');
```

---

## 4. Modular Package System

### `@nova/core`

The only required package. Contains:

- ECS world, entity management, component storage
- System scheduler and stage pipeline
- Game loop (fixed timestep + render interpolation)
- Event bus (typed, synchronous within a frame)
- Math library (Vec2, Mat3, AABB, Color, lerp/clamp/remap utilities)
- Resource storage

Approximate bundle size target: **< 15 KB** gzipped.

### `@nova/renderer-webgpu`

Primary renderer targeting WebGPU with automatic WebGL2 fallback.

- **Automatic batching.** Sprites with the same texture and blend mode are batched into a single draw call. No manual batch management.
- **Render graph.** A lightweight render graph manages pass ordering, resource lifetimes, and clear/resolve operations. Custom post-processing passes slot into the graph.
- **Sprite rendering.** Textured quads with support for atlases, nine-slices, tiling, tint, and alpha.
- **Tilemap rendering.** GPU-instanced tilemap rendering. A 1000×1000 tilemap renders in a single draw call.
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

**Sync model:** A `PhysicsSyncSystem` copies `Position`/`Rotation` from ECS to Rapier before stepping, and copies results back after. The Rapier world is a resource, not a component — there's one physics world, not one per entity.

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

- **Action mapping.** Define logical actions ("jump", "fire", "move_left") and bind them to physical inputs. Multiple bindings per action. Rebindable at runtime.
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
- **Streaming.** Large assets (spritesheets, audio) can stream progressively. The game can start before everything is loaded.
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

The devtools panel is rendered as an HTML overlay, independent of the game canvas, using a lightweight UI framework (Preact or vanilla DOM). It communicates with the engine via a message protocol, enabling remote debugging (connect devtools from another browser tab or device).

---

## 5. Renderer — WebGPU First

### Why WebGPU

WebGPU provides compute shaders, better draw call performance, explicit resource management, and a modern API that maps well to Vulkan/Metal/D3D12. For a 2D engine, the key wins are:

- **Compute shaders** for particle simulation, GPU-side spatial hashing, pathfinding offload, and procedural generation.
- **Reduced driver overhead** — fewer draw calls matter less, but batching is still free performance.
- **Storage buffers** — pass arbitrary data to shaders without texture encoding hacks.

### Fallback Strategy

WebGPU availability (as of 2025) is strong on Chrome and Edge, growing on Firefox and Safari. The renderer provides a WebGL2 backend with the same API surface. Feature detection at startup selects the best available backend. Compute-dependent features (GPU particles, GPU spatial hash) gracefully degrade to CPU implementations on WebGL2.

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

Every public API surface is strictly typed. The engine is authored in TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.

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

The recommended setup is Vite with the Nova plugin:

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
  execute(events) {
    for (const { entityA, entityB, normal, impulse } of events.get('collision-start')) {
      if (world.has(entityA, Projectile) && world.has(entityB, Health)) {
        // apply damage via component mutation
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

In development, the asset pipeline watches source files and hot-reloads changed assets without restarting the game. A texture change appears on screen within milliseconds. Tilemap edits in Tiled or LDtk are reflected live.

---

## 9. Networking Primitives

### Architecture Patterns Supported

Nova doesn't impose a networking architecture. Instead, it provides primitives that support common patterns:

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

## 10. Developer Experience

### Hot Module Replacement

The Vite plugin enables HMR for game code:

- **System hot reload.** Change a system's `execute` function → the running game swaps it in without losing world state.
- **Component schema changes.** Adding a field to a component triggers a world migration — existing entities get default values for the new field.
- **Asset hot reload.** Change a PNG on disk → the texture updates on screen.

### Devtools Panel

The devtools panel is an HTML overlay activated with a keybind (`` ` `` by default) or launched in a separate window.

**Entity Inspector:**
- Searchable entity list with component filters
- Click an entity to view/edit all its components
- Highlight the selected entity on the game canvas
- Create/destroy entities from the inspector

**System Profiler:**
- Per-system execution time as a rolling graph
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
npx nova dev                     # start dev server with HMR
npx nova build                   # production build (tree-shaken, devtools stripped)
npx nova export --target electron # package as desktop app
```

---

## Appendix A: Minimal Example

```typescript
import { Engine, defineComponent, defineSystem, query, Types } from '@nova/core';
import { RendererPlugin, Sprite } from '@nova/renderer-webgpu';
import { InputPlugin } from '@nova/input';

// Components
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Player = defineComponent({});

// Systems
const PlayerInputSystem = defineSystem({
  name: 'PlayerInput',
  query: query(Player, Velocity),
  execute(entities, components, dt, resources) {
    const input = resources.get('input');
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
  execute(entities, _components, dt) {
    for (const eid of entities) {
      Position.x[eid] += Velocity.x[eid] * dt;
      Position.y[eid] += Velocity.y[eid] * dt;
    }
  },
});

// Bootstrap
const engine = new Engine({ width: 800, height: 600 });
engine.addPlugin(RendererPlugin());
engine.addPlugin(InputPlugin({
  actions: {
    move: [compositeAxis('KeyA', 'KeyD', 'KeyW', 'KeyS')],
  },
}));

engine.addStage('input', [PlayerInputSystem]);
engine.addStage('movement', [MovementSystem]);

// Spawn player
const player = engine.world.spawn();
engine.world.addComponent(player, Position, { x: 400, y: 300 });
engine.world.addComponent(player, Velocity, { x: 0, y: 0 });
engine.world.addComponent(player, Sprite, { texture: 'player', width: 32, height: 32 });
engine.world.addComponent(player, Player, {});

engine.start();
```

---

## Appendix B: Comparison with Existing Frameworks

| Feature | Phaser 3 | Excalibur.js | PixiJS | Nova |
|---|---|---|---|---|
| Architecture | OOP/Scene | OOP/Actor | Renderer only | ECS |
| TypeScript | Retrofitted | Native | Native | Native |
| Renderer | WebGL1 | WebGL2/Canvas | WebGL2 | WebGPU + WebGL2 |
| Physics | Arcade/Matter | Arcade | None | Rapier2D (WASM) |
| Bundle (core) | ~1 MB | ~300 KB | ~200 KB | < 15 KB |
| Tree-shakeable | Partial | Yes | Yes | Yes |
| Networking | None | None | None | Primitives |
| Devtools | Plugin | Built-in | Plugin | Built-in |
| Deterministic | No | No | N/A | Yes |

---

## Appendix C: Target Performance Budgets

| Metric | Target |
|---|---|
| Core bundle (gzipped) | < 15 KB |
| Full engine (all packages, gzipped) | < 150 KB |
| 10,000 sprites @ 60 FPS | ✓ desktop, ✓ mobile |
| 100,000 particles @ 60 FPS | ✓ WebGPU, degraded WebGL2 |
| Fixed update jitter | < 1 ms variance |
| Input latency (keypress → render) | < 2 frames |
| Dev server cold start | < 500 ms |
| HMR system swap | < 100 ms |

---

*Nova is a working title. This spec is a living document and will evolve as implementation reveals constraints and opportunities.*
