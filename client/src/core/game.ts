/**
 * 游戏门面：创建初始状态 + 处理玩家命令（Command 模式）。
 *
 * 所有命令都走同一入口，便于键盘/鼠标共用、便于无浏览器单测直接构造命令序列，
 * 也便于对非法命令返回明确原因（而不是静默失败）。
 */
import { getMaxTowerLevel, getTowerDef, getTowerLevelStats, towerIdAt } from './config';
import { addGold, canAfford, computeSellRefund, computeUpgradeCost, spend } from './economy';
import { isBuildable, rasterizePath } from './placement';
import { createSpawnProgress } from './spawn';
import { isTerminal, reduce } from './waveStateMachine';
import type {
  CommandResult,
  GameCommand,
  GameConfig,
  GameState,
  PlacementResult,
  TileCoord,
  TowerRuntime,
} from './types';

/** 初始状态：IDLE（可建塔、等待玩家开始第 1 波）。 */
export function createGame(config: GameConfig): GameState {
  return {
    gold: config.economy.initialGold,
    lives: config.economy.initialLives,
    currentWave: 0,
    waveState: 'IDLE',
    speedMultiplier: config.rules.speedOptions.length > 0 ? config.rules.speedOptions[0] : 1,
    paused: false,
    prepRemainingMs: 0,
    elapsedMs: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    spawnProgress: createSpawnProgress(config, 0),
    nextEnemyId: 1,
    nextProjectileId: 1,
  };
}

/** 路径格集合（确定性栅格化结果；供建塔合法性判定）。 */
export function pathTileSet(config: GameConfig): Set<number> {
  return rasterizePath(config.map.pathWaypoints, config.grid);
}

export function findTowerAt(state: GameState, col: number, row: number): TowerRuntime | null {
  for (let i = 0; i < state.towers.length; i++) {
    const tower = state.towers[i];
    if (tower.col === col && tower.row === row) return tower;
  }
  return null;
}

/** 该格能否建塔（含出生点/基地判定，取配置里的值）。 */
export function placementAt(state: GameState, config: GameConfig, tile: TileCoord): PlacementResult {
  return isBuildable(
    config.grid,
    pathTileSet(config),
    state.towers,
    tile,
    config.map.spawnTile,
    config.map.baseTile,
  );
}

function fail(state: GameState, reason: string): CommandResult {
  return { ok: false, reason, state };
}

function succeed(state: GameState): CommandResult {
  return { ok: true, reason: null, state };
}

export function applyCommand(state: GameState, command: GameCommand, config: GameConfig): CommandResult {
  const frozen = state.paused && config.rules.pauseFreezesAll;

  switch (command.type) {
    case 'BUILD_TOWER': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      if (frozen) return fail(state, 'paused');
      const towerDef = getTowerDef(config, command.towerId);
      if (!towerDef) return fail(state, 'unknown_tower');
      const placement = placementAt(state, config, { col: command.col, row: command.row });
      if (!placement.valid) return fail(state, placement.reason ?? 'invalid_tile');
      if (!canAfford(state, towerDef.cost)) return fail(state, 'insufficient_gold');
      const paid = spend(state, towerDef.cost);
      const tower: TowerRuntime = {
        col: command.col,
        row: command.row,
        towerId: towerDef.id,
        level: 1,
        targeting: towerDef.targeting,
        cooldownMs: 0,
      };
      return succeed({ ...paid.state, towers: [...paid.state.towers, tower] });
    }

    case 'UPGRADE_TOWER': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      if (frozen) return fail(state, 'paused');
      const tower = findTowerAt(state, command.col, command.row);
      if (!tower) return fail(state, 'no_tower');
      const towerDef = getTowerDef(config, tower.towerId);
      if (!towerDef) return fail(state, 'unknown_tower');
      const maxLevel = getMaxTowerLevel(config, towerDef);
      if (tower.level >= maxLevel) return fail(state, 'max_level');
      const cost = computeUpgradeCost(tower, towerDef);
      if (cost === null) return fail(state, 'max_level');
      if (!statsExist(config, tower, tower.level + 1)) return fail(state, 'max_level');
      if (!canAfford(state, cost)) return fail(state, 'insufficient_gold');
      const paid = spend(state, cost);
      const towers = paid.state.towers.map((item) =>
        item.col === tower.col && item.row === tower.row ? { ...item, level: item.level + 1 } : item,
      );
      return succeed({ ...paid.state, towers });
    }

    case 'SELL_TOWER': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      if (frozen) return fail(state, 'paused');
      const tower = findTowerAt(state, command.col, command.row);
      if (!tower) return fail(state, 'no_tower');
      const towerDef = getTowerDef(config, tower.towerId);
      if (!towerDef) return fail(state, 'unknown_tower');
      const refund = computeSellRefund(tower, towerDef, config);
      const remaining = state.towers.filter((item) => !(item.col === tower.col && item.row === tower.row));
      return succeed(addGold({ ...state, towers: remaining }, refund));
    }

    case 'SET_TARGETING': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      const tower = findTowerAt(state, command.col, command.row);
      if (!tower) return fail(state, 'no_tower');
      const towers = state.towers.map((item) =>
        item.col === tower.col && item.row === tower.row ? { ...item, targeting: command.targeting } : item,
      );
      return succeed({ ...state, towers });
    }

    case 'START_WAVE': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      if (frozen) return fail(state, 'paused');
      if (state.waveState !== 'IDLE' && state.waveState !== 'PREP') return fail(state, 'wave_in_progress');
      return succeed(reduce(state, { type: 'WAVE_START' }, config));
    }

    case 'SET_SPEED': {
      if (!config.rules.speedOptions.includes(command.speedMultiplier)) return fail(state, 'unsupported_speed');
      return succeed({ ...state, speedMultiplier: command.speedMultiplier });
    }

    case 'TOGGLE_PAUSE': {
      if (isTerminal(state.waveState)) return fail(state, 'game_over');
      return succeed({ ...state, paused: !state.paused });
    }

    default:
      return fail(state, 'unknown_command');
  }
}

function statsExist(config: GameConfig, tower: TowerRuntime, level: number): boolean {
  return getTowerLevelStats(config, tower.towerId, level) !== null;
}

/** 塔的标识（供 UI/渲染复用同一套派生规则）。 */
export function towerRuntimeId(config: GameConfig, tower: TowerRuntime): number {
  return towerIdAt(config, tower.col, tower.row);
}
