/**
 * 展示文案与格式化辅助（纯展示层，策略与数值无关）。
 *
 * 事件/枚举的**中文名**放在这里，战斗数值一律来自后端配置——
 * 二者不可混淆：本文件只做「枚举 → 文案」映射与时间格式化。
 */
import type { TargetingMode, TowerRole, WaveState } from '../config/schema';

export const WAVE_STATE_LABEL: Readonly<Record<WaveState, string>> = {
  IDLE: '待开始',
  PREP: '备战中',
  SPAWNING: '生成中',
  ACTIVE: '进行中',
  VICTORY: '胜利',
  DEFEAT: '失败',
};

/** 状态对应的视觉语气（CSS 修饰类后缀）。 */
export const WAVE_STATE_TONE: Readonly<Record<WaveState, string>> = {
  IDLE: 'idle',
  PREP: 'prep',
  SPAWNING: 'active',
  ACTIVE: 'active',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
};

export const TARGETING_LABEL: Readonly<Record<TargetingMode, string>> = {
  FIRST: '最前',
  LAST: '最后',
  STRONGEST: '最强',
  CLOSEST: '最近',
};

export const TARGETING_HINT: Readonly<Record<TargetingMode, string>> = {
  FIRST: '优先攻击路径上走得最远的敌人（推荐，性价比最高）',
  LAST: '优先攻击刚出现的敌人，避免漏怪',
  STRONGEST: '优先攻击当前血量最高的敌人',
  CLOSEST: '优先攻击离塔最近的敌人',
};

export const TARGETING_ORDER: readonly TargetingMode[] = ['FIRST', 'LAST', 'STRONGEST', 'CLOSEST'];

export const TOWER_ROLE_LABEL: Readonly<Record<TowerRole, string>> = {
  single_target: '单体高伤',
  splash: '范围溅射',
  slow: '减速控制',
};

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 毫秒 → mm:ss。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

/** 秒（浮点）→ mm:ss。 */
export function formatSeconds(seconds: number): string {
  return formatDuration(seconds * 1000);
}

/** ISO 时间 → 本地可读；非法输入原样返回，不让展示层抛错。 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}
