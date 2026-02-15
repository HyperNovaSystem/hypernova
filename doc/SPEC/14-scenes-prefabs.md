# 12. Scenes, Prefabs & Serialization

## Overview

A **scene** is a declarative description of entities, their components, and their hierarchy. Scenes are stored as `.nova.json` files — human-readable, diffable, and editable by hand or by the visual editor.

A **prefab** is a reusable entity template. Scenes reference prefabs by name and may override specific fields per instance.

## Prefabs

Prefabs are defined in code and registered with the engine:

```typescript
import { definePrefab } from '@nova/core';

const CratePrefab = definePrefab('Crate', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'crate', width: 32, height: 32 },
  RigidBody: { type: 'dynamic' },
  Collider: { shape: 'box', width: 32, height: 32 },
});

// Spawn with defaults
const crate1 = world.spawn(CratePrefab);

// Spawn with overrides
const crate2 = world.spawn(CratePrefab, {
  Position: { x: 200, y: 100 },
});
```

Prefabs can include children:

```typescript
const PlayerPrefab = definePrefab('Player', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'player', width: 32, height: 32 },
  Player: {},
  children: [
    { name: 'Sword', components: {
      Position: { x: 16, y: 0 },
      Sprite: { texture: 'sword', width: 16, height: 16 },
    }},
  ],
});
```

### Prefab Inheritance (`extends`) — v1.1

> **Phasing note:** v1 ships flat prefabs with spawn-time overrides (the `definePrefab` + `world.spawn(Prefab, overrides)` pattern above). `extends` and `includes` are v1.1 features — the design is captured here for completeness, but implementation is deferred until flat prefabs prove insufficient.

### Prefab Inheritance (`extends`)

A prefab can extend exactly one base prefab, inheriting all components and children. The derived prefab overrides inherited values via shallow merge per component and may add new components. Chains are allowed.

```typescript
const EnemyPrefab = definePrefab('Enemy', {
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'enemy', width: 32, height: 32 },
  Health: { current: 100, max: 100 },
  AI: { behavior: 'patrol' },
  children: [
    { name: 'Shadow', components: {
      Sprite: { texture: 'shadow', width: 32, height: 8 },
      Position: { x: 0, y: 28 },
    }},
  ],
});

const BossEnemyPrefab = definePrefab('BossEnemy', {
  extends: EnemyPrefab,
  // Override specific fields — shallow merge per component
  Sprite: { texture: 'boss', width: 64, height: 64 },
  Health: { current: 500, max: 500 },
  // Add new components
  Boss: { phase: 1 },
  // Inherited unchanged: Position, AI, children (Shadow)
});

// Chains work — MegaBoss inherits from BossEnemy which inherits from Enemy
const MegaBossPrefab = definePrefab('MegaBoss', {
  extends: BossEnemyPrefab,
  Health: { current: 2000, max: 2000 },
  Boss: { phase: 1, enrageThreshold: 0.25 },
});
```

> Convention: inheritance chains deeper than 3 are a code smell. Prefer composition via `includes` for mixing orthogonal behaviors.

### Prefab Composition (`includes`)

A prefab can include multiple other prefabs to compose orthogonal behaviors. Included prefabs are merged left-to-right; later includes override earlier ones for conflicting fields. The defining prefab's own declarations always win.

```typescript
const DamageableMixin = definePrefab('Damageable', {
  Health: { current: 100, max: 100 },
  HitFlash: { duration: 0.1, color: '#ff0000' },
});

const LootableMixin = definePrefab('Lootable', {
  LootTable: { table: 'default', dropChance: 0.5 },
});

const AnimatedMixin = definePrefab('Animated', {
  AnimationState: { current: 'idle', speed: 1.0 },
});

const TreasureChestPrefab = definePrefab('TreasureChest', {
  includes: [DamageableMixin, LootableMixin, AnimatedMixin],
  Position: { x: 0, y: 0 },
  Sprite: { texture: 'chest', width: 32, height: 32 },
  Health: { current: 50, max: 50 },  // overrides DamageableMixin
  Collider: { shape: 'box', width: 32, height: 32 },
});
```

### Combined `extends` + `includes`

Both mechanisms can be used together:

```typescript
const SkeletonPrefab = definePrefab('Skeleton', {
  extends: EnemyPrefab,
  includes: [DamageableMixin, LootableMixin],
  Sprite: { texture: 'skeleton', width: 32, height: 32 },
  AI: { behavior: 'chase' },
  // Health from DamageableMixin overrides EnemyPrefab's Health
  // LootTable from LootableMixin
  // Position from EnemyPrefab base
  // Sprite from own declaration overrides everything
});
```

### Merge Semantics

Components are resolved via **shallow object merge per component** — matching the existing spawn-override behavior. Given components `A = { x: 1, y: 2 }` and `B = { y: 3, z: 4 }`, the merge `A + B` produces `{ x: 1, y: 3, z: 4 }`.

Layers are applied in deterministic order, each overriding the previous:

```
Layer 0:  extends chain (deepest ancestor first, resolved recursively)
Layer 1:  includes[0]
Layer 2:  includes[1]
...
Layer N:  includes[last]
Layer N+1: Own declarations (always win)
```

**Children** merge by `name` across layers using the same component-merge rule. Children without a `name` are never merged — they are always appended. New children from later layers are appended after inherited children.

**Component removal** is intentionally unsupported. A derived prefab cannot remove a component from its base or includes — this would break the "is-a" contract of `extends` and the "has-a" contract of `includes`. If an entity should not have a particular component, create a new prefab that does not extend/include the one that defines it.

**Resolution** happens once at `definePrefab()` time. The result is a flattened component map cached on the `PrefabToken`. There is no per-spawn resolution cost.

**Circular references** in `extends` chains or `includes` graphs are detected at `definePrefab()` time and throw a fatal error.

**Diamond includes** (A includes B and C, both of which include D) are allowed. D's components appear once — the leftmost occurrence establishes the baseline, and subsequent occurrences are no-ops since D is already merged.

### Spawn-Time Child Overrides

The `world.spawn()` API accepts an optional `childOverrides` key for overriding inherited children's components:

```typescript
const boss = world.spawn(BossEnemyPrefab, {
  Position: { x: 500, y: 200 },
  childOverrides: {
    'Shadow': { Sprite: { texture: 'boss-shadow', width: 64, height: 8 } },
  },
});
```

The `childOverrides` key is reserved and cannot conflict with component names (component names are PascalCase by convention; `childOverrides` is camelCase).

## Scene Files

Scene files are JSON documents that describe a collection of entities:

```json
{
  "name": "Level1",
  "engineVersion": "1.0.0",
  "entities": [
    {
      "name": "Player",
      "prefab": "Player",
      "components": {
        "Position": { "x": 400, "y": 300 }
      }
    },
    {
      "name": "Crate1",
      "prefab": "Crate",
      "components": {
        "Position": { "x": 100, "y": 200 }
      }
    },
    {
      "name": "Background",
      "components": {
        "Position": { "x": 0, "y": 0 },
        "Sprite": { "texture": "background", "width": 800, "height": 600 },
        "RenderOrder": { "layer": -10 }
      },
      "children": []
    }
  ],
  "resources": {}
}
```

**Scene versioning:** The `engineVersion` field records which engine version created the file. On load, the scene loader compares it against the current engine version. If the versions differ, any registered scene migrations run in order (oldest-first) to transform the JSON before entity spawning. Migrations are pure functions: `(sceneJson: object, fromVersion: string) => object`. In strict/pedantic error mode, a missing `engineVersion` field emits a warning. This keeps the migration system simple — no schema registry, just an ordered list of transform functions.

When a scene references a prefab, only the **overridden fields** are stored in the scene file.
This keeps scene files small and means updating a prefab definition automatically updates all instances that haven't overridden that field.

**Cascade behavior**: Overrides are computed against the **resolved** (flattened) prefab, not against any particular layer in the inheritance chain. If a base prefab changes a default value, all scene instances whose overrides do not explicitly set that field will pick up the new value automatically.

Scene entities may include `childOverrides` to override component values on inherited children without redefining the entire child hierarchy:

```json
{
  "name": "MyBoss",
  "prefab": "BossEnemy",
  "components": {
    "Position": { "x": 500, "y": 200 }
  },
  "childOverrides": {
    "Shadow": {
      "components": {
        "Sprite": { "texture": "boss-shadow", "width": 64, "height": 8 }
      }
    }
  }
}
```

## Scene Loading

```typescript
import { loadScene, unloadScene } from '@nova/core';

// Load a scene — spawns all entities, returns handles
const level = await loadScene(engine, 'assets/scenes/level1.nova.json');

// Access named entities
const player = level.getEntity('Player');

// Unload — destroys all entities from this scene
unloadScene(engine, level);
```

## ECS Integration

Scenes add metadata components to spawned entities:

```typescript
// Automatically added to scene-spawned entities
const Name = defineComponent({ value: Types.string });
const SceneEntity = defineComponent({
  sceneId: Types.string,    // which scene file
  entityIndex: Types.u32,   // index within the scene
});
const PrefabInstance = defineComponent({
  prefabId: Types.string,   // concrete prefab name (e.g. 'BossEnemy', not the chain)
});
```

`PrefabInstance.prefabId` stores the **concrete** prefab name only. Inheritance lineage is a definition-time concern resolved before spawning. The editor and tooling can look up the full chain from the prefab registry via `PrefabToken.base` and `PrefabToken.includes`.

The `EditorOnly` tag component marks entities that exist only in development mode and are stripped from production builds.
