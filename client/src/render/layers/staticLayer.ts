/**
 * 静态层：网格 + 路径 + 出生 / 基地标记。
 *
 * 只在「首次挂载 / dpr 变化 / 配置版本变化」时绘制一次到离屏 canvas，
 * 之后每帧只做一次 `drawImage`——避开了逐帧重建路径与网格线的开销（AC-6）。
 *
 * 数值来源：`config.grid` / `config.canvas`（后端配置）+ `theme/tokens.ts`（设计令牌）。
 */
import { cellCenter, getPath } from '../../core';
import type { GameConfig } from '../../core';
import { canvas as geo, palette } from '../../theme/tokens';
import { drawEndpointMarker } from '../sprites';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 把静态层画到给定上下文（要求上下文已按 dpr 设好 transform，坐标是逻辑像素）。
 */
export function paintStaticLayer(ctx: CanvasRenderingContext2D, config: GameConfig): void {
  const tile = config.grid.tileSizePx;
  const width = config.canvas.logicWidthPx;
  const height = config.canvas.logicHeightPx;
  const cols = config.grid.cols;
  const rows = config.grid.rows;

  ctx.save();

  // 底色
  ctx.fillStyle = palette.canvasBg;
  ctx.fillRect(0, 0, width, height);

  // 行军路径：先描"路肩"（宽、暗），再叠"路面"（窄、亮）
  const path = getPath(config);
  const points = path.points;
  if (points.length > 0) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineWidth = tile * geo.pathWidthRatio;
    ctx.strokeStyle = palette.canvasPathEdge;
    ctx.stroke();
    ctx.lineWidth = tile * geo.pathCoreRatio;
    ctx.strokeStyle = palette.canvasPath;
    ctx.stroke();
  }

  // 网格：整数像素 + 半像素偏移 → 1px 细线不发虚
  ctx.lineWidth = geo.gridLineWidth;
  for (let col = 0; col <= cols; col++) {
    const x = Math.round(col * tile) + 0.5;
    ctx.beginPath();
    ctx.strokeStyle = col % geo.gridMajorEvery === 0 ? palette.canvasGridMajor : palette.canvasGrid;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let row = 0; row <= rows; row++) {
    const y = Math.round(row * tile) + 0.5;
    ctx.beginPath();
    ctx.strokeStyle = row % geo.gridMajorEvery === 0 ? palette.canvasGridMajor : palette.canvasGrid;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 出生点 / 基地：配置里的格子可能落在画布外（路径首尾越界），夹回可见区
  const radius = tile * geo.endpointRingRatio;
  const spawn = cellCenter(config, config.map.spawnTile[0], config.map.spawnTile[1]);
  const base = cellCenter(config, config.map.baseTile[0], config.map.baseTile[1]);
  drawEndpointMarker(
    ctx,
    clamp(spawn.x, radius, width - radius),
    clamp(spawn.y, radius, height - radius),
    tile,
    'spawn',
  );
  drawEndpointMarker(
    ctx,
    clamp(base.x, radius, width - radius),
    clamp(base.y, radius, height - radius),
    tile,
    'base',
  );

  ctx.restore();
}

/** 创建（并按 dpr 渲染）静态层的离屏 canvas。 */
export function createStaticSurface(config: GameConfig, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(config.canvas.logicWidthPx * dpr));
  canvas.height = Math.max(1, Math.round(config.canvas.logicHeightPx * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStaticLayer(ctx, config);
  }
  return canvas;
}
