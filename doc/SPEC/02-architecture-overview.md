# 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Game Loop                            │
│  ┌──────────┐  ┌────────────────────────┐  ┌───────────────┐ │
│  │  Input   │  │     Fixed Update       │  │   Render      │ │
│  │  Gather  │-→│  ┌──────────────────┐  │-→│ (interpolated │ │
│  └──────────┘  │  │ Stage: pre-phys  │  │  └───────────────┘ │
│                │  │  Batch 0: A, B   │  │                    │
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
│                                                          │
│  Queries:     world.query(Position, Velocity)            │
└──────────────────────────────────────────────────────────┘
        │               │                │
        ▼               ▼                ▼
 ┌────────────┐  ┌──────────────┐  ┌──────────────┐
 │  @nova/    │  │  @nova/      │  │  @nova/      │
 │  input     │  │  physics-    │  │  renderer-   │
 │            │  │  rapier      │  │  webgpu      │
 └────────────┘  └──────────────┘  └──────────────┘
```

## Game Loop

The game loop uses a **fixed timestep with interpolated rendering**, the gold standard for deterministic simulation:

- **Input** — Polls and buffers all input events from the current frame.
- **Fixed Update** — Runs simulation logic at a constant rate (default 60 Hz).  Multiple fixed steps may run per frame if the frame budget allows, or none if the frame arrives early.  All gameplay logic, physics, and AI run here.  The accumulator is capped at `maxSubstepsPerFrame * fixedTimestep` (default: 4 steps) to prevent death spirals — excess time is dropped and the simulation slows relative to wall clock. A `BudgetExceeded` event is emitted when steps are dropped (see [Error Handling](./20-error-handling.md)).
- **Render** — Runs once per frame at display refresh rate. Interpolates between the previous and current simulation state for smooth visuals even when the simulation rate and display rate differ.
- **Output** — Not a separate stage. Haptics, sound, and other side effects are triggered by systems within the fixed update stages (typically `gameplay` or `post-physics`) to maintain synchronization with the simulation.

This separation is critical for determinism (networking, replays) and decouples visual smoothness from simulation accuracy.

## Package Boundary Rules

Packages communicate through the ECS world and well-defined interfaces. No package may import internals from another package. The dependency graph flows strictly downward:

```
@nova/core          — ECS, game loop, events, math, scenes, spatial index
  ├── @nova/input          — Keyboard, mouse, gamepad, touch
  ├── @nova/renderer-webgpu — WebGPU renderer + WebGL2 fallback
  ├── @nova/physics-rapier  — Rapier2D WASM physics
  ├── @nova/audio           — Web Audio API abstraction
  ├── @nova/assets          — Async asset pipeline
  ├── @nova/animation       — Sprite animation, tweening, state machines
  ├── @nova/tilemap         — Tilemap loading and rendering
  ├── @nova/particles       — GPU-accelerated particle systems
  ├── @nova/ui              — In-game UI (layout, widgets, interaction)
  ├── @nova/net             — Networking primitives
  ├── @nova/workers         — Background worker pool & services
  ├── @nova/native          — Native module bridge (local target only)
  └── @nova/devtools        — Inspector, profiler, visual editor
```
