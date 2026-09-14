/**
 * 波次控制：开始 / 提前开始、暂停、1x·2x 倍速、波次进度。
 *
 * 状态映射（对应 frontend_design 的波次控制表）：
 *  - IDLE ：「开始」可点；
 *  - PREP ：「提前开始」可点（倒计时由 HUD 显示）；
 *  - SPAWNING / ACTIVE：「开始」置灰并说明"本波正在进行"，仅暂停 / 倍速可用；
 *  - paused：字符串与按钮文案切换为「继续」；
 *  - victory / defeat：开始与暂停全部置灰。
 */
import type { WaveState } from '../config/schema';
import type { TerminalInfo } from '../engine/GameStore';
import { Button } from './primitives';
import { WAVE_STATE_LABEL } from './labels';

export interface WaveControlsProps {
  waveState: WaveState;
  paused: boolean;
  speedMultiplier: number;
  speedOptions: number[];
  currentWave: number;
  totalWaves: number;
  nextWaveHint: string | null;
  /** 非空表示本局已结束（弹层被关掉后仍提供「再来一局 / 查看结果」入口）。 */
  terminalInfo: TerminalInfo | null;
  onStart: () => void;
  onTogglePause: () => void;
  onSpeed: (multiplier: number) => void;
  onRestart: () => void;
  onShowResult: () => void;
}

export function WaveControls({
  waveState,
  paused,
  speedMultiplier,
  speedOptions,
  currentWave,
  totalWaves,
  nextWaveHint,
  terminalInfo,
  onStart,
  onTogglePause,
  onSpeed,
  onRestart,
  onShowResult,
}: WaveControlsProps): JSX.Element {
  const terminal = waveState === 'VICTORY' || waveState === 'DEFEAT';
  const canStart = (waveState === 'IDLE' || waveState === 'PREP') && !terminal && !paused;
  const startReason = terminal
    ? '本局已结束'
    : paused
      ? '暂停中，先点「继续」'
      : '本波正在进行';

  const percent = totalWaves > 0 ? Math.min(100, Math.round((currentWave / totalWaves) * 100)) : 0;

  return (
    <div className="td-wave">
      {terminalInfo ? (
        <div className={`td-terminal td-terminal--${terminalInfo.result}`} role="status">
          <p className="td-terminal__text">
            本局已结束：{terminalInfo.result === 'victory' ? '胜利' : '失败'} · 到达第{' '}
            {terminalInfo.waveReached} 波
          </p>
          <div className="td-wave__row">
            <Button variant="filled" onClick={onRestart}>
              再来一局
            </Button>
            <Button variant="outlined" onClick={onShowResult}>
              查看结果
            </Button>
          </div>
        </div>
      ) : null}

      <div
        className="td-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`波次进度 ${currentWave} / ${totalWaves}`}
      >
        <div className="td-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="td-wave__status">
        当前状态：<strong>{WAVE_STATE_LABEL[waveState]}</strong>
        {paused ? '（已暂停）' : ''}
      </p>
      {nextWaveHint ? <p className="td-wave__hint">{nextWaveHint}</p> : null}

      <div className="td-wave__actions">
        <Button
          variant="filled"
          block
          disabled={!canStart}
          disabledReason={canStart ? null : startReason}
          onClick={onStart}
        >
          {waveState === 'PREP' ? '提前开始本波' : '开始下一波'}
        </Button>

        <div className="td-wave__row">
          <Button
            variant="outlined"
            disabled={terminal}
            disabledReason="本局已结束"
            aria-pressed={paused}
            onClick={onTogglePause}
          >
            {paused ? '继续' : '暂停'}
          </Button>
          <div className="td-segmented" role="group" aria-label="游戏速度">
            {speedOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={['td-segmented__item', speedMultiplier === option ? 'is-selected' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={speedMultiplier === option}
                onClick={() => onSpeed(option)}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="td-hint">快捷键：空格 开始 / P 暂停 / F 2x / N 1x</p>
    </div>
  );
}
