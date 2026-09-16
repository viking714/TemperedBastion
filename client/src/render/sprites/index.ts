/**
 * 程序化绘制原语（全部 Canvas 2D，零外部素材 / 零远程图片）。
 *
 * 约束：本目录下的所有数值都必须来自配置（tileSizePx）或设计令牌（theme/tokens.ts），
 * 不允许出现裸数字字面量——由 `no-hardcoded-balance.test.ts` 静态守护。
 * 允许直接书写的仅有 0 / 1 / 2 / 0.5，其余比例走令牌，复合值用其组合
 * （如 0.25 = 0.5×0.5、0.75 = 0.5+0.5×0.5、1.5 = 1+0.5）。
 *
 * 画风要点：
 *  - 实体统一带柔和落影（预绘制椭圆，不用 shadowBlur，控制逐帧成本）；
 *  - 塔 = 石质平台 + 差异化兵装（弩箭 / 炮管 / 冰晶）+ 等级点；
 *  - 敌人 = 球体高光 + 类型特征（快速拖尾、重装铆钉）；
 *  - 子弹按飞行方向旋转（弩箭为菱形矢），命中与减速沿用形状化反馈。
 */
import { canvas as geo, palette } from '../../theme/tokens';
import type { SpriteKey, SpriteStore } from '../assets';
import type { TowerRole } from '../../core';

export interface EnemyStyle {
  fill: string;
  edge: string;
}

/** 敌人外观：按配置里的 enemyId 取色，未知类型回退到默认配色。 */
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

/** 塔/敌人的精灵键（素材未加载时回落程序化绘制）。 */
const TOWER_SPRITE_KEYS: Readonly<Record<TowerRole, SpriteKey>> = {
  single_target: 'towerSingle',
  splash: 'towerSplash',
  slow: 'towerSlow',
};

const ENEMY_SPRITE_KEYS: Readonly<Record<string, SpriteKey>> = {
  normal: 'enemyNormal',
  fast: 'enemyFast',
  heavy: 'enemyHeavy',
};

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
  ctx.arcTo(x, y + radius, x + radius, y, radius);
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

/** 柔和落影：压扁的椭圆（比 shadowBlur 便宜一个数量级）。 */
function dropShadow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  circle(ctx, 0, 0, radius);
  ctx.fillStyle = palette.shadow;
  ctx.fill();
  ctx.restore();
}

/** 塔的等级指示：底座下缘一排小圆点（数量与形状共同表达等级）。 */
function drawLevelPips(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  level: number,
  half: number,
): void {
  const pip = tile * geo.towerPipRatio;
  const gap = pip * 2;
  const startX = x - (gap * (level - 1)) * 0.5;
  const pipY = y + half * (0.5 + 0.5 * 0.5);
  ctx.save();
  ctx.fillStyle = palette.towerBarrel;
  for (let index = 0; index < level; index++) {
    circle(ctx, startX + gap * index, pipY, pip);
    ctx.fill();
  }
  ctx.restore();
}

/** 塔：石质平台 + 兵装（按 role 差异化）+ 等级点。 */
export function drawTower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  role: TowerRole,
  level: number,
  sprites: SpriteStore | null = null,
): void {
  const color = towerColor(role);
  const half = tile * geo.towerPlatformRatio * 0.5;
  const corner = tile * geo.towerCornerRatio;
  const turret = tile * geo.towerTurretRatio;

  ctx.save();

  // 落影
  dropShadow(ctx, x, y + tile * geo.towerShadowOffsetRatio, half);

  // 素材优先：加载完成后用精灵绘制（保留等级点）
  const sprite = sprites ? sprites.get(TOWER_SPRITE_KEYS[role]) : null;
  if (sprite) {
    const size = tile * geo.spriteTowerRatio;
    ctx.drawImage(sprite, x - size * 0.5, y - size * 0.5, size, size);
    drawLevelPips(ctx, x, y, tile, level, half);
    ctx.restore();
    return;
  }

  // 石质平台（上缘亮 → 下缘暗）
  const platform = ctx.createLinearGradient(0, y - half, 0, y + half);
  platform.addColorStop(0, palette.towerStoneEdge);
  platform.addColorStop(1, palette.towerStone);
  ctx.fillStyle = platform;
  roundedRect(ctx, x - half, y - half, half * 2, half * 2, corner);
  ctx.fill();
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.strokeStyle = palette.towerStoneEdge;
  ctx.stroke();

  // 平台内侧的角色色镶边（类型一眼可辨）
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = color;
  roundedRect(
    ctx,
    x - half + geo.rangeRingWidth,
    y - half + geo.rangeRingWidth,
    half * 2 - geo.rangeRingWidth * 2,
    half * 2 - geo.rangeRingWidth * 2,
    corner * 0.5,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 炮塔底盘（深色内圆 + 角色色描边）
  circle(ctx, x, y, turret);
  ctx.fillStyle = palette.canvasBg;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();

  if (role === 'single_target') {
    // 弓弩塔：弓臂（V 形）+ 弓弦 + 竖直弩箭
    const n = tile * geo.towerMuzzleRatio;
    ctx.lineCap = 'round';
    ctx.strokeStyle = palette.towerBarrel;
    ctx.lineWidth = n * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - n, y - n);
    ctx.lineTo(x, y + n * 0.5);
    ctx.lineTo(x + n, y - n);
    ctx.stroke();

    // 弓弦
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = geo.gridLineWidth;
    ctx.beginPath();
    ctx.moveTo(x - n, y - n);
    ctx.lineTo(x + n, y - n);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 弩箭（竖杆 + 箭镞）
    ctx.lineWidth = n * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y + n);
    ctx.lineTo(x, y - n * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - n * 2 - n);
    ctx.lineTo(x - n * 0.5, y - n * 2);
    ctx.lineTo(x + n * 0.5, y - n * 2);
    ctx.closePath();
    ctx.fillStyle = palette.towerBarrel;
    ctx.fill();
  } else if (role === 'splash') {
    // 炮兵塔：斜向粗炮管 + 圆炮口（带内孔）
    const barrelHalf = tile * geo.towerBarrelHalfWidthRatio;
    const barrelLen = tile * geo.towerBarrelLenRatio;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI * -0.5 * 0.5);

    const barrel = ctx.createLinearGradient(0, -barrelHalf, 0, barrelHalf);
    barrel.addColorStop(0, palette.towerBarrel);
    barrel.addColorStop(1, palette.towerStone);
    ctx.fillStyle = barrel;
    roundedRect(ctx, 0, -barrelHalf, barrelLen, barrelHalf * 2, barrelHalf * 0.5);
    ctx.fill();
    ctx.lineWidth = geo.rangeRingWidth;
    ctx.strokeStyle = color;
    ctx.stroke();

    // 炮口
    circle(ctx, barrelLen, 0, barrelHalf * (0.5 + 0.5));
    ctx.fillStyle = palette.towerStone;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    circle(ctx, barrelLen, 0, barrelHalf * 0.5);
    ctx.fillStyle = palette.canvasBg;
    ctx.fill();
    ctx.restore();
  } else {
    // 冰晶塔：中央大晶体 + 两侧小碎片 + 内棱线 + 星点
    const halfW = tile * geo.towerCrystalHalfWidthRatio;
    const halfH = tile * geo.towerCrystalHalfHeightRatio;

    ctx.globalAlpha = geo.towerBaseFillAlpha;
    circle(ctx, x, y, turret);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    const shard = (cx: number, cy: number, w: number, h: number, alpha: number): void => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(cx, cy - h);
      ctx.lineTo(cx + w, cy);
      ctx.lineTo(cx, cy + h);
      ctx.lineTo(cx - w, cy);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = geo.rangeRingWidth;
      ctx.stroke();
    };
    // 两侧小碎片
    shard(x - halfW * 2, y + halfH * 0.5, halfW * 0.5, halfH * 0.5, 0.5);
    shard(x + halfW * 2, y + halfH * 0.5, halfW * 0.5, halfH * 0.5, 0.5);
    // 中央晶体
    shard(x, y, halfW, halfH, 0.5 + 0.5 * 0.5);

    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = palette.projectile;
    ctx.lineWidth = geo.gridLineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y - halfH * 0.5);
    ctx.lineTo(x, y + halfH * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = palette.projectile;
    circle(ctx, x - halfW * 2, y - halfH * (0.5 + 0.5 * 0.5), tile * geo.towerPipRatio);
    ctx.fill();
    circle(ctx, x + halfW * 2, y - halfH * 0.5 * 0.5, tile * geo.towerPipRatio);
    ctx.fill();
  }

  // 等级点
  drawLevelPips(ctx, x, y, tile, level, half);

  ctx.restore();
}

/** 敌人：落影 + 身体高光 + 类型特征 + 血条 +（被减速时的）冰环标记。 */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  enemyId: string,
  healthRatio: number,
  slowed: boolean,
  heading: number,
  sprites: SpriteStore | null = null,
): void {
  const style = enemyStyle(enemyId);
  const radius = enemyRadius(enemyId, tile);
  const spriteKey = ENEMY_SPRITE_KEYS[enemyId];
  const sprite = spriteKey && sprites ? sprites.get(spriteKey) : null;

  ctx.save();

  // 落影
  dropShadow(ctx, x, y + radius * 0.5, radius);

  if (slowed) {
    // 减速标识：冰面 + 冰环 + 四个方向的冰刺（形状信息，不只靠颜色）
    ctx.globalAlpha = geo.effectInnerAlpha * 0.5;
    circle(ctx, x, y, tile * geo.slowRingRatio);
    ctx.fillStyle = palette.enemySlowRing;
    ctx.fill();

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

  if (sprite) {
    const size = tile * geo.spriteEnemyRatio;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading + Math.PI * 0.5);
    ctx.drawImage(sprite, -size * 0.5, -size * 0.5, size, size);
    ctx.restore();
  } else {

  // 快速型：身后两段速度线（与行进方向相反的短划线）
  if (enemyId === 'fast') {
    const backX = Math.cos(heading);
    const backY = Math.sin(heading);
    const sideX = -backY;
    const sideY = backX;
    ctx.strokeStyle = style.fill;
    ctx.lineWidth = geo.enemyEdgeWidth;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.5;
    for (let index = 0; index < 2; index++) {
      const side = index * 2 - 1;
      const sx = x - backX * radius + sideX * side * radius * 0.5;
      const sy = y - backY * radius + sideY * side * radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - backX * radius * 0.5, sy - backY * radius * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 身体（球体感：底色 + 左上高光）
  ctx.globalAlpha = 1;
  circle(ctx, x, y, radius);
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.lineWidth = geo.enemyEdgeWidth;
  ctx.strokeStyle = style.edge;
  ctx.stroke();

  ctx.globalAlpha = geo.enemyShineAlpha;
  ctx.fillStyle = palette.towerBarrel;
  circle(ctx, x - radius * 0.5 * 0.5, y - radius * 0.5 * 0.5, radius * 0.5 * 0.5);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 类型内芯（快速：行进向箭头；其余：内环）
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = geo.enemyEdgeWidth;
  if (enemyId === 'fast') {
    const tipX = x + Math.cos(heading) * radius * 0.5;
    const tipY = y + Math.sin(heading) * radius * 0.5;
    const backX = Math.cos(heading) * radius * 0.5 * 0.5;
    const backY = Math.sin(heading) * radius * 0.5 * 0.5;
    const sideX = -Math.sin(heading) * radius * 0.5 * 0.5;
    const sideY = Math.cos(heading) * radius * 0.5 * 0.5;
    ctx.beginPath();
    ctx.moveTo(tipX - backX + sideX, tipY - backY + sideY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - backX - sideX, tipY - backY - sideY);
    ctx.stroke();
  } else {
    circle(ctx, x, y, radius * 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 重装型：四颗铆钉
  if (enemyId === 'heavy') {
    ctx.fillStyle = style.edge;
    for (let index = 0; index < geo.slowSpikeCount; index++) {
      const angle = Math.PI * 0.5 * index + Math.PI * 0.5 * 0.5;
      const distance = radius * (0.5 + 0.5 * 0.5);
      circle(ctx, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, radius * 0.5 * 0.5);
      ctx.fill();
    }
  }
  }

  // 血条（圆角 + 描边提升对比）
  const barWidth = tile * geo.healthBarWidthRatio;
  const barHeight = tile * geo.healthBarHeightRatio;
  const barX = x - barWidth * 0.5;
  const barY = y + tile * geo.healthBarOffsetRatio;
  const clamped = Math.max(0, Math.min(1, healthRatio));
  const barCorner = barHeight * 0.5;

  ctx.globalAlpha = geo.hpTrackAlpha;
  ctx.fillStyle = palette.canvasBg;
  roundedRect(ctx, barX, barY, barWidth, barHeight, barCorner);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = healthColor(clamped);
  if (clamped > 0) {
    roundedRect(ctx, barX, barY, barWidth * clamped, barHeight, barCorner);
    ctx.fill();
  }

  ctx.globalAlpha = 0.5;
  ctx.lineWidth = geo.gridLineWidth;
  ctx.strokeStyle = palette.canvasBg;
  roundedRect(ctx, barX, barY, barWidth, barHeight, barCorner);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

/** 子弹：弩箭（菱形矢 + 尾迹，随飞行方向旋转）/ 炮弹（亮球 + 高光）。 */
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  isSplash: boolean,
  angle: number,
): void {
  ctx.save();
  if (isSplash) {
    const radius = tile * geo.projectileSplashRatio;
    circle(ctx, x, y, radius);
    ctx.fillStyle = palette.projectileSplash;
    ctx.fill();
    ctx.lineWidth = geo.enemyEdgeWidth;
    ctx.strokeStyle = palette.effectSplash;
    ctx.stroke();

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette.projectile;
    circle(ctx, x - radius * 0.5 * 0.5, y - radius * 0.5 * 0.5, radius * 0.5 * 0.5);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    const r = tile * geo.projectileRadiusRatio;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(r * 2, 0);
    ctx.lineTo(0, -r * 0.5);
    ctx.lineTo(-r * 2, 0);
    ctx.lineTo(0, r * 0.5);
    ctx.closePath();
    ctx.fillStyle = palette.projectile;
    ctx.fill();

    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = palette.projectile;
    ctx.lineWidth = geo.gridLineWidth;
    ctx.beginPath();
    ctx.moveTo(-r * 2, 0);
    ctx.lineTo(-r * 2 - r, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 出生点 / 基地标记（柔光晕 + 护城环 + 内部符号；符号形状承担语义）。 */
export function drawEndpointMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  kind: 'spawn' | 'base',
): void {
  const color = kind === 'spawn' ? palette.canvasSpawn : palette.canvasBase;
  const radius = tile * (kind === 'spawn' ? geo.spawnMarkerRatio : geo.baseMarkerRatio);

  ctx.save();

  // 双层柔光晕（固定设施气质，不与敌人混淆）
  ctx.globalAlpha = geo.markerGlowAlpha;
  ctx.fillStyle = color;
  circle(ctx, x, y, tile * geo.markerGlowRadiusRatio);
  ctx.fill();
  ctx.globalAlpha = geo.markerGlowAlpha * 0.5;
  circle(ctx, x, y, radius * (1 + 0.5));
  ctx.fill();

  // 外环 + 内环
  ctx.globalAlpha = 1;
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.strokeStyle = color;
  circle(ctx, x, y, radius);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  circle(ctx, x, y, radius * (0.5 + 0.5 * 0.5));
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 符号
  const inner = radius * 0.5;
  if (kind === 'spawn') {
    // 出生点：四向向内的箭头 + 中心点（敌人从此涌入）
    ctx.strokeStyle = color;
    ctx.lineWidth = geo.enemyEdgeWidth;
    ctx.lineCap = 'round';
    for (let index = 0; index < geo.slowSpikeCount; index++) {
      const angle = Math.PI * 0.5 * index;
      const ox = Math.cos(angle);
      const oy = Math.sin(angle);
      const bx = x + ox * inner;
      const by = y + oy * inner;
      ctx.beginPath();
      ctx.moveTo(bx + ox * inner * 0.5, by + oy * inner * 0.5);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    circle(ctx, x, y, radius * 0.5 * 0.5);
    ctx.fill();
  } else {
    // 基地：竖长盾形 + 暗色核心点（要守住的目标）
    const shieldW = inner;
    const shieldH = inner * (0.5 + 1);
    ctx.fillStyle = color;
    roundedRect(ctx, x - shieldW * 0.5, y - shieldH * 0.5, shieldW, shieldH, radius * 0.5 * 0.5);
    ctx.fill();
    ctx.fillStyle = palette.canvasBg;
    circle(ctx, x, y, radius * 0.5 * 0.5);
    ctx.fill();
  }
  ctx.restore();
}
