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
  /**
   * NEVER BUNDLE ExcelJS.
   *
   * It is CommonJS and calls `require('crypto')` at module scope. Bundled into an ESM output there
   * is no `require`, so esbuild's shim throws `Dynamic require of "crypto" is not supported` — and
   * because the roster importer is reached from the HR router, that threw during the API's and the
   * worker's IMPORT phase and crash-looped both of them before a single line of ours ran. It cost a
   * production outage; left external, Node loads it as the CJS package it is.
   *
   * It is also a real runtime dependency now (it was a devDependency while only the CLI read
   * workbooks), so `npm ci --omit=dev` installs it in the image — which is what external requires.
   */
  external: ['exceljs'],
});
