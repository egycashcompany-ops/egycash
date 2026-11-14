// The web half of the navigation chain (B7).
//
// The API half is asserted in apps/api (seed-navigation-operations.spec.ts + the
// operations-navigation integration suite). What is left to prove on this side is that the shell
// actually RENDERS what that payload contains, and that every route it offers is a route this
// module serves — the two ends of:
//
//   GET /platform/me/applications  →  useMyApplications()  →  toModules()  →  Sidebar
//     →  /operations/*  →  the React page
//
// WHY THE ROUTE LIST IS READ AS SOURCE. B1-B6 shipped every screen here and none of them was
// reachable, because nothing linked to them. A test that only checked the pages exist would have
// passed throughout. The assertion that matters is the JOIN: catalog route ↔ served route.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type MyApplicationCategoryDto } from '@ecms/contracts';
import { flattenApps, moduleApps, toModules } from '../../platform/navigation/nav-model';
import { resolveNavIcon } from '../../platform/navigation/app-icon';
import { type HomeIcon } from '../../shared/ui/icons';
import { OPERATIONS_SHORTCUTS } from './pages/OperationsOverviewPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(resolve(HERE, './routes.tsx'), 'utf8');

/**
 * Every guarded route this module serves that a sidebar row could POINT AT.
 *
 * Parameterised routes are excluded, and that is a property of what a navigation row IS rather
 * than an exemption: `/operations/my-day/stops/:assignmentId` has no single URL to link to, and a
 * captain reaches it by tapping a stop on his day — which is exactly the "reachable without typing
 * a URL" the rule below protects. Requiring a row for it would demand a link nobody can write.
 */
const ROUTES = [...ROUTE_SOURCE.matchAll(/path="([^"*]+)"\s*\n?\s*element=\{\s*<(\w+)/g)].map(
  (m) => ({ route: `/operations/${m[1] as string}`, element: m[2] as string }),
);

/**
 * A RETIRED address that only forwards to its successor (Round 14: «تجميع الخزينة» → «تقرير
 * البنوك») is not a screen: no row may point at it, and none is owed to it.
 */
const REDIRECTS = ROUTES.filter((r) => r.element === 'RedirectKeepingQuery').map((r) => r.route);

const SERVED = [
  '/operations', // the index route
  ...ROUTES.filter((r) => r.element !== 'RedirectKeepingQuery')
    .map((r) => r.route)
    .filter((route) => !route.includes(':')),
];

/** A payload shaped exactly like the one the seeded catalog produces for a full-access user. */
const OPERATIONS_PAYLOAD: MyApplicationCategoryDto[] = [
  {
    id: 'cat-ops',
    name: { en: 'Operations', ar: 'العمليات' },
    icon: 'cash',
    sections: [],
    applications: [
      ['Operations Home', '/operations', 'home'],
      ['Daily Operations', '/operations/shipments', 'clipboard'],
      // The day board over a from–to range — the row the lead seeds beside it.
      ['Shipments History', '/operations/shipments/history', 'calendar'],
      ['Crew Board', '/operations/crew-board', 'users'],
      ['Standing Crew', '/operations/standing-crew', 'truck'],
      ['Crew Requirements', '/operations/requirements', 'badge'],
      // Round 14 — «إدارات العمليات», a screen of its own right beneath the roster it decides.
      ['Operations Departments', '/operations/crew-departments', 'sitemap'],
      ['Crew Attendance', '/operations/attendance', 'calendar'],
      ['Secured Shipments', '/operations/secured', 'inbox'],
      // Round 12 — the day's محصنات onto the day's vans, and the vault handing each van its load.
      ['Secured Distribution', '/operations/secured/distribution', 'link'],
      ['Vault Receive', '/operations/vault/receive', 'shield'],
      ['Secured Handover', '/operations/vault/handover', 'receipt'],
      // Round 12 renamed these two: «محصنات الخزينة» and «سجل الخزينة».
      ['Vault Shipments', '/operations/vault/dispatch', 'truck'],
      ['Vault History', '/operations/vault', 'folder'],
      // Round 14 — «تجميع الخزينة» is gone; its content is «تقرير البنوك», two rows down.
      ['Captain Report', '/operations/reports/captains', 'chart'],
      ['Bank Report', '/operations/reports/banks', 'chart'],
      // C1 — the captain's phone surface, listed like any other app. Its grant decides who may
      // open it; the screen itself answers whether the holder is rostered today.
      ["Captain's Day", '/operations/my-day', 'truck'],
      ['Operations Catalogs', '/operations/catalogs', 'tag'],
    ].map(([en, route, icon], i) => ({
      id: `app-${String(i)}`,
      name: { en: en as string, ar: 'صفحة' },
      route: route as string,
      icon: icon as string,
      sortOrder: i * 10,
      personal: false,
    })),
  },
];

describe('the parse itself', () => {
  it('found the routes this module serves', () => {
    // Guards the joins below: an empty set makes "all covered" vacuously true.
    expect(SERVED.length).toBeGreaterThanOrEqual(18);
    expect(SERVED).toContain('/operations/crew-board');
    // …and told a forwarding address from a screen.
    expect(REDIRECTS).toEqual(['/operations/reports/vault']);
    expect(SERVED).not.toContain('/operations/reports/vault');
  });
});

describe('«تجميع الخزينة» leaves the sidebar, and its address forwards (Round 14)', () => {
  it('offers no row at the retired address', () => {
    const routes = moduleApps(toModules(OPERATIONS_PAYLOAD)[0]!).map((a) => a.route);
    for (const gone of REDIRECTS) expect(routes, gone).not.toContain(gone);
  });

  it('forwards it to «تقرير البنوك», a screen the sidebar does offer', () => {
    const at = ROUTE_SOURCE.indexOf('path="reports/vault"');
    expect(ROUTE_SOURCE.slice(at, ROUTE_SOURCE.indexOf('/>', at))).toContain(
      '<RedirectKeepingQuery to="/operations/reports/banks"',
    );
    expect(SERVED).toContain('/operations/reports/banks');
  });
});

describe('the shell renders the Operations module (B7)', () => {
  const modules = toModules(OPERATIONS_PAYLOAD);

  it('turns the payload into one module with every page under it', () => {
    expect(modules).toHaveLength(1);
    expect(modules[0]?.name.en).toBe('Operations');
    expect(modules[0]?.name.ar).toBe('العمليات');
    expect(moduleApps(modules[0]!)).toHaveLength(18);
  });

  it('resolves every catalog icon to a real glyph, not the silent fallback', () => {
    // An unregistered name falls back without complaint, which reads as a design choice rather
    // than a missing entry. The fallback here is a SENTINEL, not a real icon: passing HomeIcon
    // would make the module home — whose icon IS `home` — indistinguishable from a miss.
    const SENTINEL = (() => null) as unknown as typeof HomeIcon;
    for (const app of moduleApps(modules[0]!)) {
      expect(resolveNavIcon(app.icon, SENTINEL), `icon '${String(app.icon)}'`).not.toBe(SENTINEL);
    }
    expect(resolveNavIcon(modules[0]?.icon, SENTINEL), 'the category icon').not.toBe(SENTINEL);
    // ...and the sentinel really does come back for a name nobody registered.
    expect(resolveNavIcon('not-an-icon', SENTINEL)).toBe(SENTINEL);
  });

  it('puts every page in the command palette, each carrying its module', () => {
    const flat = flattenApps(OPERATIONS_PAYLOAD);
    expect(flat).toHaveLength(18);
    for (const app of flat) expect(app.moduleName.en).toBe('Operations');
  });
});

describe('no catalog row points nowhere, and no screen is URL-only (B7)', () => {
  it('serves every route the catalog offers', () => {
    const served = new Set(SERVED);
    const dangling = moduleApps(toModules(OPERATIONS_PAYLOAD)[0]!)
      .map((a) => a.route)
      .filter((r) => !served.has(r));
    expect(dangling, 'sidebar rows with no route behind them').toEqual([]);
  });

  it('catalogs every route it serves — the B1-B6 regression guard, on the web side', () => {
    const catalogued = new Set(moduleApps(toModules(OPERATIONS_PAYLOAD)[0]!).map((a) => a.route));
    const unreachable = SERVED.filter((r) => !catalogued.has(r));
    expect(unreachable, 'routed screens with no sidebar row').toEqual([]);
  });

  it('offers every module-home shortcut as a sidebar row too', () => {
    // The overview page's cards and the sidebar are two ways into the same set. If they drift, one
    // of them is lying about what the module contains.
    const catalogued = new Set(moduleApps(toModules(OPERATIONS_PAYLOAD)[0]!).map((a) => a.route));
    for (const shortcut of OPERATIONS_SHORTCUTS) {
      expect(catalogued.has(shortcut.to), `${shortcut.to} is a card but not a sidebar row`).toBe(
        true,
      );
    }
  });
});
