/**
 * 塔位合法性（AC-5 必测块 3）——纯函数，不依赖浏览器。
 *
 * 路径栅格化：把 waypoint 折线按 tile 分辨率逐格推进，途经格全部记为路径格
 * （含出生点/基地所在的越界格，交给边界检查先行拦截）。结果确定性，供建塔
 * 合法性判定与单测使用。
 *
 * 合法性四条（PRD）：① 在网格边界内；② 不属于 pathTileSet；
 *                     ③ 非出生点格、非基地格；④ 当前未被塔占用。
 */
import type { GridConfig, PlacementResult, TileCoord, TowerRuntime } from './types';

/** 格子 → 稳定整数键。 */
export function tileKey(grid: GridConfig, col: number, row: number): number {
  return row * grid.cols + col;
}

export function keyOfTile(grid: GridConfig, tile: TileCoord): number {
  return tileKey(grid, tile.col, tile.row);
}

/** 把 waypoint 折线栅格化成路径格集合（确定性）。 */
export function rasterizePath(waypoints: readonly (readonly number[])[], grid: GridConfig): Set<number> {
  const tiles = new Set<number>();
  if (waypoints.length === 0) return tiles;

  const first = waypoints[0];
  tiles.add(tileKey(grid, first[0], first[1]));

  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const dc = to[0] - from[0];
    const dr = to[1] - from[1];
    const steps = Math.max(Math.abs(dc), Math.abs(dr));
    if (steps === 0) continue;
    for (let step = 1; step <= steps; step++) {
      const col = Math.round(from[0] + (dc * step) / steps);
      const row = Math.round(from[1] + (dr * step) / steps);
      tiles.add(tileKey(grid, col, row));
    }
  }
  return tiles;
}

export function isInsideGrid(grid: GridConfig, col: number, row: number): boolean {
  return col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;
}

function isOccupied(towers: readonly TowerRuntime[], col: number, row: number): boolean {
  for (let i = 0; i < towers.length; i++) {
    if (towers[i].col === col && towers[i].row === row) return true;
  }
  return false;
}

/**
 * 建塔合法性判定。
 *
 * 检查顺序与 PRD 的非法原因枚举一致：
 * out_of_bounds → on_path → spawn_or_base → occupied。
 */
export function isBuildable(
  grid: GridConfig,
  pathTileSet: ReadonlySet<number>,
  towers: readonly TowerRuntime[],
  tile: TileCoord,
  spawnTile?: readonly number[] | null,
  baseTile?: readonly number[] | null,
): PlacementResult {
  const { col, row } = tile;

  if (!isInsideGrid(grid, col, row)) {
    return { valid: false, reason: 'out_of_bounds' };
  }
  if (pathTileSet.has(tileKey(grid, col, row))) {
    return { valid: false, reason: 'on_path' };
  }
  if (spawnTile && spawnTile[0] === col && spawnTile[1] === row) {
    return { valid: false, reason: 'spawn_or_base' };
  }
  if (baseTile && baseTile[0] === col && baseTile[1] === row) {
    return { valid: false, reason: 'spawn_or_base' };
  }
  if (isOccupied(towers, col, row)) {
    return { valid: false, reason: 'occupied' };
  }
  return { valid: true, reason: null };
}
