# Artnoc: Findings & Engine Deficiencies

Findings from building a side-scrolling action game ("Artnoc") using the HyperNova ECS engine.

---

## 1. Engine Strengths

- **Fast bootstrapping**: Defining components, resources, events, and systems is concise and ergonomic. The tower defense example provided a clear pattern to follow.
- **SoA performance model**: Direct typed-array access (`Position.x[eid]`) is cache-friendly and avoids object allocation per entity, which matters for bullet-heavy games.
- **Deterministic simulation**: The fixed-timestep loop with `engine.tick()` and seeded PRNG make replays and testing straightforward.
- **Stage-based pipeline**: Ordering systems into stages (input -> movement -> combat -> world -> cleanup) maps cleanly to a game loop.
- **Small bundle**: The entire engine + game compiles to ~36 KB gzipped. No bloat.

---

## 2. Issues Encountered

### 2.1 No Built-In Health / Stat Component

The engine's only example (tower defense) defines its own `Health` component. For the Contra clone, enemies need per-entity health tracking, but the ECS only supports numeric typed-array fields. There is no general-purpose "stats" or "health" component provided by the engine.

**Workaround**: We repurposed `Sprite.animTimer` as an enemy health counter. This is a hack — it conflates animation state with gameplay data. A proper solution would be a dedicated `Health` component, but the 64-component bitmask limit (see 2.3) makes adding components a budgeted decision.

**Recommendation**: The engine should ship a small set of common gameplay components (Health, Damage, Timer) as an optional plugin, or raise the component limit.

### 2.2 No Built-In Sprite / Animation System

The engine provides no animation or sprite primitives. Every game must build its own sprite rendering, frame cycling, and spritesheet logic from scratch. The tower defense example draws shapes directly via Canvas2D.

For an action game, this means:
- No spritesheet atlas support
- No animation state machine
- No frame sequencing or blend transitions
- All rendering is manual Canvas2D draw calls

**Impact**: The renderer is ~300 lines of procedural drawing code that would be 50 lines with sprite support.

### 2.3 64-Component Hard Limit

The archetype bitmask uses 2x32-bit integers, capping the engine at 64 component types. For a Contra clone, we used 12 components and were fine, but a more complex game (RPG, simulation) could easily hit this ceiling.

**Impact**: Forces consolidation of related data into fewer components (e.g., putting health into Sprite), which undermines the "composition over inheritance" ECS philosophy.

**Recommendation**: Consider a sparse-set or hierarchical bitmask approach for larger games. Document the limit prominently.

### 2.4 No Physics / Collision Primitives

The engine spec mentions Rapier2D integration but it is not implemented. For Artnoc, we wrote a manual AABB collision resolver (~80 lines) handling:
- Platform top landing (one-way platforms)
- Solid wall/floor/ceiling resolution
- Minimum-penetration axis selection

This is error-prone. The `AABBUtil.overlaps()` helper exists in `math.ts` but is only a boolean test — it doesn't compute penetration depth, contact normal, or resolve the collision.

**Recommendation**: Provide a minimal collision helper that returns penetration vector and contact info, even without a full physics engine.

### 2.5 No Audio Support

There is no audio system or even a stub. A Contra clone without sound effects (gunshots, explosions, death jingle) is incomplete. The spec mentions Web Audio API support as planned.

### 2.6 No Asset Loading Pipeline

All game content must be defined procedurally in code. There is no:
- Image/texture loading
- JSON level file parsing
- Spritesheet definition format
- Async asset preloading

The level data, enemy definitions, and weapon stats are all hardcoded TypeScript objects. For a production game, this would need an asset pipeline.

### 2.7 Component Field Types Limited to Numeric

All component fields must be backed by TypedArrays (f32, i32, u8, etc.). You cannot store:
- Strings
- Objects/arrays
- References to other entities (must use raw index numbers)
- Booleans (must use u8 with 0/1 convention)

**Impact**: Entity references are untyped `u32` values with no lifetime safety. If entity 5 is destroyed and recycled, any component still referencing entity 5 by index may silently point to the wrong entity. The generational ID system exists in `EntityManager` but component fields store raw indices, not packed handles.

### 2.8 No Entity Relationship / Hierarchy

There is no parent-child or entity hierarchy system. In Contra, this matters for:
- Attaching weapons to characters
- Grouping boss sub-parts
- Scene graph for complex entities

Each entity is a flat bag of components with no structural relationships.

### 2.9 `world.query()` Creates Allocations Per Call

Each call to `world.query(query(...))` inside a system's `execute()` creates a new `QueryDef` object and array of results. In our `HitDetectionSystem`, we query for enemies and players every tick. While the query executor caches results based on component bitmask keys, the `query()` builder function itself allocates a new object every call.

**Recommendation**: Allow pre-registering queries at setup time and referencing them by handle inside systems, avoiding per-frame allocations.

### 2.10 No Input Abstraction

The engine provides no input handling. All keyboard/mouse/gamepad input must be wired up manually via DOM events. The tower defense example and our Contra clone both implement their own input state management.

**Recommendation**: Provide at minimum a `defineResource<InputMap>` pattern or small input plugin that handles key state, press/release edge detection, and gamepad support.

---

## 3. Architectural Observations

### 3.1 Renderer Is Not Part of the Engine

The engine is purely a simulation framework. Rendering is entirely the game's responsibility. This is intentional (the spec says "WebGPU-first renderer" is planned), but it means every game must:
1. Write its own rendering pipeline
2. Manually read component data for drawing
3. Handle camera, scrolling, and coordinate transforms
4. Implement its own draw-order/layering

For 2D action games, this is a significant amount of boilerplate.

### 3.2 Deferred Commands vs. Direct World Mutation

Systems can both use `commands` (deferred) and call `world.spawn()` / `world.addComponent()` (immediate). The tower defense example mixes both patterns. This inconsistency can lead to subtle bugs:
- Immediate mutation during iteration can invalidate query results
- Deferred commands are only flushed between stages

We chose immediate mutation (via `world`) in most systems for simplicity, matching the tower defense example's pattern.

### 3.3 No Scene / State Machine

There is no concept of game scenes (title screen, gameplay, pause, game over). We implemented this as a `phase` field on the `GameState` resource, with each system checking `if (gs.phase !== 'playing') return;`. This works but is ad-hoc.

**Recommendation**: The engine spec (doc 16) describes a game state machine, but it is not implemented.

---

## 4. Game-Specific Issues

### 4.1 Platform Collision Resolution

Our AABB-based platform resolver handles the common cases but has edge cases:
- High-speed entities can tunnel through thin platforms
- Corner collisions can resolve to the wrong axis
- One-way platforms rely on comparing old/new Y positions, which is fragile

A proper solution would use swept AABB or continuous collision detection.

### 4.2 Enemy Health Hack

Storing enemy HP in `Sprite.animTimer` is brittle. If any system updates `animTimer` for animation purposes, it would corrupt the health value. A cleaner approach would be a dedicated `Health` component, but we avoided it to demonstrate the engine's constraints.

### 4.3 No Scrolling Lock for Boss Arena

Classic Contra locks the camera during boss fights. Our implementation relies on the natural scroll clamp, but doesn't prevent backward scrolling during the boss encounter. The level design works around this with a wall entity.

---

## 5. Summary

The HyperNova engine provides a solid, minimal ECS foundation suitable for simple-to-moderate 2D games. Its strengths are performance (SoA), determinism, and developer ergonomics. Its main gaps for action game development are:

| Gap | Severity | Workaround Available |
|-----|----------|---------------------|
| No sprite/animation system | High | Manual Canvas2D drawing |
| No collision resolution | High | Custom AABB resolver |
| No audio | High | None (silent game) |
| No asset pipeline | Medium | Hardcoded data |
| 64-component limit | Medium | Consolidate components |
| No input abstraction | Low | Manual DOM event wiring |
| No scene/state machine | Low | Resource-based phase flag |
| No entity hierarchy | Low | Flat entity design |

The engine is best suited today for prototyping and jam-style games. Production action games would need the planned renderer, physics, audio, and asset systems to be implemented.
