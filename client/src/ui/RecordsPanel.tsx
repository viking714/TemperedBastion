/**
 * 战绩面板（模态）：查询历史对局（AC-4b）。
 *
 * 数据三态齐备：loading / empty(暂无战绩) / error(可重试) / ready(列表)。
 * 列表字段全部来自后端记录（结果 / 到达波次 / 剩余生命 / 用时 / 时间戳）。
 */
import { useEffect, useState } from 'react';
import { describeApiError } from '../api/client';
import { DEFAULT_RECORD_LIMIT, fetchRecords } from '../api/records';
import type { RecordList } from '../config/schema';
import { formatDateTime, formatDuration } from './labels';
import { Button, Modal } from './primitives';

export interface RecordsPanelProps {
  open: boolean;
  onClose: () => void;
  /** 值变化时自动重新拉取（例如刚登记完一局）。 */
  refreshToken?: number;
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; list: RecordList };

export function RecordsPanel({ open, onClose, refreshToken = 0 }: RecordsPanelProps): JSX.Element | null {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchRecords(DEFAULT_RECORD_LIMIT)
      .then((list) => {
        if (!cancelled) setState({ status: 'ready', list });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: describeApiError(error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt, refreshToken]);

  if (!open) return null;

  return (
    <Modal title="战绩" onClose={onClose}>
      <div className="td-records">
        {state.status === 'loading' ? (
          <p className="td-state td-state--loading" role="status">
            <span className="td-spinner" aria-hidden="true" /> 正在拉取战绩…
          </p>
        ) : null}

        {state.status === 'error' ? (
          <div className="td-state td-state--error" role="alert">
            <p>拉取战绩失败：{state.message}</p>
            <Button variant="tonal" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </Button>
          </div>
        ) : null}

        {state.status === 'ready' && state.list.items.length === 0 ? (
          <p className="td-state td-state--empty">暂无战绩。打完一局（胜利或失败）就会自动记录下来。</p>
        ) : null}

        {state.status === 'ready' && state.list.items.length > 0 ? (
          <>
            <p className="td-records__total">共 {state.list.total} 条记录，显示最近 {state.list.items.length} 条</p>
            <ol className="td-records__list">
              {state.list.items.map((item) => (
                <li key={item.id} className="td-record">
                  <span className={`td-record__result td-record__result--${item.result}`}>
                    {item.result === 'victory' ? '胜利' : '失败'}
                  </span>
                  <span className="td-record__main">第 {item.waveReached} 波</span>
                  <span className="td-record__meta">
                    剩余生命 {item.livesRemaining} · 用时 {formatDuration(item.elapsedMs)}
                  </span>
                  <span className="td-record__time">{formatDateTime(item.createdAt)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>

      <div className="td-modal-actions">
        <Button variant="outlined" onClick={() => setAttempt((value) => value + 1)}>
          刷新
        </Button>
        <Button variant="text" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  );
}
