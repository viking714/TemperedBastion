/**
 * AC-6（内核侧对照）：同屏 60 敌 + 20 塔的稳态单步耗时预算。
 *
 * 注意边界：Node 侧只能测「逻辑推演的每步耗时」，量不到 Canvas 绘制。
 * 浏览器侧 10s 稳态帧时（均帧 ≤20ms / p95 ≤33ms）由 Tester 在参考 Chrome 上执行。
 * 本测试的价值是：证明逻辑预算相对于 16.7ms 有数量级余量，浏览器侧的瓶颈只可能在绘制。
 *
 * 压力场景完全由 config 驱动：
 *   - 敌人 speed 置 0 → 不会漏怪、不会因终局短路导致测量失真；
 *   - 塔 damage 置 0 → 敌人不会被击杀，同屏人数稳定保持 60。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, findTowerAt } from '../game';
import { buildPath } from '../path';
import { step } from '../simulation';
import type { GameConfig, GameState, TileCoord } from '../types';
import {
  SIM_DT_SEC,
  cloneConfig,
  loadConfig,
  mean,
  percentile,
  tilesCoveringPathDistance,
  towerIdByRole,
} from './fixtures';

/** 单步平均耗时预算（ms）——远低于 16.7ms 的渲染预算。 */
const BUDGET_AVG_MS = 2;
/** 单步 p95 预算（ms）。 */
const BUDGET_P95_MS = 5;
/**
 * 单步 p99 预算（ms），防长尾。
 *
 * 这里**故意不断言 wall-clock 最大值**：单次极大值由 GC 停顿 / JIT 分层编译（tier-up）/
 * 操作系统抢占决定，与算法复杂度无关，断言它只会让套件变成 flaky 的"机器基准测试"。
 * 设计层面的结论由 avg / p95 / p99 承担；而偶发的单帧卡顿本就被固定步长设计吸收
 * （`MAX_STEPS_PER_FRAME = 5` 限制单帧补偿步数 + 渲染插值，宁可慢放也不卡死）。
 * 最大值仍然打印出来，供人工观察趋势。
 */
const BUDGET_P99_MS = 8;

const CONCURRENT_ENEMIES = 60;
const CONCURRENT_TOWERS = 20;
const MEASURED_STEPS = 1200;
const WARMUP_STEPS = 300;

const singleId = towerIdByRole(loadConfig(), 'single_target');

function buildStressState(): { config: GameConfig; state: GameState } {
  const config = cloneConfig((cfg) => {
    cfg.enemies.forEach((enemy) => {
      enemy.speed = 0;
    });
    cfg.towers.forEach((tower) => {
      tower.levels.forEach((level) => {
        level.damage = 0;
      });
    });
  });

  const path = buildPath(config);

  let state: GameState = { ...createGame(config), gold: 1_000_000 };

  // 沿路径均匀铺 20 座塔
  const usedTiles: TileCoord[] = [];
  for (let i = 0; i < CONCURRENT_TOWERS; i++) {
    const distance = (path.totalLength * (i + 0.5)) / CONCURRENT_TOWERS;
    const candidates = tilesCoveringPathDistance(config, distance, singleId);
    for (const tile of candidates) {
      if (usedTiles.some((item) => item.col === tile.col && item.row === tile.row)) continue;
      if (findTowerAt(state, tile.col, tile.row)) continue;
      const result = applyCommand(
        state,
        { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: singleId },
        config,
      );
      if (result.ok) {
        state = result.state;
        usedTiles.push(tile);
        break;
      }
    }
  }

  // 沿路径均匀散布 60 个敌人
  for (let i = 0; i < CONCURRENT_ENEMIES; i++) {
    const def = config.enemies[i % config.enemies.length];
    const hp = def.hp * 1000;
    state.enemies.push({
      id: state.nextEnemyId,
      enemyId: def.id,
      pathDistance: (path.totalLength * i) / CONCURRENT_ENEMIES,
      hp,
      maxHp: hp,
      spawnOrder: state.nextEnemyId,
      slowDebuffs: [],
    });
    state = { ...state, nextEnemyId: state.nextEnemyId + 1 };
  }

  state = { ...state, currentWave: 1, waveState: 'ACTIVE', paused: false };
  return { config, state };
}

describe('perf.stress: 60 敌 + 20 塔 稳态单步预算', () => {
  it('场景规模符合压力要求（60 敌 / 20 塔 / 非终局）', () => {
    const { state } = buildStressState();
    expect(state.enemies.length).toBe(CONCURRENT_ENEMIES);
    expect(state.towers.length).toBe(CONCURRENT_TOWERS);
    expect(state.waveState).toBe('ACTIVE');
  });

  it('单步平均 / p95 / p99 耗时都在预算内', () => {
    const { config, state } = buildStressState();

    for (let i = 0; i < WARMUP_STEPS; i++) step(state, SIM_DT_SEC, config);

    const samples: number[] = [];
    let current = state;
    for (let i = 0; i < MEASURED_STEPS; i++) {
      const started = performance.now();
      current = step(current, SIM_DT_SEC, config);
      samples.push(performance.now() - started);
    }

    const avg = mean(samples);
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    const max = Math.max(...samples);
    // eslint-disable-next-line no-console
    console.log(
      `[perf.core] enemies=${CONCURRENT_ENEMIES} towers=${CONCURRENT_TOWERS} steps=${MEASURED_STEPS} ` +
        `avg=${avg.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms ` +
        `(budget avg<${BUDGET_AVG_MS} p95<${BUDGET_P95_MS} p99<${BUDGET_P99_MS}；max 仅打印不断言)`,
    );

    expect(avg, `平均单步 ${avg.toFixed(3)}ms 超出预算`).toBeLessThan(BUDGET_AVG_MS);
    expect(p95, `p95 单步 ${p95.toFixed(3)}ms 超出预算`).toBeLessThan(BUDGET_P95_MS);
    expect(p99, `p99 单步 ${p99.toFixed(3)}ms 超出预算`).toBeLessThan(BUDGET_P99_MS);
  });

  it('热循环不产生持续增长的对象（数组规模稳定，无泄漏）', () => {
    const { config, state } = buildStressState();
    for (let i = 0; i < 600; i++) step(state, SIM_DT_SEC, config);
    const enemiesAfterWarmup = state.enemies.length;
    const projectilesAfterWarmup = state.projectiles.length;
    for (let i = 0; i < 1200; i++) step(state, SIM_DT_SEC, config);

    expect(state.enemies.length).toBe(enemiesAfterWarmup);
    expect(state.enemies.length).toBe(CONCURRENT_ENEMIES);
    // 子弹数在稳态下有界（发射即命中即回收），不会无限累积
    expect(state.projectiles.length).toBeLessThanOrEqual(state.towers.length * 2 + projectilesAfterWarmup);
  });

  it('20 塔确实都在工作（存在子弹或已命中的 debuff/击杀计数归零路径）', () => {
    const { config, state } = buildStressState();
    for (let i = 0; i < 120; i++) step(state, SIM_DT_SEC, config);
    // damage=0 时敌人不死，子弹在飞行/命中的循环里 —— 至少曾经产生过子弹
    expect(state.nextProjectileId).toBeGreaterThan(1);
  });
});
