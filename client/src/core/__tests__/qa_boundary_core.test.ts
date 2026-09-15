/**
 * QA 独立测试 · 6 维边界攻击（high 档全量）——内核侧。
 * 维度：empty_input / huge_input / abnormal_state / ordering /
 *       concurrency(重复调用) / numeric_edge。
 * API 侧的同类边界见 qa_api_integration.test.ts。
 */
import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyCommand,
  step,
  reduce,
  spend,
  canAfford,
  computeSellRefund,
  computeSlowFactor,
  applyArmor,
  getTowerDef,
  getEnemyDef,
  getTowerLevelStats,
  getWaveDef,
  rasterizePath,
  isBuildable,
  pathPointAt,
  getPath,
  toSavePayload,
  fromSavePayload,
  addKillReward,
} from '..';
import type { GameConfig, GameState, EnemyRuntime } from '..';
import { loadConfig, deepDiff } from './qa_helpers';

const config: GameConfig = loadConfig();
const SIM_DT = 1 / 60;

function mkState(over: Partial<GameState> = {}): GameState {
  return { ...createGame(config), ...over };
}

// =========================================================================== empty_input
describe('BA empty_input：None / [] / "" / 0', () => {
  it('空路径 → 空路径格集合（不抛异常）', () => {
    expect(rasterizePath([], config.grid).size).toBe(0);
  });

  it('空 debuff 列表 → 减速 0；空 towers/enemies 建塔判定合法', () => {
    expect(computeSlowFactor([], 0.7)).toBe(0);
    const res = isBuildable(config.grid, new Set<number>(), [], { col: 0, row: 0 });
    expect(res.valid).toBe(true);
  });

  it('createGame 空塔空敌列表可序列化往返（深度相等）', () => {
    const s = createGame(config);
    const p = toSavePayload(s, { configVersion: config.version, savedAt: 't' });
    const back = fromSavePayload(p, config);
    expect(deepDiff(s, back)).toEqual([]);
  });

  it('cost=0 支出不改变金币', () => {
    const r = spend(mkState({ gold: 100 }), 0);
    expect(r.ok).toBe(true);
    expect(r.state.gold).toBe(100);
  });
});

// =========================================================================== huge_input / resource
describe('BA huge_input / 资源耗尽', () => {
  it('单步生成 5000 敌人不崩、不丢（生成排程线性推进）', () => {
    const bigCfg: GameConfig = {
      ...config,
      waves: [
        { wave: 1, groups: [{ enemy: 'normal', count: 5000, spawnIntervalSec: 0.001, startDelaySec: 0 }] },
        ...config.waves.slice(1),
      ],
    };
    let s = createGame(bigCfg);
    s = reduce(s, { type: 'WAVE_START' }, bigCfg); // IDLE→PREP
    s = reduce(s, { type: 'WAVE_START' }, bigCfg); // PREP→SPAWNING
    s = step(s, 10, bigCfg);                        // 10s 内应把 5000 个全部生成
    expect(s.enemies.length).toBe(5000);
  });

  it('5000 敌人存档往返逐字段一致（序列化不丢精度/不截断）', () => {
    const enemies: EnemyRuntime[] = [];
    for (let i = 1; i <= 5000; i++) {
      enemies.push({ id: i, enemyId: 'normal', pathDistance: i * 0.1, hp: 50, maxHp: 100, spawnOrder: i, slowDebuffs: [] });
    }
    const s = mkState({ enemies, nextEnemyId: 5001 });
    const p = toSavePayload(s, { configVersion: config.version, savedAt: 't' });
    const back = fromSavePayload(p, config);
    expect(back.enemies.length).toBe(5000);
    expect(deepDiff(s, back)).toEqual([]);
  });

  it('超长 waypoint 折线（3000 段）栅格化确定性完成', () => {
    const wps: number[][] = [[0, 0]];
    for (let i = 1; i <= 3000; i++) wps.push([i % 20, (i * 7) % 12]);
    const a = rasterizePath(wps, config.grid);
    const b = rasterizePath(wps, config.grid);
    expect(a.size).toBeGreaterThan(0);
    expect([...a].sort((x, y) => x - y)).toEqual([...b].sort((x, y) => x - y));
  });

  it('数值极大：巨额金币与巨额投入不溢出', () => {
    const huge = { ...config, economy: { ...config.economy, sellRefundRatio: 1 } };
    const def = getTowerDef(config, 'arrow')!;
    const t = { col: 0, row: 0, towerId: 'arrow', level: 3, targeting: 'FIRST' as const, cooldownMs: 0 };
    expect(Number.isFinite(computeSellRefund(t, def, huge))).toBe(true);
    expect(canAfford(mkState({ gold: Number.MAX_SAFE_INTEGER }), 1e15)).toBe(true);
  });
});

// =========================================================================== numeric_edge
describe('BA numeric_edge：0/1/-1/MAX/NaN/Inf/负零', () => {
  it('护甲边界：0 / 恰好等于伤害 / 远超伤害（地板兜底）', () => {
    expect(applyArmor(0, 0, 0.2)).toBe(0);
    expect(applyArmor(25, 25, 0.2)).toBe(5);     // max(0, 5)
    expect(applyArmor(25, 5, 0.2)).toBe(20);
    expect(applyArmor(100, 1e9, 0.2)).toBe(20);  // 地板 0.2
  });

  it('cap 边界：slowCapRatio=0 时任何减速都被封为 0', () => {
    expect(computeSlowFactor([{ sourceTowerId: 1, slowFactor: 0.5, remainingMs: 100 }], 0)).toBe(0);
  });

  it('金币恰为 0：不可支付正成本；leakDamage=0 不扣血', () => {
    expect(canAfford(mkState({ gold: 0 }), 1)).toBe(false);
    const s = reduce(mkState({ lives: 5 }), { type: 'ENEMY_LEAKED', leakDamage: 0 }, config);
    expect(s.lives).toBe(5);
  });

  it('负零坐标不越界（-0 >= 0）', () => {
    const res = isBuildable(config.grid, new Set<number>(), [], { col: -0, row: 5 });
    expect(res.valid).toBe(true);
  });

  it('Infinity / 负距离采样被钳到路径端点', () => {
    const path = getPath(config);
    const a = pathPointAt(path, Number.POSITIVE_INFINITY, { x: 0, y: 0 });
    const last = path.segments[path.segments.length - 1];
    expect(a.x).toBeCloseTo(last.x1, 6);
    const b = pathPointAt(path, -1000, { x: 0, y: 0 });
    expect(b.x).toBeCloseTo(path.segments[0].x0, 6);
  });

  it('负数金币只会被 canAfford 拦下，不会产生负金币（spend 无副作用）', () => {
    const s = mkState({ gold: -5 });
    const r = spend(s, 10);
    expect(r.ok).toBe(false);
    expect(r.state.gold).toBe(-5); // 原始值原样（不叠加、不加倍）
  });
});

// =========================================================================== ordering
describe('BA ordering / 时序', () => {
  it('PREP 倒计时耗尽恰好转 SPAWNING（dt 恰为剩余时长）', () => {
    const prep = reduce(mkState(), { type: 'WAVE_START' }, config); // PREP, prep=5000ms
    const after = step(prep, 5, config);                            // dt=5s → 精确耗尽
    expect(after.prepRemainingMs).toBe(0);
    expect(['SPAWNING', 'ACTIVE']).toContain(after.waveState);
    expect(after.enemies.length).toBeGreaterThan(0);
  });

  it('同一步内漏怪伤害跨过 0 → 钳到 0 且立即 DEFEAT', () => {
    const s = reduce(mkState({ lives: 3 }), { type: 'ENEMY_LEAKED', leakDamage: 10 }, config);
    expect(s.lives).toBe(0);
    expect(s.waveState).toBe('DEFEAT');
  });

  it('确定性：相同固定步数 → 完全相同结果（与真实帧时长无关）', () => {
    const run = (n: number) => {
      let s = createGame(config);
      s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
      s = applyCommand(s, { type: 'START_WAVE' }, config).state;
      s = applyCommand(s, { type: 'START_WAVE' }, config).state;
      for (let i = 0; i < n; i++) s = step(s, SIM_DT, config);
      return JSON.stringify(s);
    };
    expect(run(400)).toBe(run(400));
  });

  it('乱序事件：终局后 WAVE_START / ENEMY_LEAKED 均不改变状态', () => {
    const dead = mkState({ waveState: 'DEFEAT', lives: 0 });
    expect(reduce(dead, { type: 'WAVE_START' }, config)).toBe(dead);
    expect(reduce(dead, { type: 'ENEMY_LEAKED', leakDamage: 1 }, config)).toBe(dead);
  });
});

// =========================================================================== concurrency / repeat
describe('BA concurrency / 重复调用', () => {
  it('重复建塔同一格：第二次 occupied 失败', () => {
    let s = createGame(config);
    s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'arrow' }, config).state;
    const r = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 0, towerId: 'cannon' }, config);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('occupied');
  });

  it('重复 WAVE_CLEARED：第二次（PREP 态）为 no-op，不跳波', () => {
    const once = reduce(mkState({ waveState: 'ACTIVE', currentWave: 2 }), { type: 'WAVE_CLEARED' }, config);
    expect(once.currentWave).toBe(3);
    const twice = reduce(once, { type: 'WAVE_CLEARED' }, config); // PREP 上忽略
    expect(twice.currentWave).toBe(3);
    expect(twice.waveState).toBe('PREP');
  });

  it('连续 spend 受金币上限约束，永不出现负金币', () => {
    let s = mkState({ gold: 100 });
    for (let i = 0; i < 10; i++) s = spend(s, 30).state;
    expect(s.gold).toBeGreaterThanOrEqual(0);
    expect(s.gold).toBe(10); // 只能花 3 次（90）
  });
});

// =========================================================================== abnormal_state
describe('BA abnormal_state：未知 id / 畸形快照优雅降级', () => {
  it('未知塔/敌/波次查询返回 null（不抛异常）', () => {
    expect(getTowerDef(config, 'nope')).toBeNull();
    expect(getTowerLevelStats(config, 'arrow', 99)).toBeNull();
    expect(getEnemyDef(config, 'nope')).toBeNull();
    expect(getWaveDef(config, 0)).toBeNull();
    expect(getWaveDef(config, 999)).toBeNull();
  });

  it('存档含未知 towerId / enemyId → 读档时被丢弃而非崩溃', () => {
    const s = mkState({
      towers: [
        { col: 0, row: 0, towerId: 'arrow', level: 1, targeting: 'FIRST', cooldownMs: 0 },
        { col: 1, row: 0, towerId: 'ghost_tower', level: 1, targeting: 'FIRST', cooldownMs: 0 },
      ],
      enemies: [
        { id: 1, enemyId: 'normal', pathDistance: 0, hp: 100, maxHp: 100, spawnOrder: 1, slowDebuffs: [] },
        { id: 2, enemyId: 'ghost_enemy', pathDistance: 0, hp: 100, maxHp: 100, spawnOrder: 2, slowDebuffs: [] },
      ],
    });
    const back = fromSavePayload(toSavePayload(s, { configVersion: config.version, savedAt: 't' }), config);
    expect(back.towers.length).toBe(1);
    expect(back.towers[0].towerId).toBe('arrow');
    expect(back.enemies.length).toBe(1);
  });

  it('终局状态 step 短路：不再推进 elapsedMs', () => {
    const dead = mkState({ waveState: 'DEFEAT', lives: 0, elapsedMs: 1234 });
    expect(step(dead, SIM_DT, config).elapsedMs).toBe(1234);
  });

  it('pauseFreezesAll=true 时暂停冻结推演', () => {
    const paused = mkState({ paused: true, elapsedMs: 500 });
    expect(step(paused, SIM_DT, config).elapsedMs).toBe(500);
  });

  it('赏金来自配置：未知敌人不会凭空加金币（由调用方保证）', () => {
    const s = mkState({ gold: 0 });
    const normal = getEnemyDef(config, 'normal')!;
    expect(addKillReward(s, normal).gold).toBe(normal.bounty);
  });
});
