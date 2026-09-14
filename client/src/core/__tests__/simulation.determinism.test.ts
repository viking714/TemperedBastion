/**
 * AC-6（内核侧）：固定步长确定性 / 帧率无关性。
 *
 * 「掉帧不改变推演结果」的可判定含义：**给定相同的固定步数，推演结果完全一致**，
 * 与真实帧时长如何分组无关（帧长只决定一帧内跑几步，不改变每步结果）。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from '../game';
import { step } from '../simulation';
import { toSavePayload } from '../serialize';
import type { GameConfig, GameState } from '../types';
import { SIM_DT_SEC, loadConfig, planTowerTiles, towerIdByRole } from './fixtures';

const config: GameConfig = loadConfig();

/** 一批刻意不规则的真实帧长（ms），用于模拟掉帧/长帧。 */
const IRREGULAR_FRAME_MS = [16.7, 33.4, 8.2, 50.1, 4.9, 100.3, 12.5, 26.8, 3.3, 71.2, 16.6, 41.0];
const STEP_MS = SIM_DT_SEC * 1000;

function scenarioState(): GameState {
  const single = towerIdByRole(config, 'single_target');
  const splash = towerIdByRole(config, 'splash');
  const slow = towerIdByRole(config, 'slow');
  const tiles = planTowerTiles(config, single, 6);
  const rotation = [single, splash, single, slow];

  let state = createGame(config);
  state = { ...state, gold: 600 };
  tiles.forEach((tile, index) => {
    const result = applyCommand(
      state,
      { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: rotation[index % rotation.length] },
      config,
    );
    if (result.ok) state = result.state;
  });
  state = applyCommand(state, { type: 'START_WAVE' }, config).state;
  state = applyCommand(state, { type: 'START_WAVE' }, config).state;
  return state;
}

/** 直接跑 N 个固定步。 */
function runFixedSteps(start: GameState, steps: number): GameState {
  let state = start;
  for (let i = 0; i < steps; i++) state = step(state, SIM_DT_SEC, config);
  return state;
}

/** 用「累加器 + 不规则帧长」跑，直到累计 N 个固定步。 */
function runWithAccumulator(start: GameState, steps: number): GameState {
  let state = start;
  let accumulatorMs = 0;
  let executed = 0;
  let frame = 0;
  while (executed < steps) {
    accumulatorMs += IRREGULAR_FRAME_MS[frame % IRREGULAR_FRAME_MS.length];
    frame += 1;
    while (accumulatorMs >= STEP_MS && executed < steps) {
      state = step(state, SIM_DT_SEC, config);
      accumulatorMs -= STEP_MS;
      executed += 1;
    }
  }
  return state;
}

describe('simulation.determinism: 固定步长确定性', () => {
  it('相同初态 + 相同步数 → 完全相同（可重复）', () => {
    const first = toSavePayload(runFixedSteps(scenarioState(), 1500), { configVersion: 'v', savedAt: 't' });
    const second = toSavePayload(runFixedSteps(scenarioState(), 1500), { configVersion: 'v', savedAt: 't' });
    expect(second).toStrictEqual(first);
  });

  it('step 不读 state.speedMultiplier（倍速由外壳喂更多 delta 实现，不改变每步语义）', () => {
    // 注意 1：两份初态必须各自独立构造——浅拷贝会共享 enemies/projectiles 数组，
    //         否则先跑的那份会把数组改掉，污染后跑的那份（测试自身的坑）。
    // 注意 2：speedMultiplier 本身是状态字段，会比出差异；比较前把它归一，
    //         并单独断言 step 没有改过它（这正是「倍速不影响每步语义」的含义）。
    const a = runFixedSteps({ ...scenarioState(), speedMultiplier: 1 }, 600);
    const b = runFixedSteps({ ...scenarioState(), speedMultiplier: 2 }, 600);

    expect(b.speedMultiplier).toBe(2); // step 未改写
    expect(a.speedMultiplier).toBe(1);

    const meta = { configVersion: 'v', savedAt: 't' };
    expect(toSavePayload({ ...b, speedMultiplier: 1 }, meta)).toStrictEqual(toSavePayload(a, meta));
  });

  it('暂停（pauseFreezesAll=true）时 step 不推进任何状态', () => {
    const base = { ...scenarioState(), paused: true };
    const before = toSavePayload(base, { configVersion: 'v', savedAt: 't' });
    const after = runFixedSteps(base, 300);
    expect(after).toBe(base);
    expect(toSavePayload(after, { configVersion: 'v', savedAt: 't' })).toStrictEqual(before);
  });
});

describe('simulation.determinism: 帧率无关（掉帧不改变推演结果）', () => {
  it('不规则帧长分组 vs 直接跑：相同步数结果完全一致', () => {
    const steps = 1800;
    const direct = runFixedSteps(scenarioState(), steps);
    const chunked = runWithAccumulator(scenarioState(), steps);
    expect(toSavePayload(chunked, { configVersion: 'v', savedAt: 't' })).toStrictEqual(
      toSavePayload(direct, { configVersion: 'v', savedAt: 't' }),
    );
  });

  it('累计模拟时长 = 步数 × 固定步长（与真实帧长无关）', () => {
    const steps = 900;
    const direct = runFixedSteps(scenarioState(), steps);
    const chunked = runWithAccumulator(scenarioState(), steps);
    const expectedMs = steps * STEP_MS;
    expect(direct.elapsedMs).toBeCloseTo(expectedMs, 6);
    expect(chunked.elapsedMs).toBeCloseTo(expectedMs, 6);
    expect(chunked.elapsedMs).toBeCloseTo(direct.elapsedMs, 10);
  });

  it('不同帧长分组下，波次状态机也在同一时刻迁移', () => {
    const steps = 1200;
    const direct = runFixedSteps(scenarioState(), steps);
    const chunked = runWithAccumulator(scenarioState(), steps);
    expect(chunked.waveState).toBe(direct.waveState);
    expect(chunked.currentWave).toBe(direct.currentWave);
    expect(chunked.enemies.length).toBe(direct.enemies.length);
    expect(chunked.lives).toBe(direct.lives);
    expect(chunked.gold).toBe(direct.gold);
  });

  it('长时间推演不发散（两次运行的敌人/子弹快照逐字段一致）', () => {
    const a = runFixedSteps(scenarioState(), 3000);
    const b = runFixedSteps(scenarioState(), 3000);
    expect(a.enemies).toStrictEqual(b.enemies);
    expect(a.projectiles).toStrictEqual(b.projectiles);
    expect(a.spawnProgress).toStrictEqual(b.spawnProgress);
  });
});
