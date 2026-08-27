// Every `/platform/…` path the web client calls is a path this API actually mounts.
//
// WHY THIS EXISTS. The branch switcher asked for `/platform/organization/branches`. Branches are
// mounted at `/platform/branches`; `/platform/organization` serves exactly one route, `/`. So the
// request 404'd on every load, the switcher's list came back empty, and the menu said «لا توجد
// فروع بعد» to a company that had three — a wrong path reading, to the person using it, as a
// factual claim about their data.
//
// Nothing could have caught it. The client builds a URL STRING; the server assembles its routes
// from a mount table and a dozen router files. TypeScript sees a string on one side and an Express
// app on the other and never puts them in the same room. So this file puts them in the same room:
// it reads the REAL mount table out of `app.ts`, the REAL route patterns out of each router, and
// checks every path in the web sources against them.
//
// Scope is the `/platform/*` surface, where the mount table is flat and lives in one file. Module
// routes (`/gold/…`, `/hr/…`) come from module manifests and are not covered here.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '..');
const WEB_SRC = resolve(API_SRC, '../../web/src');

const sourcesIn = (root: string): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push({ name: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out;
};

const API_SOURCES = sourcesIn(API_SRC);

/** `api.use('/platform/branches', buildBranchesRouter())` → the prefix and the builder's name. */
const mountTable = (): { prefix: string; builder: string }[] => {
  const app = readFileSync(join(API_SRC, 'app.ts'), 'utf8');
  const out: { prefix: string; builder: string }[] = [];
  for (const m of app.matchAll(/api\.use\('(\/platform\/[^']*)',\s*(\w+)\(/g)) {
    out.push({ prefix: m[1] as string, builder: m[2] as string });
  }
  return out;
};

/** The route patterns one router declares — following `makeOrgUnitRouter` into the shared factory. */
const patternsOf = (builder: string): string[] => {
  const file = API_SOURCES.find((s) =>
    new RegExp(`export const ${builder}\\s*=`).test(s.text),
  );
  if (file === undefined) throw new Error(`no source declares ${builder}`);
  const texts = [file.text];
  if (file.text.includes('makeOrgUnitRouter')) {
    const factory = API_SOURCES.find((s) => s.name.endsWith('org-unit.http.ts'));
    if (factory !== undefined) texts.push(factory.text);
  }
  const patterns = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(/router\.(?:get|post|patch|put|delete)\(\s*'([^']*)'/g)) {
      patterns.add(m[1] as string);
    }
  }
  return [...patterns];
};

/** A mounted path, as a regex: `:params` and `${…}` interpolations each match one segment. */
const asMatcher = (mounted: string): RegExp =>
  new RegExp(`^${mounted.replace(/:[A-Za-z0-9_]+/g, '[^/]+').replace(/\/$/, '')}/?$`);

/** Every mounted path as its literal pattern text, `:params` and all. */
const MOUNTED_PATTERNS: string[] = mountTable().flatMap(({ prefix, builder }) =>
  patternsOf(builder).map((pattern) => (pattern === '/' ? prefix : `${prefix}${pattern}`)),
);

const MOUNTED: RegExp[] = MOUNTED_PATTERNS.map(asMatcher);

/** Comments are prose: they contain example URLs and ellipses that are not requests. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Every `/platform/…` path the web asks for, normalized for comparison.
 *
 * Two interpolation shapes, and they mean different things. `${x}` after a slash is one path
 * SEGMENT — an id — and matches a `:param`. `${x}` glued to the end of a segment is `buildQuery`
 * appending `?a=b`, so the path ends there.
 */
const webPaths = (): { path: string; file: string }[] => {
  const found = new Map<string, string>();
  for (const source of sourcesIn(WEB_SRC)) {
    if (source.name.includes('.spec.')) continue;
    for (const m of stripComments(source.text).matchAll(/['`](\/platform\/[^'`\s]*)['`]/g)) {
      const raw = m[1] as string;
      if (/^\/platform\/\$\{/.test(raw)) continue; // resolved separately — see `optionPaths`
      const path = raw
        .replace(/([^/])\$\{[^}]*\}.*$/, '$1') // a glued interpolation is the query string
        .replace(/\$\{[^}]*\}/g, 'X') // a slash-separated one is an id
        .split('?')[0] as string;
      if (!found.has(path)) found.set(path, source.name.slice(WEB_SRC.length + 1));
    }
  }
  return [...found].map(([path, file]) => ({ path, file }));
};

/**
 * The `/options` dropdowns, whose RESOURCE is interpolated — resolved from the call sites.
 *
 * WHY THIS WAS ADDED. The path above is built as `/platform/${path}/options` inside a one-line
 * local helper, and this file used to skip anything whose resource was a variable: "which route
 * it is, is decided by a caller this file cannot see." That was true of the template and false of
 * the program. Every caller passes a STRING LITERAL — `orgOptions('branches')`,
 * `orgOptions('job-titles')` — and the literal is right there in the same file.
 *
 * So it was not unknowable, only unread, and `/platform/job-titles/options` 404'd in two shipped
 * screens for exactly as long as the skip stood. The helper is matched by SHAPE rather than by
 * name (three files declare their own copy under two names), and the literals it is called with
 * become concrete paths.
 *
 * THESE ARE CHECKED AGAINST LITERAL PATTERNS, not against the matchers `webPaths` uses, and that
 * distinction is the whole assertion. `/platform/job-titles/:id` matches the STRING
 * `/platform/job-titles/options` perfectly well — which is why adding the resolution alone still
 * found nothing. Express does not agree: `/:id` is declared after, and its `objectId()` validation
 * rejects the word `options` as malformed. A dropdown route must therefore be declared, not
 * merely matched.
 */
const optionPaths = (): { path: string; file: string }[] => {
  const found = new Map<string, string>();
  for (const source of sourcesIn(WEB_SRC)) {
    if (source.name.includes('.spec.')) continue;
    const text = stripComments(source.text);
    // `const <helper> = (…) => get<…>(`/platform/${…}/options`)` — the helper, whatever it is called.
    const helpers = [
      ...text.matchAll(/const (\w+) = \([^)]*\)[^=]*=>[\s\S]{0,120}?`\/platform\/\$\{[^}]+\}\/options`/g),
    ].map((m) => m[1] as string);
    for (const helper of helpers) {
      for (const call of text.matchAll(new RegExp(`\\b${helper}\\('([^']+)'\\)`, 'g'))) {
        const path = `/platform/${call[1] as string}/options`;
        if (!found.has(path)) found.set(path, source.name.slice(WEB_SRC.length + 1));
      }
    }
  }
  return [...found].map(([path, file]) => ({ path, file }));
};

describe('the web calls no /platform path this API does not mount', () => {
  it('finds the mount table and the web sources', () => {
    expect(MOUNTED.length).toBeGreaterThan(50);
    expect(webPaths().length).toBeGreaterThan(20);
  });

  it.each(webPaths())('$path — called from $file', ({ path }) => {
    expect(MOUNTED.some((route) => route.test(path))).toBe(true);
  });

  /** A helper that resolved to nothing would make the assertions below vacuously true. */
  it('resolves the interpolated `/options` helpers to real resources', () => {
    const paths = optionPaths().map((p) => p.path);
    expect(paths).toContain('/platform/branches/options');
    expect(paths).toContain('/platform/job-titles/options');
  });

  it.each(optionPaths())('$path is declared, not merely matched by `/:id`', ({ path }) => {
    expect(MOUNTED_PATTERNS).toContain(path);
  });
});
