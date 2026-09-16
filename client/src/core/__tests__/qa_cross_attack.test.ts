/**
 * QA 独立测试 · Cross-Role-Check（跨角色契约对抗），**需后端在 BASE 运行**。
 *
 * 与 AC 用例的分工：AC 用例验「功能对不对」，本文件专门攻击「两份契约会不会对不上」——
 *   1) 前端 zod schema（strict）能否吃下后端真实响应 /api/config 与 /api/save/{slot}；
 *   2) 逐层键集合 diff：后端 JSON 键 vs 前端 schema 声明键（漂移立刻暴露）；
 *   3) 用**真实内核**产出的 payload 打后端，并跑一张畸形 payload 对抗矩阵。
 * 证据落盘 <products_dir>/cross_attack_evidence.json（由测试自己写，非人工誊抄）。
 *
 * ── 怎么带后端跑这套（A-2）────────────────────────────────────────────────────
 * 本套件需要**活的**后端。若后端不可达，`beforeAll` 预检会打印原因，且每条用例
 * 显式 SKIP（不计失败），因此干净的 `npm test` 不会因为这里而变红。
 *   1) 起后端（任选其一）：
 *        · 仓库根： `npm run dev:server`                      （默认 8000 端口）
 *        · 手动：   `<products_dir>/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`（cwd=server）
 *   2) 跑本文件：
 *        · `cd client && npx vitest run --environment node src/core/__tests__/qa_cross_attack.test.ts`
 *        · 或整跑 `cd client && npm test`（此时跨角色用例会真跑，不再 skip）
 *   3) 端口非 8000 时：`QA_API_BASE=http://127.0.0.1:<port>` 覆盖；
 *      证据输出路径可用 `QA_EVIDENCE_PATH` 覆盖。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createGame, applyCommand, step, toSavePayload } from '..';
import type { GameConfig, SavePayload as KernelSavePayload } from '..';
import { configResponseSchema, savePayloadSchema } from '../../config/schema';
import { deepDiff, probeBackend, skipIfBackendDown } from './qa_helpers';

const BASE = process.env.QA_API_BASE ?? 'http://127.0.0.1:8000';
const SIM_DT = 1 / 60;
/** 证据落盘到**产物目录根**（不是 tmp/），作为交付物的一部分。 */
const EVIDENCE =
  process.env.QA_EVIDENCE_PATH ??
  'C:/Work/swebench/tower-defense/artifacts/cross_attack_evidence.json';

async function jget(path: string) {
  const r = await fetch(BASE + path);
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}
async function jsend(method: string, path: string, payload: unknown) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}

/** zod 结构探针：取对象 schema 的声明键 / 数组元素 schema（兼容 zod v3 的 _def 形态）。 */
function shapeKeys(schema: any): string[] | null {
  try {
    const s = typeof schema?.shape === 'function' ? schema.shape() : schema?.shape;
    return s ? Object.keys(s) : null;
  } catch { return null; }
}
function elementSchema(schema: any): any {
  return schema?.element ?? schema?._def?.type ?? null;
}
function compareKeys(label: string, backend: Record<string, unknown>, schema: any, out: any[]): void {
  const declared = shapeKeys(schema);
  if (!declared) return;
  const actual = Object.keys(backend).sort();
  const expect = [...declared].sort();
  const missing = expect.filter((k) => !actual.includes(k)); // 前端要、后端没给
  const extra = actual.filter((k) => !expect.includes(k));   // 后端给了、前端 schema 不认识（strict 会拒）
  out.push({ path: label, backendKeys: actual, frontendKeys: expect, missingInBackend: missing, unknownToFrontend: extra });
}

let cfg: GameConfig;
let evidence: any = { generatedAt: new Date().toISOString(), base: BASE, sections: {} };
/** A-2：后端预检结果。false → 每条用例显式 skip（原因见下方 beforeAll 打印）。 */
let backendReady = false;

beforeAll(async () => {
  const probe = await probeBackend(BASE);
  backendReady = probe.ready;
  if (!backendReady) {
    console.warn(
      `\n[qa-skip] qa_cross_attack：后端 ${BASE} 不可达（${probe.detail}）→ 本文件全部用例 SKIP（不判失败）。\n` +
        `          带后端跑法见本文件顶部注释（npm run dev:server → npm test）。\n`,
    );
    return;
  }
  const r = await jget('/api/config');
  if (r.status !== 200) throw new Error(`后端已响应但 GET /api/config 非 200：${r.status}`);
  cfg = r.body as unknown as GameConfig;
});

/** 真实内核推进出一局「进行中 + 双塔 + 场上仍有敌人」状态。
 *
 *  塔位刻意选在左下角 (0,11)/(1,11)：远离第 1 波的行 1 走廊，
 *  塔打不到早期敌人 → 保证 payload.enemies 非空（对抗矩阵要用 enemies[0]）。
 */
function buildRealPayload(): KernelSavePayload {
  let s = createGame(cfg);
  s = applyCommand(s, { type: 'BUILD_TOWER', col: 0, row: 11, towerId: 'arrow' }, cfg).state;
  s = applyCommand(s, { type: 'BUILD_TOWER', col: 1, row: 11, towerId: 'frost' }, cfg).state;
  s = applyCommand(s, { type: 'UPGRADE_TOWER', col: 0, row: 11 }, cfg).state;
  s = applyCommand(s, { type: 'START_WAVE' }, cfg).state;
  s = applyCommand(s, { type: 'START_WAVE' }, cfg).state;
  for (let i = 0; i < 421; i++) s = step(s, SIM_DT, cfg);
  const payload = toSavePayload(s, {
    level: cfg.campaign.level,
    configVersion: cfg.version,
    savedAt: new Date().toISOString(),
  });
  if (payload.towers.length === 0 || payload.enemies.length === 0) {
    throw new Error(`构造前提不成立：towers=${payload.towers.length} enemies=${payload.enemies.length}`);
  }
  return payload;
}

describe('Cross-Role-Check A：公开配置契约（后端响应 × 前端 zod）', () => {
  it('A-1 后端 /api/config 能被前端 configResponseSchema（strict）解析，且逐层键集合一致', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const r = await jget('/api/config');
    expect(r.status).toBe(200);
    const parsed = configResponseSchema.safeParse(r.body);
    if (!parsed.success) console.log('[cross] config zod 失败：', JSON.stringify(parsed.error.issues.slice(0, 6)));

    const diffs: any[] = [];
    const b = r.body;
    compareKeys('$', b, configResponseSchema, diffs);
    compareKeys('$.grid', b.grid, configResponseSchema.shape.grid, diffs);
    compareKeys('$.canvas', b.canvas, configResponseSchema.shape.canvas, diffs);
    compareKeys('$.map', b.map, configResponseSchema.shape.map, diffs);
    compareKeys('$.economy', b.economy, configResponseSchema.shape.economy, diffs);
    compareKeys('$.rules', b.rules, configResponseSchema.shape.rules, diffs);
    compareKeys('$.towers[]', b.towers[0], elementSchema(configResponseSchema.shape.towers), diffs);
    compareKeys('$.towers[].levels[]', b.towers[0].levels[0], elementSchema(elementSchema(configResponseSchema.shape.towers).shape.levels), diffs);
    compareKeys('$.enemies[]', b.enemies[0], elementSchema(configResponseSchema.shape.enemies), diffs);
    compareKeys('$.waves[]', b.waves[0], elementSchema(configResponseSchema.shape.waves), diffs);
    compareKeys('$.waves[].groups[]', b.waves[0].groups[0], elementSchema(elementSchema(configResponseSchema.shape.waves).shape.groups), diffs);

    evidence.sections.publicConfigContract = {
      backendStatus: r.status,
      frontendSchemaAccepted: parsed.success,
      zodIssues: parsed.success ? [] : parsed.error.issues.slice(0, 6),
      keyDiff: diffs,
      driftCount: diffs.reduce((n, d) => n + d.missingInBackend.length + d.unknownToFrontend.length, 0),
    };
    expect(diffs.every((d) => d.missingInBackend.length === 0 && d.unknownToFrontend.length === 0), JSON.stringify(diffs.filter((d) => d.missingInBackend.length || d.unknownToFrontend.length))).toBe(true);
    expect(parsed.success).toBe(true);
  });
});

describe('Cross-Role-Check B：存档契约（真实内核 payload × 后端 × 前端 schema）', () => {
  it('B-1 真实内核 payload（含 cooldownMs / 浮点毫秒）PUT → 200，回读能被前端 savePayloadSchema 解析且逐字段一致', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const payload = buildRealPayload();
    const put = await jsend('PUT', '/api/save/11', { ...payload, slot: 11 });
    const got = await jget('/api/save/11');
    const diff = got.status === 200 ? deepDiff({ ...payload, slot: 11 }, got.body) : ['<GET 未成功>'];
    const zod = got.status === 200 ? savePayloadSchema.safeParse(got.body) : { success: false, error: { issues: [] } } as any;

    evidence.sections.saveContract = {
      // 对抗点：Developer 自报的契约漂移（Pydantic 缺 cooldownMs）曾让 PUT 直接 422
      tower0SentKeys: Object.keys(payload.towers[0] ?? {}),
      cooldownMsSent: (payload.towers[0] as any)?.cooldownMs,
      elapsedMsSent: payload.elapsedMs,
      putStatus: put.status,
      putBody: put.body,
      getStatus: got.status,
      roundTripDiffPaths: diff.slice(0, 12),
      frontendSchemaAccepted: zod.success,
      zodIssues: zod.success ? [] : zod.error.issues.slice(0, 6),
    };
    expect(put.status, 'PUT 真实 payload 必须 200（契约漂移会 422）').toBe(200);
    expect(got.status).toBe(200);
    expect(diff, `存档往返逐字段差异：\n${diff.join('\n')}`).toEqual([]);
    expect(zod.success, `回读 payload 不被前端 schema 接受：${JSON.stringify(zod.success ? [] : zod.error.issues.slice(0, 5))}`).toBe(true);
  });
});

describe('Cross-Role-Check C：畸形 payload 对抗矩阵', () => {
  it('C-1 各畸形输入都被后端以 4xx 明确拒绝，不 5xx、不静默接受', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const base = buildRealPayload();
    const clone = () => JSON.parse(JSON.stringify(base));
    const del = (o: any, k: string) => { delete o[k]; return o; };

    const m1 = clone(); del(m1.towers[0], 'cooldownMs');
    const m2 = clone(); del(m2, 'elapsedMs');
    const m3 = clone(); m3.extraProbeField = 1;
    const m4 = clone(); m4.towers[0].cooldownMs = '375.75';
    const m5 = clone(); m5.gold = -1;
    const m6 = clone(); m6.waveState = 'RUNNING';
    const m7 = clone(); del(m7.enemies[0], 'hp');
    const m8 = clone(); m8.towers[0].level = 0;
    const m9 = clone(); m9.speedMultiplier = 0;
    const m10 = clone(); m10.projectiles[0] = { id: 1, sourceTowerId: 0, x: 1, y: 1, speed: 1, damage: 1, extraX: 9 };

    const cases: Array<[string, unknown, string]> = [
      ['缺 cooldownMs（自报漂移点）', m1, '422'],
      ['缺 elapsedMs', m2, '422'],
      ['未知额外字段 extraProbeField', m3, '422'],
      // 期望值 'ANY'：只记录「是否发生隐式类型强转」，不作为硬性失败项（PRD 未规定类型严格性）
      ['cooldownMs 传数值字符串（记录实际行为）', m4, 'ANY'],
      ['gold = -1', m5, '422'],
      ['waveState = RUNNING（非法枚举）', m6, '422'],
      ['敌人缺 hp', m7, '422'],
      ['塔 level = 0', m8, '422'],
      ['speedMultiplier = 0', m9, '422'],
      ['projectile 带未知字段 extraX', m10, '422'],
    ];
    const rows: any[] = [];
    for (const [name, body, want] of cases) {
      const r = await jsend('PUT', '/api/save/12', body);
      const ok = want === 'ANY' ? r.status === 200 || r.status === 422 : String(r.status) === want;
      rows.push({ case: name, expect: want, actual: r.status, code: r.body?.error?.code ?? null, ok });
    }
    // 槽位与 URL 不一致：URL 是权威，body.slot 不应覆盖
    const slotBody = { ...clone(), slot: 14 };
    const slotRes = await jsend('PUT', '/api/save/13', slotBody);
    const readBack13 = await jget('/api/save/13');
    const readBack14 = await jget('/api/save/14');
    rows.push({ case: 'body.slot=14 但 URL=13（URL 应权威）', expect: '200', actual: slotRes.status, code: null, ok: slotRes.status === 200 });

    const coercionRow = rows.find((r) => r.expect === 'ANY');
    evidence.sections.malformedMatrix = {
      rows,
      // 观察项：Pydantic 非 strict 模式下数值字符串会被强转，故 "375.75" 被接受为 375.75
      numericStringCoercionAccepted: coercionRow?.actual === 200,
      slotAuthority: { urlSlot13: readBack13.status, otherSlot14: readBack14.status, urlIsAuthoritative: readBack13.status === 200 && readBack14.status === 404 },
      allRejectedAsExpected: rows.every((r) => r.ok),
    };
    for (const row of rows) expect(row.ok, `${row.case}: 期望 ${row.expect} 实得 ${row.actual} code=${row.code}`).toBe(true);
    expect(readBack13.status).toBe(200);
    expect(readBack14.status, 'body.slot 不应把存档写到 URL 之外的槽位').toBe(404);
  });

  it('C-2 缺槽位 → 404 且错误信封形状稳定；记录列表契约（字段完整性 + 倒序）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const missing = await jget('/api/save/999');
    // 用唯一标记隔离：后端库可能被同批其他用例并发写（vitest 默认按文件并行）
    const marker = `qa-marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const posted: any[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await jsend('POST', '/api/records', {
        result: i % 2 === 0 ? 'victory' : 'defeat',
        waveReached: 3 + i, livesRemaining: i, elapsedMs: 1234.5678 + i * 16.666, configVersion: marker,
      });
      posted.push({ status: r.status, id: r.body?.id, elapsedMs: r.body?.elapsedMs });
    }
    const after = await jget('/api/records?limit=200');
    const items: any[] = after.body?.items ?? [];
    const ids = items.map((x) => x.id);
    // ── A-3 修正（第 3 轮）────────────────────────────────────────────────────
    // AC-4.2 的契约是「按时间倒序」，后端实现是 `order_by(created_at.desc(), id.desc())`。
    // 旧断言检查「全局 id 严格递减」——这在**并行跑测试文件**时是错的：
    //   默认 `npm test` 同时跑 qa_api_integration，它也在并发 POST 战绩；created_at 在
    //   INSERT 之前计算、id 在提交时分配，并发下「id 递增顺序」与「created_at 递增顺序」
    //   可以不一致 → 全局 id 递减偶发不成立（第 3 轮实测 flake：7,6,5,3,2,4,1）。
    // 按契约查 created_at 倒序（id 兜底）才是稳定且正确的判据，且与后端排序键同构。
    const orderedByTimeDesc = items.every((cur, i) => {
      if (i === 0) return true;
      const prev = items[i - 1];
      return prev.createdAt > cur.createdAt || (prev.createdAt === cur.createdAt && prev.id > cur.id);
    });
    const requiredKeys = ['id', 'result', 'waveReached', 'livesRemaining', 'elapsedMs', 'configVersion', 'createdAt'];
    const firstItemKeys = items[0] ? Object.keys(items[0]).sort() : [];
    const allItemsComplete = items.every((x) => requiredKeys.every((k) => k in x));
    const mine = items.filter((x) => x.configVersion === marker);

    evidence.sections.recordsAndNotFound = {
      missingSlot: { status: missing.status, envelope: missing.body },
      envelopeShapeOk: !!(missing.body?.error && typeof missing.body.error.code === 'string' && typeof missing.body.error.message === 'string'),
      marker, postedIds: posted.map((p) => p.id), mineInList: mine.length,
      totalAfter: after.body?.total, orderedByTimeDesc, sampleIds: ids.slice(0, 12),
      sampleIdCreatedAt: items.slice(0, 12).map((x) => `${x.id}@${x.createdAt}`),
      requiredKeys, firstItemKeys, allItemsComplete,
      floatMsPreserved: posted.every((p) => Number.isFinite(p.elapsedMs) && p.elapsedMs % 1 !== 0),
    };
    expect(missing.status).toBe(404);
    expect(evidence.sections.recordsAndNotFound.envelopeShapeOk).toBe(true);
    expect(posted.every((p) => p.status === 201), JSON.stringify(posted)).toBe(true);
    expect(mine.length, `本用例写入的 3 条应能在列表中按唯一标记找回：${marker}`).toBe(3);
    expect(
      orderedByTimeDesc,
      `记录应按 createdAt 倒序（id 兜底）：${items.slice(0, 8).map((x) => `${x.id}@${x.createdAt}`).join(' | ')}`,
    ).toBe(true);
    expect(allItemsComplete).toBe(true);
    expect(evidence.sections.recordsAndNotFound.floatMsPreserved, '毫秒浮点不应被截断').toBe(true);
  });

  it('C-3 写证据文件（供主理人复核）', (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    mkdirSync('C:/Work/swebench/tower-defense/artifacts', { recursive: true });
    const s = evidence.sections;
    evidence.summary = {
      publicConfigDriftCount: s.publicConfigContract?.driftCount ?? null,
      frontendZodAccepted: s.publicConfigContract?.frontendSchemaAccepted ?? null,
      savePutStatus: s.saveContract?.putStatus ?? null,
      saveRoundTripDiffPaths: s.saveContract?.roundTripDiffPaths?.length ?? null,
      saveFrontendSchemaAccepted: s.saveContract?.frontendSchemaAccepted ?? null,
      malformedRejectedAll: s.malformedMatrix?.allRejectedAsExpected ?? null,
      malformedCases: s.malformedMatrix?.rows?.length ?? 0,
      numericStringCoercionAccepted: s.malformedMatrix?.numericStringCoercionAccepted ?? null,
      urlSlotAuthoritative: s.malformedMatrix?.slotAuthority?.urlIsAuthoritative ?? null,
      recordsAllItemsComplete: s.recordsAndNotFound?.allItemsComplete ?? null,
      recordsOrderedByTimeDesc: s.recordsAndNotFound?.orderedByTimeDesc ?? null,
      recordsFloatMsPreserved: s.recordsAndNotFound?.floatMsPreserved ?? null,
    };
    writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2), 'utf8');
    console.log('[cross-attack] evidence →', EVIDENCE, JSON.stringify(evidence.summary));
    expect(typeof evidence.summary.savePutStatus).toBe('number');
  });
});
