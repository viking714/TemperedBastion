/**
 * Canvas 渲染编排（Imperative Shell 的渲染侧）。
 *
 * 职责：
 *  - 三层合成：静态层（离屏 blit）→ 实体层 → 特效层 → 覆盖层；
 *  - devicePixelRatio 处理：backing store = CSS 尺寸 × dpr，`setTransform` 后
 *    一律用**逻辑像素**（800×480）作图，逻辑坐标不因缩放变形；
 *  - resize：跟随容器宽度等比缩放（只缩不放，避免放大后发虚），dpr 变化时重建静态层；
 *  - 自持 rAF 绘制循环（模拟循环由 GameStore 持有），两者解耦：
 *    模拟按固定步长，绘制按帧率，位置用插值衔接（AC-6）。
 *
 * 表现层推导（命中/减速特效）只读 `GameState`，绝不写回——内核状态仍只由 core.step 演进。
 */
import { getPath, pathPointAt } from '../core';
import type { GameState, PlacementResult, TileCoord, Vec2 } from '../core';
import type { GameStore } from '../engine/GameStore';
import { sameTile } from '../engine/input';
import { MAX_FRAME_MS, createFpsMeter } from '../engine/loop';
import { drawEntities } from './layers/entityLayer';
import type { InterpolationState } from './layers/entityLayer';
import { EffectsLayer } from './layers/effectsLayer';
import { createStaticSurface } from './layers/staticLayer';
import { drawOverlay } from './overlay';

export interface FrameStats {
  avgMs: number;
  p95Ms: number;
  fps: number;
  samples: number;
}

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  store: GameStore;
  /** 可选的调试节点：会写入实时 FPS 文本（只在开发模式由调用方传入）。 */
  fpsElement?: HTMLElement | null;
}

interface ProjectileTrace {
  x: number;
  y: number;
  splash: boolean;
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly store: GameStore;
  private readonly fpsElement: HTMLElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly effects = new EffectsLayer();
  private readonly fps = createFpsMeter();

  private staticSurface: HTMLCanvasElement | null = null;
  private staticDpr = 0;
  private dpr = 1;
  private scale = 1;
  private layoutKey = '';

  private rafHandle: number | null = null;
  private lastTimestamp = 0;
  private lastFpsLabel = '';

  private readonly traces = new Map<number, ProjectileTrace>();
  private readonly seenProjectiles = new Set<number>();
  private readonly slowCounts = new Map<number, number>();
  private readonly aliveEnemies = new Set<number>();

  private lastPlacementTile: TileCoord | null = null;
  private placementCache: PlacementResult | null = null;
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  private resizeObserver: ResizeObserver | null = null;

  constructor(options: CanvasRendererOptions) {
    this.canvas = options.canvas;
    this.container = options.container;
    this.store = options.store;
    this.fpsElement = options.fpsElement ?? null;
    this.ctx = options.canvas.getContext('2d');
    this.layout();
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastTimestamp = 0;
    this.layout();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this.container);
    }
    this.rafHandle = window.requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      window.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  dispose(): void {
    this.stop();
    this.effects.clear();
    this.traces.clear();
    this.seenProjectiles.clear();
    this.slowCounts.clear();
  }

  getFrameStats(): FrameStats {
    return this.fps.stats();
  }

  /** 立即重绘一帧（例如读档后不等下一帧）。 */
  redraw(): void {
    this.draw(0);
  }

  // -------------------------------------------------------------------------
  // 布局
  // -------------------------------------------------------------------------

  private layout(): void {
    const config = this.store.config;
    const logicalWidth = config.canvas.logicWidthPx;
    const logicalHeight = config.canvas.logicHeightPx;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const available = this.container.clientWidth;
    const cssWidth = available > 0 ? Math.min(available, logicalWidth) : logicalWidth;
    const scale = cssWidth / logicalWidth;
    const cssHeight = logicalHeight * scale;
    const key = `${cssWidth}|${cssHeight}|${dpr}`;
    if (key === this.layoutKey) return;

    this.layoutKey = key;
    this.dpr = dpr;
    this.scale = scale;

    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));

    if (!this.staticSurface || this.staticDpr !== dpr) {
      this.staticSurface = createStaticSurface(config, dpr);
      this.staticDpr = dpr;
    }
  }

  // -------------------------------------------------------------------------
  // 绘制循环
  // -------------------------------------------------------------------------

  private readonly frame = (timestamp: number): void => {
    this.rafHandle = window.requestAnimationFrame(this.frame);

    const rawDelta = this.lastTimestamp === 0 ? 0 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    const deltaMs = Math.min(Math.max(rawDelta, 0), MAX_FRAME_MS);

    this.fps.push(deltaMs);
    this.draw(deltaMs);
    this.publishFps();
  };

  private publishFps(): void {
    const element = this.fpsElement;
    if (!element) return;
    const label = `${Math.round(this.fps.stats().fps)} FPS`;
    if (label === this.lastFpsLabel) return;
    this.lastFpsLabel = label;
    element.textContent = label;
  }

  private draw(deltaMs: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const store = this.store;
    const config = store.config;
    const state = store.getState();
    const interpolation = store.getInterpolation();

    this.advanceEffects(state, interpolation, deltaMs);

    const ratio = this.scale * this.dpr;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, config.canvas.logicWidthPx, config.canvas.logicHeightPx);

    if (this.staticSurface) {
      ctx.drawImage(this.staticSurface, 0, 0, config.canvas.logicWidthPx, config.canvas.logicHeightPx);
    }

    drawEntities(ctx, { config, state, interpolation, selected: store.selected });
    this.effects.draw(ctx, config.grid.tileSizePx);
    drawOverlay(ctx, {
      config,
      state,
      hover: store.hoveredTile,
      buildTowerId: store.selectedBuildTowerId,
      placement: this.resolvePlacement(store.hoveredTile),
    });
  }

  // -------------------------------------------------------------------------
  // 悬停合法性缓存（只在悬停格变化时调用内核，避免逐帧栅格化路径）
  // -------------------------------------------------------------------------

  private resolvePlacement(tile: TileCoord | null): PlacementResult | null {
    if (!tile) {
      this.lastPlacementTile = null;
      this.placementCache = null;
      return null;
    }
    if (!sameTile(this.lastPlacementTile, tile)) {
      this.lastPlacementTile = { col: tile.col, row: tile.row };
      this.placementCache = this.store.placementOf(tile);
    }
    return this.placementCache;
  }

  // -------------------------------------------------------------------------
  // 表现层推导：命中 / 减速特效
  // -------------------------------------------------------------------------

  private advanceEffects(state: GameState, interpolation: InterpolationState, deltaMs: number): void {
    this.effects.advance(deltaMs);

    // 命中：上一帧还在、这一帧消失的子弹 → 在它最后的位置爆开
    const projectiles = state.projectiles;
    this.seenProjectiles.clear();
    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i];
      this.seenProjectiles.add(projectile.id);
      const trace = this.traces.get(projectile.id);
      if (trace) {
        trace.x = projectile.x;
        trace.y = projectile.y;
      } else {
        this.traces.set(projectile.id, {
          x: projectile.x,
          y: projectile.y,
          splash: projectile.splashRadius !== null,
        });
      }
    }
    if (this.traces.size > this.seenProjectiles.size) {
      for (const [id, trace] of this.traces) {
        if (this.seenProjectiles.has(id)) continue;
        this.effects.spawn(trace.splash ? 'splash' : 'hit', trace.x, trace.y);
        this.traces.delete(id);
      }
    }

    // 减速：某个敌人的 debuff 从无到有 → 在它当前位置亮一个冰环
    const enemies = state.enemies;
    const path = getPath(this.store.config);
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const previous = this.slowCounts.get(enemy.id) ?? 0;
      const current = enemy.slowDebuffs.length;
      if (previous === 0 && current > 0) {
        const before = interpolation.enemyPathDistance.get(enemy.id) ?? enemy.pathDistance;
        const distance = before + (enemy.pathDistance - before) * interpolation.alpha;
        pathPointAt(path, distance, this.tmp);
        this.effects.spawn('slow', this.tmp.x, this.tmp.y);
      }
      this.slowCounts.set(enemy.id, current);
    }
    if (this.slowCounts.size > enemies.length) {
      this.aliveEnemies.clear();
      for (let i = 0; i < enemies.length; i++) this.aliveEnemies.add(enemies[i].id);
      for (const id of this.slowCounts.keys()) {
        if (!this.aliveEnemies.has(id)) this.slowCounts.delete(id);
      }
    }
  }
}
