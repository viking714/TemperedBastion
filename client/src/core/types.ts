/**
 * 内核类型定义（纯类型，无运行期依赖）。
 *
 * 关键约定：所有战斗数值都只能来自 `GameConfig`（后端 /api/config 下发），
 * 内核不持有任何模块级战斗常量。
 */

/** 网格坐标（列、行，原点左上）。 */
export interface TileCoord {
  col: number;
  row: number;
}

/** 世界坐标（逻辑像素，原点左上）。 */
export interface Vec2 {
  x: number;
  y: number;
}

export type TargetingMode = 'FIRST' | 'LAST' | 'STRONGEST' | 'CLOSEST';
export type TowerRole = 'single_target' | 'splash' | 'slow';
export type WaveState = 'IDLE' | 'PREP' | 'SPAWNING' | 'ACTIVE' | 'VICTORY' | 'DEFEAT';
export type PlacementReason = 'out_of_bounds' | 'on_path' | 'spawn_or_base' | 'occupied';

export interface PlacementResult {
  valid: boolean;
  reason: PlacementReason | null;
}

// ---------------------------------------------------------------------------
// 配置（/api/config 的形状；字段名与后端 Pydantic 契约逐字一致）
// ---------------------------------------------------------------------------

export interface GridConfig {
  cols: number;
  rows: number;
  tileSizePx: number;
}

export interface CanvasConfig {
  logicWidthPx: number;
  logicHeightPx: number;
}

export interface MapConfig {
  pathWaypoints: [number, number][];
  spawnTile: [number, number];
  baseTile: [number, number];
}

export interface EconomyConfig {
  initialGold: number;
  initialLives: number;
  sellRefundRatio: number;
  waveClearBonus: number;
  hpScalePerWave: number;
  speedScalePerWave: number;
}

export interface RulesConfig {
  maxTowerLevel: number;
  slowCapRatio: number;
  armorFloorRatio: number;
  prepCountdownSec: number;
  defaultTargeting: TargetingMode;
  speedOptions: number[];
  pauseFreezesAll: boolean;
}

export interface TowerLevelStats {
  level: number;
  damage: number;
  range: number;
  fireRate: number;
  projectileSpeed: number;
  splashRadius: number | null;
  slowFactor: number | null;
  slowDuration: number | null;
}

export interface TowerDef {
  id: string;
  name: string;
  role: TowerRole;
  cost: number;
  targeting: TargetingMode;
  upgradeCostToNext: number[];
  levels: TowerLevelStats[];
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  armor: number;
  bounty: number;
  leakDamage: number;
}

export interface WaveGroupDef {
  enemy: string;
  count: number;
  spawnIntervalSec: number;
  startDelaySec: number;
}

export interface WaveDef {
  wave: number;
  groups: WaveGroupDef[];
}

export interface GameConfig {
  version: string;
  grid: GridConfig;
  canvas: CanvasConfig;
  map: MapConfig;
  economy: EconomyConfig;
  rules: RulesConfig;
  towers: TowerDef[];
  enemies: EnemyDef[];
  waves: WaveDef[];
}

// ---------------------------------------------------------------------------
// 运行期状态
// ---------------------------------------------------------------------------

export interface TowerRuntime {
  col: number;
  row: number;
  towerId: string;
  level: number;
  targeting: TargetingMode;
  /** 距离下次可开火的剩余毫秒（<=0 表示可以开火）。 */
  cooldownMs: number;
}

export interface SlowDebuff {
  /** 施加者的塔标识（由格子坐标派生，见 config.ts:towerIdAt）。 */
  sourceTowerId: number;
  slowFactor: number;
  remainingMs: number;
}

export interface EnemyRuntime {
  id: number;
  enemyId: string;
  /** 沿路径已行进的距离（逻辑像素）。 */
  pathDistance: number;
  hp: number;
  maxHp: number;
  spawnOrder: number;
  slowDebuffs: SlowDebuff[];
}

export interface ProjectileRuntime {
  id: number;
  sourceTowerId: number;
  x: number;
  y: number;
  targetEnemyId: number | null;
  hitX: number | null;
  hitY: number | null;
  speed: number;
  damage: number;
  splashRadius: number | null;
  slowFactor: number | null;
  slowDuration: number | null;
}

export interface SpawnGroupProgress {
  enemy: string;
  spawnedCount: number;
  timeSinceLastMs: number;
}

export interface SpawnProgress {
  /** 0 基的波次下标（config.waves 的索引）。 */
  waveIndex: number;
  groups: SpawnGroupProgress[];
}

export interface GameState {
  gold: number;
  lives: number;
  /** 当前波次（1 基；IDLE 时为 0）。 */
  currentWave: number;
  waveState: WaveState;
  speedMultiplier: number;
  paused: boolean;
  prepRemainingMs: number;
  elapsedMs: number;
  towers: TowerRuntime[];
  enemies: EnemyRuntime[];
  projectiles: ProjectileRuntime[];
  spawnProgress: SpawnProgress;
  nextEnemyId: number;
  nextProjectileId: number;
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

export type GameCommand =
  | { type: 'BUILD_TOWER'; col: number; row: number; towerId: string }
  | { type: 'UPGRADE_TOWER'; col: number; row: number }
  | { type: 'SELL_TOWER'; col: number; row: number }
  | { type: 'SET_TARGETING'; col: number; row: number; targeting: TargetingMode }
  | { type: 'START_WAVE' }
  | { type: 'SET_SPEED'; speedMultiplier: number }
  | { type: 'TOGGLE_PAUSE' };

export interface CommandResult {
  ok: boolean;
  /** 失败原因（ok=true 时为 null）。 */
  reason: string | null;
  state: GameState;
}
