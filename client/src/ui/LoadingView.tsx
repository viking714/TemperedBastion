/**
 * 配置加载中视图（不白屏 —— frontend_design 的三态要求之一）。
 */
export interface LoadingViewProps {
  /** 加载提示文案。 */
  message?: string;
}

export function LoadingView({ message = '正在加载关卡配置…' }: LoadingViewProps): JSX.Element {
  return (
    <main className="td-fallback" role="status" aria-live="polite">
      <div className="td-fallback__card">
        <span className="td-spinner td-spinner--large" aria-hidden="true" />
        <h1 className="td-fallback__title">{message}</h1>
        <p className="td-fallback__text">
          配置由后端 <code>server/config/level.json</code> 提供，网格、塔与敌人的数值都来自它。
        </p>
        <div className="td-skeleton" aria-hidden="true">
          <span className="td-skeleton__bar" />
          <span className="td-skeleton__bar td-skeleton__bar--short" />
        </div>
      </div>
    </main>
  );
}
