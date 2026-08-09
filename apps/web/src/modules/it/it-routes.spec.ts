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

  it('declares the IT-1 + IT-2 + IT-3 + IT-4 surface', () => {
    expect(paths.sort()).toEqual(
      [
        'assets',
        'assets/:id',
        'assets/scan',
        'catalogs',
        'custody',
        'helpdesk-settings',
        'maintenance',
        'maintenance-plans',
        'maintenance/:id',
        'spare-parts',
        'tickets',
        'tickets/:id',
        'vendors',
      ].sort(),
    );
  });

  // The four custody transitions are dialogs on the asset, not routes: the decision is taken
  // while looking at the asset, and a URL that performs a state change is a URL someone can
  // bookmark, share or reload into a second transition.
  it('does not route the custody ACTIONS', () => {
    for (const action of ['assign', 'return', 'transfer', 'dispose']) {
      expect(paths, `${action} must not be a route`).not.toContain(`assets/:id/${action}`);
    }
  });

  // Same rule for the help desk: every ticket transition is a dialog on the ticket. A URL that
  // performs a state change is a URL someone can bookmark, share or reload into a second
  // transition — and `resolve`/`cancel` are precisely the two nobody wants to fire twice.
  it('does not route the ticket TRANSITIONS', () => {
    for (const action of ['assign', 'status', 'resolve', 'close', 'reopen', 'cancel']) {
      expect(paths, `${action} must not be a route`).not.toContain(`tickets/:id/${action}`);
    }
  });

  // And for maintenance, where the argument is strongest: `complete` CONSUMES STOCK, so a URL that
  // can be reloaded into a second completion would issue the parts twice.
  it('does not route the maintenance TRANSITIONS', () => {
    for (const action of ['start', 'complete', 'cancel']) {
      expect(paths, `${action} must not be a route`).not.toContain(`maintenance/:id/${action}`);
    }
  });

  // `maintenance-plans` is a SIBLING of `maintenance`, not a child: a plan is not a property of one
  // order, and nesting it would make a plan's URL depend on an order that may not exist yet.
  it('keeps the preventive schedule off the order subtree', () => {
    expect(paths).toContain('maintenance-plans');
    expect(paths).not.toContain('maintenance/plans');
  });

  it('gates every one of them behind a permission', () => {
    // One <Route> block per declared path, each carrying its own RequirePermission.
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].length;
    expect(guarded).toBe(paths.length);
  });

  // The frozen design names this screen `/it/helpdesk-settings` in its §7 permission table. It
  // shipped once as `/it/help-desk`, which worked perfectly and was still wrong: a route name is
  // part of the design contract, and a nav row, a bookmark and a doc reference all encode it.
  it('uses the design’s literal route name for the help-desk settings screen', () => {
    expect(paths).toContain('helpdesk-settings');
    expect(paths).not.toContain('help-desk');
    expect(SEED).toContain("route: '/it/helpdesk-settings'");
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
