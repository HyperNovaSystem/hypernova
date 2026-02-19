import { Engine } from '../../../src/core/index.js';
import {
  Position, Velocity, Enemy, Health, Tower, Projectile,
  Renderable, SlowEffect, Dead, ReachedEnd,
  GameState, GameMap, InputState,
  TOWER_DEFS,
} from './components.js';
import type { GameStateData, InputData } from './components.js';
import { getGameplaySystems } from './systems.js';
import { createMap } from './map.js';
import { TDRenderer } from './renderer.js';

// ─── Initialize Engine ───

const engine = new Engine({
  maxEntities: 10_000,
  fixedTimestep: 1 / 60,
  seed: 42,
  headless: false,
});

// Register all components upfront
const components = [
  Position, Velocity, Enemy, Health, Tower, Projectile,
  Renderable, SlowEffect, Dead, ReachedEnd,
];
for (const comp of components) {
  engine.registerComponent(comp);
}

// ─── Initialize Resources ───

const map = createMap();
engine.insertResource(GameMap, map);

const gameState: GameStateData = {
  gold: 200,
  lives: 20,
  wave: 1,
  score: 0,
  phase: 'building',
  waveTimer: 15,
  waveSpawnTimer: 0,
  enemiesSpawnedThisWave: 0,
  enemiesToSpawnThisWave: 0,
  selectedTowerType: 0,
  totalWaves: 20,
};
engine.insertResource(GameState, gameState);

const inputState: InputData = {
  mouseX: 0,
  mouseY: 0,
  mouseGridX: -1,
  mouseGridY: -1,
  clicked: false,
  rightClicked: false,
  keyNumber: 0,
};
engine.insertResource(InputState, inputState);

// ─── Register Systems ───

const systems = getGameplaySystems();
engine.addStage('input', systems.input);
engine.addStage('simulation', systems.simulation);
engine.addStage('gameplay', systems.gameplay);
engine.addStage('cleanup', systems.cleanup);

// ─── Canvas Setup ───

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = map.gridWidth * map.cellSize;
canvas.height = map.gridHeight * map.cellSize;

const renderer = new TDRenderer(canvas, engine.world);

// ─── Input Handling ───

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  inputState.mouseX = (e.clientX - rect.left) * scaleX;
  inputState.mouseY = (e.clientY - rect.top) * scaleY;
  inputState.mouseGridX = Math.floor(inputState.mouseX / map.cellSize);
  inputState.mouseGridY = Math.floor(inputState.mouseY / map.cellSize);
});

canvas.addEventListener('click', (e) => {
  e.preventDefault();
  inputState.clicked = true;
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  inputState.rightClicked = true;
});

document.addEventListener('keydown', (e) => {
  const num = parseInt(e.key);
  if (num >= 1 && num <= 4) {
    inputState.keyNumber = num;
  }
  if (e.key === ' ' && gameState.phase === 'building') {
    inputState.rightClicked = true; // space also starts wave
  }
});

// ─── Game Loop ───

let lastTime = performance.now() / 1000;
let accumulator = 0;
const fixedDt = 1 / 60;

function gameLoop(): void {
  const now = performance.now() / 1000;
  const wallDt = Math.min(now - lastTime, 0.1); // cap at 100ms
  lastTime = now;

  accumulator += wallDt;

  // Run fixed timestep updates
  while (accumulator >= fixedDt) {
    engine.tick();
    accumulator -= fixedDt;

    // Clear per-frame input
    inputState.clicked = false;
    inputState.rightClicked = false;
    inputState.keyNumber = 0;
  }

  // Render
  renderer.render();

  requestAnimationFrame(gameLoop);
}

// ─── Start ───

requestAnimationFrame(gameLoop);
