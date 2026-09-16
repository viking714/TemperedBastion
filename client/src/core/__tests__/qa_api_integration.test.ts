/**
 * QA 独立测试 · AC-4 自动存档往返 + 战绩 + API 边界 + 账号隔离（需后端运行）。
 *
 * 关键点：存档 payload 由**真实内核**（createGame/applyCommand/step/toSavePayload）产生，
 * 而非手写 fixture —— 这正是 Developer 自报「契约漂移（cooldownMs 缺失→422）」的复验方式。
 *
 * 多用户化：受保护接口（/api/autosave、/api/records）需要登录；本套件在 beforeAll
 * 注册一个 QA 专用账号并携带会话 Cookie；需要「无存档」前置的用例注册独立的新账号。
 *
 * ── 怎么带后端跑这套（A-2）────────────────────────────────────────────────────
 * 本套件需要**活的**后端。若后端不可达，`beforeAll` 预检会打印原因，且每条用例
 * 显式 SKIP（不计失败），因此干净的 `npm test` 不会因为这里而变红。
 *   1) 起后端（任选其一）：
 *        · 仓库根： `npm run dev:server`                      （默认 8000 端口）
 *        · 手动：   `python -m uvicorn app.main:app --port 8000`（cwd=server）
 *   2) 跑本文件：
 *        · `cd client && npx vitest run --environment node src/core/__tests__/qa_api_integration.test.ts`
 *        · 或整跑 `cd client && npm test`（此时 API 用例会真跑，不再 skip）
 *   3) 端口非 8000 时：`QA_API_BASE=http://127.0.0.1:<port>` 覆盖。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, applyCommand, step, toSavePayload } from '..';
import type { GameConfig } from '..';
import { deepDiff, probeBackend, registerQaUser, skipIfBackendDown, uniqueQaUsername } from './qa_helpers';

const BASE = process.env.QA_API_BASE ?? 'http://127.0.0.1:8000';
const SIM_DT = 1 / 60;

/** 当前会话 Cookie（注册后写入；jget/jsend 自动携带）。 */
let sessionCookie = '';

async function registerFresh(tag: string): Promise<void> {
  sessionCookie = await registerQaUser(BASE, uniqueQaUsername(tag));
}

function withAuth(init?: RequestInit): RequestInit {
  const headers = { ...(init?.headers ?? {}) } as Record<string, string>;
  if (sessionCookie) headers.cookie = sessionCookie;
  return { ...init, headers };
}

async function jget(path: string) {
  const r = await fetch(BASE + path, withAuth());
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}
async function jsend(method: string, path: string, payload: unknown) {
  const r = await fetch(BASE + path, withAuth({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}

let cfg: GameConfig;
/** A-2：后端预检结果。false → 每条用例显式 skip（原因见下方 beforeAll 打印）。 */
let backendReady = false;

beforeAll(async () => {
  const probe = await probeBackend(BASE);
  backendReady = probe.ready;
  if (!backendReady) {
    console.warn(
      `\n[qa-skip] qa_api_integration：后端 ${BASE} 不可达（${probe.detail}）→ 本文件全部用例 SKIP（不判失败）。\n` +
        `          带后端跑法见本文件顶部注释（npm run dev:server → npm test）。\n`,
    );
    return;
  }
  const r = await jget('/api/config');
  if (r.status !== 200) throw new Error(`后端已响应但 GET /api/config 非 200：${r.status}`);
  cfg = r.body as GameConfig;
  await registerFresh('main');
});

/** 用真实内核推进出一局「进行中」的状态，并快照成真实 payload。 */
function realPayload() {
  let s = createGame(cfg);
  s = applyCommand(s, { type: 'BUILD_TOWER', col: 2, row: 2, towerId: 'arrow' }, cfg).state;
  s = applyCommand(s, { type: 'BUILD_TOWER', col: 3, row: 3, towerId: 'frost' }, cfg).state;
  s = applyCommand(s, { type: 'UPGRADE_TOWER', col: 2, row: 2 }, cfg).state;
  s = applyCommand(s, { type: 'START_WAVE' }, cfg).state;
  s = applyCommand(s, { type: 'START_WAVE' }, cfg).state;
  for (let i = 0; i < 900; i++) s = step(s, SIM_DT, cfg);
  return toSavePayload(s, {
    level: cfg.campaign.level,
    configVersion: cfg.version,
    savedAt: new Date().toISOString(),
  });
}

describe('QA-AC4 自动存档往返（真实内核 payload）', () => {
  it('PUT 真实 payload → 200；GET 回读逐字段一致（含浮点毫秒与开火相位）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('roundtrip');
    const payload = realPayload();
    // 前置断言：payload 确实带上了 cooldownMs（Developer 自报漂移点）
    expect(payload.towers.length).toBeGreaterThan(0);
    expect(typeof payload.towers[0].cooldownMs).toBe('number');
    expect(Number.isInteger(payload.elapsedMs)).toBe(false); // 浮点毫秒

    const put = await jsend('PUT', '/api/autosave', payload);
    expect(put.status, `PUT 应 200，实际 ${put.status} ${JSON.stringify(put.body)}`).toBe(200);
    expect(put.body.ok).toBe(true);
    expect(typeof put.body.updatedAt).toBe('string');

    const get = await jget('/api/autosave');
    expect(get.status).toBe(200);
    expect(get.body.totalLevels).toBe(10);
    const diff = deepDiff(payload, get.body.payload);
    expect(diff, `读档与存档不一致：\n${diff.join('\n')}`).toEqual([]);
    console.log(`[QA ac4] elapsedMs=${payload.elapsedMs} towers=${JSON.stringify(payload.towers)}`);
  });

  it('GET 无存档的新账号 → 404 AUTOSAVE_NOT_FOUND（统一错误信封）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('missing');
    const r = await jget('/api/autosave');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('AUTOSAVE_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('[复验自报缺陷] 缺 towers[].cooldownMs → 422 且错误信息提及 cooldownMs', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('broken');
    const payload = realPayload();
    const broken: any = JSON.parse(JSON.stringify(payload));
    delete broken.towers[0].cooldownMs;
    const r = await jsend('PUT', '/api/autosave', broken);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(r.body)).toContain('cooldownMs');
  });

  it('存档可继续：读回的 payload 经内核 fromSavePayload 还原不丢塔/波次', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('restore');
    const payload = realPayload();
    expect((await jsend('PUT', '/api/autosave', payload)).status).toBe(200);

    const get = await jget('/api/autosave');
    expect(get.status).toBe(200);
    const { fromSavePayload } = await import('..');
    const restored = fromSavePayload(get.body.payload, cfg);
    expect(restored.towers.length).toBeGreaterThan(0);
    expect(restored.currentWave).toBeGreaterThanOrEqual(1);
    expect(restored.gold).toBe(get.body.payload.gold);
  });
});

describe('QA-AC4 战绩查询（按账号隔离）', () => {
  it('POST 战绩 → 201；GET 列表字段完整且按时间倒序', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const marker = 'qa-' + Date.now();
    const post = await jsend('POST', '/api/records', {
      result: 'victory', level: 2, waveReached: 10, livesRemaining: 7, elapsedMs: 123456.5, configVersion: marker,
    });
    expect(post.status).toBe(201);
    expect(post.body.id).toBeGreaterThan(0);
    expect(post.body.result).toBe('victory');
    expect(post.body.level).toBe(2);
    expect(typeof post.body.createdAt).toBe('string');

    const list = await jget('/api/records?limit=200');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const mine = list.body.items.find((r: any) => r.configVersion === marker);
    expect(mine, '战绩列表应包含刚登记的一局').toBeTruthy();
    for (const f of ['result', 'level', 'waveReached', 'livesRemaining', 'elapsedMs', 'createdAt']) {
      expect(mine[f], `字段 ${f} 缺失`).not.toBeUndefined();
    }
    // 倒序：createdAt 非递增（同秒则按 id 降序）
    const items = list.body.items;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1], cur = items[i];
      const ok = prev.createdAt > cur.createdAt || (prev.createdAt === cur.createdAt && prev.id > cur.id);
      expect(ok, `第 ${i} 项未按倒序排列`).toBe(true);
    }
  });

  it('POST 非法 result → 422 VALIDATION_ERROR', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const r = await jsend('POST', '/api/records', { result: 'draw', waveReached: 3, livesRemaining: 1, elapsedMs: 1, configVersion: 'x' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('多账号隔离：A 的自动存档与战绩对 B 不可见', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('iso-a');
    const payload = { ...realPayload(), configVersion: 'iso-A-marker' };
    expect((await jsend('PUT', '/api/autosave', payload)).status).toBe(200);
    expect((await jsend('POST', '/api/records', {
      result: 'victory', level: 1, waveReached: 2, livesRemaining: 5, elapsedMs: 10, configVersion: 'iso-A-rec',
    })).status).toBe(201);

    await registerFresh('iso-b');
    const crossSave = await jget('/api/autosave');
    expect(crossSave.status, 'B 不应看到 A 的自动存档').toBe(404);
    const crossRecords = await jget('/api/records');
    const leaked = (crossRecords.body.items ?? []).filter((r: any) => r.configVersion === 'iso-A-rec');
    expect(leaked.length, 'B 不应看到 A 的战绩').toBe(0);
  });
});

describe('QA-API 边界（6 维）', () => {
  it('auth_guard：未登录访问受保护接口 → 401', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const noCookie = { method: 'GET' as const };
    expect((await fetch(BASE + '/api/autosave', noCookie)).status).toBe(401);
    expect((await fetch(BASE + '/api/records', noCookie)).status).toBe(401);
    // 公开接口不受影响
    expect((await fetch(BASE + '/api/config', noCookie)).status).toBe(200);
  });

  it('empty_input：PUT {} → 422；POST /records {} → 422', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    expect((await jsend('PUT', '/api/autosave', {})).status).toBe(422);
    expect((await jsend('POST', '/api/records', {})).status).toBe(422);
  });

  it('numeric_edge：limit=0 / 201 → 422；limit=200 → 200', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    expect((await jget('/api/records?limit=0')).status).toBe(422);
    expect((await jget('/api/records?limit=201')).status).toBe(422);
    expect((await jget('/api/records?limit=200')).status).toBe(200);
  });

  it('huge_input：带 2000 个敌人的存档 PUT → 200，且回读数量不丢', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('huge');
    const payload: any = JSON.parse(JSON.stringify(realPayload()));
    payload.enemies = [];
    for (let i = 1; i <= 2000; i++) {
      payload.enemies.push({ id: i, enemyId: 'normal', pathDistance: i * 0.25, hp: 100, maxHp: 100, spawnOrder: i, slowDebuffs: [] });
    }
    payload.nextEnemyId = 2001;
    const put = await jsend('PUT', '/api/autosave', payload);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const get = await jget('/api/autosave');
    expect(get.body.payload.enemies.length).toBe(2000);
  });

  it('异常状态：畸形 JSON body → 4xx（不 500）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const r = await fetch(BASE + '/api/autosave', withAuth({
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{not json',
    }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('concurrency：并发 PUT 自动存档 → 全部 200，最终态为其中之一（无损坏）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    await registerFresh('conc');
    const a: any = { ...realPayload(), configVersion: 'conc-A' };
    const b: any = { ...realPayload(), configVersion: 'conc-B' };
    const [ra, rb] = await Promise.all([
      jsend('PUT', '/api/autosave', a),
      jsend('PUT', '/api/autosave', b),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const get = await jget('/api/autosave');
    expect(['conc-A', 'conc-B']).toContain(get.body.payload.configVersion);
  });

  it('concurrency：并发 POST 5 条战绩 → 全部 201，按唯一标记找齐', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const marker = 'conc-' + Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        jsend('POST', '/api/records', { result: 'defeat', level: 1, waveReached: i + 1, livesRemaining: 0, elapsedMs: i, configVersion: marker }),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const after = await jget('/api/records?limit=200');
    const mine = (after.body?.items ?? []).filter((r: any) => r.configVersion === marker);
    expect(mine.length, `本用例写入的 5 条应按唯一标记找齐：${marker}`).toBe(5);
  });
});
