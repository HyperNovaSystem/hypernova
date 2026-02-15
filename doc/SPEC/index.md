# HyperNova Engine — A Modern TypeScript Game Engine

> A modular, ECS-first, WebGPU-powered 2D game engine built for the modern web.

---

## Table of Contents

### Core Design

1. [Design Philosophy](./01-design-philosophy.md) — Composition over inheritance, ship only what you use, DX as a feature
2. [Architecture Overview](./02-architecture-overview.md) — Game loop, package boundary rules, dependency graph

### Engine Core

3. [ECS-First Architecture](./03-ecs-architecture.md) — Entities, components, systems, queries, scheduling, resources, hierarchy
4. [Modular Package System](./04-package-system.md) — `@nova/core`, renderer, physics, input, audio, assets, tilemap, particles, animation, UI, net, devtools

### Rendering & Type System

5. [Renderer — WebGPU First](./05-renderer.md) — WebGPU, fallback strategy, render pipeline, custom materials
6. [TypeScript From the Ground Up](./06-typescript.md) — Type safety, events, generic components, build tooling

### Simulation

7. [Physics — Rapier2D (WASM)](./07-physics.md) — Why Rapier, configuration, collision events
8. [Async Asset Pipeline](./08-asset-pipeline.md) — Loading lifecycle, progressive loading, dev mode hot reload

### Multiplayer & Persistence

9. [Networking Primitives](./09-networking.md) — Architecture patterns, snapshot serialization, clock sync
10. [Persistent State](./10-persistent-state.md) — `@nova/persist`, save/load, storage backends

### Concurrency & Native Access

11. [Background Workers](./11-background-workers.md) — Tasks, jobs, streams, ECS integration, data transfer
12. [Native Module Bridge](./12-native-bridge.md) — `@nova/native`, design sketch (future)

### Authoring & DX

13. [Developer Experience](./13-developer-experience.md) — HMR, devtools panel, CLI
14. [Scenes, Prefabs & Serialization](./14-scenes-prefabs.md) — Prefabs, inheritance, scene files, ECS integration
15. [Visual Editor](./15-visual-editor.md) — In-line editing, architecture, round-trip persistence

### Runtime

16. [Game States & Scene Transitions](./16-game-states.md) — State machine, resource guard pattern, transitions
17. [Performance Discipline](./17-performance.md) — Zero allocations per frame, spatial indexing
18. [Packaging & Distribution](./18-packaging.md) — Web target, local server target, export configuration

### Engine Framework

19. [Plugin System](./19-plugin-system.md) — Plugin interface, EngineBuilder, dependencies, composition
20. [Error Handling](./20-error-handling.md) — Result type, error codes, severity, diagnostics

### Appendices

- [Appendix A: Minimal Example](./appendix-a-examples.md) — Code-based and scene-based bootstrap
- [Appendix B: Comparison with Existing Frameworks](./appendix-b-comparison.md)
- [Appendix C: Target Performance Budgets](./appendix-c-performance-budgets.md)
- [Appendix D: Future — Parallel System Execution](./appendix-d-parallel-execution.md)

---

*HyperNova* is a working title.
This spec is a living document and will evolve as implementation reveals constraints and opportunities.
