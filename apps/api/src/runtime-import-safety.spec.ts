// The api ships four runtime entrypoints — server, worker, seed, seed:demo — and all of them load
// the module graph through `moduleManifests`. That graph must be importable OUTSIDE a vitest run:
// one test-only import reachable from it (vitest, a spec helper, a mock) takes every entrypoint
// down at import time. That is exactly what happened when the automation barrel re-exported
// `runProviderConformance`, whose `vitest` import throws when loaded outside a vitest worker —
// `npm run seed`, `seed:demo` and `npm run dev` all died before their first line of logic.
//
// The proof has to run in a SUBPROCESS: inside vitest the vitest import is legal, so an in-process
// import of the graph would pass while every real entrypoint crashes. The subprocess loads the
// graph the same way `npm run dev`/`seed` do (Node + tsx), where nothing masks the failure.
import { execFileSync } from 'node:child_process';
import { describe, it } from 'vitest';

// The shared roots the entrypoints load. server/worker/seed themselves call main() at import —
// which would connect to Mongo — so the graph is proved through the modules they are made of.
const RUNTIME_ROOTS = [
  './src/modules/index.ts', // moduleManifests — the whole Layer-2 graph, all four entrypoints
  './src/platform/kernel/bootstrap.ts', // bootPlatform — the whole Layer-1 graph
  './src/app.ts', // buildApp — routes/middleware (server)
  './src/seed-data.ts', // seed
  './src/seed-navigation.ts', // server boot catalog sync
  './src/seed-demo.ts', // seed:demo
];

describe('runtime import safety', () => {
  it('every runtime entrypoint graph loads outside a vitest run', () => {
    const script = RUNTIME_ROOTS.map((p) => `await import(${JSON.stringify(p)});`).join('\n');
    try {
      // `--import tsx` resolves TypeScript exactly like the package scripts' tsx CLI does.
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error ? String((error as { stderr: unknown }).stderr) : '';
      throw new Error(`runtime import graph failed to load outside vitest:\n${stderr}`);
    }
  }, 150_000);
});
