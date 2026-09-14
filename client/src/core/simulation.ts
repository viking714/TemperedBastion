/**
 * 固定步长世界推演：step(state, fixedDt, config) → state（AC-5 / AC-6 核心）。
 *
 * 设计要点：
 *  - **帧率无关**：推演只以调用方给出的固定步长推进；调用方（engine/loop）用累加器
 *    决定一帧跑几步。相同步数 → 相同结果，与真实帧时长无关。
 *  - **原地复用**：敌人/子弹数组用「写指针压缩」增删，热循环内不做 filter/map/字面量分配
 *    （唯一的新对象是本步新增的子弹，数量级为每步 0~1 个）。
 *  - **终局短路**：VICTORY / DEFEAT 或（配置要求）暂停时立即返回，不再出怪与结算。
 */
import { enemyBaseSpeed, getEnemyDef, getTowerLevelStats, towerIdAt } from './config';
import { addWaveClearBonus } from './economy';
import { applyArmor, applySlowDebuff, computeSlowFactor, tickSlowDebuffs } from './combat';
import { getPath, pathPointAt } from './path';
import type { PathData } from './path';
import { selectTarget } from './targeting';
import { advanceSpawn } from './spawn';
import { MS_PER_SEC } from './units';
import { isTerminal, isWaveCleared, reduce } from './waveStateMachine';
import type { EnemyRuntime, GameConfig, GameState, Vec2 } from './types';

const tmpVec: Vec2 = { x: 0, y: 0 };

function findEnemy(enemies: readonly EnemyRuntime[], id: number): EnemyRuntime | null {
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].id === id) return enemies[i];
  }
  return null;
}

function applyDamage(enemy: EnemyRuntime, rawDamage: number, config: GameConfig): void {
  const def = getEnemyDef(config, enemy.enemyId);
  const armor = def ? def.armor : 0;
  const effective = applyArmor(rawDamage, armor, config.rules.armorFloorRatio);
  const remaining = enemy.hp - effective;
  enemy.hp = remaining > 0 ? remaining : 0;
}

/** 敌人移动 + 减速计时；返回本步漏怪造成的总伤害（交给状态机扣血）。 */
function moveEnemies(state: GameState, dtMs: number, config: GameConfig): number {
  const path = getPath(config);
  const dtSec = dtMs / MS_PER_SEC;
  const enemies = state.enemies;
  let leakDamage = 0;
  let write = 0;

  for (let read = 0; read < enemies.length; read++) {
    const enemy = enemies[read];
    if (enemy.hp <= 0) {
      // 已阵亡但尚未回收：原地保留，交由 reap 处理，且不参与漏怪判定。
      enemies[write] = enemy;
      write += 1;
      continue;
    }
    const def = getEnemyDef(config, enemy.enemyId);
    if (def) {
      const baseSpeed = enemyBaseSpeed(def, config, state.currentWave);
      const slow = computeSlowFactor(enemy.slowDebuffs, config.rules.slowCapRatio);
      enemy.pathDistance += baseSpeed * (1 - slow) * dtSec;
    }
    tickSlowDebuffs(enemy.slowDebuffs, dtMs);

    if (enemy.pathDistance >= path.totalLength) {
      enemy.pathDistance = path.totalLength;
      if (def) leakDamage += def.leakDamage;
      continue; // 抵达基地 → 移出战场
    }
    enemies[write] = enemy;
    write += 1;
  }
  enemies.length = write;
  return leakDamage;
}

/** 塔冷却推进、索敌与开火。 */
function fireTowers(state: GameState, dtMs: number, config: GameConfig): void {
  const towers = state.towers;
  const path = getPath(config);
  const tile = config.grid.tileSizePx;

  for (let i = 0; i < towers.length; i++) {
    const tower = towers[i];
    tower.cooldownMs -= dtMs;
    if (tower.cooldownMs > 0) continue;

    const stats = getTowerLevelStats(config, tower.towerId, tower.level);
    if (!stats) {
      tower.cooldownMs = 0;
      continue;
    }

    const target = selectTarget(state, tower, stats, config, path);
    if (!target) {
      // 无目标：把冷却夹回 0，避免长时间空转累积出无意义的负值（也让存档更干净）。
      tower.cooldownMs = 0;
      continue;
    }

    const intervalMs = MS_PER_SEC / stats.fireRate;
    tower.cooldownMs += intervalMs;

    const sourceTowerId = towerIdAt(config, tower.col, tower.row);
    const muzzleX = (tower.col + 0.5) * tile;
    const muzzleY = (tower.row + 0.5) * tile;

    pathPointAt(path, target.pathDistance, tmpVec);

    if (stats.projectileSpeed > 0) {
      const id = state.nextProjectileId;
      state.nextProjectileId = id + 1;
      state.projectiles.push({
        id,
        sourceTowerId,
        x: muzzleX,
        y: muzzleY,
        targetEnemyId: target.id,
        hitX: tmpVec.x,
        hitY: tmpVec.y,
        speed: stats.projectileSpeed,
        damage: stats.damage,
        splashRadius: stats.splashRadius,
        slowFactor: stats.slowFactor,
        slowDuration: stats.slowDuration,
      });
    } else {
      // projectileSpeed = 0 → 即时命中
      resolveHit(
        state,
        tmpVec.x,
        tmpVec.y,
        target.id,
        stats.damage,
        stats.splashRadius,
        stats.slowFactor,
        stats.slowDuration,
        sourceTowerId,
        config,
        path,
      );
    }
  }
}

/**
 * 命中结算：splashRadius 为 null → 单体；否则对命中点半径内全体结算。
 * 单遍遍历，主目标天然只结算一次（不叠算）。
 */
function resolveHit(
  state: GameState,
  hitX: number,
  hitY: number,
  mainTargetId: number | null,
  damage: number,
  splashRadius: number | null,
  slowFactor: number | null,
  slowDuration: number | null,
  sourceTowerId: number,
  config: GameConfig,
  path: PathData,
): void {
  if (splashRadius === null) {
    const target = mainTargetId === null ? null : findEnemy(state.enemies, mainTargetId);
    if (!target || target.hp <= 0) return;
    applyDamage(target, damage, config);
    if (slowFactor !== null && slowDuration !== null) {
      applySlowDebuff(target.slowDebuffs, sourceTowerId, slowFactor, slowDuration * MS_PER_SEC);
    }
    return;
  }

  const radiusSq = splashRadius * splashRadius;
  const enemies = state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (enemy.hp <= 0) continue;
    pathPointAt(path, enemy.pathDistance, tmpVec);
    const dx = tmpVec.x - hitX;
    const dy = tmpVec.y - hitY;
    if (dx * dx + dy * dy > radiusSq) continue;
    applyDamage(enemy, damage, config);
  }
}

/** 子弹飞行：追踪目标当前位置；目标消失时溅射弹继续飞向最后已知落点。 */
function advanceProjectiles(state: GameState, dtMs: number, config: GameConfig): void {
  const path = getPath(config);
  const dtSec = dtMs / MS_PER_SEC;
  const projectiles = state.projectiles;
  let write = 0;

  for (let read = 0; read < projectiles.length; read++) {
    const projectile = projectiles[read];
    let targetX = projectile.hitX;
    let targetY = projectile.hitY;

    if (projectile.targetEnemyId !== null) {
      const target = findEnemy(state.enemies, projectile.targetEnemyId);
      if (target && target.hp > 0) {
        pathPointAt(path, target.pathDistance, tmpVec);
        targetX = tmpVec.x;
        targetY = tmpVec.y;
        projectile.hitX = targetX;
        projectile.hitY = targetY;
      } else if (projectile.splashRadius === null) {
        continue; // 单体弹失去目标 → 直接销毁
      }
    }
    if (targetX === null || targetY === null) continue;

    const dx = targetX - projectile.x;
    const dy = targetY - projectile.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const travel = projectile.speed * dtSec;

    if (distance <= travel) {
      projectile.x = targetX;
      projectile.y = targetY;
      resolveHit(
        state,
        targetX,
        targetY,
        projectile.targetEnemyId,
        projectile.damage,
        projectile.splashRadius,
        projectile.slowFactor,
        projectile.slowDuration,
        projectile.sourceTowerId,
        config,
        path,
      );
      continue; // 命中后销毁
    }

    projectile.x += (dx / distance) * travel;
    projectile.y += (dy / distance) * travel;
    projectiles[write] = projectile;
    write += 1;
  }
  projectiles.length = write;
}

/** 回收阵亡敌人并结算击杀赏金。 */
function reapDeadEnemies(state: GameState, config: GameConfig): void {
  const enemies = state.enemies;
  let write = 0;
  for (let read = 0; read < enemies.length; read++) {
    const enemy = enemies[read];
    if (enemy.hp <= 0) {
      const def = getEnemyDef(config, enemy.enemyId);
      if (def) state.gold += def.bounty;
      continue;
    }
    enemies[write] = enemy;
    write += 1;
  }
  enemies.length = write;
}

/** 推进一个固定步长。 */
export function step(state: GameState, fixedDt: number, config: GameConfig): GameState {
  if (isTerminal(state.waveState)) return state;
  if (state.paused && config.rules.pauseFreezesAll) return state;

  const dtMs = fixedDt * MS_PER_SEC;
  state.elapsedMs += dtMs;

  if (state.waveState === 'PREP') {
    state.prepRemainingMs -= dtMs;
    if (state.prepRemainingMs <= 0) {
      state.prepRemainingMs = 0;
      state = reduce(state, { type: 'WAVE_START' }, config);
    }
  }

  if (state.waveState === 'SPAWNING') {
    const spawned = advanceSpawn(state, dtMs, config);
    if (spawned > 0) state = reduce(state, { type: 'ENEMY_SPAWNED' }, config);
  }

  if (state.waveState === 'SPAWNING' || state.waveState === 'ACTIVE') {
    const leakDamage = moveEnemies(state, dtMs, config);
    if (leakDamage > 0) {
      state = reduce(state, { type: 'ENEMY_LEAKED', leakDamage }, config);
      // 生命耗尽的瞬间立即终局：停止继续出怪与攻击结算。
      if (state.waveState === 'DEFEAT') return state;
    }

    fireTowers(state, dtMs, config);
    advanceProjectiles(state, dtMs, config);

    let killed = 0;
    const before = state.enemies.length;
    reapDeadEnemies(state, config);
    killed = before - state.enemies.length;
    if (killed > 0) state = reduce(state, { type: 'ENEMY_DEAD' }, config);
  }

  if (state.waveState === 'SPAWNING' || state.waveState === 'ACTIVE') {
    if (isWaveCleared(state, config)) {
      const previousState = state.waveState;
      const cleared = reduce(state, { type: 'WAVE_CLEARED' }, config);
      if (cleared.waveState !== previousState) {
        state = addWaveClearBonus(cleared, config);
      } else {
        state = cleared;
      }
    }
  }

  return state;
}
