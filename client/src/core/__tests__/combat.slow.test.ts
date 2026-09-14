/**
 * AC-7：减速叠加 / 刷新 / 封顶 / 到期恢复。
 */
import { describe, expect, it } from 'vitest';
import { applySlowDebuff, computeSlowFactor, effectiveSpeed, tickSlowDebuffs } from '../combat';
import { applyCommand, createGame } from '../game';
import { step } from '../simulation';
import type { GameConfig, EnemyRuntime, GameState, SlowDebuff } from '../types';
import { SIM_DT_SEC, loadConfig, requireTower, tilesCoveringPathDistance } from './fixtures';

const config: GameConfig = loadConfig();
const cap = config.rules.slowCapRatio;

describe('combat.slow: 幅度不叠加、取最强', () => {
  it('不同来源取最大幅度（B > A → 取 B）', () => {
    const debuffs: SlowDebuff[] = [
      { sourceTowerId: 1, slowFactor: 0.3, remainingMs: 1000 },
      { sourceTowerId: 2, slowFactor: 0.5, remainingMs: 1000 },
    ];
    expect(computeSlowFactor(debuffs, 1)).toBeCloseTo(0.5, 10);
  });

  it('不同来源取最大幅度（B ≤ A → 仍取 A）', () => {
    const debuffs: SlowDebuff[] = [
      { sourceTowerId: 1, slowFactor: 0.5, remainingMs: 1000 },
      { sourceTowerId: 2, slowFactor: 0.3, remainingMs: 1000 },
    ];
    expect(computeSlowFactor(debuffs, 1)).toBeCloseTo(0.5, 10);
  });

  it('三条 debuff 也不线性叠加', () => {
    const debuffs: SlowDebuff[] = [
      { sourceTowerId: 1, slowFactor: 0.2, remainingMs: 1000 },
      { sourceTowerId: 2, slowFactor: 0.2, remainingMs: 1000 },
      { sourceTowerId: 3, slowFactor: 0.2, remainingMs: 1000 },
    ];
    expect(computeSlowFactor(debuffs, 1)).toBeCloseTo(0.2, 10);
  });

  it('无 debuff 时为 0', () => {
    expect(computeSlowFactor([], cap)).toBe(0);
  });
});

describe('combat.slow: 封顶 slowCapRatio', () => {
  it('最强幅度超过 cap 时被截断到 cap', () => {
    const debuffs: SlowDebuff[] = [{ sourceTowerId: 1, slowFactor: 0.95, remainingMs: 1000 }];
    expect(computeSlowFactor(debuffs, cap)).toBeCloseTo(cap, 10);
  });

  it('配置的 cap 改变时结果随之改变（数值来自 config）', () => {
    const debuffs: SlowDebuff[] = [{ sourceTowerId: 1, slowFactor: 0.6, remainingMs: 1000 }];
    expect(computeSlowFactor(debuffs, 0.1)).toBeCloseTo(0.1, 10);
    expect(computeSlowFactor(debuffs, 0.9)).toBeCloseTo(0.6, 10);
  });

  it('任意组合下实际减速都不超过 cap', () => {
    const debuffs: SlowDebuff[] = [
      { sourceTowerId: 1, slowFactor: 0.7, remainingMs: 1000 },
      { sourceTowerId: 2, slowFactor: 0.99, remainingMs: 1000 },
      { sourceTowerId: 3, slowFactor: 0.85, remainingMs: 1000 },
    ];
    expect(computeSlowFactor(debuffs, cap)).toBeLessThanOrEqual(cap);
  });
});

describe('combat.slow: 同一来源重复施加只刷时长', () => {
  it('同源二次施加 → 不新增条目，时长刷满且幅度同步为最新', () => {
    const debuffs: SlowDebuff[] = [];
    applySlowDebuff(debuffs, 7, 0.3, 2000);
    expect(debuffs).toHaveLength(1);

    tickSlowDebuffs(debuffs, 1500);
    expect(debuffs[0].remainingMs).toBeCloseTo(500, 10);

    applySlowDebuff(debuffs, 7, 0.5, 3000);
    expect(debuffs).toHaveLength(1);
    expect(debuffs[0].remainingMs).toBeCloseTo(3000, 10);
    expect(debuffs[0].slowFactor).toBeCloseTo(0.5, 10);
    expect(computeSlowFactor(debuffs, cap)).toBeCloseTo(0.5, 10);
  });

  it('不同来源各占一条', () => {
    const debuffs: SlowDebuff[] = [];
    applySlowDebuff(debuffs, 1, 0.3, 2000);
    applySlowDebuff(debuffs, 2, 0.4, 2000);
    expect(debuffs).toHaveLength(2);
    expect(computeSlowFactor(debuffs, cap)).toBeCloseTo(0.4, 10);
  });
});

describe('combat.slow: 到期恢复 baseSpeed', () => {
  it('全部 debuff 到期后实际减速回到 0', () => {
    const debuffs: SlowDebuff[] = [];
    applySlowDebuff(debuffs, 1, 0.5, 1000);
    applySlowDebuff(debuffs, 2, 0.4, 500);

    tickSlowDebuffs(debuffs, 500);
    expect(debuffs).toHaveLength(1); // 500ms 的那条到期
    expect(computeSlowFactor(debuffs, cap)).toBeCloseTo(0.5, 10);

    tickSlowDebuffs(debuffs, 500);
    expect(debuffs).toHaveLength(0);
    expect(computeSlowFactor(debuffs, cap)).toBe(0);
    expect(effectiveSpeed(120, debuffs, cap)).toBeCloseTo(120, 10);
  });

  it('有效速度 = baseSpeed × (1 − 实际减速)', () => {
    const debuffs: SlowDebuff[] = [{ sourceTowerId: 1, slowFactor: 0.25, remainingMs: 1000 }];
    expect(effectiveSpeed(100, debuffs, cap)).toBeCloseTo(75, 10);
  });

  it('减速推进时保持顺序、零分配（数组长度按到期收缩）', () => {
    const debuffs: SlowDebuff[] = [];
    applySlowDebuff(debuffs, 1, 0.1, 100);
    applySlowDebuff(debuffs, 2, 0.2, 300);
    applySlowDebuff(debuffs, 3, 0.3, 200);
    tickSlowDebuffs(debuffs, 150);
    expect(debuffs.map((d) => d.sourceTowerId)).toEqual([2, 3]);
  });
});

describe('combat.slow: 与推演的集成（冰塔确实拖慢敌人）', () => {
  const frost = requireTower(config, 'frost');

  function runWithFrost(withFrost: boolean, steps: number): EnemyRuntime | null {
    const [tile] = tilesCoveringPathDistance(config, 0, frost.id);
    let state: GameState = createGame(config);
    if (withFrost) {
      const built = applyCommand(
        state,
        { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: frost.id },
        config,
      );
      expect(built.ok).toBe(true);
      state = built.state;
    }
    state = { ...state, currentWave: 1, waveState: 'ACTIVE' };
    const def = config.enemies[0];
    state.enemies.push({
      id: 1,
      enemyId: def.id,
      pathDistance: 0,
      hp: def.hp,
      maxHp: def.hp,
      spawnOrder: 1,
      slowDebuffs: [],
    });
    for (let i = 0; i < steps; i++) state = step(state, SIM_DT_SEC, config);
    return state.enemies.length > 0 ? state.enemies[0] : null;
  }

  it('同一步数下，被冰塔命中的敌人推进距离更小', () => {
    const steps = 180;
    const plain = runWithFrost(false, steps);
    const chilled = runWithFrost(true, steps);
    expect(plain).not.toBeNull();
    expect(chilled).not.toBeNull();
    expect(chilled!.pathDistance).toBeLessThan(plain!.pathDistance);
    expect(chilled!.slowDebuffs.length).toBeGreaterThan(0);
  });

  it('冰塔按配置的 slowFactor 施加 debuff（幅度不超过 cap）', () => {
    const steps = 90;
    const chilled = runWithFrost(true, steps);
    const level1 = frost.levels[0];
    expect(chilled).not.toBeNull();
    expect(chilled!.slowDebuffs.length).toBeGreaterThan(0);
    expect(computeSlowFactor(chilled!.slowDebuffs, cap)).toBeCloseTo(level1.slowFactor ?? 0, 10);
    expect(computeSlowFactor(chilled!.slowDebuffs, cap)).toBeLessThanOrEqual(cap);
  });
});
