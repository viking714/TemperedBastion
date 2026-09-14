import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 开发服务器：
 *  - 前端一律使用同源相对路径 `/api/...`
 *  - 通过 dev proxy 把 /api 转发到后端 127.0.0.1:8000（AC-1 不依赖 CORS）
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
