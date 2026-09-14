/**
 * 基础面板（语义化 <section>/<aside> + 标题层级 + 令牌类名）。
 *
 * 侧栏各功能块共用，保证间距 / 圆角 / 描边 / 层级全部来自设计令牌。
 */
import type { ElementType, ReactNode } from 'react';

export interface PanelProps {
  title?: ReactNode;
  /** 标题右侧的操作区（按钮组等）。 */
  actions?: ReactNode;
  /** 语义标签：侧栏用 aside，页面区块用 section。 */
  as?: Extract<ElementType, 'section' | 'aside' | 'div'>;
  /** 面板内无内边距（例如内部自带列表分隔线时）。 */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({
  title,
  actions,
  as: Tag = 'section',
  flush = false,
  className,
  children,
}: PanelProps): JSX.Element {
  const classes = ['td-panel', flush ? 'td-panel--flush' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <Tag className={classes}>
      {title || actions ? (
        <header className="td-panel__header">
          {title ? <h2 className="td-panel__title">{title}</h2> : <span />}
          {actions ? <div className="td-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="td-panel__body">{children}</div>
    </Tag>
  );
}
