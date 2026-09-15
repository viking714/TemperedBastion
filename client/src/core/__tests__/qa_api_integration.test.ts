/**
 * QA 独立测试 · AC-4 存档往返 + 战绩 + API 边界（需后端运行）。
 *
 * 关键点：存档 payload 由**真实内核**（createGame/applyCommand/step/toSavePayload）产生，
 * 而非手写 fixture —— 这正是 Developer 自报「契约漂移（cooldownMs 缺失→422）」的复验方式。
 *
 * ── 怎么带后端跑这套（A-2）────────────────────────────────────────────────────
 * 本套件需要**活的**后端。若后端不可达，`beforeAll` 预检会打印原因，且每条用例
 * 显式 SKIP（不计失败），因此干净的 `npm test` 不会因为这里而变红。
 *   1) 起后端（任选其一）：
 *        · 仓库根： `npm run dev:server`                      （默认 8000 端口）
 *        · 手动：   `<products_dir>/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000`（cwd=server）
 *   2) 跑本文件：
 *        · `cd client && npx vitest run --environment node src/core/__tests__/qa_api_integration.test.ts`
 *        · 或整跑 `cd client && npm test`（此时 API 用例会真跑，不再 skip）
 *   3) 端口非 8000 时：`QA_API_BASE=http://127.0.0.1:<port>` 覆盖。
 * ───────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, applyCommand, step, toSavePayload } from '..';
import type { GameConfig } from '..';
import { deepDiff, probeBackend, skipIfBackendDown } from './qa_helpers';

const BASE = process.env.QA_API_BASE ?? 'http://127.0.0.1:8000';
const SIM_DT = 1 / 60;

async function jget(path: string) {
  const r = await fetch(BASE + path);
  let body: any = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}
async function jsend(method: string, path: string, payload: unknown) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
  return toSavePayload(s, { configVersion: cfg.version, savedAt: new Date().toISOString() });
}

describe('QA-AC4 存档往返（真实内核 payload）', () => {
  it('PUT 真实 payload → 200；GET 回读逐字段一致（含浮点毫秒与开火相位）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const payload = realPayload();
    // 前置断言：payload 确实带上了 cooldownMs（Developer 自报漂移点）
    expect(payload.towers.length).toBeGreaterThan(0);
    expect(typeof payload.towers[0].cooldownMs).toBe('number');
    expect(Number.isInteger(payload.elapsedMs)).toBe(false); // 浮点毫秒

    const put = await jsend('PUT', '/api/save/1', payload);
    expect(put.status, `PUT 应 200，实际 ${put.status} ${JSON.stringify(put.body)}`).toBe(200);
    expect(put.body.ok).toBe(true);
    expect(put.body.slot).toBe(1);

    const get = await jget('/api/save/1');
    expect(get.status).toBe(200);
    const expected = { ...payload, slot: 1 };
    const diff = deepDiff(expected, get.body);
    expect(diff, `读档与存档不一致：\n${diff.join('\n')}`).toEqual([]);
    console.log(`[QA ac4] elapsedMs=${payload.elapsedMs} towers=${JSON.stringify(payload.towers)}`);
  });

  it('GET 不存在槽位 → 404 SAVE_NOT_FOUND（统一错误信封）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const r = await jget('/api/save/9999');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SAVE_NOT_FOUND');
    expect(typeof r.body.error.message).toBe('string');
  });

  it('[复验自报缺陷] 缺 towers[].cooldownMs → 422 且错误信息提及 cooldownMs', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const payload = realPayload();
    const broken: any = JSON.parse(JSON.stringify(payload));
    delete broken.towers[0].cooldownMs;
    const r = await jsend('PUT', '/api/save/2', broken);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(r.body)).toContain('cooldownMs');
  });

  it('存档可继续：读回的 payload 经内核 fromSavePayload 还原不丢塔/波次', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const get = await jget('/api/save/1');
    const { fromSavePayload } = await import('..');
    const restored = fromSavePayload(get.body, cfg);
    expect(restored.towers.length).toBeGreaterThan(0);
    expect(restored.currentWave).toBeGreaterThanOrEqual(1);
    expect(restored.gold).toBe(get.body.gold);
  });
});

describe('QA-AC4 战绩查询', () => {
  it('POST 战绩 → 201；GET 列表字段完整且按时间倒序', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const marker = 'qa-' + Date.now();
    const post = await jsend('POST', '/api/records', {
      result: 'victory', waveReached: 10, livesRemaining: 7, elapsedMs: 123456.5, configVersion: marker,
    });
    expect(post.status).toBe(201);
    expect(post.body.id).toBeGreaterThan(0);
    expect(post.body.result).toBe('victory');
    expect(typeof post.body.createdAt).toBe('string');

    const list = await jget('/api/records?limit=200');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const mine = list.body.items.find((r: any) => r.configVersion === marker);
    expect(mine, '战绩列表应包含刚登记的一局').toBeTruthy();
    for (const f of ['result', 'waveReached', 'livesRemaining', 'elapsedMs', 'createdAt']) {
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
});

describe('QA-API 边界（6 维）', () => {
  it('empty_input：PUT {} → 422；POST /records {} → 422', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    expect((await jsend('PUT', '/api/save/3', {})).status).toBe(422);
    expect((await jsend('POST', '/api/records', {})).status).toBe(422);
  });

  it('numeric_edge：slot=0 → 422；limit=0 / 201 → 422；limit=200 → 200', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    expect((await jget('/api/save/0')).status).toBe(422);
    expect((await jget('/api/records?limit=0')).status).toBe(422);
    expect((await jget('/api/records?limit=201')).status).toBe(422);
    expect((await jget('/api/records?limit=200')).status).toBe(200);
  });

  it('huge_input：带 2000 个敌人的存档 PUT → 200，且回读数量不丢', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const payload: any = JSON.parse(JSON.stringify(realPayload()));
    payload.enemies = [];
    for (let i = 1; i <= 2000; i++) {
      payload.enemies.push({ id: i, enemyId: 'normal', pathDistance: i * 0.25, hp: 100, maxHp: 100, spawnOrder: i, slowDebuffs: [] });
    }
    payload.nextEnemyId = 2001;
    const put = await jsend('PUT', '/api/save/4', payload);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const get = await jget('/api/save/4');
    expect(get.body.enemies.length).toBe(2000);
  });

  it('异常状态：畸形 JSON body → 4xx（不 500）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const r = await fetch(BASE + '/api/save/5', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{not json',
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('concurrency：并发 PUT 同一槽位 → 全部 200，最终态为其中之一（无损坏）', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const a: any = { ...realPayload(), configVersion: 'conc-A' };
    const b: any = { ...realPayload(), configVersion: 'conc-B' };
    const [ra, rb] = await Promise.all([
      jsend('PUT', '/api/save/6', a),
      jsend('PUT', '/api/save/6', b),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const get = await jget('/api/save/6');
    expect(['conc-A', 'conc-B']).toContain(get.body.configVersion);
  });

  it('concurrency：并发 POST 5 条战绩 → 全部 201，总数 +5', async (ctx) => {
    skipIfBackendDown(ctx, backendReady, BASE);
    const marker = 'conc-' + Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        jsend('POST', '/api/records', { result: 'defeat', waveReached: i + 1, livesRemaining: 0, elapsedMs: i, configVersion: marker }),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    // 用唯一 marker 计数而非全局 total 差值：默认 `npm test` 会并行跑多个文件，
    // 同一后端的其他套件可能同时在写战绩，全局 delta 会被它们扰动（假失败）。
    const after = await jget('/api/records?limit=200');
    const mine = (after.body?.items ?? []).filter((r: any) => r.configVersion === marker);
    expect(mine.length, `本用例写入的 5 条应按唯一标记找齐：${marker}`).toBe(5);
  });
});
