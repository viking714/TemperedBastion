/**
 * 存档序列化（Memento 模式）—— toSavePayload / fromSavePayload（AC-4）。
 *
 * 往返契约：`fromSavePayload(toSavePayload(state, meta), config)` 与 `state`
 * **深度相等**（serialize.test.ts 逐字段断言），因此读档后金币/生命/当前波次/
 * 各塔坐标与等级/已游玩时长与存档时完全一致，游戏可继续。
 */
import { getEnemyDef, getTowerDef } from './config';
import type {
  EnemyRuntime,
  GameConfig,
  GameState,
  ProjectileRuntime,
  SlowDebuff,
  SpawnProgress,
  TargetingMode,
  TowerRuntime,
  WaveState,
} from './types';

export interface TowerSnapshot {
  col: number;
  row: number;
  towerId: string;
  level: number;
  targeting: TargetingMode;
  /** 距下次开火的剩余毫秒（附加字段：让「读档后可继续」包括开火相位）。 */
  cooldownMs: number;
}

export interface SlowDebuffSnapshot {
  sourceTowerId: number;
  slowFactor: number;
  remainingMs: number;
}

export interface EnemySnapshot {
  id: number;
  enemyId: string;
  pathDistance: number;
  hp: number;
  maxHp: number;
  spawnOrder: number;
  slowDebuffs: SlowDebuffSnapshot[];
}

export interface ProjectileSnapshot {
  id: number;
  sourceTowerId: number;
  x: number;
  y: number;
  targetEnemyId: number | null;
  hitX: number | null;
  hitY: number | null;
  speed: number;
  damage: number;
  splashRadius: number | null;
  slowFactor: number | null;
  slowDuration: number | null;
}

export interface SpawnGroupProgressSnapshot {
  enemy: string;
  spawnedCount: number;
  timeSinceLastMs: number;
}

export interface SpawnProgressSnapshot {
  waveIndex: number;
  groups: SpawnGroupProgressSnapshot[];
}

export interface SavePayload {
  slot?: number | null;
  level: number;
  configVersion: string;
  savedAt: string;
  elapsedMs: number;
  gold: number;
  lives: number;
  currentWave: number;
  waveState: WaveState;
  speedMultiplier: number;
  paused: boolean;
  prepRemainingMs: number;
  towers: TowerSnapshot[];
  spawnProgress: SpawnProgressSnapshot;
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  nextEnemyId: number;
  nextProjectileId: number;
}

export interface SaveMeta {
  level: number;
  configVersion: string;
  savedAt: string;
  slot?: number | null;
}

function cloneSlowDebuffs(debuffs: readonly SlowDebuff[]): SlowDebuffSnapshot[] {
  const out: SlowDebuffSnapshot[] = [];
  for (let i = 0; i < debuffs.length; i++) {
    out.push({
      sourceTowerId: debuffs[i].sourceTowerId,
      slowFactor: debuffs[i].slowFactor,
      remainingMs: debuffs[i].remainingMs,
    });
  }
  return out;
}

function cloneEnemies(enemies: readonly EnemyRuntime[]): EnemySnapshot[] {
  const out: EnemySnapshot[] = [];
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    out.push({
      id: enemy.id,
      enemyId: enemy.enemyId,
      pathDistance: enemy.pathDistance,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      spawnOrder: enemy.spawnOrder,
      slowDebuffs: cloneSlowDebuffs(enemy.slowDebuffs),
    });
  }
  return out;
}

function cloneProjectiles(projectiles: readonly ProjectileRuntime[]): ProjectileSnapshot[] {
  const out: ProjectileSnapshot[] = [];
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    out.push({
      id: p.id,
      sourceTowerId: p.sourceTowerId,
      x: p.x,
      y: p.y,
      targetEnemyId: p.targetEnemyId,
      hitX: p.hitX,
      hitY: p.hitY,
      speed: p.speed,
      damage: p.damage,
      splashRadius: p.splashRadius,
      slowFactor: p.slowFactor,
      slowDuration: p.slowDuration,
    });
  }
  return out;
}

function cloneSpawnProgress(progress: SpawnProgress): SpawnProgressSnapshot {
  const groups: SpawnGroupProgressSnapshot[] = [];
  for (let i = 0; i < progress.groups.length; i++) {
    const group = progress.groups[i];
    groups.push({
      enemy: group.enemy,
      spawnedCount: group.spawnedCount,
      timeSinceLastMs: group.timeSinceLastMs,
    });
  }
  return { waveIndex: progress.waveIndex, groups };
}

/** 把运行期状态快照成可持久化的 Memento（深拷贝，之后改状态不会影响 payload）。 */
export function toSavePayload(state: GameState, meta: SaveMeta): SavePayload {
  const towers: TowerSnapshot[] = [];
  for (let i = 0; i < state.towers.length; i++) {
    const tower = state.towers[i];
    towers.push({
      col: tower.col,
      row: tower.row,
      towerId: tower.towerId,
      level: tower.level,
      targeting: tower.targeting,
      cooldownMs: tower.cooldownMs,
    });
  }

  return {
    slot: meta.slot ?? null,
    level: meta.level,
    configVersion: meta.configVersion,
    savedAt: meta.savedAt,
    elapsedMs: state.elapsedMs,
    gold: state.gold,
    lives: state.lives,
    currentWave: state.currentWave,
    waveState: state.waveState,
    speedMultiplier: state.speedMultiplier,
    paused: state.paused,
    prepRemainingMs: state.prepRemainingMs,
    towers,
    spawnProgress: cloneSpawnProgress(state.spawnProgress),
    enemies: cloneEnemies(state.enemies),
    projectiles: cloneProjectiles(state.projectiles),
    nextEnemyId: state.nextEnemyId,
    nextProjectileId: state.nextProjectileId,
  };
}

/**
 * 从 Memento 无损还原运行期状态。
 * 未知的塔/敌人 id（配置已改）会被丢弃，避免畸形存档把内核带崩。
 */
export function fromSavePayload(payload: SavePayload, config: GameConfig): GameState {
  const towers: TowerRuntime[] = [];
  for (let i = 0; i < payload.towers.length; i++) {
    const tower = payload.towers[i];
    if (!getTowerDef(config, tower.towerId)) continue;
    towers.push({
      col: tower.col,
      row: tower.row,
      towerId: tower.towerId,
      level: tower.level,
      targeting: tower.targeting,
      cooldownMs: tower.cooldownMs,
    });
  }

  const enemies: EnemyRuntime[] = [];
  for (let i = 0; i < payload.enemies.length; i++) {
    const enemy = payload.enemies[i];
    if (!getEnemyDef(config, enemy.enemyId)) continue;
    enemies.push({
      id: enemy.id,
      enemyId: enemy.enemyId,
      pathDistance: enemy.pathDistance,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      spawnOrder: enemy.spawnOrder,
      slowDebuffs: cloneSlowDebuffs(enemy.slowDebuffs),
    });
  }

  return {
    gold: payload.gold,
    lives: payload.lives,
    currentWave: payload.currentWave,
    waveState: payload.waveState,
    speedMultiplier: payload.speedMultiplier,
    paused: payload.paused,
    prepRemainingMs: payload.prepRemainingMs,
    elapsedMs: payload.elapsedMs,
    towers,
    enemies,
    projectiles: cloneProjectiles(payload.projectiles),
    spawnProgress: cloneSpawnProgress(payload.spawnProgress),
    nextEnemyId: payload.nextEnemyId,
    nextProjectileId: payload.nextProjectileId,
  };
}
