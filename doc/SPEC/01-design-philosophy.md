# 1. Design Philosophy

HyperNova is designed around three core principles:

- **Composition over inheritance.** Game objects are assembled from small, reusable data components — not deep class hierarchies. Behavior emerges from systems that operate on component data.
- **Ship only what you use.** The engine is a collection of focused packages. The core is tiny. Everything else — physics, audio, tilemaps, networking — is opt-in. Tree-shaking works because the architecture demands it.
- **Developer experience is a feature.** Hot reload, visual inspectors, type safety, and fast iteration loops are not afterthoughts. They are load-bearing parts of the design.
