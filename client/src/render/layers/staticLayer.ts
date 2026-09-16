/**
 * 静态层：瓷砖地图（草地/泥路/装饰，素材来自 Kenney CC0）+ 出生 / 基地标记。
 *
 * 素材加载完成（SpriteStore 就绪）时用瓷砖铺装：
 *  - 全图草地 → 沿 waypoints 铺棕色泥路（连通掩码自动选过渡块）；
 *  - 转弯外侧缺口用同向小角块补缝；
 *  - 确定性撒少量树/石装饰（不挡路、不贴路）。
 * 素材不可用时回落到程序化的氛围底色 + 折线路径（原实现）。
 *
 * 静态层只在「首次挂载 / dpr 变化 / 配置版本变化 / 素材就绪」时重绘一次。
 */
import { cellCenter, getPath } from '../../core';
import type { GameConfig } from '../../core';
import { canvas as geo, palette } from '../../theme/tokens';
import type { SpriteStore } from '../assets';
import { drawEndpointMarker } from '../sprites';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 沿折线均匀铺小箭头（V 形，指示行军方向；仅程序化回落模式使用）。 */
function paintPathChevrons(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[], tile: number): void {
  if (points.length < 2) return;
  const spacing = tile * geo.pathChevronSpacingRatio;
  const size = tile * geo.pathChevronSizeRatio;

  ctx.save();
  ctx.strokeStyle = palette.pathChevron;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let carry = spacing * 0.5;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].x;
    const ay = points[i].y;
    const dx = points[i + 1].x - ax;
    const dy = points[i + 1].y - ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    let d = carry;
    while (d <= len) {
      ctx.save();
      ctx.translate(ax + ux * d, ay + uy * d);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.5);
      ctx.lineTo(0, 0);
      ctx.lineTo(-size, size * 0.5);
      ctx.stroke();
      ctx.restore();
      d += spacing;
    }
    carry = d - len;
  }
  ctx.restore();
}

/** 计算路径格集合（key = "col,row"）与查询函数。 */
function collectPathCells(config: GameConfig): { has: (col: number, row: number) => boolean } {
  const cells = new Set<string>();
  const waypoints = config.map.pathWaypoints;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const ax = waypoints[i][0];
    const ay = waypoints[i][1];
    const bx = waypoints[i + 1][0];
    const by = waypoints[i + 1][1];
    if (ax === bx) {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) cells.add(ax + ',' + y);
    } else {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) cells.add(x + ',' + ay);
    }
  }
  return { has: (col: number, row: number): boolean => cells.has(col + ',' + row) };
}

/** 瓷砖模式：草地平铺 + 泥路 + 补缝 + 装饰。素材不齐时返回 false。 */
function paintTiles(ctx: CanvasRenderingContext2D, config: GameConfig, sprites: SpriteStore): boolean {
  const tile = config.grid.tileSizePx;
  const cols = config.grid.cols;
  const rows = config.grid.rows;

  const grass = sprites.get('tileGrass');
  const road = sprites.get('tileRoad');
  const blendN = sprites.get('tileBlendN');
  const blendS = sprites.get('tileBlendS');
  const blendE = sprites.get('tileBlendE');
  const blendW = sprites.get('tileBlendW');
  const cornerNE = sprites.get('tileCornerNE');
  const cornerSE = sprites.get('tileCornerSE');
  const cornerSW = sprites.get('tileCornerSW');
  const cornerNW = sprites.get('tileCornerNW');
  if (!grass || !road || !blendN || !blendS || !blendE || !blendW || !cornerNE || !cornerSE || !cornerSW || !cornerNW) {
    return false;
  }

  // 草地
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.drawImage(grass, col * tile, row * tile, tile, tile);
    }
  }

  // 泥路（路径格）
  const { has } = collectPathCells(config);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (has(col, row)) ctx.drawImage(road, col * tile, row * tile, tile, tile);
    }
  }

  // 过渡与补缝（非路径格：按邻接关系选过渡/角块）
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (has(col, row)) continue;
      const n = has(col, row - 1);
      const e = has(col + 1, row);
      const s = has(col, row + 1);
      const w = has(col - 1, row);
      const count = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);
      let img: CanvasImageSource | null = null;
      if (count === 1) {
        img = n ? blendN : s ? blendS : e ? blendE : w ? blendW : null;
      } else if (count === 2) {
        if (n && e) img = cornerNE;
        else if (e && s) img = cornerSE;
        else if (s && w) img = cornerSW;
        else if (w && n) img = cornerNW;
        else img = road;
      } else if (count >= 2 + 1) {
        img = road;
      } else {
        // 四邻无路：斜对角邻路（转弯外侧缺口）用同向小角块补缝
        const ne = has(col + 1, row - 1);
        const se = has(col + 1, row + 1);
        const sw = has(col - 1, row + 1);
        const nw = has(col - 1, row - 1);
        const diagCount = (ne ? 1 : 0) + (se ? 1 : 0) + (sw ? 1 : 0) + (nw ? 1 : 0);
        if (diagCount === 1) img = ne ? cornerNE : se ? cornerSE : sw ? cornerSW : cornerNW;
      }
      if (img) ctx.drawImage(img, col * tile, row * tile, tile, tile);
    }
  }

  // 装饰：确定性伪随机（不贴路、离边缘一格）
  const tree = sprites.get('decorTree');
  const rock = sprites.get('decorRock');
  if (tree || rock) {
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        if (has(col, row)) continue;
        if (has(col - 1, row) || has(col + 1, row) || has(col, row - 1) || has(col, row + 1)) continue;
        const hash = (col * 2 + row * (2 + 1)) % (2 * 2 + 2 + 1);
        const pick = hash === 1 ? tree : hash === 2 * 2 ? rock : null;
        if (pick) ctx.drawImage(pick, col * tile, row * tile, tile, tile);
      }
    }
  }

  return true;
}

/**
 * 把静态层画到给定上下文（要求上下文已按 dpr 设好 transform，坐标是逻辑像素）。
 */
export function paintStaticLayer(ctx: CanvasRenderingContext2D, config: GameConfig, sprites: SpriteStore | null = null): void {
  const tile = config.grid.tileSizePx;
  const width = config.canvas.logicWidthPx;
  const height = config.canvas.logicHeightPx;
  const cols = config.grid.cols;
  const rows = config.grid.rows;

  ctx.save();

  const tiled = sprites ? paintTiles(ctx, config, sprites) : false;

  if (!tiled) {
    // —— 程序化回落：氛围底色 + 折线路径 + 方向箭头 ——
    const atmosphere = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      0,
      width * 0.5,
      height * 0.5,
      Math.hypot(width, height) * 0.5,
    );
    atmosphere.addColorStop(0, palette.canvasGrid);
    atmosphere.addColorStop(1, palette.canvasBg);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, width, height);

    const path = getPath(config);
    const points = path.points;
    if (points.length > 0) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const trace = (): void => {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      };

      trace();
      ctx.lineWidth = tile * geo.pathWidthRatio + geo.rangeRingWidth * 2;
      ctx.strokeStyle = palette.shadow;
      ctx.stroke();

      trace();
      ctx.lineWidth = tile * geo.pathWidthRatio;
      ctx.strokeStyle = palette.canvasPathEdge;
      ctx.stroke();

      trace();
      ctx.lineWidth = tile * geo.pathCoreRatio;
      ctx.strokeStyle = palette.canvasPath;
      ctx.stroke();
    }

    paintPathChevrons(ctx, points, tile);

    // 网格（整数像素 + 半像素偏移 → 1px 细线不发虚）
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
  }

  // 出生点 / 基地：配置里的格子可能落在画布外（路径首尾越界），夹回可见区
  const radius = tile * geo.baseMarkerRatio;
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
export function createStaticSurface(config: GameConfig, dpr: number, sprites: SpriteStore | null = null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(config.canvas.logicWidthPx * dpr));
  canvas.height = Math.max(1, Math.round(config.canvas.logicHeightPx * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStaticLayer(ctx, config, sprites);
  }
  return canvas;
}
