import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    hookTimeout: 120_000,
    // When every suite has passed but the process will not exit, the run is being held open by
    // a handle a test left behind. This reporter names it instead of leaving a silent hang.
    reporters: ['default', 'hanging-process'],
    teardownTimeout: 30_000,
    testTimeout: 60_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
    },
  },
});
