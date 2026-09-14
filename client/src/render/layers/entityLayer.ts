/**
 * 实体层：塔 / 敌人 / 血条 / 减速标识 / 子弹。
 *
 * 位置来自 `state`（逻辑真值）+ `interpolation`（上一固定步与当前步之间的插值系数），
 * 因此渲染是 60Hz 平滑的，但推演仍严格按固定步长（AC-6）。
 *
 * 热循环零分配：坐标就地算，复用模块级 `tmp` 向量，不调用会分配对象的辅助函数。
 */
import { findTowerAt, getTowerDef, getTowerLevelStats, getPath, pathPointAt } from '../../core';
import type { GameConfig, GameState, TileCoord, Vec2 } from '../../core';
import { canvas as geo, palette } from '../../theme/tokens';
import { circle, drawEnemy, drawProjectile, drawTower } from '../sprites';

/**
 * 渲染插值数据（与 engine/GameStore 的 `InterpolationData` 结构一致）。
 * 这里独立声明，避免 render 层反向依赖 engine 层。
 */
export interface InterpolationState {
  alpha: number;
  enemyPathDistance: ReadonlyMap<number, number>;
  projectilePosition: ReadonlyMap<number, Vec2>;
}

export interface EntitySceneInput {
  config: GameConfig;
  state: GameState;
  interpolation: InterpolationState;
  selected: TileCoord | null;
}

/** 复用的采样容器（热循环零分配）。 */
const tmp: Vec2 = { x: 0, y: 0 };

function drawRangeRing(ctx: CanvasRenderingContext2D, x: number, y: number, range: number): void {
  ctx.save();
  ctx.globalAlpha = geo.rangeFillAlpha;
  ctx.fillStyle = palette.rangeRing;
  circle(ctx, x, y, range);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.lineWidth = geo.rangeRingWidth;
  ctx.strokeStyle = palette.rangeRing;
  circle(ctx, x, y, range);
  ctx.stroke();
  ctx.restore();
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, x: number, y: number, tile: number): void {
  ctx.save();
  ctx.lineWidth = geo.hoverStrokeWidth;
  ctx.strokeStyle = palette.selectionRing;
  circle(ctx, x, y, tile * geo.selectionRingRatio);
  ctx.stroke();
  ctx.restore();
}

export function drawEntities(ctx: CanvasRenderingContext2D, scene: EntitySceneInput): void {
  const config = scene.config;
  const state = scene.state;
  const tile = config.grid.tileSizePx;
  const alpha = scene.interpolation.alpha;
  const path = getPath(config);

  ctx.save();

  // 1) 选中塔的射程圈 + 选中环（画在实体之下，不遮挡本体）
  const selected = scene.selected;
  if (selected) {
    const tower = findTowerAt(state, selected.col, selected.row);
    if (tower) {
      const x = (tower.col + 0.5) * tile;
      const y = (tower.row + 0.5) * tile;
      const stats = getTowerLevelStats(config, tower.towerId, tower.level);
      if (stats) drawRangeRing(ctx, x, y, stats.range);
      drawSelectionRing(ctx, x, y, tile);
    }
  }

  // 2) 塔
  for (let i = 0; i < state.towers.length; i++) {
    const tower = state.towers[i];
    const def = getTowerDef(config, tower.towerId);
    if (!def) continue;
    drawTower(ctx, (tower.col + 0.5) * tile, (tower.row + 0.5) * tile, tile, def.role, tower.level);
  }

  // 3) 敌人（沿路径插值采样）
  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    const previous = scene.interpolation.enemyPathDistance.get(enemy.id) ?? enemy.pathDistance;
    const distance = previous + (enemy.pathDistance - previous) * alpha;
    pathPointAt(path, distance, tmp);
    const healthRatio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
    drawEnemy(ctx, tmp.x, tmp.y, tile, enemy.enemyId, healthRatio, enemy.slowDebuffs.length > 0);
  }

  // 4) 子弹
  for (let i = 0; i < state.projectiles.length; i++) {
    const projectile = state.projectiles[i];
    const previous = scene.interpolation.projectilePosition.get(projectile.id);
    const x = previous ? previous.x + (projectile.x - previous.x) * alpha : projectile.x;
    const y = previous ? previous.y + (projectile.y - previous.y) * alpha : projectile.y;
    drawProjectile(ctx, x, y, tile, projectile.splashRadius !== null);
  }

  ctx.restore();
}
