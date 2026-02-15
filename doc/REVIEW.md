Architectural Contradictions
1. Entity ID vs. SoA Access Pattern — Fundamental Design Conflict
Severity: Critical — **RESOLVED: adopted global SoA (column-per-field) with archetype query resolution**
The spec contained a fundamental contradiction between its two core storage claims:

Claim A (line 100): Entities are generational identifiers — a u32 index packed with a u16 generation counter (48 bits total).
Claim B (lines 143–149): Components use archetype-based Struct-of-Arrays. Entities sharing the same component set are grouped into an archetype, with each field stored as a contiguous typed array within that archetype.
Claim C (lines 168–171): System code accesses data as Position.x[eid] — direct array indexing by entity ID.

These three claims are mutually exclusive. In archetype storage, Position.x is a per-archetype Float32Array indexed by the entity's row within that archetype, not by global entity ID. Entity 42 might be at row 7 in archetype [Position, Velocity]. Position.x[42] would access the wrong data (or out-of-bounds).
The only way Position.x[eid] works with direct entity IDs is the bitecs model: one global Float32Array for each field, sized to maxEntities, indexed by entity ID. This is sparse/semi-dense storage, not archetype-grouped storage.
You must choose one:

Global SoA (bitecs-style): Position.x[eid] works. No archetypes. Iteration requires a bitfield/sparse set per query. Cache locality is good within a single component but not across components.
Archetype SoA: Dense, cache-friendly iteration across related components. But access requires Position.x[archetype.row(eid)] or an entity→row lookup table. The Position.x[eid] syntax does not work.

A hybrid is possible (global dense arrays with archetype-based iteration tracking), but the spec doesn't describe one. This affects every code example in the document.
2. Entity ID Bit Packing is Unresolvable
Severity: High — **RESOLVED: u32 index for array access, generation stored separately in Uint16Array, handle packing via `(gen << 20) | index`**
A u32 index (4 bytes) + u16 generation (2 bytes) = 48 bits. The spec doesn't say how these are packed. Options:

Into a u64 — JavaScript doesn't have native u64; requires BigInt (slow, allocates) or two separate u32 fields.
Into a single u32 — only possible by splitting bits (e.g., 20-bit index + 12-bit generation), limiting max entities to ~1M and generation wrap to 4096.

If entity IDs are used as array indices (Position.x[eid]), the ID must be an integer that fits as a typed array index. A packed 48-bit value can't be used directly.

API Inconsistencies
3. Three Different Event APIs
Severity: Medium — **RESOLVED: unified `defineEvent<T>()` type tokens with pull-based `events.read()` / `events.emit()` in systems; stage-boundary double-buffered ring buffers; `world.on()` removed from core (replaced by `engine.observe()` for devtools only)**

Section 3 (line 247): Events described as "typed, synchronous within a frame."
Section 6 (lines 648–657): Events use discriminated unions with world.on('collision', ...) — callback-based, stringly-typed despite claiming no string keys.
Section 7 (lines 721–722): Systems use events.get('collision-start') — pull-based iteration via system context, string-keyed.

These are three different consumption models. The spec should settle on one event API and use it consistently.
4. Three Different Resource Access Patterns
Severity: Medium

world.getResource(Time) — type-token keyed, on the world object (line 305)
resources.get(Time) — type-token keyed, on the system context (line 315)
resources.get<WorkerPool>('workerPool') — string-keyed with generic cast (line 894)

The third pattern contradicts Section 6's "typed resources, no string keys" principle.
5. Stage Set Varies Across Sections
Severity: Low
The recommended stage ordering is different in each section:

Section 3: input → pre-physics → physics → post-physics → gameplay → render-prep
Section 10: input → worker-sync → pre-physics → physics → ...
Section 10.5: input → worker-sync → native-sync → pre-physics → ...

While these are additive (plugins add stages), the spec should present a single canonical stage ordering that includes all built-in stages.

Gaps (Underspecified or Missing)
6. String Component Types in SoA Storage
Severity: High — **RESOLVED: string interning via global StringTable; Types.string fields backed by Uint32Array storing intern indices; index 0 reserved for empty; string resolution deferred to point-of-use**
Scene metadata components (line 1513–1519) use Types.string:
typescriptconst Name = defineComponent({ value: Types.string });
const SceneEntity = defineComponent({ sceneId: Types.string, entityIndex: Types.u32 });
Strings cannot be stored in typed arrays (Float32Array, Uint32Array, etc.). The spec doesn't explain how non-numeric types are handled in the archetype/SoA system. Options include string interning (store indices into a string table), separate heap storage per archetype, or excluding string components from the SoA arena entirely — but each has different performance and complexity implications.
7. Arena Fallback Invalidates All Views
Severity: High — **MITIGATED: column arrays allocated once at startup, sized to maxEntities; resize only triggered by late defineComponent(), never during gameplay**
Line 278: "When resize() is unavailable, the arena falls back to allocate-and-copy."
Allocating a new ArrayBuffer and copying data invalidates all existing typed array views pointing at the old buffer. Every Float32Array reference held by systems, cached by queries, or stored in component definitions becomes dangling. This is a correctness bug, not just a performance issue. The spec needs a view-invalidation strategy (e.g., indirection through a view registry, or disallowing view caching).
8. ~~Plugin API is Undefined~~ **RESOLVED** — See SPEC.md §17.
Severity: High → **Resolved**
Plugin = `{ name, depends?, install(app) }`. EngineBuilder provides restricted registration API (components, resources, events, stages, systems, sub-plugins, cleanup). Dependency resolution via topological sort. Factory pattern for configurable plugins. Hot reload in dev mode. Full rationale in §17.10.

9. ~~No Error Handling Strategy~~ **RESOLVED** — See SPEC.md §18.
Severity: Medium → **Resolved**
Comprehensive error handling strategy added: `Result<T, EngineError>` discriminated union at boundary APIs, three error modes (lenient/strict/pedantic), pre-allocated error singletons, `Diag` resource, `engine.halt()` for fatal errors. Per-problem resolutions: arena overflow returns `Result` from `registerComponent()`, assets use `AssetHandle<T>` with fallbacks, native bridge auto-reconnects with `'disconnected'` ticket status, worker timeouts documented with buffer loss semantics, physics accumulator capped via `maxSubstepsPerFrame` with `BudgetExceeded` events. Plugin factories remain the one place exceptions are allowed (before engine start).

10. No Save/Load Game Strategy
Severity: Medium → **Resolved**
`@nova/persist` added as an opt-in plugin (SPEC.md §9.5). Uses SQLite as a continuously-mirrored shadow of the SoA arena — typed array columns stored as BLOBs with zero serialization (`memcpy` in, `memcpy` out). Save = snapshot current live state (O(columns), not O(entities)). Load = restore snapshot BLOBs into typed arrays + invalidate query caches. Background sync via `defineJob` worker flushes dirty columns every N seconds. Crash recovery via live DB state. Cross-platform drivers: `better-sqlite3` (local), `wa-sqlite` + OPFS (web), `@libsql/client` for Turso cloud saves. Components persist by default; opt out via `{ persist: false }`. Resources opt in explicitly. Time-travel debugging (devtools only) reuses `@nova/net`'s change bitmask diff format.
11. Scene File Format Lacks Versioning
Severity: Medium
.nova.json files (lines 1456–1486) have no version field. As the engine evolves, scene files will need migration. Without versioning, there's no way to detect which format version a file uses or apply transformations.
12. Prefab Composition/Inheritance
Severity: Low — **RESOLVED: prefabs support single inheritance via `extends` and multi-prefab composition via `includes`. Merge semantics are deterministic: base (recursive) → includes (left-to-right) → own declarations. Children merge by name. Component removal intentionally unsupported. Resolution at `definePrefab()` time with circular reference detection. Scene files unchanged — overrides computed against the resolved (flattened) prefab. `childOverrides` added for per-instance child component overrides. See SPEC.md §12.**
Prefabs can have children, but can prefabs extend other prefabs? A BossPrefab based on EnemyPrefab with overrides is a common pattern. The spec doesn't address prefab inheritance or composition beyond parent-child hierarchy.
13. Render Order Management
Severity: Low
The render pipeline (line 607) sorts by "layer → texture → blend mode → depth" but there's no dedicated render-order component or API. The scene file example shows a RenderOrder: { layer: -10 } component, but this component is never defined in the spec. How developers control draw order (z-index equivalent) is underspecified.
14. State System vs. Global Systems Interaction
Severity: Medium — **RESOLVED: resource-guard model; all systems global, state-aware systems guard on `StateStack` resource; `defineState` is lifecycle + scene only, no `systems` field. See SPEC.md §14.**
defineState (line 1660) includes a systems array. But globally-registered systems (via engine.addStage) presumably run in all states. The spec doesn't explain:

Do state systems replace global systems, or add to them?
Are global systems paused when a state is pushed?
How do state-specific stages interact with the global stage pipeline?


Performance Concerns
15. Archetype Fragmentation
Severity: High — **ELIMINATED: archetypes are bitmasks for query resolution, not storage containers; no per-archetype arrays to fragment**
The spec doesn't discuss archetype fragmentation. Every unique combination of components creates a new archetype. If entities frequently gain/lose components (e.g., buff/debuff systems adding tag components), the number of archetypes can explode. Each archetype has its own set of typed arrays, defeating cache locality benefits. Games with rich component compositions can easily reach hundreds of archetypes, each containing only a few entities.
Mitigation strategies (archetype merging, component grouping guidelines, archetype count limits) aren't discussed.
16. Spatial Index Staleness
Severity: High — **RESOLVED: SpatialIndexSystem moved to dedicated `spatial` stage immediately after `physics`; post-physics, gameplay, and render-prep all see current-frame spatial data**
SpatialIndexSystem runs in render-prep (line 1733) — after all gameplay stages. But spatial queries are commonly needed during gameplay (AI proximity checks, area-of-effect damage, trigger zones). Systems in pre-physics, physics, post-physics, and gameplay stages would all query stale spatial data from the previous frame. For fast-moving objects, this means missed queries and phantom results.
The spatial index should be updated at least once before gameplay systems run (e.g., in a spatial-update stage before pre-physics), or provide a way for systems to trigger incremental updates.
17. Change Detection Overhead
Severity: Medium — **RESOLVED: double-buffered snapshot comparison for `.changed()` queries. Per-entity precision with zero write-path impact. Snapshots allocated only for components referenced in `.changed()` queries (opt-in cost). Scheduler write-set serves as free coarse pre-filter. Comparison is O(matched entities), not O(maxEntities). Snapshot copy at frame end is a single memcpy per tracked field (~0.02ms per 200KB). Comparison utility shared with `@nova/net` delta compression and `@nova/devtools` time-travel debugging.**
The query API supports .changed(Health) (line 199) for change detection. In SoA storage, this requires tracking every write to every component field — typically via dirty bitfields per entity per component, checked on every Position.x[eid] = ... assignment. Since component fields are raw typed array elements, there's no setter to intercept writes. This means either:

A Proxy-based approach (expensive, defeats the typed array performance model)
Manual marking (systems must call markChanged(eid, Health) — error-prone, not shown in spec)
Snapshot comparison (compare current vs. previous frame — O(n) per component per frame)

The spec shows change detection as a one-liner but doesn't address the implementation cost.
18. Zero-Allocation Claim vs. Event Objects
Severity: Medium — **RESOLVED: events use pre-allocated ring buffers (SoA typed arrays for numeric payloads, object-pool ring for complex payloads); no per-event allocation; cursor reset at frame boundary**
The spec targets "zero heap allocations per frame" (line 1706) and lists pooling strategies. But events like { type: 'collision', entityA, entityB, normal, impulse } are JavaScript objects that must be created each frame. Even with object pooling, the pool-checkout/return overhead exists and pool exhaustion causes allocation. The spec should clarify whether events are truly pooled objects, ring-buffer entries, or something else.
19. Query Overhead with Many Archetypes
Severity: Medium — **SIMPLIFIED: query resolution is bitmask matching over entity archetype masks; no archetype table iteration**
world.query(Position, Velocity) must find all archetypes containing both components. With N archetypes, this is O(N) per query per frame (linear scan, or O(log N) with archetype indexing). For games with many archetypes (see #15), query setup cost accumulates. The spec doesn't discuss archetype indexing strategies.
20. Transform Propagation for Deep Hierarchies
Severity: Low
TransformPropagationSystem walks parent chains to compute world transforms. For hierarchies of depth D with E entities, this is O(D * E) per frame. The spec doesn't discuss optimizations (topological sort, dirty flags, breadth-first traversal with depth-indexed processing).
21. Tilemap "Single Draw Call" Claim
Severity: Low
Line 382: "A 1000x1000 tilemap renders in a single draw call." That's 1M tile instances. Even with GPU instancing, uploading 1M instance transforms (16 bytes each minimum = 16 MB) per frame is expensive. The spec should clarify whether frustum culling is applied (only submit visible tiles) or if this is truly 1M instances per draw call.

Minor Issues
22. compositeAxis Name Not Imported — **RESOLVED: import added to @nova/input in minimal example**
23. The Output Phase is Mentioned Once — **RESOLVED: clarified as not a separate stage; side effects run within gameplay stages**
24. WebGPU Availability Statement is Dated
Line 598: "WebGPU availability (as of 2025) is strong on Chrome and Edge, growing on Firefox and Safari." This will age; consider removing the year reference or making it a footnote.
25. 20 KB Core Bundle Target is Aggressive
The @nova/core package includes: ECS world, archetype storage, generational IDs, entity hierarchy, system scheduler with dependency-graph analysis, game loop, event bus, math library (Vec2, Mat3, AABB, Color + utilities), typed resources, scene loading, prefab instantiation, AND spatial index — all under 20 KB gzipped. For reference, bitecs (SoA-only, no scheduler/math/scenes) is ~5 KB. The target may be achievable but should be validated with a prototype before committing to it as a published target.

---

## Review Pass 2 — Inconsistencies, Over-Engineering, and Gaps

### Inconsistencies Resolved

**A1. `world.spawn()` return type:** Resolved. `spawn()` returns `Entity` directly (halts on maxEntities). `trySpawn()` returns `Result<Entity>`. Builder pattern (`.add().withChild()`) chains on `spawn()`.

**A2. System resource declaration shape:** Resolved. Canonical form is `resources: { read: [...], write: [...] }`. Fixed §14 examples that used `resourceReads`/`writes`.

**A3. `compositeAxis` import:** Resolved. Import corrected to `@nova/input` in Appendix A.

**A4. Spatial index query API:** Resolved. Canonical API is zero-alloc caller-owned buffer: `queryAABB(minX, minY, maxX, maxY, results: Uint32Array): count`.

**A5. Asset consumption model:** Resolved. `loadManifest` returns `Result<ManifestAssets>` (all ready). Individual/streamed assets use `AssetHandle<T>` with status/value/fallback. Both patterns documented.

**A6. Scene versioning:** Resolved. `engineVersion` field documented with migration strategy: ordered transform functions `(sceneJson, fromVersion) => object`.

**A7. Animation state machine `eid` closure:** Resolved. Transition conditions receive entity ID as parameter: `when: (eid) => Math.abs(Velocity.x[eid]) > 0.1`.

**A8. Output phase:** Resolved. Clarified as not a separate stage — side effects run within gameplay stages (`gameplay` or `post-physics`).

### Over-Engineering Addressed

**B1. `@nova/persist` descoped:** SQLite continuous mirroring, 3 platform drivers, cloud saves, crash recovery, time-travel debugging, and editor undo/redo all deferred to v2+. v1 uses simple bulk typed array snapshots stored in IndexedDB (web) or filesystem (local).

**B2. `@nova/native` deferred:** Full §10.5 compressed to a design sketch. Marked as Phase 4+ / Future. Core engine does not depend on it.

**B3. Custom network serializer deferred:** v1 uses JSON for snapshot serialization. Custom binary format with delta compression deferred until profiling of JSON path informs the design.

**B4. Prefab inheritance phased:** v1 ships flat prefabs with spawn-time overrides. `extends` and `includes` deferred to v1.1.

**B5. Error modes reduced:** Three modes (lenient/strict/pedantic) reduced to two: `dev` (verbose + fallbacks) and `production` (emit events + fallbacks). Pedantic may be added later for CI.

**B6. Visual editor phased:** Full visual editor with round-trip persistence is Phase 3. v1 ships entity inspector + system profiler in `@nova/devtools`.

### Gaps Filled

**C1. Transform model:** Resolved. `Position` is always local (relative to parent, or world-space if no parent). `WorldTransform` (absolute) is computed by `TransformPropagationSystem`. Renderer reads `WorldTransform`. Gameplay reads/writes `Position`.

**C2. `maxEntities` config:** Added to Engine config with default 50,000.

**C3. `RenderOrder` component:** Defined as `{ layer: Types.i32 }` built-in from `@nova/renderer-webgpu`. Lower layer draws first.

**C4. State resource cleanup:** Resolved via `onEnter`/`onExit` lifecycle hooks — `insertResource` in `onEnter`, `removeResource` in `onExit`.

**C5. Tag component storage:** Clarified: `defineComponent({})` allocates zero bytes in the arena, tracked by archetype bitmask only.

**C6. String interning lifecycle:** Documented. StringTable grows monotonically — interned strings are never freed. Bounded by content for typical use (entity names, prefab IDs). Recommendation: use `Map<Entity, string>` resource for frequently-changing unique strings.

**C7. Write declaration API:** Canonicalized. Component access declarations live on the query: `query(...).read(...).write(...)`. No separate top-level `reads`/`writes` fields.

**C8. Renderer Transform reference:** Fixed. Renderer reads `WorldTransform` (not `Transform`), `Sprite`, `RenderOrder`, `TilemapLayer`, and `Camera`.

### Remaining Open Items
- WebGPU year reference (#24) — cosmetic, fix when spec is next edited
- 20 KB core bundle target (#25) — validate with Phase 1 prototype
- Transform propagation optimization (#20) — address during implementation
- Tilemap frustum culling (#21) — address during @nova/tilemap implementation

Summary by Severity
All critical and high-severity items from Pass 1 are resolved. All Pass 2 inconsistencies (A1–A8) are resolved. Over-engineering items (B1–B6) are addressed via phasing and scope reduction. Gaps (C1–C8) are filled. The spec is ready for Phase 1 implementation.