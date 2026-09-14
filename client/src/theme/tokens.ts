/**
 * 设计令牌 · Canvas 侧 TS 镜像
 * ------------------------------------------------------------------
 * Canvas 2D 无法读取 CSS 自定义属性，因此需要一份 TS 常量镜像。
 * 两份令牌由 `theme/__tests__/tokens.sync.test.ts` 守护：键集合与取值必须逐字一致，
 * 任何一处漂移都会让测试失败。
 *
 * 本文件与 tokens.css 是**唯二**允许出现颜色/尺寸字面量的文件。
 */

/** M3 颜色角色（深色）。 */
export const color = {
  primary: '#8ad5ff',
  onPrimary: '#00344a',
  primaryContainer: '#004d68',
  onPrimaryContainer: '#c7e7ff',
  secondary: '#b3cad9',
  onSecondary: '#1d333f',
  secondaryContainer: '#344a56',
  onSecondaryContainer: '#cfe6f6',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',
  success: '#86e0a3',
  onSuccess: '#00391b',
  successContainer: '#00522a',
  onSuccessContainer: '#a2f8bd',
  surface: '#0f1417',
  surfaceContainerLowest: '#0a0e11',
  surfaceContainerLow: '#171c1f',
  surfaceContainer: '#1b2124',
  surfaceContainerHigh: '#262c2f',
  surfaceContainerHighest: '#31373a',
  onSurface: '#dee3e6',
  onSurfaceVariant: '#bfc8cc',
  outline: '#899296',
  outlineVariant: '#3f484b',
  inverseSurface: '#dee3e6',
  onInverseSurface: '#2b3134',
  scrim: '#000000',
  focusRing: '#ffd8a8',
} as const;

/** 战场专用颜色（Canvas 与 DOM 覆盖层共用同一批值）。 */
export const palette = {
  canvasBg: '#0a0e11',
  canvasGrid: '#1b2124',
  canvasGridMajor: '#262c2f',
  canvasPath: '#3a4145',
  canvasPathEdge: '#565f64',
  canvasSpawn: '#ffb4ab',
  canvasBase: '#86e0a3',
  towerArrow: '#8ad5ff',
  towerCannon: '#ffcf8a',
  towerFrost: '#a8e6ff',
  towerBarrel: '#dee3e6',
  enemyNormal: '#d98be0',
  enemyNormalEdge: '#8e4b96',
  enemyFast: '#8ae6a1',
  enemyFastEdge: '#2f7f47',
  enemyHeavy: '#e0a58a',
  enemyHeavyEdge: '#8a4f36',
  enemySlowRing: '#a8e6ff',
  hpHigh: '#86e0a3',
  hpMid: '#ffcf8a',
  hpLow: '#ffb4ab',
  projectile: '#f2f6f8',
  projectileSplash: '#ffcf8a',
  effectHit: '#f2f6f8',
  effectSplash: '#ffb07a',
  hoverLegal: '#86e0a3',
  hoverIllegal: '#ffb4ab',
  rangeRing: '#8ad5ff',
  selectionRing: '#ffd8a8',
} as const;

/** M3 字阶（字号）。 */
export const typescale = {
  titleLarge: '20px',
  titleMedium: '16px',
  bodyLarge: '15px',
  bodyMedium: '14px',
  labelLarge: '14px',
  labelMedium: '12px',
  labelSmall: '11px',
  lineHeight: '1.6',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  bold: 700,
} as const;

export const fontFamily =
  "-apple-system, 'Segoe UI', Roboto, 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

export const space = {
  s1: '4px',
  s2: '8px',
  s3: '12px',
  s4: '16px',
  s5: '20px',
  s6: '24px',
  s8: '32px',
} as const;

export const radius = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '20px',
  full: '999px',
} as const;

export const border = {
  width: '1px',
  widthStrong: '2px',
} as const;

export const elevation = {
  level1: '0 1px 2px rgba(0, 0, 0, 0.45)',
  level2: '0 4px 14px rgba(0, 0, 0, 0.55)',
} as const;

export const motion = {
  durFast: '120ms',
  durBase: '200ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/**
 * Canvas 几何比例：全部相对 `grid.tileSizePx`，无量纲。
 * 渲染层只允许使用这些比例 + 配置里的 tileSizePx，不得出现裸数值。
 */
export const canvas = {
  enemyRadiusRatio: 0.3,
  enemyHeavyRadiusRatio: 0.36,
  enemyEdgeWidth: 2,
  towerBaseRatio: 0.78,
  towerTurretRatio: 0.34,
  towerMuzzleRatio: 0.22,
  towerCornerRatio: 0.14,
  towerBaseFillAlpha: 0.22,
  hpTrackAlpha: 0.35,
  ringAlpha: 0.55,
  healthBarWidthRatio: 0.8,
  healthBarHeightRatio: 0.12,
  healthBarOffsetRatio: -0.42,
  healthLowThreshold: 0.35,
  healthMidThreshold: 0.65,
  projectileRadiusRatio: 0.09,
  projectileSplashRatio: 0.13,
  slowRingRatio: 0.46,
  slowSpikeCount: 4,
  selectionRingRatio: 0.54,
  rangeRingWidth: 2,
  rangeFillAlpha: 0.12,
  gridLineWidth: 1,
  gridMajorEvery: 2,
  pathWidthRatio: 0.8,
  pathCoreRatio: 0.62,
  endpointRingRatio: 0.34,
  hoverFillAlpha: 0.3,
  hoverStrokeWidth: 2,
  effectMinRadiusRatio: 0.12,
  effectMaxRadiusRatio: 1.05,
  effectLifeMs: 380,
  effectPoolLimit: 64,
  spawnMarkerRatio: 0.4,
  baseMarkerRatio: 0.44,
  spanMarkerRatio: 0.3,
} as const;

/**
 * 扁平令牌表：键 = CSS 自定义属性名去掉 `--`，值 = 字符串化的取值。
 * 一致性测试逐键比对 tokens.css。
 */
export const cssTokens: Readonly<Record<string, string>> = {
  'md-sys-color-primary': color.primary,
  'md-sys-color-on-primary': color.onPrimary,
  'md-sys-color-primary-container': color.primaryContainer,
  'md-sys-color-on-primary-container': color.onPrimaryContainer,
  'md-sys-color-secondary': color.secondary,
  'md-sys-color-on-secondary': color.onSecondary,
  'md-sys-color-secondary-container': color.secondaryContainer,
  'md-sys-color-on-secondary-container': color.onSecondaryContainer,
  'md-sys-color-error': color.error,
  'md-sys-color-on-error': color.onError,
  'md-sys-color-error-container': color.errorContainer,
  'md-sys-color-on-error-container': color.onErrorContainer,
  'md-sys-color-success': color.success,
  'md-sys-color-on-success': color.onSuccess,
  'md-sys-color-success-container': color.successContainer,
  'md-sys-color-on-success-container': color.onSuccessContainer,
  'md-sys-color-surface': color.surface,
  'md-sys-color-surface-container-lowest': color.surfaceContainerLowest,
  'md-sys-color-surface-container-low': color.surfaceContainerLow,
  'md-sys-color-surface-container': color.surfaceContainer,
  'md-sys-color-surface-container-high': color.surfaceContainerHigh,
  'md-sys-color-surface-container-highest': color.surfaceContainerHighest,
  'md-sys-color-on-surface': color.onSurface,
  'md-sys-color-on-surface-variant': color.onSurfaceVariant,
  'md-sys-color-outline': color.outline,
  'md-sys-color-outline-variant': color.outlineVariant,
  'md-sys-color-inverse-surface': color.inverseSurface,
  'md-sys-color-on-inverse-surface': color.onInverseSurface,
  'md-sys-color-scrim': color.scrim,
  'md-sys-color-focus-ring': color.focusRing,

  'td-canvas-bg': palette.canvasBg,
  'td-canvas-grid': palette.canvasGrid,
  'td-canvas-grid-major': palette.canvasGridMajor,
  'td-canvas-path': palette.canvasPath,
  'td-canvas-path-edge': palette.canvasPathEdge,
  'td-canvas-spawn': palette.canvasSpawn,
  'td-canvas-base': palette.canvasBase,
  'td-tower-arrow': palette.towerArrow,
  'td-tower-cannon': palette.towerCannon,
  'td-tower-frost': palette.towerFrost,
  'td-tower-barrel': palette.towerBarrel,
  'td-enemy-normal': palette.enemyNormal,
  'td-enemy-normal-edge': palette.enemyNormalEdge,
  'td-enemy-fast': palette.enemyFast,
  'td-enemy-fast-edge': palette.enemyFastEdge,
  'td-enemy-heavy': palette.enemyHeavy,
  'td-enemy-heavy-edge': palette.enemyHeavyEdge,
  'td-enemy-slow-ring': palette.enemySlowRing,
  'td-hp-high': palette.hpHigh,
  'td-hp-mid': palette.hpMid,
  'td-hp-low': palette.hpLow,
  'td-projectile': palette.projectile,
  'td-projectile-splash': palette.projectileSplash,
  'td-effect-hit': palette.effectHit,
  'td-effect-splash': palette.effectSplash,
  'td-hover-legal': palette.hoverLegal,
  'td-hover-illegal': palette.hoverIllegal,
  'td-range-ring': palette.rangeRing,
  'td-selection-ring': palette.selectionRing,

  'md-sys-typescale-title-large': typescale.titleLarge,
  'md-sys-typescale-title-medium': typescale.titleMedium,
  'md-sys-typescale-body-large': typescale.bodyLarge,
  'md-sys-typescale-body-medium': typescale.bodyMedium,
  'md-sys-typescale-label-large': typescale.labelLarge,
  'md-sys-typescale-label-medium': typescale.labelMedium,
  'md-sys-typescale-label-small': typescale.labelSmall,
  'md-sys-typescale-line-height': typescale.lineHeight,

  'font-weight-regular': String(fontWeight.regular),
  'font-weight-medium': String(fontWeight.medium),
  'font-weight-bold': String(fontWeight.bold),
  'font-family-sans': fontFamily,

  'space-1': space.s1,
  'space-2': space.s2,
  'space-3': space.s3,
  'space-4': space.s4,
  'space-5': space.s5,
  'space-6': space.s6,
  'space-8': space.s8,

  'radius-xs': radius.xs,
  'radius-sm': radius.sm,
  'radius-md': radius.md,
  'radius-lg': radius.lg,
  'radius-full': radius.full,

  'border-width': border.width,
  'border-width-strong': border.widthStrong,
  'elevation-1': elevation.level1,
  'elevation-2': elevation.level2,

  'dur-fast': motion.durFast,
  'dur-base': motion.durBase,
  'ease-standard': motion.easeStandard,

  'canvas-enemy-radius-ratio': String(canvas.enemyRadiusRatio),
  'canvas-enemy-heavy-radius-ratio': String(canvas.enemyHeavyRadiusRatio),
  'canvas-enemy-edge-width': String(canvas.enemyEdgeWidth),
  'canvas-tower-base-ratio': String(canvas.towerBaseRatio),
  'canvas-tower-turret-ratio': String(canvas.towerTurretRatio),
  'canvas-tower-muzzle-ratio': String(canvas.towerMuzzleRatio),
  'canvas-tower-corner-ratio': String(canvas.towerCornerRatio),
  'canvas-tower-base-fill-alpha': String(canvas.towerBaseFillAlpha),
  'canvas-hp-track-alpha': String(canvas.hpTrackAlpha),
  'canvas-ring-alpha': String(canvas.ringAlpha),
  'canvas-health-bar-width-ratio': String(canvas.healthBarWidthRatio),
  'canvas-health-bar-height-ratio': String(canvas.healthBarHeightRatio),
  'canvas-health-bar-offset-ratio': String(canvas.healthBarOffsetRatio),
  'canvas-health-low-threshold': String(canvas.healthLowThreshold),
  'canvas-health-mid-threshold': String(canvas.healthMidThreshold),
  'canvas-projectile-radius-ratio': String(canvas.projectileRadiusRatio),
  'canvas-projectile-splash-ratio': String(canvas.projectileSplashRatio),
  'canvas-slow-ring-ratio': String(canvas.slowRingRatio),
  'canvas-slow-spike-count': String(canvas.slowSpikeCount),
  'canvas-selection-ring-ratio': String(canvas.selectionRingRatio),
  'canvas-range-ring-width': String(canvas.rangeRingWidth),
  'canvas-range-fill-alpha': String(canvas.rangeFillAlpha),
  'canvas-grid-line-width': String(canvas.gridLineWidth),
  'canvas-grid-major-every': String(canvas.gridMajorEvery),
  'canvas-path-width-ratio': String(canvas.pathWidthRatio),
  'canvas-path-core-ratio': String(canvas.pathCoreRatio),
  'canvas-endpoint-ring-ratio': String(canvas.endpointRingRatio),
  'canvas-hover-fill-alpha': String(canvas.hoverFillAlpha),
  'canvas-hover-stroke-width': String(canvas.hoverStrokeWidth),
  'canvas-effect-min-radius-ratio': String(canvas.effectMinRadiusRatio),
  'canvas-effect-max-radius-ratio': String(canvas.effectMaxRadiusRatio),
  'canvas-effect-life-ms': String(canvas.effectLifeMs),
  'canvas-effect-pool-limit': String(canvas.effectPoolLimit),
  'canvas-spawn-marker-ratio': String(canvas.spawnMarkerRatio),
  'canvas-base-marker-ratio': String(canvas.baseMarkerRatio),
  'canvas-span-marker-ratio': String(canvas.spanMarkerRatio),
};

/** 便捷：把令牌取值为 CSS `var(...)` 表达式（供 React 内联样式使用）。 */
export function cssVar(name: string): string {
  return `var(--${name})`;
}
