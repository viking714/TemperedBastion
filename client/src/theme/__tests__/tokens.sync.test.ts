/**
 * 令牌一致性守护：tokens.css（CSS 自定义属性，权威源）与 tokens.ts（Canvas 镜像）
 * 的键集合与取值必须逐字一致，防止两处漂移。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssTokens } from '../tokens';

const CSS_PATH = fileURLToPath(new URL('../tokens.css', import.meta.url));

/** 归一化：去掉注释、折叠空白。 */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCssTokens(source: string): Record<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const parsed: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match = re.exec(withoutComments);
  while (match !== null) {
    parsed[match[1]] = normalize(match[2]);
    match = re.exec(withoutComments);
  }
  return parsed;
}

const cssValues = parseCssTokens(readFileSync(CSS_PATH, 'utf8'));
const tsValues = Object.fromEntries(Object.entries(cssTokens).map(([key, value]) => [key, normalize(value)]));

describe('theme: tokens.css ↔ tokens.ts 一致性', () => {
  it('CSS 里确实解析出了令牌（解析器没失效）', () => {
    expect(Object.keys(cssValues).length).toBeGreaterThan(80);
    expect(cssValues['md-sys-color-primary']).toBe('#8ad5ff');
  });

  it('TS 里没有 CSS 中不存在的令牌', () => {
    const missingInCss = Object.keys(tsValues).filter((key) => !(key in cssValues));
    expect(missingInCss, `tokens.ts 多出这些令牌：${missingInCss.join(', ')}`).toEqual([]);
  });

  it('CSS 里没有 TS 中不存在的令牌', () => {
    const missingInTs = Object.keys(cssValues).filter((key) => !(key in tsValues));
    expect(missingInTs, `tokens.css 多出这些令牌：${missingInTs.join(', ')}`).toEqual([]);
  });

  it('同名令牌取值逐字一致', () => {
    const mismatched = Object.keys(cssValues)
      .filter((key) => key in tsValues && cssValues[key] !== tsValues[key])
      .map((key) => `${key}: css="${cssValues[key]}" ts="${tsValues[key]}"`);
    expect(mismatched, `令牌漂移：\n${mismatched.join('\n')}`).toEqual([]);
  });
});
