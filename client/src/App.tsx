/**
 * 顶层组件：认证门（注册/登录）→ 会话恢复（自动存档）→ 配置三态 → 游戏布局 + 弹层。
 *
 * 分层：
 *  - `AuthGate` 检查登录态（GET /api/auth/me），未登录渲染 `AuthView`；
 *  - `Session` 拉取当前账号的自动存档，决定从第几关开始（胜利后续下一关 / 失败重开本关）；
 *  - `ConfigProvider` 负责拿配置（loading / error / ready）；
 *  - `GameView` 负责把 GameStore（模拟）与 CanvasRenderer（渲染）接起来，
 *    并把 React 只当作「HUD + 面板」的宿主——游戏世界不放在 React 状态里，
 *    避免 60Hz 重渲染。
 *
 * 自动保存（取代旧的手动存档）：5s 节流 + 波次/关卡变化即存 + 页面隐藏/卸载补存；
 * 存档按账号隔离（服务端 /api/autosave，每用户一行）。
 *
 * React ↔ 内核的唯一通道是 `useSyncExternalStore(store.subscribe, store.getSnapshot)`，
 * 且 snapshot 是**投影**（金币/生命/波次/选中项…），签名不变则不通知。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { fetchMe, logout } from './api/auth';
import { fetchAutoSave, writeAutoSave, writeAutoSaveKeepalive } from './api/autosave';
import { postRecord } from './api/records';
import { ConfigProvider, useConfig } from './config/ConfigProvider';
import type { AuthUser, ConfigResponse, SavePayload } from './config/schema';
import type { GameConfig, TileCoord, Vec2 } from './core';
import { GameStore } from './engine/GameStore';
import type { TerminalInfo } from './engine/GameStore';
import { isEditableTarget, keyToIntent, logicalToTile } from './engine/input';
import type { KeyIntent } from './engine/input';
import { CanvasRenderer } from './render/CanvasRenderer';
import { AuthView } from './ui/AuthView';
import { BuildPanel } from './ui/BuildPanel';
import { EndGameDialog } from './ui/EndGameDialog';
import type { RecordState } from './ui/EndGameDialog';
import { ErrorView } from './ui/ErrorView';
import { Hud } from './ui/Hud';
import type { AutoSaveTone } from './ui/Hud';
import { LoadingView } from './ui/LoadingView';
import { Panel } from './ui/primitives';
import { RecordsPanel } from './ui/RecordsPanel';
import { TowerDetail } from './ui/TowerDetail';
import { WaveControls } from './ui/WaveControls';

const DEV = import.meta.env.DEV;

/** 自动保存节流间隔（毫秒）：常态 5s 一次；波次/关卡变化与页面隐藏/卸载会立即补存。 */
const AUTOSAVE_INTERVAL_MS = 5000;

/** 这些元素自身处理确认/方向键，全局快捷键让位，避免「按空格同时触发按钮与开始波次」。 */
const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL']);

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable;
}

/** URL ?level=N（正整数）：调试 / 分享直达某关；优先于自动存档恢复。 */
function levelFromUrl(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('level');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
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

interface GameViewProps {
  config: ConfigResponse;
  /** 切换关卡（重新拉取该关配置并整局重挂载）。 */
  onChangeLevel: (level: number) => void;
  /** 会话恢复时挂起的存档（配置切到目标关卡后自动应用）。 */
  pendingSave: SavePayload | null;
  onConsumePendingSave: () => void;
  username: string;
  onLogout: () => void;
}

function GameView({
  config,
  onChangeLevel,
  pendingSave,
  onConsumePendingSave,
  username,
  onLogout,
}: GameViewProps): JSX.Element {
  const [store] = useState(() => new GameStore(config));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);

  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsToken, setRecordsToken] = useState(0);

  const [saveStatus, setSaveStatus] = useState<{ tone: AutoSaveTone; at: number | null }>({
    tone: 'idle',
    at: null,
  });

  const modalOpen = dialogOpen || recordsOpen;

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

  // 会话恢复：以目标关卡配置挂载后，在首帧应用挂起的存档。
  useEffect(() => {
    if (!pendingSave || pendingSave.level !== config.campaign.level) return;
    store.applySavePayload(pendingSave);
    onConsumePendingSave();
  }, [pendingSave, config, store, onConsumePendingSave]);

  // ---------------------------------------------------------------------------
  // 自动保存（按账号隔离，服务端单行 upsert）
  // ---------------------------------------------------------------------------

  const saveRef = useRef({ inFlight: false, queued: false });

  const saveNow = useCallback(
    (viaKeepalive = false) => {
      if (viaKeepalive) {
        writeAutoSaveKeepalive(store.createSavePayload());
        return;
      }
      const ref = saveRef.current;
      if (ref.inFlight) {
        ref.queued = true;
        return;
      }
      ref.inFlight = true;
      setSaveStatus((current) => ({ tone: 'busy', at: current.at }));
      writeAutoSave(store.createSavePayload())
        .then(() => setSaveStatus({ tone: 'ok', at: Date.now() }))
        .catch(() => setSaveStatus({ tone: 'error', at: Date.now() }))
        .finally(() => {
          ref.inFlight = false;
          if (ref.queued) {
            ref.queued = false;
            saveNow();
          }
        });
    },
    [store],
  );

  useEffect(() => {
    const timer = window.setInterval(() => saveNow(), AUTOSAVE_INTERVAL_MS);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    const onBeforeUnload = (): void => saveNow(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [saveNow]);

  // 波次/状态推进到关键节点（开始、清空、终局）立即补存一记。
  const waveTag = `${snapshot.currentWave}|${snapshot.waveState}`;
  useEffect(() => {
    saveNow();
  }, [waveTag, saveNow]);

  const autoSaveText =
    saveStatus.tone === 'busy'
      ? '自动保存中…'
      : saveStatus.tone === 'error'
        ? '自动保存失败（稍后自动重试）'
        : saveStatus.at !== null
          ? `已自动保存 ${new Date(saveStatus.at).toLocaleTimeString('zh-CN', { hour12: false })}`
          : '自动保存已开启';

  // ---------------------------------------------------------------------------
  // 终局与关卡流转
  // ---------------------------------------------------------------------------

  useEffect(() => {
    store.setTerminalHandler((info) => {
      setTerminalInfo(info);
      setDialogOpen(true);
      setRecordState('saving');
      postRecord({
        result: info.result,
        level: info.level,
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

  const advanceFromTerminal = useCallback(() => {
    if (config.campaign.level < config.campaign.totalLevels) {
      onChangeLevel(config.campaign.level + 1);
    } else {
      onChangeLevel(1);
    }
  }, [config, onChangeLevel]);

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
        username={username}
        onLogout={onLogout}
        onOpenRecords={() => setRecordsOpen(true)}
        autoSaveText={autoSaveText}
        autoSaveTone={saveStatus.tone}
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
            onPointerCancel={handlePointerLeave}
            onPointerDown={handlePointerDown}
            onContextMenu={handleContextMenu}
          />
          <p id="td-board-help" className="td-sr-only">
            战场是 {config.grid.cols} 列 × {config.grid.rows} 行的网格，敌人沿固定路径走向基地。
            先在右侧建塔面板选择塔型，再点击棋盘空格建造；点击已建成的塔可以升级、出售或切换索敌策略。
            空格键开始波次，P 暂停，F / N 切换 2x 与 1x 速度，右键或 Esc 取消选择。
          </p>
          <p className="td-touch-tip">
            触屏：先点「建塔」选塔型 → 点棋盘建造；点已有塔查看/升级；点「✕ 取消选择」退出建塔模式。
          </p>
          {snapshot.buildTowerId !== null || snapshot.selected !== null ? (
            <button
              type="button"
              className="td-btn td-btn--tonal td-stage-cancel"
              onClick={() => store.clearSelection()}
            >
              ✕ 取消选择
            </button>
          ) : null}
          {snapshot.notice ? (
            <p className="td-toast" role="status">
              {snapshot.notice}
            </p>
          ) : null}
        </section>

        <aside className="td-sidebar" aria-label="操作面板">
          {/* 滚动区只包「建塔 / 塔详情」，把「波次」留在外面固定在侧栏底部：
              矮视口（PRD 最小 1280×720，乃至 390×844）下，波次控制永远在视口内可触达。 */}
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
              onAdvance={advanceFromTerminal}
              onShowResult={() => setDialogOpen(true)}
            />
          </Panel>
        </aside>
      </main>

      <RecordsPanel
        open={recordsOpen}
        onClose={() => setRecordsOpen(false)}
        refreshToken={recordsToken}
      />
      {dialogOpen && terminalInfo ? (
        <EndGameDialog
          info={terminalInfo}
          recordState={recordState}
          onAdvance={advanceFromTerminal}
          onRestart={restart}
          onOpenRecords={() => setRecordsOpen(true)}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface GameShellProps {
  user: AuthUser;
  onLogout: () => void;
  pendingSave: SavePayload | null;
}

function GameShell({ user, onLogout, pendingSave: initialPendingSave }: GameShellProps): JSX.Element {
  const { state, reload, loadLevel } = useConfig();
  const [pendingSave, setPendingSave] = useState<SavePayload | null>(initialPendingSave);

  if (state.status === 'loading') return <LoadingView />;
  if (state.status === 'error') return <ErrorView error={state.error} onRetry={reload} />;
  // key 绑定「配置版本 + 关卡」：配置热更新或切换关卡后整局重挂载，避免新旧配置混用
  return (
    <GameView
      key={`${state.config.version}:${state.config.campaign.level}`}
      config={state.config}
      onChangeLevel={loadLevel}
      pendingSave={pendingSave}
      onConsumePendingSave={() => setPendingSave(null)}
      username={user.username}
      onLogout={onLogout}
    />
  );
}

// ---------------------------------------------------------------------------
// 会话恢复：登录后先取自动存档，决定初始关卡
// ---------------------------------------------------------------------------

type ResumeState =
  | { status: 'loading' }
  | { status: 'ready'; level: number; payload: SavePayload | null };

interface SessionProps {
  user: AuthUser;
  onLogout: () => void;
}

function Session({ user, onLogout }: SessionProps): JSX.Element {
  const [resume, setResume] = useState<ResumeState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const urlLevel = levelFromUrl();
    fetchAutoSave()
      .then((out) => {
        if (cancelled) return;
        // 调试深链优先：?level=N 直达该关（不套用自动存档）。
        if (urlLevel !== null) {
          setResume({ status: 'ready', level: urlLevel, payload: null });
          return;
        }
        if (!out) {
          setResume({ status: 'ready', level: 1, payload: null });
          return;
        }
        const payload = out.payload;
        if (payload.waveState === 'VICTORY') {
          // 打完一关并退出：直接续到下一关（最后一关则从头再战）。
          const next = payload.level + 1 <= out.totalLevels ? payload.level + 1 : 1;
          setResume({ status: 'ready', level: next, payload: null });
        } else if (payload.waveState === 'DEFEAT') {
          // 上一局失败：重开本关（保留关卡身份，不继承失败现场）。
          setResume({ status: 'ready', level: payload.level, payload: null });
        } else {
          setResume({ status: 'ready', level: payload.level, payload });
        }
      })
      .catch(() => {
        // 读取失败（网络抖动等）：不阻断游戏，从第 1 关（或 URL 指定关）开始。
        if (!cancelled) setResume({ status: 'ready', level: urlLevel ?? 1, payload: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (resume.status === 'loading') return <LoadingView message="正在读取你的自动存档…" />;
  return (
    <ConfigProvider initialLevel={resume.level}>
      <GameShell user={user} onLogout={onLogout} pendingSave={resume.payload} />
    </ConfigProvider>
  );
}

// ---------------------------------------------------------------------------
// 认证门：检查登录态 → 登录/注册 或 进入游戏
// ---------------------------------------------------------------------------

type AuthState = { status: 'checking' } | { status: 'anonymous' } | { status: 'ready'; user: AuthUser };

function AuthGate(): JSX.Element {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (!cancelled) setAuth(user ? { status: 'ready', user } : { status: 'anonymous' });
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'anonymous' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthed = useCallback((user: AuthUser) => setAuth({ status: 'ready', user }), []);
  const handleLogout = useCallback(() => {
    void logout().finally(() => setAuth({ status: 'anonymous' }));
  }, []);

  if (auth.status === 'checking') return <LoadingView message="正在检查登录状态…" />;
  if (auth.status === 'anonymous') return <AuthView onAuthed={handleAuthed} />;
  return <Session key={auth.user.id} user={auth.user} onLogout={handleLogout} />;
}

export default function App(): JSX.Element {
  return <AuthGate />;
}
