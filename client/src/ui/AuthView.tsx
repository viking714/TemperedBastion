/**
 * 登录 / 注册视图（未登录时的入口）。
 *
 * 注册即登录；成功后进入游戏（自动拉取该账号的自动存档续玩）。
 * 仅做最基本的表单校验（长度/一致性），具体规则以服务端校验为准——错误原样展示。
 */
import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { login, register } from '../api/auth';
import { describeApiError } from '../api/client';
import type { AuthUser } from '../config/schema';
import { Button } from './primitives';

export interface AuthViewProps {
  onAuthed: (user: AuthUser) => void;
}

type Mode = 'login' | 'register';

export function AuthView({ onAuthed }: AuthViewProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
  }, []);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      const name = username.trim();
      if (name.length < 2) {
        setError('用户名至少 2 个字符');
        return;
      }
      if (password.length < 6) {
        setError('密码至少 6 位');
        return;
      }
      if (mode === 'register' && password !== confirm) {
        setError('两次输入的密码不一致');
        return;
      }
      setBusy(true);
      setError(null);
      const action = mode === 'register' ? register(name, password) : login(name, password);
      action
        .then((user) => onAuthed(user))
        .catch((err: unknown) => setError(describeApiError(err).message))
        .finally(() => setBusy(false));
    },
    [busy, mode, username, password, confirm, onAuthed],
  );

  return (
    <main className="td-auth">
      <div className="td-auth__card">
        <header className="td-auth__brand">
          <span className="td-hud__logo" aria-hidden="true" />
          <div>
            <h1 className="td-auth__title">淬炼塔防</h1>
            <p className="td-auth__subtitle">登录后进度自动保存 · 每个账号存档与战绩独立</p>
          </div>
        </header>

        <div className="td-auth__tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={['td-auth__tab', mode === 'login' ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={['td-auth__tab', mode === 'register' ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        <form className="td-auth__form" onSubmit={submit}>
          <label className="td-field">
            <span className="td-field__label">用户名</span>
            <input
              className="td-input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              maxLength={20}
              placeholder="2~20 个字符（中英文 / 数字 / _ / -）"
            />
          </label>
          <label className="td-field">
            <span className="td-field__label">密码</span>
            <input
              className="td-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              maxLength={72}
              placeholder="至少 6 位"
            />
          </label>
          {mode === 'register' ? (
            <label className="td-field">
              <span className="td-field__label">确认密码</span>
              <input
                className="td-input"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                maxLength={72}
                placeholder="再输一次"
              />
            </label>
          ) : null}

          {error ? (
            <p className="td-auth__error" role="alert">
              {error}
            </p>
          ) : null}

          <Button variant="filled" block busy={busy} type="submit">
            {mode === 'register' ? '注册并开始游戏' : '登录'}
          </Button>
        </form>

        <p className="td-auth__hint">
          {mode === 'login'
            ? '还没有账号？点上方「注册」，注册后会自动登录。'
            : '注册即创建专属存档，不同账号互不影响。'}
        </p>
      </div>
    </main>
  );
}
