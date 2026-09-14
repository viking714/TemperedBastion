/**
 * AC-5 必测块 3：塔位合法性（路径格 / 已占用格 / 越界格判非法，非路径空闲格判合法）。
 */
import { describe, expect, it } from 'vitest';
import { isBuildable, rasterizePath, tileKey } from '../placement';
import { pathTileSet } from '../game';
import type { GameConfig, GridConfig, TowerRuntime } from '../types';
import { allBuildableTiles, loadConfig, orderedPathTiles, requireTower, tileKeyOf } from './fixtures';

const config: GameConfig = loadConfig();

const smallGrid: GridConfig = { cols: 5, rows: 5, tileSizePx: 10 };
const smallWaypoints: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
];

function tower(col: number, row: number): TowerRuntime {
  const arrow = requireTower(config, 'arrow');
  return { col, row, towerId: arrow.id, level: 1, targeting: arrow.targeting, cooldownMs: 0 };
}

describe('placement: rasterizePath', () => {
  it('把折线栅格化为确定的路径格集合（含端点与拐角）', () => {
    const tiles = rasterizePath(smallWaypoints, smallGrid);
    for (let col = 0; col <= 4; col++) expect(tiles.has(tileKey(smallGrid, col, 0))).toBe(true);
    for (let row = 0; row <= 4; row++) expect(tiles.has(tileKey(smallGrid, 4, row))).toBe(true);
    // 对角/拐角处不漏格
    expect(tiles.has(tileKey(smallGrid, 4, 0))).toBe(true);
    expect(tiles.size).toBe(9); // 5 + 5 - 1
  });

  it('结果确定性：重复调用完全一致', () => {
    const first = [...rasterizePath(config.map.pathWaypoints, config.grid)].sort((a, b) => a - b);
    const second = [...rasterizePath(config.map.pathWaypoints, config.grid)].sort((a, b) => a - b);
    expect(first).toEqual(second);
  });

  it('空 waypoint 列表返回空集合', () => {
    expect(rasterizePath([], smallGrid).size).toBe(0);
  });
});

describe('placement: isBuildable 四种非法原因 + 合法', () => {
  const pathTiles = rasterizePath(smallWaypoints, smallGrid);

  it('越界 → out_of_bounds', () => {
    for (const tile of [
      { col: -1, row: 0 },
      { col: 5, row: 0 },
      { col: 0, row: -1 },
      { col: 0, row: 5 },
    ]) {
      const result = isBuildable(smallGrid, pathTiles, [], tile);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('out_of_bounds');
    }
  });

  it('路径格 → on_path', () => {
    const result = isBuildable(smallGrid, pathTiles, [], { col: 2, row: 0 });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('on_path');
  });

  it('出生点 / 基地格 → spawn_or_base', () => {
    const spawn = isBuildable(smallGrid, new Set<number>(), [], { col: 1, row: 1 }, [1, 1], null);
    expect(spawn.valid).toBe(false);
    expect(spawn.reason).toBe('spawn_or_base');

    const base = isBuildable(smallGrid, new Set<number>(), [], { col: 2, row: 2 }, null, [2, 2]);
    expect(base.valid).toBe(false);
    expect(base.reason).toBe('spawn_or_base');
  });

  it('已占用格 → occupied（即使越界优先级更低时也不误判）', () => {
    const occupied = isBuildable(smallGrid, pathTiles, [tower(1, 1)], { col: 1, row: 1 });
    expect(occupied.valid).toBe(false);
    expect(occupied.reason).toBe('occupied');
  });

  it('非路径空闲格 → valid=true, reason=null', () => {
    const free = isBuildable(smallGrid, pathTiles, [tower(1, 1)], { col: 0, row: 3 });
    expect(free).toEqual({ valid: true, reason: null });
  });

  it('原因优先级：越界 > 路径 > 出生基地 > 占用', () => {
    // 越界且是路径格 → 仍报 out_of_bounds
    const outOfBounds = isBuildable(smallGrid, pathTiles, [], { col: -1, row: 0 }, [-1, 0], null);
    expect(outOfBounds.reason).toBe('out_of_bounds');
    // 路径格且被占用 → 报 on_path
    const onPath = isBuildable(smallGrid, pathTiles, [tower(2, 0)], { col: 2, row: 0 });
    expect(onPath.reason).toBe('on_path');
  });
});

describe('placement: 真实关卡地图', () => {
  const pathTiles = pathTileSet(config);

  it('所有界内路径格判为 on_path', () => {
    const ordered = orderedPathTiles(config).filter(
      (tile) => tile.col >= 0 && tile.col < config.grid.cols && tile.row >= 0 && tile.row < config.grid.rows,
    );
    expect(ordered.length).toBeGreaterThan(20);
    for (const tile of ordered) {
      const result = isBuildable(config.grid, pathTiles, [], tile, config.map.spawnTile, config.map.baseTile);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('on_path');
    }
  });

  it('出生点/基地在界外 → 判为 out_of_bounds（边界优先级更高）', () => {
    for (const tile of [config.map.spawnTile, config.map.baseTile]) {
      const result = isBuildable(
        config.grid,
        pathTiles,
        [],
        { col: tile[0], row: tile[1] },
        config.map.spawnTile,
        config.map.baseTile,
      );
      expect(result.valid).toBe(false);
    }
  });

  it('存在足量合法空格（够铺满压力场景的 20 座塔）', () => {
    const tiles = allBuildableTiles(config);
    expect(tiles.length).toBeGreaterThanOrEqual(20);
    for (const tile of tiles) {
      const result = isBuildable(config.grid, pathTiles, [], tile, config.map.spawnTile, config.map.baseTile);
      expect(result.valid).toBe(true);
    }
  });

  it('已建塔的格子不可再建', () => {
    const buildings = allBuildableTiles(config).slice(0, 3).map((tile) => tower(tile.col, tile.row));
    for (const item of buildings) {
      expect(isBuildable(config.grid, pathTiles, buildings, item, config.map.spawnTile, config.map.baseTile).reason).toBe(
        'occupied',
      );
    }
    expect(tileKeyOf(config, buildings[0])).toBe(tileKey(config.grid, buildings[0].col, buildings[0].row));
  });
});
