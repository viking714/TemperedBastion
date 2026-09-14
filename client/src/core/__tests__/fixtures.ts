/**
 * 内核单测的共享夹具。
 *
 * 关键点：配置夹具**直接读后端唯一数值真源** `server/config/level.json`，
 * 而不是在测试里另抄一份数值——这样测试与运行期用的是同一份配置（AC-3）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTowerDef } from '../config';
import { createGame, pathTileSet } from '../game';
import { isBuildable } from '../placement';
import { buildPath, pathPoint, tileCenter } from '../path';
import type { GameConfig, GameState, TileCoord, TowerRole } from '../types';

const CONFIG_PATH = fileURLToPath(new URL('../../../../server/config/level.json', import.meta.url));

/** 固定模拟步长：1/60 s（与 engine/loop 的 SIM_DT 同义）。 */
export const SIM_DT_SEC = 1 / 60;

let cachedConfig: GameConfig | null = null;

/** 读取 level.json 作为内核测试配置（补上后端才会计算的 version）。 */
export function loadConfig(): GameConfig {
  if (cachedConfig) return cachedConfig;
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Omit<GameConfig, 'version'>;
  cachedConfig = { ...raw, version: 'test-fixture' };
  return cachedConfig;
}

/** 深拷贝配置，便于测试做可控的「压力场景」参数化（不影响其它用例）。 */
export function cloneConfig(mutate?: (config: GameConfig) => void): GameConfig {
  const clone = structuredClone(loadConfig());
  if (mutate) mutate(clone);
  return clone;
}

export function requireTower(config: GameConfig, id: string) {
  const def = getTowerDef(config, id);
  if (!def) throw new Error(`配置里没有塔定义：${id}`);
  return def;
}

/** 按角色取塔 id（让测试跟着配置走，而不是写死 id）。 */
export function towerIdByRole(config: GameConfig, role: TowerRole): string {
  const found = config.towers.find((tower) => tower.role === role);
  if (!found) throw new Error(`配置里没有 role=${role} 的塔`);
  return found.id;
}

export function tileKeyOf(config: GameConfig, tile: TileCoord): number {
  return tile.row * config.grid.cols + tile.col;
}

/** 所有可建造格（按行优先顺序）。 */
export function allBuildableTiles(config: GameConfig): TileCoord[] {
  const pathTiles = pathTileSet(config);
  const tiles: TileCoord[] = [];
  for (let row = 0; row < config.grid.rows; row++) {
    for (let col = 0; col < config.grid.cols; col++) {
      const result = isBuildable(config.grid, pathTiles, [], { col, row }, config.map.spawnTile, config.map.baseTile);
      if (result.valid) tiles.push({ col, row });
    }
  }
  return tiles;
}

/** 前 N 个可建造格（用于单测里快速拿到合法坐标）。 */
export function buildableTiles(config: GameConfig, count: number): TileCoord[] {
  return allBuildableTiles(config).slice(0, count);
}

/** 按路径行进顺序枚举所有路径格（含越界格，与 rasterizePath 的覆盖一致）。 */
export function orderedPathTiles(config: GameConfig): TileCoord[] {
  const waypoints = config.map.pathWaypoints;
  const seen = new Set<number>();
  const ordered: TileCoord[] = [];
  const push = (col: number, row: number) => {
    const key = row * config.grid.cols + col;
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ col, row });
  };
  push(waypoints[0][0], waypoints[0][1]);
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const dc = to[0] - from[0];
    const dr = to[1] - from[1];
    const steps = Math.max(Math.abs(dc), Math.abs(dr));
    for (let step = 1; step <= steps; step++) {
      push(Math.round(from[0] + (dc * step) / steps), Math.round(from[1] + (dr * step) / steps));
    }
  }
  return ordered;
}

/**
 * 贪心选址：反复挑「能覆盖最多尚未覆盖路径格」的可建造格。
 * 完全由 config 驱动（range 取自配置），不写死任何数值。
 */
export function planTowerTiles(config: GameConfig, towerId: string, count: number): TileCoord[] {
  const def = requireTower(config, towerId);
  const stats = def.levels[0];
  const pathTiles = orderedPathTiles(config).filter(
    (tile) => tile.col >= 0 && tile.col < config.grid.cols && tile.row >= 0 && tile.row < config.grid.rows,
  );
  const candidates = allBuildableTiles(config);
  const chosen: TileCoord[] = [];
  const covered = new Array<boolean>(pathTiles.length).fill(false);
  const rangeSq = stats.range * stats.range;

  const gains = new Array<number>(candidates.length).fill(-1);

  for (let pick = 0; pick < count; pick++) {
    let bestIndex = -1;
    let bestGain = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
      if (gains[ci] < 0) {
        const center = tileCenter(config, candidates[ci].col, candidates[ci].row);
        let gain = 0;
        for (let pi = 0; pi < pathTiles.length; pi++) {
          if (covered[pi]) continue;
          const pathCenter = tileCenter(config, pathTiles[pi].col, pathTiles[pi].row);
          const dx = pathCenter.x - center.x;
          const dy = pathCenter.y - center.y;
          if (dx * dx + dy * dy <= rangeSq) gain += 1;
        }
        gains[ci] = gain;
      }
      if (gains[ci] > bestGain) {
        bestGain = gains[ci];
        bestIndex = ci;
      }
    }
    if (bestIndex < 0 || bestGain <= 0) break;

    const tile = candidates[bestIndex];
    chosen.push(tile);
    gains[bestIndex] = -1;

    const center = tileCenter(config, tile.col, tile.row);
    for (let pi = 0; pi < pathTiles.length; pi++) {
      if (covered[pi]) continue;
      const pathCenter = tileCenter(config, pathTiles[pi].col, pathTiles[pi].row);
      const dx = pathCenter.x - center.x;
      const dy = pathCenter.y - center.y;
      if (dx * dx + dy * dy <= rangeSq) covered[pi] = true;
    }
    // 该格已被占用，后续不可能再选。
    candidates.splice(bestIndex, 1);
    gains.splice(bestIndex, 1);
  }
  return chosen;
}

/** 在指定格建满一批塔（忽略失败，便于构造场景）。 */
export function withTowers(
  config: GameConfig,
  tiles: readonly TileCoord[],
  pickTowerId: (index: number) => string,
  apply: (state: GameState, towerId: string, tile: TileCoord) => GameState,
): GameState {
  let state = createGame(config);
  tiles.forEach((tile, index) => {
    state = apply(state, pickTowerId(index), tile);
  });
  return state;
}

/**
 * 找出「能让 1 级该塔打到路径上指定距离处」的合法建造格，按距离升序返回。
 * 用于构造确定性的交战场景（把塔放在出生点附近，敌人才会被第一时间命中）。
 */
export function tilesCoveringPathDistance(config: GameConfig, distance: number, towerId: string): TileCoord[] {
  const def = requireTower(config, towerId);
  const stats = def.levels[0];
  const target = pathPoint(buildPath(config), distance);
  const rangeSq = stats.range * stats.range;
  return allBuildableTiles(config)
    .map((tile) => {
      const center = tileCenter(config, tile.col, tile.row);
      const dx = center.x - target.x;
      const dy = center.y - target.y;
      return { tile, distSq: dx * dx + dy * dy };
    })
    .filter((entry) => entry.distSq <= rangeSq)
    .sort((a, b) => a.distSq - b.distSq)
    .map((entry) => entry.tile);
}

/** 统计样本均值。 */
export function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return values.length === 0 ? 0 : total / values.length;
}

/** 分位数（最近秩法，样本已排序）。 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(index, 0)];
}
