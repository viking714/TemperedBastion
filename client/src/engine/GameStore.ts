/**
 * GameStore —— 命令式外壳的状态宿主（Facade + Observer）。
 *
 * 职责：
 *  - 持有唯一的可变世界状态（core.GameState）与固定步长主循环；
 *  - 把「输入 → 命令」的翻译结果交给 core.applyCommand 裁决（外壳不做规则判断）；
 *  - 向 React 暴露一个**投影快照**（HUD 只需要这些字段）；只有当投影的签名变化时
 *    才通知订阅者，避免 60Hz 全量重渲染（ADR-6：不引状态库）；
 *  - 向 Canvas 渲染层暴露状态 + 插值数据（只读）。
 */
import {
  MS_PER_SEC,
  applyCommand,
  computeSellRefund,
  createGame,
  findTowerAt,
  fromSavePayload,
  getEnemyDef,
  getTowerDef,
  getTowerLevelStats,
  getWaveDef,
  placementAt,
  step,
  toSavePayload,
} from '../core';
import type {
  GameCommand,
  GameConfig,
  GameState,
  PlacementResult,
  SavePayload,
  TargetingMode,
  TileCoord,
  TowerRole,
  Vec2,
  WaveState,
} from '../core';
import { SIM_DT_SEC, createLoop } from './loop';
import type { LoopHandle } from './loop';

export interface SelectedTowerInfo {
  col: number;
  row: number;
  towerId: string;
  name: string;
  role: TowerRole;
  level: number;
  maxLevel: number;
  damage: number;
  range: number;
  fireRate: number;
  targeting: TargetingMode;
  upgradeCost: number | null;
  sellRefund: number;
  canUpgrade: boolean;
}

export interface HudSnapshot {
  gold: number;
  lives: number;
  level: number;
  levelName: string;
  totalLevels: number;
  currentWave: number;
  totalWaves: number;
  remainingEnemies: number;
  waveState: WaveState;
  speedMultiplier: number;
  paused: boolean;
  prepRemainingSec: number;
  elapsedSec: number;
  selectedTile: TileCoord | null;
  selected: SelectedTowerInfo | null;
  buildTowerId: string | null;
  nextWaveHint: string | null;
  terminal: 'victory' | 'defeat' | null;
  notice: string | null;
  noticeToken: number;
  configVersion: string;
}

export interface TerminalInfo {
  result: 'victory' | 'defeat';
  level: number;
  levelName: string;
  totalLevels: number;
  waveReached: number;
  livesRemaining: number;
  elapsedMs: number;
  configVersion: string;
}

export interface InterpolationData {
  alpha: number;
  enemyPathDistance: ReadonlyMap<number, number>;
  projectilePosition: ReadonlyMap<number, Vec2>;
}

/** 内核拒绝原因 → 可读中文（供 disabled 提示与操作反馈）。 */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  insufficient_gold: '金币不足',
  occupied: '该格已有塔',
  on_path: '路径上不能建塔',
  out_of_bounds: '超出地图范围',
  spawn_or_base: '出生点 / 基地不能建塔',
  invalid_tile: '非法的格子',
  max_level: '已达最高等级',
  no_tower: '该格没有塔',
  paused: '暂停中，操作已冻结',
  game_over: '本局已结束',
  wave_in_progress: '本波正在进行',
  unsupported_speed: '不支持的速度档位',
  unknown_tower: '未知塔类型',
  unknown_command: '未知操作',
};

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return '';
  return REASON_TEXT[reason] ?? reason;
}

const NOTICE_TTL_MS = 2600;

function snapshotSignature(snapshot: HudSnapshot): string {
  const selected = snapshot.selected
    ? `${snapshot.selected.col}:${snapshot.selected.row}:${snapshot.selected.level}:${snapshot.selected.targeting}:${snapshot.selected.canUpgrade ? 1 : 0}`
    : '-';
  const tile = snapshot.selectedTile ? `${snapshot.selectedTile.col}:${snapshot.selectedTile.row}` : '-';
  return [
    snapshot.gold,
    snapshot.lives,
    snapshot.level,
    snapshot.currentWave,
    snapshot.remainingEnemies,
    snapshot.waveState,
    snapshot.speedMultiplier,
    snapshot.paused ? 1 : 0,
    Math.round(snapshot.prepRemainingSec * 4),
    Math.round(snapshot.elapsedSec),
    tile,
    selected,
    snapshot.buildTowerId ?? '-',
    snapshot.terminal ?? '-',
    snapshot.noticeToken,
  ].join('|');
}

export class GameStore {
  readonly config: GameConfig;

  private state: GameState;
  private readonly listeners = new Set<() => void>();
  private snapshot: HudSnapshot;
  private signature = '';

  private loop: LoopHandle | null = null;
  private alpha = 0;
  private stepsThisFrame = 0;
  private terminalHandler: ((info: TerminalInfo) => void) | null = null;

  private hoverTile: TileCoord | null = null;
  private selectedTile: TileCoord | null = null;
  private buildTowerId: string | null = null;

  private readonly prevEnemyDistance = new Map<number, number>();
  private readonly prevProjectilePosition = new Map<number, Vec2>();

  private notice: string | null = null;
  private noticeToken = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GameConfig) {
    this.config = config;
    this.state = createGame(config);
    this.snapshot = this.project();
    this.signature = snapshotSignature(this.snapshot);
  }

  // -------------------------------------------------------------------------
  // React 桥（useSyncExternalStore）
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  // -------------------------------------------------------------------------
  // 渲染层只读入口
  // -------------------------------------------------------------------------

  getState(): GameState {
    return this.state;
  }

  getInterpolation(): InterpolationData {
    return {
      alpha: this.alpha,
      enemyPathDistance: this.prevEnemyDistance,
      projectilePosition: this.prevProjectilePosition,
    };
  }

  get hoveredTile(): TileCoord | null {
    return this.hoverTile;
  }

  get selected(): TileCoord | null {
    return this.selectedTile;
  }

  get selectedBuildTowerId(): string | null {
    return this.buildTowerId;
  }

  // -------------------------------------------------------------------------
  // 主循环
  // -------------------------------------------------------------------------

  setTerminalHandler(handler: ((info: TerminalInfo) => void) | null): void {
    this.terminalHandler = handler;
  }

  start(): void {
    if (this.loop) return;
    this.loop = createLoop({
      speedMultiplier: () => this.state.speedMultiplier,
      step: () => this.advanceOneStep(),
      frame: (alpha) => {
        this.alpha = alpha;
        this.stepsThisFrame = 0;
        this.publish();
      },
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }

  dispose(): void {
    this.stop();
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.listeners.clear();
  }

  private advanceOneStep(): void {
    if (this.stepsThisFrame === 0) this.captureInterpolationSource();
    this.stepsThisFrame += 1;

    this.state = step(this.state, SIM_DT_SEC, this.config);

    const terminal = this.state.waveState;
    if ((terminal === 'VICTORY' || terminal === 'DEFEAT') && this.terminalHandler) {
      const info = this.terminalInfo();
      const handler = this.terminalHandler;
      this.terminalHandler = null; // 每局只上报一次
      handler(info);
    }
  }

  private captureInterpolationSource(): void {
    const enemies = this.state.enemies;
    this.prevEnemyDistance.clear();
    for (let i = 0; i < enemies.length; i++) {
      this.prevEnemyDistance.set(enemies[i].id, enemies[i].pathDistance);
    }
    const projectiles = this.state.projectiles;
    this.prevProjectilePosition.clear();
    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i];
      this.prevProjectilePosition.set(projectile.id, { x: projectile.x, y: projectile.y });
    }
  }

  terminalInfo(): TerminalInfo {
    const state = this.state;
    return {
      result: state.waveState === 'VICTORY' ? 'victory' : 'defeat',
      level: this.config.campaign.level,
      levelName: this.config.campaign.name,
      totalLevels: this.config.campaign.totalLevels,
      waveReached: Math.max(state.currentWave, 1),
      livesRemaining: Math.max(state.lives, 0),
      elapsedMs: state.elapsedMs,
      configVersion: this.config.version,
    };
  }

  // -------------------------------------------------------------------------
  // 投影 / 通知
  // -------------------------------------------------------------------------

  private publish(force = false): void {
    const next = this.project();
    const signature = snapshotSignature(next);
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private project(): HudSnapshot {
    const state = this.state;
    const tile = this.selectedTile;
    const selected = tile ? this.selectedTowerInfo(tile) : null;
    return {
      gold: state.gold,
      lives: state.lives,
      level: this.config.campaign.level,
      levelName: this.config.campaign.name,
      totalLevels: this.config.campaign.totalLevels,
      currentWave: state.currentWave,
      totalWaves: this.config.waves.length,
      remainingEnemies: state.enemies.length,
      waveState: state.waveState,
      speedMultiplier: state.speedMultiplier,
      paused: state.paused,
      prepRemainingSec: Math.max(state.prepRemainingMs, 0) / MS_PER_SEC,
      elapsedSec: state.elapsedMs / MS_PER_SEC,
      selectedTile: tile,
      selected,
      buildTowerId: this.buildTowerId,
      nextWaveHint: this.composeNextWaveHint(),
      terminal: state.waveState === 'VICTORY' ? 'victory' : state.waveState === 'DEFEAT' ? 'defeat' : null,
      notice: this.notice,
      noticeToken: this.noticeToken,
      configVersion: this.config.version,
    };
  }

  private selectedTowerInfo(tile: TileCoord): SelectedTowerInfo | null {
    const tower = findTowerAt(this.state, tile.col, tile.row);
    if (!tower) return null;
    const def = getTowerDef(this.config, tower.towerId);
    const stats = getTowerLevelStats(this.config, tower.towerId, tower.level);
    if (!def || !stats) return null;

    const maxLevel = Math.min(this.config.rules.maxTowerLevel, def.levels.length);
    const upgradeIndex = tower.level - 1;
    const upgradeCost =
      upgradeIndex >= 0 && upgradeIndex < def.upgradeCostToNext.length ? def.upgradeCostToNext[upgradeIndex] : null;

    // 与结算路径共用同一实现，避免展示值与实际返还值出现取整口径漂移（曾各自 floor 浮点乘积）。
    const sellRefund = computeSellRefund(tower, def, this.config);

    return {
      col: tile.col,
      row: tile.row,
      towerId: def.id,
      name: def.name,
      role: def.role,
      level: tower.level,
      maxLevel,
      damage: stats.damage,
      range: stats.range,
      fireRate: stats.fireRate,
      targeting: tower.targeting,
      upgradeCost,
      sellRefund,
      canUpgrade: tower.level < maxLevel && upgradeCost !== null,
    };
  }

  /** 下一波构成提示（COULD 项；文案由配置里的敌人名拼出，不硬编码）。 */
  private composeNextWaveHint(): string | null {
    const state = this.state;
    const waveNumber =
      state.waveState === 'SPAWNING' || state.waveState === 'ACTIVE'
        ? state.currentWave + 1
        : state.waveState === 'PREP'
          ? state.currentWave
          : 1;
    const waveDef = getWaveDef(this.config, waveNumber);
    if (!waveDef) return null;
    const parts: string[] = [];
    for (const group of waveDef.groups) {
      const enemy = getEnemyDef(this.config, group.enemy);
      parts.push(`${enemy ? enemy.name : group.enemy}×${group.count}`);
    }
    return `第 ${waveNumber} 波：${parts.join('，')}`;
  }

  private notify(message: string): void {
    this.notice = message;
    this.noticeToken += 1;
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    const token = this.noticeToken;
    this.noticeTimer = setTimeout(() => {
      if (this.noticeToken === token) {
        this.notice = null;
        this.noticeToken += 1;
        this.publish(true);
      }
    }, NOTICE_TTL_MS);
    this.publish(true);
  }

  // -------------------------------------------------------------------------
  // 玩家动作（统一走 core.applyCommand 裁决）
  // -------------------------------------------------------------------------

  private dispatch(command: GameCommand, silent = false): boolean {
    const result = applyCommand(this.state, command, this.config);
    this.state = result.state;
    if (!result.ok) {
      if (!silent) this.notify(reasonText(result.reason));
      return false;
    }
    this.publish(true);
    return true;
  }

  placementOf(tile: TileCoord): PlacementResult {
    return placementAt(this.state, this.config, tile);
  }

  buildableTowerIds(): string[] {
    return this.config.towers.map((tower) => tower.id);
  }

  selectBuildTower(towerId: string | null): void {
    this.buildTowerId = this.buildTowerId === towerId ? null : towerId;
    this.publish(true);
  }

  setHoverTile(tile: TileCoord | null): void {
    this.hoverTile = tile;
  }

  clearSelection(): void {
    this.selectedTile = null;
    this.buildTowerId = null;
    this.publish(true);
  }

  /** 点击格子：优先按当前选中的塔类型建塔，否则选中该格查看/升级/出售。 */
  handleTileClick(tile: TileCoord): void {
    if (this.buildTowerId) {
      const built = this.dispatch({
        type: 'BUILD_TOWER',
        col: tile.col,
        row: tile.row,
        towerId: this.buildTowerId,
      });
      if (built) {
        this.selectedTile = tile;
        this.publish(true);
      }
      return;
    }
    this.selectedTile = tile;
    this.publish(true);
  }

  startWave(): void {
    this.dispatch({ type: 'START_WAVE' });
  }

  togglePause(): void {
    this.dispatch({ type: 'TOGGLE_PAUSE' });
  }

  setSpeed(multiplier: number): void {
    this.dispatch({ type: 'SET_SPEED', speedMultiplier: multiplier });
  }

  upgradeSelected(): void {
    const tile = this.selectedTile;
    if (!tile) {
      this.notify(reasonText('no_tower'));
      return;
    }
    this.dispatch({ type: 'UPGRADE_TOWER', col: tile.col, row: tile.row });
  }

  sellSelected(): void {
    const tile = this.selectedTile;
    if (!tile) {
      this.notify(reasonText('no_tower'));
      return;
    }
    this.dispatch({ type: 'SELL_TOWER', col: tile.col, row: tile.row });
  }

  setSelectedTargeting(mode: TargetingMode): void {
    const tile = this.selectedTile;
    if (!tile) return;
    this.dispatch({ type: 'SET_TARGETING', col: tile.col, row: tile.row, targeting: mode });
  }

  // -------------------------------------------------------------------------
  // 存档 / 读档（AC-4）
  // -------------------------------------------------------------------------

  createSavePayload(slot: number): SavePayload {
    return toSavePayload(this.state, {
      level: this.config.campaign.level,
      configVersion: this.config.version,
      savedAt: new Date().toISOString(),
      slot,
    });
  }

  applySavePayload(payload: SavePayload): void {
    this.state = fromSavePayload(payload, this.config);
    this.prevEnemyDistance.clear();
    this.prevProjectilePosition.clear();
    this.selectedTile = null;
    this.hoverTile = null;
    this.buildTowerId = null;
    this.publish(true);
  }

  reset(): void {
    this.state = createGame(this.config);
    this.prevEnemyDistance.clear();
    this.prevProjectilePosition.clear();
    this.selectedTile = null;
    this.hoverTile = null;
    this.buildTowerId = null;
    this.publish(true);
  }
}
