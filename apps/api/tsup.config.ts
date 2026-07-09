import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The contracts workspace package is compiled into the bundle so the runtime
  // image needs only the api's own node_modules.
  noExternal: ['@ecms/contracts'],
});
