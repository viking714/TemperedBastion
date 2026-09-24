/**
 * 配置契约（AC-3 的前端落点）。
 *
 * 用 zod 一处定义 schema，同时得到**运行时校验**与**TS 类型推导**：
 * 后端契约漂移时前端立刻进入错误态（可重试、不白屏），而不是静默败坏。
 *
 * 类型层面还与内核的 `GameConfig` / `SavePayload` 做双向可赋值断言——
 * 一旦两侧形状不一致，`tsc` 直接报错（构建期兜底）。
 */
import { z } from 'zod';
import type { GameConfig as KernelGameConfig, SavePayload as KernelSavePayload } from '../core';

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const tileTuple = z.tuple([z.number().int(), z.number().int()]);

export const targetingModeSchema = z.enum(['FIRST', 'LAST', 'STRONGEST', 'CLOSEST']);
export const towerRoleSchema = z.enum(['single_target', 'splash', 'slow']);
export const waveStateSchema = z.enum(['IDLE', 'PREP', 'SPAWNING', 'ACTIVE', 'VICTORY', 'DEFEAT']);
export const campaignInfoSchema = z
  .object({ level: positiveInt, name: z.string().min(1), totalLevels: positiveInt })
  .strict();

export const gameResultSchema = z.enum(['victory', 'defeat']);

export const towerLevelStatsSchema = z
  .object({
    level: positiveInt,
    damage: z.number().nonnegative(),
    range: z.number().positive(),
    fireRate: z.number().positive(),
    projectileSpeed: z.number().nonnegative(),
    splashRadius: z.number().nonnegative().nullable(),
    slowFactor: z.number().min(0).max(1).nullable(),
    slowDuration: z.number().nonnegative().nullable(),
  })
  .strict();

export const towerDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: towerRoleSchema,
    cost: nonNegativeInt,
    targeting: targetingModeSchema,
    upgradeCostToNext: z.array(nonNegativeInt),
    levels: z.array(towerLevelStatsSchema).min(1),
  })
  .strict();

export const enemyDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hp: z.number().positive(),
    speed: z.number().positive(),
    armor: z.number().nonnegative(),
    bounty: z.number().nonnegative(),
    leakDamage: nonNegativeInt,
  })
  .strict();

export const waveDefSchema = z
  .object({
    wave: positiveInt,
    groups: z
      .array(
        z
          .object({
            enemy: z.string().min(1),
            count: nonNegativeInt,
            spawnIntervalSec: z.number().positive(),
            startDelaySec: z.number().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const configResponseSchema = z
  .object({
    version: z.string().min(1),
    campaign: campaignInfoSchema,
    grid: z.object({ cols: positiveInt, rows: positiveInt, tileSizePx: positiveInt }).strict(),
    canvas: z.object({ logicWidthPx: positiveInt, logicHeightPx: positiveInt }).strict(),
    map: z
      .object({
        pathWaypoints: z.array(tileTuple).min(2),
        spawnTile: tileTuple,
        baseTile: tileTuple,
      })
      .strict(),
    economy: z
      .object({
        initialGold: nonNegativeInt,
        initialLives: positiveInt,
        sellRefundRatio: ratio,
        waveClearBonus: nonNegativeInt,
        hpScalePerWave: z.number().nonnegative(),
        speedScalePerWave: z.number().nonnegative(),
      })
      .strict(),
    rules: z
      .object({
        maxTowerLevel: positiveInt,
        slowCapRatio: ratio,
        armorFloorRatio: ratio,
        prepCountdownSec: z.number().nonnegative(),
        defaultTargeting: targetingModeSchema,
        speedOptions: z.array(z.number().positive()).min(1),
        pauseFreezesAll: z.boolean(),
      })
      .strict(),
    towers: z.array(towerDefSchema).min(1),
    enemies: z.array(enemyDefSchema).min(1),
    waves: z.array(waveDefSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// 存档 / 战绩契约
// ---------------------------------------------------------------------------

export const towerSnapshotSchema = z
  .object({
    col: z.number().int(),
    row: z.number().int(),
    towerId: z.string().min(1),
    level: positiveInt,
    targeting: targetingModeSchema,
    cooldownMs: z.number(),
  })
  .strict();

export const slowDebuffSnapshotSchema = z
  .object({
    sourceTowerId: z.number().int(),
    slowFactor: z.number(),
    remainingMs: z.number(),
  })
  .strict();

export const enemySnapshotSchema = z
  .object({
    id: nonNegativeInt,
    enemyId: z.string().min(1),
    pathDistance: z.number().nonnegative(),
    hp: z.number(),
    maxHp: z.number().positive(),
    spawnOrder: nonNegativeInt,
    slowDebuffs: z.array(slowDebuffSnapshotSchema),
  })
  .strict();

export const projectileSnapshotSchema = z
  .object({
    id: nonNegativeInt,
    sourceTowerId: z.number().int(),
    x: z.number(),
    y: z.number(),
    targetEnemyId: z.number().int().nullable(),
    hitX: z.number().nullable(),
    hitY: z.number().nullable(),
    speed: z.number().nonnegative(),
    damage: z.number().nonnegative(),
    splashRadius: z.number().nullable(),
    slowFactor: z.number().nullable(),
    slowDuration: z.number().nullable(),
  })
  .strict();

export const spawnProgressSnapshotSchema = z
  .object({
    waveIndex: nonNegativeInt,
    groups: z.array(
      z
        .object({
          enemy: z.string().min(1),
          spawnedCount: nonNegativeInt,
          timeSinceLastMs: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

export const savePayloadSchema = z
  .object({
    slot: z.number().int().nullable().optional(),
    level: positiveInt.default(1),
    configVersion: z.string().min(1),
    savedAt: z.string().min(1),
    elapsedMs: z.number().nonnegative(),
    gold: nonNegativeInt,
    lives: z.number().int(),
    currentWave: nonNegativeInt,
    waveState: waveStateSchema,
    speedMultiplier: z.number().positive(),
    paused: z.boolean(),
    prepRemainingMs: z.number(),
    towers: z.array(towerSnapshotSchema),
    spawnProgress: spawnProgressSnapshotSchema,
    enemies: z.array(enemySnapshotSchema),
    projectiles: z.array(projectileSnapshotSchema),
    nextEnemyId: nonNegativeInt,
    nextProjectileId: nonNegativeInt,
  })
  .strict();

export const saveWriteResponseSchema = z
  .object({ ok: z.boolean(), updatedAt: z.string() })
  .strict();

// ---------------------------------------------------------------------------
// 认证（注册 / 登录 / 会话）
// ---------------------------------------------------------------------------

const usernamePattern = /^[A-Za-z0-9_\u4e00-\u9fff-]+$/;

export const userSchema = z
  .object({
    id: positiveInt,
    username: z.string().min(1).max(20),
    createdAt: z.string().min(1),
  })
  .strict();

export const credentialsSchema = z
  .object({
    username: z.string().min(2).max(20).regex(usernamePattern, '用户名仅支持中英文、数字、下划线或连字符'),
    password: z.string().min(6).max(72),
  })
  .strict();

export const okResponseSchema = z.object({ ok: z.boolean() }).strict();

// ---------------------------------------------------------------------------
// 自动存档（GET/PUT /api/autosave）
// ---------------------------------------------------------------------------

export const autoSaveOutSchema = z
  .object({ payload: savePayloadSchema, totalLevels: positiveInt })
  .strict();

export const autoSaveWriteResponseSchema = z
  .object({ ok: z.boolean(), updatedAt: z.string() })
  .strict();

export const recordSchema = z
  .object({
    id: nonNegativeInt,
    result: gameResultSchema,
    level: positiveInt,
    waveReached: z.number().int(),
    livesRemaining: z.number().int(),
    elapsedMs: z.number(),
    configVersion: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const recordListSchema = z.object({ total: nonNegativeInt, items: z.array(recordSchema) }).strict();

export const recordCreateSchema = z
  .object({
    result: gameResultSchema,
    level: positiveInt,
    waveReached: z.number().int().min(1),
    livesRemaining: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    configVersion: z.string().min(1),
  })
  .strict();

export const errorEnvelopeSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string() }).strict() })
  .strict();

export const healthSchema = z.object({ status: z.string() }).strict();

// ---------------------------------------------------------------------------
// 推导类型
// ---------------------------------------------------------------------------

export type ConfigResponse = z.infer<typeof configResponseSchema>;
export type CampaignInfo = z.infer<typeof campaignInfoSchema>;
export type TowerDef = z.infer<typeof towerDefSchema>;
export type TowerLevelStats = z.infer<typeof towerLevelStatsSchema>;
export type EnemyDef = z.infer<typeof enemyDefSchema>;
export type WaveDef = z.infer<typeof waveDefSchema>;
export type SavePayload = z.infer<typeof savePayloadSchema>;
export type SaveWriteResponse = z.infer<typeof saveWriteResponseSchema>;
export type AuthUser = z.infer<typeof userSchema>;
export type AutoSaveOut = z.infer<typeof autoSaveOutSchema>;
export type AutoSaveWriteResponse = z.infer<typeof autoSaveWriteResponseSchema>;
export type GameRecord = z.infer<typeof recordSchema>;
export type RecordList = z.infer<typeof recordListSchema>;
export type RecordCreate = z.infer<typeof recordCreateSchema>;
export type TargetingMode = z.infer<typeof targetingModeSchema>;
export type WaveState = z.infer<typeof waveStateSchema>;
export type TowerRole = z.infer<typeof towerRoleSchema>;

// ---------------------------------------------------------------------------
// 编译期契约断言：zod 推导类型 与 内核类型 必须双向可赋值
// ---------------------------------------------------------------------------

type MutualAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 若不是 `true`，说明 zod schema 与内核类型漂移了（tsc 会在此报错）。 */
export const CONFIG_TYPE_COMPATIBLE: MutualAssignable<ConfigResponse, KernelGameConfig> = true;
export const SAVE_PAYLOAD_TYPE_COMPATIBLE: MutualAssignable<SavePayload, KernelSavePayload> = true;

export function formatConfigError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}：${issue.message}`)
    .join('；');
}
