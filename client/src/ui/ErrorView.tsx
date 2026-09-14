/**
 * 配置加载失败视图（不白屏 + 可重试 + 可读原因 —— frontend_design 的三态要求之一）。
 */
import type { ApiFailure } from '../api/client';
import { Button } from './primitives';

export interface ErrorViewProps {
  error: ApiFailure;
  onRetry: () => void;
}

export function ErrorView({ error, onRetry }: ErrorViewProps): JSX.Element {
  const offline = error.code === 'NETWORK_ERROR';

  return (
    <main className="td-fallback" role="alert">
      <div className="td-fallback__card td-fallback__card--error">
        <span className="td-fallback__badge" aria-hidden="true">
          !
        </span>
        <h1 className="td-fallback__title">无法加载关卡配置</h1>
        <p className="td-fallback__text">{error.message}</p>
        <p className="td-fallback__code">
          错误代码：<code>{error.code}</code>
        </p>
        {offline ? (
          <p className="td-fallback__text">
            后端服务没有响应。请确认已用 <code>npm run dev</code> 同时启动前后端，
            或单独启动后端：<code>uvicorn app.main:app --port 8000</code>（工作目录 <code>server/</code>）。
          </p>
        ) : (
          <p className="td-fallback__text">
            后端配置可能不符合前端契约，请检查 <code>server/config/level.json</code> 的字段与取值范围。
          </p>
        )}
        <div className="td-fallback__actions">
          <Button variant="filled" onClick={onRetry}>
            重试
          </Button>
        </div>
      </div>
    </main>
  );
}
