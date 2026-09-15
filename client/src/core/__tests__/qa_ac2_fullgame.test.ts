/**
 * QA 独立测试 · AC-2 十波可玩通 + 胜负双触发（纯内核整局模拟）。
 *
 * 自建自动玩家（不复用 Developer 的 simulation.fullgame.test.ts）：
 *  - VICTORY 路径：沿路径邻接格建塔并升级，打通 10 波；
 *  - DEFEAT  路径：完全不设防，靠漏怪耗尽生命。
 */
import { describe, it, expect } from 'vitest';
import {
  createGame,
  applyCommand,
  step,
  getTowerDef,
  computeUpgradeCost,
  rasterizePath,
  tileKey,
} from '..';
import type { GameConfig, GameState } from '..';
import { loadConfig } from './qa_helpers';

const config: GameConfig = loadConfig();
const SIM_DT = 1 / 60;
const MAX_STEPS = 90000;

/** 选取「与路径格 8 邻接」的空闲格，作为建塔候选（确定性排序）。 */
function buildableNearPath(): { col: number; row: number }[] {
  const grid = config.grid;
  const path = rasterizePath(config.map.pathWaypoints, grid);
  const out: { col: number; row: number }[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (path.has(tileKey(grid, col, row))) continue;
      let adj = false;
      for (let dr = -1; dr <= 1 && !adj; dr++) {
        for (let dc = -1; dc <= 1 && !adj; dc++) {
          if (dc === 0 && dr === 0) continue;
          if (path.has(tileKey(grid, col + dc, row + dr))) adj = true;
        }
      }
      if (adj) out.push({ col, row });
    }
  }
  return out;
}

function autoPlay(build: boolean): { state: GameState; steps: number; maxOnField: number; log: string } {
  let state = createGame(config);
  const tiles = buildableNearPath();
  const order = ['arrow', 'arrow', 'cannon', 'frost'];
  let next = 0;
  let steps = 0;
  let maxOnField = 0;

  while (steps < MAX_STEPS && state.waveState !== 'VICTORY' && state.waveState !== 'DEFEAT') {
    if (build && (state.waveState === 'IDLE' || state.waveState === 'PREP')) {
      // 先尽量建塔（沿路径铺开）
      while (next < tiles.length) {
        const type = order[next % order.length];
        const def = getTowerDef(config, type)!;
        if (state.gold < def.cost) break;
        const tile = tiles[next];
        const r = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: type }, config);
        next += 1;
        if (r.ok) state = r.state;
      }
      // 再升级（留 40 金币余量，避免把建塔资金耗光）
      let upgraded = true;
      while (upgraded) {
        upgraded = false;
        for (const t of state.towers) {
          const def = getTowerDef(config, t.towerId)!;
          const cost = computeUpgradeCost(t, def);
          if (cost !== null && t.level < config.rules.maxTowerLevel && state.gold >= cost + 40) {
            const r = applyCommand(state, { type: 'UPGRADE_TOWER', col: t.col, row: t.row }, config);
            if (r.ok) {
              state = r.state;
              upgraded = true;
              break;
            }
          }
        }
      }
      state = applyCommand(state, { type: 'START_WAVE' }, config).state;
    }
    if (state.waveState === 'IDLE' || state.waveState === 'PREP') {
      state = applyCommand(state, { type: 'START_WAVE' }, config).state;
    }
    state = step(state, SIM_DT, config);
    steps += 1;
    if (state.enemies.length > maxOnField) maxOnField = state.enemies.length;
  }

  const log =
    `steps=${steps} simSec=${(steps * SIM_DT).toFixed(1)} waveState=${state.waveState} ` +
    `wave=${state.currentWave} lives=${state.lives} gold=${state.gold} towers=${state.towers.length} ` +
    `maxOnField=${maxOnField}`;
  return { state, steps, maxOnField, log };
}

describe('QA-AC2 十波完整可玩性（纯内核）', () => {
  it('(a) 建塔防守路径可打到 VICTORY（第 10 波清空且生命 > 0）', () => {
    const { state, log } = autoPlay(true);
    console.log(`[QA fullgame/victory] ${log}`);
    expect(log).toContain('waveState=VICTORY');
    expect(state.waveState).toBe('VICTORY');
    expect(state.lives).toBeGreaterThan(0);
    expect(state.currentWave).toBe(10);
  });

  it('(b) 不设防可触发 DEFEAT（生命耗尽即终局）', () => {
    const { state, steps, log } = autoPlay(false);
    console.log(`[QA fullgame/defeat] ${log}`);
    expect(state.waveState).toBe('DEFEAT');
    expect(state.lives).toBe(0);
    expect(state.currentWave).toBeLessThan(10);
    // DEFEAT 后步进不再推进
    const after = step(step(state, SIM_DT, config), SIM_DT, config);
    expect(after.elapsedMs).toBe(state.elapsedMs);
  });

  it('(a) 打赢后 HUD 关键量自洽：金币非负、塔数 > 0', () => {
    const { state } = autoPlay(true);
    expect(state.gold).toBeGreaterThanOrEqual(0);
    expect(state.towers.length).toBeGreaterThan(0);
  });
});
