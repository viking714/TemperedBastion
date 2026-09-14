/**
 * 生成排程：按波次配置把敌人逐个放进战场。
 *
 * 每个分组独立计时；`startDelaySec` 是该组第一次生成的额外延迟，
 * 之后按 `spawnIntervalSec` 间隔生成。计时余量会跨步累积（不丢时间），
 * 因此生成时刻只取决于累计模拟时间，与帧率无关。
 */
import { getEnemyDef, getWaveDef, enemyScaledHp } from './config';
import { MS_PER_SEC } from './units';
import type { GameConfig, GameState, SpawnProgress, WaveDef } from './types';

/** 为一波创建全新的生成进度（waveIndex 为 0 基下标）。 */
export function createSpawnProgress(config: GameConfig, waveIndex: number): SpawnProgress {
  const groups: SpawnProgress['groups'] = [];
  const waveDef = config.waves[waveIndex];
  if (waveDef) {
    for (let i = 0; i < waveDef.groups.length; i++) {
      groups.push({ enemy: waveDef.groups[i].enemy, spawnedCount: 0, timeSinceLastMs: 0 });
    }
  }
  return { waveIndex, groups };
}

/** 该波是否已全部生成完毕。 */
export function isSpawnComplete(progress: SpawnProgress, waveDef: WaveDef | null): boolean {
  if (!waveDef) return false;
  if (progress.groups.length !== waveDef.groups.length) return false;
  for (let i = 0; i < waveDef.groups.length; i++) {
    if (progress.groups[i].spawnedCount < waveDef.groups[i].count) return false;
  }
  return true;
}

/** 放入一个敌人（血量按当前波次缩放）。 */
export function spawnEnemy(state: GameState, config: GameConfig, enemyId: string): boolean {
  const def = getEnemyDef(config, enemyId);
  if (!def) return false;
  const maxHp = enemyScaledHp(def, config, state.currentWave);
  const id = state.nextEnemyId;
  state.nextEnemyId = id + 1;
  state.enemies.push({
    id,
    enemyId,
    pathDistance: 0,
    hp: maxHp,
    maxHp,
    spawnOrder: id,
    slowDebuffs: [],
  });
  return true;
}

/** 推进生成计时；返回本步新生成的敌人数。 */
export function advanceSpawn(state: GameState, dtMs: number, config: GameConfig): number {
  const progress = state.spawnProgress;
  const waveDef = getWaveDef(config, progress.waveIndex + 1);
  if (!waveDef) return 0;

  let spawned = 0;
  for (let i = 0; i < progress.groups.length; i++) {
    const groupProgress = progress.groups[i];
    const groupDef = waveDef.groups[i];
    if (!groupDef || groupProgress.spawnedCount >= groupDef.count) continue;

    groupProgress.timeSinceLastMs += dtMs;
    let thresholdMs =
      (groupProgress.spawnedCount === 0 ? groupDef.startDelaySec : groupDef.spawnIntervalSec) * MS_PER_SEC;

    while (groupProgress.spawnedCount < groupDef.count && groupProgress.timeSinceLastMs >= thresholdMs) {
      groupProgress.timeSinceLastMs -= thresholdMs;
      if (!spawnEnemy(state, config, groupDef.enemy)) break;
      groupProgress.spawnedCount += 1;
      spawned += 1;
      thresholdMs = groupDef.spawnIntervalSec * MS_PER_SEC;
    }
  }
  return spawned;
}
