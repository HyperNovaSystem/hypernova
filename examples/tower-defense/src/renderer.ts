import { query } from '../../../src/core/index.js';
import type { World } from '../../../src/core/index.js';
import {
  Position, Renderable, Tower, Enemy, Health, Projectile,
  SlowEffect, Dead, ReachedEnd,
  GameState, GameMap, InputState,
  TOWER_DEFS, CELL_PATH, CELL_TOWER,
} from './components.js';

function colorToCSS(packed: number): string {
  const r = (packed >> 16) & 0xFF;
  const g = (packed >> 8) & 0xFF;
  const b = packed & 0xFF;
  return `rgb(${r},${g},${b})`;
}

function colorToAlphaCSS(packed: number, alpha: number): string {
  const r = (packed >> 16) & 0xFF;
  const g = (packed >> 8) & 0xFF;
  const b = packed & 0xFF;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Canvas2D renderer for the tower defense game.
 * Reads ECS component data directly for rendering.
 */
export class TDRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private world: World;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.world = world;
  }

  render(): void {
    const ctx = this.ctx;
    const world = this.world;
    const map = world.getResource(GameMap);
    const gameState = world.getResource(GameState);
    const input = world.getResource(InputState);

    const canvasWidth = map.gridWidth * map.cellSize;
    const canvasHeight = map.gridHeight * map.cellSize;

    // Ensure canvas size matches
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw grid
    this.drawGrid(ctx, map);

    // Draw tower range preview on hover
    this.drawRangePreview(ctx, map, gameState, input);

    // Draw towers
    this.drawTowers(ctx, world);

    // Draw enemies
    this.drawEnemies(ctx, world);

    // Draw projectiles
    this.drawProjectiles(ctx, world);

    // Draw HUD
    this.drawHUD(ctx, map, gameState, input);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, map: any): void {
    const { gridWidth, gridHeight, cellSize, grid } = map;

    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const cell = grid[gy * gridWidth + gx];
        const x = gx * cellSize;
        const y = gy * cellSize;

        if (cell === CELL_PATH) {
          ctx.fillStyle = '#2a2a3e';
          ctx.fillRect(x, y, cellSize, cellSize);
          // Path border
          ctx.strokeStyle = '#333355';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
        } else {
          // Empty cell — subtle grid
          ctx.strokeStyle = '#222238';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }
  }

  private drawRangePreview(ctx: CanvasRenderingContext2D, map: any, gameState: any, input: any): void {
    if (gameState.phase === 'gameover' || gameState.phase === 'victory') return;

    const gx = input.mouseGridX;
    const gy = input.mouseGridY;

    if (gx < 0 || gx >= map.gridWidth || gy < 0 || gy >= map.gridHeight) return;

    const cellIdx = gy * map.gridWidth + gx;
    const towerDef = TOWER_DEFS[gameState.selectedTowerType];
    const canAfford = gameState.gold >= towerDef.cost;

    if (map.grid[cellIdx] === 0) { // empty cell
      const cx = gx * map.cellSize + map.cellSize / 2;
      const cy = gy * map.cellSize + map.cellSize / 2;

      // Range circle
      ctx.beginPath();
      ctx.arc(cx, cy, towerDef.range, 0, Math.PI * 2);
      ctx.fillStyle = canAfford
        ? colorToAlphaCSS(towerDef.color, 0.08)
        : 'rgba(255, 0, 0, 0.05)';
      ctx.fill();
      ctx.strokeStyle = canAfford
        ? colorToAlphaCSS(towerDef.color, 0.3)
        : 'rgba(255, 0, 0, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Tower preview
      const r = map.cellSize / 2 - 2;
      ctx.fillStyle = canAfford
        ? colorToAlphaCSS(towerDef.color, 0.4)
        : 'rgba(255, 0, 0, 0.3)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  private drawTowers(ctx: CanvasRenderingContext2D, world: World): void {
    const towers = world.query(query(Position, Tower, Renderable));

    for (const eid of towers) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      const r = Renderable.radius[eid];
      const color = Renderable.color[eid];
      const towerType = Tower.towerType[eid];

      // Tower body
      ctx.fillStyle = colorToCSS(color);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);

      // Tower border
      ctx.strokeStyle = '#ffffff44';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);

      // Tower type indicator
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const symbols = ['↑', '◎', '●', '❄'];
      ctx.fillText(symbols[towerType] ?? '?', x, y);

      // Cooldown indicator
      if (Tower.cooldown[eid] > 0) {
        const pct = Tower.cooldown[eid] / Tower.fireRate[eid];
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x - r, y + r - 3, r * 2 * pct, 3);
      }
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, world: World): void {
    const enemies = world.query(query(Position, Enemy, Health, Renderable).not(Dead));

    for (const eid of enemies) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      const r = Renderable.radius[eid];
      const color = Renderable.color[eid];
      const hp = Health.current[eid];
      const maxHp = Health.max[eid];

      // Enemy body
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorToCSS(color);
      ctx.fill();

      // Slow effect indicator
      if (world.hasComponent(eid, SlowEffect)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#44DDFF88';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Health bar
      if (hp < maxHp) {
        const barWidth = r * 2 + 4;
        const barHeight = 3;
        const barX = x - barWidth / 2;
        const barY = y - r - 6;
        const hpPct = Math.max(0, hp / maxHp);

        ctx.fillStyle = '#333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const hpColor = hpPct > 0.5 ? '#4CAF50' : hpPct > 0.25 ? '#FFC107' : '#F44336';
        ctx.fillStyle = hpColor;
        ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);
      }
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, world: World): void {
    const projectiles = world.query(query(Position, Projectile, Renderable));

    for (const eid of projectiles) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      const r = Renderable.radius[eid];
      const color = Renderable.color[eid];

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorToCSS(color);
      ctx.fill();

      // Glow effect
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = colorToAlphaCSS(color, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawHUD(ctx: CanvasRenderingContext2D, map: any, gameState: any, input: any): void {
    const canvasWidth = map.gridWidth * map.cellSize;
    const canvasHeight = map.gridHeight * map.cellSize;

    // Top bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvasWidth, 32);

    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Gold
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`Gold: ${gameState.gold}`, 10, 16);

    // Lives
    ctx.fillStyle = '#FF6B6B';
    ctx.fillText(`Lives: ${gameState.lives}`, 150, 16);

    // Wave
    ctx.fillStyle = '#8BE9FD';
    ctx.fillText(`Wave: ${gameState.wave}/${gameState.totalWaves}`, 280, 16);

    // Score
    ctx.fillStyle = '#50FA7B';
    ctx.fillText(`Score: ${gameState.score}`, 430, 16);

    // Phase info
    ctx.textAlign = 'right';
    if (gameState.phase === 'building') {
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`Next wave in ${Math.ceil(gameState.waveTimer)}s (right-click to start)`, canvasWidth - 10, 16);
    } else if (gameState.phase === 'wave') {
      const aliveEnemies = this.world.query(query(Enemy).not(Dead));
      ctx.fillStyle = '#FF6B6B';
      ctx.fillText(`Enemies: ${aliveEnemies.length}`, canvasWidth - 10, 16);
    }

    // Bottom bar — tower selection
    const barY = canvasHeight - 60;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, barY, canvasWidth, 60);

    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Towers:', 10, barY + 14);

    for (let i = 0; i < TOWER_DEFS.length; i++) {
      const def = TOWER_DEFS[i];
      const bx = 80 + i * 170;
      const selected = gameState.selectedTowerType === i;
      const canAfford = gameState.gold >= def.cost;

      // Selection highlight
      if (selected) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(bx - 4, barY + 2, 164, 56);
        ctx.strokeStyle = colorToCSS(def.color);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 4, barY + 2, 164, 56);
      }

      // Tower color swatch
      ctx.fillStyle = canAfford ? colorToCSS(def.color) : '#555';
      ctx.fillRect(bx, barY + 8, 14, 14);

      // Tower info
      ctx.fillStyle = canAfford ? '#fff' : '#666';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`[${i + 1}] ${def.name}`, bx + 20, barY + 18);
      ctx.font = '10px monospace';
      ctx.fillStyle = canAfford ? '#FFD700' : '#666';
      ctx.fillText(`$${def.cost}`, bx + 20, barY + 32);
      ctx.fillStyle = '#888';
      ctx.fillText(def.description.substring(0, 24), bx, barY + 46);
    }

    // Game over / victory overlay
    if (gameState.phase === 'gameover') {
      this.drawOverlay(ctx, canvasWidth, canvasHeight, 'GAME OVER', '#FF4444', `Score: ${gameState.score}`);
    } else if (gameState.phase === 'victory') {
      this.drawOverlay(ctx, canvasWidth, canvasHeight, 'VICTORY!', '#50FA7B', `Score: ${gameState.score}`);
    }
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, color: string, subtitle: string): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = color;
    ctx.font = 'bold 48px monospace';
    ctx.fillText(title, w / 2, h / 2 - 20);

    ctx.fillStyle = '#fff';
    ctx.font = '24px monospace';
    ctx.fillText(subtitle, w / 2, h / 2 + 30);

    ctx.fillStyle = '#888';
    ctx.font = '16px monospace';
    ctx.fillText('Refresh to play again', w / 2, h / 2 + 70);
  }
}
