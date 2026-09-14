/**
 * 轻量 Tooltip：纯 CSS 实现（`data-tooltip` + `::after`），无 JS、无定位库。
 *
 * 键盘可达：`:focus-within` 同样触发提示，因此 Tab 聚焦内部控件时提示可见
 * （frontend_design 的「键盘可达 + focus 可见」要求）。
 *
 * 注意：提示文本只是**补充**信息，主信息不能只存在于 tooltip 里
 * （否则触屏与读屏用户拿不到），因此这里同时提供 `aria-label` 兜底。
 */
import type { ReactNode } from 'react';

export interface TooltipProps {
  text: string;
  /** 是否把提示同时作为 aria-label（内部无文本控件时建议开启）。 */
  asLabel?: boolean;
  className?: string;
  children: ReactNode;
}

export function Tooltip({ text, asLabel = false, className, children }: TooltipProps): JSX.Element {
  return (
    <span
      className={['td-tooltip', className ?? ''].filter(Boolean).join(' ')}
      data-tooltip={text}
      aria-label={asLabel ? text : undefined}
    >
      {children}
    </span>
  );
}
