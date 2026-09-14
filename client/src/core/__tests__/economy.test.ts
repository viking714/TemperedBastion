/**
 * AC-5 必测块 1：金币结算。
 * 建塔扣 cost / 升级扣升级费 / 出售返还 sellRefundRatio×totalInvested /
 * 击杀加 bounty / 过关加 waveClearBonus / 金币不足时阻止支出。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../game';
import {
  addKillReward,
  addWaveClearBonus,
  canAfford,
  computeSellRefund,
  computeUpgradeCost,
  spend,
  totalInvested,
} from '../economy';
import { getEnemyDef } from '../config';
import type { GameConfig, GameState, TowerRuntime } from '../types';
import { buildableTiles, loadConfig, requireTower } from './fixtures';

const config: GameConfig = loadConfig();

function freshState(): GameState {
  return {
    gold: 500,
    lives: 20,
    currentWave: 0,
    waveState: 'IDLE',
    speedMultiplier: 1,
    paused: false,
    prepRemainingMs: 0,
    elapsedMs: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    spawnProgress: { waveIndex: 0, groups: [] },
    nextEnemyId: 1,
    nextProjectileId: 1,
  };
}

describe('economy: 支出与收入', () => {
  it('spend 扣减金币；金币不足时 ok=false 且余额不变（阻止透支）', () => {
    const state = { ...freshState(), gold: 30 };
    expect(canAfford(state, 30)).toBe(true);
    expect(canAfford(state, 31)).toBe(false);

    const ok = spend(state, 30);
    expect(ok.ok).toBe(true);
    expect(ok.state.gold).toBe(0);

    const blocked = spend(state, 31);
    expect(blocked.ok).toBe(false);
    expect(blocked.state.gold).toBe(30);
    expect(blocked.state).toBe(state);
  });

  it('击杀赏金 = 敌人 bounty（来自配置）', () => {
    const enemy = getEnemyDef(config, config.enemies[0].id);
    if (!enemy) throw new Error('缺少敌人定义');
    const state = addKillReward({ ...freshState(), gold: 0 }, enemy);
    expect(state.gold).toBe(enemy.bounty);
  });

  it('过关奖励 = economy.waveClearBonus（来自配置）', () => {
    const state = addWaveClearBonus({ ...freshState(), gold: 0 }, config);
    expect(state.gold).toBe(config.economy.waveClearBonus);
  });

  it('过关奖励置 0 时金币不变（配置可调）', () => {
    const zeroBonus: GameConfig = { ...config, economy: { ...config.economy, waveClearBonus: 0 } };
    const state = addWaveClearBonus({ ...freshState(), gold: 7 }, zeroBonus);
    expect(state.gold).toBe(7);
  });
});

describe('economy: 升级费与出售返还', () => {
  const arrow = requireTower(config, 'arrow');

  function towerAt(level: number): TowerRuntime {
    return { col: 3, row: 3, towerId: arrow.id, level, targeting: arrow.targeting, cooldownMs: 0 };
  }

  it('升级费按等级取 upgradeCostToNext；满级返回 null', () => {
    expect(computeUpgradeCost(towerAt(1), arrow)).toBe(arrow.upgradeCostToNext[0]);
    expect(computeUpgradeCost(towerAt(2), arrow)).toBe(arrow.upgradeCostToNext[1]);
    expect(computeUpgradeCost(towerAt(3), arrow)).toBeNull();
  });

  it('已投入 = 建造费 + 已付升级费', () => {
    expect(totalInvested(towerAt(1), arrow)).toBe(arrow.cost);
    expect(totalInvested(towerAt(2), arrow)).toBe(arrow.cost + arrow.upgradeCostToNext[0]);
    expect(totalInvested(towerAt(3), arrow)).toBe(
      arrow.cost + arrow.upgradeCostToNext[0] + arrow.upgradeCostToNext[1],
    );
  });

  it('出售返还 = floor(sellRefundRatio × 已投入)，且为整数', () => {
    const ratio = config.economy.sellRefundRatio;
    for (const level of [1, 2, 3]) {
      const tower = towerAt(level);
      const expected = Math.floor(totalInvested(tower, arrow) * ratio);
      const refund = computeSellRefund(tower, arrow, config);
      expect(refund).toBe(expected);
      expect(Number.isInteger(refund)).toBe(true);
    }
  });

  it('返还随等级单调不减', () => {
    const refunds = [1, 2, 3].map((level) => computeSellRefund(towerAt(level), arrow, config));
    expect(refunds[1]).toBeGreaterThanOrEqual(refunds[0]);
    expect(refunds[2]).toBeGreaterThanOrEqual(refunds[1]);
  });
});

describe('economy: 经命令入口的完整结算', () => {
  const arrow = requireTower(config, 'arrow');
  const [tile] = buildableTiles(config, 1);

  it('建塔扣 cost、升级扣升级费、出售按比例返还并释放格子', () => {
    let state = { ...freshState(), gold: 1000 };

    const built = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config);
    expect(built.ok).toBe(true);
    state = built.state;
    expect(state.gold).toBe(1000 - arrow.cost);
    expect(state.towers).toHaveLength(1);
    expect(state.towers[0].level).toBe(1);

    const upgraded = applyCommand(state, { type: 'UPGRADE_TOWER', col: tile.col, row: tile.row }, config);
    expect(upgraded.ok).toBe(true);
    state = upgraded.state;
    expect(state.gold).toBe(1000 - arrow.cost - arrow.upgradeCostToNext[0]);
    expect(state.towers[0].level).toBe(2);

    // 同格二次建塔必须被拒（occupied）
    const occupied = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config);
    expect(occupied.ok).toBe(false);
    expect(occupied.reason).toBe('occupied');

    const goldBeforeSell = state.gold;
    const sold = applyCommand(state, { type: 'SELL_TOWER', col: tile.col, row: tile.row }, config);
    expect(sold.ok).toBe(true);
    state = sold.state;
    expect(state.towers).toHaveLength(0);
    expect(state.gold).toBe(
      goldBeforeSell + Math.floor((arrow.cost + arrow.upgradeCostToNext[0]) * config.economy.sellRefundRatio),
    );

    // 出售后格子恢复可建造
    const rebuilt = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config);
    expect(rebuilt.ok).toBe(true);
  });

  it('金币不足时建塔被拒且不产生塔、不扣钱', () => {
    const state = { ...freshState(), gold: arrow.cost - 1 };
    const result = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_gold');
    expect(result.state.towers).toHaveLength(0);
    expect(result.state.gold).toBe(arrow.cost - 1);
  });

  it('金币不足时升级被拒、等级不变', () => {
    let state = { ...freshState(), gold: arrow.cost };
    state = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config).state;
    expect(state.gold).toBe(0);

    const result = applyCommand(state, { type: 'UPGRADE_TOWER', col: tile.col, row: tile.row }, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_gold');
    expect(result.state.towers[0].level).toBe(1);
  });

  it('满级后升级被拒（max_level）', () => {
    let state = { ...freshState(), gold: 100000 };
    state = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config).state;
    for (let i = 0; i < config.rules.maxTowerLevel; i++) {
      state = applyCommand(state, { type: 'UPGRADE_TOWER', col: tile.col, row: tile.row }, config).state;
    }
    expect(state.towers[0].level).toBe(config.rules.maxTowerLevel);
    const result = applyCommand(state, { type: 'UPGRADE_TOWER', col: tile.col, row: tile.row }, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('max_level');
  });

  it('出售不存在的塔被拒（no_tower）', () => {
    const state = freshState();
    const result = applyCommand(state, { type: 'SELL_TOWER', col: tile.col, row: tile.row }, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_tower');
  });
});
