import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/consentflow_test',
      JWT_SECRET: 'test-secret',
      PUBLIC_API_URL: 'https://api.test',
      LOG_LEVEL: 'silent',
      CMP_CACHE_TTL_MS: '0',
    },
  },
});
