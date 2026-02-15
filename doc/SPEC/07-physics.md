# 7. Physics — Rapier2D (WASM)

## Why Rapier Over JS Physics

| Concern | Arcade (Phaser) | Matter.js | Rapier2D (WASM) |
|---|---|---|---|
| Performance | Fast but limited | Moderate | Excellent |
| Determinism | No | No | Yes |
| Collision shapes | AABB only | Convex, compound | Full suite |
| Continuous collision | No | Partial | Yes (CCD) |
| Joints/constraints | No | Yes | Yes |
| WASM | N/A | N/A | ~200 KB |

Rapier's determinism is critical for networking (rollback netcode requires identical simulation results given identical inputs) and for replays/testing.

## Physics Configuration

```typescript
engine.addPlugin(PhysicsPlugin({
  gravity: { x: 0, y: 400 },       // pixels/sec²
  timestep: 1 / 60,                  // matches fixed update
  substeps: 2,                       // solver iterations per step
  ccd: true,                         // continuous collision detection
  pixelsPerMeter: 50,                // unit conversion
}));
```

## Collision Events

Collision events flow through the typed event system, not callbacks:

```typescript
import { CollisionStart, CollisionEnd } from '@nova/physics-rapier';

const CollisionResponseSystem = defineSystem({
  name: 'CollisionResponse',
  events: { read: [CollisionStart, CollisionEnd] },
  execute({ events, commands }) {
    for (const collision of events.read(CollisionStart)) {
      // collision is Readonly<{ entityA: Entity; entityB: Entity; normal: Vec2; impulse: number }>
      if (world.has(collision.entityA, Projectile) && world.has(collision.entityB, Health)) {
        commands.set(collision.entityB, Health, { current: Health.current[collision.entityB] - 10 });
      }
    }
  },
});
```
