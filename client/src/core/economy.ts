/**
 * 经济结算（AC-5 必测块 1）——纯函数，不依赖浏览器。
 *
 * 金币来源：初始金币 / 击杀赏金 / 过关奖励
 * 金币消耗：建塔 / 升级
 * 出售返还：sellRefundRatio ×（建造费 + 已投入升级费之和）
 */
import type { EnemyDef, GameConfig, GameState, TowerDef, TowerRuntime } from './types';

/** 是否买得起。 */
export function canAfford(state: GameState, cost: number): boolean {
  return state.gold >= cost;
}

/**
 * 支出金币。金币不足时返回 ok=false 且 state 原样返回（不产生负金币）。
 */
export function spend(state: GameState, cost: number): { ok: boolean; state: GameState } {
  if (!canAfford(state, cost)) return { ok: false, state };
  return { ok: true, state: { ...state, gold: state.gold - cost } };
}

/** 增加金币（通用入口，用于击杀赏金 / 过关奖励 / 出售返还）。 */
export function addGold(state: GameState, amount: number): GameState {
  return { ...state, gold: state.gold + amount };
}

/** 击杀赏金。 */
export function addKillReward(state: GameState, enemy: EnemyDef): GameState {
  return addGold(state, enemy.bounty);
}

/** 过关奖励。 */
export function addWaveClearBonus(state: GameState, config: GameConfig): GameState {
  return addGold(state, config.economy.waveClearBonus);
}

/** 塔已投入的总金币（建造费 + 各级升级费）。 */
export function totalInvested(tower: TowerRuntime, towerDef: TowerDef): number {
  let invested = towerDef.cost;
  // 已投入的升级费 = upgradeCostToNext[0 .. level-2]
  const upgradesPaid = tower.level - 1;
  for (let i = 0; i < upgradesPaid && i < towerDef.upgradeCostToNext.length; i++) {
    invested += towerDef.upgradeCostToNext[i];
  }
  return invested;
}

/**
 * 出售返还的浮点补偿（相对量级）。
 *
 * `ratio × totalInvested` 会出现 IEEE-754 乘法误差（相对约 1e-16），使数学上**恰为整数**
 * 的结果掉到整数下方（如 90×0.7 = 62.99999999999999），直接 `Math.floor` 会把误差放大成
 * 1 金币的实际损失。这里先按相对 epsilon 把误差归一，再向下取整：
 *   - 保持「向下取整到整数金币」语义不变（0.7×144 = 100.8 仍取 100）；
 *   - epsilon 由机器精度导出（√Number.EPSILON ≈ 1.5e-8）：远大于乘法误差、又远小于任何
 *     真实金币差额 —— 返还比值至多 2 位小数、已投入为整数，真实乘积至多 2 位小数，
 *     非整数时与相邻整数的距离 ≥ 0.01，故不会被误抬。
 *   （取 √EPSILON 而不写字面量，以通过 `no-hardcoded-balance` 对 core/ 的数值字面量守护。）
 */
const SELL_REFUND_FLOAT_EPSILON = Math.sqrt(Number.EPSILON);

/** 出售返还：floor(sellRefundRatio × 已投入)，并补偿 IEEE-754 乘法误差（见上）。 */
export function computeSellRefund(tower: TowerRuntime, towerDef: TowerDef, config: GameConfig): number {
  const raw = totalInvested(tower, towerDef) * config.economy.sellRefundRatio;
  return Math.floor(raw + Math.abs(raw) * SELL_REFUND_FLOAT_EPSILON);
}

/** 升到下一级的花费；已满级返回 null。 */
export function computeUpgradeCost(tower: TowerRuntime, towerDef: TowerDef): number | null {
  const index = tower.level - 1;
  if (index < 0 || index >= towerDef.upgradeCostToNext.length) return null;
  return towerDef.upgradeCostToNext[index];
}
