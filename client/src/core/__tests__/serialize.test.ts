/**
 * AC-4：存档往返（Memento）——读档后与存档时**完全一致**。
 *
 * 除 AC-4 显式要求的 5 个字段（金币/生命/当前波次/各塔坐标与等级/已游玩时长）外，
 * 这里对**全量状态**做严格深度相等断言（含敌人、子弹、生成进度、减速 debuff、冷却）。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, findTowerAt } from '../game';
import { getEnemyDef, getTowerDef } from '../config';
import { step } from '../simulation';
import { fromSavePayload, toSavePayload } from '../serialize';
import type { SavePayload } from '../serialize';
import type { GameConfig, GameState } from '../types';
import { SIM_DT_SEC, loadConfig, planTowerTiles, towerIdByRole } from './fixtures';

const config: GameConfig = loadConfig();
const meta = { configVersion: 'deadbeefdeadbeef', savedAt: '2026-09-14T00:00:00+00:00', slot: 1 };

/** 构造一个「局中」的丰富状态：多座塔 + 在场敌人 + 子弹 + 生成进度 + 减速 debuff。 */
function richState(): GameState {
  const single = towerIdByRole(config, 'single_target');
  const splash = towerIdByRole(config, 'splash');
  const slow = towerIdByRole(config, 'slow');
  const rotation = [single, single, single, splash, slow];
  const tiles = planTowerTiles(config, single, 10);

  let state = createGame(config);
  state = { ...state, gold: 900 };

  tiles.forEach((tile, index) => {
    const result = applyCommand(
      state,
      { type: 'BUILD_TOWER', col: tile.col, row: tile.row, towerId: rotation[index % rotation.length] },
      config,
    );
    if (result.ok) state = result.state;
  });

  // 升两座塔，覆盖非 1 的 tank level
  const firstTower = state.towers[0];
  if (firstTower) {
    state = applyCommand(state, { type: 'UPGRADE_TOWER', col: firstTower.col, row: firstTower.row }, config).state;
  }

  state = applyCommand(state, { type: 'START_WAVE' }, config).state; // IDLE → PREP
  state = applyCommand(state, { type: 'START_WAVE' }, config).state; // PREP → SPAWNING

  for (let i = 0; i < 400; i++) state = step(state, SIM_DT_SEC, config);

  if (firstTower) {
    state = applyCommand(
      state,
      { type: 'SET_TARGETING', col: firstTower.col, row: firstTower.row, targeting: 'STRONGEST' },
      config,
    ).state;
  }

  // 保证快照覆盖到子弹与减速 debuff（不依赖巧合）
  if (state.projectiles.length === 0) {
    const def = getTowerDef(config, single);
    state.projectiles.push({
      id: 9999,
      sourceTowerId: 0,
      x: 12.5,
      y: 34.25,
      targetEnemyId: null,
      hitX: null,
      hitY: null,
      speed: def?.levels[0].projectileSpeed ?? 1,
      damage: def?.levels[0].damage ?? 1,
      splashRadius: null,
      slowFactor: null,
      slowDuration: null,
    });
    state = { ...state, nextProjectileId: 10000 };
  }
  if (state.enemies.length > 0 && state.enemies[0].slowDebuffs.length === 0) {
    state.enemies[0].slowDebuffs.push({ sourceTowerId: 42, slowFactor: 0.25, remainingMs: 1234.5 });
  }

  return { ...state, paused: true, speedMultiplier: 2 };
}

describe('serialize: 深度相等往返', () => {
  it('fromSavePayload(toSavePayload(state)) 与 state 严格相等', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);
    const restored = fromSavePayload(payload, config);
    expect(restored).toStrictEqual(state);
  });

  it('往返后仍可继续推演（状态是"活"的）', () => {
    const state = richState();
    const restored = fromSavePayload(toSavePayload(state, meta), config);
    const resumed = { ...restored, paused: false };
    let a = step(resumed, SIM_DT_SEC, config);
    let b = step({ ...state, paused: false }, SIM_DT_SEC, config);
    for (let i = 0; i < 120; i++) {
      a = step(a, SIM_DT_SEC, config);
      b = step(b, SIM_DT_SEC, config);
    }
    expect(a).toStrictEqual(b);
  });

  it('经 JSON 序列化（HTTP/SQLite 真实路径）后往返仍然一致', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);
    const wire = JSON.parse(JSON.stringify(payload)) as SavePayload;
    expect(fromSavePayload(wire, config)).toStrictEqual(state);
  });
});

describe('serialize: AC-4 显式要求字段', () => {
  it('金币 / 生命 / 当前波次 / 已游玩时长 / 各塔坐标与等级 完全一致', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);

    expect(payload.gold).toBe(state.gold);
    expect(payload.lives).toBe(state.lives);
    expect(payload.currentWave).toBe(state.currentWave);
    expect(payload.elapsedMs).toBe(state.elapsedMs);

    expect(payload.towers).toHaveLength(state.towers.length);
    state.towers.forEach((tower, index) => {
      expect(payload.towers[index].col).toBe(tower.col);
      expect(payload.towers[index].row).toBe(tower.row);
      expect(payload.towers[index].level).toBe(tower.level);
      expect(payload.towers[index].towerId).toBe(tower.towerId);
    });

    const restored = fromSavePayload(payload, config);
    expect(restored.gold).toBe(state.gold);
    expect(restored.lives).toBe(state.lives);
    expect(restored.currentWave).toBe(state.currentWave);
    expect(restored.elapsedMs).toBe(state.elapsedMs);
    state.towers.forEach((tower) => {
      const match = findTowerAt(restored, tower.col, tower.row);
      expect(match).not.toBeNull();
      expect(match!.level).toBe(tower.level);
    });
  });

  it('小数毫秒（1/60s 步长的整数倍）不因序列化被截断', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);
    expect(payload.elapsedMs).toBe(state.elapsedMs);
    expect(Number.isInteger(payload.elapsedMs)).toBe(false);
    const wire = JSON.parse(JSON.stringify(payload)) as SavePayload;
    expect(wire.elapsedMs).toBe(state.elapsedMs);
  });
});

describe('serialize: 健壮性', () => {
  it('payload 是深拷贝：之后改状态不会污染已生成的存档', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);
    const snapshot = JSON.stringify(payload);

    state.gold += 12345;
    if (state.enemies.length > 0) state.enemies[0].hp = -1;
    state.towers.push({ col: 1, row: 1, towerId: 'x', level: 1, targeting: 'FIRST', cooldownMs: 0 });

    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  it('未知的塔/敌人 id（配置已变更）会被丢弃，而不是让内核崩溃', () => {
    const state = richState();
    const payload = toSavePayload(state, meta);
    payload.towers.push({ col: 0, row: 0, towerId: 'ghost_tower', level: 1, targeting: 'FIRST', cooldownMs: 0 });
    payload.enemies.push({
      id: 424242,
      enemyId: 'ghost_enemy',
      pathDistance: 1,
      hp: 1,
      maxHp: 1,
      spawnOrder: 1,
      slowDebuffs: [],
    });

    const restored = fromSavePayload(payload, config);
    expect(restored.towers.some((tower) => tower.towerId === 'ghost_tower')).toBe(false);
    expect(restored.enemies.some((enemy) => enemy.enemyId === 'ghost_enemy')).toBe(false);
    expect(getTowerDef(config, 'ghost_tower')).toBeNull();
    expect(getEnemyDef(config, 'ghost_enemy')).toBeNull();
  });

  it('meta（configVersion / savedAt / slot）被原样带出，便于溯源', () => {
    const payload = toSavePayload(richState(), meta);
    expect(payload.configVersion).toBe(meta.configVersion);
    expect(payload.savedAt).toBe(meta.savedAt);
    expect(payload.slot).toBe(meta.slot);
  });
});
