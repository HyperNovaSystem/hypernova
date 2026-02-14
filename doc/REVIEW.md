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
Severity: High
Scene metadata components (line 1513–1519) use Types.string:
typescriptconst Name = defineComponent({ value: Types.string });
const SceneEntity = defineComponent({ sceneId: Types.string, entityIndex: Types.u32 });
Strings cannot be stored in typed arrays (Float32Array, Uint32Array, etc.). The spec doesn't explain how non-numeric types are handled in the archetype/SoA system. Options include string interning (store indices into a string table), separate heap storage per archetype, or excluding string components from the SoA arena entirely — but each has different performance and complexity implications.
7. Arena Fallback Invalidates All Views
Severity: High — **MITIGATED: column arrays allocated once at startup, sized to maxEntities; resize only triggered by late defineComponent(), never during gameplay**
Line 278: "When resize() is unavailable, the arena falls back to allocate-and-copy."
Allocating a new ArrayBuffer and copying data invalidates all existing typed array views pointing at the old buffer. Every Float32Array reference held by systems, cached by queries, or stored in component definitions becomes dangling. This is a correctness bug, not just a performance issue. The spec needs a view-invalidation strategy (e.g., indirection through a view registry, or disallowing view caching).
8. Plugin API is Undefined
Severity: High
The entire architecture depends on plugins (RendererPlugin, PhysicsPlugin, InputPlugin, WorkersPlugin, NativePlugin, StatePlugin) yet the plugin interface is described only as engine.addPlugin(SomePlugin({...})). The TODO acknowledges this as an open question, but the spec should at minimum define:

What a plugin receives (engine reference? world? lifecycle hooks?)
Plugin ordering and dependency declaration
How plugins register stages, systems, resources, and components
Cleanup/dispose lifecycle

9. No Error Handling Strategy
Severity: Medium
The spec doesn't address failure modes:

Arena hits maxByteLength — what happens? Silent failure? Exception? Graceful degradation?
Asset loading fails (404, network timeout, corrupt file)
WebSocket disconnects for @nova/native mid-operation
Worker task exceeds timeout — the spec says "terminated and replaced," but what about in-flight state?
Physics step exceeds frame budget — does the game loop skip steps? Accumulate debt?

10. No Save/Load Game Strategy
Severity: Medium
For a game engine, save/load is fundamental. The spec discusses snapshot serialization for networking (@nova/net) but never addresses game save/load to persistent storage. On web, this means IndexedDB; on local target, filesystem via @nova/native. The networking serializer could serve double duty, but this isn't stated.
11. Scene File Format Lacks Versioning
Severity: Medium
.nova.json files (lines 1456–1486) have no version field. As the engine evolves, scene files will need migration. Without versioning, there's no way to detect which format version a file uses or apply transformations.
12. Prefab Composition/Inheritance
Severity: Low
Prefabs can have children, but can prefabs extend other prefabs? A BossPrefab based on EnemyPrefab with overrides is a common pattern. The spec doesn't address prefab inheritance or composition beyond parent-child hierarchy.
13. Render Order Management
Severity: Low
The render pipeline (line 607) sorts by "layer → texture → blend mode → depth" but there's no dedicated render-order component or API. The scene file example shows a RenderOrder: { layer: -10 } component, but this component is never defined in the spec. How developers control draw order (z-index equivalent) is underspecified.
14. State System vs. Global Systems Interaction
Severity: Medium
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
Severity: High
SpatialIndexSystem runs in render-prep (line 1733) — after all gameplay stages. But spatial queries are commonly needed during gameplay (AI proximity checks, area-of-effect damage, trigger zones). Systems in pre-physics, physics, post-physics, and gameplay stages would all query stale spatial data from the previous frame. For fast-moving objects, this means missed queries and phantom results.
The spatial index should be updated at least once before gameplay systems run (e.g., in a spatial-update stage before pre-physics), or provide a way for systems to trigger incremental updates.
17. Change Detection Overhead
Severity: Medium
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
22. compositeAxis Name Not Imported
The minimal example (line 1956) uses compositeAxis('KeyA', 'KeyD', 'KeyW', 'KeyS') but the import only includes items from @nova/core. compositeAxis should come from @nova/input.
23. The Output Phase is Mentioned Once
Line 62 mentions an "Output" phase for haptics, sound, and side effects, but it never appears in any stage ordering or system scheduling example. It's unclear whether this is a formal stage or just a conceptual label.
24. WebGPU Availability Statement is Dated
Line 598: "WebGPU availability (as of 2025) is strong on Chrome and Edge, growing on Firefox and Safari." This will age; consider removing the year reference or making it a footnote.
25. 20 KB Core Bundle Target is Aggressive
The @nova/core package includes: ECS world, archetype storage, generational IDs, entity hierarchy, system scheduler with dependency-graph analysis, game loop, event bus, math library (Vec2, Mat3, AABB, Color + utilities), typed resources, scene loading, prefab instantiation, AND spatial index — all under 20 KB gzipped. For reference, bitecs (SoA-only, no scheduler/math/scenes) is ~5 KB. The target may be achievable but should be validated with a prototype before committing to it as a published target.

Summary by Severity
SeverityCountKey ItemsCritical0~~Entity ID vs. archetype SoA access pattern (#1)~~ — RESOLVEDHigh3~~Entity bit packing (#2)~~ RESOLVED, string types in SoA (#6), ~~arena fallback (#7)~~ MITIGATED, plugin API (#8), ~~archetype fragmentation (#15)~~ ELIMINATED, spatial index staleness (#16)Medium6~~Event API inconsistency (#3)~~ RESOLVED, resource access (#4), error handling (#9), save/load (#10), scene versioning (#11), state system interaction (#14), change detection (#17), ~~zero-alloc events (#18)~~ RESOLVED, ~~query overhead (#19)~~ SIMPLIFIEDLow6Stage ordering (#5), prefab inheritance (#12), render order (#13), transform propagation (#20), tilemap claim (#21), minor issues (#22–25)
The adoption of global SoA (column-per-field) storage with archetype bitmask query resolution resolves issues #1, #2, #7, #15, and #19. The unified `defineEvent` API with ring-buffered storage resolves issues #3 and #18. The remaining highest-priority issues are: string types in SoA (#6), plugin API (#8), and spatial index staleness (#16).