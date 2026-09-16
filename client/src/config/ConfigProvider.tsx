/**
 * 配置 Provider：拉取 /api/config → zod 校验 → 注入内核与 HUD。
 *
 * 三态显式建模（loading / error(可重试) / ready），由 App 分别渲染
 * LoadingView / ErrorView / 游戏布局——任何一态都不白屏（frontend_design 要求）。
 *
 * 数值唯一真源是后端 `server/config/level.json`，前端不兜底、不内置默认值：
 * 拉不到就直接报错并提供重试，避免"用了错的数值还以为是对的"。
 *
 * 多关卡：`loadLevel(n)` 切换关卡（重新拉取对应配置，切换瞬间显示 LoadingView）；
 * URL 上的 `?level=N` 可作为初始关卡（方便测试与分享直达某关）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { describeApiError } from '../api/client';
import type { ApiFailure } from '../api/client';
import { fetchConfig } from '../api/config';
import type { ConfigResponse } from './schema';

export type ConfigState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiFailure }
  | { status: 'ready'; config: ConfigResponse };

export interface ConfigContextValue {
  state: ConfigState;
  /** 重试当前目标关卡（错误态）。 */
  reload: () => void;
  /** 切换到指定关卡（会重新拉取该关配置）。 */
  loadLevel: (level: number) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/** URL ?level=N（正整数）作为初始关卡；非法值回退到第 1 关。 */
function initialLevelFromUrl(): number {
  if (typeof window === 'undefined') return 1;
  const raw = new URLSearchParams(window.location.search).get('level');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function ConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  const requestedLevel = useRef(initialLevelFromUrl());

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchConfig(requestedLevel.current)
      .then((config) => {
        if (!cancelled) setState({ status: 'ready', config });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const loadLevel = useCallback((level: number) => {
    requestedLevel.current = level;
    setAttempt((value) => value + 1);
  }, []);
  const value = useMemo<ConfigContextValue>(
    () => ({ state, reload, loadLevel }),
    [state, reload, loadLevel],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig 必须在 <ConfigProvider> 内部使用');
  return value;
}
