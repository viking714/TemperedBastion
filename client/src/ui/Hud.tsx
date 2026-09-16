/**
 * HUD 顶栏：金币 / 生命 / 波次进度 / 场上敌人 / 状态 / 倍速 / 用时 + 全局入口。
 *
 * 数值全部来自 GameStore 的**投影快照**（`useSyncExternalStore`）——
 * 只有快照签名变化才重渲染，因此 60Hz 的模拟推进不会拖垮 React。
 * 初始值即后端 config 的 initialGold / initialLives（AC-3）。
 */
import type { RefObject } from 'react';
import type { HudSnapshot } from '../engine/GameStore';
import { Button } from './primitives';
import { WAVE_STATE_LABEL, WAVE_STATE_TONE, formatSeconds } from './labels';

export interface HudProps {
  snapshot: HudSnapshot;
  /** 开发期 FPS 文本挂载点（生产模式传 null）。 */
  fpsRef: RefObject<HTMLSpanElement> | null;
  showFps: boolean;
  onOpenSaves: () => void;
  onOpenRecords: () => void;
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

export function Hud({ snapshot, fpsRef, showFps, onOpenSaves, onOpenRecords }: HudProps): JSX.Element {
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
        <span className="td-hud__logo" aria-hidden="true" />
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
        {showFps && fpsRef ? (
          <span className="td-fps" ref={fpsRef} aria-hidden="true">
            -- FPS
          </span>
        ) : null}
        <Button variant="tonal" onClick={onOpenSaves}>
          存档
        </Button>
        <Button variant="tonal" onClick={onOpenRecords}>
          战绩
        </Button>
      </div>
    </header>
  );
}
