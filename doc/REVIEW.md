# HyperNova Engine — Architecture Review

## Review Pass 1 — Architectural Contradictions (Historical)

All items from the original review are preserved below for traceability. Status tags indicate resolution.

### Architectural Contradictions

**1. Entity ID vs. SoA Access Pattern — Fundamental Design Conflict**
Severity: Critical — **RESOLVED: adopted global SoA (column-per-field) with archetype query resolution**

The spec contained a fundamental contradiction between its two core storage claims. Resolved by choosing global SoA (bitecs-style): `Position.x[eid]` works directly, archetypes are bitmasks for query resolution only, not storage containers.

**2. Entity ID Bit Packing**
Severity: High — **RESOLVED: u32 index for array access, generation stored separately in Uint16Array, handle packing via `(gen << 20) | index`**

### API Inconsistencies

**3. Three Different Event APIs**
Severity: Medium — **RESOLVED: unified `defineEvent<T>()` type tokens with pull-based `events.read()` / `events.emit()`**

**4. Three Different Resource Access Patterns**
Severity: Medium — **RESOLVED: type-token keyed via `resources.get(Token)` everywhere**

**5. Stage Set Varies Across Sections**
Severity: Low — **RESOLVED: canonical ordering documented in §17.5**

### Gaps (Underspecified or Missing)

**6. String Component Types in SoA Storage**
Severity: High — **RESOLVED: string interning via global StringTable**

**7. Arena Fallback Invalidates All Views**
Severity: High — **MITIGATED: column arrays allocated once at startup, resize only triggered by late defineComponent()**

**8. Plugin API**
Severity: High — **RESOLVED** — See SPEC.md §17.

**9. Error Handling Strategy**
Severity: Medium — **RESOLVED** — See SPEC.md §18.

**10. Save/Load Game Strategy**
Severity: Medium — **RESOLVED** — `@nova/persist` added.

**11. Scene File Format Versioning**
Severity: Medium — **RESOLVED: `engineVersion` field with migration transforms**

**12. Prefab Composition/Inheritance**
Severity: Low — **RESOLVED: `extends` + `includes` with deterministic merge semantics**

**13. Render Order Management**
Severity: Low — **RESOLVED: `RenderOrder` component with `layer: Types.i32`**

**14. State System vs. Global Systems Interaction**
Severity: Medium — **RESOLVED: resource-guard model**

### Performance Concerns

**15. Archetype Fragmentation**
Severity: High — **ELIMINATED: archetypes are bitmasks, not storage containers**

**16. Spatial Index Staleness**
Severity: High — **RESOLVED: dedicated `spatial` stage after `physics`**

**17. Change Detection Overhead**
Severity: Medium — **RESOLVED: double-buffered snapshot comparison**

**18. Zero-Allocation Claim vs. Event Objects**
Severity: Medium — **RESOLVED: pre-allocated ring buffers**

**19. Query Overhead**
Severity: Medium — **SIMPLIFIED: bitmask matching, no archetype table iteration**

**20. Transform Propagation for Deep Hierarchies**
Severity: Low — **OPEN: address during implementation**

**21. Tilemap "Single Draw Call" Claim**
Severity: Low — **OPEN: clarify frustum culling during @nova/tilemap implementation**

### Minor Issues (22–25)
All resolved or deferred. See original review text in git history.

---

## Review Pass 2 — Inconsistencies, Over-Engineering, Gaps (Historical)

All A1–A8 inconsistencies resolved. B1–B6 over-engineering addressed via phasing. C1–C8 gaps filled. See git history for details.

---

## Review Pass 3 — Critical Evaluation for Simulation Builder / Game Engine

*Focus: evaluating the SPEC against the goal of a highly capable simulation builder for browser-based or Electron-based applications.*

The SPEC is strong as a 2D game engine design document. The ECS architecture is sound, the plugin system is well-composed, the error handling is thorough, and the phased delivery strategy is reasonable. However, several structural gaps and framing issues prevent it from being a capable *simulation builder* — a tool for constructing interactive simulations that happen to include games as a use case.

### S1. Identity Crisis: "2D Game Engine" vs. "Simulation Builder"
Severity: **High — Structural**

The SPEC is framed exclusively as a "2D game engine." Every example is a game (platformers, bullet hells). Every decision is justified against game workloads. This framing excludes large classes of simulation that would run in a browser or Electron:

- Agent-based models (epidemiology, traffic, ecology)
- Training environments (RL agents, evolved behaviors)
- Interactive data visualizations with simulated dynamics
- Physics sandboxes and engineering simulators
- Digital twins (factory floors, logistics, IoT)
- Educational simulations (chemistry, astronomy, economics)

The ECS core is actually dimension- and domain-agnostic — the limitation is not architectural but in how the SPEC frames and constrains it. The fix is not to remove game features but to generalize the framing and add simulation-critical capabilities that games also benefit from.

**Resolution:** Reframe HyperNova as "a modular, ECS-first simulation engine for the modern web — equally suited to games, interactive simulations, and data-driven visualizations." The core remains unchanged; the framing unlocks a wider surface.

### S2. No Headless Mode
Severity: **Critical — Missing Core Capability**

A simulation builder must support running without a renderer. Use cases:
- Automated testing of simulation logic
- Server-side authoritative simulation (multiplayer)
- Batch runs for parameter sweeps or Monte Carlo analysis
- CI/CD validation of deterministic replays
- AI training loops (thousands of headless simulation instances)

The game loop is implicitly tied to `requestAnimationFrame`. There is no documented way to run the ECS world + fixed update loop without a canvas, browser, or render pass.

**Resolution:** The core game loop must support a headless tick mode:
```typescript
const engine = new Engine({ headless: true, tickRate: 60 });
// No renderer, no canvas. Fixed update runs synchronously.
engine.tick();           // advance one fixed step
engine.tickN(100);       // advance 100 steps
engine.tickUntil(pred);  // advance until predicate returns true
```
This is primarily a game loop concern — the renderer plugin simply isn't installed. But the loop itself must not assume `requestAnimationFrame` exists. In Node.js / Electron main process / test harnesses, headless mode is essential.

### S3. No Time Control (Pause, Slow-Motion, Fast-Forward, Step)
Severity: **High — Missing Core Capability**

The `Time` resource has `dt`, `elapsed`, and `frame`, but there is no time scaling API. Games need pause menus. Simulations need slow-motion replay, fast-forward to steady state, and frame-by-frame stepping.

**Resolution:** Add `timeScale` to the `Time` resource and the engine config:
```typescript
engine.setTimeScale(0);     // paused (render continues, fixed update skipped)
engine.setTimeScale(0.5);   // slow-motion
engine.setTimeScale(2.0);   // fast-forward (capped by maxSubstepsPerFrame)
engine.setTimeScale(1.0);   // normal
engine.step();              // advance exactly one fixed step (when paused)
```
`dt` within systems remains the fixed timestep (determinism preserved). `timeScale` controls how many fixed steps run per frame. At `timeScale: 0`, the fixed update loop produces zero steps but the render loop continues — essential for pause menus that still render and animate UI.

### S4. Electron Target is Absent
Severity: **High — Missing Deployment Target**

The user explicitly wants Electron-based apps. The SPEC has "web" and "local server" (Node.js SEA) targets but no Electron target. The SEA approach is clever, but Electron provides capabilities that SEA + browser cannot:

| Capability | Node.js SEA + Browser | Electron |
|---|---|---|
| Native window chrome | No (browser chrome) | Yes (frameless, custom titlebar) |
| System tray | No | Yes |
| File system dialogs | No (browser sandboxed) | Yes (`dialog.showOpenDialog`) |
| Multi-window | No | Yes |
| Menu bar | No | Yes (native menus) |
| GPU context | Browser-mediated | Direct (Chromium) |
| Auto-update | Manual | electron-updater |
| Offline-first | Depends on localhost | Built-in |
| Binary size | ~50–75MB | ~80–120MB |

For many simulation applications (tools, editors, dashboards), Electron's native integration is essential.

**Resolution:** Add `--target electron` to `nova export`:
- Scaffold an Electron main process that loads the Vite build
- `@nova/native` communicates via Electron IPC (faster than WebSocket, no localhost server)
- Preload script exposes `contextBridge` for secure native API access
- Electron-builder or electron-forge for packaging
- Optional: Electron replaces the Node.js SEA target entirely for desktop distribution

### S5. Fixed Tick Rate Framing is Too Game-Specific
Severity: **Medium**

The SPEC defaults to 60Hz fixed timestep and frames all examples around 60 FPS gameplay. Simulations need:
- Higher rates (120Hz, 240Hz, 1000Hz) for precision physics or control systems
- Lower rates (10Hz, 30Hz) for economic models or turn-based logic
- Variable rates (adapt tick rate to simulation complexity)
- Decoupled tick rates (physics at 120Hz, AI at 10Hz, rendering at display refresh)

The SPEC *does* say the timestep is configurable, but this is mentioned in passing. Multi-rate simulation (different systems ticking at different frequencies) is not addressed.

**Resolution:** Make tick rate a first-class concept:
```typescript
const engine = new Engine({
  fixedTimestep: 1/120,     // 120Hz physics
  maxSubstepsPerFrame: 8,
});
// Future: per-stage tick rate multipliers
// engine.addStage('ai', [AISystem], { tickDivisor: 6 }); // runs every 6th fixed step
```
Per-stage tick divisors are deferred but the architecture should not preclude them.

### S6. Deterministic PRNG is Missing
Severity: **High — Missing Core Primitive**

The SPEC emphasizes determinism for networking and replays but does not specify a seeded PRNG. `Math.random()` is non-deterministic and produces different sequences across engines, platforms, and sessions. Any system that uses randomness (AI decisions, particle spawning, proc-gen, damage rolls) breaks determinism.

**Resolution:** Add a `Random` resource to `@nova/core`:
```typescript
import { Random } from '@nova/core';
const rng = resources.get(Random);
rng.float();              // [0, 1)
rng.range(1, 6);          // integer in [1, 6]
rng.vec2(magnitude);      // random unit vector * magnitude
rng.shuffle(array);       // Fisher-Yates
rng.seed(42);             // reseed (for replays)
```
Use a well-known algorithm (xoshiro256** or PCG) with a seed stored in the `Random` resource. The seed is saved/loaded with `@nova/persist` and transmitted with `@nova/net` snapshots. This is a mandatory foundation for deterministic simulation and should be Phase 1.

### S7. No Data Recording / Replay / Export
Severity: **High — Missing Simulation Capability**

The `@nova/persist` plugin handles save/load snapshots. But a simulation builder needs continuous data recording:
- Record component values over time for analysis
- Export time-series data (CSV, JSON, binary)
- Visual replay of recorded sessions (scrub timeline)
- Compare multiple runs (parameter sweeps)

The current snapshot model captures a single point in time. There is no concept of recording a stream of state deltas or sampling component values at regular intervals.

**Resolution:** Add a `@nova/recorder` plugin (Phase 3+):
```typescript
engine.addPlugin(RecorderPlugin({
  components: [Position, Health],    // what to record
  sampleRate: 10,                    // every 10th tick
  format: 'binary',                  // or 'json'
}));
// API:
recorder.start();
recorder.stop();
recorder.export();         // returns ArrayBuffer or Blob
recorder.getTimeline();    // for scrub-based replay
```
In Phase 1, the simpler capability is making the headless tick loop and `@nova/persist` snapshots sufficient for basic batch recording (snapshot every N ticks). Full timeline recording is Phase 3.

### S8. Entity Limit of ~1M is a Hard Ceiling
Severity: **Medium — Architectural Constraint**

The handle packing `(gen << 20) | index` caps entities at ~1M. For a game engine this is generous. For a simulation builder, it can be limiting:
- Particle systems as entities: 1M is reachable
- Agent-based models with fine granularity: 1M can be hit
- Cellular automata: easily exceed 1M cells

**Resolution:** Document the limit clearly and provide escape hatches:
1. GPU particles (`@nova/particles`) are NOT entities — they live in GPU buffers, unlimited count.
2. Tilemaps are NOT per-tile entities — the tilemap is a single entity with tile data in GPU buffers.
3. For simulations exceeding 1M agents, use SoA arrays directly (no entity overhead) managed by a custom system.
4. Future: configurable bit split (e.g., 24-bit index / 8-bit generation for 16M entities, fewer generations). This is a compile-time decision that changes the handle packing constant.

### S9. WebGPU Compute Pipeline is Underspecified
Severity: **Medium — Missing API Surface**

The SPEC mentions compute shaders for particles and spatial hashing but doesn't specify the developer-facing compute API. For simulation builders, GPU compute is essential:
- Fluid simulation (SPH, Eulerian)
- Large-scale agent simulation (BOIDS, flocking)
- Neural network inference (for game AI or visualization)
- Procedural generation (terrain, noise)

The renderer section specifies custom *fragment* shaders (`defineMaterial`) but not compute passes.

**Resolution:** Add a compute API to `@nova/renderer-webgpu`:
```typescript
const BoidCompute = defineCompute({
  shader: `@compute @workgroup_size(256) fn main(...) { ... }`,
  buffers: { positions: 'storage', velocities: 'storage' },
  dispatch: (count) => [Math.ceil(count / 256), 1, 1],
});

// In a system:
renderer.dispatch(BoidCompute, { positions: posBuffer, velocities: velBuffer });
renderer.readback(posBuffer, targetTypedArray);  // async GPU→CPU
```
Phase 1 doesn't need this — the renderer should expose `GPUDevice` access for advanced users. A structured compute API is Phase 4.

### S10. No Multi-World Support
Severity: **Low — Future Concern**

Simulations sometimes need multiple independent worlds:
- UI world vs. game world (separate entity spaces)
- Parallel simulation runs for comparison
- Prediction/rollback worlds for networking

The SPEC assumes a single `World` instance. The ECS core doesn't prohibit multiple worlds (each `World` has its own arena), but the `Engine` class binds to one.

**Resolution:** Defer to v2. Document that multiple `World` instances are supported at the ECS level but `Engine` manages one. For rollback, `@nova/net` can snapshot/restore a single world. For UI separation, use tag components or layer-based queries rather than separate worlds.

### S11. Event Ring Overflow Semantics Break Determinism
Severity: **Medium**

In production mode, event ring overflow silently overwrites the oldest events. For a deterministic simulation, losing events means divergent behavior between runs or between client and server.

**Resolution:** Make overflow behavior configurable per event type:
```typescript
const HighFreqEvent = defineEvent<{ value: number }>({
  capacity: 1024,
  overflow: 'grow',    // default in dev: grow buffer, log warning
                       // 'drop-oldest': production default, overwrites
                       // 'halt': halt engine (for simulation-critical events)
});
```

### S12. Comparison Table is Aspirational
Severity: **Low — Cosmetic/Honesty**

Appendix B compares HyperNova's feature list (from a spec with zero lines of implementation) against shipped, battle-tested engines. Every "yes" for HyperNova is vaporware. This is misleading.

**Resolution:** Add a disclaimer: "This comparison reflects the design specification, not current implementation status. Features listed for HyperNova are planned, not shipped." Move the table to a design rationale context rather than presenting it as a competitive comparison.

### S13. `@nova/ui` Layout Model is Underspecified
Severity: **Low**

The spec says "flexbox-inspired layout engine" but doesn't specify whether this runs as an ECS system, a separate layout pass, or a retained-mode UI tree. For simulation dashboards (charts, controls, data panels), the UI system needs to be capable enough to avoid falling back to HTML overlays.

**Resolution:** This is an open question flagged in TODO.md. Defer the design decision until Phase 4 when `@nova/ui` enters active development. For Phase 1–2, HTML overlays via `@nova/devtools` and standard DOM are sufficient.

### S14. No Configuration / Parameter Injection for Simulations
Severity: **Medium**

Simulation builders need runtime-configurable parameters: sliders that control gravity, spawn rates, AI weights, etc. The SPEC has typed resources and HMR for dev, but no concept of:
- A parameter definition API (name, type, range, default)
- A parameter panel in devtools (auto-generated sliders/inputs)
- Persisting parameter presets
- Loading parameters from external config files

**Resolution:** Add a `defineParameter` API to core:
```typescript
const Gravity = defineParameter({
  name: 'Gravity',
  type: 'f32',
  default: 400,
  range: [0, 2000],
  group: 'Physics',
});

// In a system:
const g = resources.get(Parameters).get(Gravity);

// Devtools auto-generates UI for all defined parameters
// Parameters can be saved/loaded as presets (JSON files)
```
This is essentially a typed resource with metadata for UI generation. Phase 2 for the API, Phase 3 for the devtools panel.

---

## Summary — Review Pass 3

### Strengths (Carry Forward)
- **ECS core design is dimension-agnostic** — global SoA, bitmask queries, generational IDs. Sound foundation.
- **Plugin architecture is well-composed** — clean dependency resolution, factory pattern, topological sort.
- **Error handling is thorough** — `Result<T>` at boundaries, infallible hot paths, pre-allocated singletons.
- **Fixed timestep + interpolation** — correct foundation for deterministic simulation.
- **Worker architecture** — Task/Job/Stream triple pattern with deterministic result delivery.
- **Phased delivery** — starts with core, expands outward. Avoids big-bang integration.
- **Scene/prefab system** — pragmatic JSON format with versioning and migration.

### New Gaps Identified
| ID | Issue | Severity | Resolution Phase |
|---|---|---|---|
| S1 | Identity framing too narrow | High | Phase 1 (documentation) |
| S2 | No headless mode | Critical | Phase 1 (core loop) |
| S3 | No time control | High | Phase 1 (core loop) |
| S4 | No Electron target | High | Phase 5 (packaging) |
| S5 | Tick rate framing | Medium | Phase 1 (config) |
| S6 | No deterministic PRNG | High | Phase 1 (core) |
| S7 | No data recording/export | High | Phase 3 (plugin) |
| S8 | Entity limit ~1M | Medium | Document + escape hatches |
| S9 | Compute pipeline underspec | Medium | Phase 4 (renderer) |
| S10 | No multi-world | Low | Defer to v2 |
| S11 | Event overflow breaks determinism | Medium | Phase 1 (config) |
| S12 | Comparison table aspirational | Low | Phase 1 (documentation) |
| S13 | UI layout model underspec | Low | Phase 4 |
| S14 | No parameter injection | Medium | Phase 2 (API) + Phase 3 (UI) |

### Open Questions (Remaining)
- Should the visual editor support collaborative editing?
- What's the serialization format for animation state machines?
- Should `@nova/ui` layout run as an ECS system or a separate pass?
- Should the entity handle bit split be configurable at build time?
- What's the minimum viable Electron integration (full Electron app vs. Electron as optional wrapper)?

### Verdict

The SPEC is a well-designed 2D game engine specification. To become a *simulation builder*, it needs:
1. **Headless mode and time control** (Phase 1 — these are core loop features, not add-ons)
2. **Deterministic PRNG** (Phase 1 — mandatory for any simulation claiming determinism)
3. **Electron target** (Phase 5 — packaging concern, not architectural)
4. **Reframing** (Phase 1 — documentation, not code)
5. **Data recording** (Phase 3 — builds on persist + events)
6. **Configurable parameters** (Phase 2–3 — typed resources + devtools UI)

None of these require architectural changes to the ECS core. They are capabilities layered on a sound foundation. The updated implementation plan reflects these additions.
