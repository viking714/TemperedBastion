/**
 * QA 独立测试 · AC-5 三块必测逻辑（经济结算 / 波次状态机 / 塔位合法性）。
 *
 * 设计依据：prd.json 的 game_rules_spec 与 acceptance_criteria.AC-5，**未参考** Developer 的
 * economy.test.ts / waveStateMachine.test.ts / placement.test.ts。
 */
import { describe, it, expect } from 'vitest';
import {
  createGame,
  canAfford,
  spend,
  addKillReward,
  addWaveClearBonus,
  computeSellRefund,
  computeUpgradeCost,
  totalInvested,
  reduce,
  isBuildable,
  rasterizePath,
  tileKey,
  getTowerDef,
  getEnemyDef,
} from '..';
import type { GameConfig, GameState, TowerRuntime, TileCoord } from '..';
import { loadConfig } from './qa_helpers';

const config: GameConfig = loadConfig();

function mkState(over: Partial<GameState> = {}): GameState {
  return { ...createGame(config), ...over };
}

function mkTower(towerId: string, level: number, col = 0, row = 0): TowerRuntime {
  const def = getTowerDef(config, towerId)!;
  return { col, row, towerId, level, targeting: def.targeting, cooldownMs: 0 };
}

// ---------------------------------------------------------------------------
// QA-AC5-1 经济结算
// ---------------------------------------------------------------------------
describe('QA-AC5-1 economy 金币结算', () => {
  it('建塔扣 cost：初始 150 → 建箭塔后 100', () => {
    const s = mkState();
    expect(canAfford(s, 50)).toBe(true);
    const r = spend(s, 50);
    expect(r.ok).toBe(true);
    expect(r.state.gold).toBe(100);
  });

  it('金币不足：canAfford=false 且不产生负金币（state 原样）', () => {
    const s = mkState({ gold: 30 });
    expect(canAfford(s, 50)).toBe(false);
    const r = spend(s, 50);
    expect(r.ok).toBe(false);
    expect(r.state.gold).toBe(30);        // 未变
    expect(r.state).toBe(s);              // 原对象返回（无副作用）
  });

  it('边界：金币恰等于 cost 时可支付且归零', () => {
    const r = spend(mkState({ gold: 50 }), 50);
    expect(r.ok).toBe(true);
    expect(r.state.gold).toBe(0);
  });

  it('升级费按级给出：箭塔 40 / 80 / 满级 null', () => {
    const def = getTowerDef(config, 'arrow')!;
    expect(computeUpgradeCost(mkTower('arrow', 1), def)).toBe(40);
    expect(computeUpgradeCost(mkTower('arrow', 2), def)).toBe(80);
    expect(computeUpgradeCost(mkTower('arrow', 3), def)).toBeNull();
  });

  it('已投入口径：建造费 + 各级升级费之和', () => {
    const arrowDef = getTowerDef(config, 'arrow')!;
    expect(totalInvested(mkTower('arrow', 1), arrowDef)).toBe(50);
    expect(totalInvested(mkTower('arrow', 2), arrowDef)).toBe(90);
    expect(totalInvested(mkTower('arrow', 3), arrowDef)).toBe(170);
  });

  it('出售返还（无升级）符合精确口径：箭/炮/冰 = 35 / 56 / 42', () => {
    expect(computeSellRefund(mkTower('arrow', 1), getTowerDef(config, 'arrow')!, config)).toBe(35);
    expect(computeSellRefund(mkTower('cannon', 1), getTowerDef(config, 'cannon')!, config)).toBe(56);
    expect(computeSellRefund(mkTower('frost', 1), getTowerDef(config, 'frost')!, config)).toBe(42);
  });

  it('出售返还（已升级）符合 PRD 精确口径：L2=63（第 1 轮缺陷，第 2 轮修复复验）', () => {
    // 返还 = floor(sellRefundRatio × 已投入)。L2 已投入 = 50+40 = 90 → 0.7×90 数学上恰为 63。
    // 第 1 轮实现因 90*0.7=62.999999… 被 Math.floor 成 62（少返 1 金币）；
    // 第 2 轮 economy.computeSellRefund 加相对 epsilon 补偿后，应精确返回 63。
    expect(computeSellRefund(mkTower('arrow', 2), getTowerDef(config, 'arrow')!, config)).toBe(63);
  });

  it('出售返还（已升级）符合 PRD 精确口径：L3=119（第 1 轮缺陷，第 2 轮修复复验）', () => {
    // L3 已投入 = 50+40+80 = 170 → 0.7×170 数学上恰为 119；第 1 轮返回 118，第 2 轮应返回 119。
    expect(computeSellRefund(mkTower('arrow', 3), getTowerDef(config, 'arrow')!, config)).toBe(119);
  });

  it('出售返还 9 组全量口径（三塔×三级）：精确整数取整不误抬、非整数仍向下取整', () => {
    // 防「epsilon 补偿」用力过猛：非整数乘积必须仍取 floor（100.8→100、190.4→190…），
    // 故这条同时守住两个方向 —— 精确整数不掉、真小数不被抬。
    const cases: Array<[string, number, number]> = [
      ['arrow', 1, 35], ['arrow', 2, 63], ['arrow', 3, 119],   // 0.7×50 / ×90 / ×170
      ['cannon', 1, 56], ['cannon', 2, 100], ['cannon', 3, 190], // 0.7×80 / ×144(100.8) / ×272(190.4)
      ['frost', 1, 42], ['frost', 2, 75], ['frost', 3, 142],   // 0.7×60 / ×108(75.6) / ×204(142.8)
    ];
    for (const [id, level, expected] of cases) {
      const got = computeSellRefund(mkTower(id, level), getTowerDef(config, id)!, config);
      expect(got, `${id} L${level} 返还`).toBe(expected);
      expect(Number.isInteger(got), `${id} L${level} 返还应为整数`).toBe(true);
    }
  });

  it('击杀赏金与过关奖励取自配置', () => {
    const s = mkState({ gold: 100 });
    expect(addKillReward(s, getEnemyDef(config, 'normal')!).gold).toBe(108); // bounty 8
    expect(addKillReward(s, getEnemyDef(config, 'heavy')!).gold).toBe(120);  // bounty 20
    expect(addWaveClearBonus(s, config).gold).toBe(120);                     // waveClearBonus 20
  });

  it('数值边界：cost=0 可支付且不改变金币；NaN 视为不可支付', () => {
    const s = mkState({ gold: 100 });
    const r0 = spend(s, 0);
    expect(r0.ok).toBe(true);
    expect(r0.state.gold).toBe(100);
    expect(canAfford(s, Number.NaN)).toBe(false);
    expect(canAfford(s, -5)).toBe(true); // 负成本在数学上成立（伤害路径不来自配置）
  });
});

// ---------------------------------------------------------------------------
// QA-AC5-2 波次状态机
// ---------------------------------------------------------------------------
describe('QA-AC5-2 waveStateMachine 状态推进', () => {
  it('IDLE --WAVE_START--> PREP（currentWave=1，准备倒计时=5s）', () => {
    const s = reduce(mkState(), { type: 'WAVE_START' }, config);
    expect(s.waveState).toBe('PREP');
    expect(s.currentWave).toBe(1);
    expect(s.prepRemainingMs).toBe(5000);
  });

  it('PREP --WAVE_START--> SPAWNING（提前开始）', () => {
    const prep = reduce(mkState(), { type: 'WAVE_START' }, config);
    const spawning = reduce(prep, { type: 'WAVE_START' }, config);
    expect(spawning.waveState).toBe('SPAWNING');
    expect(spawning.currentWave).toBe(1);
  });

  it('SPAWNING + 生成完毕 + 场上仍有敌人 → ACTIVE', () => {
    const base = mkState({
      waveState: 'SPAWNING',
      currentWave: 1,
      enemies: [enemy(1)],
      // 第 1 波配置为 normal×8；生成进度须标记为「已全部生成」
      spawnProgress: { waveIndex: 0, groups: [{ enemy: 'normal', spawnedCount: 8, timeSinceLastMs: 0 }] },
    });
    const s = reduce(base, { type: 'ENEMY_SPAWNED' }, config);
    expect(s.waveState).toBe('ACTIVE');
  });

  it('WAVE_CLEARED（第 n<10 波）→ 下一波 PREP，currentWave+1', () => {
    const base = mkState({ waveState: 'ACTIVE', currentWave: 3, enemies: [] });
    const s = reduce(base, { type: 'WAVE_CLEARED' }, config);
    expect(s.waveState).toBe('PREP');
    expect(s.currentWave).toBe(4);
  });

  it('WAVE_CLEARED（最后一波）→ VICTORY', () => {
    const base = mkState({ waveState: 'ACTIVE', currentWave: config.waves.length, enemies: [] });
    const s = reduce(base, { type: 'WAVE_CLEARED' }, config);
    expect(s.waveState).toBe('VICTORY');
    expect(s.currentWave).toBe(config.waves.length);
  });

  it('ENEMY_LEAKED 扣血；生命 ≤0 转 DEFEAT 且钳到 0', () => {
    const s1 = reduce(mkState({ lives: 3 }), { type: 'ENEMY_LEAKED', leakDamage: 2 }, config);
    expect(s1.lives).toBe(1);
    expect(s1.waveState).not.toBe('DEFEAT');
    const s2 = reduce(mkState({ lives: 1 }), { type: 'ENEMY_LEAKED', leakDamage: 2 }, config);
    expect(s2.lives).toBe(0);
    expect(s2.waveState).toBe('DEFEAT');
  });

  it('终局不可再迁移（VICTORY/DEFEAT 上任何事件都原样返回）', () => {
    const v = mkState({ waveState: 'VICTORY' });
    expect(reduce(v, { type: 'WAVE_START' }, config)).toBe(v);
    expect(reduce(v, { type: 'WAVE_CLEARED' }, config)).toBe(v);
    expect(reduce(v, { type: 'ENEMY_LEAKED', leakDamage: 5 }, config)).toBe(v);
  });

  it('非法时序：IDLE 上 WAVE_CLEARED 不生效（仅在 SPAWNING/ACTIVE 生效）', () => {
    const s = reduce(mkState({ waveState: 'IDLE' }), { type: 'WAVE_CLEARED' }, config);
    expect(s.waveState).toBe('IDLE');
  });

  it('重复事件幂等：SPAWNING 上连续两次 WAVE_START 不产生额外迁移', () => {
    const sp = mkState({ waveState: 'SPAWNING', currentWave: 2 });
    expect(reduce(sp, { type: 'WAVE_START' }, config).waveState).toBe('SPAWNING');
  });
});

function enemy(id: number) {
  return {
    id,
    enemyId: 'normal',
    pathDistance: 0,
    hp: 100,
    maxHp: 100,
    spawnOrder: id,
    slowDebuffs: [],
  };
}

// ---------------------------------------------------------------------------
// QA-AC5-3 塔位合法性
// ---------------------------------------------------------------------------
describe('QA-AC5-3 placement 塔位合法性', () => {
  const grid = config.grid;
  const pathTiles = rasterizePath(config.map.pathWaypoints, grid);

  it('路径格非法（on_path）', () => {
    const res = isBuildable(grid, pathTiles, [], { col: 0, row: 1 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('on_path');
  });

  it('越界格非法（out_of_bounds），含负数与超界', () => {
    expect(isBuildable(grid, pathTiles, [], { col: -1, row: 1 }).reason).toBe('out_of_bounds');
    expect(isBuildable(grid, pathTiles, [], { col: 20, row: 1 }).reason).toBe('out_of_bounds');
    expect(isBuildable(grid, pathTiles, [], { col: 5, row: 12 }).reason).toBe('out_of_bounds');
    expect(isBuildable(grid, pathTiles, [], { col: 5, row: -1 }).reason).toBe('out_of_bounds');
  });

  it('已占用格非法（occupied）', () => {
    const towers = [mkTower('arrow', 1, 0, 0)];
    const res = isBuildable(grid, pathTiles, towers, { col: 0, row: 0 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('occupied');
  });

  it('非路径空闲格合法（valid=true, reason=null）', () => {
    for (const t of [{ col: 0, row: 0 }, { col: 19, row: 11 }, { col: 5, row: 2 }] as TileCoord[]) {
      const res = isBuildable(grid, pathTiles, [], t);
      expect(res.valid, `tile ${t.col},${t.row} 应可建造`).toBe(true);
      expect(res.reason).toBeNull();
    }
  });

  it('出生点/基地格非法（spawn_or_base，用内嵌网格的合成配置验证该分支）', () => {
    const towers: TowerRuntime[] = [];
    // 真实配置的 spawn/base 在网格外（-1 / 20），会先被 out_of_bounds 拦下；
    // 为覆盖 spawn_or_base 分支，构造出生点/基地在网格内的合成场景。
    const res = isBuildable(grid, pathTiles, towers, { col: 0, row: 0 }, [0, 0], [5, 0]);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('spawn_or_base');
    const res2 = isBuildable(grid, pathTiles, towers, { col: 5, row: 0 }, [0, 0], [5, 0]);
    expect(res2.reason).toBe('spawn_or_base');
  });

  it('栅格化确定性：两次调用得到同一集合，且路径格数 > 0', () => {
    const again = rasterizePath(config.map.pathWaypoints, grid);
    expect(pathTiles.size).toBeGreaterThan(0);
    expect([...again].sort((a, b) => a - b)).toEqual([...pathTiles].sort((a, b) => a - b));
    // 抽样：tileKey 与 (col,row) 一致
    expect(pathTiles.has(tileKey(grid, 0, 1))).toBe(true);
    expect(pathTiles.has(tileKey(grid, 0, 0))).toBe(false);
  });
});

export { mkState, mkTower, config };
