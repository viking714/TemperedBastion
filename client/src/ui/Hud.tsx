/**
 * HUD 顶栏：金币 / 生命 / 波次进度 / 场上敌人 / 状态 / 倍速 / 用时 + 账号与自动保存。
 *
 * 数值全部来自 GameStore 的**投影快照**（`useSyncExternalStore`）——
 * 只有快照签名变化才重渲染，因此 60Hz 的模拟推进不会拖垮 React。
 * 初始值即后端 config 的 initialGold / initialLives（AC-3）。
 */
import type { RefObject } from 'react';
import type { HudSnapshot } from '../engine/GameStore';
import { Button } from './primitives';
import { WAVE_STATE_LABEL, WAVE_STATE_TONE, formatSeconds } from './labels';

/** 自动保存状态语气（HUD 角标配色）。 */
export type AutoSaveTone = 'idle' | 'busy' | 'ok' | 'error';

export interface HudProps {
  snapshot: HudSnapshot;
  /** 开发期 FPS 文本挂载点（生产模式传 null）。 */
  fpsRef: RefObject<HTMLSpanElement> | null;
  showFps: boolean;
  /** 当前登录用户名（多用户隔离的可见标识）。 */
  username: string;
  onLogout: () => void;
  onOpenRecords: () => void;
  /** 自动保存状态文案（如「已自动保存 20:31:05」）。 */
  autoSaveText: string;
  autoSaveTone: AutoSaveTone;
}

interface StatProps {
  label: string;
  value: string;
  tone?: string;
}

function Stat({ label, value, tone }: StatProps): JSX.Element {
  return (
    <div className={['td-stat', tone ? `td-stat--${tone}` : ''].filter(Boolean).join(' ')}>
      <span className="td-stat__label">{label}</span>
      <span className="td-stat__value">{value}</span>
    </div>
  );
}

export function Hud({
  snapshot,
  fpsRef,
  showFps,
  username,
  onLogout,
  onOpenRecords,
  autoSaveText,
  autoSaveTone,
}: HudProps): JSX.Element {
  const tone = WAVE_STATE_TONE[snapshot.waveState];
  const waveValue =
    snapshot.currentWave > 0
      ? `${snapshot.currentWave} / ${snapshot.totalWaves}`
      : `0 / ${snapshot.totalWaves}`;
  const statusText =
    snapshot.waveState === 'PREP'
      ? `${WAVE_STATE_LABEL.PREP} ${snapshot.prepRemainingSec.toFixed(1)}s`
      : WAVE_STATE_LABEL[snapshot.waveState];

  return (
    <header className="td-hud">
      <div className="td-hud__brand">
        <span className="td-hud__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img" aria-label="carrot">
            <path d="M12 3 L13.6 8 L10.4 8 Z" style={{ fill: 'var(--md-sys-color-secondary)' }} />
            <path d="M8.5 4.5 L10.6 9 L6.8 9 Z" style={{ fill: 'var(--md-sys-color-secondary)' }} />
            <path d="M15.5 4.5 L17.2 9 L13.4 9 Z" style={{ fill: 'var(--md-sys-color-secondary-container)' }} />
            <path d="M12 8 L6.5 21 L17.5 21 Z" style={{ fill: 'var(--td-canvas-base)' }} />
            <path
              d="M10.6 11.5 H13.4 M9.6 14.5 H14.4 M8.6 17.5 H15.4"
              style={{
                stroke: 'var(--md-sys-color-on-surface)',
                strokeWidth: 1,
                opacity: 0.22,
                fill: 'none',
                strokeLinecap: 'round',
              }}
            />
          </svg>
        </span>
        <div>
          <h1 className="td-hud__title">淬炼塔防</h1>
          <p className="td-hud__subtitle">
            {snapshot.levelName} · 配置版本 {snapshot.configVersion}
          </p>
        </div>
      </div>

      <div className="td-hud__stats">
        <Stat label="关卡" value={`第 ${snapshot.level} / ${snapshot.totalLevels} 关`} />
        <Stat label="金币" value={String(snapshot.gold)} />
        <Stat label="生命" value={String(snapshot.lives)} tone={snapshot.lives <= 5 ? 'danger' : undefined} />
        <Stat label="波次" value={waveValue} />
        <Stat label="场上敌人" value={String(snapshot.remainingEnemies)} />
        <Stat label="用时" value={formatSeconds(snapshot.elapsedSec)} />
        <Stat label="倍速" value={`${snapshot.speedMultiplier}x`} />
      </div>

      <div className="td-hud__actions">
        <span className={`td-chip td-chip--${tone}`} role="status">
          {statusText}
        </span>
        <span
          className={`td-autosave td-autosave--${autoSaveTone}`}
          role="status"
          title="进度会自动保存到你的账号（无需手动操作）"
        >
          {autoSaveText}
        </span>
        {showFps && fpsRef ? (
          <span className="td-fps" ref={fpsRef} aria-hidden="true">
            -- FPS
          </span>
        ) : null}
        <span className="td-chip td-chip--user" title="当前账号（进度与战绩按账号隔离）">
          {username}
        </span>
        <Button variant="tonal" onClick={onOpenRecords}>
          战绩
        </Button>
        <Button variant="text" onClick={onLogout}>
          退出
        </Button>
      </div>
    </header>
  );
}
