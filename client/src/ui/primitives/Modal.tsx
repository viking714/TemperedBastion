/**
 * 模态对话框（`role="dialog"` + `aria-modal` + 标题关联 + Esc 关闭 + 焦点圈闭）。
 *
 * 无障碍要点：
 *  - 打开时把焦点移入对话框，关闭后归还给打开它的元素；
 *  - Tab / Shift+Tab 在对话框内循环，不会跑到背后的游戏界面；
 *  - Esc 关闭（`closeable=false` 时可用于"请求进行中"锁住）；
 *  - 点击遮罩关闭，但点击对话框本体不关闭。
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Button } from './Button';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 是否允许关闭（Esc / 遮罩 / 关闭按钮）。 */
  closeable?: boolean;
}

export function Modal({ title, onClose, children, footer, closeable = true }: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialogRef.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? node).focus();
    }
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        // 阻断冒泡，避免同时触发全局快捷键（例如 Esc = 取消选中）
        event.stopPropagation();
        if (closeable) onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeable, onClose],
  );

  return (
    <div
      className="td-modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeable) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="td-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="td-modal__header">
          <h2 className="td-modal__title" id={titleId}>
            {title}
          </h2>
          <Button
            variant="text"
            onClick={onClose}
            disabled={!closeable}
            disabledReason="请求进行中，请稍候"
            aria-label="关闭对话框"
          >
            关闭
          </Button>
        </header>
        <div className="td-modal__body">{children}</div>
        {footer ? <footer className="td-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
