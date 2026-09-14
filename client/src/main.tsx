/**
 * React 入口。
 *
 * 样式加载顺序：先设计令牌（tokens.css，权威源），再布局样式（app.css，只引用令牌）。
 * 没有任何远程字体 / 远程图片 / 外部 CDN 请求。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载点，请检查 index.html。');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
