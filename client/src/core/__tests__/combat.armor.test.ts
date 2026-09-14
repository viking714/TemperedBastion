/**
 * 护甲减伤：有效伤害 = max(raw − armor, raw × armorFloorRatio)。
 */
import { describe, expect, it } from 'vitest';
import { applyArmor } from '../combat';
import { applyCommand, createGame } from '../game';
import { step } from '../simulation';
import type { GameConfig, GameState } from '../types';
import { SIM_DT_SEC, loadConfig, requireTower, tilesCoveringPathDistance } from './fixtures';

const config: GameConfig = loadConfig();
const floor = config.rules.armorFloorRatio;

describe('combat.armor: 公式', () => {
  it('无护甲时伤害原样传递（min 比例不生效）', () => {
    expect(applyArmor(25, 0, floor)).toBeCloseTo(25, 10);
  });

  it('护甲较小时按固定值减伤', () => {
    expect(applyArmor(25, 5, floor)).toBeCloseTo(20, 10);
  });

  it('护甲很大时仍承受 armorFloorRatio 的最低比例伤害（不为负、不为零）', () => {
    const result = applyArmor(10, 1000, floor);
    expect(result).toBeCloseTo(10 * floor, 10);
    expect(result).toBeGreaterThan(0);
  });

  it('结果永不为负（raw < armor 时走最低比例）', () => {
    expect(applyArmor(3, 10, floor)).toBeGreaterThan(0);
  });

  it('最低比例来自 config（可调）', () => {
    expect(applyArmor(100, 1000, 0.5)).toBeCloseTo(50, 10);
    expect(applyArmor(100, 1000, 0.1)).toBeCloseTo(10, 10);
  });

  it('护甲只在 raw 明显大于 armor 时才起减伤作用', () => {
    const heavyArmor = applyArmor(100, 5, floor);
    const noArmor = applyArmor(100, 0, floor);
    expect(noArmor - heavyArmor).toBeCloseTo(5, 10);
  });
});

describe('combat.armor: 与推演的集成', () => {
  const arrow = requireTower(config, 'arrow');
  const heavy = config.enemies.reduce((best, enemy) => (enemy.armor > best.armor ? enemy : best), config.enemies[0]);

  it('带护甲的敌人每次受击都按护甲公式扣血（伤害量为有效伤害的整数倍）', () => {
    expect(heavy.armor).toBeGreaterThan(0);

    const [tile] = tilesCoveringPathDistance(config, 0, arrow.id);
    let state: GameState = createGame(config);
    const built = applyCommand(state, { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: arrow.id }, config);
    expect(built.ok).toBe(true);
    state = { ...built.state, currentWave: 1, waveState: 'ACTIVE' };

    const hp = heavy.hp * 100; // 给足血量，保证观察窗口内不死
    state.enemies.push({
      id: 1,
      enemyId: heavy.id,
      pathDistance: 0,
      hp,
      maxHp: hp,
      spawnOrder: 1,
      slowDebuffs: [],
    });

    const steps = 240;
    for (let i = 0; i < steps; i++) state = step(state, SIM_DT_SEC, config);

    expect(state.enemies).toHaveLength(1);
    const enemy = state.enemies[0];
    const effective = applyArmor(arrow.levels[0].damage, heavy.armor, floor);
    const dealt = hp - enemy.hp;
    expect(dealt).toBeGreaterThan(0);
    // dealt 必须是 effective 的整数倍（每次命中结算一次，不出现中间量）
    const hits = Math.round(dealt / effective);
    expect(hits).toBeGreaterThan(0);
    expect(dealt).toBeCloseTo(hits * effective, 6);
  });

  it('护甲越大，同样火力下敌人掉血越慢（重装 vs 普通）', () => {
    const light = config.enemies.reduce((best, enemy) => (enemy.armor < best.armor ? enemy : best), config.enemies[0]);
    expect(light.armor).toBeLessThan(heavy.armor);
    // 低伤害弹（冰塔）下，重装的护甲优势最明显
    const lowDamage = requireTower(config, 'frost').levels[0].damage;
    expect(applyArmor(lowDamage, heavy.armor, floor)).toBeLessThan(applyArmor(lowDamage, light.armor, floor));
  });
});
