# 13. Visual Editor (In-Line Editing)

> **Phasing note:** The visual editor is Phase 3 scope. v1 ships with a basic entity inspector (view/edit component values in real-time) and system profiler as part of `@nova/devtools`. The full visual editor with round-trip file persistence, viewport gizmos, and prefab editing is a Phase 3 deliverable. The design below captures the full vision.

## Design Goal

**Projects built with HyperNova can be edited in code OR via a visual UI.** The visual editor is not a separate application — it's a mode of `@nova/devtools` that runs alongside the game during development. Changes flow bidirectionally: edits in the visual editor write to scene files on disk, and edits to scene files in a code editor update the running game via HMR.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│  Code Editor │ ◄───────────────► │  Vite Dev Server  │
│  (VS Code)   │   file watch       │  @nova/vite-plugin│
└──────────────┘                   └────────┬─────────┘
                                            │ HMR
                                            ▼
┌──────────────────────────────────────────────────────┐
│                 Browser                               │
│  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │  Game Canvas        │  │  Visual Editor Panels   │ │
│  │  + Viewport Gizmos  │  │  (HTML overlay)         │ │
│  │                     │  │                          │ │
│  │  [translate] [rotate│  │  Scene Hierarchy         │ │
│  │   scale handles]    │  │  Inspector               │ │
│  │                     │  │  Prefab Editor           │ │
│  └─────────┬──────────┘  │  Asset Browser            │ │
│            │              └────────────┬─────────────┘ │
│            │  ECS read/write           │               │
│            ▼                           ▼               │
│  ┌──────────────────────────────────────────────────┐ │
│  │            Live ECS World                         │ │
│  └──────────────────────┬───────────────────────────┘ │
│                         │ persist                      │
│                         ▼                              │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Scene Files (.nova.json) — written via dev server│ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## What's Editable via UI vs Code-Only

| Editable in Visual Editor | Code-Only |
|---|---|
| Entity creation, destruction, hierarchy | System logic (`execute` functions) |
| Component values (position, size, color...) | Custom component schemas (`defineComponent`) |
| Prefab instantiation + override editing | Query construction |
| Scene composition (place entities in world) | Plugin configuration |
| Tilemap painting | Shader code |
| Physics collider shape tweaking | Worker task/job/stream handlers |
| Sprite and animation assignment | Networking logic |
| Input action binding | |

**Principle:** data is editable via UI, logic is code-only. The editor never generates or modifies TypeScript source files.

## Editor Panels

**Scene Hierarchy:**
- Tree view of all entities, grouped by scene and prefab origin
- Drag-and-drop reparenting (changes `Parent` component)
- Right-click context menu: create entity, add component, duplicate, delete
- Search/filter by component type or entity name
- Multi-select for bulk operations (move, delete, reparent)

**Inspector** (the core of in-line editing):
- Select an entity → see all its components as editable form fields
- Type-specific field editors generated from component schemas:

| Component Type | Editor Widget |
|---|---|
| `Types.f32` / `Types.i32` | Number input with drag-to-scrub |
| `Vec2` | XY inputs + draggable gizmo on canvas |
| `Color` | Color picker with hex/RGBA input |
| `Types.bool` | Checkbox |
| `Types.string` | Text field |
| `Enum` / tag union | Dropdown selector |
| Texture / asset ref | Asset picker with preview thumbnail |

- Changes apply immediately to the live ECS world (no "apply" button)
- "Reset to prefab default" per-field when the entity is a prefab instance (resets to the resolved default, considering the full inheritance chain)
- **Lineage breadcrumb**: when inspecting a prefab instance, show the inheritance chain (e.g. `Enemy > BossEnemy`) with clickable links to navigate to parent prefab definitions
- **Field provenance**: each component field indicates its source layer — *inherited* (dimmed), *own* (normal), or *overridden* (bold, with reset icon)
- Add/remove component buttons

**Viewport Gizmos:**
- Translate, rotate, and scale handles rendered on the game canvas over the selected entity
- Snap-to-grid with configurable grid size (hold Shift for fine control)
- Multi-entity selection with bounding box
- Gizmos are rendered in a separate overlay pass — they don't affect game rendering

**Prefab Editor:**
- Create a prefab from any entity or selection of entities
- Edit prefab defaults — all non-overridden instances update live
- Override tracking: fields that differ from the prefab are marked with a visual indicator
- "Apply to prefab" button to push instance overrides back to the prefab definition
- **Lineage view**: display the `extends` chain and `includes` list for the selected prefab
- **Effective component table**: show all components on the resolved prefab with source annotations (which layer each field originates from)
- Children inherited from a base are visually distinguished from children defined directly on the prefab

## Round-Trip Persistence

The core challenge: how do visual edits become files the developer commits to source control?

**Solution:** Scene files (`.nova.json`) are the persistence layer. The visual editor writes to them, and they are the single source of truth for entity data.

1. **UI → Disk:** When the developer modifies a value in the inspector or drags an entity in the viewport, the editor sends the change to the Vite dev server via WebSocket. The dev server applies a JSON patch to the corresponding `.nova.json` file on disk.

2. **Disk → UI:** The Vite dev server watches `.nova.json` files via `chokidar`. When a file changes (from the code editor or external tooling), it pushes the update to the browser via HMR. The scene loader diffs the old and new scene data and patches the live ECS world — no full reload needed.

3. **Conflict handling:** Last-write-wins with an undo stack. External file changes trigger a "scene updated externally" toast in the editor. The undo stack tracks editor operations, not file states, so Ctrl+Z works intuitively.

4. **What's NOT persisted to scene files:** Runtime-only state (particle positions, physics velocities, animation playback state). Only initial/default component values are stored.

## Activation

```typescript
// In engine config
const engine = new Engine({
  width: 800,
  height: 600,
  editor: true,              // enables visual editor panels + scene persistence
  maxSubstepsPerFrame: 4,    // cap fixed update accumulator (see Error Handling)
  errorMode: 'dev',           // 'dev' | 'production' (see Error Handling)
});

// Or via URL parameter:  ?editor=true
// Or via the devtools console:  engine.enableEditor()
```

The visual editor is part of `@nova/devtools` and is completely tree-shaken from production builds.
