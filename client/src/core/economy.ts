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

/** 出售返还：向下取整到整数金币，避免出现小数金币。 */
export function computeSellRefund(tower: TowerRuntime, towerDef: TowerDef, config: GameConfig): number {
  return Math.floor(totalInvested(tower, towerDef) * config.economy.sellRefundRatio);
}

/** 升到下一级的花费；已满级返回 null。 */
export function computeUpgradeCost(tower: TowerRuntime, towerDef: TowerDef): number | null {
  const index = tower.level - 1;
  if (index < 0 || index >= towerDef.upgradeCostToNext.length) return null;
  return towerDef.upgradeCostToNext[index];
}
