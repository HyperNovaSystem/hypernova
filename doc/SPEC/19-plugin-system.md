# 17. Plugin System

Every optional subsystem in HyperNova — renderer, physics, input, workers, native bridge, game states — integrates through the same plugin protocol. A plugin is a **named setup function** that receives a registration context and returns an optional cleanup function. No classes, no inheritance, no registration ceremonies — just a function that tells the engine what to set up.

The ECS world itself is the integration layer. Plugins communicate at runtime through components, resources, and events — not through each other.

## 17.1 Plugin Interface

```typescript
interface Plugin {
  readonly name: string;
  readonly depends?: string[];
  install(app: EngineBuilder): PluginResult | Promise<PluginResult>;
}

type PluginResult = void | CleanupFn | EngineError;
type CleanupFn = () => void;
```

Three fields, one required method. If `install()` returns an `EngineError`, the engine collects it and halts before the first frame — after all plugins have attempted installation, so the developer sees ALL failures at once.

| Field | Purpose |
|-------|---------|
| `name` | Unique string identifier. Used for dependency resolution, debugging, hot-reload targeting. |
| `depends` | Plugin names that must install before this one. Omit for no dependencies. |
| `install` | Called once during engine setup. Receives a restricted builder. May return a cleanup function. May be async (WASM loading, WebSocket connections). |

## 17.2 EngineBuilder

Plugins receive `EngineBuilder` — a restricted projection of `Engine` that exposes only registration APIs, not runtime controls like `start()`, `stop()`, or `dispose()`.

```typescript
interface EngineBuilder {
  readonly world: World;

  // Components — allocate SoA columns in the arena (see Error Handling)
  registerComponent(...components: Component[]): Result<void, EngineError>;

  // Resources — typed singleton state
  insertResource<T>(token: ResourceToken<T>, value: T): void;
  getResource<T>(token: ResourceToken<T>): T;

  // Events — type-safe ring-buffered channels
  defineEvent<T>(schema?: EventSchema<T>): EventToken<T>;

  // Stages — create stage, optionally with initial systems and ordering
  addStage(name: string, systems?: SystemDef[], options?: StageOptions): void;

  // Systems — add to an existing stage
  addSystem(stage: string, ...systems: SystemDef[]): void;

  // Sub-plugins — composable plugin groups
  addPlugin(plugin: Plugin): void;

  // Inline cleanup — for conditional or multi-step disposal
  onDispose(fn: CleanupFn): void;
}

interface StageOptions {
  after?: string;   // insert after this stage
  before?: string;  // insert before this stage
}
```

`Engine` implements `EngineBuilder`. During install, plugins see only the builder surface; the engine downcasts internally.

## 17.3 Configurable Plugins (Factory Pattern)

Most plugins accept configuration. The convention is a factory function that validates eagerly and returns a `Plugin`:

```typescript
function PhysicsPlugin(config: PhysicsConfig): Plugin {
  // Validate config at creation time — fail fast, not at install time
  if (config.substeps != null && (config.substeps < 1 || config.substeps > 8)) {
    throw new Error('physics: substeps must be 1–8');
  }

  let rapierWorld: RapierWorld;

  return {
    name: 'physics',
    depends: ['core'],

    async install(app) {
      const rapier = await import('@dimforge/rapier2d');
      rapierWorld = rapier.World.new(config.gravity ?? { x: 0, y: 400 });

      const reg = app.registerComponent(RigidBody, Collider);
      if (!reg.ok) return reg.error;  // arena exhausted → propagate to engine

      app.insertResource(PhysicsWorld, rapierWorld);
      app.defineEvent(CollisionStart);
      app.defineEvent(CollisionEnd);
      app.addStage('physics', [PhysicsSyncSystem, PhysicsStepSystem], { after: 'pre-physics' });

      return () => rapierWorld.free();
    },
  };
}
```

Simple plugins that need no configuration can be plain objects:

```typescript
const FPSPlugin: Plugin = {
  name: 'fps',
  install(app) {
    app.insertResource(FPSCounter, { frames: 0, fps: 0 });
    app.addSystem('render-prep', FPSCounterSystem);
  },
};
```

## 17.4 Dependency Resolution

Plugin dependencies are resolved after all `addPlugin()` calls complete (or lazily at `engine.start()`):

1. **Flatten** — Collect all plugins, including sub-plugins registered via `app.addPlugin()` inside composite install functions.
2. **Deduplicate** — Duplicate names are an error. This forces explicit intent and prevents silent config conflicts.
3. **Graph** — Build a directed graph from `depends` arrays.
4. **Validate** — Every dependency must exist. Cycles are a hard error.
5. **Sort** — Topological sort yields install order.
6. **Install** — Call each `install()` sequentially in sorted order, awaiting async installs.
7. **Dispose** — On `engine.dispose()`, call cleanups in reverse install order.

Error messages are explicit:

| Condition | Error |
|-----------|-------|
| Duplicate name | `Plugin "physics" already installed` |
| Missing dependency | `Plugin "gameplay" depends on "physics" which is not installed` |
| Circular dependency | `Circular plugin dependency: physics → gameplay → physics` |

## 17.5 Stage Ordering

Stages use constraint-based ordering resolved via topological sort. The canonical core stages are:

```
input → worker-sync → native-sync → pre-physics → physics →
spatial → post-physics → gameplay → render-prep
```

Plugins insert custom stages using `after` / `before` constraints:

```typescript
app.addStage('my-ai', [AIDecisionSystem, AIActionSystem], { after: 'post-physics', before: 'gameplay' });
```

Systems can also be omitted (stage-only) or added to an existing stage later:

```typescript
app.addStage('my-ai', [], { after: 'post-physics' });  // create empty stage
app.addSystem('my-ai', AIDecisionSystem);                // add system later
app.addSystem('gameplay', MyCustomSystem);                // add to existing stage
```

Rules:
- Contradictory constraints produce an error with a clear message.
- Adding systems to an existing stage via `addSystem()` is always valid.
- Calling `addStage` with an existing name merges ordering constraints (does not recreate the stage).

## 17.6 Plugin Composition

A plugin can install other plugins, enabling bundle patterns:

```typescript
function DefaultPlugins(config?: {
  renderer?: RendererConfig;
  input?: InputConfig;
  physics?: PhysicsConfig;
}): Plugin {
  return {
    name: 'defaults',
    install(app) {
      app.addPlugin(RendererPlugin(config?.renderer));
      app.addPlugin(InputPlugin(config?.input));
      if (config?.physics) {
        app.addPlugin(PhysicsPlugin(config.physics));
      }
    },
  };
}

// One-liner setup
engine.addPlugin(DefaultPlugins({
  physics: { gravity: { x: 0, y: 400 } },
}));
```

Sub-plugins participate in the same dependency resolution as top-level plugins. A composite plugin's own `depends` array is additive with its children's.

## 17.7 Conditional Activation

Plugins handle platform differences internally — no special framework mechanism needed:

```typescript
function NativePlugin(config: NativeConfig): Plugin {
  return {
    name: 'native',
    install(app) {
      if (typeof WebSocket === 'undefined') return;  // graceful no-op on web

      const bridge = new NativeBridge(config);
      app.insertResource(NativeBridgeToken, bridge);
      app.addStage('native-sync', [NativeSyncSystem], { after: 'worker-sync' });

      return () => bridge.close();
    },
  };
}
```

When a plugin no-ops, it installs nothing — no stages, no systems, no resources. Downstream plugins that depend on its resources should check availability via `app.getResource()` or guard their own behavior.

**Headless mode:** Plugins that require a GPU or browser DOM should check `app.config.headless` and no-op gracefully:

```typescript
function RendererPlugin(config?: RendererConfig): Plugin {
  return {
    name: 'renderer',
    install(app) {
      if (app.config.headless) return;  // no-op in headless mode
      // ... set up WebGPU, canvas, render systems ...
    },
  };
}
```

This pattern ensures the same simulation code — including all `addPlugin()` calls — works in both rendered and headless mode. The simulation doesn't need conditional plugin registration.

## 17.8 Hot Reload (Dev Mode)

During development, plugins can be swapped without restarting the engine:

```typescript
engine.reloadPlugin(PhysicsPlugin(newConfig));
```

The reload sequence:
1. Match existing plugin by `name`.
2. Call old plugin's cleanup function(s).
3. Call new plugin's `install()` — systems are replaced, resources re-inserted.
4. Resume game loop.

Component data and entity state are preserved across plugin reloads. Resource values are replaced only if the new plugin calls `insertResource` for the same token. PRNG state (`Random` resource) is also preserved.

## 17.9 Canonical Plugin Map

Every `@nova/*` package that touches the engine loop exposes a plugin:

| Plugin | Package | Stages | Resources | Key Components | Headless? |
|--------|---------|--------|-----------|----------------|-----------|
| `RendererPlugin` | `@nova/renderer-webgpu` | render-prep | RenderContext | Sprite, Camera, RenderOrder | No-op |
| `PhysicsPlugin` | `@nova/physics-rapier` | physics | PhysicsWorld | RigidBody, Collider | Works |
| `InputPlugin` | `@nova/input` | input | InputState | — | No-op |
| `AudioPlugin` | `@nova/audio` | — | AudioMixer | — | No-op |
| `WorkersPlugin` | `@nova/workers` | worker-sync | WorkerPool, WorkerResultBuffer | — | Works |
| `PersistPlugin` | `@nova/persist` | — | PersistStore | — | Works |
| `RecorderPlugin` | `@nova/recorder` | — | Recorder | — | Works |
| `NativePlugin` | `@nova/native` | native-sync | NativeBridge, NativeResultBuffer | — | Works |
| `StatePlugin` | `@nova/core` | — | StateStack | — | Works |

All are optional. The core engine runs with zero plugins — just a world and a simulation loop. "Headless?" indicates whether the plugin functions in headless mode (no browser/GPU).

## 17.10 Design Rationale

**Why not classes?** A plugin is data + a function. Classes add ceremony (constructors, `this` binding, inheritance chains) without benefit. Factory functions compose naturally and close over configuration.

**Why no `provides` declaration?** The `install()` function is the source of truth — it registers components, resources, events, stages, and systems directly. A separate manifest would duplicate this information and drift. Static analysis tools can introspect `install()` calls in a future pass without changing the plugin interface.

**Why no plugin-to-plugin communication channel?** The ECS world is the communication channel. Resources hold shared state; events carry messages; components tag entities. A plugin bus would create a parallel universe of state outside the ECS, breaking the "single source of truth" principle.

**Why no numeric ordering / priority?** Dependency declarations and stage constraints compose correctly under topological sort. Numeric priorities are fragile — they break when two independent plugins pick the same number, and they obscure intent ("why is this 50?").

**Why error on duplicate names (not silently deduplicate)?** Silent deduplication hides config conflicts. If `DefaultPlugins` installs `InputPlugin()` and the user also installs `InputPlugin({ custom: true })`, the first-wins behavior silently drops the custom config. Explicit errors force deliberate choices.
