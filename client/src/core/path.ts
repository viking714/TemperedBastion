/**
 * 路径几何：waypoint 折线 → 世界坐标折线 / 分段累积长度 / 按距离采样坐标。
 *
 * 结果按 config 对象缓存（WeakMap），避免每步重复构建；
 * 采样写入调用方提供的 out 对象，热循环零分配。
 */
import type { GameConfig, Vec2 } from './types';

export interface PathSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 该段起点在整条路径上的累积距离。 */
  startDistance: number;
  length: number;
}

export interface PathData {
  points: Vec2[];
  segments: PathSegment[];
  totalLength: number;
}

const pathCache = new WeakMap<GameConfig, PathData>();

/** 网格坐标 → 该格中心的世界坐标。 */
export function tileCenter(config: GameConfig, col: number, row: number): Vec2 {
  const tile = config.grid.tileSizePx;
  return { x: (col + 0.5) * tile, y: (row + 0.5) * tile };
}

export function buildPath(config: GameConfig): PathData {
  const waypoints = config.map.pathWaypoints;
  const points: Vec2[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    points.push(tileCenter(config, wp[0], wp[1]));
  }

  const segments: PathSegment[] = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    segments.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, startDistance: totalLength, length });
    totalLength += length;
  }
  return { points, segments, totalLength };
}

/** 取（并缓存）某配置对应的路径几何。 */
export function getPath(config: GameConfig): PathData {
  const cached = pathCache.get(config);
  if (cached) return cached;
  const built = buildPath(config);
  pathCache.set(config, built);
  return built;
}

/**
 * 按已行进距离采样路径上的坐标，写入 out（不分配）。
 * 距离会被夹到 [0, totalLength]。
 */
export function pathPointAt(path: PathData, distance: number, out: Vec2): Vec2 {
  const segments = path.segments;
  if (segments.length === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  if (distance <= 0) {
    out.x = segments[0].x0;
    out.y = segments[0].y0;
    return out;
  }
  if (distance >= path.totalLength) {
    const last = segments[segments.length - 1];
    out.x = last.x1;
    out.y = last.y1;
    return out;
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (distance <= seg.startDistance + seg.length) {
      const local = distance - seg.startDistance;
      const ratio = seg.length === 0 ? 0 : local / seg.length;
      out.x = seg.x0 + (seg.x1 - seg.x0) * ratio;
      out.y = seg.y0 + (seg.y1 - seg.y0) * ratio;
      return out;
    }
  }
  const last = segments[segments.length - 1];
  out.x = last.x1;
  out.y = last.y1;
  return out;
}

/** 便捷版本（会分配，仅用于非热路径 / 外部消费）。 */
export function pathPoint(path: PathData, distance: number): Vec2 {
  return pathPointAt(path, distance, { x: 0, y: 0 });
}
