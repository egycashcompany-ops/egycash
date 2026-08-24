// P7-A — the page registry describes surfaces that exist, and every page has something on it.
//
// This is the CI half of a check that also runs at boot. The two are not redundant: BOOT validates
// the registry this deployment actually assembled, which depends on the modules it enabled, and is
// the only place that can tell "a page from a module nobody turned on" (fine) from "a permission
// pointing at a page nobody declared" (not fine). CI validates the FULL catalog — every module in
// the repository, enabled or not — so a broken declaration fails the pull request that introduced
// it rather than the first deployment unlucky enough to enable that module.
//
// Reads the compiled contracts and the module manifests' page arrays by source, because importing
// the API's manifests would boot half the platform for a static question.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { platformPages, platformPermissions, validatePageRegistry } = await import(
  new URL('../packages/contracts/dist/index.js', import.meta.url).href
);

const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Page objects declared in a module manifest, read as source rather than executed. */
const pagesIn = (source) => {
  const block = /export const \w+Pages: PageDef\[\] = \[([\s\S]*?)\n\];/.exec(strip(source))?.[1];
  if (block === undefined) return [];
  return [...block.matchAll(/\{\s*id:\s*'([^']+)',\s*moduleId:\s*'([^']+)'/g)].map((m) => ({
    id: m[1],
    moduleId: m[2],
    name: { en: '', ar: '' },
  }));
};

/** `declarePermissions(...)` calls, with the resource's pageId — the last string argument. */
const permissionsIn = (source) => {
  const src = strip(source);
  const out = [];
  let i = 0;
  while ((i = src.indexOf('declarePermissions(', i)) !== -1) {
    let depth = 0;
    let j = src.indexOf('(', i);
    const start = j;
    do {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') depth -= 1;
      j += 1;
    } while (depth > 0 && j < src.length);
    const call = src.slice(start + 1, j - 1);
    const moduleId = /^\s*'([^']+)'/.exec(call)?.[1];
    const resource = /^\s*'[^']+'\s*,\s*'([^']+)'/.exec(call)?.[1];
    const pageId = /,\s*'([a-z][a-zA-Z0-9]*\.[a-z][a-z0-9-]*)',?\s*$/.exec(call.trimEnd())?.[1];
    const arrays = [...call.matchAll(/\[([\s\S]*?)\]/g)];
    const actions = arrays[0] ? [...arrays[0][1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
    const specials = [...call.matchAll(/action:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]);
    if (moduleId !== undefined && resource !== undefined) {
      for (const action of [...actions, ...specials]) {
        out.push({ key: `${resource}.${action}`, moduleId, pageId: pageId ?? null });
      }
    }
    i = j;
  }
  return out;
};

const MODULES = ['hr', 'fleet', 'it', 'operations', 'gold', 'atm'].map(
  (id) => `apps/api/src/modules/${id}/${id}.module.ts`,
);
const pages = [...platformPages];
const permissions = platformPermissions.map((p) => ({ ...p }));
for (const relative of MODULES) {
  const source = readFileSync(join(root, relative), 'utf8');
  pages.push(...pagesIn(source));
  permissions.push(...permissionsIn(source));
}

const problems = validatePageRegistry(pages, permissions);
const assigned = permissions.filter((p) => p.pageId !== null).length;

if (problems.length > 0) {
  console.error('page registry is invalid:');
  for (const problem of problems) console.error(`  [${problem.kind}] ${problem.detail}`);
  process.exit(1);
}

console.log(
  `page registry OK — ${String(pages.length)} pages, ` +
    `${String(assigned)}/${String(permissions.length)} permissions assigned, ` +
    `${String(permissions.length - assigned)} deliberately unassigned`,
);
