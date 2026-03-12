# HyperNova — Simulation Engine Implementation Plan

**Date:** 2026-03-12
**Scope:** Address validated findings from FINDINGS.md, FINDINGS_ADLEZ.md, FINDINGS_ARTNOC.md, and FINDINGS_NITROGEN.md
**Goal:** A simulation engine that serves games and control systems equally well

---

## Methodology

Each finding from the four review documents was evaluated against two questions:

1. **Is it valid?** Does the finding reflect a real gap or bug, not just a domain-specific wish?
2. **Does it serve both domains?** Games need fast iteration, rich input, visual feedback. Control systems need deterministic execution, persistent logging, configurable timing, and safety interlocks. The core engine must serve both; domain-specific features belong in plugins.

Findings that are purely cosmetic, domain-specific presentation concerns (e.g., gauge rendering, trend chart zoom), or already covered by the existing TODO.md roadmap are noted as "already planned" or "out of scope" and not re-planned here.

---

## Finding Triage

### Validated — Core Engine (affects both domains)

| ID | Source | Summary | Severity |
|----|--------|---------|----------|
| BUG-1 | FINDINGS | `commands.spawn()` is immediate, not deferred | High |
| BUG-4 | FINDINGS | Query cache key ignores read/write/changed | Medium |
| DESIGN-1, F-13, 2.3 | All three games + core | 64-component hard limit | High |
| DESIGN-2 | FINDINGS | Global mutable `nextComponentId` counter | Medium |
| DESIGN-3 | FINDINGS | ResourceStore keys by name string, not identity | Medium |
| MISSING-1 | FINDINGS | No test suite | Critical |
| MISSING-2 | FINDINGS | No build/publish pipeline | High |
| MISSING-3 | FINDINGS | `changedComponents` parsed but never evaluated | Medium |
| MISSING-4 | FINDINGS | read/write access not enforced | Low |
| F-01 | ADLEZ | No `world.clear()` or bulk entity destruction | High |
| F-08 | ADLEZ | PRNG not ergonomic to use from systems | Medium |
| F-09, BUG-3 | ADLEZ, FINDINGS | Input clearing interacts badly with fixed timestep | Medium |
| F-14 | ADLEZ | No entity prefab/template system | Medium |
| F-15, 2.8 | ADLEZ, ARTNOC | No parent-child entity relationships | Medium |
| F-16, 2.9 | ADLEZ, ARTNOC | Per-call query allocations; no pre-registered queries | Medium |
| 4.2, 2.7 | NITROGEN, ARTNOC | Component fields limited to numeric types | Medium |
| 4.3 | NITROGEN | Entity references are raw u32 with no liveness check | Medium |
| 4.4 | NITROGEN | No persistent event/audit log | Medium |
| Perf-1 | FINDINGS | `getAliveEntities()` allocates array every call | Medium |
| Perf-2 | FINDINGS | `clearComponentValues` scans all components on destroy | Low |
| Perf-3 | FINDINGS | `registeredComponents` uses `includes()` (linear) | Low |

### Validated — Game Plugin Layer

| ID | Source | Summary | Severity |
|----|--------|---------|----------|
| F-02, 2.2 | ADLEZ, ARTNOC | No sprite/texture/asset pipeline | High |
| F-03, 2.4 | ADLEZ, ARTNOC | No collision/physics system | High |
| F-04, 2.10 | ADLEZ, ARTNOC | No input abstraction | High |
| F-05 | ADLEZ | No animation system | Medium |
| F-06, 2.5 | ADLEZ, ARTNOC | No audio system | Medium |
| F-07 | ADLEZ | No tilemap/level loading | Medium |
| F-10, 3.3 | ADLEZ, ARTNOC | No scene/game state management | Medium |
| F-11 | ADLEZ | No camera system | Low |
| F-12 | ADLEZ | No UI/HUD framework | Low |
| F-17 | ADLEZ | No event replay or debug tooling | Low |

### Validated — Control System Plugin Layer

| ID | Source | Summary | Severity |
|----|--------|---------|----------|
| N-3.3 | NITROGEN | Alarm management lacks ISA-18.2 state machine | High |
| N-5.1 | NITROGEN | Interlock timing has no configurable delays | Medium |
| N-5.3 | NITROGEN | No deadband/hysteresis on alarm setpoints | Medium |

### Out of Scope (domain-specific presentation or already planned)

| ID | Reason |
|----|--------|
| BUG-2 | Example bug, not engine bug — fix in example |
| DESIGN-4 | Typing fix in example code, not engine |
| DESIGN-5 | Example design choice, not engine issue |
| N-2.x | Thermodynamic fidelity — domain physics, not engine |
| N-3.1, N-3.2, N-3.4 | Dashboard UI features — not engine scope |
| N-6.x | Performance of specific example — already fine |

---

## Implementation Plan

The plan is organized into 6 work packages. WP1-WP3 are core engine improvements required before any domain plugin work. WP4-WP6 are plugin layers that can proceed in parallel once the core stabilizes.

---

### WP1: Core Engine Bug Fixes and Hardening

**Timeline:** First priority. All items are prerequisites for reliable simulation.

#### 1.1 Make `commands.spawn()` truly deferred (BUG-1)

**Problem:** `commands.spawn()` calls `world.spawn()` immediately, while `destroy`, `addComponent`, and `removeComponent` are deferred. This causes structural changes mid-system execution.

**Plan:**
- Add a `SpawnBuilder` that accumulates component additions and returns a `PendingEntity` handle (a branded opaque token, not a live entity index)
- `PendingEntity` can be passed to subsequent `commands.addComponent()` calls within the same system — they all queue together
- On flush, the builder executes `world.spawn()` + all `addComponent()` calls atomically
- `PendingEntity` resolves to the real entity index after flush; systems in later stages can read it via a `ResolvedSpawns` resource
- Preserve the existing immediate `world.spawn()` for use outside system execution (setup code, plugins)

**Files:** `src/core/world.ts` (commands object), new `src/core/spawn-builder.ts`

#### 1.2 Fix query cache key collision (BUG-4)

**Problem:** Cache key is built from only `components` and `notComponents`. Queries with different `read`/`write`/`changed` sets collide.

**Plan:**
- Include `readComponents`, `writeComponents`, and `changedComponents` bitmasks in the cache key
- The key becomes `${required}|${excluded}|${read}|${write}|${changed}`
- This is a one-line fix but prevents a class of bugs when change detection is implemented

**Files:** `src/core/world.ts:129-133`

#### 1.3 Fix input consumption with fixed timestep (BUG-3, F-09)

**Problem:** Per-frame input events are cleared inside the accumulator loop, so multi-tick frames lose input after the first tick.

**Plan:**
- Add an `InputBuffer` concept to `@nova/core` — a ring buffer that stores input events timestamped to the frame they arrived
- Input events are consumed exactly once: the first tick of a frame drains the buffer, subsequent ticks see empty input
- This is the correct semantic: a button press is a discrete event, not a continuous state
- Continuous state (key held) vs. edge events (key pressed) are distinguished at the type level
- Document the pattern in a "Fixed Timestep and Input" guide

**Files:** New `src/core/input-buffer.ts`, updates to `src/core/engine.ts`

#### 1.4 Fix `clearComponentValues` scanning all components on destroy (Perf-2)

**Problem:** Destroying an entity clears values for ALL registered components, not just those the entity has.

**Plan:**
- Read the entity's archetype bitmask before clearing
- Only iterate components whose bit is set in the mask
- ~5 line change, significant perf improvement for worlds with many component types

**Files:** `src/core/world.ts:64-66`

#### 1.5 Use `Set` for `registeredComponents` (Perf-3)

**Problem:** `addComponent` does a linear `includes()` scan on every call.

**Plan:**
- Replace `registeredComponents` array with a `Set<number>` keyed by component ID
- Change `includes()` to `has()` — O(1) instead of O(n)

**Files:** `src/core/world.ts:91`

#### 1.6 Fix `ResourceStore` keying (DESIGN-3)

**Problem:** Two `defineResource()` calls with the same name string silently alias.

**Plan:**
- Key the resource map by the token object identity (use a `Map<symbol, T>` where each token gets a unique `Symbol`)
- The token already has a `[sym]` property — use that as the map key
- Add a dev-mode warning if two tokens share the same display name

**Files:** `src/core/resource.ts`

#### 1.7 Scope component ID counter per world (DESIGN-2)

**Problem:** `nextComponentId` is a module-level global. Multiple worlds or test suites share the counter.

**Plan:**
- Move component ID allocation into a `ComponentRegistry` class owned by the `World`
- `defineComponent()` becomes a schema declaration (no ID assigned)
- IDs are assigned when a component is first registered with a specific world via `world.registerComponent()`
- Backward compat: keep `defineComponent()` as the public API; auto-register on first use within a world
- This also enables the component limit to be per-world rather than global

**Files:** `src/core/component.ts`, `src/core/world.ts`

---

### WP2: Core Engine Feature Gaps

**Timeline:** After WP1. These are the most-requested features across all four findings documents.

#### 2.1 Raise the 64-component limit (DESIGN-1, F-13, 2.3)

**Problem:** The 2x u32 bitmask caps the engine at 64 component types. Multiple reviewers hit this or flagged it as a concern.

**Plan:**
- Replace the fixed 2x u32 bitmask with a dynamically-sized `Uint32Array` archetype mask
- Default to 4 words (128 components); grow automatically in 32-component increments
- Query matching uses word-by-word AND/OR operations — same algorithmic cost, just more words
- Provide a `maxComponents` config option on `World` for pre-allocation
- Target: 256 components default max, configurable up to 1024

**Files:** `src/core/component.ts`, `src/core/query.ts`, `src/core/world.ts`

#### 2.2 Implement change detection (MISSING-3)

**Problem:** `.changed()` is in the query API but never evaluated. This is confusing and blocks important patterns (dirty-flag rendering, incremental physics sync).

**Plan:**
- Add a per-component "generation" counter (`Uint32Array`, one entry per entity)
- When a system writes to a component via the write-access API, bump the generation for that entity+component
- `.changed(C)` queries compare current generation against the system's last-seen generation (stored per-system per-component)
- Only entities whose generation increased since the system's last run are included
- This is the same approach used by Bevy's change detection

**Files:** `src/core/component.ts` (generation arrays), `src/core/query.ts` (changed filter), `src/core/world.ts` (system tracking)

#### 2.3 Pre-registered queries to eliminate per-call allocations (F-16, 2.9, Perf-1)

**Problem:** `world.query()` creates a new `QueryDef` object and result array every call. Systems that query for secondary entity sets (e.g., "find all enemies" from within a targeting system) pay this cost every tick.

**Plan:**
- Add `world.registerQuery(queryDef)` that returns a `QueryHandle`
- `QueryHandle.entities` returns a cached, reusable `Uint32Array` view (no allocation)
- The handle is invalidated on structural changes (archetype mutation) and re-evaluated lazily
- System definitions can declare multiple queries: `{ queries: { primary: query(A, B), targets: query(Enemy, Position) } }`
- The `execute` context provides `ctx.queries.primary.entities`, `ctx.queries.targets.entities`

**Files:** `src/core/query.ts`, `src/core/world.ts`, `src/core/system.ts`

#### 2.4 Bulk entity destruction — `world.clear()` (F-01)

**Problem:** No way to destroy all entities at once. Scene/room/level transitions require manually querying every component type.

**Plan:**
- `world.clear()` — destroy all entities, reset free list, clear all component storage
- `world.destroyMatching(queryDef)` — destroy all entities matching a query (e.g., "destroy all enemies but keep the player")
- `world.clear()` does NOT reset resources (game state, scores, etc.) — only entities
- `world.reset()` — full reset including resources (for game-over restart)
- Both operations flush all deferred commands first

**Files:** `src/core/world.ts`, `src/core/entity.ts`

#### 2.5 Entity hierarchy — parent/child relationships (F-15, 2.8)

**Problem:** No parent-child relationships. Cannot attach weapons to characters, group sub-parts, or cascade destruction.

**Plan:**
- Built-in `Parent` component (single u32 entity ref) and `Children` component (dynamically-sized entity list stored in a side-table, not in SoA)
- `commands.setParent(child, parent)` / `commands.removeParent(child)`
- Destroy cascade: destroying a parent destroys all children (default). Opt-out with `OrphanOnDestroy` tag component
- `TransformPropagation` system (optional, in a plugin) computes `WorldTransform` from local `Position` + parent chain
- Entity hierarchy queries: `query(A).childOf(parent)` filter
- **Control system relevance:** Equipment hierarchies (pump → motor → bearings), piping networks

**Files:** New `src/core/hierarchy.ts`, updates to `src/core/world.ts`

#### 2.6 Entity prefabs/templates (F-14)

**Problem:** Spawning an entity requires 3-5 `addComponent()` calls. Repetitive and error-prone.

**Plan:**
- `definePrefab(name, { components: { Position: { x: 0, y: 0 }, Health: { hp: 100 } } })`
- `world.spawn(EnemyPrefab)` — creates entity with all declared components
- `world.spawn(EnemyPrefab, { Position: { x: 50 } })` — spawn with overrides
- Prefabs are composable: `definePrefab(name, { includes: [MovablePrefab, DamageablePrefab] })`
- **Control system relevance:** Equipment templates (standard valve, standard tank), reducing setup boilerplate

**Files:** New `src/core/prefab.ts`, updates to `src/core/world.ts`

#### 2.7 Non-numeric component field types (4.2, 2.7)

**Problem:** Components only support TypedArray-backed numeric fields. Cannot store strings, enums, or entity references with lifetime safety.

**Plan:**
- **`Types.enum`**: Backed by `Uint8Array`, with a compile-time const enum mapping. `defineComponent('Pump', { mode: Types.enum(PumpMode) })` where `PumpMode` is `{ Off: 0, Starting: 1, Running: 2, ... }`
- **`Types.entityRef`**: Backed by `Uint32Array` storing packed generational handles (not raw indices). Provides `isAlive()` check against the entity manager. Stale references return `null` on read
- **`Types.string`**: Backed by `Uint32Array` of indices into a `StringTable` (interned string pool). Suitable for names, labels, equipment IDs — not high-frequency mutation
- **`Types.bool`**: Explicit boolean type backed by `Uint8Array` with 0/1, providing `.get(eid): boolean` accessor
- All new types preserve the SoA memory layout. No heap objects in hot paths

**Files:** `src/core/component.ts` (type definitions), new `src/core/string-table.ts`, updates to `src/core/entity.ts` (handle packing for entityRef)

#### 2.8 Persistent event log (4.4)

**Problem:** The ECS event system is ephemeral (cleared each frame). Control systems need persistent audit trails; games need event replay for debugging.

**Plan:**
- `defineEvent<T>(name, { persistent: true })` — marks an event type for logging
- `EventLog` resource: append-only ring buffer with configurable capacity (default 10,000 entries)
- Each entry: `{ tick, timestamp, eventType, data }`
- `eventLog.query(eventType, { fromTick?, toTick?, last? })` — filtered retrieval
- `eventLog.export()` — serialize to JSON or binary for external analysis
- Non-persistent events (default) remain ephemeral with zero overhead — the log only captures opted-in events
- **Control system relevance:** Alarm history, operator action audit trail, interlock trip records
- **Game relevance:** Kill feed, damage log, event replay for debugging

**Files:** New `src/core/event-log.ts`, updates to `src/core/events.ts`

#### 2.9 Ergonomic PRNG access (F-08)

**Problem:** The deterministic PRNG exists but is awkward to use from systems. Users fall back to `Math.random()`.

**Plan:**
- Auto-insert the `Random` resource into every world (already partially done)
- Add `ctx.random` to the `SystemContext` — every system gets direct access without manual resource lookup
- Add `ctx.random.fork(label)` for systems that need independent sub-streams
- Dev-mode warning if `Math.random()` is detected in a system (via a lint rule or runtime monkey-patch)

**Files:** `src/core/world.ts` (system context), `src/core/random.ts`

---

### WP3: Test Suite and Build Pipeline

**Timeline:** Runs in parallel with WP1 and WP2. Every fix/feature in WP1-WP2 must include tests.

#### 3.1 Test infrastructure (MISSING-1)

**Plan:**
- Add `vitest` as the test runner (already using Vite for builds)
- Configure `vitest.config.ts` with coverage thresholds
- Target: 90% line coverage for `src/core/`

**Files:** `vitest.config.ts`, `package.json` (scripts)

#### 3.2 Core unit tests

Priority order (matching the most critical and testable pieces):

1. **EntityManager** — spawn, destroy, recycle, generation wrap, isAlive, bulk clear
2. **QueryExecutor** — required, excluded, read/write/changed, cache invalidation, pre-registered queries
3. **EventStore** — emit, read, stage flush, frame clear, overflow behavior
4. **World.tick()** — stage ordering, command flush, event visibility, determinism
5. **Random** — seed reproducibility, fork independence, distribution sanity
6. **ComponentRegistry** — define, register, ID allocation, limit enforcement
7. **SpawnBuilder** — deferred spawn, component batching, PendingEntity resolution
8. **Hierarchy** — parent/child, destroy cascade, orphan, reparenting
9. **Prefab** — instantiation, overrides, composition
10. **EventLog** — append, query, capacity, export

#### 3.3 Build pipeline (MISSING-2)

**Plan:**
- Add a library build step: `vite build --lib` outputting `dist/` with `.js` + `.d.ts`
- Configure `package.json` exports map: `"."` → `dist/index.js`, `"./types"` → `dist/index.d.ts`
- Add `prepublishOnly` script that runs tests + build
- Add `eslint` + `prettier` for style enforcement

**Files:** `vite.config.ts`, `package.json`, `.eslintrc.js`, `.prettierrc`

#### 3.4 Determinism gate test

**Plan:**
- Create a reference simulation (boids or similar) that runs N ticks
- Checksum the world state (all component arrays) after N ticks
- Assert identical checksum across: headless Node.js, browser, different JS engines
- This is the single most important integration test for a simulation engine

**Files:** New `tests/determinism.test.ts`

---

### WP4: Game Plugin Layer

**Timeline:** After WP2 core features stabilize. These are the most-requested game features.

> Note: These are already covered in detail in TODO.md Phases 2-4. This section maps findings to existing roadmap items and identifies gaps.

#### 4.1 Input system (F-04, 2.10) → `@nova/input`

- Action mapping: `defineActions({ jump: ['Space', 'GamepadA'], move: compositeAxis('ArrowLeft', 'ArrowRight') })`
- Edge detection: `justPressed`, `justReleased`, `held` — correctly integrated with the fixed timestep input buffer from WP1.3
- Gamepad support with deadzone configuration
- **Already in TODO.md** as Phase 1h. Elevate to top priority within Phase 1.

#### 4.2 Collision and spatial queries (F-03, 2.4, MISSING-5)

- Provide a minimal collision helper in core: `AABBUtil.penetration(a, b)` returning penetration vector + contact normal
- `@nova/physics-rapier` for full physics (already planned in TODO Phase 2a)
- Spatial index in core (already planned in TODO Phase 2e)
- **Gap not in TODO:** A lightweight built-in AABB collision resolver for games that don't need full Rapier physics. Add `@nova/collision` with grid-based broadphase + AABB narrowphase + one-way platform support

#### 4.3 Sprite/texture/asset pipeline (F-02, 2.2, 2.6) → `@nova/assets` + `@nova/renderer-webgpu`

- Already planned in TODO Phases 1g, 2b, 2d
- **Gap not in TODO:** A Canvas2D fallback renderer for prototyping. Add `@nova/renderer-canvas2d` as a lightweight alternative to WebGPU for 2D-only games

#### 4.4 Animation (F-05, 2.2) → `@nova/animation`

- Already planned in TODO Phase 2b
- No gaps identified

#### 4.5 Audio (F-06, 2.5) → `@nova/audio`

- Already planned in TODO Phase 2c
- No gaps identified

#### 4.6 Tilemap (F-07) → `@nova/tilemap`

- Already planned in TODO Phase 4a
- **Recommendation:** Move to Phase 2 — tilemaps are fundamental for 2D games, not an advanced feature

#### 4.7 Scene/state management (F-10, 3.3) → `@nova/core` StatePlugin

- Already planned in TODO Phase 2f
- No gaps identified

#### 4.8 Camera system (F-11)

- **Not in TODO.** Add to `@nova/renderer-*`:
  - `Camera` component with viewport, zoom, rotation
  - Follow modes: locked, smooth-follow, lerp, deadzone
  - Screen shake, bounds clamping
  - Coordinate transform utilities (world ↔ screen)

#### 4.9 UI/HUD (F-12) → `@nova/ui`

- Already planned in TODO Phase 4c
- No gaps identified

#### 4.10 Debug tooling (F-17) → `@nova/devtools`

- Already planned in TODO Phase 3a
- **Gap not in TODO:** Input recording/replay for deterministic bug reproduction. Add to `@nova/recorder`

---

### WP5: Control System Plugin Layer

**Timeline:** After WP2 core features stabilize. Can proceed in parallel with WP4.

These findings come primarily from FINDINGS_NITROGEN.md and represent features needed for industrial simulation, process control trainers, and safety-critical system modeling.

#### 5.1 Alarm management plugin → `@nova/alarms`

**Problem:** The basic threshold alarm in the nitrogen pump example lacks ISA-18.2 compliance (N-3.3, N-5.3).

**Plan:**
- `defineAlarm(name, { variable, setpoint, deadband, delay, priority, group })`
- ISA-18.2 state machine per alarm point:
  - States: `Normal`, `Active/Unacknowledged`, `Active/Acknowledged`, `Clear/Unacknowledged`
  - Transitions: `activate`, `acknowledge`, `clear`, `reset`
- Deadband/hysteresis: alarm activates at setpoint, clears at `setpoint - deadband`
- Configurable time delay before activation (confirmed alarms)
- Alarm shelving and suppression with automatic unshelve timer
- Alarm priority levels: Critical, High, Medium, Low, Diagnostic
- First-out annunciation (identifies the initiating alarm in a cascade)
- Alarm flood detection: if >N alarms activate within T seconds, suppress low-priority alarms
- `AlarmLog` built on the persistent event log from WP2.8
- `AlarmSummary` resource: counts by state and priority for dashboard rendering

**Files:** New `src/plugins/alarms/` package

#### 5.2 Safety interlock system → `@nova/interlocks`

**Problem:** Safety interlocks execute instantaneously with no time delay or voting logic (N-5.1).

**Plan:**
- `defineInterlock(name, { condition, action, delay, voting?, bypassable? })`
- Configurable confirmation delay: condition must be true for N ticks before the interlock fires
- Voting logic: `1oo1` (default), `2oo3`, `2oo2` — for redundant sensor inputs
- Bypass mode with audit trail (logs who bypassed, when, and auto-expires after configurable duration)
- Interlock state machine: `Armed` → `Timing` → `Tripped` → `Reset`
- Manual reset requirement (configurable): tripped interlocks stay tripped until operator resets
- `InterlockStatus` resource for dashboard rendering
- All state changes logged to the persistent event log

**Files:** New `src/plugins/interlocks/` package

#### 5.3 Simulation parameter tuning → `@nova/parameters`

**Problem:** Control systems need runtime-tunable setpoints, gains, and limits. Games need tunable difficulty, spawn rates, etc. Both domains need the same underlying feature.

**Plan:**
- Already in TODO as Phase 2g (`defineParameter`)
- **Addition for control systems:** Parameter grouping by equipment/subsystem (e.g., "Pump P-101 / Speed Setpoint")
- **Addition for control systems:** Parameter change audit logging
- **Addition for both:** Parameter presets with diff (show what changed between presets)
- **Addition for both:** Parameter validation with range clamping and custom validators

#### 5.4 Time-series data recording → enhanced `@nova/recorder`

**Problem:** Control system dashboards need historical data persistence and trend analysis (N-3.1).

**Plan:**
- Already in TODO as Phase 3c (`@nova/recorder`)
- **Addition for control systems:** Configurable sample decimation (record every Nth tick for long-running simulations)
- **Addition for control systems:** Named data channels (e.g., "P-101.discharge_pressure") in addition to raw component/entity recording
- **Addition for control systems:** Export to CSV with configurable column mapping and units
- **Addition for control systems:** Ring-buffer mode with configurable retention (e.g., keep last 24 hours of simulated time)

---

### WP6: Example Fixes and Documentation

**Timeline:** Ongoing, alongside all other work packages.

#### 6.1 Fix tower defense example (BUG-2)

- Use `engine.start()` instead of custom `requestAnimationFrame` loop
- Remove duplicated accumulator logic
- Demonstrate engine's `timeScale` and `getInterpolationAlpha()`

#### 6.2 Fix `applyProjectileHit` typing (DESIGN-4)

- Type the `world` parameter as `World` instead of `any`

#### 6.3 Document patterns

- "Fixed Timestep and Input" guide — explains the input buffer pattern and why per-frame flags are tricky
- "Scene Transitions" guide — `world.clear()` + resource preservation + entity re-spawning
- "Determinism Checklist" — avoid `Math.random()`, `Date.now()`, `Map` iteration order, etc.
- "Control System Patterns" — using ECS for equipment modeling, alarm management, interlock design
- "Component Limit" — document the limit and how to stay within it (tags, consolidation)

---

## Priority Matrix

Grouped by urgency and impact across both domains:

### Immediate (blocks productive use of the engine)

| Item | WP | Impact: Games | Impact: Control |
|------|----|--------------|-----------------|
| Test suite | WP3.1-3.2 | High | High |
| Build pipeline | WP3.3 | High | High |
| `commands.spawn()` deferred | WP1.1 | High | Medium |
| `world.clear()` | WP2.4 | High | Medium |
| 64-component limit | WP2.1 | High | Medium |

### High Priority (significant quality-of-life improvement)

| Item | WP | Impact: Games | Impact: Control |
|------|----|--------------|-----------------|
| Pre-registered queries | WP2.3 | High | High |
| Input system plugin | WP4.1 | High | Low |
| Entity hierarchy | WP2.5 | High | Medium |
| Entity prefabs | WP2.6 | Medium | Medium |
| Persistent event log | WP2.8 | Medium | High |
| Alarm management | WP5.1 | Low | High |
| Collision helpers | WP4.2 | High | Low |

### Medium Priority (important but not blocking)

| Item | WP | Impact: Games | Impact: Control |
|------|----|--------------|-----------------|
| Change detection | WP2.2 | Medium | Medium |
| Non-numeric component types | WP2.7 | Medium | High |
| Entity references with liveness | WP2.7 | Medium | High |
| Ergonomic PRNG | WP2.9 | Medium | Medium |
| Safety interlocks | WP5.2 | Low | High |
| Scene/state management | WP4.7 | High | Low |
| Camera system | WP4.8 | High | Low |

### Lower Priority (nice to have, can defer)

| Item | WP | Impact: Games | Impact: Control |
|------|----|--------------|-----------------|
| Query cache key fix | WP1.2 | Low | Low |
| Resource keying fix | WP1.6 | Low | Low |
| Component ID scoping | WP1.7 | Low | Low |
| Performance micro-opts | WP1.4-1.5 | Low | Low |
| read/write enforcement | MISSING-4 | Low | Low |

---

## Execution Order

```
Week 1-2:  WP3.1 (test infra) + WP1.1-1.7 (bug fixes) in parallel
Week 3-4:  WP2.1-2.4 (component limit, change detection, queries, world.clear)
Week 5-6:  WP2.5-2.9 (hierarchy, prefabs, types, event log, PRNG)
Week 7-8:  WP3.2-3.4 (full test coverage, build pipeline, determinism gate)
Week 9+:   WP4 + WP5 in parallel (game plugins + control system plugins)
Ongoing:   WP6 (examples and docs) alongside all other work
```

Each WP1/WP2 item must include unit tests (WP3.2) before merging. The determinism gate (WP3.4) runs in CI against every PR.

---

## Relationship to Existing TODO.md

This plan does NOT replace TODO.md. It supplements it by:

1. **Adding concrete fixes** for bugs found in the four FINDINGS reviews (WP1)
2. **Prioritizing core features** that were in TODO but validated as urgent by real-world usage (WP2)
3. **Adding a control system plugin layer** not present in TODO (WP5)
4. **Identifying gaps** in the existing roadmap (Canvas2D renderer, camera system, lightweight collision, input recording)
5. **Proposing tilemap promotion** from Phase 4 to Phase 2

Items already fully covered in TODO.md (rendering, physics, animation, audio, assets, networking, workers, devtools, packaging) are referenced but not re-specified here.
