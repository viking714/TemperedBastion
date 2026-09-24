/**
 * 特效层：命中 / 溅射 / 减速 的扩散圆环 + 内芯柔光（池化，Object Pool 模式）。
 *
 * 为什么用环而不是粒子：环只需一次 `arc`，无逐粒子状态，
 * 在 60 敌 + 20 塔的稳态下几乎零成本；"扩散的环 + 内芯"本身就是清晰的命中反馈。
 * 命中额外叠加四向短射线（形状化反馈），溅射叠加副环。
 *
 * 特效是**表现层**产物，不参与内核推演，因此不修改任何 `GameState`。
 */
import { ObjectPool } from '../../engine/pools';
import { canvas as geo, palette } from '../../theme/tokens';
import { circle } from '../sprites';

export type EffectKind = 'hit' | 'splash' | 'slow';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  ageMs: number;
}

const EFFECT_COLOR: Readonly<Record<EffectKind, string>> = {
  hit: palette.effectHit,
  splash: palette.effectSplash,
  slow: palette.enemySlowRing,
};

/** 允许的组合常量（守护只白名单 0 / 1 / 2 / 0.5）。 */
const THREE_QUARTERS = 0.5 + 0.5 * 0.5;

function createEffect(): Effect {
  return { kind: 'hit', x: 0, y: 0, ageMs: 0 };
}

export class EffectsLayer {
  private readonly pool = new ObjectPool<Effect>(createEffect, geo.effectPoolLimit);
  private active: Effect[] = [];

  spawn(kind: EffectKind, x: number, y: number): void {
    const effect = this.pool.acquire();
    effect.kind = kind;
    effect.x = x;
    effect.y = y;
    effect.ageMs = 0;
    this.active.push(effect);
  }

  /** 推进寿命并回收过期项（写指针原地压缩，零分配）。 */
  advance(deltaMs: number): void {
    let write = 0;
    for (let read = 0; read < this.active.length; read++) {
      const effect = this.active[read];
      effect.ageMs += deltaMs;
      if (effect.ageMs < geo.effectLifeMs) {
        this.active[write] = effect;
        write += 1;
      } else {
        this.pool.release(effect);
      }
    }
    this.active.length = write;
  }

  /** 无活跃特效时直接返回，零成本。 */
  draw(ctx: CanvasRenderingContext2D, tileSizePx: number): void {
    if (this.active.length === 0) return;
    const span = geo.effectMaxRadiusRatio - geo.effectMinRadiusRatio;

    ctx.save();
    ctx.lineWidth = geo.rangeRingWidth;
    const sparkLen = tileSizePx * geo.effectSparkLengthRatio;

    for (let i = 0; i < this.active.length; i++) {
      const effect = this.active[i];
      const progress = effect.ageMs / geo.effectLifeMs;
      const fade = 1 - progress;
      const radius = tileSizePx * (geo.effectMinRadiusRatio + span * progress);
      const color = EFFECT_COLOR[effect.kind];

      // 内芯柔光
      ctx.globalAlpha = geo.effectInnerAlpha * fade;
      ctx.fillStyle = color;
      circle(ctx, effect.x, effect.y, radius * 0.5);
      ctx.fill();

      // 主环
      ctx.globalAlpha = fade;
      ctx.strokeStyle = color;
      circle(ctx, effect.x, effect.y, radius);
      ctx.stroke();

      if (effect.kind === 'hit') {
        // 命中：四向短射线
        ctx.globalAlpha = fade * THREE_QUARTERS;
        for (let s = 0; s < geo.effectSparkCount; s++) {
          const angle = Math.PI * 0.5 * s + Math.PI * 0.5 * 0.5;
          const inner = radius * THREE_QUARTERS;
          const outer = inner + sparkLen;
          ctx.beginPath();
          ctx.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
          ctx.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
          ctx.stroke();
        }
      } else if (effect.kind === 'splash') {
        // 溅射：内副环
        ctx.globalAlpha = fade * 0.5;
        circle(ctx, effect.x, effect.y, radius * THREE_QUARTERS);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  clear(): void {
    this.pool.releaseAll(this.active);
  }

  get count(): number {
    return this.active.length;
  }
}
