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
const SEED = readFileSync(resolve(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

/** `path="x"` → the declared child paths of the IT subtree. */
const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

describe('IT routes', () => {
  const paths = declaredPaths();

  it('declares the IT-1 + IT-2 + IT-3 + IT-4 + IT-5 surface, the employees register and the vehicle checks', () => {
    expect(paths.sort()).toEqual(
      [
        'assets',
        'assets/:id',
        'assets/scan',
        // «رفع جماعي» (2026-11-16) — the bulk upload, previewed before it writes.
        'assets/import',
        'catalogs',
        'custody',
        'employees',
        'employees/:employeeId',
        'helpdesk-settings',
        'licenses',
        'licenses/:id',
        'maintenance',
        'maintenance-plans',
        'maintenance/:id',
        // FR-19 — the SIM lines, on their own grant since 2026-11-17.
        'mobile-lines',
        // FR-20 — the consumables' store and its ledger, on theirs.
        'consumables',
        'consumables/movements',
        // FR-21 — the vehicle device check, a phone form on its own grant, outside AppShell, and
        // the dashboard of its reports, inside the console on the view grant.
        'vehicle-checks',
        'vehicle-checks/new',
        'software',
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

  // Installing and removing software are dialogs on the record, like every other IT transition.
  // `remove` in particular ends a business record, and a reloadable URL would try to end it twice.
  it('does not route the installation ACTIONS', () => {
    for (const action of ['install', 'remove', 'uninstall']) {
      expect(paths, `${action} must not be a route`).not.toContain(`software/${action}`);
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

  // «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند الـ IT»: the reports' dashboard is a console page,
  // inside the frame and on the view grant; the form stays the one phone page outside it.
  it('puts the vehicle checks dashboard inside AppShell, on its view grant, and the form outside', () => {
    const shellEnd = ROUTES.indexOf('<Route path="*" element={<NotFoundPage />} />');
    const dashboard = ROUTES.indexOf('path="vehicle-checks"');
    const form = ROUTES.indexOf('path="vehicle-checks/new"');
    expect(dashboard).toBeGreaterThan(ROUTES.indexOf('<Route element={<AppShell />}>'));
    expect(dashboard).toBeLessThan(shellEnd);
    expect(form).toBeGreaterThan(shellEnd);
    const guard = (at: number): string =>
      ROUTES.slice(at, ROUTES.indexOf('</RequirePermission>', at));
    expect(guard(dashboard)).toContain('<RequirePermission permission="itVehicleCheck.view">');
    expect(guard(form)).toContain('<RequirePermission permission="itVehicleCheck.create">');
  });

  it('resolves the literal scan segment before the :id matcher', () => {
    expect(ROUTES.indexOf('path="assets/scan"')).toBeLessThan(ROUTES.indexOf('path="assets/:id"'));
  });

  // «رفع جماعي» registers assets: it rides the create grant «تسجيل أصل» rides, not the view grant
  // the register itself is read on — and «import» must never be read as an asset id.
  it('puts the bulk upload before the :id matcher, on the create grant', () => {
    const at = ROUTES.indexOf('path="assets/import"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(ROUTES.indexOf('path="assets/:id"'));
    expect(ROUTES.slice(at, ROUTES.indexOf('</RequirePermission>', at))).toContain(
      '<RequirePermission permission="itAsset.create">',
    );
  });

  // «فى الصلاحيات مش لاقى حاجة لـ /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات
  // عشان أقدر أتحكم فيها» (2026-11-17): each screen opens on its OWN view grant — the row the roles
  // screen now shows for it — and an asset key opens neither.
  it('opens the lines and the consumables on their own view grants, never an asset key', () => {
    const guard = (path: string): string => {
      const at = ROUTES.indexOf(`path="${path}"`);
      expect(at, path).toBeGreaterThan(-1);
      return ROUTES.slice(at, ROUTES.indexOf('</RequirePermission>', at));
    };
    expect(guard('mobile-lines')).toContain('<RequirePermission permission="itMobileLine.view">');
    expect(guard('consumables')).toContain('<RequirePermission permission="itConsumable.view">');
    expect(guard('consumables/movements')).toContain(
      '<RequirePermission permission="itConsumable.view">',
    );
    for (const path of ['mobile-lines', 'consumables', 'consumables/movements']) {
      expect(guard(path), path).not.toContain('itAsset');
    }
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

  // A row shown on a grant the page refuses is a link to «no access»; a row hidden from a grant the
  // page accepts is a screen nobody can find. The lines' and the consumables' rows ride the very
  // grant their route does — corrected in place from the asset key they shipped on.
  it('shows the lines’ and the consumables’ rows on the grant their route rides', () => {
    const row = (route: string): string => {
      const at = SEED.indexOf(`route: '${route}'`);
      expect(at, route).toBeGreaterThan(-1);
      return SEED.slice(at, SEED.indexOf('}', at));
    };
    expect(row('/it/mobile-lines')).toContain("permission: 'itMobileLine.view'");
    expect(row('/it/consumables')).toContain("permission: 'itConsumable.view'");
    for (const route of ['/it/mobile-lines', '/it/consumables']) {
      expect(row(route), route).toContain("previousPermission: 'itAsset.view'");
    }
  });
});
