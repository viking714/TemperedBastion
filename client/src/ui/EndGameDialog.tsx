/**
 * 终局弹层：胜利 / 失败结果 + 本局统计 + 战绩登记状态。
 *
 * 允许关闭（玩家可能想在确认前再看一眼棋盘）——关闭后侧栏会保留「本局已结束」区块
 * 与「再来一局」入口，因此不会把玩家卡死在终局。
 */
import type { TerminalInfo } from '../engine/GameStore';
import { formatDuration } from './labels';
import { Button, Modal } from './primitives';

export type RecordState = 'idle' | 'saving' | 'saved' | 'error';

export interface EndGameDialogProps {
  info: TerminalInfo;
  recordState: RecordState;
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
  onRestart,
  onOpenRecords,
  onClose,
}: EndGameDialogProps): JSX.Element {
  const victory = info.result === 'victory';

  return (
    <Modal
      title={victory ? '守住了！' : '基地失守'}
      onClose={onClose}
      footer={
        <div className="td-modal-actions">
          <Button variant="filled" onClick={onRestart}>
            再来一局
          </Button>
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
        <p className="td-result__headline">{victory ? '全部波次清空' : '生命耗尽，游戏结束'}</p>
        <dl className="td-kv-list">
          <div className="td-kv">
            <dt className="td-kv__key">到达波次</dt>
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
