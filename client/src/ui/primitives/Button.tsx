/**
 * 基础按钮（语义化 <button> + 令牌类名 + a11y）。
 *
 * 交互状态齐备：hover / focus-visible / active / disabled / busy(loading)。
 * `disabled` 时若有 `disabledReason`，会写成 `title`，让"为什么不能点"可见
 * （frontend_design 的 disabled 带原因要求）。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** 请求进行中：置灰 + 旋转指示 + aria-busy。 */
  busy?: boolean;
  /** 被禁用/忙碌的原因（写成 title，可读）。 */
  disabledReason?: string | null;
  /** 撑满父容器宽度（侧栏操作区用）。 */
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'outlined',
  busy = false,
  disabled = false,
  disabledReason = null,
  block = false,
  className,
  children,
  type,
  ...rest
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || busy;
  const classes = ['td-btn', `td-btn--${variant}`, block ? 'td-btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      title={isDisabled && disabledReason ? disabledReason : rest.title}
    >
      {busy ? <span className="td-btn__spinner" aria-hidden="true" /> : null}
      <span className="td-btn__label">{children}</span>
    </button>
  );
}
