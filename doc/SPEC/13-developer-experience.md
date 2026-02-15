# 11. Developer Experience

## Hot Module Replacement

The Vite plugin enables HMR for game code:
- **System hot reload.** Change a system's `execute` function → the running game swaps it in without losing world state.
- **Component schema changes.** Adding a field to a component triggers a world migration — existing entities get default values for the new field.
- **Asset hot reload.** Change a PNG on disk → the texture updates on screen.
- **Scene hot reload.** Edit a `.nova.json` scene file → entities are diffed and patched in-place without restarting.  These need to include the version number of the engine they were created with.

## Devtools Panel

The devtools panel is an HTML overlay activated with a keybind (`` ` `` by default) or launched in a separate window.

**Entity Inspector:**
- Searchable entity list with component filters
- Click an entity to view/edit all its components
- Highlight the selected entity on the game canvas
- Create/destroy entities from the inspector

**System Profiler:**
- Per-system execution time as a rolling graph
- Stage and batch timeline: shows execution order, per-system duration, and per-batch wall time
- Dependency graph visualization: which systems are independent, serialization edges between batches
- Frame time breakdown: input, fixed update, render
- Alert when frame budget is exceeded

**Physics Debug:**
- Toggle collider shape rendering
- Show contact points and normals
- Show AABB tree
- Pause/step physics simulation

**Network Inspector** (when `@nova/net` is active):
- Bandwidth graph (bytes sent/received per second)
- Snapshot diff viewer
- Simulated latency/jitter/packet loss controls

## CLI

```bash
npx nova create my-game              # scaffold a new project
npx nova add physics-rapier          # add a package
npx nova dev                         # start dev server with HMR + visual editor
npx nova build                       # production build (tree-shaken, devtools stripped)
npx nova export                      # export for web (default)
npx nova export --target web         # static build for self-hosting
npx nova export --target web --pwa   # + service worker + manifest (installable, offline)
npx nova export --target web --zip   # .zip for itch.io upload
npx nova export --target local       # standalone .exe with embedded server + native bridge
```

The `export` command is detailed in [Packaging & Distribution](./18-packaging.md).
