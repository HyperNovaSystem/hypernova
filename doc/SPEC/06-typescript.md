# 6. TypeScript From the Ground Up

## Non-Negotiable Type Safety

Every public API surface is strictly typed.
The engine is authored in TypeScript with `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.

## Events

Events are defined with `defineEvent<T>()`, consumed with pull-based iteration, and participate in system scheduling — no strings, no callbacks, no allocations.

### Defining Events

```typescript
import { defineEvent } from '@nova/core';

const CollisionStart = defineEvent<{
  entityA: Entity;
  entityB: Entity;
  normal: Vec2;
  impulse: number;
}>();

const CollisionEnd = defineEvent<{
  entityA: Entity;
  entityB: Entity;
}>();

const EntityDestroyed = defineEvent<{ entity: Entity }>();
```

`defineEvent<T>()` returns a type token (like `defineResource<T>()`). The generic parameter defines the payload shape. No string key is needed — the token is the identity.

### Emitting and Reading Events

Systems declare event dependencies for scheduling analysis, then use `events.emit()` and `events.read()`:

```typescript
const DamageSystem = defineSystem({
  name: 'Damage',
  query: query(Health).write(Health),
  events: { read: [CollisionStart], write: [EntityDestroyed] },
  execute({ events, commands }) {
    for (const c of events.read(CollisionStart)) {
      // c is Readonly<{ entityA: Entity; entityB: Entity; normal: Vec2; impulse: number }>
      const target = c.entityB;
      Health.current[target] -= c.impulse;
      if (Health.current[target] <= 0) {
        events.emit(EntityDestroyed, { entity: target });
        commands.destroy(target);
      }
    }
  },
});
```

### EventAccessor Interface

The `events` field on the system context provides:

```typescript
interface EventAccessor {
  read<T>(token: EventToken<T>): Iterable<Readonly<T>>;
  count<T>(token: EventToken<T>): number;
  hasAny<T>(token: EventToken<T>): boolean;
  emit<T>(token: EventToken<T>, payload: T): void;
}
```

`read()` and `count()` only work for event types declared in the system's `events.read`. `emit()` only works for types in `events.write`. Violations throw in debug mode and are no-ops in production.

### Storage

Event data is stored in pre-allocated ring buffers — zero heap allocation in steady state. Events with only numeric fields can optionally use an SoA ring (typed arrays, like component storage). Events with complex payloads (strings, nested objects) use an object-pool ring. Buffer capacity is configurable per event type:

```typescript
const HighFreqEvent = defineEvent<{ value: number }>({ capacity: 1024 });
```

Default capacity: 256. Overflow in debug mode logs a warning and grows the buffer (one-time allocation); in production, oldest events are overwritten.

### External Observation (Devtools Only)

For tooling that needs callback-based observation outside the ECS pipeline:

```typescript
engine.observe(CollisionStart, (event) => {
  devtoolsPanel.logCollision(event);
});
```

`engine.observe()` runs post-frame, is non-deterministic, and is tree-shaken from production builds. It is not for game logic.

## Generic Components

Component access is fully typed through the schema definition:

```typescript
const pos = world.get(entity, Position);
// pos is { x: number, y: number } — no `any`, no casting
```

## Build Tooling

The recommended setup is Vite with the HyperNova plugin:

```typescript
// vite.config.ts
import { novaPlugin } from '@nova/vite-plugin';

export default defineConfig({
  plugins: [novaPlugin()],
});
```

The plugin handles WASM loading (Rapier), asset manifest generation, dev server with HMR, and production tree-shaking with devtools stripping.
