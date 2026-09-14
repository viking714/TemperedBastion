/**
 * 内核边界守护（AC-5 的命脉）。
 *
 * `client/src/core/**` 必须零依赖、零浏览器 API：
 *   - 不得 import react / react-dom / engine / render / ui / api / theme / 任何裸模块；
 *   - 不得触碰 document / window / navigator / canvas / requestAnimationFrame /
 *     performance / fetch / localStorage 等浏览器全局。
 *
 * 边界一旦被后续改动破坏，本测试立刻失败。
 */
import { describe, expect, it } from 'vitest';
import * as core from '../index';
import { findIdentifiers, findModuleSpecifiers, listSourceFiles, stripCommentsAndStrings } from './scanSources';
import type { SourceFile } from './scanSources';

/**
 * 被禁的依赖命名空间。
 *
 * 注意这里**没有** `config`：`client/src/core/config.ts` 是内核自己的
 * 「配置访问辅助」模块（见 ADD 的 directory_tree），与前端 `src/config/**`
 * （zod schema 层）同名但不同物。前端 config 层仍被拦住——因为从 core 引用它
 * 必然是 `../config/...`，会先被 `escapesCore` 判为越界导入。
 */
const FORBIDDEN_SPECIFIERS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'engine',
  'render',
  'ui',
  'api',
  'theme',
  'zod',
  'zustand',
  'redux',
];

const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Image',
  'Audio',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'devicePixelRatio',
  'globalThis',
];

export interface BoundaryViolation {
  file: string;
  kind: 'import' | 'global';
  detail: string;
}

/** specifier 是否逃出了 client/src/core（相对路径也可能指出去）。 */
function escapesCore(fileRelPath: string, specifier: string): boolean {
  const parts = fileRelPath.split('/').slice(0, -1); // 例如 ['core']
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts[0] !== 'core';
}

export function collectBoundaryViolations(files: readonly SourceFile[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    for (const { specifier } of findModuleSpecifiers(file.code)) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!isRelative) {
        violations.push({ file: file.relPath, kind: 'import', detail: `裸模块依赖：${specifier}` });
        continue;
      }
      if (escapesCore(file.relPath, specifier)) {
        violations.push({ file: file.relPath, kind: 'import', detail: `越界导入：${specifier}` });
        continue;
      }
      const head = specifier.split('/')[1] ?? '';
      if (FORBIDDEN_SPECIFIERS.includes(head)) {
        violations.push({ file: file.relPath, kind: 'import', detail: `禁用依赖：${specifier}` });
      }
    }

    for (const identifier of findIdentifiers(file.code, FORBIDDEN_GLOBALS)) {
      violations.push({ file: file.relPath, kind: 'global', detail: `禁用浏览器全局：${identifier}` });
    }

    if (/\brequire\s*\(/.test(stripCommentsAndStrings(file.code))) {
      violations.push({ file: file.relPath, kind: 'import', detail: '出现 require()（内核应只用 ESM import）' });
    }
  }

  return violations;
}

function format(violations: readonly BoundaryViolation[]): string {
  return violations.map((item) => `${item.file} [${item.kind}] ${item.detail}`).join('\n');
}

const coreFiles = listSourceFiles('core');

describe('core.boundary: 扫描器自校验（防止守护空转）', () => {
  it('能识别越界的 import', () => {
    const planted: SourceFile[] = [
      { path: 'x', relPath: 'core/fake.ts', code: "import { useState } from 'react';" },
      { path: 'y', relPath: 'core/fake2.ts', code: "import { GameStore } from '../engine/GameStore';" },
      { path: 'z', relPath: 'core/fake3.ts', code: "import { tokens } from '../theme/tokens';" },
    ];
    const violations = collectBoundaryViolations(planted);
    expect(violations.length).toBe(3);
    expect(violations.every((item) => item.kind === 'import')).toBe(true);
  });

  it('能识别浏览器全局（含 document / window 等）', () => {
    const planted: SourceFile[] = [
      {
        path: 'x',
        relPath: 'core/fake.ts',
        code: 'export function f() { return document.title + window.location.href; }',
      },
    ];
    const details = collectBoundaryViolations(planted).map((item) => item.detail);
    expect(details).toContain('禁用浏览器全局：document');
    expect(details).toContain('禁用浏览器全局：window');
  });

  it('合法的 core 内部相对导入不报错', () => {
    const ok: SourceFile[] = [
      { path: 'x', relPath: 'core/ok.ts', code: "import { step } from './simulation';\nimport { MS_PER_SEC } from './units';" },
    ];
    expect(collectBoundaryViolations(ok)).toEqual([]);
  });

  it('注释里出现 window/document 不报错（先剥离注释）', () => {
    const ok: SourceFile[] = [
      { path: 'x', relPath: 'core/ok.ts', code: '// 内核不得使用 window / document\nexport const a = 1;' },
    ];
    expect(collectBoundaryViolations(ok)).toEqual([]);
  });
});

describe('core.boundary: 实际内核源码', () => {
  it('core/ 下没有任何越界 import 或浏览器全局', () => {
    expect(coreFiles.length).toBeGreaterThanOrEqual(12);
    const violations = collectBoundaryViolations(coreFiles);
    expect(violations, `内核边界被破坏：\n${format(violations)}`).toEqual([]);
  });

  it('core/ 只 import 同目录/子目录的相对模块', () => {
    for (const file of coreFiles) {
      for (const { specifier } of findModuleSpecifiers(file.code)) {
        expect(specifier.startsWith('./') || specifier.startsWith('../')).toBe(true);
        expect(escapesCore(file.relPath, specifier)).toBe(false);
      }
    }
  });

  it('内核公共 API 齐备（AC-5 三块必测 + 推演/序列化）', () => {
    const api = core as unknown as Record<string, unknown>;
    const required = [
      // economy
      'canAfford',
      'spend',
      'addKillReward',
      'addWaveClearBonus',
      'computeSellRefund',
      'computeUpgradeCost',
      // wave state machine
      'reduce',
      'isTerminal',
      // placement
      'rasterizePath',
      'isBuildable',
      // simulation / combat / serialize
      'step',
      'applyArmor',
      'computeSlowFactor',
      'applySlowDebuff',
      'createGame',
      'applyCommand',
      'toSavePayload',
      'fromSavePayload',
    ];
    for (const name of required) {
      expect(typeof api[name], `缺少内核导出：${name}`).toBe('function');
    }
  });

  it('内核不依赖任何第三方运行时（源码里没有裸模块说明符）', () => {
    const specs = coreFiles.flatMap((file) => findModuleSpecifiers(file.code).map((item) => item.specifier));
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.every((specifier) => specifier.startsWith('./') || specifier.startsWith('../'))).toBe(true);
  });
});
