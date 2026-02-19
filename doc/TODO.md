# HyperNova Engine — Implementation Plan

*Updated to reflect the simulation builder / game engine goal (see REVIEW.md Pass 3).*

---

## Principles

1. **Simulation-first, game-capable.** Every design decision must support headless simulation, deterministic replay, and data export. Game rendering is a plugin, not a prerequisite.
2. **Working vertical slice at each phase.** Each phase ends with a runnable demo that exercises the new capabilities — not just passing unit tests.
3. **Build what you need, evaluate before you build, use existing packages where they fit.** Same as before; the build/evaluate/use taxonomy is preserved below.

---

## Module Separation

### Build (novel standalone packages)

**ECS World** — Archetype-based SoA storage, generational entity IDs, dependency-graph system scheduler, queries. No existing npm package combines all three. `bitecs` has SoA but no scheduler. `becsy` has scheduling but is experimental. `sim-ecs` is closest but not widely adopted. This is HyperNova's core differentiator and the most valuable standalone extraction.

**Simulation Loop** — Fixed timestep accumulator with headless tick mode, time scaling (pause/slow-mo/fast-forward), frame stepping, configurable tick rate, and optional `requestAnimationFrame` binding. No existing package provides a simulation loop with time control that decouples from the browser frame rate.

**Deterministic PRNG** — Seeded xoshiro256** (or PCG) with `float()`, `range()`, `vec2()`, `shuffle()`, `fork()` (independent sub-streams). Seed stored as a resource, serializable for replay/networking. ~150 lines. No existing package provides an ECS-integrated deterministic PRNG with fork semantics.

**Worker Pool** (`@nova/workers`) — Task/Job/Stream triple pattern, transferable auto-detection, frame-aware sync, main-thread graceful degradation.

**State Machine** — Stack-based FSM with pause/resume. Lightweight internal utility.

**Clock Sync** — NTP over WebSocket/HTTP for multiplayer games. SNTP algorithm, `Transport` interface, exposes RTT/jitter.

**Spatial Index** — Custom uniform grid + pooled quadtree (~400 lines total).
- **Uniform grid:** Pre-allocated flat `Int32Array` cell buckets. O(1) cell math from Position SoA arrays.
- **Pooled quadtree:** SoA node pool + linked-list entry pool, pre-allocated.
- **Common interface:** `insert`, `remove`, `update`, `queryAABB(minX, minY, maxX, maxY, results: Uint32Array): count`.

**Persistent State** (`@nova/persist`) — v1: bulk typed array snapshots stored in IndexedDB (web) / filesystem (local). v2+: SQLite continuous mirroring, cloud saves.

**Network Serializer** (`@nova/net`) — v1: JSON snapshot serialization. v2: custom binary with delta compression.

**Recorder** (`@nova/recorder`) — Time-series recording of component data. Configurable sample rate, binary/JSON export, timeline scrub for replay. Builds on core snapshot/change-detection primitives in `@nova/core` (shared by `@nova/net` and `@nova/recorder`).

### Evaluate before building

**Arena allocator decision record (must complete before implementation):**
- **Alternatives considered:**
  1. Plain per-component typed arrays (no shared arena)
  2. Existing JS/WASM allocator package
  3. Custom bump allocator (single shared arena)
- **Benchmark criteria:**
  - Startup allocation time at 50K and 200K entities
  - Peak RSS and retained heap after component registration
  - Steady-state frame allocations (target: zero)
  - Cost of late `defineComponent()` registration in dev mode
- **Decision checkpoint:**
  - Record benchmark results in `doc/DECISIONS/arena-allocator.md`
  - Choose an approach and rationale before implementing allocator internals
  - If custom allocator wins, implement with ES2024 `ArrayBuffer(initialSize, { maxByteLength })` + allocate-and-copy fallback and provide `allocColumn<T>(Type, count): T`

### Use existing packages

| Need | Package(s) | Notes |
|------|-----------|-------|
| Math | `gl-matrix` (1.5M/wk) | Thin wrapper for scratch-object pooling (zero-alloc). AABB/Color are small additions. |
| Tween | `@tweenjs/tween.js` (1.5M/wk) | Full coverage: easing, chaining, parallel groups. ECS binding is a thin adapter. |
| Vite WASM/Workers | `vite-plugin-wasm` + Vite native worker support | Wrap into `@nova/vite-plugin`. |
| Events (tooling/UI only) | `mitt` (1.5M/wk) | Use only for non-simulation buses (devtools/editor/UI callbacks). Simulation/runtime events remain `@nova/core` ring buffers. |
| Electron packaging | `electron-builder` or `electron-forge` | For `--target electron` export. Evaluate which integrates best with Vite. |
| PRNG algorithm | Reference impl only | xoshiro256** reference in C; port to TypeScript. No npm dependency. |

---

## Implementation Priorities

### Phase 1 — Core Simulation Engine (Foundation)

**Goal:** A headless simulation loop with ECS, time control, deterministic PRNG, and optional WebGPU rendering. The "hello world" is a simulation that runs identically headless and in-browser.

#### 1a. Error Handling & Diagnostics
- [ ] `@nova/core`: `Result<T, EngineError>` type, `Err` enum, `Severity` enum
- [ ] `@nova/core`: Pre-allocated error singletons, `must()`, `orDefault()` helpers
- [ ] `@nova/core`: `DiagnosticLog` resource (ring-buffered, no-op in prod)
- [ ] `@nova/core`: `engine.halt()` with cleanup cascade
- [ ] `@nova/core`: Error mode configuration (`dev` / `production`)

#### 1b. ECS Core
- [ ] `@nova/core`: Entity management — generational IDs (`u32` index + `Uint16Array` generation), free list recycling, `spawn()` / `trySpawn()` / `destroy()` / `isAlive()`
- [ ] `@nova/core`: Canonical handle semantics doc + tests: store 16-bit generation counter, pack lower 12 bits into `(genLow12 << 20) | index`, increment full 16-bit counter on recycle, and treat handles as stale when either packed 12-bit generation mismatches OR the slot is dead
- [ ] `@nova/core`: Component storage — arena allocator (bump allocator with resizable ArrayBuffer), `defineComponent()` with SoA column allocation, `Types` (f32, i32, u8, u16, u32, bool, string)
- [ ] `@nova/core`: String interning — `StringTable` with monotonic growth, `Types.string` backed by `Uint32Array`
- [ ] `@nova/core`: Archetype bitmasks — per-entity archetype mask, add/remove component flips bits
- [ ] `@nova/core`: Queries — `query(A, B).read(A).write(B)`, `.not(C)`, `.changed(D)` (double-buffered snapshots), cached results with structural-change invalidation
- [ ] `@nova/core`: System scheduler — `defineSystem()`, stage pipeline, dependency-graph batching (topological sort), sequential batch execution, command flush between stages
- [ ] `@nova/core`: Event system — `defineEvent<T>()`, double-buffered ring storage (SoA for numeric, object-pool for complex), configurable overflow (`grow` / `drop-oldest` / `halt`), stage-boundary visibility
- [ ] `@nova/core`: Typed resources — `defineResource<T>()`, `insertResource()`, `getResource()`, `removeResource()`
- [ ] `@nova/core`: Entity hierarchy — `Parent`, `Children` built-in components, `TransformPropagationSystem`, `WorldTransform`, destroy cascade with `OrphanOnDestroy`

#### 1c. Simulation Loop & Time Control
- [ ] `@nova/core`: Fixed timestep accumulator with configurable `fixedTimestep` (default 1/60) and `maxSubstepsPerFrame` (default 4)
- [ ] `@nova/core`: `BudgetExceeded` event when substeps are dropped
- [ ] `@nova/core`: **Headless mode** — `Engine({ headless: true })` runs without `requestAnimationFrame`, no canvas required. `engine.tick()` advances one fixed step synchronously. `engine.tickN(n)` advances N steps. `engine.tickUntil(predicate)` advances until condition met.
- [ ] `@nova/core`: **Time scaling** — `engine.setTimeScale(scale)` where 0 = paused, 0.5 = slow-mo, 2.0 = fast-forward. `dt` in systems remains the fixed timestep (determinism preserved). Scale affects how many fixed steps the accumulator produces per frame.
- [ ] `@nova/core`: **Frame stepping** — `engine.step()` advances exactly one fixed step when paused (timeScale = 0). Essential for debugging.
- [ ] `@nova/core`: Render interpolation — when rendering is active, interpolate between previous and current state for smooth visuals at arbitrary display refresh rates.

#### 1d. Deterministic PRNG
- [ ] `@nova/core`: `Random` resource — seeded xoshiro256** implementation (~100 lines)
- [ ] `@nova/core`: API: `float()`, `range(min, max)`, `rangeFloat(min, max)`, `vec2(magnitude?)`, `shuffle(array)`, `chance(probability)`, `pick(array)`, `fork(label)` (independent sub-stream)
- [ ] `@nova/core`: Seed stored in `Random` resource, included in `@nova/persist` snapshots and `@nova/net` state sync
- [ ] `@nova/core`: Default seed from `Date.now()` in dev, must be explicitly set for deterministic simulation

#### 1e. Math Library
- [ ] `@nova/core`: Vec2, Mat3, AABB, Color types with zero-alloc scratch API
- [ ] `@nova/core`: Utility functions: lerp, clamp, remap, distance, normalize, dot, cross2D, angle
- [ ] `@nova/core`: Built on `gl-matrix` internals with thin pooled-scratch wrapper

#### 1f. Scenes & Prefabs (v1 — flat)
- [ ] `@nova/core`: `definePrefab(name, components)` — flat prefabs with spawn-time overrides
- [ ] `@nova/core`: `world.spawn(Prefab, overrides?)` — prefab instantiation
- [ ] `@nova/core`: Scene loader — parse `.nova.json`, spawn entities with prefab resolution, `engineVersion` migration
- [ ] `@nova/core`: Scene metadata components — `Name`, `SceneEntity`, `PrefabInstance`

#### 1g. Renderer (Optional Plugin)
- [ ] `@nova/renderer-webgpu`: WebGPU device acquisition, canvas setup, render loop integration
- [ ] `@nova/renderer-webgpu`: Sprite batching — texture atlas, sort by layer → texture → blend, batch draw calls
- [ ] `@nova/renderer-webgpu`: `Sprite`, `RenderOrder`, `Camera`, `WorldTransform` component reading
- [ ] `@nova/renderer-webgpu`: Expose `GPUDevice` for advanced users (custom compute, custom render passes)

#### 1h. Input (Optional Plugin)
- [ ] `@nova/input`: Keyboard + mouse polling, action mapping (`defineActions`), `compositeAxis`
- [ ] `@nova/input`: Buffered input consumed during fixed update (no lost inputs between frames)

#### 1i. Build Tooling
- [ ] `@nova/vite-plugin`: Dev server with HMR for systems and assets
- [ ] `@nova/vite-plugin`: WASM loading support
- [ ] `@nova/vite-plugin`: `base: './'` for production builds

#### 1j. Plugin System
- [ ] `@nova/core`: Plugin interface `{ name, depends?, install(app) }`, `EngineBuilder` API
- [ ] `@nova/core`: Dependency resolution (flatten, deduplicate, validate, topological sort)
- [ ] `@nova/core`: Stage ordering constraints (`after`, `before`)
- [ ] `@nova/core`: Plugin composition (sub-plugins via `app.addPlugin()`)
- [ ] `@nova/core`: Cleanup on `engine.dispose()` in reverse install order

#### Phase 1 Deliverable
**Demo:** A deterministic agent-based simulation (e.g., flocking boids) that runs headless in Node.js producing identical output to the browser-rendered version. Demonstrates: ECS, fixed timestep, time control (pause/fast-forward), deterministic PRNG, headless mode, optional rendering.

**Pass/Fail Gates (must all pass):**
- [ ] Determinism gate: same seed + same input script produces identical checksum after 10,000 ticks in headless and rendered modes
- [ ] Headless parity gate: core simulation runs without DOM/canvas and reaches identical final world state to browser run
- [ ] Allocation gate: zero steady-state allocations per tick for ECS iteration, query execution, and event read/emit in reference boids scene
- [ ] Error-mode gate: only `dev` and `production` modes exist in config/API/docs and both paths are covered by tests

---

### Phase 2 — Gameplay & Simulation Packages

**Goal:** Physics, animation, audio, assets, spatial index, state machine, and simulation parameters. A full game or interactive simulation is buildable.

#### 2a. Physics
- [ ] `@nova/physics-rapier`: Rapier2D WASM integration, `PhysicsPlugin` factory
- [ ] `@nova/physics-rapier`: `RigidBody`, `Collider` components, `PhysicsSyncSystem`
- [ ] `@nova/physics-rapier`: Collision events (`CollisionStart`, `CollisionEnd`) via typed event system
- [ ] `@nova/physics-rapier`: Raycasting and shape-casting queries

#### 2b. Animation
- [ ] `@nova/animation`: Sprite animation from sheet sequences (frame rate, loop modes)
- [ ] `@nova/animation`: Tweening via `@tweenjs/tween.js` adapter (easing curves, chaining, parallel groups)
- [ ] `@nova/animation`: Animation state machine (`defineAnimationState`) with ECS-driven transitions

#### 2c. Audio
- [ ] `@nova/audio`: Web Audio API wrapper — sound effects, music streaming, mixer channels
- [ ] `@nova/audio`: Spatial audio positioning
- [ ] `@nova/audio`: Autoplay policy handling (queue until user interaction)

#### 2d. Assets
- [ ] `@nova/assets`: `defineManifest()`, `loadManifest()` → `Result<ManifestAssets>`
- [ ] `@nova/assets`: `AssetHandle<T>` with status/value/fallback for streamed assets
- [ ] `@nova/assets`: Priority-based loading (critical → gameplay → ambient)
- [ ] `@nova/assets`: Dev mode hot reload via Vite HMR

#### 2e. Spatial Index
- [ ] `@nova/core`: Uniform grid implementation (pre-allocated `Int32Array` buckets)
- [ ] `@nova/core`: Optional quadtree (SoA node pool)
- [ ] `@nova/core`: `SpatialIndex` resource, `SpatialIndexSystem` in `spatial` stage
- [ ] `@nova/core`: Zero-alloc query API: `queryAABB(minX, minY, maxX, maxY, results, offset?): count`

#### 2f. Game State Machine
- [ ] `@nova/core`: `StatePlugin`, `StateStack` resource, `defineState()`
- [ ] `@nova/core`: Stack operations: `push`, `pop`, `switch` (deferred commands)
- [ ] `@nova/core`: Lifecycle hooks: `onEnter`, `onExit`, `onPause`, `onResume`
- [ ] `@nova/core`: Scene auto-load/unload per state
- [ ] `@nova/core`: Transition effects (fade, slide, wipe, none)

#### 2g. Simulation Parameters
- [ ] `@nova/core`: `defineParameter({ name, type, default, range?, group? })` — typed resource with metadata
- [ ] `@nova/core`: `Parameters` resource for system access
- [ ] `@nova/core`: Parameter presets — save/load parameter sets as JSON

#### 2h. Snapshot & Change-Detection Substrate (Core)
- [ ] `@nova/core`: Snapshot primitives for component columns and resource slices (versioned, deterministic ordering)
- [ ] `@nova/core`: Change-detection API (`markChanged`, per-component/version diff cursors) usable by both recorder and networking
- [ ] `@nova/core`: Deterministic serialization baseline (stable field/component/entity ordering) with test vectors
- [ ] `@nova/core`: Document public boundary: `@nova/net` and `@nova/recorder` consume these primitives; they do not own them

#### Phase 2 Deliverable
**Demo:** A physics platformer with animation, audio, and state management (menu → playing → paused → game over). **Also:** A parameter-driven simulation (e.g., predator-prey ecosystem with tunable birth/death rates) demonstrating `defineParameter` and headless batch runs.

**Pass/Fail Gates (must all pass):**
- [ ] Physics gate: deterministic collision replay test passes across two identical runs (same seed/input)
- [ ] Spatial gate: `queryAABB` benchmark meets target latency and remains zero-allocation in stress scene
- [ ] Parameter gate: `defineParameter` metadata round-trips through preset save/load with no type loss
- [ ] Core substrate gate: snapshot/change-detection primitives are consumed by at least one integration test each from recorder-facing and net-facing adapters

---

### Phase 3 — Developer Experience & Recording

**Goal:** Devtools, visual editor, data recording, CLI tooling. The engine is pleasant to develop with and can record simulation data for analysis.

#### 3a. Devtools Core
- [ ] `@nova/devtools`: Entity inspector — browse entities, view/edit components live
- [ ] `@nova/devtools`: System profiler — per-system execution time, stage timeline, frame budget
- [ ] `@nova/devtools`: Physics debug overlay — collider shapes, contact points, AABBs
- [ ] `@nova/devtools`: **Parameter panel** — auto-generated UI from `defineParameter` metadata (sliders, inputs, color pickers, grouped by category)
- [ ] `@nova/devtools`: Console — in-game command input for spawning entities, toggling systems

#### 3b. Visual Editor
- [ ] `@nova/devtools`: Scene hierarchy panel — tree view, drag-and-drop reparenting, search/filter
- [ ] `@nova/devtools`: Inspector panel — type-specific field editors, prefab override tracking, reset-to-default
- [ ] `@nova/devtools`: Viewport gizmos — translate, rotate, scale handles on canvas, snap-to-grid
- [ ] `@nova/devtools`: Round-trip persistence — WebSocket to Vite dev server, JSON patch `.nova.json` files, HMR back to browser

#### 3c. Data Recording & Replay
- [ ] `@nova/recorder`: `RecorderPlugin` — configurable component list, sample rate, format (binary / JSON)
- [ ] `@nova/recorder`: Recording API — `start()`, `stop()`, `export()` (returns `Blob`)
- [ ] `@nova/recorder`: Replay API — `loadRecording()`, `getFrame(tick)`, `getTimeline(component, entityFilter)`
- [ ] `@nova/recorder`: CSV export for external analysis (spreadsheets, Python, R)
- [ ] `@nova/recorder`: Integration with devtools — timeline scrub bar, frame-by-frame playback

#### 3d. CLI
- [ ] CLI: `nova create` — scaffold new project with template selection (game, simulation, visualization)
- [ ] CLI: `nova dev` — Vite dev server with HMR + devtools
- [ ] CLI: `nova build` — production build (tree-shaken, devtools stripped)
- [ ] CLI: `nova add <package>` — add optional packages

#### Phase 3 Deliverable
**Demo:** Build a scene entirely in the visual editor, export, run in production. **Also:** Record a 60-second simulation run, export as CSV, plot results in a notebook. Timeline scrub replay in devtools.

**Pass/Fail Gates (must all pass):**
- [ ] Recorder gate: 60-second recording exports valid binary + CSV with deterministic tick counts
- [ ] Replay gate: replayed timeline reproduces sampled component values within defined precision tolerance
- [ ] Devtools gate: profiler and parameter panel operate without mutating simulation behavior when disabled
- [ ] CLI gate: `nova create`, `nova dev`, `nova build`, and `nova add` smoke tests pass on reference template

---

### Phase 4 — Advanced Capabilities

**Goal:** Tilemaps, particles, UI, networking, workers, persistent state, compute shaders. The engine handles complex, real-world workloads.

#### 4a. Tilemaps
- [ ] `@nova/tilemap`: Tiled (TMX/JSON) and LDtk parser
- [ ] `@nova/tilemap`: Object layers → ECS entities with custom properties
- [ ] `@nova/tilemap`: Tile collision shapes → physics colliders
- [ ] `@nova/tilemap`: GPU-instanced rendering with frustum culling (resolve REVIEW #21)
- [ ] `@nova/tilemap`: Runtime tile manipulation (set/get/fill/flood)

#### 4b. Particles
- [ ] `@nova/particles`: GPU particle simulation via compute shaders (WebGPU) / vertex shaders (WebGL2 fallback)
- [ ] `@nova/particles`: Emitter components (spawn rate, lifetime, velocity, color, size curves)
- [ ] `@nova/particles`: Particles are NOT entities — GPU buffer only, unlimited count

#### 4c. In-Game UI
- [ ] `@nova/ui`: Layout engine (flexbox-inspired, resolve open question: ECS system vs. separate pass)
- [ ] `@nova/ui`: Core widgets — text labels, buttons, sliders, progress bars, panels, scroll views
- [ ] `@nova/ui`: Screen-space (HUD) and world-space (health bars, name tags) rendering
- [ ] `@nova/ui`: Input routing — click, hover, focus, keyboard/gamepad navigation

#### 4d. Networking
- [ ] `@nova/net`: `WorldSerializer` — JSON snapshot serialization (v1), component filter
- [ ] `@nova/net`: Delta serialization — serialize only changed data
- [ ] `@nova/net`: `ClockSync` — NTP-style clock synchronization, RTT, jitter
- [ ] `@nova/net`: `Transport` interface — implement with WebSocket, WebRTC DataChannel, or mock
- [ ] `@nova/net`: Input buffering and playback for rollback netcode
- [ ] `@nova/net`: Interpolation helpers for remote entity smoothing

#### 4e. Background Workers
- [ ] `@nova/workers`: `WorkersPlugin`, worker pool (configurable size, FIFO queue)
- [ ] `@nova/workers`: `defineTask()` — one-shot tasks, `TaskTicket`, timeout handling
- [ ] `@nova/workers`: `defineJob()` — periodic timer-driven workers
- [ ] `@nova/workers`: `defineStream()` — persistent data-driven workers
- [ ] `@nova/workers`: `WorkerSyncSystem` in `worker-sync` stage, `WorkerResultBuffer` resource
- [ ] `@nova/workers`: Graceful degradation — synchronous main-thread fallback when Workers unavailable
- [ ] `@nova/workers`: Transferable auto-detection, `SharedBuffer` utility

#### 4f. Persistent State
- [ ] `@nova/persist`: `PersistPlugin` factory, `PersistStore` resource
- [ ] `@nova/persist`: `save(name)`, `load(name)`, `quickSave()`, `quickLoad()`, `listSnapshots()`, `deleteSnapshot(name)`
- [ ] `@nova/persist`: IndexedDB backend (web), filesystem backend (local), in-memory backend (testing)
- [ ] `@nova/persist`: Component persistence control (`{ persist: false }` opt-out)
- [ ] `@nova/persist`: `SaveCompleted` / `LoadCompleted` events
- [ ] `@nova/persist`: PRNG seed inclusion in snapshots (deterministic restore)

#### 4g. WebGPU Compute API
- [ ] `@nova/renderer-webgpu`: `defineCompute()` — compute shader definition, buffer bindings, dispatch dimensions
- [ ] `@nova/renderer-webgpu`: `renderer.dispatch()` — submit compute passes
- [ ] `@nova/renderer-webgpu`: `renderer.readback()` — async GPU→CPU data transfer
- [ ] `@nova/renderer-webgpu`: WebGL2 fallback: CPU implementations for compute-dependent features

#### 4h. Renderer Fallback
- [ ] `@nova/renderer-webgpu`: WebGL2 backend with same API surface
- [ ] `@nova/renderer-webgpu`: Feature detection at startup, automatic backend selection

#### 4i. Prefab Inheritance (v1.1)
- [ ] `@nova/core`: `extends` — single inheritance with shallow merge per component
- [ ] `@nova/core`: `includes` — multi-prefab composition, left-to-right merge
- [ ] `@nova/core`: Combined `extends` + `includes`, deterministic layer ordering
- [ ] `@nova/core`: Circular reference detection, diamond-include handling
- [ ] `@nova/core`: `childOverrides` for per-instance child component overrides

#### Phase 4 Deliverable
**Demo:** A networked multiplayer demo (2-player shared simulation with snapshot sync). **Also:** A GPU-compute boid simulation with 100K agents rendered as particles, driven by `defineCompute`.

**Pass/Fail Gates (must all pass):**
- [ ] Networking gate: two-client deterministic sync test stays within divergence threshold over 5,000 ticks
- [ ] Worker gate: task/job/stream APIs pass timeout/cancellation/fallback tests
- [ ] Compute gate: `defineCompute` + `dispatch` + `readback` validated on WebGPU path with documented fallback behavior
- [ ] Persistence gate: save/load restores world + PRNG state such that post-load replay checksum matches pre-save continuation

---

### Phase 5 — Packaging & Distribution

**Goal:** Export to web, Electron, and standalone executable. The engine produces distributable applications.

#### 5a. Web Target
- [ ] `nova export --target web` — static deployment bundle with asset manifest
- [ ] Generate COOP/COEP header configs (`_headers`, `.htaccess`, Nginx/Caddy snippets)
- [ ] `--pwa` flag — service worker + `manifest.webmanifest` generation
- [ ] `--zip` flag — itch.io-ready zip with `index.html` at root

#### 5b. Electron Target (NEW)
- [ ] `nova export --target electron` — scaffold Electron main process loading Vite build
- [ ] Electron preload script with `contextBridge` for secure native API access
- [ ] `@nova/native` via Electron IPC (replaces WebSocket bridge for Electron target)
- [ ] Electron-builder or electron-forge integration for packaging (.dmg, .exe, .AppImage)
- [ ] Auto-update support via `electron-updater`
- [ ] Optional: frameless window, custom titlebar, system tray, native menus
- [ ] Template selection: `nova create --template electron-app`

#### 5c. Local Server Target (Standalone Executable)
- [ ] `nova export --target local` — Node.js SEA with embedded HTTP + WebSocket server
- [ ] `@nova/native` server integration: ServiceRegistry, native service loading
- [ ] Node.js SEA build pipeline, native addon collection
- [ ] Port probe, browser launch, graceful shutdown

#### 5d. Shared
- [ ] `@nova/vite-plugin`: `base: './'` in production, WASM loader fallback
- [ ] Export configuration schema in `nova.config.ts`
- [ ] `--out`, `--name`, `--icon`, `--platform` CLI flags
- [ ] Cross-platform build testing

#### Phase 5 Deliverable
**Demo:** The same simulation exported as: (1) a static web page on Netlify, (2) an Electron desktop app with native file dialogs, (3) a standalone .exe. All three produce identical simulation results.

**Pass/Fail Gates (must all pass):**
- [ ] Packaging gate: `nova export --target web|electron|local` produces runnable artifacts on CI
- [ ] Parity gate: exported targets match deterministic checksum suite for reference simulation
- [ ] Desktop gate: Electron build verifies IPC/native bridge path and preload security constraints
- [ ] Distribution gate: artifact size + startup-time budgets meet documented thresholds

---

## Validation Milestones

Each milestone is a concrete proof that the engine works for the stated goal:

| Milestone | Phase | Validates |
|---|---|---|
| **M1: Deterministic headless boids** | 1 | ECS, fixed timestep, headless mode, PRNG, time control |
| **M2: Boids in browser** | 1 | Renderer plugin, input, same simulation rendered |
| **M3: Physics platformer** | 2 | Rapier, animation, audio, state machine, assets |
| **M4: Parameter-driven ecosystem sim** | 2 | defineParameter, headless batch runs, configurable tick rate |
| **M5: Visual editor round-trip** | 3 | Scene editing, HMR, persistence, devtools |
| **M6: Recorded simulation with CSV export** | 3 | @nova/recorder, timeline replay, data export |
| **M7: Networked multiplayer demo** | 4 | @nova/net, snapshot sync, determinism across clients |
| **M8: 100K GPU-compute agents** | 4 | defineCompute, GPU particles, compute pipeline |
| **M9: Cross-target export** | 5 | Web + Electron + local exe from same codebase |

---

## Open Questions

### Resolved
- ~~Minimum viable plugin API~~ → SPEC §17
- ~~Error handling strategy~~ → SPEC §18
- ~~Save/load~~ → SPEC §9.5
- ~~Prefab inheritance~~ → SPEC §12 (deferred to Phase 4)
- ~~Parallel system execution~~ → Deferred, see Appendix D

### Open
- Should the visual editor support collaborative editing (multiple browser tabs)?
- What's the serialization format for animation state machines — code-only or `.nova.json`-compatible?
- Should `@nova/ui` layout run as an ECS system or a separate layout pass?
- Should the entity handle bit split be configurable at build time (20/12 vs. 24/8)?
- What's the minimum viable Electron integration — full Electron scaffolding vs. thin wrapper?
- Should per-stage tick divisors (multi-rate simulation) be a Phase 2 or Phase 4 feature?
- WASM / Shermes: revisit when component storage can be backed by SharedArrayBuffer accessible from WASM

### Deferred to v2+
- Multi-world support (multiple independent World instances per Engine)
- SQLite continuous mirroring for @nova/persist
- Cloud saves via Turso embedded replicas
- Time-travel debugging (per-tick delta logging)
- Editor undo/redo via micro-snapshots
- Custom binary network serializer with delta compression
- Full @nova/native implementation
- Parallel system execution (scheduler-on-worker architecture)
