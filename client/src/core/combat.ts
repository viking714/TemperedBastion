/**
 * 战斗结算：护甲减伤 / 溅射 / 减速 debuff（AC-7）。
 *
 * 减速模型（PRD 定案）：
 *   - 幅度不叠加：实际减速 = 所有生效 debuff 中 slowFactor 的**最大值**，并封顶 slowCapRatio；
 *   - 同一来源重复施加：只把该来源的剩余时长刷满，并把幅度同步为最新值；
 *   - 全部 debuff 到期 → 恢复 baseSpeed（有效速度 = baseSpeed × (1 − 实际减速)）。
 */
import type { SlowDebuff } from './types';

/** 护甲减伤：max(raw − armor, raw × armorFloorRatio)，保证重装仍承受最低比例伤害。 */
export function applyArmor(rawDamage: number, armor: number, armorFloorRatio: number): number {
  return Math.max(rawDamage - armor, rawDamage * armorFloorRatio);
}

/** 实际减速（0..slowCapRatio）。无 debuff 时为 0。 */
export function computeSlowFactor(debuffs: readonly SlowDebuff[], slowCapRatio: number): number {
  let strongest = 0;
  for (let i = 0; i < debuffs.length; i++) {
    const factor = debuffs[i].slowFactor;
    if (factor > strongest) strongest = factor;
  }
  return strongest > slowCapRatio ? slowCapRatio : strongest;
}

/**
 * 施加（或刷新）某个来源的减速 debuff（原地修改数组）。
 * 同源已存在 → 刷新剩余时长至满并同步幅度；否则追加一条。
 */
export function applySlowDebuff(
  debuffs: SlowDebuff[],
  sourceTowerId: number,
  slowFactor: number,
  durationMs: number,
): void {
  for (let i = 0; i < debuffs.length; i++) {
    if (debuffs[i].sourceTowerId === sourceTowerId) {
      debuffs[i].slowFactor = slowFactor;
      debuffs[i].remainingMs = durationMs;
      return;
    }
  }
  debuffs.push({ sourceTowerId, slowFactor, remainingMs: durationMs });
}

/** 推进 debuff 计时并移除到期项（原地压缩，保持顺序、零分配）。 */
export function tickSlowDebuffs(debuffs: SlowDebuff[], dtMs: number): void {
  let write = 0;
  for (let read = 0; read < debuffs.length; read++) {
    const debuff = debuffs[read];
    debuff.remainingMs -= dtMs;
    if (debuff.remainingMs > 0) {
      debuffs[write] = debuff;
      write += 1;
    }
  }
  debuffs.length = write;
}

/** 有效移动速度：baseSpeed × (1 − 实际减速)。 */
export function effectiveSpeed(baseSpeed: number, debuffs: readonly SlowDebuff[], slowCapRatio: number): number {
  return baseSpeed * (1 - computeSlowFactor(debuffs, slowCapRatio));
}
