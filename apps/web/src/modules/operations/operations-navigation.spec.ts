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

/** Every guarded route this module serves, as the router declares it. */
const SERVED = [
  '/operations', // the index route
  ...[...ROUTE_SOURCE.matchAll(/path="([^"*]+)"/g)].map((m) => `/operations/${m[1] as string}`),
];

/** A payload shaped exactly like the one the seeded catalog produces for a full-access user. */
const OPERATIONS_PAYLOAD: MyApplicationCategoryDto[] = [
  {
    id: 'cat-ops',
    name: { en: 'Operations', ar: 'العمليات' },
    icon: 'shield',
    sections: [],
    applications: [
      ['Operations Home', '/operations', 'home'],
      ['Daily Operations', '/operations/shipments', 'clipboard'],
      ['Crew Board', '/operations/crew-board', 'users'],
      ['Crew Requirements', '/operations/requirements', 'badge'],
      ['Crew Attendance', '/operations/attendance', 'calendar'],
      ['Secured Shipments', '/operations/secured', 'inbox'],
      ['Vault Receive', '/operations/vault/receive', 'shield'],
      ['Vault Dispatch', '/operations/vault/dispatch', 'truck'],
      ['Vault Inventory', '/operations/vault', 'folder'],
      ['Vault Roll-up', '/operations/reports/vault', 'chart'],
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
    })),
  },
];

describe('the parse itself', () => {
  it('found the routes this module serves', () => {
    // Guards the joins below: an empty set makes "all covered" vacuously true.
    expect(SERVED.length).toBeGreaterThanOrEqual(14);
    expect(SERVED).toContain('/operations/crew-board');
  });
});

describe('the shell renders the Operations module (B7)', () => {
  const modules = toModules(OPERATIONS_PAYLOAD);

  it('turns the payload into one module with every page under it', () => {
    expect(modules).toHaveLength(1);
    expect(modules[0]?.name.en).toBe('Operations');
    expect(modules[0]?.name.ar).toBe('العمليات');
    expect(moduleApps(modules[0]!)).toHaveLength(14);
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
    expect(flat).toHaveLength(14);
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
