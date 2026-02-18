# Appendix A: Minimal Examples

## A.1 Headless Simulation (Node.js)

A deterministic flocking simulation that runs without a browser, canvas, or renderer:

```typescript
import {
  Engine, defineComponent, defineSystem, defineParameter,
  query, Random, Parameters, Types,
} from '@nova/core';

// Components
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Boid = defineComponent({});

// Parameters
const BoidSpeed = defineParameter({
  name: 'Boid Speed', type: 'f32', default: 100, range: [10, 500], group: 'Simulation',
});
const BoidCount = defineParameter({
  name: 'Boid Count', type: 'u32', default: 200, range: [10, 10000], group: 'Simulation',
});

// Systems
const FlockingSystem = defineSystem({
  name: 'Flocking',
  query: query(Boid, Position, Velocity).write(Velocity).read(Position),
  resources: { read: [Random, Parameters] },
  execute({ entities, resources }) {
    const rng = resources.get(Random);
    const speed = resources.get(Parameters).get(BoidSpeed);
    for (const eid of entities) {
      // simplified — real flocking would use spatial queries
      Velocity.x[eid] += (rng.rangeFloat(-1, 1)) * 10;
      Velocity.y[eid] += (rng.rangeFloat(-1, 1)) * 10;
      const len = Math.sqrt(Velocity.x[eid] ** 2 + Velocity.y[eid] ** 2);
      if (len > 0) {
        Velocity.x[eid] = (Velocity.x[eid] / len) * speed;
        Velocity.y[eid] = (Velocity.y[eid] / len) * speed;
      }
    }
  },
});

const MovementSystem = defineSystem({
  name: 'Movement',
  query: query(Position, Velocity).write(Position).read(Velocity),
  execute({ entities, dt }) {
    for (const eid of entities) {
      Position.x[eid] += Velocity.x[eid] * dt;
      Position.y[eid] += Velocity.y[eid] * dt;
    }
  },
});

// Headless bootstrap
const engine = new Engine({ headless: true, seed: 42 });

engine.addStage('simulation', [FlockingSystem]);
engine.addStage('movement', [MovementSystem]);

// Spawn boids
for (let i = 0; i < 200; i++) {
  const rng = engine.world.getResource(Random);
  engine.world.spawn()
    .add(Position, { x: rng.rangeFloat(0, 800), y: rng.rangeFloat(0, 600) })
    .add(Velocity, { x: 0, y: 0 })
    .add(Boid, {});
}

// Run 1000 ticks — deterministic, reproducible
engine.tickN(1000);

// Assert state (for testing or analysis)
console.log(`Tick ${engine.world.getResource(Time).frame}`);
console.log(`Boid 0: (${Position.x[0].toFixed(1)}, ${Position.y[0].toFixed(1)})`);
```

This produces identical output on every run because:
- The seed is fixed (`42`)
- The timestep is fixed (1/60)
- The PRNG is deterministic (xoshiro256**)
- No `Math.random()` is used

## A.2 Browser-Rendered Variant

The same simulation, but with a renderer and input — adding just three lines:

```typescript
import {
  Engine, defineComponent, definePrefab, defineSystem, defineResource,
  defineState, query, loadScene, Types, StatePlugin,
} from '@nova/core';
import { RendererPlugin, Sprite } from '@nova/renderer-webgpu';
import { InputPlugin, InputState, compositeAxis } from '@nova/input';

// Components
const Position = defineComponent({ x: Types.f32, y: Types.f32 });
const Velocity = defineComponent({ x: Types.f32, y: Types.f32 });
const Player = defineComponent({});

// Prefab
const PlayerPrefab = definePrefab('Player', {
  Position: { x: 400, y: 300 },
  Velocity: { x: 0, y: 0 },
  Sprite: { texture: 'player', width: 32, height: 32 },
  Player: {},
});

// Systems
const PlayerInputSystem = defineSystem({
  name: 'PlayerInput',
  query: query(Player, Velocity),
  resources: { read: [InputState] },
  execute({ entities, resources }) {
    const input = resources.get(InputState);
    const dir = input.axis('move');
    for (const eid of entities) {
      Velocity.x[eid] = dir.x * 200;
      Velocity.y[eid] = dir.y * 200;
    }
  },
});

const MovementSystem = defineSystem({
  name: 'Movement',
  query: query(Position, Velocity).write(Position).read(Velocity),
  execute({ entities, dt }) {
    for (const eid of entities) {
      Position.x[eid] += Velocity.x[eid] * dt;
      Position.y[eid] += Velocity.y[eid] * dt;
    }
  },
});

// Bootstrap — renderer and input are optional plugins
const engine = new Engine({ width: 800, height: 600, editor: true });
engine.addPlugin(RendererPlugin());
engine.addPlugin(InputPlugin({
  actions: {
    move: [compositeAxis('KeyA', 'KeyD', 'KeyW', 'KeyS')],
  },
}));

engine.addStage('input', [PlayerInputSystem]);
engine.addStage('movement', [MovementSystem]);

// Spawn from prefab (or load a scene file for the same result)
engine.world.spawn(PlayerPrefab);

engine.start();
```

## A.3 Scene-Based Variant

The same game using a scene file instead of imperative spawning:

**`assets/scenes/game.nova.json`:**
```json
{
  "name": "Game",
  "entities": [
    { "name": "Player", "prefab": "Player", "components": { "Position": { "x": 400, "y": 300 } } }
  ]
}
```

**`main.ts`:**
```typescript
// ... same engine setup as above ...
await loadScene(engine, 'assets/scenes/game.nova.json');
engine.start();
```

The scene file can be edited by hand, in VS Code, or in the visual editor — all three paths produce the same result.
