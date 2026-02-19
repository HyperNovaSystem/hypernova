# 18. Error Handling

## Philosophy

HyperNova avoids exceptions at runtime. After `engine.start()`, no engine API throws. Errors are values — the type system forces the designer to handle them. But this is kept tractable: **hot paths are infallible by construction**, and only seven APIs require error checking. Everything else just works.

The key insight is a split between **hot paths** (per-frame, per-entity) and **boundary paths** (setup, I/O, async results):

| Path | Examples | Error Model |
|------|----------|-------------|
| Hot | `Position.x[eid]`, `events.read()`, `events.emit()` | Cannot fail. Queries only return live entities. Ring buffers always accept writes. |
| Boundary | `registerComponent()`, `loadManifest()`, `world.spawn()` | Returns `Result<T, EngineError>`. Caller must check. |
| Async result | `TaskTicket`, `NativeTicket` | Status field on ticket + typed event. |
| Frame-level | Physics budget, event ring overflow | `BudgetExceeded` event. No return value — it's an observation, not a per-call failure. |

**One exception:** Plugin factory config validation (e.g., `PhysicsPlugin({ substeps: -1 })`) throws synchronously. This runs before `engine.start()` — there is no game loop to protect, and a stack trace pointing at the bad config is the most helpful response.

## 18.1 Result Type

```typescript
type Result<T, E = EngineError> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };
```

TypeScript's control flow analysis narrows correctly:

```typescript
const r = app.registerComponent(Position, Velocity);
if (!r.ok) {
  // r.error: EngineError — must handle
  return r.error;
}
// r.value: void — safe to continue
```

There is no `.unwrap()`. If the developer wants to crash, they call `engine.halt()` explicitly.

Common errors are pre-allocated as frozen singletons — returning an error is a pointer copy, not a heap allocation.

## 18.2 Error Codes

```typescript
const enum Err {
  None = 0,

  // 0x01xx — Fatal (engine cannot continue)
  ArenaFull       = 0x0100,
  MaxEntities     = 0x0101,
  WasmInitFailed  = 0x0102,

  // 0x02xx — Recoverable (operation failed, engine continues)
  AssetNotFound       = 0x0200,
  AssetCorrupt        = 0x0201,
  AssetTimeout        = 0x0202,
  BridgeDisconnected  = 0x0210,
  BridgeCallFailed    = 0x0211,
  WorkerTimeout       = 0x0220,
  WorkerCrashed       = 0x0221,

  // 0x03xx — Budget (performance threshold exceeded)
  PhysicsBudgetExceeded = 0x0300,
  SystemBudgetExceeded  = 0x0301,
  EventRingOverflow     = 0x0302,

  // 0x04xx — Validation (bad input, engine substitutes defaults)
  InvalidConfig      = 0x0400,
  UnknownComponent   = 0x0401,
  StaleEntityHandle  = 0x0402,
  SceneParseError    = 0x0403,
}
```

## 18.3 Severity & EngineError

```typescript
const enum Severity {
  Fatal       = 0,  // Engine cannot continue. Game loop stops.
  Recoverable = 1,  // Operation failed but engine continues. Caller must handle.
  Budget      = 2,  // Performance threshold exceeded. Engine adapts. Diagnostics notified.
  Validation  = 3,  // Input data invalid. Engine substitutes defaults. Diagnostics notified.
}

interface EngineError {
  readonly severity: Severity;
  readonly code: Err;
  readonly message: string;    // human-readable in dev, empty string in prod
  readonly source?: string;    // package name: '@nova/core', '@nova/physics-rapier', etc.
}
```

Pre-allocated singletons for common errors:

```typescript
const ERRORS = {
  arenaFull: Object.freeze({
    severity: Severity.Fatal,
    code: Err.ArenaFull,
    message: 'Component arena exhausted: maxByteLength reached',
    source: '@nova/core',
  }),
  maxEntities: Object.freeze({
    severity: Severity.Fatal,
    code: Err.MaxEntities,
    message: 'Maximum entity count reached',
    source: '@nova/core',
  }),
  // ... one per common error
} satisfies Record<string, EngineError>;
```

## 18.4 Error Modes

The engine supports two error modes, controlling how non-fatal issues are surfaced:

```typescript
const engine = new Engine({
  errorMode: 'dev',       // default for `nova dev`
  // or: 'production'     // default for `nova build`
});
```

| Behavior | Dev | Production |
|----------|-----|------------|
| Asset 404 | Use fallback, log warning to console + Diag | Use fallback, emit `EngineWarning` event |
| Unknown component in scene | Skip, log warning | Skip, emit `EngineWarning` |
| Event ring overflow | Grow buffer once, log warning | Overwrite oldest, emit warning |
| Arena >90% at startup | Log warning | Emit warning |
| Stale entity handle used | Log to Diag | No-op |
| Config validation (post-start) | Log, use default | Use default, emit warning |

**Dev** is for development and prototyping — things just work, missing assets get placeholders, warnings go to console and Diag ring.

**Production** is for shipping — fallbacks are still used, but `EngineWarning` events are emitted so game code can respond (show retry UI, degrade gracefully). Console logging is minimized.


## 18.5 APIs That Return Results

Only these APIs require error checking. Everything else is infallible by construction:

| API | Returns | Failure Reason |
|-----|---------|----------------|
| `app.registerComponent()` | `Result<void, EngineError>` | Arena allocation exceeded |
| `world.trySpawn()` | `Result<Entity, EngineError>` | `maxEntities` reached |
| `loadManifest()` | `Result<ManifestAssets, AssetLoadReport>` | Network/parse failures |
| `loadScene()` | `Result<SceneHandle, AssetLoadReport>` | Network/parse/unknown component |
| `pool.submit()` | `TaskTicket` (status field) | Pool exhausted, worker crashed |
| `bridge.call()` | `NativeTicket` (status field) | Disconnected, timeout |
| Plugin `install()` | `PluginResult` | WASM load failure, resource unavailable |

## 18.6 Asset Error Handling

Every asset type has a built-in fallback that is always valid:

| Asset Type | Fallback |
|-----------|----------|
| Texture | 2x2 magenta/black checkerboard |
| Audio | Silent buffer (1 sample) |
| Tilemap | Empty tilemap (0 layers) |
| JSON data | `{}` |
| Font | Built-in 8x8 bitmap font |

Assets expose a three-state handle:

```typescript
const enum AssetStatus {
  Loading = 0,
  Ready   = 1,
  Failed  = 2,
}

interface AssetHandle<T> {
  readonly status: AssetStatus;
  readonly value: T | undefined;         // defined only when Ready
  readonly error: EngineError | undefined; // defined only when Failed
  readonly fallback: T;                   // always defined
}
```

Systems always get usable data:

```typescript
execute({ resources }) {
  const assets = resources.get(AssetStore);
  const tex = assets.get('player');              // AssetHandle<Texture>
  renderer.drawSprite(tex.value ?? tex.fallback, x, y);  // never undefined
}
```

Asset failure events flow through the standard event system:

```typescript
const AssetLoaded = defineEvent<{ key: string; type: string }>();
const AssetFailed = defineEvent<{ key: string; type: string; error: EngineError }>();
```

## 18.7 Diagnostics Resource

The engine provides a pre-allocated ring-buffered diagnostics log:

```typescript
interface DiagnosticLog {
  log(severity: Severity, code: Err, detail?: string): void;
  drain(): Iterable<DiagEntry>;
  readonly count: number;
}

interface DiagEntry {
  readonly frame: number;
  readonly severity: Severity;
  readonly code: Err;
  readonly detail: string;
  readonly timestamp: number;   // performance.now()
}
```

- Always available as a resource (inserted by the core engine, not a plugin).
- Ring capacity: 256 entries (oldest overwritten). Zero allocation in steady state.
- In production builds, `Diag.log()` is a no-op (tree-shaken). The ring buffer is not allocated.
- Devtools drains each frame and displays entries with severity coloring.

## 18.8 `engine.halt()`

For fatal errors that stop the engine:

```typescript
engine.halt(error: EngineError): never;
```

1. Cancels `requestAnimationFrame` — game loop stops.
2. Calls all registered dispose/cleanup functions in reverse plugin install order.
3. Emits `EngineHalted` event (observable via `engine.observe()` for devtools).
4. In dev mode, renders a diagnostic overlay on the canvas showing the error.
5. Throws an `Error` as the final action — after all cleanup is complete. This ensures the browser devtools console shows the failure. Nothing catches it.

## 18.9 Engine-Level Events

```typescript
const EngineWarning    = defineEvent<{ code: Err; message: string; source: string }>();
const BudgetExceeded   = defineEvent<{ system: string; budget: number; actual: number; dropped: number }>();
const AssetFailed      = defineEvent<{ key: string; type: string; error: EngineError }>();
const BridgeDisconnected = defineEvent<{ reason: string }>();
const BridgeReconnected  = defineEvent<{}>();
const WorkerTimeout    = defineEvent<{ taskName: string; ticketId: number; elapsed: number }>();
const EngineHalted     = defineEvent<{ error: EngineError }>();
```

These flow through the standard event system. In `production` mode, systems can read `EngineWarning` to implement game-level error handling (retry UI, fallback behavior, etc.). In `dev` mode, warnings are also logged to `Diag`.

## 18.10 Helper Utilities

```typescript
/** Unwrap or halt — for developers who want crash-on-error */
function must<T>(result: Result<T, EngineError>, engine: Engine): T {
  if (result.ok) return result.value;
  engine.halt(result.error);  // typed as `never`, so TypeScript narrows correctly
}

/** Unwrap or use default — for rapid prototyping */
function orDefault<T>(result: Result<T, EngineError>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
```

## 18.11 Design Rationale

**Why discriminated unions, not `(value, err)` tuples?** TypeScript cannot narrow `val` based on `err === null` in destructured tuples. The `{ ok, value }` / `{ ok, error }` pattern gets correct control flow analysis.

**Why no `.unwrap()`?** Unwrap reintroduces exceptions. The whole point is to avoid them. `must()` is explicit — it requires passing the engine, making the halt visible in the code.

**Why events for budget warnings, not Results?** Budget issues are per-frame observations, not per-call failures. No single system "caused" the budget to be exceeded. Events are the natural broadcast mechanism.

**Why pre-allocated error singletons?** Common errors are known at compile time. Returning a frozen singleton is a pointer copy — zero allocation even in error paths.

**Why two error modes?** `dev` optimizes feedback speed during development; `production` minimizes logging noise while preserving observable warnings for runtime handling.

**Why keep exceptions for plugin config?** Plugin factories run once, synchronously, before `engine.start()`. An immediate throw with a stack trace pointing at `PhysicsPlugin({ substeps: -1 })` is the fastest path to fixing the bug.
