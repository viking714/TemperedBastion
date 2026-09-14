/**
 * AC-2（工程侧证据）：整局无浏览器模拟。
 *
 * 证明两条终局路径都真实可达：
 *   (a) 「十波打穿 → VICTORY」——由一个读取 config 的自动玩家建塔/升级；
 *   (b) 「生命耗尽 → DEFEAT」——完全不建塔，任敌人漏进基地。
 *
 * 注意：这里的自动玩家只是**测试脚手架**，不代表真实玩家的最优解；
 * 它存在的意义是证明「配置 + 内核在无浏览器环境下能跑完整局并收敛到终局」。
 */
import { describe, expect, it } from 'vitest';
import { getTowerDef } from '../config';
import { computeUpgradeCost } from '../economy';
import { applyCommand, createGame, findTowerAt } from '../game';
import { step } from '../simulation';
import { isTerminal } from '../waveStateMachine';
import type { GameCommand, GameConfig, GameState, TileCoord } from '../types';
import { SIM_DT_SEC, loadConfig, planTowerTiles, towerIdByRole } from './fixtures';

const config: GameConfig = loadConfig();

const MAX_STEPS = 60_000; // 1000 秒模拟时间，远超整局所需

const single = towerIdByRole(config, 'single_target');
const splash = towerIdByRole(config, 'splash');
const slow = towerIdByRole(config, 'slow');

/** 自动玩家的选址（由配置贪心算出，不写死坐标）。 */
const BUILD_TILES: TileCoord[] = planTowerTiles(config, single, 24);
const BUILD_ROTATION = [single, single, single, splash, slow, single, single, splash, slow];

/** 挑一个「现在能做的」动作：先建塔，再挑最便宜的可行升级。 */
function planAction(state: GameState): GameCommand | null {
  for (let i = 0; i < BUILD_TILES.length; i++) {
    const tile = BUILD_TILES[i];
    if (findTowerAt(state, tile.col, tile.row)) continue;
    const towerId = BUILD_ROTATION[i % BUILD_ROTATION.length];
    const def = getTowerDef(config, towerId);
    if (!def || state.gold < def.cost) continue;
    return { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId };
  }

  let best: { col: number; row: number; cost: number } | null = null;
  for (const tower of state.towers) {
    const def = getTowerDef(config, tower.towerId);
    if (!def) continue;
    const cost = computeUpgradeCost(tower, def);
    if (cost === null || state.gold < cost) continue;
    if (best === null || cost < best.cost) best = { col: tower.col, row: tower.row, cost };
  }
  if (best) return { type: 'UPGRADE_TOWER', col: best.col, row: best.row };
  return null;
}

/** 把当前金币尽可能花掉（建塔 / 升级）。 */
function autoSpend(state: GameState): GameState {
  let current = state;
  for (let guard = 0; guard < 500; guard++) {
    const command = planAction(current);
    if (!command) break;
    const result = applyCommand(current, command, config);
    if (!result.ok) break;
    current = result.state;
  }
  return current;
}

interface RunResult {
  state: GameState;
  steps: number;
  maxEnemiesOnField: number;
  maxTowers: number;
}

function runFullGame(autoPlay: boolean): RunResult {
  let state = createGame(config);
  let steps = 0;
  let maxEnemiesOnField = 0;
  let maxTowers = 0;

  for (let i = 0; i < MAX_STEPS; i++) {
    if (isTerminal(state.waveState)) break;

    // 无论是否自动建塔，都要把波次开起来（否则永远停在 IDLE）
    if (state.waveState === 'IDLE' || state.waveState === 'PREP') {
      if (autoPlay) state = autoSpend(state);
      if (!isTerminal(state.waveState)) {
        const started = applyCommand(state, { type: 'START_WAVE' }, config);
        if (started.ok) state = started.state;
      }
    }

    state = step(state, SIM_DT_SEC, config);
    steps += 1;
    maxEnemiesOnField = Math.max(maxEnemiesOnField, state.enemies.length);
    maxTowers = Math.max(maxTowers, state.towers.length);
  }

  return { state, steps, maxEnemiesOnField, maxTowers };
}

describe('AC-2: 十波可打通 → VICTORY', () => {
  const run = runFullGame(true);

  it('终局为 VICTORY，且生命值 > 0', () => {
    expect(run.state.waveState).toBe('VICTORY');
    expect(run.state.lives).toBeGreaterThan(0);
  });

  it('推进到最后一波（currentWave = 波次总数）', () => {
    expect(run.state.currentWave).toBe(config.waves.length);
  });

  it('确实建了塔并升级过（不是靠空场获胜）', () => {
    expect(run.maxTowers).toBeGreaterThanOrEqual(config.towers.length);
    const leveled = run.state.towers.some((tower) => tower.level > 1);
    expect(leveled).toBe(true);
  });

  it('整局模拟时长在合理范围内（未触达步数上限）', () => {
    expect(run.steps).toBeLessThan(MAX_STEPS);
    expect(run.state.elapsedMs).toBeGreaterThan(0);
  });

  it('打印整局摘要（便于人工核对平衡）', () => {
    const seconds = (run.state.elapsedMs / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(
      `[fullgame/victory] steps=${run.steps} simSec=${seconds} lives=${run.state.lives} gold=${run.state.gold} ` +
        `towers=${run.state.towers.length} maxOnField=${run.maxEnemiesOnField}`,
    );
    expect(true).toBe(true);
  });
});

describe('AC-2: 生命耗尽 → DEFEAT', () => {
  const run = runFullGame(false);

  it('终局为 DEFEAT，生命值归零', () => {
    expect(run.state.waveState).toBe('DEFEAT');
    expect(run.state.lives).toBe(0);
  });

  it('失败发生在十波之内（没建塔必然漏怪）', () => {
    expect(run.state.currentWave).toBeGreaterThanOrEqual(1);
    expect(run.state.currentWave).toBeLessThanOrEqual(config.waves.length);
  });

  it('进入 DEFEAT 后不再继续出怪与结算', () => {
    const frozen = run.state;
    const after = step(frozen, SIM_DT_SEC, config);
    expect(after).toBe(frozen);
    expect(after.enemies).toStrictEqual(frozen.enemies);
  });

  it('打印整局摘要（便于人工核对失败时点）', () => {
    const seconds = (run.state.elapsedMs / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(
      `[fullgame/defeat] steps=${run.steps} simSec=${seconds} waveReached=${run.state.currentWave} lives=${run.state.lives}`,
    );
    expect(run.state.waveState).toBe('DEFEAT');
  });
});
