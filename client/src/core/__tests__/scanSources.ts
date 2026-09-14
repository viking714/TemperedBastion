/**
 * 源码扫描工具（仅供守护测试使用）。
 *
 * 提供：列出 core/ 与 render/ 下的源码文件；剥离注释与字符串字面量；
 * 提取 import/require 的模块说明符。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface SourceFile {
  path: string;
  /** 相对 client/src 的路径（用于断言与排查）。 */
  relPath: string;
  code: string;
}

function walk(dir: string, out: SourceFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push({
      path: full,
      // 相对 client/src —— 断言里用的是 `core/economy.ts` 这种带顶层的路径
      relPath: relative(SRC_ROOT, full).split(sep).join('/'),
      code: readFileSync(full, 'utf8'),
    });
  }
}

/** 列出 `client/src/<dirRelToSrc>` 下的源码文件（排除 __tests__ 与 *.test.ts）。 */
export function listSourceFiles(dirRelToSrc: string): SourceFile[] {
  const out: SourceFile[] = [];
  walk(join(SRC_ROOT, dirRelToSrc), out);
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * 剥离行注释、块注释与字符串/模板字面量，保留换行以便定位。
 * 已知局限：模板字面量内的 `${...}` 表达式会被一并剥离（本仓库不在其中放数值）。
 */
export function stripCommentsAndStrings(code: string): string {
  let out = '';
  let index = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';

  while (index < code.length) {
    const ch = code[index];
    const next = code[index + 1];

    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        index += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        index += 2;
        continue;
      }
      if (ch === "'") {
        mode = 'single';
        index += 1;
        continue;
      }
      if (ch === '"') {
        mode = 'double';
        index += 1;
        continue;
      }
      if (ch === '`') {
        mode = 'template';
        index += 1;
        continue;
      }
      out += ch;
      index += 1;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += '\n';
      }
      index += 1;
      continue;
    }

    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        index += 2;
        continue;
      }
      if (ch === '\n') out += '\n';
      index += 1;
      continue;
    }

    // 字符串 / 模板字面量
    const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
    if (ch === '\\') {
      index += 2;
      continue;
    }
    if (ch === quote) {
      mode = 'code';
      index += 1;
      continue;
    }
    if (ch === '\n') out += '\n';
    index += 1;
  }
  return out;
}

const NUMERIC_LITERAL_RE = /(?<![\w$.])(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w$])/g;

export interface NumericLiteral {
  literal: string;
  line: number;
}

/** 找出剥离注释/字符串后残留的数字字面量（带行号）。 */
export function findNumericLiterals(code: string): NumericLiteral[] {
  const stripped = stripCommentsAndStrings(code);
  const found: NumericLiteral[] = [];
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    NUMERIC_LITERAL_RE.lastIndex = 0;
    let match = NUMERIC_LITERAL_RE.exec(lines[i]);
    while (match !== null) {
      found.push({ literal: match[1], line: i + 1 });
      match = NUMERIC_LITERAL_RE.exec(lines[i]);
    }
  }
  return found;
}

export interface ModuleSpecifier {
  specifier: string;
}

const SPECIFIER_RE = /(?:from|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

/** 提取 import / export from / dynamic import / require 的模块说明符。 */
export function findModuleSpecifiers(code: string): ModuleSpecifier[] {
  const found: ModuleSpecifier[] = [];
  SPECIFIER_RE.lastIndex = 0;
  let match = SPECIFIER_RE.exec(code);
  while (match !== null) {
    found.push({ specifier: match[1] });
    match = SPECIFIER_RE.exec(code);
  }
  return found;
}

/** 在剥离注释/字符串后的代码里查找标识符（词边界匹配）。 */
export function findIdentifiers(code: string, identifiers: readonly string[]): string[] {
  const stripped = stripCommentsAndStrings(code);
  const hits: string[] = [];
  for (const identifier of identifiers) {
    const re = new RegExp(`(?<![\\w$.])${identifier}\\b`);
    if (re.test(stripped)) hits.push(identifier);
  }
  return hits;
}
