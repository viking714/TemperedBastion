"""Pydantic 契约：配置响应 / 存档 payload / 战绩 / 统一错误信封。

字段名一律采用 camelCase，与 add.json.api_contracts 以及前端 zod schema 逐字对齐。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

# --------------------------------------------------------------------------------------
# 统一错误信封
# --------------------------------------------------------------------------------------

WaveStateLiteral = Literal["IDLE", "PREP", "SPAWNING", "ACTIVE", "VICTORY", "DEFEAT"]
TargetingLiteral = Literal["FIRST", "LAST", "STRONGEST", "CLOSEST"]
TowerRoleLiteral = Literal["single_target", "splash", "slow"]


class ApiError(Exception):
    """业务异常 → 由全局异常处理器转换为统一错误信封。"""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorEnvelope(BaseModel):
    error: ErrorBody


# --------------------------------------------------------------------------------------
# 关卡配置（GET /api/config）
# --------------------------------------------------------------------------------------


class _Strict(BaseModel):
    # 拒绝未知字段：契约漂移时立刻暴露，而不是被静默忽略。
    model_config = ConfigDict(extra="forbid")


class GridConfig(_Strict):
    cols: int = Field(ge=1)
    rows: int = Field(ge=1)
    tileSizePx: int = Field(gt=0)


class CanvasConfig(_Strict):
    logicWidthPx: int = Field(gt=0)
    logicHeightPx: int = Field(gt=0)


class MapConfig(_Strict):
    pathWaypoints: list[tuple[int, int]] = Field(min_length=2)
    spawnTile: tuple[int, int]
    baseTile: tuple[int, int]


class EconomyConfig(_Strict):
    initialGold: int = Field(ge=0)
    initialLives: int = Field(ge=1)
    sellRefundRatio: float = Field(ge=0, le=1)
    waveClearBonus: int = Field(ge=0)
    hpScalePerWave: float = Field(ge=0)
    speedScalePerWave: float = Field(ge=0)


class RulesConfig(_Strict):
    maxTowerLevel: int = Field(ge=1)
    slowCapRatio: float = Field(ge=0, le=1)
    armorFloorRatio: float = Field(ge=0, le=1)
    prepCountdownSec: float = Field(ge=0)
    defaultTargeting: TargetingLiteral
    speedOptions: list[int] = Field(min_length=1)
    pauseFreezesAll: bool


class TowerLevelStats(_Strict):
    level: int = Field(ge=1)
    damage: float = Field(ge=0)
    range: float = Field(gt=0)
    fireRate: float = Field(gt=0)
    projectileSpeed: float = Field(ge=0)
    splashRadius: float | None = None
    slowFactor: float | None = None
    slowDuration: float | None = None


class TowerDef(_Strict):
    id: str
    name: str
    role: TowerRoleLiteral
    cost: int = Field(ge=0)
    targeting: TargetingLiteral
    upgradeCostToNext: list[int]
    levels: list[TowerLevelStats] = Field(min_length=1)


class EnemyDef(_Strict):
    id: str
    name: str
    hp: float = Field(gt=0)
    speed: float = Field(gt=0)
    armor: float = Field(ge=0)
    bounty: float = Field(ge=0)
    leakDamage: int = Field(ge=0)


class WaveGroup(_Strict):
    enemy: str
    count: int = Field(ge=0)
    spawnIntervalSec: float = Field(gt=0)
    startDelaySec: float = Field(default=0, ge=0)


class WaveDef(_Strict):
    wave: int = Field(ge=1)
    groups: list[WaveGroup]


class LevelEntry(_Strict):
    """单关定义：地图 + 经济参数 + 波次（v2 起 level.json 支持多关卡）。"""

    id: int = Field(ge=1)
    name: str = Field(min_length=1)
    map: MapConfig
    economy: EconomyConfig
    waves: list[WaveDef] = Field(min_length=1)


class CampaignConfig(_Strict):
    """level.json v2 的原始形状（关卡列表 + 全区共享的塔/敌人/规则）。"""

    grid: GridConfig
    canvas: CanvasConfig
    rules: RulesConfig
    towers: list[TowerDef] = Field(min_length=1)
    enemies: list[EnemyDef] = Field(min_length=1)
    levels: list[LevelEntry] = Field(min_length=1)


class CampaignInfo(_Strict):
    """当前关卡在战役中的位置（注入 ConfigResponse，供前端展示与闯关衔接）。"""

    level: int = Field(ge=1)
    name: str = Field(min_length=1)
    totalLevels: int = Field(ge=1)


class ConfigResponse(_Strict):
    """GET /api/config?level=N 的响应：单关合成配置 + 战役信息 + 内容 hash。"""

    version: str
    campaign: CampaignInfo
    grid: GridConfig
    canvas: CanvasConfig
    map: MapConfig
    economy: EconomyConfig
    rules: RulesConfig
    towers: list[TowerDef] = Field(min_length=1)
    enemies: list[EnemyDef] = Field(min_length=1)
    waves: list[WaveDef] = Field(min_length=1)


# --------------------------------------------------------------------------------------
# 存档 payload（GET/PUT /api/save/{slot}）
# --------------------------------------------------------------------------------------


class TowerSnapshot(_Strict):
    col: int
    row: int
    towerId: str
    level: int = Field(ge=1)
    targeting: TargetingLiteral
    # ★ 开火相位：内核的 Memento 会带上「距下次开火的剩余毫秒」，读档后可无损续算，
    #   否则读档瞬间所有塔都会重置冷却。TS 侧 towerSnapshotSchema 为必填字段，
    #   这里必须同步存在——曾经漏掉该字段导致 PUT /api/save/{slot} 直接 422。
    cooldownMs: float


class SlowDebuffSnapshot(_Strict):
    sourceTowerId: int
    slowFactor: float
    remainingMs: float


class EnemySnapshot(_Strict):
    id: int = Field(ge=0)
    enemyId: str
    pathDistance: float = Field(ge=0)
    hp: float
    maxHp: float = Field(gt=0)
    spawnOrder: int = Field(ge=0)
    slowDebuffs: list[SlowDebuffSnapshot] = Field(default_factory=list)


class ProjectileSnapshot(_Strict):
    id: int = Field(ge=0)
    sourceTowerId: int
    x: float
    y: float
    targetEnemyId: int | None = None
    hitX: float | None = None
    hitY: float | None = None
    speed: float = Field(ge=0)
    damage: float = Field(ge=0)
    splashRadius: float | None = None
    slowFactor: float | None = None
    slowDuration: float | None = None


class SpawnGroupProgress(_Strict):
    enemy: str
    spawnedCount: int = Field(ge=0)
    timeSinceLastMs: float = Field(ge=0)


class SpawnProgressSnapshot(_Strict):
    waveIndex: int = Field(ge=0)
    groups: list[SpawnGroupProgress] = Field(default_factory=list)


class SavePayload(_Strict):
    """存档全量快照。★ 字段为 AC-4 显式要求项。

    说明：毫秒类字段声明为 float 而非 int —— 模拟以 1/60s 固定步长推进，
    时间量为 16.666… 的整数倍，用 float 才能保证「读档后与存档时完全一致」的
    深度相等往返（int 会在序列化时截断）。TS 侧两者同为 number，契约不变。
    """

    slot: int | None = None
    level: int = Field(default=1, ge=1)
    configVersion: str
    savedAt: str
    elapsedMs: float = Field(ge=0)  # ★
    gold: int = Field(ge=0)  # ★
    lives: int  # ★
    currentWave: int = Field(ge=0)  # ★
    waveState: WaveStateLiteral
    speedMultiplier: float = Field(gt=0)
    paused: bool
    prepRemainingMs: float
    towers: list[TowerSnapshot]  # ★
    spawnProgress: SpawnProgressSnapshot
    enemies: list[EnemySnapshot]
    projectiles: list[ProjectileSnapshot]
    nextEnemyId: int = Field(ge=0)
    nextProjectileId: int = Field(ge=0)


class SaveWriteResponse(_Strict):
    ok: bool
    slot: int
    updatedAt: str


# --------------------------------------------------------------------------------------
# 战绩（GET/POST /api/records）
# --------------------------------------------------------------------------------------


class RecordCreate(_Strict):
    result: Literal["victory", "defeat"]
    level: int = Field(default=1, ge=1)
    waveReached: int = Field(ge=1, le=1000)
    livesRemaining: int = Field(ge=0)
    elapsedMs: float = Field(ge=0)
    configVersion: str


class RecordOut(RecordCreate):
    id: int
    createdAt: str


class RecordListOut(_Strict):
    total: int
    items: list[RecordOut]


class HealthOut(_Strict):
    status: str


__all__ = [
    "ApiError",
    "CampaignConfig",
    "CampaignInfo",
    "ConfigResponse",
    "CanvasConfig",
    "EnemyDef",
    "EnemySnapshot",
    "ErrorEnvelope",
    "GridConfig",
    "HealthOut",
    "LevelEntry",
    "MapConfig",
    "RecordCreate",
    "RecordListOut",
    "RecordOut",
    "RulesConfig",
    "SavePayload",
    "SaveWriteResponse",
    "SpawnGroupProgress",
    "SpawnProgressSnapshot",
    "TowerDef",
    "TowerLevelStats",
    "TowerSnapshot",
    "ValidationError",
    "WaveDef",
    "WaveGroup",
]
