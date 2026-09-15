/**
 * 顶层组件：配置三态 → 游戏布局 + 弹层。
 *
 * 分层：
 *  - `ConfigProvider` 负责拿配置（loading / error / ready）；
 *  - `GameView` 负责把 GameStore（模拟）与 CanvasRenderer（渲染）接起来，
 *    并把 React 只当作「HUD + 面板」的宿主——游戏世界不放在 React 状态里，
 *    避免 60Hz 重渲染。
 *
 * React ↔ 内核的唯一通道是 `useSyncExternalStore(store.subscribe, store.getSnapshot)`，
 * 且 snapshot 是**投影**（金币/生命/波次/选中项…），签名不变则不通知。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { postRecord } from './api/records';
import { ConfigProvider, useConfig } from './config/ConfigProvider';
import type { ConfigResponse } from './config/schema';
import type { GameConfig, TileCoord, Vec2 } from './core';
import { GameStore } from './engine/GameStore';
import type { TerminalInfo } from './engine/GameStore';
import { isEditableTarget, keyToIntent, logicalToTile } from './engine/input';
import type { KeyIntent } from './engine/input';
import { CanvasRenderer } from './render/CanvasRenderer';
import { BuildPanel } from './ui/BuildPanel';
import { EndGameDialog } from './ui/EndGameDialog';
import type { RecordState } from './ui/EndGameDialog';
import { ErrorView } from './ui/ErrorView';
import { Hud } from './ui/Hud';
import { LoadingView } from './ui/LoadingView';
import { Panel } from './ui/primitives';
import { RecordsPanel } from './ui/RecordsPanel';
import { SavePanel } from './ui/SavePanel';
import { TowerDetail } from './ui/TowerDetail';
import { WaveControls } from './ui/WaveControls';

const DEV = import.meta.env.DEV;

/** 这些元素自身处理确认/方向键，全局快捷键让位，避免「按空格同时触发按钮与开始波次」。 */
const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL']);

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable;
}

/** 客户端坐标 → 逻辑坐标（画布可能被 CSS 等比缩小，必须按实际渲染尺寸换算）。 */
function clientToLogical(
  canvas: HTMLCanvasElement,
  config: GameConfig,
  clientX: number,
  clientY: number,
): Vec2 {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? config.canvas.logicWidthPx / rect.width : 1;
  const scaleY = rect.height > 0 ? config.canvas.logicHeightPx / rect.height : 1;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

/** 键盘意图 → store 动作（意图只描述"想做什么"，能不能做由内核裁决）。 */
function applyIntent(store: GameStore, config: GameConfig, intent: KeyIntent): void {
  const options = config.rules.speedOptions;
  switch (intent) {
    case 'START_WAVE':
      store.startWave();
      break;
    case 'TOGGLE_PAUSE':
      store.togglePause();
      break;
    case 'SPEED_1X':
      store.setSpeed(options[0] ?? 1);
      break;
    case 'SPEED_2X':
      store.setSpeed(options[options.length - 1] ?? 1);
      break;
    case 'BUILD_1':
    case 'BUILD_2':
    case 'BUILD_3': {
      const index = intent === 'BUILD_1' ? 0 : intent === 'BUILD_2' ? 1 : 2;
      const tower = config.towers[index];
      if (tower) store.selectBuildTower(tower.id);
      break;
    }
    case 'UPGRADE':
      store.upgradeSelected();
      break;
    case 'SELL':
      store.sellSelected();
      break;
    case 'CLEAR_SELECTION':
      store.clearSelection();
      break;
    case 'TARGETING_FIRST':
      store.setSelectedTargeting('FIRST');
      break;
    case 'TARGETING_LAST':
      store.setSelectedTargeting('LAST');
      break;
    case 'TARGETING_STRONGEST':
      store.setSelectedTargeting('STRONGEST');
      break;
    case 'TARGETING_CLOSEST':
      store.setSelectedTargeting('CLOSEST');
      break;
  }
}

function GameView({ config }: { config: ConfigResponse }): JSX.Element {
  const [store] = useState(() => new GameStore(config));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);

  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [savesOpen, setSavesOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsToken, setRecordsToken] = useState(0);

  const modalOpen = dialogOpen || savesOpen || recordsOpen;

  // 模拟循环（固定步长累加器）由 store 持有
  useEffect(() => {
    store.start();
    return () => store.dispose();
  }, [store]);

  // 渲染循环由 renderer 持有（自持 rAF，与模拟解耦）
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const renderer = new CanvasRenderer({
      canvas,
      container: stage,
      store,
      fpsElement: DEV ? fpsRef.current : null,
    });
    renderer.start();
    return () => renderer.dispose();
  }, [store]);

  // 终局：弹层 + 自动登记战绩
  useEffect(() => {
    store.setTerminalHandler((info) => {
      setTerminalInfo(info);
      setDialogOpen(true);
      setRecordState('saving');
      postRecord({
        result: info.result,
        waveReached: info.waveReached,
        livesRemaining: info.livesRemaining,
        elapsedMs: info.elapsedMs,
        configVersion: info.configVersion,
      })
        .then(() => {
          setRecordState('saved');
          setRecordsToken((value) => value + 1);
        })
        .catch(() => setRecordState('error'));
    });
    return () => store.setTerminalHandler(null);
  }, [store]);

  const restart = useCallback(() => {
    store.reset();
    setTerminalInfo(null);
    setRecordState('idle');
    setDialogOpen(false);
  }, [store]);

  // 全局快捷键（弹层打开或焦点在表单控件上时让位）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modalOpen) return;
      if (isEditableTarget(event.target) || isInteractiveTarget(event.target)) return;
      const intent = keyToIntent(event.key);
      if (!intent) return;
      if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
      applyIntent(store, config, intent);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, config, modalOpen]);

  const tileFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): TileCoord | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      return logicalToTile(config, clientToLogical(canvas, config, event.clientX, event.clientY));
    },
    [config],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      store.setHoverTile(tileFromEvent(event));
    },
    [store, tileFromEvent],
  );

  const handlePointerLeave = useCallback(() => {
    store.setHoverTile(null);
  }, [store]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      const tile = tileFromEvent(event);
      if (tile) store.handleTileClick(tile);
    },
    [store, tileFromEvent],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      store.clearSelection();
    },
    [store],
  );

  const terminal = snapshot.terminal;
  const frozen = snapshot.paused || terminal !== null;
  const frozenReason = terminal !== null ? '本局已结束' : snapshot.paused ? '暂停中，先点「继续」' : null;

  return (
    <div className="td-app">
      <Hud
        snapshot={snapshot}
        fpsRef={DEV ? fpsRef : null}
        showFps={DEV}
        onOpenSaves={() => setSavesOpen(true)}
        onOpenRecords={() => setRecordsOpen(true)}
      />

      <main className="td-main">
        <section className="td-stage" ref={stageRef} aria-label="战场">
          <canvas
            ref={canvasRef}
            className="td-canvas"
            role="img"
            tabIndex={0}
            aria-label="塔防战场画布"
            aria-describedby="td-board-help"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onPointerDown={handlePointerDown}
            onContextMenu={handleContextMenu}
          />
          <p id="td-board-help" className="td-sr-only">
            战场是 {config.grid.cols} 列 × {config.grid.rows} 行的网格，敌人沿固定路径走向基地。
            先在右侧建塔面板选择塔型，再点击棋盘空格建造；点击已建成的塔可以升级、出售或切换索敌策略。
            空格键开始波次，P 暂停，F / N 切换 2x 与 1x 速度，右键或 Esc 取消选择。
          </p>
          {snapshot.notice ? (
            <p className="td-toast" role="status">
              {snapshot.notice}
            </p>
          ) : null}
        </section>

        <aside className="td-sidebar" aria-label="操作面板">
          {/* 滚动区只包「建塔 / 塔详情」，把「波次」留在外面固定在侧栏底部：
              矮视口（PRD 最小 1280×720，乃至 390×844）下，波次控制永远在视口内可触达，
              不会像 Tester V-7-1 那样被截到折叠线以下。 */}
          <div className="td-sidebar__scroll">
            <Panel title="建塔">
              <BuildPanel
                config={config}
                gold={snapshot.gold}
                selectedTowerId={snapshot.buildTowerId}
                frozen={frozen}
                frozenReason={frozenReason}
                onSelect={(towerId) => store.selectBuildTower(towerId)}
              />
            </Panel>
            <Panel title="塔详情">
              <TowerDetail
                selected={snapshot.selected}
                gold={snapshot.gold}
                frozen={frozen}
                frozenReason={frozenReason}
                onUpgrade={() => store.upgradeSelected()}
                onSell={() => store.sellSelected()}
                onTargeting={(mode) => store.setSelectedTargeting(mode)}
              />
            </Panel>
          </div>
          <Panel title="波次">
            <WaveControls
              waveState={snapshot.waveState}
              paused={snapshot.paused}
              speedMultiplier={snapshot.speedMultiplier}
              speedOptions={config.rules.speedOptions}
              currentWave={snapshot.currentWave}
              totalWaves={snapshot.totalWaves}
              nextWaveHint={snapshot.nextWaveHint}
              terminalInfo={dialogOpen ? null : terminalInfo}
              onStart={() => store.startWave()}
              onTogglePause={() => store.togglePause()}
              onSpeed={(multiplier) => store.setSpeed(multiplier)}
              onRestart={restart}
              onShowResult={() => setDialogOpen(true)}
            />
          </Panel>
        </aside>
      </main>

      <SavePanel
        open={savesOpen}
        onClose={() => setSavesOpen(false)}
        configVersion={config.version}
        createPayload={(slot) => store.createSavePayload(slot)}
        onApply={(payload) => store.applySavePayload(payload)}
      />
      <RecordsPanel
        open={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        refreshToken={recordsToken}
      />
      {dialogOpen && terminalInfo ? (
        <EndGameDialog
          info={terminalInfo}
          recordState={recordState}
          onRestart={restart}
          onOpenRecords={() => setRecordsOpen(true)}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function GameShell(): JSX.Element {
  const { state, reload } = useConfig();

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') return <ErrorView error={state.error} onRetry={reload} />;
  // key 绑定配置版本：配置热更新后整局重挂载，避免新旧配置混用
  return <GameView key={state.config.version} config={state.config} />;
}

export default function App(): JSX.Element {
  return (
    <ConfigProvider>
      <GameShell />
    </ConfigProvider>
  );
}
