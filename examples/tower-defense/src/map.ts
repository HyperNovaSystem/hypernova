import type { MapData } from './components.js';
import { CELL_PATH } from './components.js';

/**
 * Create the tower defense map.
 * The path is defined as a series of waypoints that enemies follow.
 * Grid cells along the path are marked as CELL_PATH.
 */
export function createMap(): MapData {
  const gridWidth = 20;
  const gridHeight = 15;
  const cellSize = 40;

  const grid = new Uint8Array(gridWidth * gridHeight);

  // Define the path as waypoints (in pixel coordinates, center of cells)
  // Path goes: left edge → right → down → left → down → right → exit
  const path: { x: number; y: number }[] = [
    { x: -20, y: 2 * cellSize + cellSize / 2 },        // spawn off-screen left
    { x: 3 * cellSize + cellSize / 2, y: 2 * cellSize + cellSize / 2 },
    { x: 3 * cellSize + cellSize / 2, y: 5 * cellSize + cellSize / 2 },
    { x: 16 * cellSize + cellSize / 2, y: 5 * cellSize + cellSize / 2 },
    { x: 16 * cellSize + cellSize / 2, y: 8 * cellSize + cellSize / 2 },
    { x: 6 * cellSize + cellSize / 2, y: 8 * cellSize + cellSize / 2 },
    { x: 6 * cellSize + cellSize / 2, y: 12 * cellSize + cellSize / 2 },
    { x: 16 * cellSize + cellSize / 2, y: 12 * cellSize + cellSize / 2 },
    { x: gridWidth * cellSize + 20, y: 12 * cellSize + cellSize / 2 },  // exit off-screen right
  ];

  // Mark path cells on the grid
  markPathOnGrid(grid, gridWidth, cellSize, path);

  return { gridWidth, gridHeight, cellSize, path, grid };
}

function markPathOnGrid(
  grid: Uint8Array,
  gridWidth: number,
  cellSize: number,
  path: { x: number; y: number }[],
): void {
  // Walk between consecutive waypoints and mark cells
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];

    // Convert to grid coords
    const fromGX = Math.floor(from.x / cellSize);
    const fromGY = Math.floor(from.y / cellSize);
    const toGX = Math.floor(to.x / cellSize);
    const toGY = Math.floor(to.y / cellSize);

    // Mark cells between the waypoints (horizontal or vertical segments)
    const minGX = Math.max(0, Math.min(fromGX, toGX));
    const maxGX = Math.min(gridWidth - 1, Math.max(fromGX, toGX));
    const minGY = Math.max(0, Math.min(fromGY, toGY));
    const maxGY = Math.min(grid.length / gridWidth - 1, Math.max(fromGY, toGY));

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        grid[gy * gridWidth + gx] = CELL_PATH;
      }
    }
  }
}
