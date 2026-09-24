/**
 * 配置 Provider：拉取 /api/config → zod 校验 → 注入内核与 HUD。
 *
 * 三态显式建模（loading / error(可重试) / ready），由 App 分别渲染
 * LoadingView / ErrorView / 游戏布局——任何一态都不白屏（frontend_design 要求）。
 *
 * 数值唯一真源是后端 `server/config/level.json`，前端不兜底、不内置默认值：
 * 拉不到就直接报错并提供重试，避免"用了错的数值还以为是对的"。
 *
 * 多关卡：`loadLevel(n)` 切换关卡（重新拉取对应配置，切换瞬间显示 LoadingView）。
 * 初始关卡由上层（Session 恢复流程 / URL ?level=N）通过 `initialLevel` 注入。
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

export function ConfigProvider({
  children,
  initialLevel = 1,
}: {
  children: ReactNode;
  initialLevel?: number;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  const requestedLevel = useRef(initialLevel);

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
