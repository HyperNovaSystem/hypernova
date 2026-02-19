import { defineComponent, Types, defineEvent, defineResource } from '../../../src/core/index.js';
import type { ResourceToken, EventToken } from '../../../src/core/index.js';

// ─── Core position/velocity ───

export const Position = defineComponent('Position', {
  x: Types.f32,
  y: Types.f32,
});

export const Velocity = defineComponent('Velocity', {
  x: Types.f32,
  y: Types.f32,
});

// ─── Enemy components ───

export const Enemy = defineComponent('Enemy', {
  /** Index along the path (which waypoint we're heading toward) */
  pathIndex: Types.u16,
  /** Speed in pixels per second */
  speed: Types.f32,
  /** Type: 0=normal, 1=fast, 2=tank */
  enemyType: Types.u8,
});

export const Health = defineComponent('Health', {
  current: Types.f32,
  max: Types.f32,
});

// ─── Tower components ───

export const Tower = defineComponent('Tower', {
  /** Range in pixels */
  range: Types.f32,
  /** Cooldown between shots (seconds) */
  fireRate: Types.f32,
  /** Time remaining until next shot */
  cooldown: Types.f32,
  /** Damage per hit */
  damage: Types.f32,
  /** Tower type: 0=basic, 1=sniper, 2=splash, 3=slow */
  towerType: Types.u8,
});

// ─── Projectile components ───

export const Projectile = defineComponent('Projectile', {
  /** Target entity index */
  targetEntity: Types.u32,
  /** Damage to deal on hit */
  damage: Types.f32,
  /** Projectile speed */
  speed: Types.f32,
  /** Splash radius (0 = no splash) */
  splashRadius: Types.f32,
  /** Slow effect duration (0 = no slow) */
  slowDuration: Types.f32,
});

// ─── Visual components ───

export const Renderable = defineComponent('Renderable', {
  /** Radius for circles or half-width for rects */
  radius: Types.f32,
  /** Color packed as 0xRRGGBB */
  color: Types.u32,
  /** Shape: 0=circle, 1=square, 2=triangle */
  shape: Types.u8,
});

// ─── Status effects ───

export const SlowEffect = defineComponent('SlowEffect', {
  /** Slow multiplier (0.5 = half speed) */
  factor: Types.f32,
  /** Time remaining */
  duration: Types.f32,
});

// ─── Tag components ───

export const Dead = defineComponent('Dead', {});
export const ReachedEnd = defineComponent('ReachedEnd', {});

// ─── Resources ───

export interface GameStateData {
  gold: number;
  lives: number;
  wave: number;
  score: number;
  phase: 'building' | 'wave' | 'gameover' | 'victory';
  waveTimer: number;
  waveSpawnTimer: number;
  enemiesSpawnedThisWave: number;
  enemiesToSpawnThisWave: number;
  selectedTowerType: number;
  totalWaves: number;
}

export const GameState: ResourceToken<GameStateData> = defineResource<GameStateData>('GameState');

export interface MapData {
  /** Grid width in cells */
  gridWidth: number;
  /** Grid height in cells */
  gridHeight: number;
  /** Cell size in pixels */
  cellSize: number;
  /** Waypoints for enemies to follow: [x, y] pairs in pixel coords */
  path: { x: number; y: number }[];
  /** Grid of which cells are occupied (towers/path) */
  grid: Uint8Array;
}

export const GameMap: ResourceToken<MapData> = defineResource<MapData>('GameMap');

export interface InputData {
  mouseX: number;
  mouseY: number;
  mouseGridX: number;
  mouseGridY: number;
  clicked: boolean;
  rightClicked: boolean;
  /** Key number pressed (1-4 for tower selection) */
  keyNumber: number;
}

export const InputState: ResourceToken<InputData> = defineResource<InputData>('InputState');

// ─── Events ───

export interface EnemyKilledData {
  entity: number;
  enemyType: number;
  x: number;
  y: number;
}

export const EnemyKilled: EventToken<EnemyKilledData> = defineEvent<EnemyKilledData>('EnemyKilled');

export interface EnemyReachedEndData {
  entity: number;
}

export const EnemyReachedEnd: EventToken<EnemyReachedEndData> = defineEvent<EnemyReachedEndData>('EnemyReachedEnd');

export interface WaveCompleteData {
  wave: number;
}

export const WaveComplete: EventToken<WaveCompleteData> = defineEvent<WaveCompleteData>('WaveComplete');

// ─── Tower type definitions ───

export interface TowerDef {
  name: string;
  cost: number;
  range: number;
  fireRate: number;
  damage: number;
  color: number;
  splashRadius: number;
  slowDuration: number;
  description: string;
}

export const TOWER_DEFS: TowerDef[] = [
  {
    name: 'Arrow',
    cost: 50,
    range: 120,
    fireRate: 0.8,
    damage: 20,
    color: 0x4488FF,
    splashRadius: 0,
    slowDuration: 0,
    description: 'Basic tower. Balanced range and damage.',
  },
  {
    name: 'Sniper',
    cost: 100,
    range: 220,
    fireRate: 2.0,
    damage: 80,
    color: 0xFF4444,
    splashRadius: 0,
    slowDuration: 0,
    description: 'Long range, high damage, slow fire rate.',
  },
  {
    name: 'Cannon',
    cost: 75,
    range: 100,
    fireRate: 1.5,
    damage: 30,
    color: 0xFF8800,
    splashRadius: 50,
    slowDuration: 0,
    description: 'Splash damage in an area.',
  },
  {
    name: 'Frost',
    cost: 60,
    range: 100,
    fireRate: 1.0,
    damage: 10,
    color: 0x44DDFF,
    splashRadius: 0,
    slowDuration: 2.0,
    description: 'Slows enemies. Low damage.',
  },
];

// ─── Enemy type definitions ───

export interface EnemyDef {
  name: string;
  health: number;
  speed: number;
  color: number;
  radius: number;
  reward: number;
}

export const ENEMY_DEFS: EnemyDef[] = [
  { name: 'Normal', health: 100, speed: 60, color: 0xCC3333, radius: 8, reward: 10 },
  { name: 'Fast', health: 60, speed: 110, color: 0xCCCC33, radius: 6, reward: 15 },
  { name: 'Tank', health: 300, speed: 35, color: 0x8833CC, radius: 12, reward: 25 },
];

// ─── Map cell types ───

export const CELL_EMPTY = 0;
export const CELL_PATH = 1;
export const CELL_TOWER = 2;
