/**
 * 固定步长主循环（AC-6）。
 *
 * - 累加器：`acc += realDelta × speed`；`while (acc >= SIM_DT) step()`
 * - 1x/2x 只放大注入累加器的实时 delta，**SIM_DT 不变** → 推演确定性不受影响
 * - 单帧最多补偿 MAX_STEPS_PER_FRAME 步，超出则丢弃积压（防死亡螺旋）
 * - 渲染用 `alpha = acc / SIM_DT` 在前后状态间插值，视觉平滑但与逻辑解耦
 */

/** 固定模拟步长（秒）。内核只接受它作为 dt，因此推演与帧率无关。 */
export const SIM_DT_SEC = 1 / 60;

/** 固定模拟步长（毫秒）。 */
export const SIM_DT_MS = 1000 / 60;

/** 单帧最多补偿的模拟步数（防止掉帧后的死亡螺旋）。 */
export const MAX_STEPS_PER_FRAME = 5;

/** 单帧实时 delta 上限（毫秒）——标签页切回时避免一次性追赶巨量时间。 */
export const MAX_FRAME_MS = 250;

export interface LoopOptions {
  /** 推进一个固定步长。 */
  step: () => void;
  /** 每帧渲染回调；alpha ∈ [0,1) 为插值系数。 */
  frame: (alpha: number, realDeltaMs: number) => void;
  /** 当前倍速（1x/2x）。 */
  speedMultiplier: () => number;
}

export interface LoopHandle {
  start: () => void;
  stop: () => void;
  readonly running: boolean;
  /** 当前插值系数（渲染层可直接读）。 */
  readonly alpha: number;
}

interface LoopClock {
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (handle: number) => void;
}

const browserClock: LoopClock = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
};

export function createLoop(options: LoopOptions, clock: LoopClock = browserClock): LoopHandle {
  let rafHandle: number | null = null;
  let lastTimestamp = 0;
  let accumulatorMs = 0;
  let alpha = 0;

  const tick = (timestamp: number): void => {
    if (rafHandle === null) return;
    rafHandle = clock.requestFrame(tick);

    if (lastTimestamp === 0) lastTimestamp = timestamp;
    const rawDelta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    const realDeltaMs = Math.min(Math.max(rawDelta, 0), MAX_FRAME_MS);

    accumulatorMs += realDeltaMs * options.speedMultiplier();

    let steps = 0;
    while (accumulatorMs >= SIM_DT_MS && steps < MAX_STEPS_PER_FRAME) {
      options.step();
      accumulatorMs -= SIM_DT_MS;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) {
      // 掉帧太严重：丢弃积压时间，宁可"慢放"也不要卡死。
      accumulatorMs = 0;
    }

    alpha = accumulatorMs / SIM_DT_MS;
    options.frame(alpha, realDeltaMs);
  };

  return {
    start: () => {
      if (rafHandle !== null) return;
      lastTimestamp = 0;
      accumulatorMs = 0;
      alpha = 0;
      rafHandle = clock.requestFrame(tick);
    },
    stop: () => {
      if (rafHandle === null) return;
      clock.cancelFrame(rafHandle);
      rafHandle = null;
    },
    get running() {
      return rafHandle !== null;
    },
    get alpha() {
      return alpha;
    },
  };
}

/** 只读时钟：供 FPS 叠加层使用。 */
export function createFpsMeter(windowSize = 60) {
  const samples: number[] = [];
  return {
    push(deltaMs: number): void {
      samples.push(deltaMs);
      if (samples.length > windowSize) samples.shift();
    },
    reset(): void {
      samples.length = 0;
    },
    stats(): { avgMs: number; p95Ms: number; fps: number; samples: number } {
      if (samples.length === 0) return { avgMs: 0, p95Ms: 0, fps: 0, samples: 0 };
      const sorted = [...samples].sort((a, b) => a - b);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      const avgMs = total / sorted.length;
      const p95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
      return { avgMs, p95Ms, fps: avgMs > 0 ? 1000 / avgMs : 0, samples: sorted.length };
    },
  };
}
