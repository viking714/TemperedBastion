/**
 * Ian (Tester) 独立验收套件 · td-0002 全站视觉重做
 * ------------------------------------------------------------------
 * 依据：artifacts/prd.json（AC-1..AC-12）+ add.json（design_direction / theme_ref）
 * 本套件**不参考 Developer 的测试**，全部由 PRD 与主题源 file 反向推导。
 * 落盘位置由 team-lead 指定（client/tests/td-0002/），不改动任何既有测试文件。
 *
 * 命名：AC-* = 正向验收；BA-* = 边界攻击；REG-* = 缺陷复现（真实发现的缺陷，修复后应转绿）
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssTokens, canvas as canvasTokens, palette } from '../../src/theme/tokens';

const P = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const css = readFileSync(P('../../src/theme/tokens.css'), 'utf8');
const appCss = readFileSync(P('../../src/styles/app.css'), 'utf8');

/** 与守护测试同构的解析器（独立重写，用于交叉验证）。 */
function parseCssTokens(src: string): Record<string, string> {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m = re.exec(noComments);
  while (m !== null) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
    m = re.exec(noComments);
  }
  return out;
}
const cssValues = parseCssTokens(css);
const tsValues: Record<string, string> = Object.fromEntries(
  Object.entries(cssTokens).map(([k, v]) => [k, v.replace(/\s+/g, ' ').trim()]),
);

const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** 两种进位约定：half-up（JS Math.round / 常规四舍五入）与 banker's（Python round 的平局取偶）。 */
const roundHalfUp = (v: number) => Math.floor(v + 0.5);
const roundBankers = (v: number) => {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};
const lerp = (a: string, b: string, t: number, mode: 'half-up' | 'bankers' = 'half-up') =>
  '#' +
  hx(a)
    .map((x, i) => {
      const v = x + (hx(b)[i] - x) * t;
      return (mode === 'half-up' ? roundHalfUp(v) : roundBankers(v)).toString(16).padStart(2, '0');
    })
    .join('');
function luminance(h: string) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hx(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ─────────────────────────────────────────────────────────────
// 门禁加固（终验·由 team-lead 裁定 tester 负责）
// 原问题：`includes('!important')` / `includes('outline: none')` 是字面量子串检查，
// 两端都漏 —— ① 注释里出现即误报（comment false-positive）；
// ② 空格/大小写/等价写法全部逃逸（`! important`、`outline:none`、`outline:0`、
// `outline-width:0`、`outline-color:transparent`、跨行）。
// 加固：先剥注释，再用规范化正则；outline 用「语义化归零」判定。
// ─────────────────────────────────────────────────────────────
/** 剥除 CSS 块注释与行注释（行注释避开 `https://` 这类协议前缀）。 */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** 规范化「强制优先级」声明：`!important` / `! important` / `!IMPORTANT` 均命中。 */
function findForcedImportant(src: string): string[] {
  return src.match(/!\s*important/gi) ?? [];
}
/** 语义化「焦点环归零」：任何把 outline 抹掉的等价写法。 */
function findOutlineZeroing(src: string): string[] {
  return src.match(/outline(?:-(?:width|color|style))?\s*:\s*(?:none|0(?:px)?|transparent)\b/gi) ?? [];
}
/** 取某个类规则块（简单花括号配对，够用）。 */
function ruleBlock(src: string, selector: string): { body: string; start: number; end: number } | null {
  const i = src.indexOf(selector + ' {');
  if (i < 0) return null;
  let d = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return { body: src.slice(i, j), start: i, end: j }; }
  }
  return null;
}
/** 裸 px 间距（含负值）→ 位置列表，供"sr-only 惯用写法"白名单精确放行。 */
function findBarePxSpacing(src: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const re = /(margin|padding|gap)[a-z-]*\s*:\s*-?[0-9]+px/g;
  let m = re.exec(src);
  while (m !== null) { out.push({ at: m.index, text: m[0] }); m = re.exec(src); }
  return out;
}

// ─────────────────────────────────────────────────────────────
describe('AC-2 / 守护测试本身：放宽后是否仍然有效', () => {
  it('AC-2a 真实 tokens.css 仍能解析出 >80 个令牌，且主色为 6 位 hex', () => {
    expect(Object.keys(cssValues).length).toBeGreaterThan(80);
    expect(cssValues['md-sys-color-primary']).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('AC-2b 放宽后的断言仍能捕获「解析器失效」（undefined 不可通过）', () => {
    // 若 CSS 解析不出该键，取值是 undefined —— 放宽后的 toMatch 必须仍然失败。
    expect(() => expect(cssValues['md-sys-color-does-not-exist']).toMatch(/^#[0-9a-fA-F]{6}$/)).toThrow();
    expect(() => expect(undefined).toMatch(/^#[0-9a-fA-F]{6}$/)).toThrow();
    // 解析不到的源（解析器彻底失效）连第一条 >80 也过不去
    expect(Object.keys(parseCssTokens('/* nothing */')).length).toBe(0);
    // 非法取值（非 hex）也必须失败
    expect(() => expect('#zzzzzz').toMatch(/^#[0-9a-fA-F]{6}$/)).toThrow();
  });

  it('AC-2c 键集合双向一致（独立解析器交叉验证）', () => {
    expect(Object.keys(tsValues).filter((k) => !(k in cssValues))).toEqual([]);
    expect(Object.keys(cssValues).filter((k) => !(k in tsValues))).toEqual([]);
  });

  it('AC-2d 同名令牌取值逐字一致（独立解析器交叉验证）', () => {
    const drift = Object.keys(cssValues)
      .filter((k) => k in tsValues && cssValues[k] !== tsValues[k])
      .map((k) => `${k}: css=${cssValues[k]} ts=${tsValues[k]}`);
    expect(drift).toEqual([]);
  });
});

describe('AC-3 / 派生色与 Canvas 令牌', () => {
  it('AC-3a 新增派生令牌 --td-canvas-path-shadow 精确等于 lerp(IRON0, GOLD, 0.10)', () => {
    expect(cssValues['td-canvas-path-shadow']).toBe('#1e1912');
    expect(lerp('#09090b', '#dca54d', 0.1)).toBe('#1e1912'); // 两侧独立复算一致
    expect(palette.canvasPathShadow).toBe('#1e1912');
  });

  it('AC-3b enemy_fast：lerp(OK,INFO,0.50) 的半进位结果等于代码取值（b 通道恰为 156.5）', () => {
    const b = 0x3a + (0xff - 0x3a) * 0.5;
    expect(b).toBe(156.5); // 恰好是 .5 平局 → 进位约定决定结果
    expect(lerp('#87d03a', '#67c6ff', 0.5, 'half-up')).toBe('#77cb9d'); // = ADD 取值 = 代码取值
    expect(lerp('#87d03a', '#67c6ff', 0.5, 'bankers')).toBe('#77cb9c'); // Python banker's
    expect(cssValues['td-enemy-fast']).toBe('#77cb9d');
  });

  it('BA-numeric_edge 所有 canvas 比例令牌都是合法有限数（无 NaN/Inf）', () => {
    for (const [k, v] of Object.entries(canvasTokens)) {
      expect(Number.isFinite(v), `${k} 必须是有限数`).toBe(true);
    }
    expect(canvasTokens.healthBarOffsetRatio).toBeLessThan(0); // 负值边界
  });

  it('AC-3c 全部新增 canvas 令牌都被 render/** 真实消费（无孤儿令牌）', () => {
    const renderSrc =
      readFileSync(P('../../src/render/sprites/index.ts'), 'utf8') +
      readFileSync(P('../../src/render/layers/staticLayer.ts'), 'utf8');
    const NEW_14 = [
      'pathShoulderRatio', 'towerGlowRatio', 'towerGlowAlpha', 'towerPlateInsetRatio',
      'towerPlateInsetWidth', 'towerPlateHighlightAlpha', 'towerPlateShadowAlpha',
      'enemyHighlightAlpha', 'enemyHighlightOffsetRatio', 'enemyHighlightRadiusRatio',
      'projectileGlowRatio', 'projectileGlowAlpha', 'endpointGlowRatio', 'endpointGlowAlpha',
    ];
    const orphans = NEW_14.filter((k) => !renderSrc.includes(`geo.${k}`));
    expect(orphans).toEqual([]);
    expect(renderSrc).toContain('palette.canvasPathShadow');
  });
});

describe('Adoption conformance · theme_ref = dark-tech/luxury', () => {
  // luxury.css 的 OKLCH 语义令牌 → sRGB hex（独立换算，由 tester 复算）
  const LUXURY: Record<string, string> = {
    'md-sys-color-surface': '#09090b',          // base-100
    'md-sys-color-surface-container-low': '#171618', // base-200
    'md-sys-color-surface-container-high': '#1e1d1f', // base-300
    'md-sys-color-primary': '#dca54d',          // base-content
    'md-sys-color-on-primary-container': '#ffe7a4', // neutral-content
    'md-sys-color-primary-container': '#331800',    // neutral
    'md-sys-color-secondary-container': '#152747',  // secondary
    'md-sys-color-secondary': '#cbd0d7',        // secondary-content
    'md-sys-color-focus-ring': '#67c6ff',       // info
    'md-sys-color-success': '#87d03a',          // success
    'md-sys-color-error': '#ff6f6f',            // error
    'td-hp-mid': '#e2d563',                     // warning
  };
  it('AC-adopt 每个核心令牌都可溯源到 luxury.css 的语义令牌取值', () => {
    const missing = Object.entries(LUXURY).filter(([k, v]) => cssValues[k] !== v).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(cssValues['td-canvas-bg']).toBe(LUXURY['md-sys-color-surface']); // Canvas 侧同源
  });
});

describe('AC-1 · 颜色单源', () => {
  it('AC-1a tokens.css 之外的项目源码无 hex / rgb / hsl 字面量', () => {
    const files = [
      '../../src/styles/app.css',
      '../../src/ui/Hud.tsx',
      '../../src/ui/BuildPanel.tsx',
      '../../src/ui/WaveControls.tsx',
      '../../src/ui/ErrorView.tsx',
      '../../src/ui/primitives/Modal.tsx',
      '../../src/ui/icons/index.tsx',
      '../../src/render/sprites/index.ts',
      '../../src/render/layers/staticLayer.ts',
      '../../index.html',
    ];
    const hits: string[] = [];
    const re = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/g;
    for (const f of files) {
      const src = readFileSync(P(f), 'utf8');
      for (const m of src.match(re) ?? []) hits.push(`${f}: ${m}`);
    }
    expect(hits).toEqual([]);
  });

  /**
   * AC-1b（终验加固版）：魔法数间距 + 强制优先级 + 焦点环归零。
   * 加固点：先剥注释再匹配；`!important` 用规范化正则；outline 用语义化等价判定。
   */
  const appCssStripped = stripCssComments(appCss);
  it('AC-1b app.css 无魔法数间距、无强制优先级、无焦点环归零（剥注释后语义化判定）', () => {
    // 间距：裸 px（含负值），仅放行 .td-sr-only 的无障碍惯用写法 margin:-1px
    const srOnly = ruleBlock(appCssStripped, '.td-sr-only');
    const spacing = findBarePxSpacing(appCssStripped).filter((h) => {
      const inSrOnly = srOnly !== null && h.at >= srOnly.start && h.at <= srOnly.end && h.text === 'margin: -1px';
      return !inSrOnly;
    });
    expect(spacing.map((h) => h.text), '剥注释后的裸 px 间距').toEqual([]);

    // 强制优先级：剥注释后不得出现（注释里的说明不算）
    expect(findForcedImportant(appCssStripped), '剥注释后的 !important（规范化，忽略空格/大小写）').toEqual([]);
    // 语义化：任何把焦点环归零的等价写法都算违规
    expect(findOutlineZeroing(appCssStripped), '把 outline 归零的任何等价写法').toEqual([]);
    // 同时确认真实文件里确实还有一层"注释屏蔽"在起作用（证明剥注释这一步是必要的、非装饰性的）
    expect(findForcedImportant(appCss), '原始文件（含注释）里的 !important 也应为 0').toEqual([]);
  });

  /**
   * AC-1c（门禁自证伪）：加固后的探测器必须①对全部变体敏感 ②不被注释误报 ③不误伤合法 outline。
   * 没有这条，"加固"就只是换了个写法、无法证明它更强。
   */
  it('AC-1c 门禁自证伪：变体全部命中、注释不误报、合法 outline 不误伤', () => {
    // ① 敏感：全部等价/变体写法都必须被抓到
    const mustCatch = [
      'a{color:red!important}',
      'a{color:red !important}',
      'a{color:red !  important}',
      'a{color:red !IMPORTANT}',
      'a{color:red !Important}',
    ];
    for (const css of mustCatch) expect(findForcedImportant(css), `应命中: ${css}`).not.toEqual([]);

    const outlineMustCatch = [
      'a{outline:none}',
      'a{outline: none}',
      'a{outline : none}',
      'a{outline:  none}',
      'a{outline:0}',
      'a{outline: 0px}',
      'a{outline-width:0}',
      'a{outline-width: 0px}',
      'a{outline-color:transparent}',
      'a{outline-style:none}',
      'a{outline:\n    none}',
      'a{outline: NONE}',
    ];
    for (const css of outlineMustCatch) expect(findOutlineZeroing(css), `应命中: ${css}`).not.toEqual([]);

    // ② 不误报：注释里的字面量必须被剥掉（正是上一轮如实存在的脆弱点）
    const withComment = '/* 不得用 outline:none 抹掉焦点 */ a { outline: 2px solid red; }';
    expect(findOutlineZeroing(stripCssComments(withComment))).toEqual([]);
    expect(findOutlineZeroing(withComment), '不剥注释时会误报 —— 这条断言证明"剥注释"这一步是有效的').not.toEqual([]);
    const withImportantComment = '/* 不要用 !important */ a { color: red; }';
    expect(findForcedImportant(stripCssComments(withImportantComment))).toEqual([]);
    expect(findForcedImportant(withImportantComment)).not.toEqual([]);

    // ③ 不误伤：合法的焦点环写法（含 0 偏移值）不得被判违规
    const legit = [
      'a{outline: 2px solid var(--md-sys-color-focus-ring)}',
      'a{outline: var(--border-width-strong) solid var(--md-sys-color-focus-ring)}',
      'a{outline-offset: var(--border-width-strong)}',
      'a{outline-offset: 0}',
      'a{border: 1px solid none}',
    ];
    for (const css of legit) expect(findOutlineZeroing(css), `不应命中: ${css}`).toEqual([]);

    // ④ 真实文件回归：焦点环规则必须仍然存在且未被归零
    expect(appCssStripped).toContain('outline: var(--border-width-strong) solid var(--md-sys-color-focus-ring)');
    expect(findOutlineZeroing(appCssStripped)).toEqual([]);
  });
});

describe('AC-9 · 字体本地化 / 零运行时外链', () => {
  /** 与 app.css 的 @font-face 声明对应的字重集合（复测：600 死资产已被 team-lead 裁定删除）。 */
  const EXPECTED_WEIGHTS = ['400', '500', '700'];
  it('AC-9a 恰好 3 个 woff2（400/500/700）+ OFL 均存在且非空，且无 600 残留', () => {
    for (const w of EXPECTED_WEIGHTS) {
      const p = P(`../../public/fonts/rajdhani-latin-${w}-normal.woff2`);
      expect(existsSync(p), p).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(5000);
    }
    // 600 为死资产，删除后不得复活（否则重新引入"声明了却不下载"的坑）
    expect(existsSync(P('../../public/fonts/rajdhani-latin-600-normal.woff2'))).toBe(false);
    expect(statSync(P('../../public/fonts/OFL.txt')).size).toBeGreaterThan(1000);
  });

  it('AC-9b @font-face 的 src 恰好 3 条（与 AC-9a 的 3 个产物数量一致），全指向同源本地字体', () => {
    const srcs = [...appCss.matchAll(/src:\s*url\(([^)]+)\)/g)].map((m) => m[1]);
    expect(srcs.length).toBe(EXPECTED_WEIGHTS.length); // 声明数 == 产物数，防"多声明/少产物"漂移
    expect(srcs.every((s) => /^'?\/fonts\/rajdhani-latin-\d+-normal\.woff2'?$/.test(s))).toBe(true);
    // 断言声明的字重集合与磁盘产物集合逐个对应（比"计数相等"更强）
    const declared = srcs.map((s) => s.match(/-(\d+)-normal/)?.[1]).sort();
    expect(declared).toEqual([...EXPECTED_WEIGHTS].sort());
    expect(appCss.includes('600-normal.woff2')).toBe(false);
    expect(/https?:\/\//.test(appCss)).toBe(false);
  });

  it('AC-9c 中文字体栈显式声明（不得让中文掉到裸默认）', () => {
    const stack = cssValues['font-family-display'];
    for (const zh of ["'PingFang SC'", "'Microsoft YaHei'", "'Noto Sans SC'", "'SimHei'"]) {
      expect(stack).toContain(zh);
    }
    expect(stack.endsWith('sans-serif')).toBe(true); // 不落到 serif
    expect(stack).not.toContain('Roboto'); // fonts/pairings.json 的 forbidden
  });
});

describe('AC-7 · 对比度', () => {
  const t = (k: string) => cssValues[k];
  it('AC-7a 正文 / 次要文本 / 按钮文字 ≥ 4.5:1', () => {
    expect(contrast(t('md-sys-color-on-surface'), t('md-sys-color-surface-container-low'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t('md-sys-color-on-surface-variant'), t('md-sys-color-surface-container-low'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t('md-sys-color-on-primary'), t('md-sys-color-primary'))).toBeGreaterThanOrEqual(4.5);
  });

  it('AC-7b 图标 / 焦点环 / 游戏图形 ≥ 3:1', () => {
    expect(contrast(t('md-sys-color-focus-ring'), t('md-sys-color-surface-container-low'))).toBeGreaterThanOrEqual(3);
    for (const k of ['td-tower-arrow', 'td-tower-cannon', 'td-tower-frost', 'td-enemy-fast', 'td-enemy-heavy', 'td-enemy-normal']) {
      expect(contrast(t(k), t('td-canvas-bg')), k).toBeGreaterThanOrEqual(3);
    }
  });

  // ↓ 真实发现的缺陷复现（Developer 未自报）；修复后本用例应转绿
  it('REG-AC7 组件边界（--md-sys-color-outline）相对背景必须 ≥ 3:1', () => {
    const r = contrast(t('md-sys-color-outline'), t('md-sys-color-surface-container-low'));
    // 面板 / 塔卡 / outlined 按钮的边框色就是 outline
    expect(r, `outline 对 surface-container-low 实测 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

describe('AC-10 · prefers-reduced-motion', () => {
  /** 取出 @media (prefers-reduced-motion: reduce) 块的内容（花括号配对）。 */
  function reduceBlock(src: string): string {
    const i = src.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(i).toBeGreaterThan(-1);
    let depth = 0;
    let start = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') {
        depth++;
        if (depth === 1) start = j + 1;
      } else if (src[j] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j);
      }
    }
    return '';
  }
  /** 粗略特异性：id*100 + 类/属性/伪类*10 + 元素*1。 */
  const spec = (sel: string) => {
    const ids = (sel.match(/#[\w-]+/g) ?? []).length;
    const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
    const el = (sel.match(/(^|[\s>+~])[a-z][\w-]*|::[\w-]+/g) ?? []).length;
    return ids * 100 + cls * 10 + el;
  };
  const maxSpec = (block: string) =>
    Math.max(0, ...block.split('}').map((r) => r.split('{')[0]).flatMap((s) => s.split(',')).map((s) => spec(s.trim())).filter((s) => s > 0 || s === 0));

  it('AC-10a reduce 块存在且把动画/过渡压到约一帧', () => {
    const b = reduceBlock(appCss);
    expect(b).toMatch(/animation-duration:\s*1ms/);
    expect(b).toMatch(/transition-duration:\s*1ms/);
    expect(b).toMatch(/animation-iteration-count:\s*1/);
  });

  it('AC-10b reduce 规则必须含与动画元素同级的类选择器，否则会被 shorthand 特异性击穿', () => {
    // 本样式表中所有动画/过渡都由**类选择器**（.td-spinner / .td-btn / …）声明，
    // 因此 reduce 块若只写 `*`（特异性 0）就必然被击穿 —— 这正是浏览器实测到的现象。
    const b = reduceBlock(appCss);
    expect(maxSpec(b), `reduce 块最高特异性 ${maxSpec(b)}，而动画元素为 10（类级）`).toBeGreaterThanOrEqual(10);
  });

  // ↓ 真实发现的缺陷复现：浏览器实测 spinner 在 reduce 下仍 0.9s/infinite
  it('REG-AC10 reduce 下不得存在持续循环动效（.td-spinner）', () => {
    const b = reduceBlock(appCss);
    const covered = /\.td-spinner|\.td-btn__spinner/.test(b);
    // 若未按类覆盖，则 `.td-spinner{animation:td-spin 900ms … infinite}` 仍然生效
    expect(covered, '.td-spinner 的 animation shorthand 未被 reduce 块按类覆盖 → 900ms/infinite 循环动效依旧').toBe(true);
  });

  // ── 复测新增：独立枚举「全仓库」动效清单，逐类核对 reduce 覆盖（防"漏一个类"） ──
  /** 注释剥除（关键：字面量检查会被注释污染，此处先剥注释再解析）。 */
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  /**
   * 深度配对扫描，取回所有「声明了 animation/transition」的规则头（跳过注释 / @keyframes / reduce 块自身）。
   * 这是对 `grep -nE 'animation:|transition:'` 的加强版：grep 只能拿到"行"，
   * 拿不到选择器 —— 而缺陷恰恰出在「一条声明挂了两个类，只覆盖了其中一个」。
   */
  function animatedRuleHeads(src: string): string[] {
    const s = strip(src);
    const out: string[] = [];
    let depth = 0;
    let head = '';
    let buf = '';
    let skip = false;
    let curHead = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '{') {
        depth++;
        if (depth === 1) {
          head = curHead.trim();
          curHead = '';
          buf = '';
          if (/@keyframes/.test(head) || /prefers-reduced-motion/.test(head)) skip = true;
        }
        continue;
      }
      if (c === '}') {
        if (depth === 1 && !skip && /(^|[^a-z-])(animation|transition)[a-z-]*\s*:/.test(buf)) {
          out.push(head);
        }
        depth--;
        if (skip && depth === 0) skip = false;
        buf = '';
        continue;
      }
      if (depth === 0) curHead += c;
      else if (depth === 1 && !skip) buf += c;
    }
    return out;
  }
  const classOf = (sel: string) => [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);

  it('AC-10c reduce 块必须覆盖 app.css 中【每一个】带动效声明的类（漏一个类就有一层击穿）', () => {
    const heads = animatedRuleHeads(appCss);
    // 先证明扫描器真的扫到了东西（否则"空 == 通过"是假绿）
    expect(heads.length).toBeGreaterThanOrEqual(6);
    const b = reduceBlock(strip(appCss));
    const uncovered = [...new Set(heads.flatMap(classOf))].filter((c) => !b.includes(c));
    expect(uncovered, `以下类声明了动效但未被 reduce 块覆盖：${uncovered.join(', ')}`).toEqual([]);
  });

  it('AC-10d 反向回归：降级是"条件式"的——reduce 块之外 .td-spinner / .td-btn__spinner 仍须声明 900ms 循环', () => {
    // reduce 关闭时动效必须恢复；若把动画声明本身删掉，这条会红，说明"降级"退化成"永久关闭"。
    const outside = strip(appCss).replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, '');
    expect(/\.td-btn__spinner\s*,\s*\.td-spinner\s*\{[^}]*animation:\s*td-spin\s+900ms\s+linear\s+infinite/.test(outside)).toBe(true);
    expect(outside).toContain('@keyframes td-spin');
  });
});

describe('AC-11 · 品牌收敛', () => {
  it('AC-11a index.html 与 Hud.tsx 使用新名，且源码内检索不到旧名', () => {
    const html = readFileSync(P('../../index.html'), 'utf8');
    const hud = readFileSync(P('../../src/ui/Hud.tsx'), 'utf8');
    expect(html).toContain('淬火壁垒');
    expect(html).toContain('Tempered Bastion');
    expect(hud).toContain('淬火壁垒');
    for (const f of ['../../index.html', '../../src/ui/Hud.tsx', '../../src/ui/labels.ts', '../../src/App.tsx']) {
      expect(readFileSync(P(f), 'utf8').includes('淬炼塔防'), f).toBe(false);
    }
  });
});
