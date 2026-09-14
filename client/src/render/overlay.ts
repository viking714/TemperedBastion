/**
 * 覆盖层：建塔悬停指示（合法 / 非法）+ 射程预览。
 *
 * 只有「已选中一种塔类型且鼠标悬停在棋盘上」时才绘制。
 * 合法性完全由 `core.isBuildable` 的结论（由 store 传入）+ 金币共同决定——
 * 渲染层不重复实现规则，避免两套判定漂移。
 *
 * 非法状态不只靠颜色：额外叠加一个"叉"，色觉障碍玩家也能判别。
 */
import { getTowerDef, getTowerLevelStats } from '../core';
import type { GameConfig, GameState, PlacementResult, TileCoord } from '../core';
import { canvas as geo, palette } from '../theme/tokens';
import { circle, roundedRect } from './sprites';

export interface OverlayInput {
  config: GameConfig;
  state: GameState;
  hover: TileCoord | null;
  buildTowerId: string | null;
  /** 悬停格的建塔合法性结论（由 store.placementOf 得出；无悬停时为 null）。 */
  placement: PlacementResult | null;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { config, state, hover, buildTowerId } = input;
  if (!hover || !buildTowerId) return;

  const def = getTowerDef(config, buildTowerId);
  if (!def) return;

  const tile = config.grid.tileSizePx;
  const half = tile * 0.5;
  const x = (hover.col + 0.5) * tile;
  const y = (hover.row + 0.5) * tile;
  const affordable = state.gold >= def.cost;
  const legal = input.placement?.valid === true && affordable;
  const color = legal ? palette.hoverLegal : palette.hoverIllegal;
  const radius = tile * geo.towerCornerRatio;

  ctx.save();

  // 射程预览（以 1 级射程为参考——建塔后的初始能力）
  const stats = getTowerLevelStats(config, def.id, 1);
  if (stats) {
    ctx.globalAlpha = geo.rangeFillAlpha;
    ctx.fillStyle = palette.rangeRing;
    circle(ctx, x, y, stats.range);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.lineWidth = geo.rangeRingWidth;
    ctx.strokeStyle = palette.rangeRing;
    circle(ctx, x, y, stats.range);
    ctx.stroke();
  }

  // 格子指示
  ctx.globalAlpha = geo.hoverFillAlpha;
  ctx.fillStyle = color;
  roundedRect(ctx, x - half, y - half, tile, tile, radius);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.lineWidth = geo.hoverStrokeWidth;
  ctx.strokeStyle = color;
  roundedRect(ctx, x - half, y - half, tile, tile, radius);
  ctx.stroke();

  if (!legal) {
    // 非法：叠加"叉"
    const inset = half - radius;
    ctx.lineWidth = geo.hoverStrokeWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - inset, y - inset);
    ctx.lineTo(x + inset, y + inset);
    ctx.moveTo(x + inset, y - inset);
    ctx.lineTo(x - inset, y + inset);
    ctx.stroke();
  }

  ctx.restore();
}
