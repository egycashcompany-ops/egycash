// The module's boundary, held by source (design §3.6–§3.7, RK-02; Fleet's
// `drivers-are-derived.spec.ts` guard, widened from one import to the whole folder).
//
// Lint allows `modules → modules`, and its element-types rule does not stop the imports it
// disallows, so nothing in the build notices a file here reaching into IT's stores or Fleet's
// counter. This scan does: every import of every file in the module is resolved, and must land in
// this module, in `apps/api/src/shared`, in a platform barrel (or a kernel file — the kernel has no
// barrel), in the logger or env, or in a package. Inside the module, the feature graph of §3.6
// holds: `shared/` imports no feature, `catalog/` imports no other sub-module, and a feature
// reaches another only through its `index.ts`, never its model or repository (§3.4).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');
const MODULES = resolve(SRC, 'modules');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

/** Every specifier a file imports, re-exports, imports dynamically or mocks. */
const specifiersOf = (source: string): string[] => [
  ...[...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1] ?? ''),
  ...[...source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map((m) => m[1] ?? ''),
  ...[...source.matchAll(/\bvi\.mock\(\s*'([^']+)'/g)].map((m) => m[1] ?? ''),
];

interface Import {
  file: string;
  specifier: string;
  /** Relative to `apps/api/src`, without extension; null for a package. */
  target: string | null;
}

const imports: Import[] = walk(HERE).flatMap((file) =>
  specifiersOf(readFileSync(file, 'utf8')).map((specifier) => ({
    file: relative(HERE, file),
    specifier,
    target: specifier.startsWith('.')
      ? relative(SRC, resolve(dirname(file), specifier))
          .split(sep)
          .join('/')
      : null,
  })),
);

/** The sub-module and feature a module file belongs to: `catalog/catalog-items`, `shared`, or root. */
const featureOf = (path: string): string => {
  const parts = path.split('/');
  if (parts.length === 1) return '';
  if (parts[0] === 'shared') return 'shared';
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? '');
};

const OWN = 'modules/administration/';
/** The doc → DTO mapping every controller uses (§3.2) — the one root file a feature imports. */
const MAPPERS = 'administration.mappers';

describe('the scan', () => {
  it('reads the module’s imports at all — a scan that matched nothing would pass', () => {
    expect(imports.filter((entry) => entry.target !== null).length).toBeGreaterThan(30);
    expect(MODULES.endsWith(`${sep}modules`)).toBe(true);
  });
});

describe('no file imports another module (§3.7)', () => {
  it('every import that lands in modules/ lands in this module', () => {
    const foreign = imports
      .filter((entry) => entry.target?.startsWith('modules/') === true)
      .filter((entry) => !(entry.target ?? '').startsWith(OWN))
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(foreign).toEqual([]);
  });

  it('reaches the platform through its barrels — or a kernel file, which has none', () => {
    const deep = imports
      .filter((entry) => entry.target?.startsWith('platform/') === true)
      .filter((entry) => {
        const parts = (entry.target ?? '').split('/');
        return !(parts.length === 2 || (parts.length === 3 && parts[1] === 'kernel'));
      })
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(deep).toEqual([]);
  });

  it('takes from infrastructure only the logger and the env', () => {
    const other = imports
      .filter((entry) => entry.target?.startsWith('infrastructure/') === true)
      .filter(
        (entry) =>
          entry.target !== 'infrastructure/logging/logger' &&
          entry.target !== 'infrastructure/config/env',
      )
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(other).toEqual([]);
  });

  it('names no other module even by package path', () => {
    const named = imports
      .filter((entry) => entry.target === null)
      .filter((entry) => /(^|\/)modules\/(?!administration\/)/.test(entry.specifier))
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(named).toEqual([]);
  });
});

describe('the feature graph inside the module (§3.6)', () => {
  const internal = imports
    .filter((entry) => (entry.target ?? '').startsWith(OWN))
    .map((entry) => ({
      ...entry,
      from: featureOf(entry.file),
      to: featureOf((entry.target ?? '').slice(OWN.length)),
      targetPath: (entry.target ?? '').slice(OWN.length),
    }));

  it('`shared/` imports no feature of the module', () => {
    const leaks = internal
      .filter((entry) => entry.from === 'shared' && entry.to !== 'shared')
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(leaks).toEqual([]);
  });

  it('`catalog/` imports no other sub-module — it is the leaf everyone reads', () => {
    const leaks = internal
      .filter((entry) => entry.from.startsWith('catalog/'))
      .filter((entry) => entry.to !== 'shared' && !entry.to.startsWith('catalog/'))
      .filter((entry) => entry.targetPath !== MAPPERS)
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(leaks).toEqual([]);
  });

  it('a feature takes from the module root only the mappers — never the manifest or the seed', () => {
    const leaks = internal
      .filter((entry) => entry.from !== '' && entry.to === '')
      .filter((entry) => entry.targetPath !== MAPPERS)
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(leaks).toEqual([]);
  });

  it('a feature reaches another feature only through its index — never its model or repository', () => {
    const leaks = internal
      .filter((entry) => entry.from !== '' && entry.from !== 'shared')
      .filter((entry) => entry.to !== '' && entry.to !== 'shared' && entry.to !== entry.from)
      .filter((entry) => entry.targetPath !== `${entry.to}/index` && entry.targetPath !== entry.to)
      .map((entry) => `${entry.file} → ${entry.specifier}`);
    expect(leaks).toEqual([]);
  });
});
