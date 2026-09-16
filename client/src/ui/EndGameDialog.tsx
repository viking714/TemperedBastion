/**
 * 终局弹层：胜利 / 失败结果 + 本局统计 + 战绩登记状态 + 闯关衔接。
 *
 * 允许关闭（玩家可能想在确认前再看一眼棋盘）——关闭后侧栏会保留「本局已结束」区块
 * 与闯关入口，因此不会把玩家卡死在终局。
 *
 * 多关卡：胜利且非最后一关 → 「进入第 N+1 关」；通关最后一关 → 「从第 1 关再战」；
 * 失败 → 「重试本关」。
 */
import type { TerminalInfo } from '../engine/GameStore';
import { formatDuration } from './labels';
import { Button, Modal } from './primitives';

export type RecordState = 'idle' | 'saving' | 'saved' | 'error';

export interface EndGameDialogProps {
  info: TerminalInfo;
  recordState: RecordState;
  /** 胜利后推进：非最后一关 → 下一关；通关 → 回到第 1 关。失败时未使用。 */
  onAdvance: () => void;
  /** 失败后重试本关（保留当前关卡与地图，重新开局）。 */
  onRestart: () => void;
  onOpenRecords: () => void;
  onClose: () => void;
}

const RECORD_TEXT: Readonly<Record<RecordState, string>> = {
  idle: '本局战绩尚未登记',
  saving: '正在登记本局战绩…',
  saved: '本局战绩已登记',
  error: '战绩登记失败（后端不可用，稍后可在战绩面板重试）',
};

export function EndGameDialog({
  info,
  recordState,
  onAdvance,
  onRestart,
  onOpenRecords,
  onClose,
}: EndGameDialogProps): JSX.Element {
  const victory = info.result === 'victory';
  const isFinal = info.level >= info.totalLevels;
  const title = victory ? (isFinal ? '🏆 战役通关！' : `第 ${info.level} 关 守住！`) : '基地失守';

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="td-modal-actions">
          {victory ? (
            <Button variant="filled" onClick={onAdvance}>
              {isFinal ? '从第 1 关再战' : `进入第 ${info.level + 1} 关`}
            </Button>
          ) : (
            <Button variant="filled" onClick={onRestart}>
              重试本关
            </Button>
          )}
          <Button variant="outlined" onClick={onOpenRecords}>
            查看战绩
          </Button>
          <Button variant="text" onClick={onClose}>
            看看棋盘
          </Button>
        </div>
      }
    >
      <div className={`td-result td-result--${info.result}`}>
        <p className="td-result__headline">
          {victory
            ? isFinal
              ? '全部关卡通关，战役胜利！'
              : `${info.levelName}（第 ${info.level} 关）全部波次清空`
            : '生命耗尽，游戏结束'}
        </p>
        <dl className="td-kv-list">
          <div className="td-kv">
            <dt className="td-kv__key">关卡</dt>
            <dd className="td-kv__value">
              第 {info.level} / {info.totalLevels} 关 · {info.levelName}
            </dd>
          </div>
          <div className="td-kv">
            <dt className="td-kv__key">{victory ? '清空波次' : '到达波次'}</dt>
            <dd className="td-kv__value">第 {info.waveReached} 波</dd>
          </div>
          <div className="td-kv">
            <dt className="td-kv__key">剩余生命</dt>
            <dd className="td-kv__value">{info.livesRemaining}</dd>
          </div>
          <div className="td-kv">
            <dt className="td-kv__key">总用时</dt>
            <dd className="td-kv__value">{formatDuration(info.elapsedMs)}</dd>
          </div>
          <div className="td-kv">
            <dt className="td-kv__key">配置版本</dt>
            <dd className="td-kv__value">{info.configVersion}</dd>
          </div>
        </dl>
        <p className="td-result__record" role="status">
          {RECORD_TEXT[recordState]}
        </p>
      </div>
    </Modal>
  );
}
