/**
 * AC-3(b) 守护：前端源码里不存在「战斗数值」字面量。
 *
 * 扫描范围：client/src/core/** 与 client/src/render/**（不含 __tests__ 与 *.test.ts）。
 * 白名单只有网格/索引/循环数学会用到的那几个值；唯一例外是 core/units.ts 里的
 * 时间单位换算常量（`MS_PER_SEC`），且该豁免被限制在**那一个文件**里——所以这份
 * 守护不会因为开了个口子而失效。
 */
import { describe, expect, it } from 'vitest';
import { findNumericLiterals, listSourceFiles } from './scanSources';
import type { SourceFile } from './scanSources';

const WHITELIST = new Set(['0', '1', '2', '0.5']);
const UNIT_FILE_SUFFIX = 'core/units.ts';
const UNIT_FILE_ONLY_ALLOWANCE = new Set(['1000']);

export interface NumericViolation {
  file: string;
  line: number;
  literal: string;
}

function collectViolations(files: readonly SourceFile[]): NumericViolation[] {
  const violations: NumericViolation[] = [];
  for (const file of files) {
    const isUnitFile = file.relPath.endsWith(UNIT_FILE_SUFFIX);
    for (const found of findNumericLiterals(file.code)) {
      if (WHITELIST.has(found.literal)) continue;
      if (isUnitFile && UNIT_FILE_ONLY_ALLOWANCE.has(found.literal)) continue;
      violations.push({ file: file.relPath, line: found.line, literal: found.literal });
    }
  }
  return violations;
}

function format(violations: readonly NumericViolation[]): string {
  return violations.map((item) => `${item.file}:${item.line} → ${item.literal}`).join('\n');
}

const coreFiles = listSourceFiles('core');
const renderFiles = listSourceFiles('render');

describe('no-hardcoded-balance: 扫描器自校验（防止守护空转）', () => {
  it('能识别植入的违规字面量', () => {
    const planted: SourceFile[] = [{ path: 'x', relPath: 'core/fake.ts', code: 'export const damage = 25;' }];
    const violations = collectViolations(planted);
    expect(violations).toHaveLength(1);
    expect(violations[0].literal).toBe('25');
  });

  it('白名单内的数字与注释/字符串中的数字不报错', () => {
    const ok: SourceFile[] = [
      {
        path: 'x',
        relPath: 'core/ok.ts',
        code: [
          '// 注释里的 999 不该被算作字面量',
          "const label = 'damage=25';",
          'const i = array[0];',
          'const half = 0.5;',
          'const two = 2;',
          'const one = -1;',
        ].join('\n'),
      },
    ];
    expect(collectViolations(ok)).toEqual([]);
  });

  it('units.ts 之外的时间常量也会被拦下（豁免是文件级的，不是全局的）', () => {
    const planted: SourceFile[] = [{ path: 'x', relPath: 'core/economy.ts', code: 'const ms = 1000;' }];
    expect(collectViolations(planted)).toHaveLength(1);
  });
});

describe('no-hardcoded-balance: core/ 与 render/ 实际源码', () => {
  it('core/ 下不存在白名单外的数字字面量', () => {
    expect(coreFiles.length).toBeGreaterThanOrEqual(12);
    const violations = collectViolations(coreFiles);
    expect(violations, `发现硬编码战斗数值：\n${format(violations)}`).toEqual([]);
  });

  it('render/ 下不存在白名单外的数字字面量', () => {
    expect(renderFiles.length).toBeGreaterThanOrEqual(5);
    const violations = collectViolations(renderFiles);
    expect(violations, `发现硬编码战斗数值：\n${format(violations)}`).toEqual([]);
  });

  it('确认扫描到了核心作战模块（不是扫了个空目录）', () => {
    const names = coreFiles.map((file) => file.relPath);
    for (const expected of [
      'core/economy.ts',
      'core/waveStateMachine.ts',
      'core/placement.ts',
      'core/combat.ts',
      'core/simulation.ts',
      'core/serialize.ts',
      'core/units.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
