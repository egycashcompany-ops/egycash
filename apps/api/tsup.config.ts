import { defineConfig } from 'tsup';

export default defineConfig({
  /**
   * THE OPERATOR CLIs ARE BUILT TOO, and that is not a convenience — without it they do not exist
   * on the deployed machine at all.
   *
   * The image installs with `--omit=dev`, so `tsx` is not there and `npm run import:vehicles`
   * cannot run; the only things that exist are the files listed here. The go-live imports are run
   * ONCE, from the service shell, exactly the way the deployment guide already runs the seed:
   *
   *   node apps/api/dist/fleet-vocabulary.cli.js --write
   *   node apps/api/dist/fleet-vehicles-import.cli.js --file ./cars.json --photos ./photos --write
   */
  entry: [
    'src/server.ts',
    'src/worker.ts',
    'src/seed.ts',
    'src/fleet-vocabulary.cli.ts',
    'src/fleet-vehicles-import.cli.ts',
  ],
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
