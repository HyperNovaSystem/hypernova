# Appendix B: Comparison with Existing Frameworks

> **Note:** This comparison reflects the design specification, not current implementation status. Features listed for HyperNova are planned capabilities — not shipped features. This table serves as design rationale, showing where HyperNova intends to differentiate.

| Feature | Phaser 3 | Excalibur.js | PixiJS | HyperNova (planned) |
|---|---|---|---|---|
| Architecture | OOP/Scene | OOP/Actor | Renderer only | ECS |
| TypeScript | Retrofitted | Native | Native | Native (strict) |
| Renderer | WebGL1 | WebGL2/Canvas | WebGL2 | WebGPU + WebGL2 |
| Physics | Arcade/Matter | Arcade | None | Rapier2D (WASM) |
| Bundle (core) | ~1 MB | ~300 KB | ~200 KB | < 25 KB |
| Tree-shakeable | Partial | Yes | Yes | Yes |
| Headless mode | No | No | No | Yes (Node.js / CI) |
| Time control | No | No | N/A | Pause / slow-mo / fast-forward |
| Deterministic PRNG | No | No | N/A | Seeded xoshiro256** |
| Scene/Prefab | JSON scenes | Built-in | None | `.nova.json` + prefabs |
| Animation | Built-in | Built-in | None | Sprite, tween, state machine |
| In-game UI | DOM-based | Built-in | None | ECS-driven |
| Visual Editor | None | None | None | Built-in (in-line editing) |
| Networking | None | None | None | Primitives |
| Data recording | None | None | None | Time-series + CSV export |
| Compute shaders | None | None | None | WebGPU compute pipeline |
| System Scheduling | None | None | None | Dependency-graph batching |
| Background Workers | None | None | None | Web Worker pool + services |
| Devtools | Plugin | Built-in | Plugin | Built-in + parameter panel |
| Deterministic | No | No | N/A | Yes |
| Electron target | No | No | No | Yes |
