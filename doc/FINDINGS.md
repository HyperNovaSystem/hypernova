# HyperNova Engine — Project Review Findings

**Reviewed:** 2026-03-12
**Scope:** Full codebase review — core ECS engine (`src/core/`) and tower defense example (`examples/tower-defense/`)

---

## 1. Architecture Overview

HyperNova is a TypeScript ECS (Entity Component System) simulation engine with:

- **SoA (Struct-of-Arrays) component storage** via typed arrays for cache-friendly access
- **Bitmask-based archetype queries** (64-component limit using 2x u32)
- **Generational entity IDs** with free-list recycling
- **Fixed-timestep simulation loop** with accumulator and death-spiral protection
- **Double-buffered event system** (write in one stage, read in the next)
- **Deferred command queue** flushed between stages
- **Plugin system** with dependency ordering
- **Deterministic PRNG** (xoshiro128**)

The design is clean, well-scoped, and follows proven ECS patterns (similar to Bevy's architecture translated to TypeScript).

---

## 2. Strengths

### Code Quality
- **Consistent style** across all files — clean separation of concerns, minimal abstractions
- **Strong typing** — symbol-keyed metadata avoids index-signature conflicts, branded resource/event tokens provide type safety
- **Zero-allocation math** — `Vec2` and `AABBUtil` use output-parameter patterns to avoid GC pressure
- **Good use of TypedArrays** — components stored in contiguous typed arrays for cache performance
- **Deterministic design** — seeded PRNG, fixed timestep, serializable RNG state

### Engine Design
- **SoA access pattern** (`Position.x[eid]`) is ergonomic and performant — direct typed array indexing without indirection
- **Query builder API** is fluent and intuitive: `query(Position, Velocity).not(Dead)`
- **Event double-buffering** prevents same-frame ordering issues between stages
- **Death spiral protection** via `maxSubstepsPerFrame` cap on the accumulator
- **Plugin cleanup** runs in reverse installation order (LIFO), which is correct

### Example Quality
- The tower defense example is a solid demonstration — it exercises entities, components, queries, resources, events, tags, deferred commands, and the stage pipeline
- Shows realistic game patterns: pathfinding, targeting, splash damage, status effects, wave spawning

---

## 3. Issues Found

### 3.1 Bugs

#### **[BUG-1] `commands.spawn()` is not deferred — it's immediate**
`world.ts:207-209` — `commands.spawn()` calls `this.spawn()` directly, making it an immediate operation while `destroy`, `addComponent`, and `removeComponent` are deferred. This inconsistency can cause:
- Structural changes mid-system execution
- Query cache invalidation while iterating
- Entity indices returned by `commands.spawn()` may be operated on before other deferred commands flush

**Recommendation:** Either document this as intentional (spawn must be immediate to return an index for subsequent `addComponent` calls), or provide a spawn-with-components builder that defers the entire operation.

#### **[BUG-2] Duplicate game loop — Engine loop not used**
`examples/tower-defense/src/main.ts:112-142` — The example implements its own `requestAnimationFrame` loop with accumulator, duplicating the logic in `Engine.start()` / `Engine.rafLoop`. The engine is created with `headless: false` but `engine.start()` is never called. This works, but means the engine's `wallTime` tracking, `timeScale`, and `getInterpolationAlpha()` features are inactive.

#### **[BUG-3] Input cleared at wrong time in multi-tick frames**
`main.ts:129-131` — Per-frame input (`clicked`, `rightClicked`, `keyNumber`) is cleared after *every* tick inside the `while (accumulator >= fixedDt)` loop. If a frame runs 2+ ticks (due to lag), input events are only processed in the first tick and cleared before the second. This is usually fine for click events (single-fire), but could miss edge cases.

#### **[BUG-4] Query cache key ignores `readComponents`, `writeComponents`, and `changedComponents`**
`world.ts:129-133` — The cache key is built from only `components` and `notComponents`. Two queries with the same required/excluded components but different `read`/`write`/`changed` sets would collide. Currently unused because `read`/`write`/`changed` don't affect query filtering, but this becomes a bug if change-detection is ever implemented.

### 3.2 Design Concerns

#### **[DESIGN-1] 64-component hard limit**
`component.ts:21-23` — Component IDs are capped at 64 due to the 2x u32 bitmask. This is fine for small projects but may become limiting. The error is thrown at definition time, which is good.

**Mitigation:** Consider documenting this limit prominently. If more than 64 are needed, the archetype storage could be extended to N u32 words.

#### **[DESIGN-2] Global mutable state in `component.ts`**
`component.ts:4` — `nextComponentId` is a module-level counter. Calling `defineComponent` in tests or multiple engine instances will share and increment this counter. `resetComponentIds()` exists but is fragile — it doesn't reset the component objects' stored IDs.

#### **[DESIGN-3] `ResourceStore` keys by `token.name` string, not token identity**
`resource.ts:18` — Two different `defineResource()` calls with the same name string would silently alias to the same storage slot. This is a latent name-collision risk.

#### **[DESIGN-4] `applyProjectileHit` takes `world: any`**
`systems.ts:179` — The function parameter is typed as `any` instead of `WorldLike`, losing type safety.

#### **[DESIGN-5] No Velocity component on projectiles**
Projectiles use `Projectile.speed` and manual position updates in `ProjectileMovementSystem` instead of the `Velocity` component. This is fine (homing projectiles need target-relative movement), but it means the `Velocity` component is defined but never used in the example.

### 3.3 Missing Pieces

#### **[MISSING-1] No test suite**
`package.json:13` — `"test": "echo \"Error: no test specified\" && exit 1"`. There are zero tests for the core engine. Given the bit-manipulation, entity recycling, and event buffering logic, unit tests are important.

#### **[MISSING-2] No build/publish pipeline**
- No `dist/` output configured (tsconfig has `noEmit: true`)
- No npm publish script or bundled output for library consumers
- The `main` field in `package.json` points to a `.ts` file, which won't work for non-bundler consumers

#### **[MISSING-3] `changedComponents` in queries is parsed but never evaluated**
`query.ts:53-60` and `query.ts:116-151` — The `QueryBuilder` accepts `.changed()` calls and stores them, but `QueryExecutor.execute()` never checks them. Change detection is not implemented.

#### **[MISSING-4] `read`/`write` component access not enforced**
The query builder distinguishes `read` vs `write` components, but no runtime or compile-time enforcement exists. Any system can mutate any component array regardless of declared access. This matters for future parallelization.

#### **[MISSING-5] No spatial index / broad-phase**
Tower targeting iterates all enemies every frame (`O(towers * enemies)`). The spec mentions a `SpatialIndex` but it isn't implemented. For the current scale (< 10K entities) this is fine.

---

## 4. Performance Notes

- **Entity iteration in queries** allocates a new array every call (`getAliveEntities()` + `execute()` both create arrays). For hot paths this could be optimized with a reusable buffer.
- **Query cache** is cleared every tick (`world.ts:202`), so it only helps within a single tick when multiple systems query the same components. This is reasonable.
- **`registeredComponents` scan on destroy** (`world.ts:64-66`) — `clearComponentValues` is called for *all* registered components when an entity is destroyed, not just the ones the entity has. This is O(components * fields) per destroy. Could check `hasComponent` first.
- **`includes()` check for component registration** (`world.ts:91`) — Linear scan on every `addComponent`. A `Set` would be faster.

---

## 5. Security & Robustness

- No user input sanitation issues (canvas-only, no DOM injection)
- No external network calls or data loading
- `Random.range()` uses modulo which introduces slight bias for non-power-of-2 ranges — acceptable for game use, not for cryptographic purposes
- Entity index validation in `EntityManager` correctly bounds-checks before array access

---

## 6. Recommendations (Priority Order)

1. **Add unit tests** for `EntityManager`, `QueryExecutor`, `EventStore`, `World.tick()`, and `Random` — these are the most critical and testable pieces
2. **Document the 64-component limit** and the immediate `commands.spawn()` behavior
3. **Use the engine's built-in game loop** in the example (or document why a custom loop is preferred)
4. **Type `applyProjectileHit`'s `world` parameter** as `WorldLike`
5. **Add a build step** that emits `.js` + `.d.ts` for library distribution
6. **Consider `Set` for `registeredComponents`** to avoid linear scan on every `addComponent`
7. **Implement change detection** or remove `changedComponents` from the API to avoid confusion
8. **Add `eslint` and/or `prettier`** for automated style enforcement
