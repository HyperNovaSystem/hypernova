# Module Separation

## Build (novel standalone packages)

**ECS World** — Archetype-based SoA storage, generational entity IDs, dependency-graph system scheduler, queries. No existing npm package combines all three. `bitecs` has SoA but no scheduler. `becsy` has scheduling but is experimental. `sim-ecs` is closest but not widely adopted. This is HyperNova's core differentiator and the most valuable standalone extraction.

**Worker Pool** (`@nova/workers`) — Task/Job/Stream triple pattern, transferable auto-detection, frame-aware sync, main-thread graceful degradation.
Existing pools (`workerpool`, `threads.js`, `comlink`) cover generic dispatch but none offer the frame-loop-aware design, periodic jobs, or streaming pipelines with deterministic result delivery. `piscina` is Node-only.

**State Machine** — Stack-based FSM with pause/resume. Lightweight and small internal utility.

**Clock Sync** — NTP over WebSocket/HTTP for multiplayer games.
SNTP algorithm, uses `Transport` interface, exposes RTT/jitter.
Use `timesync` as a reference for our custom implementation.

**Spatial Index** — Custom uniform grid + pooled quadtree (~400 lines total).
Files: `packages/core/src/spatial/{types,UniformGrid,Quadtree,index}.ts`
- **Design:**
  - **Uniform grid (default):** Pre-allocated flat `Int32Array` cell buckets. O(1) cell math from Position SoA arrays. Swap-remove for O(1) entity removal. Generation-counter dedup on queries (no Set allocation). Entity inserted into all overlapping cells; `update()` short-circuits when cell membership unchanged.
  - **Pooled quadtree (optional, for varied-size entities):** SoA node pool + linked-list entry pool, both pre-allocated. Entities stored at smallest enclosing node. Subdivision on capacity overflow with max depth limit. Same generation-counter dedup.
  - **Common interface:** `insert(eid, minX, minY, maxX, maxY)`, `remove(eid)`, `update(eid, ...)`, `queryAABB(..., results: Uint32Array): count`. Caller owns result buffer.
  - **Integration:** `SpatialIndex` resource, maintained by `SpatialIndexSystem` in dedicated `spatial` stage (after `physics`, before `post-physics`) reading `Position` + optional `AABB`/`Collider`. Config: `spatialIndex: 'grid' | 'quadtree'`.

**Persistent State** (`@nova/persist`) — SQLite-backed continuous state mirroring with snapshot-based save/load. The SoA arena's typed arrays map directly to SQLite BLOBs via `memcpy` — zero serialization. Background sync via `defineJob`, dirty tracking via scheduler write-sets, named snapshots for save points, crash recovery from live DB state. Cross-platform: `better-sqlite3` (local), `wa-sqlite` + OPFS (web), `@libsql/client` for Turso cloud saves. No existing game engine persistence library combines SoA-native blob storage with continuous mirroring and embedded cloud sync.

**Network Serializer** (`@nova/net`) — v1 uses JSON for snapshot serialization (simple, debuggable). Custom binary format deferred to v2 — SoA data is already in contiguous typed arrays, so the migration path (memcpy with thin header, delta bitmasks, f32→u16 quantization) is natural. Non-real-time messages (RPC, lobby, debug) will always use JSON.


## Evaluate before building

**Arena Allocator** — Build custom. `@thi.ng/malloc` evaluated and rejected (v6.1.136, stable, 1.81 KB).
It is a general malloc/free allocator on a **fixed-size** `ArrayBuffer` — no ES2024 `resize()` support, no growth strategy, 8-byte header + free-list walk per allocation. Good at what it does (typed array views, alignment, batch `freeAll()`), but wrong pattern for archetype column storage.
- Build a purpose-built bump allocator (~200 lines):
  - ES2024 `ArrayBuffer(initialSize, { maxByteLength })` with fallback to allocate-and-copy
  - O(1) bump allocation (pointer increment + alignment), zero per-block overhead
  - `allocColumn<T>(Type, count): T` — returns typed array view over the arena buffer
  - Views auto-track buffer growth when backed by resizable ArrayBuffer
  - `reset()` for full arena clear (useful for scratch/temp allocations)
  - Configurable initial size + max ceiling (matching Engine config: `arenaInitialSize`, `arenaMaxSize`)

## Use existing packages

| Need | Package(s) | Notes |
|------|-----------|-------|
| Math | `gl-matrix` (1.5M/wk) | Add thin wrapper for scratch-object pooling (zero-alloc). AABB/Color are small additions. |
| Tween | `@tweenjs/tween.js` (1.5M/wk) | Full coverage: easing, chaining, parallel groups. ECS binding is a thin adapter. |
| Vite WASM/Workers | `vite-plugin-wasm` + Vite native worker support | Solved problems. Wrap into `@nova/vite-plugin` for asset manifest + devtools stripping. |
| Events | `mitt` (1.5M/wk) | Add ~50-line typed wrapper for discriminated-union narrowing. Not a separate package. |


# Implementation Priorities

## Phase 1 — Core ECS + Renderer (foundation)

- [ ] `@nova/core`: Result type, Err enum, Severity enum, EngineError, pre-allocated error singletons, helper utilities (`must`, `orDefault`)
- [ ] `@nova/core`: DiagnosticLog resource (ring-buffered, zero-alloc in steady state, no-op in prod)
- [ ] `@nova/core`: `engine.halt()`, error mode configuration (`lenient`/`strict`/`pedantic`)
- [ ] `@nova/core`: World, Entity (generational IDs), Component (archetype storage), System scheduler (sequential, dependency-graph batched)
- [ ] `@nova/core`: Game loop (fixed timestep + render interpolation + `maxSubstepsPerFrame` accumulator cap + `BudgetExceeded` event)
- [ ] `@nova/core`: Event bus, typed resources, math library
- [ ] `@nova/core`: Entity hierarchy (Parent/Children, transform propagation)
- [ ] `@nova/core`: Scene loader + prefab instantiation (includes `extends`/`includes` resolution, `childOverrides`)
- [ ] `@nova/renderer-webgpu`: WebGPU sprite batching (WebGL2 fallback can come later)
- [ ] `@nova/input`: Keyboard + mouse basics
- [ ] Vite plugin: dev server, HMR for systems and assets

## Phase 2 — Gameplay packages

- [ ] `@nova/physics-rapier`: Rapier2D integration, collision events
- [ ] `@nova/animation`: Sprite animation, tweening, animation state machine
- [ ] `@nova/audio`: Basic sound effects + music
- [ ] `@nova/assets`: Manifest-based loading, hot reload
- [ ] `@nova/core`: Spatial index (uniform grid)
- [ ] `@nova/core`: Game state machine (resource-guard model, no per-state systems) + scene transitions

## Phase 3 — Developer experience

- [ ] `@nova/devtools`: Entity inspector, system profiler
- [ ] `@nova/devtools`: Visual editor — scene hierarchy panel
- [ ] `@nova/devtools`: Visual editor — inspector panel (component editing)
- [ ] `@nova/devtools`: Visual editor — viewport gizmos
- [ ] `@nova/devtools`: Visual editor — round-trip persistence (.nova.json ↔ live world)
- [ ] CLI: `nova create`, `nova dev`, `nova build`

## Phase 4 — Advanced

- [ ] `@nova/tilemap`: Tiled/LDtk import, GPU-instanced rendering
- [ ] `@nova/particles`: GPU particle simulation
- [ ] `@nova/ui`: Layout engine, widgets, interaction
- [ ] `@nova/net`: Snapshot serialization (JSON v1, custom binary v2), clock sync
- [ ] `@nova/workers`: Worker pool, jobs, streams
- [ ] `@nova/native`: Design sketch only in v1 spec — full implementation deferred (see SPEC.md §10.5)
- [ ] `@nova/persist`: v1 scope: bulk typed array snapshots stored in IndexedDB (web) / filesystem (local)
- [ ] `@nova/persist`: `PersistPlugin` factory, `PersistStore` resource, save/load/quickSave/quickLoad/list/delete API
- [ ] `@nova/persist`: IndexedDB backend (web), filesystem backend (local), in-memory backend (testing)
- [ ] `@nova/persist`: Component persistence control (`{ persist: false }` opt-out)
- [ ] `@nova/persist`: `SaveCompleted` / `LoadCompleted` events
- [ ] `@nova/renderer-webgpu`: WebGL2 fallback backend

## Phase 5 — Packaging & Distribution

Depends on Phase 1 (core + renderer) and Phase 3 (CLI). See SPEC.md §16.

### Web target (`nova export --target web`)
- [ ] Static deployment bundle with asset manifest
- [ ] Generate COOP/COEP header configs (`_headers`, `.htaccess`, console snippets for Nginx/Caddy)
- [ ] `--pwa` flag: service worker + `manifest.webmanifest` generation
- [ ] `--zip` flag: itch.io-ready zip with `index.html` at root

### Local server target (`nova export --target local`)
- [ ] Embedded HTTP + WebSocket server (~240 lines: `node:http` + `ws`, MIME map, COOP/COEP headers, SPA fallback, `/__nova` WebSocket endpoint)
- [ ] `@nova/native` server integration: ServiceRegistry, native service loading from `nova.config.ts`
- [ ] Node.js SEA build pipeline (enumerate dist/, generate sea-config, `node --build-sea`)
- [ ] Native addon collection: walk require tree for `.node` files, copy to `addons/`, rewrite require paths
- [ ] `prebuild-install` integration for prebuilt native binaries, `node-gyp` fallback
- [ ] Port probe (find free port from 7700), browser launch (platform-specific), graceful shutdown
- [ ] Optional `rcedit` step for custom `.exe` icon on Windows

### Shared
- [ ] `@nova/vite-plugin`: Ensure `base: './'` (relative asset paths) in production builds
- [ ] `@nova/vite-plugin`: WASM loader fallback from `instantiateStreaming` to `instantiate(arrayBuffer)`
- [ ] Export configuration schema in `nova.config.ts` (name, icon, width, height, per-target options)
- [ ] `--out`, `--name`, `--icon`, `--platform` CLI flags
- [ ] Cross-platform build testing (Windows, macOS, Linux)


# Open Questions

## **WASM / Shermes compilation:**
Systems are plain TypeScript functions operating on typed arrays — the hot loops are already shaped for JIT optimization.
Compiling system `execute` bodies to WASM (via AssemblyScript or similar) is feasible for CPU-bound systems (pathfinding, proc-gen), but the overhead of crossing the JS↔WASM boundary on every frame makes it a net loss for lightweight systems.
**Decision:** Keep systems in TypeScript.
Use WASM for discrete heavy computations (Rapier already does this).
Revisit when component storage can be backed by SharedArrayBuffer accessible from WASM.

## **Parallel system execution via Web Workers:**
Evaluated and deferred.  Three critical barriers: (1) `Atomics.wait()` is prohibited on the main browser thread, breaking the barrier mechanism; (2) system functions reference module-level component variables that don't transfer across worker boundaries; (3) resources are JS objects (`Map`, `Set`) that can't live in SharedArrayBuffer. The performance math also doesn't favor it — dispatch overhead (~0.3ms) exceeds the work of typical 2D game systems on typical entity counts. **Decision:** Sequential scheduler with dependency-graph batching. Background workers via `@nova/workers` for async tasks (pathfinding, proc-gen, autosave). If revisited, the viable path is scheduler-on-worker architecture (ECS tick on a dedicated worker, main thread as thin render client). See SPEC.md Appendix D.

## Resolved

- ~~What is the minimum viable plugin API?~~ → Defined in SPEC.md §17. Plugin = `{ name, depends?, install(app) }`. EngineBuilder provides registration API. Dependency resolution via topological sort. Factory pattern for configurable plugins. See §17.1–17.10.

## Open
- Should the visual editor support collaborative editing (multiple browser tabs editing the same scene)?
- What's the serialization format for animation state machines — code-only or `.nova.json`-compatible?
- Should `@nova/ui` layout run as a system in the ECS pipeline or use a separate layout pass?


# Examples

0. Example game written in pseudo-code for SPEC evaluation
1. Minimal example: move a sprite with keyboard (Appendix A in SPEC)
2. Platformer: physics, animation state machine, tilemap, camera follow
3. Bullet hell: 10,000 entities, particle effects, pooling patterns
4. Editor workflow: build a scene entirely in the visual editor, export, run in production
