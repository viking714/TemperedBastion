/**
 * Tester 独立验收套件专用 vitest 配置（td-0002）。
 * 项目主配置的 test.include 为 `src/**\/*.test.ts`，不含 client/tests/；
 * 为不改动既有 vite.config.ts，本套件自带一份最小配置。
 * 运行：cd client && node node_modules/vitest/vitest.mjs run --config tests/td-0002/vitest.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/td-0002/**/*.test.ts'],
    environment: 'node',
  },
});
