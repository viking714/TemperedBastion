/**
 * 程序化绘制原语（全部 Canvas 2D，零外部素材 / 零远程图片）。
 *
 * 约束：本目录下的所有数值都必须来自配置（tileSizePx）或设计令牌（theme/tokens.ts），
 * 不允许出现裸数字字面量——由 `no-hardcoded-balance.test.ts` 静态守护。
 */
import { canvas as geo, palette } from '../../theme/tokens';
import type { TowerRole } from '../../core';

export interface EnemyStyle {
  fill: string;
  edge: string;
}

/**
 * 敌人外观：按配置里的 enemyId 取色，未知类型回退到默认配色。
 * 这是**视觉映射**（不是战斗数值），新增敌人类型只会拿到回退色，不会崩。
 */
const ENEMY_STYLES: Readonly<Record<string, EnemyStyle>> = {
  normal: { fill: palette.enemyNormal, edge: palette.enemyNormalEdge },
  fast: { fill: palette.enemyFast, edge: palette.enemyFastEdge },
  heavy: { fill: palette.enemyHeavy, edge: palette.enemyHeavyEdge },
};

const FALLBACK_ENEMY_STYLE: EnemyStyle = { fill: palette.enemyNormal, edge: palette.enemyNormalEdge };

export function enemyStyle(enemyId: string): EnemyStyle {
  return ENEMY_STYLES[enemyId] ?? FALLBACK_ENEMY_STYLE;
}

/** 敌人体型：重装更胖（由令牌给出比例）。 */
export function enemyRadius(enemyId: string, tile: number): number {
  return tile * (enemyId === 'heavy' ? geo.enemyHeavyRadiusRatio : geo.enemyRadiusRatio);
}

/** 塔外观：按配置里的 role 取色。 */
const TOWER_STYLES: Readonly<Record<TowerRole, string>> = {
  single_target: palette.towerArrow,
  splash: palette.towerCannon,
  slow: palette.towerFrost,
};

export function towerColor(role: TowerRole): string {
  return TOWER_STYLES[role] ?? palette.towerArrow;
}

/** 圆角矩形路径（不依赖 roundRect，兼容性更好）。 */
export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cornerRadius: number,
): void {
  const radius = Math.min(cornerRadius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

/** 血条配色（按剩余比例取色，不只依赖颜色传达信息——血条长度同时表达）。 */
export function healthColor(ratio: number): string {
  if (ratio <= geo.healthLowThreshold) return palette.hpLow;
  if (ratio <= geo.healthMidThreshold) return palette.hpMid;
  return palette.hpHigh;
}

/** 塔：底座（圆角方）+ 炮塔（圆）+ 枪口（圆）+ 等级指示点。 */
export function drawTower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  role: TowerRole,
  level: number,
): void {
  const color = towerColor(role);
  const half = (tile * geo.towerBaseRatio) * 0.5;

  ctx.save();
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.globalAlpha = geo.towerBaseFillAlpha;
  ctx.fillStyle = color;
  roundedRect(ctx, x - half, y - half, half * 2, half * 2, tile * geo.towerCornerRatio);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  roundedRect(ctx, x - half, y - half, half * 2, half * 2, tile * geo.towerCornerRatio);
  ctx.stroke();

  // 炮塔
  const turretRadius = tile * geo.towerTurretRatio;
  circle(ctx, x, y, turretRadius);
  ctx.fillStyle = palette.canvasBg;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();

  // 枪口（朝上，纯装饰，表达"可开火"）
  const muzzle = tile * geo.towerMuzzleRatio;
  circle(ctx, x, y - muzzle, tile * geo.projectileRadiusRatio);
  ctx.fillStyle = palette.towerBarrel;
  ctx.fill();

  // 等级指示：level 个小点（形状 + 数量，不只靠颜色）
  const pipRadius = tile * geo.projectileRadiusRatio;
  const gap = pipRadius * 2;
  const startX = x - (gap * (level - 1)) * 0.5;
  const pipY = y + half - pipRadius;
  ctx.fillStyle = palette.towerBarrel;
  for (let index = 0; index < level; index++) {
    circle(ctx, startX + gap * index, pipY, pipRadius);
    ctx.fill();
  }
  ctx.restore();
}

/** 敌人：身体 + 描边 + 血条 +（被减速时的）冰环标记。 */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  enemyId: string,
  healthRatio: number,
  slowed: boolean,
): void {
  const style = enemyStyle(enemyId);
  const radius = enemyRadius(enemyId, tile);

  ctx.save();

  if (slowed) {
    // 减速标识：冰环 + 四个方向的冰刺（形状信息，不只靠颜色）
    ctx.globalAlpha = geo.ringAlpha;
    ctx.strokeStyle = palette.enemySlowRing;
    ctx.lineWidth = geo.enemyEdgeWidth;
    circle(ctx, x, y, tile * geo.slowRingRatio);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.enemySlowRing;
    ctx.lineWidth = geo.rangeRingWidth;
    for (let index = 0; index < geo.slowSpikeCount; index++) {
      const angle = Math.PI * 0.5 * index;
      const inner = tile * geo.slowRingRatio;
      const outer = inner + tile * geo.projectileRadiusRatio;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  circle(ctx, x, y, radius);
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.lineWidth = geo.enemyEdgeWidth;
  ctx.strokeStyle = style.edge;
  ctx.stroke();

  // 血条
  const barWidth = tile * geo.healthBarWidthRatio;
  const barHeight = tile * geo.healthBarHeightRatio;
  const barX = x - barWidth * 0.5;
  const barY = y + tile * geo.healthBarOffsetRatio;
  const clamped = Math.max(0, Math.min(1, healthRatio));

  ctx.globalAlpha = geo.hpTrackAlpha;
  ctx.fillStyle = palette.canvasBg;
  ctx.fillRect(barX, barY, barWidth, barHeight);

  ctx.globalAlpha = 1;
  ctx.fillStyle = healthColor(clamped);
  ctx.fillRect(barX, barY, barWidth * clamped, barHeight);

  ctx.restore();
}

/** 子弹：圆形；溅射弹略大并带描边以便区分。 */
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  isSplash: boolean,
): void {
  const radius = tile * (isSplash ? geo.projectileSplashRatio : geo.projectileRadiusRatio);
  ctx.save();
  circle(ctx, x, y, radius);
  ctx.fillStyle = isSplash ? palette.projectileSplash : palette.projectile;
  ctx.fill();
  if (isSplash) {
    ctx.lineWidth = geo.enemyEdgeWidth;
    ctx.strokeStyle = palette.effectSplash;
    ctx.stroke();
  }
  ctx.restore();
}

/** 出生点 / 基地标记（圆环 + 内部符号；符号形状承担语义，不只靠颜色）。 */
export function drawEndpointMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  kind: 'spawn' | 'base',
): void {
  const color = kind === 'spawn' ? palette.canvasSpawn : palette.canvasBase;
  const radius = tile * geo.endpointRingRatio;

  ctx.save();
  ctx.globalAlpha = geo.ringAlpha;
  ctx.fillStyle = color;
  circle(ctx, x, y, radius);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.strokeStyle = color;
  circle(ctx, x, y, radius);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = geo.enemyEdgeWidth;
  const inner = radius * 0.5;
  if (kind === 'spawn') {
    // 出生点：向外的箭头（敌人在此涌入）
    ctx.beginPath();
    ctx.moveTo(x - inner, y);
    ctx.lineTo(x + inner, y);
    ctx.moveTo(x, y - inner);
    ctx.lineTo(x, y + inner);
    ctx.stroke();
  } else {
    // 基地：实心方块（要守住的目标）
    ctx.fillStyle = color;
    ctx.fillRect(x - inner * 0.5, y - inner * 0.5, inner, inner);
  }
  ctx.restore();
}
