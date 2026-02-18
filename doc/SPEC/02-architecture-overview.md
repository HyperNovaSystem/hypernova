# 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Simulation Loop                         │
│  ┌──────────┐  ┌────────────────────────┐  ┌───────────────┐ │
│  │  Input   │  │     Fixed Update       │  │   Render      │ │
│  │  Gather  │-→│  ┌──────────────────┐  │-→│ (interpolated,│ │
│  │(optional)│  │  │ Stage: pre-phys  │  │  │   optional)   │ │
│  └──────────┘  │  │  Batch 0: A, B   │  │  └───────────────┘ │
│                │  │  Batch 1: C      │  │                    │
│                │  └──────────────────┘  │                    │
│                │  ┌──────────────────┐  │                    │
│                │  │ Stage: physics   │  │                    │
│                │  │  ... next stage  │  │                    │
│                │  └──────────────────┘  │                    │
│                └────────────────────────┘                    │
└──────────────────────────────────────────────────────────────┘
        │               │                        │
        ▼               ▼                        ▼
┌──────────────────────────────────────────────────────────┐
│                        ECS World                         │
│                                                          │
│  Entities:    [0, 1, 2, 3, 4, ...]                       │
│  Components:  Position | Velocity | Sprite | ...  (SoA)  │
│  Systems:     MovementSystem → PhysicsSystem → ...       │
│  Resources:   Time | Random | Parameters | ...           │
│                                                          │
│  Queries:     world.query(Position, Velocity)            │
└──────────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
 ┌────────────┐  ┌──────────────┐  ┌──────────────┐
 │  @nova/    │  │  @nova/      │  │  @nova/      │
 │  input     │  │  physics-    │  │  renderer-   │
 │ (optional) │  │  rapier      │  │  webgpu      │
 └────────────┘  └──────────────┘  │ (optional)   │
                                   └──────────────┘
```

## Simulation Loop

The simulation loop uses a **fixed timestep with optional interpolated rendering**, the gold standard for deterministic simulation:

- **Input** (optional) — When `@nova/input` is installed, polls and buffers all input events from the current frame. Skipped in headless mode.
- **Fixed Update** — Runs simulation logic at a constant rate (configurable, default 60 Hz). Multiple fixed steps may run per frame if the frame budget allows, or none if the frame arrives early. All gameplay logic, physics, and AI run here. The accumulator is capped at `maxSubstepsPerFrame * fixedTimestep` (default: 4 steps) to prevent death spirals — excess time is dropped and the simulation slows relative to wall clock. A `BudgetExceeded` event is emitted when steps are dropped (see [Error Handling](./20-error-handling.md)).
- **Render** (optional) — When `@nova/renderer-webgpu` is installed, runs once per frame at display refresh rate. Interpolates between the previous and current simulation state for smooth visuals even when the simulation rate and display rate differ. Skipped entirely in headless mode.
- **Output** — Not a separate stage. Haptics, sound, and other side effects are triggered by systems within the fixed update stages (typically `gameplay` or `post-physics`) to maintain synchronization with the simulation.

This separation is critical for determinism (networking, replays, batch simulation runs) and decouples visual smoothness from simulation accuracy.

## Headless Mode

The simulation loop supports running without a renderer, canvas, or browser. This is essential for:
- **Automated testing** — run simulation logic in Node.js / CI without a GPU
- **Server-side simulation** — authoritative multiplayer servers
- **Batch runs** — parameter sweeps, Monte Carlo analysis, AI training
- **Deterministic replay validation** — compare headless output across platforms

```typescript
const engine = new Engine({ headless: true, fixedTimestep: 1/60 });
engine.addPlugin(PhysicsPlugin({ gravity: { x: 0, y: 400 } }));
// No renderer, no canvas. Plugins that require a GPU are skipped.

engine.tick();              // advance one fixed step synchronously
engine.tickN(1000);         // advance 1000 steps
engine.tickUntil(() =>      // advance until predicate returns true
  Health.current[boss] <= 0
);
```

In headless mode:
- `requestAnimationFrame` is not used. The loop is driven by explicit `tick()` calls.
- The `Time` resource updates normally (`dt`, `elapsed`, `frame` all advance).
- Events, commands, and stage flushes execute identically to rendered mode.
- Plugins that require a GPU (renderer, particles) gracefully no-op when `headless: true`.

Game code does not need to know whether it is running headless. The ECS world, systems, and simulation behave identically in both modes.

## Time Control

The engine provides time scaling for pause, slow-motion, fast-forward, and frame stepping:

```typescript
engine.setTimeScale(0);     // paused — render continues, fixed update produces zero steps
engine.setTimeScale(0.5);   // slow-motion — half as many fixed steps per frame
engine.setTimeScale(2.0);   // fast-forward — twice as many steps (capped by maxSubstepsPerFrame)
engine.setTimeScale(1.0);   // normal

engine.step();              // advance exactly one fixed step (works at any timeScale, including 0)
```

**Determinism is preserved.** `dt` within systems is always the fixed timestep — it does not change with `timeScale`. Time scaling only affects how many fixed steps the accumulator produces per frame. A simulation run at 2x produces the same state sequence as one run at 1x — it just gets there faster in wall-clock time.

The `Time` resource exposes:

```typescript
interface TimeResource {
  readonly dt: number;        // fixed timestep (e.g. 1/60) — never changes
  readonly elapsed: number;   // total simulation time (sum of all dt)
  readonly frame: number;     // simulation tick count
  readonly timeScale: number; // current time scale (0 = paused)
  readonly wallTime: number;  // real wall-clock time since engine.start()
}
```

## Package Boundary Rules

Packages communicate through the ECS world and well-defined interfaces. No package may import internals from another package. The dependency graph flows strictly downward:

```
@nova/core          — ECS, simulation loop, events, math, scenes, spatial index, PRNG, parameters
  ├── @nova/input          — Keyboard, mouse, gamepad, touch
  ├── @nova/renderer-webgpu — WebGPU renderer + WebGL2 fallback + compute pipeline
  ├── @nova/physics-rapier  — Rapier2D WASM physics
  ├── @nova/audio           — Web Audio API abstraction
  ├── @nova/assets          — Async asset pipeline
  ├── @nova/animation       — Sprite animation, tweening, state machines
  ├── @nova/tilemap         — Tilemap loading and rendering
  ├── @nova/particles       — GPU-accelerated particle systems
  ├── @nova/ui              — In-game UI (layout, widgets, interaction)
  ├── @nova/net             — Networking primitives
  ├── @nova/recorder        — Time-series data recording and replay
  ├── @nova/workers         — Background worker pool & services
  ├── @nova/persist         — Save/load snapshots
  ├── @nova/native          — Native module bridge (Electron/local target only)
  └── @nova/devtools        — Inspector, profiler, parameter panel, visual editor
```
