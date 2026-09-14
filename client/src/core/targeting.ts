/**
 * 索敌策略（Strategy 模式）—— 纯比较器 + 单遍选择，无排序、零分配。
 *
 * FIRST     路径进度最大者（最接近基地）；同进度取生成顺序靠前者
 * LAST      路径进度最小者；同进度取生成顺序靠前者
 * STRONGEST 当前血量最大者；同血量取进度最大者
 * CLOSEST   与塔的平方距离最小者；同距离取进度最大者
 */
import { pathPointAt } from './path';
import type { PathData } from './path';
import type {
  EnemyRuntime,
  GameConfig,
  GameState,
  TargetingMode,
  TowerLevelStats,
  TowerRuntime,
  Vec2,
} from './types';

const tmpVec: Vec2 = { x: 0, y: 0 };

/**
 * 比较两个候选：返回负数表示 a 更优，正数表示 b 更优，0 表示等价。
 * 全部使用「平局回退」而非随机，保证确定性。
 */
export function compareTargets(
  a: EnemyRuntime,
  aDistanceSq: number,
  b: EnemyRuntime,
  bDistanceSq: number,
  mode: TargetingMode,
): number {
  switch (mode) {
    case 'FIRST': {
      if (a.pathDistance !== b.pathDistance) return b.pathDistance - a.pathDistance;
      return a.spawnOrder - b.spawnOrder;
    }
    case 'LAST': {
      if (a.pathDistance !== b.pathDistance) return a.pathDistance - b.pathDistance;
      return a.spawnOrder - b.spawnOrder;
    }
    case 'STRONGEST': {
      if (a.hp !== b.hp) return b.hp - a.hp;
      return b.pathDistance - a.pathDistance;
    }
    case 'CLOSEST': {
      if (aDistanceSq !== bDistanceSq) return aDistanceSq - bDistanceSq;
      return b.pathDistance - a.pathDistance;
    }
    default:
      return 0;
  }
}

/** 选出塔当前应当攻击的敌人（可能为 null）。 */
export function selectTarget(
  state: GameState,
  tower: TowerRuntime,
  stats: TowerLevelStats,
  config: GameConfig,
  path: PathData,
): EnemyRuntime | null {
  const tile = config.grid.tileSizePx;
  const centerX = (tower.col + 0.5) * tile;
  const centerY = (tower.row + 0.5) * tile;
  const rangeSq = stats.range * stats.range;

  const enemies = state.enemies;
  let best: EnemyRuntime | null = null;
  let bestDistanceSq = 0;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0) continue;
    pathPointAt(path, enemy.pathDistance, tmpVec);
    const dx = tmpVec.x - centerX;
    const dy = tmpVec.y - centerY;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > rangeSq) continue;
    if (best === null || compareTargets(enemy, distanceSq, best, bestDistanceSq, tower.targeting) < 0) {
      best = enemy;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

/** 塔是否还能覆盖到该敌人（供 UI 预览 / 单测使用）。 */
export function isInRange(
  tower: TowerRuntime,
  enemy: EnemyRuntime,
  stats: TowerLevelStats,
  config: GameConfig,
  path: PathData,
): boolean {
  const tile = config.grid.tileSizePx;
  const centerX = (tower.col + 0.5) * tile;
  const centerY = (tower.row + 0.5) * tile;
  pathPointAt(path, enemy.pathDistance, tmpVec);
  const dx = tmpVec.x - centerX;
  const dy = tmpVec.y - centerY;
  return dx * dx + dy * dy <= stats.range * stats.range;
}
