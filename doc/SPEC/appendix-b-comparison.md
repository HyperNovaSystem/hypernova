# Appendix B: Comparison with Existing Frameworks

| Feature | Phaser 3 | Excalibur.js | PixiJS | HyperNova |
|---|---|---|---|---|
| Architecture | OOP/Scene | OOP/Actor | Renderer only | ECS |
| TypeScript | Retrofitted | Native | Native | Native (strict) |
| Renderer | WebGL1 | WebGL2/Canvas | WebGL2 | WebGPU + WebGL2 |
| Physics | Arcade/Matter | Arcade | None | Rapier2D (WASM) |
| Bundle (core) | ~1 MB | ~300 KB | ~200 KB | < 20 KB |
| Tree-shakeable | Partial | Yes | Yes | Yes |
| Scene/Prefab | JSON scenes | Built-in | None | `.nova.json` + prefabs |
| Animation | Built-in | Built-in | None | Sprite, tween, state machine |
| In-game UI | DOM-based | Built-in | None | ECS-driven |
| Visual Editor | None | None | None | Built-in (in-line editing) |
| Networking | None | None | None | Primitives |
| System Scheduling | None | None | None | Dependency-graph batching |
| Background Workers | None | None | None | Web Worker pool + services |
| Devtools | Plugin | Built-in | Plugin | Built-in + visual editor |
| Deterministic | No | No | N/A | Yes |
