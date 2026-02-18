# 11. Developer Experience

## Hot Module Replacement

The Vite plugin enables HMR for simulation code:
- **System hot reload.** Change a system's `execute` function → the running simulation swaps it in without losing world state.
- **Component schema changes.** Adding a field to a component triggers a world migration — existing entities get default values for the new field.
- **Asset hot reload.** Change a PNG on disk → the texture updates on screen.
- **Scene hot reload.** Edit a `.nova.json` scene file → entities are diffed and patched in-place without restarting. These need to include the version number of the engine they were created with.
- **Parameter hot reload.** Change a `defineParameter()` default or range → the parameter panel updates live.

## Devtools Panel

The devtools panel is an HTML overlay activated with a keybind (`` ` `` by default) or launched in a separate window.

**Entity Inspector:**
- Searchable entity list with component filters
- Click an entity to view/edit all its components
- Highlight the selected entity on the simulation canvas
- Create/destroy entities from the inspector

**System Profiler:**
- Per-system execution time as a rolling graph
- Stage and batch timeline: shows execution order, per-system duration, and per-batch wall time
- Dependency graph visualization: which systems are independent, serialization edges between batches
- Frame time breakdown: input, fixed update, render
- Alert when frame budget is exceeded

**Parameter Panel:**
- Auto-generated sliders, inputs, and color pickers from `defineParameter()` metadata
- Grouped by category (`group` field)
- Range-constrained with configurable step size
- Preset save/load — save current parameter values as a named JSON preset, load presets to switch configurations instantly
- Real-time updates — changing a parameter immediately affects the next simulation tick

**Physics Debug:**
- Toggle collider shape rendering
- Show contact points and normals
- Show AABB tree
- Pause/step physics simulation

**Recording Controls** (when `@nova/recorder` is active):
- Start/stop recording
- Timeline scrub bar for playback
- Frame-by-frame stepping through recorded data
- CSV export button

**Network Inspector** (when `@nova/net` is active):
- Bandwidth graph (bytes sent/received per second)
- Snapshot diff viewer
- Simulated latency/jitter/packet loss controls

## Headless Testing

Since the engine supports headless mode, simulation logic can be tested without a browser:

```bash
npx vitest                           # run unit tests for systems in Node.js
npx nova test --headless             # run a simulation scenario headlessly, assert outcomes
```

Systems are pure functions of component data — they can be tested in isolation by creating a headless `Engine`, spawning test entities, ticking, and asserting state.

## CLI

```bash
npx nova create my-project           # scaffold with template selection (game, simulation, visualization)
npx nova add physics-rapier          # add a package
npx nova dev                         # start dev server with HMR + devtools + parameter panel
npx nova build                       # production build (tree-shaken, devtools stripped)
npx nova export                      # export for web (default)
npx nova export --target web         # static build for self-hosting
npx nova export --target web --pwa   # + service worker + manifest (installable, offline)
npx nova export --target web --zip   # .zip for itch.io upload
npx nova export --target electron    # Electron desktop app (.dmg, .exe, .AppImage)
npx nova export --target local       # standalone .exe with embedded server + native bridge
```

The `export` command is detailed in [Packaging & Distribution](./18-packaging.md).
