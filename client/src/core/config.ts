/**
 * 配置访问辅助：把 GameConfig 的数组/嵌套结构收敛成几个查询函数。
 *
 * 这些函数都是「只读 + 纯函数」，内核其它模块通过它们读取数值，
 * 从而保证所有战斗数值都来自 config（AC-3）。
 */
import type { EnemyDef, GameConfig, TileCoord, TowerDef, TowerLevelStats, WaveDef } from './types';

/** 塔的格子标识（由坐标派生，存档往返可无损重建，也用作减速 debuff 的来源标识）。 */
export function towerIdAt(config: GameConfig, col: number, row: number): number {
  return row * config.grid.cols + col;
}

export function getTowerDef(config: GameConfig, towerId: string): TowerDef | null {
  const towers = config.towers;
  for (let i = 0; i < towers.length; i++) {
    if (towers[i].id === towerId) return towers[i];
  }
  return null;
}

export function getTowerLevelStats(
  config: GameConfig,
  towerId: string,
  level: number,
): TowerLevelStats | null {
  const def = getTowerDef(config, towerId);
  if (!def) return null;
  const levels = def.levels;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].level === level) return levels[i];
  }
  return null;
}

export function getEnemyDef(config: GameConfig, enemyId: string): EnemyDef | null {
  const enemies = config.enemies;
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].id === enemyId) return enemies[i];
  }
  return null;
}

/** 按 1 基波次号取波次定义；越界返回 null。 */
export function getWaveDef(config: GameConfig, waveNumber: number): WaveDef | null {
  const index = waveNumber - 1;
  if (index < 0 || index >= config.waves.length) return null;
  return config.waves[index];
}

/** 该塔类型的最高等级（由配置的 levels 长度与 rules.maxTowerLevel 共同约束）。 */
export function getMaxTowerLevel(config: GameConfig, towerDef: TowerDef): number {
  const byLevels = towerDef.levels.length;
  return Math.min(config.rules.maxTowerLevel, byLevels);
}

/** 敌人基础速度：随波次按 speedScalePerWave 缩放（默认 0 → 恒定）。 */
export function enemyBaseSpeed(def: EnemyDef, config: GameConfig, waveNumber: number): number {
  const waveIndex = Math.max(waveNumber - 1, 0);
  return def.speed * (1 + config.economy.speedScalePerWave * waveIndex);
}

/** 敌人血量：随波次按 hpScalePerWave 缩放。 */
export function enemyScaledHp(def: EnemyDef, config: GameConfig, waveNumber: number): number {
  const waveIndex = Math.max(waveNumber - 1, 0);
  return def.hp * (1 + config.economy.hpScalePerWave * waveIndex);
}

export function tileAt(col: number, row: number): TileCoord {
  return { col, row };
}

/** 逻辑画布中心（Canvas 渲染层复用；内核也用它把网格坐标换算成世界坐标）。 */
export function cellCenter(config: GameConfig, col: number, row: number): { x: number; y: number } {
  const tile = config.grid.tileSizePx;
  return { x: (col + 0.5) * tile, y: (row + 0.5) * tile };
}
