# 4. Modular Package System

## `@nova/core`

The only required package.
Contains:
- ECS world, entity management, global SoA component storage
- Generational entity IDs with stale-handle detection
- Entity hierarchy (Parent/Children, transform propagation)
- System scheduler (dependency-graph ordering, sequential batch execution) and stage pipeline
- Game loop (fixed timestep + render interpolation)
- Event system (`defineEvent` type tokens, stage-boundary double-buffered, pull-based)
- Math library (Vec2, Mat3, AABB, Color, lerp/clamp/remap utilities)
- Typed resource storage
- Scene loading and prefab instantiation
- Spatial index (uniform grid, optional quadtree)

Approximate bundle size target: **< 20 KB** gzipped.

## `@nova/renderer-webgpu`

Primary renderer targeting WebGPU with automatic WebGL2 fallback.

- **Automatic batching.** Sprites with the same texture and blend mode are batched into a single draw call.  No manual batch management.
- **Render graph.** A lightweight render graph manages pass ordering, resource lifetimes, and clear/resolve operations.  Custom post-processing passes slot into the graph.
- **Sprite rendering.** Textured quads with support for atlases, nine-slices, tiling, tint, and alpha.
- **Tilemap rendering.** GPU-instanced tilemap rendering.  A 1000x1000 tilemap renders in a single draw call.
- **Text.** SDF (Signed Distance Field) text rendering for resolution-independent, styleable text with outlines and shadows.
- **Camera.** Multiple cameras with independent viewports, zoom, rotation, and render-to-texture.
- **Custom shaders.** Define custom materials with a shader graph or raw WGSL/GLSL.

The renderer reads `Sprite`, `WorldTransform`, `RenderOrder`, `TilemapLayer`, and `Camera` components from the ECS world. It does not own game objects.

**`RenderOrder` component:** Controls draw order (z-index equivalent). Entities are sorted by `layer` (integer, lower draws first), then by texture/blend mode for batching. Default layer is 0.

```typescript
const RenderOrder = defineComponent({ layer: Types.i32 });  // built-in, from @nova/renderer-webgpu
```

## `@nova/physics-rapier`

Wraps [Rapier2D](https://rapier.rs/) (Rust → WASM) as the default physics engine.
- Rigid bodies: dynamic, kinematic, static
- Colliders: circle, box, capsule, convex polygon, heightfield, trimesh
- Joints: revolute, prismatic, fixed, rope
- Collision events piped into the ECS event system (`CollisionStart`, `CollisionEnd`)
- Raycasting and shape-casting queries
- Deterministic simulation (identical results given identical inputs)

**Sync model:** A `PhysicsSyncSystem` copies `Position`/`Rotation` from ECS to Rapier before stepping, and copies results back after.  The Rapier world is a resource, not a component — there's one physics world, not one per entity.

```typescript
import { PhysicsPlugin, RigidBody, Collider } from '@nova/physics-rapier';

engine.addPlugin(PhysicsPlugin({ gravity: { x: 0, y: -9.81 } }));

const crate = world.spawn();
world.addComponent(crate, Position, { x: 100, y: 50 });
world.addComponent(crate, RigidBody, { type: 'dynamic' });
world.addComponent(crate, Collider, { shape: 'box', width: 32, height: 32 });
```

## `@nova/input`

Unified input abstraction across keyboard, mouse, gamepad, and touch.
- **Action mapping.** Define logical actions ("jump", "fire", "move_left") and bind them to physical inputs.  Multiple bindings per action.  Rebindable at runtime.
- **Analog axes.** Gamepad sticks and composite WASD → Vec2 with configurable dead zones and curves.
- **Buffered input.** Input events are buffered and consumed during the fixed update, ensuring no inputs are lost between frames.
- **Gesture recognition.** Touch gestures (tap, swipe, pinch, long-press) as first-class events.

```typescript
const actions = defineActions({
  jump: [Key.Space, GamepadButton.South],
  fire: [MouseButton.Left, GamepadButton.RightTrigger],
  move: [
    compositeAxis(Key.A, Key.D, Key.W, Key.S),
    gamepadAxis(GamepadAxis.LeftStick),
  ],
});

// In a system
if (input.justPressed('jump')) { /* ... */ }
const dir = input.axis('move'); // Vec2
```

## `@nova/audio`

Web Audio API abstraction with spatial audio and music management.
- **Sound effects.** Pooled audio sources with volume, pitch, pan, and spatial positioning.
- **Music.** Streaming playback with crossfade transitions between tracks.
- **Mixer.** Channel groups (master, sfx, music, ui) with independent volume controls.
- **Audio context resume.** Automatic handling of browser autoplay policies — queues sounds until user interaction unlocks the context.

## `@nova/assets`

Modern async asset pipeline.
- **Declarative manifests.** Define what a scene needs; the loader fetches, decodes, and caches assets before the scene starts.
- **Streaming.** Large assets (spritesheets, audio) can stream progressively.  The game can start before everything is loaded.
- **Hot reload.** In dev mode, file changes on disk trigger asset reload without restarting the game.
- **Format support.** Images (PNG, WebP, AVIF), audio (OGG, MP3, WAV), data (JSON, TOML, binary), spritesheets (TexturePacker, Aseprite), tilemaps (Tiled TMX/JSON, LDtk).

```typescript
const manifest = defineManifest({
  textures: {
    player: 'assets/player.png',
    tileset: 'assets/tileset.webp',
  },
  audio: {
    bgm: { src: 'assets/music.ogg', stream: true },
    jump: 'assets/sfx/jump.wav',
  },
  tilemaps: {
    level1: 'assets/levels/level1.ldtk',
  },
});

const result = await engine.loadManifest(manifest);
// loadManifest returns Result<ManifestAssets, AssetLoadReport>
// After a successful load, assets are ready — direct typed access:
const playerTexture = result.value.textures.player;

// For individually loaded or streamed assets, use AssetHandle<T>
// which provides status/value/fallback (see Error Handling):
const bgm = assets.get('bgm'); // AssetHandle<AudioBuffer> — may still be streaming
renderer.playMusic(bgm.value ?? bgm.fallback);
```

## `@nova/tilemap`

Tilemap loading, querying, and rendering.

- Parses Tiled (TMX/JSON) and LDtk formats.
- Object layers → ECS entities with components derived from custom properties.
- Tile collision shapes → physics colliders automatically.
- Efficient GPU-instanced rendering via the renderer package.
- Runtime tile manipulation (set/get/fill/flood).

## `@nova/particles`

GPU-accelerated particle systems.

- Particle simulation runs in a compute shader (WebGPU) or vertex shader (WebGL2 fallback).
- Emitter components define spawn rate, lifetime, velocity curves, color gradients, size over life, gravity, turbulence.
- Millions of particles with near-zero CPU cost.

## `@nova/animation`

Sprite animation, tweening, and state machines.

- **Sprite animation.** Frame-based animation from sprite sheet sequences. Configurable frame rate, loop modes (loop, once, ping-pong), and events on specific frames.
- **Tweening.** Animate any numeric component field over time with easing curves (linear, ease-in/out, cubic, elastic, bounce, custom Bezier). Chainable sequences and parallel groups.
- **Animation state machine.** Declare states (idle, run, jump, fall) with transition conditions based on component data. States bind to sprite animations and blend between them.
- **Skeletal animation.** Spine and DragonBones import for bone-driven 2D animation with mesh deformation.

```typescript
import { defineAnimation, Tween, AnimationState } from '@nova/animation';

// Sprite animation from a sheet
const walkAnim = defineAnimation({
  texture: 'player',
  frames: [0, 1, 2, 3, 4, 5],
  frameRate: 12,
  loop: true,
});

// Tweening
Tween.to(entity, Position, { x: 500 }, {
  duration: 0.5,
  easing: 'easeOutCubic',
  onComplete: () => { /* ... */ },
});

// State machine — transition conditions receive the entity ID
const playerAnimations = defineAnimationState({
  initial: 'idle',
  states: {
    idle: { animation: idleAnim, transitions: [
      { to: 'run', when: (eid) => Math.abs(Velocity.x[eid]) > 0.1 },
    ]},
    run: { animation: walkAnim, transitions: [
      { to: 'idle', when: (eid) => Math.abs(Velocity.x[eid]) < 0.1 },
      { to: 'jump', when: (eid) => Velocity.y[eid] < -1 },
    ]},
    jump: { animation: jumpAnim, transitions: [
      { to: 'fall', when: (eid) => Velocity.y[eid] > 0 },
    ]},
  },
});
```

## `@nova/ui`

Lightweight in-game UI rendered by the engine — not HTML overlays.

- **Layout.** Flexbox-inspired layout engine for positioning UI elements relative to screen or world space.
- **Widgets.** Text labels, buttons, sliders, progress bars, panels, scroll views. All ECS entities with UI components.
- **Styling.** Declarative style objects with nine-slice backgrounds, font selection, colors, padding, and margin.
- **Interaction.** Click, hover, focus events routed through the input system. Keyboard/gamepad navigation for accessibility.
- **Screen-space and world-space.** UI can be anchored to the screen (HUD) or attached to entities in the world (health bars, name tags).

```typescript
import { UIPanel, UIText, UIButton, Anchor } from '@nova/ui';

const hud = world.spawn()
  .add(UIPanel, { anchor: Anchor.TopLeft, padding: 8 })
  .withChild(child => child
    .add(UIText, { text: 'Score: 0', font: 'default', size: 16 })
  );

const pauseButton = world.spawn()
  .add(UIButton, { text: 'Pause', onClick: 'pause-game' })
  .add(Anchor, { screen: 'top-right', offsetX: -16, offsetY: 16 });
```

HTML overlays remain available for devtools and complex forms. `@nova/ui` is for game UI that needs to be rendered at game frame rate and styled consistently with the game's art.

## `@nova/net`

Networking primitives — not a full multiplayer framework, but the foundational building blocks.

- **State snapshots.** Serialize/deserialize the ECS world (or a filtered subset) into compact binary buffers.
- **Input buffering and playback.** Record and replay input streams for lockstep or rollback networking.
- **Interpolation helpers.** Smooth remote entity positions between snapshot ticks.
- **Transport agnostic.** Provides a `Transport` interface — implement it with WebSocket, WebRTC DataChannel, or a mock for testing.
- **Clock sync.** Lightweight NTP-style clock synchronization between client and server.

## `@nova/devtools`

Development and debugging tools, completely tree-shaken from production builds.

- **Entity Inspector.** Browse all entities, view/edit their components in real time.
- **System Profiler.** Per-system execution time graph. Identify bottlenecks instantly.
- **Physics Debug Overlay.** Render collider shapes, AABBs, contact points, joints.
- **Asset Browser.** View all loaded assets, their memory usage, and reload individually.
- **Console.** In-game console for running commands, spawning entities, toggling systems.
- **State Snapshot Viewer.** Inspect and diff world state between frames (invaluable for networking debugging).

The devtools panel is rendered as an HTML overlay, independent of the game canvas, using a lightweight UI framework (Preact or vanilla DOM).
It communicates with the engine via a message protocol, enabling remote debugging (connect devtools from another browser tab or device).
