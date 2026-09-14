import { defineConfig } from 'vitest/config';

/**
 * 纯逻辑内核单测：**environment: node**（不引 jsdom、不启浏览器）。
 *
 * 这正是 AC-5 的验证方式——`client/src/core/**` 零依赖、零浏览器 API，
 * 因此可以被 Node 直接 import 并断言。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    testTimeout: 20000,
  },
});
