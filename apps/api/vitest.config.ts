import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
    },
  },
});
