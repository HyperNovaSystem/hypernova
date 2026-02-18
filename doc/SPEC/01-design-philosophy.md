# 1. Design Philosophy

HyperNova is designed around four core principles:

- **Simulation-first, game-capable.** The core engine is a deterministic simulation loop with an ECS world. Rendering, input, and audio are optional plugins. A simulation runs identically headless in Node.js and rendered in a browser. Games are simulations with a renderer attached — not the other way around.
- **Composition over inheritance.** Simulation objects are assembled from small, reusable data components — not deep class hierarchies. Behavior emerges from systems that operate on component data.
- **Ship only what you use.** The engine is a collection of focused packages. The core is tiny. Everything else — physics, audio, tilemaps, networking, rendering — is opt-in. Tree-shaking works because the architecture demands it.
- **Developer experience is a feature.** Hot reload, visual inspectors, type safety, parameter tuning panels, and fast iteration loops are not afterthoughts. They are load-bearing parts of the design.
