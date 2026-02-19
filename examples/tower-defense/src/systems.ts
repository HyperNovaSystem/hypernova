import { defineSystem, query } from '../../../src/core/index.js';
import {
  Position, Velocity, Enemy, Health, Tower, Projectile,
  Renderable, SlowEffect, Dead, ReachedEnd,
  GameState, GameMap, InputState,
  EnemyKilled, EnemyReachedEnd, WaveComplete,
  TOWER_DEFS, ENEMY_DEFS, CELL_EMPTY, CELL_TOWER,
} from './components.js';

// ─── Enemy Movement System ───
// Enemies follow the path waypoints

export const EnemyMovementSystem = defineSystem({
  name: 'EnemyMovement',
  query: query(Position, Enemy, Health).not(Dead).not(ReachedEnd),
  execute({ entities, dt, resources, world }) {
    const map = resources.get(GameMap);

    for (const eid of entities) {
      const pathIdx = Enemy.pathIndex[eid];

      if (pathIdx >= map.path.length) {
        // Enemy reached the end
        world.addComponent(eid, ReachedEnd);
        continue;
      }

      const target = map.path[pathIdx];
      const dx = target.x - Position.x[eid];
      const dy = target.y - Position.y[eid];
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Get speed, accounting for slow effect
      let speed = Enemy.speed[eid];
      if (world.hasComponent(eid, SlowEffect)) {
        speed *= SlowEffect.factor[eid];
      }

      const step = speed * dt;

      if (dist <= step) {
        // Reached waypoint — advance to next
        Position.x[eid] = target.x;
        Position.y[eid] = target.y;
        Enemy.pathIndex[eid] = pathIdx + 1;
      } else {
        // Move toward waypoint
        const nx = dx / dist;
        const ny = dy / dist;
        Position.x[eid] += nx * step;
        Position.y[eid] += ny * step;
      }
    }
  },
});

// ─── Slow Effect System ───
// Ticks down slow effect durations

export const SlowEffectSystem = defineSystem({
  name: 'SlowEffect',
  query: query(SlowEffect).not(Dead),
  execute({ entities, dt, world }) {
    for (const eid of entities) {
      SlowEffect.duration[eid] -= dt;
      if (SlowEffect.duration[eid] <= 0) {
        world.removeComponent(eid, SlowEffect);
      }
    }
  },
});

// ─── Tower Targeting System ───
// Towers find enemies in range and fire projectiles

export const TowerTargetingSystem = defineSystem({
  name: 'TowerTargeting',
  query: query(Position, Tower),
  execute({ entities, dt, world, resources }) {
    // Get all alive enemies
    const enemyQuery = query(Position, Enemy, Health).not(Dead).not(ReachedEnd);
    const enemies = world.query(enemyQuery);

    for (const towerEid of entities) {
      // Update cooldown
      Tower.cooldown[towerEid] -= dt;
      if (Tower.cooldown[towerEid] > 0) continue;

      const tx = Position.x[towerEid];
      const ty = Position.y[towerEid];
      const range = Tower.range[towerEid];
      const rangeSq = range * range;

      // Find closest enemy in range (prioritize furthest along path)
      let bestTarget = -1;
      let bestPathIdx = -1;

      for (const enemyEid of enemies) {
        const dx = Position.x[enemyEid] - tx;
        const dy = Position.y[enemyEid] - ty;
        const distSq = dx * dx + dy * dy;

        if (distSq <= rangeSq) {
          // Prefer enemies further along the path
          if (Enemy.pathIndex[enemyEid] > bestPathIdx) {
            bestPathIdx = Enemy.pathIndex[enemyEid];
            bestTarget = enemyEid;
          }
        }
      }

      if (bestTarget >= 0) {
        // Fire!
        Tower.cooldown[towerEid] = Tower.fireRate[towerEid];

        const towerType = Tower.towerType[towerEid];
        const def = TOWER_DEFS[towerType];

        // Spawn projectile
        const proj = world.spawn();
        world.addComponent(proj, Position, {
          x: tx,
          y: ty,
        });
        world.addComponent(proj, Projectile, {
          targetEntity: bestTarget,
          damage: Tower.damage[towerEid],
          speed: 300,
          splashRadius: def.splashRadius,
          slowDuration: def.slowDuration,
        });
        world.addComponent(proj, Renderable, {
          radius: 3,
          color: def.color,
          shape: 0,
        });
      }
    }
  },
});

// ─── Projectile Movement System ───
// Projectiles home toward their target

export const ProjectileMovementSystem = defineSystem({
  name: 'ProjectileMovement',
  query: query(Position, Projectile),
  execute({ entities, dt, world }) {
    for (const eid of entities) {
      const targetEid = Projectile.targetEntity[eid];

      // If target is dead or gone, remove projectile
      if (!world.isAlive(targetEid) || world.hasComponent(targetEid, Dead)) {
        world.destroy(eid);
        continue;
      }

      const dx = Position.x[targetEid] - Position.x[eid];
      const dy = Position.y[targetEid] - Position.y[eid];
      const dist = Math.sqrt(dx * dx + dy * dy);
      const speed = Projectile.speed[eid];
      const step = speed * dt;

      if (dist <= step + 8) {
        // Hit! Apply damage
        applyProjectileHit(eid, targetEid, world);
        world.destroy(eid);
      } else {
        // Move toward target
        const nx = dx / dist;
        const ny = dy / dist;
        Position.x[eid] += nx * step;
        Position.y[eid] += ny * step;
      }
    }
  },
});

function applyProjectileHit(projEid: number, targetEid: number, world: any): void {
  const damage = Projectile.damage[projEid];
  const splashRadius = Projectile.splashRadius[projEid];
  const slowDuration = Projectile.slowDuration[projEid];

  if (splashRadius > 0) {
    // Splash damage — find all enemies in radius
    const enemyQuery = query(Position, Enemy, Health).not(Dead);
    const enemies = world.query(enemyQuery);
    const cx = Position.x[targetEid];
    const cy = Position.y[targetEid];
    const radiusSq = splashRadius * splashRadius;

    for (const enemyEid of enemies) {
      const dx = Position.x[enemyEid] - cx;
      const dy = Position.y[enemyEid] - cy;
      if (dx * dx + dy * dy <= radiusSq) {
        Health.current[enemyEid] -= damage;
      }
    }
  } else {
    // Single target damage
    Health.current[targetEid] -= damage;
  }

  // Apply slow effect
  if (slowDuration > 0) {
    if (world.hasComponent(targetEid, SlowEffect)) {
      // Refresh duration
      SlowEffect.duration[targetEid] = slowDuration;
    } else {
      world.addComponent(targetEid, SlowEffect, {
        factor: 0.4,
        duration: slowDuration,
      });
    }
  }
}

// ─── Death System ───
// Checks for entities at or below 0 health

export const DeathSystem = defineSystem({
  name: 'Death',
  query: query(Health, Enemy).not(Dead).not(ReachedEnd),
  execute({ entities, world, events }) {
    for (const eid of entities) {
      if (Health.current[eid] <= 0) {
        world.addComponent(eid, Dead);
        events.emit(EnemyKilled, {
          entity: eid,
          enemyType: Enemy.enemyType[eid],
          x: Position.x[eid],
          y: Position.y[eid],
        });
      }
    }
  },
});

// ─── Reached End System ───
// Handles enemies that reached the end of the path

export const ReachedEndSystem = defineSystem({
  name: 'ReachedEnd',
  query: query(Enemy, ReachedEnd).not(Dead),
  execute({ entities, world, events, resources }) {
    const gameState = resources.get(GameState);

    for (const eid of entities) {
      world.addComponent(eid, Dead);
      gameState.lives--;
      events.emit(EnemyReachedEnd, { entity: eid });

      if (gameState.lives <= 0) {
        gameState.phase = 'gameover';
      }
    }
  },
});

// ─── Cleanup System ───
// Removes dead entities after a short delay

export const CleanupSystem = defineSystem({
  name: 'Cleanup',
  query: query(Dead),
  execute({ entities, world }) {
    for (const eid of entities) {
      world.destroy(eid);
    }
  },
});

// ─── Reward System ───
// Awards gold for killed enemies

export const RewardSystem = defineSystem({
  name: 'Reward',
  execute({ resources, events }) {
    const gameState = resources.get(GameState);
    const kills = events.read(EnemyKilled);

    for (const kill of kills) {
      const def = ENEMY_DEFS[kill.enemyType] ?? ENEMY_DEFS[0];
      gameState.gold += def.reward;
      gameState.score += def.reward;
    }
  },
});

// ─── Wave Spawner System ───
// Manages wave progression and enemy spawning

export const WaveSpawnerSystem = defineSystem({
  name: 'WaveSpawner',
  execute({ dt, resources, world, events }) {
    const gameState = resources.get(GameState);
    const map = resources.get(GameMap);

    if (gameState.phase !== 'wave') return;

    // Spawn enemies for the current wave
    if (gameState.enemiesSpawnedThisWave < gameState.enemiesToSpawnThisWave) {
      gameState.waveSpawnTimer -= dt;

      if (gameState.waveSpawnTimer <= 0) {
        gameState.waveSpawnTimer = getSpawnInterval(gameState.wave);

        // Determine enemy type based on wave
        const enemyType = pickEnemyType(gameState.wave, gameState.enemiesSpawnedThisWave);
        const def = ENEMY_DEFS[enemyType];

        // Spawn at path start
        const spawnPoint = map.path[0];
        const eid = world.spawn();
        world.addComponent(eid, Position, { x: spawnPoint.x, y: spawnPoint.y });
        world.addComponent(eid, Enemy, {
          pathIndex: 1,
          speed: def.speed * (1 + gameState.wave * 0.03),
          enemyType: enemyType,
        });
        world.addComponent(eid, Health, {
          current: def.health * (1 + gameState.wave * 0.15),
          max: def.health * (1 + gameState.wave * 0.15),
        });
        world.addComponent(eid, Renderable, {
          radius: def.radius,
          color: def.color,
          shape: 0,
        });

        gameState.enemiesSpawnedThisWave++;
      }
    }

    // Check if wave is complete (all enemies spawned and all dead/gone)
    if (gameState.enemiesSpawnedThisWave >= gameState.enemiesToSpawnThisWave) {
      const aliveEnemies = world.query(query(Enemy).not(Dead));
      if (aliveEnemies.length === 0) {
        // Wave complete!
        events.emit(WaveComplete, { wave: gameState.wave });
        gameState.wave++;

        if (gameState.wave > gameState.totalWaves) {
          gameState.phase = 'victory';
        } else {
          gameState.phase = 'building';
          gameState.waveTimer = 15; // seconds between waves
          // Bonus gold between waves
          gameState.gold += 25 + gameState.wave * 5;
        }
      }
    }
  },
});

function getSpawnInterval(wave: number): number {
  return Math.max(0.3, 1.0 - wave * 0.05);
}

function getEnemiesPerWave(wave: number): number {
  return Math.min(5 + wave * 3, 40);
}

function pickEnemyType(wave: number, spawnIndex: number): number {
  // Early waves: only normal
  if (wave <= 2) return 0;
  // Mid waves: mix of normal and fast
  if (wave <= 5) return spawnIndex % 3 === 0 ? 1 : 0;
  // Later waves: all types
  if (spawnIndex % 5 === 0) return 2; // tank
  if (spawnIndex % 3 === 0) return 1; // fast
  return 0; // normal
}

// ─── Building Phase System ───
// Handles tower placement during building phase

export const BuildingPhaseSystem = defineSystem({
  name: 'BuildingPhase',
  execute({ dt, resources, world }) {
    const gameState = resources.get(GameState);
    const input = resources.get(InputState);
    const map = resources.get(GameMap);

    // Tower type selection via number keys
    if (input.keyNumber >= 1 && input.keyNumber <= 4) {
      gameState.selectedTowerType = input.keyNumber - 1;
    }

    if (gameState.phase === 'building') {
      gameState.waveTimer -= dt;
      if (gameState.waveTimer <= 0) {
        startWave(gameState);
      }
    }

    // Tower placement (works in both building and wave phases)
    if (gameState.phase !== 'gameover' && gameState.phase !== 'victory' && input.clicked) {
      const gx = input.mouseGridX;
      const gy = input.mouseGridY;

      if (gx >= 0 && gx < map.gridWidth && gy >= 0 && gy < map.gridHeight) {
        const cellIdx = gy * map.gridWidth + gx;
        if (map.grid[cellIdx] === 0) { // CELL_EMPTY
          const towerType = gameState.selectedTowerType;
          const def = TOWER_DEFS[towerType];

          if (gameState.gold >= def.cost) {
            gameState.gold -= def.cost;
            map.grid[cellIdx] = CELL_TOWER;

            // Spawn tower entity
            const eid = world.spawn();
            world.addComponent(eid, Position, {
              x: gx * map.cellSize + map.cellSize / 2,
              y: gy * map.cellSize + map.cellSize / 2,
            });
            world.addComponent(eid, Tower, {
              range: def.range,
              fireRate: def.fireRate,
              cooldown: 0,
              damage: def.damage,
              towerType: towerType,
            });
            world.addComponent(eid, Renderable, {
              radius: map.cellSize / 2 - 2,
              color: def.color,
              shape: 1, // square
            });
          }
        }
      }
    }

    // Start wave early with right click or space
    if (gameState.phase === 'building' && input.rightClicked) {
      startWave(gameState);
    }
  },
});

function startWave(gameState: any): void {
  gameState.phase = 'wave';
  gameState.enemiesSpawnedThisWave = 0;
  gameState.enemiesToSpawnThisWave = getEnemiesPerWave(gameState.wave);
  gameState.waveSpawnTimer = 0;
}

// ─── Export all systems grouped by stage ───

export function getGameplaySystems() {
  return {
    input: [BuildingPhaseSystem],
    simulation: [
      WaveSpawnerSystem,
      EnemyMovementSystem,
      SlowEffectSystem,
      TowerTargetingSystem,
      ProjectileMovementSystem,
    ],
    gameplay: [
      DeathSystem,
      ReachedEndSystem,
    ],
    cleanup: [
      RewardSystem,
      CleanupSystem,
    ],
  };
}
