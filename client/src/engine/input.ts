/**
 * 输入适配：把鼠标/键盘的原始事件翻译成「格子」与「意图」，不做任何游戏规则判断。
 * 规则判定一律在 core.applyCommand 里完成。
 */
import type { GameConfig, TileCoord, Vec2 } from '../core';

/** 逻辑坐标 → 格子；越界返回 null。 */
export function logicalToTile(config: GameConfig, point: Vec2): TileCoord | null {
  const tile = config.grid.tileSizePx;
  const col = Math.floor(point.x / tile);
  const row = Math.floor(point.y / tile);
  if (col < 0 || col >= config.grid.cols || row < 0 || row >= config.grid.rows) return null;
  return { col, row };
}

export function sameTile(a: TileCoord | null, b: TileCoord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.col === b.col && a.row === b.row;
}

/** 键盘意图（由 UI 层解释成具体命令；这里只做键 → 意图的纯映射）。 */
export type KeyIntent =
  | 'START_WAVE'
  | 'TOGGLE_PAUSE'
  | 'SPEED_1X'
  | 'SPEED_2X'
  | 'BUILD_1'
  | 'BUILD_2'
  | 'BUILD_3'
  | 'UPGRADE'
  | 'SELL'
  | 'CLEAR_SELECTION'
  | 'TARGETING_FIRST'
  | 'TARGETING_LAST'
  | 'TARGETING_STRONGEST'
  | 'TARGETING_CLOSEST';

const KEY_INTENTS: Readonly<Record<string, KeyIntent>> = {
  ' ': 'START_WAVE',
  Enter: 'START_WAVE',
  p: 'TOGGLE_PAUSE',
  P: 'TOGGLE_PAUSE',
  '1': 'BUILD_1',
  '2': 'BUILD_2',
  '3': 'BUILD_3',
  q: 'TARGETING_FIRST',
  Q: 'TARGETING_FIRST',
  w: 'TARGETING_LAST',
  W: 'TARGETING_LAST',
  e: 'TARGETING_STRONGEST',
  E: 'TARGETING_STRONGEST',
  r: 'TARGETING_CLOSEST',
  R: 'TARGETING_CLOSEST',
  u: 'UPGRADE',
  U: 'UPGRADE',
  s: 'SELL',
  S: 'SELL',
  Escape: 'CLEAR_SELECTION',
};

/** 键 → 意图。倍速用 `f`（fast）切换到 2x、`n`（normal）回 1x。 */
export function keyToIntent(key: string): KeyIntent | null {
  if (key === 'f' || key === 'F') return 'SPEED_2X';
  if (key === 'n' || key === 'N') return 'SPEED_1X';
  return KEY_INTENTS[key] ?? null;
}

/** 键盘可达性：这些键不应触发意图（例如输入框内的按键）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
