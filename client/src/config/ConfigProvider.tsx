/**
 * 配置 Provider：拉取 /api/config → zod 校验 → 注入内核与 HUD。
 *
 * 三态显式建模（loading / error(可重试) / ready），由 App 分别渲染
 * LoadingView / ErrorView / 游戏布局——任何一态都不白屏（frontend_design 要求）。
 *
 * 数值唯一真源是后端 `server/config/level.json`，前端不兜底、不内置默认值：
 * 拉不到就直接报错并提供重试，避免"用了错的数值还以为是对的"。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  reload: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ConfigState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchConfig()
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
  const value = useMemo<ConfigContextValue>(() => ({ state, reload }), [state, reload]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig 必须在 <ConfigProvider> 内部使用');
  return value;
}
