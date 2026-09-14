/**
 * AC-5 必测块 2：波次状态机。
 * IDLE → PREP → SPAWNING → ACTIVE →（下一波 PREP | VICTORY），生命 ≤0 → DEFEAT。
 */
import { describe, expect, it } from 'vitest';
import { createGame } from '../game';
import { getWaveDef } from '../config';
import { isSpawnComplete } from '../spawn';
import { isTerminal, reduce } from '../waveStateMachine';
import type { EnemyRuntime, GameConfig, GameState } from '../types';
import { SIM_DT_SEC, loadConfig } from './fixtures';
import { step } from '../simulation';

const config: GameConfig = loadConfig();

function makeEnemy(config: GameConfig, index = 1): EnemyRuntime {
  return {
    id: index,
    enemyId: config.enemies[0].id,
    pathDistance: 10,
    hp: 50,
    maxHp: 50,
    spawnOrder: index,
    slowDebuffs: [],
  };
}

/** 把当前波的生成进度直接置为「已全部生成」。 */
function markSpawningComplete(state: GameState, config: GameConfig): GameState {
  const waveDef = getWaveDef(config, state.currentWave);
  if (!waveDef) throw new Error('当前波次无定义');
  state.spawnProgress.groups.forEach((group, index) => {
    group.spawnedCount = waveDef.groups[index].count;
  });
  return state;
}

describe('waveStateMachine: 合法迁移', () => {
  it('IDLE --WAVE_START--> PREP（进入第 1 波准备期，倒计时取自配置）', () => {
    const idle = createGame(config);
    expect(idle.waveState).toBe('IDLE');
    expect(idle.currentWave).toBe(0);

    const prep = reduce(idle, { type: 'WAVE_START' }, config);
    expect(prep.waveState).toBe('PREP');
    expect(prep.currentWave).toBe(1);
    expect(prep.prepRemainingMs).toBe(config.rules.prepCountdownSec * 1000);
    // 原对象不被修改（reducer 返回浅拷贝）
    expect(idle.waveState).toBe('IDLE');
  });

  it('PREP --WAVE_START--> SPAWNING，且生成进度按当前波次重建', () => {
    let state = createGame(config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    state = reduce(state, { type: 'WAVE_START' }, config);

    expect(state.waveState).toBe('SPAWNING');
    const waveDef = getWaveDef(config, 1);
    expect(state.spawnProgress.waveIndex).toBe(0);
    expect(state.spawnProgress.groups).toHaveLength(waveDef?.groups.length ?? -1);
    expect(state.spawnProgress.groups.every((group) => group.spawnedCount === 0)).toBe(true);
  });

  it('SPAWNING --(生成完毕且场上仍有敌人)--> ACTIVE', () => {
    let state = createGame(config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    state = markSpawningComplete(state, config);
    expect(state.waveState).toBe('SPAWNING'); // 场上无敌 → 还不该进 ACTIVE

    state.enemies.push(makeEnemy(config));
    state = reduce(state, { type: 'ENEMY_SPAWNED' }, config);
    expect(state.waveState).toBe('ACTIVE');
  });

  it('ACTIVE --WAVE_CLEARED--> 下一波 PREP', () => {
    let state = createGame(config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    state = markSpawningComplete(state, config);
    state.enemies.push(makeEnemy(config));
    state = reduce(state, { type: 'ENEMY_SPAWNED' }, config);

    state = reduce(state, { type: 'WAVE_CLEARED' }, config);
    expect(state.waveState).toBe('PREP');
    expect(state.currentWave).toBe(2);
    expect(state.prepRemainingMs).toBe(config.rules.prepCountdownSec * 1000);
  });

  it('第 10 波清空 --> VICTORY', () => {
    const lastWave = config.waves.length;
    let state: GameState = {
      ...createGame(config),
      currentWave: lastWave,
      waveState: 'ACTIVE',
    };
    state.spawnProgress.waveIndex = lastWave - 1;
    state = markSpawningComplete(state, config);
    state.enemies.push(makeEnemy(config));

    const next = reduce(state, { type: 'WAVE_CLEARED' }, config);
    expect(next.waveState).toBe('VICTORY');
    expect(next.currentWave).toBe(lastWave);
  });

  it('生命 ≤ 0 --> DEFEAT（且生命夹到 0）', () => {
    let state: GameState = { ...createGame(config), waveState: 'ACTIVE', currentWave: 1 };
    state = { ...state, lives: 1 };

    const next = reduce(state, { type: 'ENEMY_LEAKED', leakDamage: 1 }, config);
    expect(next.waveState).toBe('DEFEAT');
    expect(next.lives).toBe(0);

    // 再漏一只也不会变成负数
    const again = reduce({ ...next, waveState: 'ACTIVE' }, { type: 'ENEMY_LEAKED', leakDamage: 3 }, config);
    expect(again.lives).toBeGreaterThanOrEqual(0);
  });

  it('生命仍 > 0 的漏怪不触发 DEFEAT', () => {
    const state: GameState = { ...createGame(config), waveState: 'ACTIVE', currentWave: 1, lives: 5 };
    const next = reduce(state, { type: 'ENEMY_LEAKED', leakDamage: 2 }, config);
    expect(next.waveState).toBe('ACTIVE');
    expect(next.lives).toBe(3);
  });

  it('终局状态吸收一切后续事件（不再迁移）', () => {
    const victory: GameState = { ...createGame(config), waveState: 'VICTORY', currentWave: config.waves.length };
    expect(reduce(victory, { type: 'WAVE_START' }, config)).toBe(victory);
    expect(reduce(victory, { type: 'WAVE_CLEARED' }, config)).toBe(victory);

    const defeat: GameState = { ...createGame(config), waveState: 'DEFEAT', lives: 0 };
    expect(reduce(defeat, { type: 'WAVE_START' }, config)).toBe(defeat);
    expect(isTerminal(defeat.waveState)).toBe(true);
  });

  it('IDLE 下非法事件（WAVE_CLEARED）不产生迁移', () => {
    const state: GameState = { ...createGame(config), currentWave: 1 };
    expect(reduce(state, { type: 'WAVE_CLEARED' }, config).waveState).toBe('IDLE');
  });
});

describe('waveStateMachine: 与 step 的联动', () => {
  it('PREP 倒计时走完后自动进入 SPAWNING，并按 spawnInterval 出怪', () => {
    let state = createGame(config);
    state = reduce(state, { type: 'WAVE_START' }, config);
    expect(state.waveState).toBe('PREP');

    const prepSteps = Math.ceil((config.rules.prepCountdownSec * 1000) / (SIM_DT_SEC * 1000)) + 2;
    for (let i = 0; i < prepSteps; i++) state = step(state, SIM_DT_SEC, config);

    expect(state.waveState).toBe('SPAWNING');
    expect(state.prepRemainingMs).toBe(0);

    // 第一个分组的 startDelaySec 为 0 → 立即出第一个敌人
    expect(state.enemies.length).toBeGreaterThanOrEqual(1);
    expect(isSpawnComplete(state.spawnProgress, getWaveDef(config, 1))).toBe(false);
  });
});
