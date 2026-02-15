# Appendix A: Minimal Example

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

// Bootstrap
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

## Appendix A.2: Scene-Based Variant

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
