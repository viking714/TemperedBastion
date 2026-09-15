/**
 * QA 独立测试 · AC-7 减速规则 / AC-8 升级与出售返还 / AC-9 三塔三敌差异化行为。
 * 设计依据 prd.json game_rules_spec.targeting_and_damage / towers / enemies / economy。
 */
import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyCommand,
  step,
  getEnemyDef,
  getTowerDef,
  getTowerLevelStats,
  applyArmor,
  computeSlowFactor,
  applySlowDebuff,
  tickSlowDebuffs,
  effectiveSpeed,
  compareTargets,
  selectTarget,
  getPath,
  findTowerAt,
  placementAt,
  reduce,
} from '..';
import type { EnemyRuntime, GameConfig, SlowDebuff, TowerRuntime } from '..';
import { loadConfig } from './qa_helpers';

const config: GameConfig = loadConfig();
const SIM_DT = 1 / 60;

function mkEnemy(id: number, enemyId: string, pathDistance: number, hp = 100): EnemyRuntime {
  return { id, enemyId, pathDistance, hp, maxHp: hp, spawnOrder: id, slowDebuffs: [] };
}
function mkTower(towerId: string, level: number, col = 0, row = 0): TowerRuntime {
  return { col, row, towerId, level, targeting: getTowerDef(config, towerId)!.targeting, cooldownMs: 0 };
}

// --------------------------------------------------------------------------- AC-7
describe('QA-AC7 减速叠加 / 刷新 / 封顶', () => {
  const cap = config.rules.slowCapRatio; // 0.70

  it('幅度不叠加：多 debuff 取最大值（B>A→B；B≤A→A）', () => {
    expect(computeSlowFactor([d(1, 0.3), d(2, 0.5)], cap)).toBeCloseTo(0.5);
    expect(computeSlowFactor([d(1, 0.5), d(2, 0.3)], cap)).toBeCloseTo(0.5);
    expect(computeSlowFactor([d(1, 0.6), d(2, 0.4)], cap)).toBeCloseTo(0.6);
  });

  it('任意时刻实际减速 ≤ slowCapRatio(0.70)', () => {
    expect(computeSlowFactor([d(1, 0.9)], cap)).toBeCloseTo(0.7);
    expect(computeSlowFactor([d(1, 0.5), d(2, 0.95)], cap)).toBeCloseTo(0.7);
    expect(computeSlowFactor([d(1, 0.7)], cap)).toBeCloseTo(0.7);
  });

  it('同源重复施加：只刷新剩余时长并同步幅度，不新增条目', () => {
    const list: SlowDebuff[] = [];
    applySlowDebuff(list, 7, 0.3, 2000);
    expect(list.length).toBe(1);
    applySlowDebuff(list, 7, 0.5, 3000);
    expect(list.length).toBe(1);
    expect(list[0].slowFactor).toBeCloseTo(0.5);
    expect(list[0].remainingMs).toBeCloseTo(3000);
  });

  it('全部 debuff 到期 → 恢复 baseSpeed；有效速度 = base×(1−减速)', () => {
    const list: SlowDebuff[] = [];
    applySlowDebuff(list, 1, 0.5, 100);
    expect(effectiveSpeed(100, list, cap)).toBeCloseTo(50);
    tickSlowDebuffs(list, 60);
    expect(list.length).toBe(1);   // 还剩 40ms
    tickSlowDebuffs(list, 60);
    expect(list.length).toBe(0);   // 到期移除
    expect(effectiveSpeed(100, list, cap)).toBeCloseTo(100);
  });

  it('空 debuff 列表：减速 0、速度不变', () => {
    expect(computeSlowFactor([], cap)).toBe(0);
    expect(effectiveSpeed(120, [], cap)).toBe(120);
  });

  function d(sourceTowerId: number, slowFactor: number, remainingMs = 1000): SlowDebuff {
    return { sourceTowerId, slowFactor, remainingMs };
  }
});

// --------------------------------------------------------------------------- AC-8
describe('QA-AC8 升级与出售返还（走 applyCommand 全链路）', () => {
  it('(a) 升级扣对应升级费，并切换到该等级数值', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
    expect(s.gold).toBe(100); // 150-50
    const r = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.gold).toBe(60); // -40
    expect(findTowerAt(s, 0, 0)!.level).toBe(2);
    expect(getTowerLevelStats(config, 'arrow', 2)!.damage).toBe(40);
    expect(getTowerLevelStats(config, 'arrow', 2)!.range).toBe(132);
  });

  it('(a) 满级后升级失败（max_level）且金币不变', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
    s = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config).state; // →2
    s = { ...s, gold: 1000 };
    s = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config).state; // →3
    expect(findTowerAt(s, 0, 0)!.level).toBe(3);
    const r = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('max_level');
    expect(r.state.gold).toBe(s.gold);
  });

  it('(a) 金币不足时升级失败（insufficient_gold）', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
    s = { ...s, gold: 10 };
    const r = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient_gold');
    expect(findTowerAt(r.state, 0, 0)!.level).toBe(1);
  });

  it('(b) 出售返还并释放格子（建造 50 → 卖 35，格子恢复可建造）', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
    expect(placementAt(s, config, { col: 0, row: 0 }).valid).toBe(false); // 已占用
    const r = applyCommand(s, { type: 'SELL_TOWER', col: 0, row: 0 }, config);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.gold).toBe(135); // 100 + 35
    expect(findTowerAt(s, 0, 0)).toBeNull();
    expect(placementAt(s, config, { col: 0, row: 0 }).valid).toBe(true); // 恢复可建造
  });

  it('(b) 出售已升级塔返还含已投入升级费：精确口径 63（第 2 轮已修复浮点取整）', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state; // -50
    s = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 0 }, config).state;                // -40, 投入 90
    const before = s.gold; // 60
    const r = applyCommand(s, { type: 'SELL_TOWER', col: 0, row: 0 }, config);
    const gained = r.state.gold - before;
    // PRD 精确口径：返还 = floor(90×0.7) = floor(63) = 63。
    // 第 1 轮此处曾实测 62（90×0.7 的 IEEE-754 误差被 floor 放大成 1 金币损失）；
    // 第 2 轮 economy.computeSellRefund 已加相对 epsilon 补偿，现应精确返回 63。
    expect(gained).toBe(63);
  });

  it('出售未升级塔与 computeSellRefund 口径一致', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'frost' }, config).state;
    const r = applyCommand(s, { type: 'SELL_TOWER', col: 0, row: 0 }, config);
    expect(r.state.gold).toBe(150 - 60 + 42);
  });
});

// --------------------------------------------------------------------------- AC-9
describe('QA-AC9 三塔三敌差异化行为', () => {
  it('三种塔 role / 关键字段与配置一致（溅射半径、减速、锁定）', () => {
    expect(getTowerDef(config, 'arrow')!.role).toBe('single_target');
    expect(getTowerLevelStats(config, 'arrow', 1)!.splashRadius).toBeNull();
    expect(getTowerDef(config, 'cannon')!.role).toBe('splash');
    expect(getTowerLevelStats(config, 'cannon', 1)!.splashRadius).toBeGreaterThan(0);
    expect(getTowerDef(config, 'frost')!.role).toBe('slow');
    expect(getTowerLevelStats(config, 'frost', 1)!.slowFactor).toBeGreaterThan(0);
    for (const id of ['arrow', 'cannon', 'frost']) {
      expect(getTowerDef(config, id)!.targeting).toBe('FIRST'); // 默认 FIRST
    }
  });

  it('FIRST 索敌：选路径进度最大者；同进度取生成顺序靠前者', () => {
    const tower = mkTower('arrow', 1, 0, 0);
    const a = mkEnemy(1, 'normal', 40);
    const b = mkEnemy(2, 'normal', 10);
    const st = { ...createGame(config), waveState: 'ACTIVE' as const, currentWave: 1, enemies: [a, b] };
    const picked = selectTarget(st, tower, getTowerLevelStats(config, 'arrow', 1)!, config, getPath(config));
    expect(picked!.id).toBe(1); // pd 40 > 10

    // 比较器语义：a 更优 → 负
    expect(compareTargets(a, 0, b, 0, 'FIRST')).toBeLessThan(0);
    expect(compareTargets(a, 0, b, 0, 'LAST')).toBeGreaterThan(0);
    const c = mkEnemy(3, 'normal', 40); // 同进度、spawnOrder 更大
    expect(compareTargets(a, 0, c, 0, 'FIRST')).toBeLessThan(0);
  });

  it('溅射塔：命中点 splashRadius 内所有敌人受伤（主目标只结算一次）', () => {
    const cannon = mkTower('cannon', 1, 0, 0);
    const st0 = {
      ...createGame(config),
      waveState: 'ACTIVE' as const,
      currentWave: 1,
      towers: [cannon],
      enemies: [mkEnemy(1, 'normal', 40), mkEnemy(2, 'normal', 40), mkEnemy(3, 'normal', 39.5)],
    };
    let st = st0;
    for (let i = 0; i < 30; i++) st = step(st, SIM_DT, config);
    expect(st.enemies.length).toBe(3);
    for (const e of st.enemies) {
      expect(e.hp, `敌人 ${e.id} 应受溅射伤害`).toBeLessThan(100);
    }
  });

  it('减速塔：projectileSpeed=0 即时命中并施加 debuff，敌速按 (1−factor) 下降', () => {
    const frost = mkTower('frost', 1, 0, 0);
    let st = {
      ...createGame(config),
      waveState: 'ACTIVE' as const,
      currentWave: 1,
      towers: [frost],
      enemies: [mkEnemy(1, 'normal', 40)],
    };
    st = step(st, SIM_DT, config);
    expect(st.enemies[0].slowDebuffs.length).toBe(1);
    expect(st.enemies[0].slowDebuffs[0].slowFactor).toBeCloseTo(0.3, 6);
    const pd1 = st.enemies[0].pathDistance;
    st = step(st, SIM_DT, config);
    const delta = st.enemies[0].pathDistance - pd1;
    // 60 px/s × (1−0.3) × (1/60 s) = 0.7 px/步（未减速为 1.0）
    expect(delta).toBeCloseTo(0.7, 6);
  });

  it('三种敌人差异化：hp/speed/armor/bounty/leakDamage 各有区分', () => {
    const normal = getEnemyDef(config, 'normal')!;
    const fast = getEnemyDef(config, 'fast')!;
    const heavy = getEnemyDef(config, 'heavy')!;
    expect(fast.speed).toBeGreaterThan(normal.speed);
    expect(normal.speed).toBeGreaterThan(heavy.speed);
    expect(heavy.hp).toBeGreaterThan(normal.hp);
    expect(heavy.armor).toBeGreaterThan(0);
    expect(normal.armor).toBe(0);
    expect(heavy.bounty).toBeGreaterThan(normal.bounty);
    expect(heavy.leakDamage).toBeGreaterThan(normal.leakDamage);
    // 护甲减伤模型：max(raw−armor, raw×floor)
    expect(applyArmor(25, 5, config.rules.armorFloorRatio)).toBe(20);
    expect(applyArmor(25, 0, config.rules.armorFloorRatio)).toBe(25);
    expect(applyArmor(100, 1000, config.rules.armorFloorRatio)).toBe(20); // 地板比例兜底
  });

  it('漏怪扣血按兵种 leakDamage 差异化（heavy=2）', () => {
    const heavy = getEnemyDef(config, 'heavy')!;
    const s = reduce({ ...createGame(config), lives: 5 }, { type: 'ENEMY_LEAKED', leakDamage: heavy.leakDamage }, config);
    expect(s.lives).toBe(3);
  });
});
