# 15. Performance Discipline

## Zero Allocations Per Frame

In steady state (no entity spawning/destroying), the engine targets **zero heap allocations per frame** to avoid GC pauses.

Strategies:
- **Ring-buffered events** — each `defineEvent` type is backed by a pre-allocated ring buffer (SoA typed arrays for numeric-only payloads, object-pool ring for complex payloads). Emit advances a write cursor; read iterates without allocation. Buffers are cleared by cursor reset at frame boundary — no deallocation.
- **Pre-allocated typed arrays** for component storage (field arrays allocated once at startup, sized to `maxEntities`)
- **Reusable Vec2/Mat3 scratch objects** in math operations — the math library provides a `scratch` API that returns pooled temporaries
- **No closures in hot paths** — system execute functions receive context via parameters, not captured variables; events are pull-based (no callback registration)

The `@nova/devtools` profiler tracks allocations per frame and alerts when the budget is exceeded.

## Spatial Indexing

For worlds larger than the viewport, efficient spatial queries are critical for culling, proximity checks, and broad-phase collision outside of Rapier.

`@nova/core` provides:

- **Uniform grid** — O(1) insertion/removal, O(neighbors) query. Best for entities of similar size. Default for most simulations.
- **Quadtree** (optional) — better for worlds with entities of wildly varying sizes.

```typescript
import { SpatialIndex } from '@nova/core';

const spatial = world.getResource(SpatialIndex);

// Caller-owned result buffer — zero allocation per query
const results = new Uint32Array(256);           // reuse across frames
const count = spatial.queryAABB(x - 100, y - 100, x + 100, y + 100, results);
for (let i = 0; i < count; i++) {
  const eid = results[i];
  // ... process nearby entity
}
```

The spatial index is automatically maintained by a `SpatialIndexSystem` that runs in the dedicated `spatial` stage (immediately after `physics`, before `post-physics`). It reads `Position` and optionally `AABB`/`Collider` for bounds. Because physics is the last stage that modifies positions, all subsequent stages — `post-physics`, `gameplay`, and `render-prep` — see current-frame spatial data.
