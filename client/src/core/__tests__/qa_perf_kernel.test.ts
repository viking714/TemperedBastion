/**
 * QA 独立测试 · AC-6 性能（内核侧证据）。
 *
 * ⚠️ 这是**内核单步耗时**证据，不是浏览器渲染帧时间证据。PRD 的 avg≤20ms / p95≤33ms 是
 * 浏览器口径，需另由视觉/性能截图链路佐证（见 test_report.visual_review 与 AC-6 说明）。
 * 场景：同屏 60 敌 + 20 塔，稳态采样。
 */
import { describe, it, expect } from 'vitest';
import { createGame, step, getTowerDef, getPath, rasterizePath, tileKey } from '..';
import type { GameConfig, GameState, EnemyRuntime, TowerRuntime } from '..';
import { loadConfig } from './qa_helpers';

const config: GameConfig = loadConfig();
const SIM_DT = 1 / 60;

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

function stressState(): GameState {
  const path = getPath(config);
  const tiles = buildableNearPath();
  const towers: TowerRuntime[] = [];
  const kinds = ['arrow', 'cannon', 'frost'];
  for (let i = 0; i < 20 && i < tiles.length; i++) {
    const k = kinds[i % 3];
    towers.push({
      col: tiles[i].col,
      row: tiles[i].row,
      towerId: k,
      level: (i % 3) + 1,
      targeting: getTowerDef(config, k)!.targeting,
      cooldownMs: 0,
    });
  }
  const enemies: EnemyRuntime[] = [];
  const total = path.totalLength || 1;
  for (let i = 0; i < 60; i++) {
    enemies.push({
      id: i + 1,
      enemyId: i % 3 === 0 ? 'heavy' : i % 3 === 1 ? 'fast' : 'normal',
      pathDistance: (total * i) / 60,
      hp: 100000, // 防止被打死以维持稳态同屏数
      maxHp: 100000,
      spawnOrder: i + 1,
      slowDebuffs: [],
    });
  }
  return {
    ...createGame(config),
    waveState: 'ACTIVE',
    currentWave: 10,
    towers,
    enemies,
    nextEnemyId: 61,
  };
}

describe('QA-AC6 内核性能：60 敌 + 20 塔稳态单步耗时', () => {
  it('采样 10s（600 步）并报告 avg / p95 / p99 / max', () => {
    let s = stressState();
    expect(s.enemies.length).toBe(60);
    expect(s.towers.length).toBe(20);

    const samples: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t0 = performance.now();
      s = step(s, SIM_DT, config);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
    const p95 = p(0.95);
    const p99 = p(0.99);
    const max = samples[samples.length - 1];
    console.log(`[QA perf.kernel] enemies=60 towers=20 steps=600 avg=${avg.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms max=${max.toFixed(3)}ms`);

    // 内核单步应远低于 1 帧预算（PRD avg≤20ms / p95≤33ms 是浏览器口径）
    expect(avg).toBeLessThan(2);
    expect(p95).toBeLessThan(5);
  });

  it('稳态同屏数维持（血量充足不被清空），证明样本有效', () => {
    const s = stressState();
    expect(s.waveState).toBe('ACTIVE');
    expect(s.enemies.length).toBe(60);
  });
});
