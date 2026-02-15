# 9.5 Persistent State — `@nova/persist`

## Overview

Save/load in HyperNova exploits the SoA arena: all component data is already contiguous typed arrays.
No per-entity traversal, no serialization.

`@nova/persist` is an opt-in plugin that provides save/load via bulk typed array snapshots stored in IndexedDB (web) or the filesystem (local target).

## Core Design

**Save** = copy each persistent component's typed array into a snapshot blob. For a game with 20 component fields and 50K entities: 20 bulk copies, not 50K entity walks.

**Load** = restore snapshot blobs into the arena's typed arrays + invalidate query caches.

```typescript
// Save
persist.save('checkpoint-3');
// Internally: for each persistent column → typedArray.slice() → store blob
// Emit SaveCompleted event when done

// Load
persist.load('checkpoint-3');
// Internally: pause loop → bulk restore blobs → invalidate queries → resume
// Emit LoadCompleted event
```

## Component Persistence Control

Components persist by default. Opt out per-component:

```typescript
const Position = defineComponent({ x: Types.f32, y: Types.f32 });           // persists
const ParticleVelocity = defineComponent(
  { x: Types.f32, y: Types.f32 },
  { persist: false }                                                         // transient
);
```

Resources do **not** persist by default. Opt in via plugin config.

## Public API

```typescript
interface PersistStore {
  save(name: string, metadata?: Record<string, unknown>): void;
  load(name: string): void;
  quickSave(): void;
  quickLoad(): void;
  listSnapshots(): SnapshotInfo[];
  deleteSnapshot(name: string): void;
}
```

## Storage Backend

| Target | Backend | Notes |
|--------|---------|-------|
| Web | IndexedDB | Blob storage, works everywhere |
| Local (Node.js) | Filesystem (JSON + binary blobs) | Simple file-based snapshots |
| Testing | In-memory | No persistence, fast tests |

## Plugin Configuration

```typescript
engine.addPlugin(PersistPlugin({
  dbName: 'my-game',
  exclude: [ParticleVelocity, DebugOverlay],
  resources: [GameState, QuestLog],
  maxSnapshots: 100,
}));
```

## Events

```typescript
const SaveCompleted = defineEvent<{ name: string; tick: number; durationMs: number }>();
const LoadCompleted = defineEvent<{ name: string; tick: number; durationMs: number }>();
```

## Future (v2+)

The following capabilities are deferred to after the core engine is proven:
- **SQLite-backed continuous mirroring** — background sync of dirty columns to SQLite BLOBs for crash recovery
- **Cloud saves** — via Turso embedded replicas or similar
- **Time-travel debugging** — per-tick delta logging for stepping backwards in devtools
- **Editor undo/redo** — micro-snapshots of modified columns

The memcpy-to-BLOB design insight (one SQL row per column, not per entity) remains the intended migration path when continuous mirroring is needed.
