# 10. Background Workers

## Overview

GPU compute shaders handle massively parallel work (particles, spatial hashing), but many CPU-bound tasks — pathfinding, AI decision trees, procedural generation, data serialization — need to run off the main thread without blocking the game loop.

> **Note:** This section covers **asynchronous background tasks** — work that runs independently of the frame loop with results arriving on the next frame.  ECS system execution itself runs sequentially on the main thread (see [System Scheduling](./03-ecs-architecture.md#system-scheduling)).

`@nova/workers` provides a typed worker system with three patterns:

| Pattern | API | Worker Lifetime | Example Use Cases |
|---------|-----|-----------------|-------------------|
| **Task** | `defineTask()` | Borrows a pooled worker, returns when done | Pathfinding, proc-gen, serialization |
| **Job** | `defineJob()` | Persistent, timer-driven | Autosave, heartbeat, telemetry, GC |
| **Stream** | `defineStream()` | Persistent, data-driven | Audio analysis, chunk loading, network queues |

All three patterns funnel results through a single `WorkerResultBuffer` resource, drained by a `WorkerSyncSystem` at a deterministic point in the stage pipeline. Worker results are never injected mid-frame.

## Architecture

```
Main Thread                              Worker Thread(s)
──────────                               ────────────────
Game Loop:                               Pool (generic, shared):
  input stage                              Worker 0 ◄── task queue (FIFO)
  worker-sync stage  ◄── ResultBuffer ◄──  Worker 1
  pre-physics stage                        Worker N
  physics stage
  gameplay stage   ──► submit tasks ──►   Services (dedicated):
  render-prep stage                        Autosave Job (timer)
                                           Audio Stream (data)
```

Workers are created from Blob URLs — no separate worker files required.
Task handler function bodies are serialized and registered with each pool worker at startup.
The Vite plugin can optionally extract handlers into real worker modules for source-map support.

## One-Shot Tasks

Tasks are pure functions dispatched to a pool of generic Web Workers.
Any pooled worker can execute any registered task.

```typescript
import { defineTask } from '@nova/workers';

const PathfindTask = defineTask({
  name: 'pathfind',
  execute(input: { grid: Float32Array; width: number; height: number;
                    sx: number; sy: number; ex: number; ey: number }) {
    // A* runs entirely in the worker — no DOM, no shared state
    const path = astar(input.grid, input.width, input.height,
                       input.sx, input.sy, input.ex, input.ey);
    return { path };
  },
  // Zero-copy: transfer ArrayBuffer ownership instead of copying
  inputTransferables: (input) => [input.grid.buffer],
  outputTransferables: (output) => [output.path.buffer],
});
```

Submitting a task returns a `TaskTicket` — a lightweight, non-blocking result handle.
Tickets are **not** Promises (to prevent `await` inside systems).
The `WorkerSyncSystem` polls tickets and emits results as typed events via the `WorkerResult` event token.

```typescript
// In a system's execute function:
const pool = resources.get(WorkerPool);
const ticket = pool.submit(PathfindTask, {
  grid: navGrid.data.slice(), // clone for transfer
  width: navGrid.width, height: navGrid.height,
  sx: Position.x[eid], sy: Position.y[eid],
  ex: targetX, ey: targetY,
});
// Result arrives via WorkerResult event on the next frame
```

**Pool configuration:**

- Size defaults to `navigator.hardwareConcurrency - 1` (minimum 1).
- Tasks execute in submission order (FIFO queue).
- Configurable timeout per task (override with `timeout` in `defineTask()`, default: pool-level `taskTimeout`). Exceeded tasks transition to `'timedOut'` status. The stuck worker is terminated and replaced automatically.

> **Transferred buffer loss:** When a task transfers an `ArrayBuffer` (ownership moves to the worker) and the worker is terminated for timeout, that buffer is irrecoverably lost. Use `SharedArrayBuffer` for data that must survive worker failures, or clone the data before transfer if the cost is acceptable.

## Periodic Jobs

Jobs are timer-driven workers that run on a fixed interval, independent of the game loop.
They run on dedicated workers (not the pool) to avoid blocking one-shot tasks.

```typescript
import { defineJob } from '@nova/workers';

const AutosaveJob = defineJob({
  name: 'autosave',
  interval: 30_000, // every 30 seconds
  init: () => ({ saveCount: 0 }),
  tick(state) {
    state.saveCount++;
    // Can use fetch() from the worker
    return { saved: true, count: state.saveCount };
  },
});

const HeartbeatJob = defineJob({
  name: 'heartbeat',
  interval: 5_000,
  init: () => ({ lastPing: 0 }),
  tick(state) {
    state.lastPing = Date.now();
    return { timestamp: state.lastPing };
  },
});
```

## Streaming Pipelines

Streams are persistent workers that process a continuous flow of data.
They maintain state across messages and can produce output for each input chunk.

```typescript
import { defineStream } from '@nova/workers';

const AudioAnalysisStream = defineStream({
  name: 'audio-analysis',
  init: () => ({
    fftBuffer: new Float32Array(1024),
    beatThreshold: 0.8,
  }),
  process(state, input: { samples: Float32Array; sampleRate: number }) {
    const energy = computeEnergy(input.samples);
    return { energy, isBeat: energy > state.beatThreshold };
  },
  inputTransferables: (input) => [input.samples.buffer],
});

const ChunkLoaderStream = defineStream({
  name: 'chunk-loader',
  init: () => ({ cache: new Map() }),
  process(state, input: { chunkX: number; chunkY: number; seed: number }) {
    const key = `${input.chunkX},${input.chunkY}`;
    if (state.cache.has(key)) return state.cache.get(key);
    const tiles = generateChunk(input.chunkX, input.chunkY, input.seed);
    state.cache.set(key, tiles);
    return { chunkX: input.chunkX, chunkY: input.chunkY, tiles };
  },
  outputTransferables: (output) => [output.tiles.buffer],
});
```

Streams are fed data from the main thread via a `ServiceHandle`:

```typescript
const audioStream = services.startStream(AudioAnalysisStream);
// In a system:
audioStream.send({ samples: audioSamples, sampleRate: 44100 });
```

## ECS Integration

Results from all worker types flow through the same path:
1. Workers post results to the main thread.
2. Results accumulate in the `WorkerResultBuffer` resource.
3. The `WorkerSyncSystem` drains the buffer during the `worker-sync` stage and emits `WorkerResult` events.
4. Game systems read `WorkerResult` via the standard event API and apply data to components.

```typescript
import { WorkerResult } from '@nova/workers';

const ApplyPathfindingSystem = defineSystem({
  name: 'ApplyPathfinding',
  query: query(PathRequest, Position),
  events: { read: [WorkerResult] },
  execute({ events }) {
    for (const result of events.read(WorkerResult)) {
      if (result.taskName !== 'pathfind') continue;
      if (result.status === 'timedOut') {
        // Task exceeded timeout — worker was replaced, transferred buffers are lost
        continue;
      }
      if (result.status !== 'resolved') continue;
      const { entityId, path } = result.data as PathfindResult;
      PathFollower.waypointCount[entityId] = path.length / 2;
      // Copy path into component storage...
    }
  },
});
```

**Recommended stage ordering with workers:**

```typescript
engine.addStage('input',        [InputGatherSystem]);
engine.addStage('worker-sync',  [WorkerSyncSystem]);
engine.addStage('pre-physics',  [MovementSystem, AISystem, ApplyPathfindingSystem]);
engine.addStage('physics',      [PhysicsSyncSystem, PhysicsStepSystem]);
engine.addStage('spatial',      [SpatialIndexSystem]);
engine.addStage('post-physics', [CollisionResponseSystem]);
engine.addStage('gameplay',     [DamageSystem, DeathSystem, SpawnSystem]);
engine.addStage('render-prep',  [SpriteAnimationSystem, CameraSystem]);
```

Tasks submitted during `gameplay` are processed by workers between frames and consumed at the start of the next frame's `worker-sync` stage. This guarantees deterministic behavior.

## Data Transfer

Three tiers, preferred in order:

| Tier | Mechanism | Best For |
|------|-----------|----------|
| **SharedArrayBuffer** | True zero-copy shared memory (requires `crossOriginIsolated`) | Large persistent data: navmeshes, spatial grids |
| **Transferable** | Zero-copy ownership transfer (sender loses access) | One-shot data: pathfinding grids, generated chunks |
| **Structured Clone** | Deep copy via `postMessage` | Small objects, scalar results |

`@nova/workers` provides a `SharedBuffer` utility for persistent shared memory with typed array views and automatic fallback to regular `ArrayBuffer` when `SharedArrayBuffer` is unavailable.

Transferable objects are auto-detected by walking the message payload for `ArrayBuffer` instances.
Explicit `inputTransferables`/`outputTransferables` functions on task/stream definitions provide fine-grained control.

## Graceful Degradation

When `Worker` is unavailable (embedded webviews, restricted environments), the entire API surface still works:
- Tasks execute synchronously on the main thread.
- Jobs run via `setInterval` on the main thread.
- Streams process inline when `send()` is called.
- Results still flow through `WorkerResultBuffer` and are consumed by `WorkerSyncSystem` on the next frame — preserving the 1-frame-delay contract.

Game code behaves identically regardless of worker availability.
Performance degrades (heavy tasks block the main thread), but correctness and determinism are preserved.

## Plugin

```typescript
import { WorkersPlugin, defineTask, defineJob, defineStream } from '@nova/workers';

engine.addPlugin(WorkersPlugin({
  pool: { size: 4, taskTimeout: 3000 },
  tasks: [PathfindTask, ProcGenTask],
  jobs: [AutosaveJob, HeartbeatJob],
  streams: [AudioAnalysisStream],
}));
```

The plugin creates the worker pool, service manager, result buffer resource, and inserts the `worker-sync` stage automatically.
Cleanup (worker termination) is registered on engine dispose.
