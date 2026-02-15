# 14. Game States & Scene Transitions

## State Machine

Games need high-level state management — menu → playing → paused → game over. HyperNova provides a stack-based state machine. States are **lifecycle and scene containers**, not system containers. All systems are registered globally in the stage pipeline; state-aware systems read the `StateStack` resource to decide whether to run.

### Defining States

```typescript
import { defineState, StatePlugin, StateStack } from '@nova/core';

const MenuState = defineState({
  name: 'Menu',
  scene: 'assets/scenes/menu.nova.json',
  onEnter({ engine }) {
    // Called when this state becomes the active (top-of-stack) state
    // Insert state-scoped resources here
    engine.world.insertResource(MenuData, { selectedIndex: 0 });
  },
  onExit({ engine }) {
    // Called when this state is removed from the stack
    // Clean up state-scoped resources here
    engine.world.removeResource(MenuData);
  },
});

const PlayingState = defineState({
  name: 'Playing',
  scene: 'assets/scenes/level1.nova.json',
  onEnter({ engine }) { /* ... */ },
  onPause({ engine }) { /* called when another state pushes on top */ },
  onResume({ engine }) { /* called when the state above pops */ },
});

engine.addPlugin(StatePlugin({ initial: MenuState }));

// Transition between states
engine.states.push(PlayingState);      // push onto stack (Menu pauses)
engine.states.pop();                   // pop back to Menu
engine.states.switch(GameOverState);   // replace top of stack
```

### Global Systems & the Resource Guard Pattern

All systems are globally registered via `addStage()` / `addSystem()` and run every frame. Systems that should only execute in certain game states guard on the `StateStack` resource:

```typescript
const MenuInputSystem = defineSystem({
  name: 'MenuInput',
  resources: { read: [StateStack, InputState], write: [] },
  execute({ resources }) {
    const states = resources.get(StateStack);
    if (states.current.name !== 'Menu') return;
    // ... menu-specific input handling
  },
});

const PlayerMovementSystem = defineSystem({
  name: 'PlayerMovement',
  query: query(Position, Velocity).write(Position, Velocity),
  resources: { read: [StateStack], write: [] },
  execute({ entities, resources }) {
    const states = resources.get(StateStack);
    if (states.current.name !== 'Playing') return;
    // ... gameplay movement logic
  },
});
```

This keeps the stage pipeline static — no systems are added or removed at runtime. The scheduler's dependency graph is built once at startup and remains stable across state transitions.

### StateStack Resource

`StatePlugin` provides the `StateStack` resource:

```typescript
interface StateStack {
  readonly current: StateToken;          // top-of-stack (active state)
  readonly stack: ReadonlyArray<StateToken>;  // full stack, bottom to top
  push(state: StateToken, options?: TransitionOptions): void;
  pop(options?: TransitionOptions): void;
  switch(state: StateToken, options?: TransitionOptions): void;
}
```

### State Lifecycle

State transitions are **deferred commands** — they are queued when called and applied at the next stage-boundary command flush, guaranteeing no lifecycle callbacks fire mid-stage.

**`push(NewState)`:**
1. `currentState.onPause()` is called.
2. `NewState`'s scene is loaded (if `scene` is specified).
3. `NewState.onEnter()` is called.
4. `StateStack.current` now points to `NewState`.

**`pop()`:**
1. `topState.onExit()` is called.
2. `topState`'s scene entities are destroyed (unless marked persistent).
3. `previousState.onResume()` is called.
4. `StateStack.current` now points to `previousState`.

**`switch(NewState)`:**
Equivalent to `pop()` then `push(NewState)`, executed atomically within a single command flush.

## Scene Transitions

States can optionally define transition effects:

```typescript
engine.states.switch(PlayingState, {
  transition: 'fade',   // built-in: fade, slide, wipe, none
  duration: 0.5,
});
```
