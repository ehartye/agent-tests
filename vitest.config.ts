import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/fixtures/**', 'node_modules/**'], maxWorkers: 2, testTimeout: 60000, hookTimeout: 60000 },
});
