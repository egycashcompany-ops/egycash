// Two structural invariants for the IT surface. Both guard mistakes that no render test catches,
// because the broken version renders perfectly well.
//
// 1. **Every IT route is permission-gated.** A page reachable without its §7 permission is not a
//    cosmetic bug: the API would still refuse the data, so the user gets a screen of errors
//    instead of a clean "no access", and a reviewer reading the routes cannot tell which surfaces
//    are protected. The module index (`/it`) is the deliberate exception — it renders only the
//    cards the viewer's own grants allow and says so when there are none.
//
// 2. **Navigation never links to a route that does not exist.** The owner rule carried from the
//    Fleet FW-1 review is that no unshipped surface is reachable; the mirror failure is a sidebar
//    row pointing at a 404. The nav catalog lives in the API seed, so this reads that file and
//    checks every `/it/...` row against the routes actually declared here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
const SEED = readFileSync(
  resolve(HERE, '../../../../api/src/seed-navigation.ts'),
  'utf8',
);

/** `path="x"` → the declared child paths of the IT subtree. */
const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

describe('IT routes', () => {
  const paths = declaredPaths();

  it('declares the ITW-1 surface', () => {
    expect(paths.sort()).toEqual(
      ['assets', 'assets/:id', 'assets/scan', 'catalogs', 'vendors'].sort(),
    );
  });

  it('gates every one of them behind a permission', () => {
    // One <Route> block per declared path, each carrying its own RequirePermission.
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].length;
    expect(guarded).toBe(paths.length);
  });

  it('resolves the literal scan segment before the :id matcher', () => {
    expect(ROUTES.indexOf('path="assets/scan"')).toBeLessThan(ROUTES.indexOf('path="assets/:id"'));
  });

  it('uses only permissions the IT module actually declares', () => {
    const used = new Set(
      [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]),
    );
    for (const permission of used) {
      expect(permission, 'IT routes must not gate on another module').toMatch(/^it[A-Z]/);
    }
  });
});

describe('IT navigation matches the routes that exist', () => {
  // Rows look like: { en: 'Assets', ar: '…', route: '/it/assets', icon: 'monitor' }
  const navRoutes = [...SEED.matchAll(/route:\s*'(\/it[^']*)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );

  it('seeds the IT category with its shipped rows', () => {
    expect(navRoutes.length).toBeGreaterThan(0);
  });

  it('points every row at a declared route', () => {
    const declared = new Set(declaredPaths().map((p) => `/it/${p}`));
    // `/it` itself is the index route.
    declared.add('/it');
    const dangling = navRoutes.filter((route) => !declared.has(route));
    expect(dangling, 'navigation links to a route that does not exist').toEqual([]);
  });
});
