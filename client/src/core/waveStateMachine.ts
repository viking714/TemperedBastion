/**
 * 波次状态机（AC-5 必测块 2）—— 纯 reducer：reduce(state, event, config) → state。
 *
 * 状态迁移：
 *   IDLE    --WAVE_START-->  PREP（第 1 波准备倒计时）
 *   PREP    --WAVE_START-->  SPAWNING（倒计时结束或玩家「提前开始」）
 *   SPAWNING --(生成完毕且场上仍有敌人)--> ACTIVE
 *   SPAWNING/ACTIVE --WAVE_CLEARED--> 下一波 PREP  |  第 10 波清空 → VICTORY
 *   任意状态 --(生命 ≤ 0)-->  DEFEAT（终局，此后不再迁移）
 *
 * reducer 只在真正发生变更时返回**新的浅拷贝对象**（数组仍共享，交由 step 原地复用），
 * 未变更时原样返回入参——既保持可测试性，又避免热循环里的大拷贝。
 */
import { getWaveDef } from './config';
import { MS_PER_SEC } from './units';
import { createSpawnProgress, isSpawnComplete } from './spawn';
import type { GameConfig, GameState, WaveState } from './types';

export type WaveEvent =
  | { type: 'WAVE_START' }
  | { type: 'ENEMY_SPAWNED' }
  | { type: 'ENEMY_DEAD' }
  | { type: 'ENEMY_LEAKED'; leakDamage: number }
  | { type: 'WAVE_CLEARED' };

export const TERMINAL_STATES: readonly WaveState[] = ['VICTORY', 'DEFEAT'];

export function isTerminal(waveState: WaveState): boolean {
  return waveState === 'VICTORY' || waveState === 'DEFEAT';
}

export function isRunning(waveState: WaveState): boolean {
  return waveState === 'SPAWNING' || waveState === 'ACTIVE';
}

/** 本波是否已清空（全部生成完毕 + 场上无存活敌人）。 */
export function isWaveCleared(state: GameState, config: GameConfig): boolean {
  const waveDef = getWaveDef(config, state.currentWave);
  if (!waveDef) return false;
  return isSpawnComplete(state.spawnProgress, waveDef) && state.enemies.length === 0;
}

function enterPrep(state: GameState, config: GameConfig, waveNumber: number): GameState {
  return {
    ...state,
    currentWave: waveNumber,
    waveState: 'PREP',
    prepRemainingMs: config.rules.prepCountdownSec * MS_PER_SEC,
    spawnProgress: createSpawnProgress(config, waveNumber - 1),
  };
}

export function reduce(state: GameState, event: WaveEvent, config: GameConfig): GameState {
  if (isTerminal(state.waveState)) return state;

  let next = state;

  if (event.type === 'ENEMY_LEAKED') {
    const lives = state.lives - event.leakDamage;
    next = { ...state, lives };
    if (lives <= 0) {
      // 生命耗尽的瞬间立即 DEFEAT：停止继续出怪与攻击结算（step 会据此提前返回）。
      return { ...next, lives: 0, waveState: 'DEFEAT' };
    }
  }

  if (event.type === 'WAVE_START') {
    if (next.waveState === 'IDLE') {
      return enterPrep(next, config, 1);
    }
    if (next.waveState === 'PREP') {
      return {
        ...next,
        waveState: 'SPAWNING',
        spawnProgress: createSpawnProgress(config, next.currentWave - 1),
      };
    }
    return next;
  }

  if (event.type === 'WAVE_CLEARED') {
    if (next.waveState !== 'SPAWNING' && next.waveState !== 'ACTIVE') return next;
    const totalWaves = config.waves.length;
    if (next.currentWave >= totalWaves) {
      return { ...next, currentWave: totalWaves, waveState: 'VICTORY' };
    }
    return enterPrep(next, config, next.currentWave + 1);
  }

  // SPAWNING → ACTIVE：本波已全部生成、但场上仍有存活敌人。
  if (next.waveState === 'SPAWNING') {
    const waveDef = getWaveDef(config, next.currentWave);
    if (isSpawnComplete(next.spawnProgress, waveDef) && next.enemies.length > 0) {
      return { ...next, waveState: 'ACTIVE' };
    }
  }

  return next;
}
