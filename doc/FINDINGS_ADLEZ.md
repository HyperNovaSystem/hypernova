# Adlez Game - HyperNova Engine Findings

Deficiencies, gaps, and observations encountered while building a top-down RPG
("Adlez") on top of the HyperNova ECS engine (v1.0.0).

---

## Critical Deficiencies

### F-01: No `world.clear()` or bulk entity destruction

There is no way to destroy all entities at once. When transitioning between
rooms, we must manually query every known component type and destroy each entity
individually. This is fragile (must enumerate all component types) and slow (N
queries + N destroys). A `world.clear()` or `world.destroyAll()` method is
essential for games with scene/room/level transitions.

**Workaround:** Queried each component type (`Enemy`, `Item`, `Sword`,
`Projectile`, `Door`) and looped `world.destroy()` on each. For game-over
restart, we resorted to `location.reload()`.

**Impact:** High. Room transitions are the most basic Zelda-like pattern and
they require tearing down/rebuilding entity sets constantly.

---

### F-02: No sprite/texture/asset pipeline

The engine provides zero support for loading or rendering images, sprite sheets,
or tilesets. The entire rendering layer must be hand-written by the game. For a
Zelda clone, this means drawing every character, tile, and item with Canvas2D
primitives (rectangles, circles, bezier curves).

**Workaround:** Wrote a complete `AdlezRenderer` class (~400 lines) using
raw Canvas2D calls. Characters are drawn with colored rectangles and simple
shapes rather than sprites.

**Impact:** Very high. Any production game needs sprite support. This is the
single biggest gap for a game-oriented engine.

---

### F-03: No built-in collision / physics system

There is no spatial query, AABB overlap test, or collision resolution system.
All collision detection must be implemented manually in game systems: tile
collision, entity-entity overlap, sword hitboxes, projectile hits, and item
pickups.

**Workaround:** Wrote `collidesWithTile()` and `boxOverlap()` helpers. Each
system that needs collision (5+ systems) re-implements its own checks with
hardcoded half-widths. This duplicates logic and is error-prone.

**Impact:** High. Collision is fundamental to any action game.

---

### F-04: No built-in input system

The engine has no input abstraction. All keyboard/mouse/gamepad handling must be
done outside the ECS via raw DOM event listeners, with state manually pushed
into a resource. There is no input mapping, action binding, or "just pressed /
just released" detection built in.

**Workaround:** Created an `InputState` resource and wired up `keydown`/`keyup`
listeners manually. Had to manage "pressed this frame" flags (`attackPressed`,
`interactPressed`) with manual clearing at end of tick.

**Impact:** Medium-high. Input is core to any interactive application and the
per-frame flag management is tricky to get right with the fixed-timestep loop.

---

## Moderate Deficiencies

### F-05: No animation system

No built-in support for frame-based sprite animation, tweens, or state
machines. An `AnimationState` component was defined but ultimately unused
because there are no sprites to animate -- the renderer draws everything
procedurally.

**Workaround:** Used `animFrame` counter in the renderer for simple oscillation
effects (item bobbing, wing flaps, water waves). A proper animation system
would need sprite sheet definitions, frame timing, and state transitions.

**Impact:** Medium. Any game with sprites needs animation.

---

### F-06: No audio system

No audio playback support. A Zelda clone begs for sword slashes, item pickups,
enemy hits, and background music.

**Workaround:** None. Game is silent.

**Impact:** Medium. Audio is important for game feel but not blocking for a
prototype.

---

### F-07: No tilemap / level loading support

No concept of tile grids, tilemaps, layers, or room management. The entire room
system (tile arrays, room definitions, door connections, entity spawning) was
built from scratch.

**Workaround:** Created a custom `RoomMapData` resource with hand-coded
`Uint8Array` tile grids and room definition objects. Room transitions involve
manual teardown/rebuild of all entities.

**Impact:** Medium-high. Tile-based games are one of the most common 2D genres.

---

### F-08: `Math.random()` used instead of engine PRNG

The engine provides a deterministic `Random` resource (xoshiro128**), but there
is no convenient way to access it from within systems. Systems receive a
`SystemContext` with `resources`, but the Random resource requires explicit
setup. We ended up using `Math.random()` in enemy AI for simplicity, breaking
determinism.

**Workaround:** Used `Math.random()` directly. To use the engine PRNG, we would
need to `defineResource` a random instance and thread it through, which adds
boilerplate.

**Impact:** Medium. Deterministic simulation is a stated engine goal but it's
not ergonomic enough for casual use.

---

### F-09: Per-frame input clearing interacts badly with fixed-timestep

The engine runs a fixed-timestep loop with an accumulator. If multiple ticks
occur per frame, "just pressed" input flags are only true during the first tick
and cleared before subsequent ticks. But if zero ticks occur in a frame, the
flag persists to the next frame's ticks. The engine provides no guidance or
built-in mechanism for handling this.

**Workaround:** Clear `attackPressed`/`interactPressed` after the `while`
accumulator loop. This means the flag is consumed by the first tick and missed
by subsequent ticks in the same frame -- which is acceptable but not ideal.

**Impact:** Medium. This is the same issue noted in the tower defense example
(FINDINGS.md bug #3) and remains unresolved.

---

### F-10: No scene / game state management

The engine has no concept of scenes, game states (title screen, playing, paused,
game over), or scene transitions. All state machine logic is done via a string
field on a resource (`gameState.phase`), and every system must check the phase
before executing.

**Workaround:** Added a `phase` field to `GameStateData` and guarded every
system with `if (gameState.phase !== 'playing') return;`.

**Impact:** Medium. Scene management is common enough that it deserves
first-class support or at least a pattern recommendation.

---

## Minor Deficiencies

### F-11: No camera system

No viewport, scrolling, or camera abstraction. The game is locked to a
single-screen room (256x176 pixels scaled 3x) which is fine for classic Zelda
rooms but limiting for larger maps.

### F-12: No UI/HUD framework

All HUD rendering (hearts, keys, rupees, minimap) is hand-drawn on the canvas.
A basic text/rect UI layer or retained-mode UI system would help.

### F-13: 64-component hard limit

The bitmask-based archetype system supports a maximum of 64 component types. Our
game uses 15 components. A larger game could easily exceed this limit with
animation states, AI behaviors, buffs, etc.

### F-14: No entity prefab / archetype templates

Spawning an entity requires multiple `addComponent()` calls (typically 3-5 per
entity). A prefab or template system would reduce boilerplate. The
`spawnRoomEntities()` function is ~80 lines of repetitive spawn code.

### F-15: No parent-child entity relationships

Sword hitboxes are spawned as independent entities. There is no parent-child
relationship, transform hierarchy, or way to "attach" one entity to another.
This complicates following entities (e.g., a shield that follows the player).

### F-16: System-level query inside execute is awkward

To query entities other than the system's primary query (e.g., finding all
enemies from within the tower targeting system), you must call `world.query()`
with a new `query()` inside `execute()`. This re-evaluates on every call and
the ergonomics differ from the primary query pattern.

### F-17: No event replay or debug tooling

No way to record/replay input, inspect entity state, or visualize system
execution order. Debugging required extensive `console.log` usage.

---

## Positive Observations

- **ECS core is solid:** Component definition, system scheduling, and query
  execution all work correctly and are pleasant to use.
- **Struct-of-Arrays performance:** Direct typed array access
  (`Position.x[eid]`) is fast and cache-friendly.
- **Deferred commands work well:** Spawning/destroying entities from within
  systems does not cause aliasing or iteration issues.
- **Event system is clean:** Double-buffered events with stage-boundary
  promotion is an elegant design.
- **Small bundle size:** The engine core + game compiles to ~39 KB (12 KB
  gzipped), which is excellent.
- **TypeScript type safety:** Resource tokens and event tokens provide good
  compile-time safety.
- **Fixed timestep:** Deterministic simulation timing works correctly.
- **Plugin architecture:** While unused in this game, the plugin system is
  well-designed for composability.

---

## Recommendations

1. **Priority 1:** Add `world.clear()` for scene transitions
2. **Priority 1:** Build a basic sprite/tilemap rendering package (`@nova/render`)
3. **Priority 2:** Add a collision package with AABB and spatial hashing
4. **Priority 2:** Add an input package with action mapping and frame-edge detection
5. **Priority 3:** Add audio, animation, and camera packages
6. **Priority 3:** Add entity templates/prefabs for reducing spawn boilerplate
7. **Priority 4:** Add scene/state management utilities
8. **Priority 4:** Increase component limit beyond 64 or make it configurable
