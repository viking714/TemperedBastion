/**
 * QA 独立测试辅助（严过关自建，不复用 Developer fixture）。
 *
 * 配置直接读后端唯一数值真源 level.json，不经任何 Developer 测试夹具。
 */
import { readFileSync } from 'node:fs';
import type { GameConfig } from '..';

export function loadRawConfig(): Record<string, unknown> {
  const url = new URL('../../../../server/config/level.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

export function loadConfig(): GameConfig {
  return { ...loadRawConfig(), version: 'qa-config-hash' } as unknown as GameConfig;
}

/** 高精度毫秒（模拟里出现 16.666… 的整数倍，浮点比较必须容差）。 */
export function closeTo(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}

// ---------------------------------------------------------------------------
// 活后端预检（A-2 修复）
//
// 需真后端的 API 套件（qa_api_integration / qa_cross_attack）在**后端不可达**时，
// 必须显式 SKIP 而非 FAIL —— 否则干净的 `npm test` 会因 ECONNREFUSED 直接飘红，
// 交付物「默认测试是红的」不可接受。但 skip 只作用于「后端没起」这一条路径：
// 后端在场时必须真跑（不是静默跳过），结果记入 test_report.json。
// ---------------------------------------------------------------------------

/** API 测试基址（与各 API 套件共用的同一默认值，可用 QA_API_BASE 覆盖）。 */
export const QA_API_BASE = process.env.QA_API_BASE ?? 'http://127.0.0.1:8000';

/**
 * 探测后端是否就绪（短超时）。
 * 判据比「端口有响应」更强：GET /api/config 必须 200 且返回体含 grid 形状，
 * 避免误把「同端口上的别的服务」当成我们的后端而让用例假跑。
 */
export async function probeBackend(
  base: string = QA_API_BASE,
  timeoutMs = 3000,
): Promise<{ ready: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/config`, { signal: ctrl.signal });
    if (res.status !== 200) return { ready: false, detail: `GET /api/config → ${res.status}` };
    const body: any = await res.json().catch(() => null);
    const shaped = !!(body && body.grid && typeof body.grid.cols === 'number' && Array.isArray(body.towers));
    return {
      ready: shaped,
      detail: shaped ? `GET /api/config → 200（含 grid/towers）` : `GET /api/config → 200 但响应形状不符`,
    };
  } catch (e) {
    return { ready: false, detail: `${base} 不可达：${(e as Error)?.message ?? String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 后端不可达 → 跳过当前用例（ctx.skip() 会抛错终止该用例，其后代码不再执行）。 */
export function skipIfBackendDown(ctx: { skip: () => void }, ready: boolean, base: string): void {
  if (ready) return;
  console.warn(`[qa-skip] 后端 ${base} 不可达 → 跳过该用例（带后端跑法见套件文件头注释）。`);
  ctx.skip();
}

/** 深比较（用于存档往返逐字段断言），返回差异路径列表。 */
export function deepDiff(a: unknown, b: unknown, path = '$'): string[] {
  if (a === b) return [];
  if (typeof a === 'number' && typeof b === 'number') {
    return closeTo(a, b, 1e-9) ? [] : [`${path}: ${a} != ${b}`];
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return [`${path}.length: ${arrA.length} != ${arrB.length}`];
    const out: string[] = [];
    for (let i = 0; i < arrA.length; i++) out.push(...deepDiff(arrA[i], arrB[i], `${path}[${i}]`));
    return out;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const out: string[] = [];
  for (const k of keys) out.push(...deepDiff(objA[k], objB[k], `${path}.${k}`));
  return out;
}
