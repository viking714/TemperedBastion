/**
 * 存档面板（模态）：读 / 写单个槽位（AC-4a）。
 *
 * 数据三态齐备：loading / empty(该槽无存档) / error(可重试) / ready(摘要 + 读档 + 覆盖)。
 * 写档进行中会锁住关闭按钮（`busy`），避免请求悬空。
 *
 * 配置版本不一致时给出显式警告——存档里的塔/敌人数值是按旧配置存的，
 * 换配置后读档虽然不崩（内核会丢弃未知 id），但数值语义可能已变。
 */
import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../api/client';
import { DEFAULT_SLOT, fetchSave, isSaveNotFound, writeSave } from '../api/saves';
import type { SavePayload } from '../config/schema';
import { WAVE_STATE_LABEL, formatDateTime, formatDuration } from './labels';
import { Button, Modal } from './primitives';

export interface SavePanelProps {
  open: boolean;
  onClose: () => void;
  slot?: number;
  configVersion: string;
  createPayload: (slot: number) => SavePayload;
  onApply: (payload: SavePayload) => void;
}

type PanelState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payload: SavePayload };

function isTerminalSave(payload: SavePayload): boolean {
  return payload.waveState === 'VICTORY' || payload.waveState === 'DEFEAT';
}

export function SavePanel({
  open,
  onClose,
  slot = DEFAULT_SLOT,
  configVersion,
  createPayload,
  onApply,
}: SavePanelProps): JSX.Element | null {
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    setFlash(null);
    fetchSave(slot)
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isSaveNotFound(error)) setState({ status: 'empty' });
        else setState({ status: 'error', message: describeApiError(error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, slot, attempt]);

  const handleWrite = useCallback(() => {
    setBusy(true);
    setFlash(null);
    writeSave(createPayload(slot), slot)
      .then((response) => {
        setFlash(`已保存（更新于 ${formatDateTime(response.updatedAt)}）`);
        setAttempt((value) => value + 1);
      })
      .catch((error: unknown) => setFlash(`保存失败：${describeApiError(error).message}`))
      .finally(() => setBusy(false));
  }, [createPayload, slot]);

  const handleApply = useCallback(
    (payload: SavePayload) => {
      onApply(payload);
      onClose();
    },
    [onApply, onClose],
  );

  if (!open) return null;

  return (
    <Modal title={`存档 · 槽位 ${slot}`} onClose={onClose} closeable={!busy}>
      <div className="td-save">
        {state.status === 'loading' ? (
          <p className="td-state td-state--loading" role="status">
            <span className="td-spinner" aria-hidden="true" /> 正在读取存档…
          </p>
        ) : null}

        {state.status === 'error' ? (
          <div className="td-state td-state--error" role="alert">
            <p>读取存档失败：{state.message}</p>
            <Button variant="tonal" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </Button>
          </div>
        ) : null}

        {state.status === 'empty' ? (
          <p className="td-state td-state--empty">
            该槽位还没有存档。点击下方按钮把当前局面存进去。
          </p>
        ) : null}

        {state.status === 'ready' ? (
          <dl className="td-kv-list">
            <div className="td-kv">
              <dt className="td-kv__key">保存时间</dt>
              <dd className="td-kv__value">{formatDateTime(state.payload.savedAt)}</dd>
            </div>
            <div className="td-kv">
              <dt className="td-kv__key">金币 / 生命</dt>
              <dd className="td-kv__value">
                {state.payload.gold} / {state.payload.lives}
              </dd>
            </div>
            <div className="td-kv">
              <dt className="td-kv__key">波次</dt>
              <dd className="td-kv__value">
                第 {state.payload.currentWave} 波 · {WAVE_STATE_LABEL[state.payload.waveState]}
              </dd>
            </div>
            <div className="td-kv">
              <dt className="td-kv__key">已用时</dt>
              <dd className="td-kv__value">{formatDuration(state.payload.elapsedMs)}</dd>
            </div>
            <div className="td-kv">
              <dt className="td-kv__key">塔 / 敌人</dt>
              <dd className="td-kv__value">
                {state.payload.towers.length} 座 / {state.payload.enemies.length} 只
              </dd>
            </div>
            <div className="td-kv">
              <dt className="td-kv__key">配置版本</dt>
              <dd className="td-kv__value">{state.payload.configVersion}</dd>
            </div>
          </dl>
        ) : null}

        {state.status === 'ready' && state.payload.configVersion !== configVersion ? (
          <p className="td-warning" role="alert">
            存档的配置版本（{state.payload.configVersion}）与当前配置（{configVersion}）不一致，
            读档后部分塔或敌人可能按新配置结算。
          </p>
        ) : null}

        {state.status === 'ready' && isTerminalSave(state.payload) ? (
          <p className="td-warning" role="alert">
            该存档处于已结束状态（{WAVE_STATE_LABEL[state.payload.waveState]}），读档后无法继续游玩。
          </p>
        ) : null}

        {flash ? (
          <p className="td-flash" role="status">
            {flash}
          </p>
        ) : null}
      </div>

      <div className="td-modal-actions">
        <Button variant="outlined" busy={busy} onClick={handleWrite}>
          {state.status === 'ready' ? '覆盖存档' : '存入该槽位'}
        </Button>
        {state.status === 'ready' ? (
          <Button
            variant="filled"
            disabled={isTerminalSave(state.payload)}
            disabledReason="该存档已结束，无法继续"
            onClick={() => handleApply(state.payload)}
          >
            读取并继续
          </Button>
        ) : null}
        <Button variant="text" disabled={busy} disabledReason="保存进行中" onClick={onClose}>
          取消
        </Button>
      </div>
    </Modal>
  );
}
