// The api ships ten runtime entrypoints — server, worker, seed, seed:demo, atm:import,
// fleet:fix-crew-mission, import:workforce, reset:workforce, report:org-duplication,
// migrate:org-catalog — and all of them load a module graph. That graph must be importable
// OUTSIDE a vitest run: one test-only import reachable from it (vitest, a spec helper, a mock)
// takes every entrypoint
// down at import time. That is exactly what happened when the automation barrel re-exported
// `runProviderConformance`, whose `vitest` import throws when loaded outside a vitest worker —
// `npm run seed`, `seed:demo` and `npm run dev` all died before their first line of logic.
//
// The proof has to run in a SUBPROCESS: inside vitest the vitest import is legal, so an in-process
// import of the graph would pass while every real entrypoint crashes. The subprocess loads the
// graph the same way `npm run dev`/`seed` do (Node + tsx), where nothing masks the failure.
//
// AND ONE SUBPROCESS PER ROOT, which this file learned the hard way. It used to import every root
// into a SINGLE subprocess, in list order, starting with the whole module graph — so by the time a
// later root was reached the graph was already built and any cycle that root would open on its own
// was invisible. It proved the union loads, not that each entrypoint loads, and those are not the
// same claim: `report:org-duplication` shipped importing a Mongoose model, died on a TDZ
// `ReferenceError` the first time an operator ran it, and this file stayed green throughout —
// including when the broken import was put back to test it. An entrypoint runs ALONE, so it has
// to be proved alone.
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
  // atm:import. Its logic is NOT reachable from the module manifest — the importer is a CLI-only
  // path — so it needs its own root or a test-only import in it would go unnoticed until an
  // operator ran a migration.
  './src/modules/atm/migration/legacy-import.ts',
  // fleet:fix-crew-mission, for the same reason: a one-shot retirement an operator runs by hand
  // is the worst possible place to discover a test-only import.
  './src/modules/fleet/fixed-roster/legacy-work-type-retirement.ts',
  // import:workforce, and this one has the sharpest version of the problem: it is run ONCE, at
  // go-live, by somebody with 2,600 employees waiting on it. Discovering a test-only import at
  // that moment would be the worst timing this repository has to offer.
  './src/workforce-import/run.ts',
  // reset:workforce. Run once, immediately before the import, against a database somebody is about
  // to trust with their whole workforce — the very worst moment to meet an import-time crash.
  './src/workforce-reset/reset.ts',
  // report:org-duplication — the CLI ITSELF, not a root it loads, because this entrypoint's whole
  // point is that it imports almost nothing and that is the property worth guarding.
  //
  // It is here because it went out WITHOUT being here, and the owner met the failure this file
  // exists to prevent. The first version imported the Mongoose models, which enters the graph at
  // `department.model` → `shared/org-unit` → `audit.service` → auth → users → the department
  // repository → back into the model mid-initialization; it died on a TDZ `ReferenceError` before
  // its first line of logic. Every other suite stayed green, because nothing was watching this
  // entrypoint. The lesson is the one already written above: a new entrypoint needs a new root.
  //
  // The CLI runs `main()` at import, so it is loaded with no MONGO_URI and no `--uri`, where it
  // prints its usage line and sets a non-zero exit code WITHOUT connecting to anything. The
  // subprocess below only asserts that importing it does not THROW, which is exactly the question.
  './src/org-duplication-report.cli.ts',
  // migrate:org-catalog. Registered as the LOGIC module rather than the CLI, the way `reset` and
  // `import:workforce` are: this entrypoint boots the platform, so importing the CLI itself would
  // run `main()` and try to connect. What is worth proving here is that the migration's own graph
  // loads — it reaches the org models through the barrel, and reaching them any other way is the
  // TDZ crash the entry above met in production.
  './src/org-catalog-migration/apply.ts',
];

describe('runtime import safety', () => {
  it.each(RUNTIME_ROOTS)(
    '%s loads on its own, outside a vitest run',
    (root) => {
      // The question is whether IMPORTING throws — not what exit code a module chose. The report CLI
      // runs `main()` at import and, with no database configured, prints its usage and sets a
      // non-zero code; that is correct behaviour and must not read as an import failure here.
      const script = `await import(${JSON.stringify(root)});\nprocess.exitCode = 0;`;
      try {
        // `--import tsx` resolves TypeScript exactly like the package scripts' tsx CLI does.
        execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
          stdio: 'pipe',
          timeout: 120_000,
        });
      } catch (error) {
        const stderr =
          error instanceof Error && 'stderr' in error
            ? String((error as { stderr: unknown }).stderr)
            : '';
        throw new Error(`${root} failed to load outside vitest:\n${stderr}`);
      }
    },
    150_000,
  );
});
