// Refuse a build that would crash on startup.
//
// WHY THIS EXISTS. `apps/api` ships as an ESM bundle. When esbuild bundles a CommonJS package that
// calls `require()` as it loads, it substitutes a shim that throws at RUNTIME —
//
//     Error: Dynamic require of "crypto" is not supported
//
// — and if that package is reachable from `server.ts` or `worker.ts`, the throw happens during the
// import phase, before any of our code runs. Both processes crash-loop and the platform is down.
//
// That is not hypothetical: adding the roster importer put ExcelJS in the HR router's import graph
// and did exactly this in production. Every check in CI was green — lint, typecheck, 5,500 tests,
// and `npm run build` itself, because the shim compiles perfectly and only fails when executed.
// The gap was that nothing ever RAN the built bundle.
//
// The fix for any offender is `external` in `tsup.config.ts`, plus moving it to `dependencies` so
// the runtime image installs it. This check is the tripwire, not the fix.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'apps/api/dist';
// esbuild's shim, verbatim. It appears once per output file that needs it.
const MARKER = 'Dynamic require of';

const files = (await readdir(DIST)).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error(`no bundle found in ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}

const offenders = [];
for (const file of files) {
  const body = await readFile(join(DIST, file), 'utf8');
  if (!body.includes(MARKER)) continue;
  // Name what pulled it in, so the message points at the package to externalize rather than at a
  // hashed chunk nobody can act on.
  const packages = [...body.matchAll(/\.\.\/\.\.\/node_modules\/([^/'"]+)/gu)].map((m) => m[1]);
  offenders.push({ file, packages: [...new Set(packages)].slice(0, 10) });
}

if (offenders.length > 0) {
  console.error('bundle contains a dynamic-require shim — the API would crash on startup:\n');
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    if (o.packages.length > 0) console.error(`    bundled CommonJS: ${o.packages.join(', ')}`);
  }
  console.error('\nAdd the offending package to `external` in apps/api/tsup.config.ts, and move it');
  console.error('to `dependencies` so the runtime image installs it.');
  process.exit(1);
}

console.log(`bundle OK — ${files.length} output files, no dynamic-require shim`);
