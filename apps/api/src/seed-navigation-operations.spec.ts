// The Operations sidebar, checked against the code it is supposed to describe.
//
// WHY THIS FILE EXISTS, stated plainly: B1-B6 shipped thirteen Operations screens — routed,
// permission-gated, API-connected, and covered by 744 tests — and appended NOT ONE row to the
// navigation catalog. Every gate passed. `check-page-registry` passed, because the page registry
// feeds the ROLE MATRIX and has nothing to do with the sidebar. The module was invisible in the
// application and reachable only by typing a URL, and nothing in the repository noticed.
//
// So the coupling that was missing gets a test rather than a convention. Three files have to agree
// and nothing made them:
//
//   seed-navigation.ts        which Operations pages EXIST as sidebar rows
//   web/…/operations/routes.tsx   which routes exist and what guards them
//   operations.module.ts      which permissions the module actually declares
//
// All three are read as SOURCE and compared. The direction that matters most is
// routes → catalog: a screen that ships without a row is exactly the defect above, and it is
// silent — no build breaks, no request fails, the page simply cannot be found.
//
// Parsing is asserted before it is trusted: a regex that silently matched nothing would make every
// assertion here pass on an empty set and prove the opposite of what it claims.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { operationsPermissions } from './modules/operations/operations.module';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

// ── The catalog block ───────────────────────────────────────────────────────────────────────────

/** The Operations block of the navigation catalog — from its category name to the next category's. */
const operationsCatalog = (): string => {
  const source = read('./seed-navigation.ts');
  const start = source.indexOf("en: 'Operations',");
  const end = source.indexOf("en: 'Organization',", start);
  expect(start, 'Operations category').toBeGreaterThan(-1);
  expect(end, 'Organization category (the Operations block ends there)').toBeGreaterThan(start);
  return source.slice(start, end);
};

interface NavRow {
  en: string;
  ar: string;
  route: string;
  icon: string;
  permission: string;
}

// A label may be written with EITHER quote style — `"Captain's Day"` has to be double-quoted
// because it contains an apostrophe. The single-quote-only version of this regex silently skipped
// that row, and a silently skipped row is exactly the failure the block below guards against: the
// "every route has a nav row" assertion then reports a real row as missing.
const LABEL = String.raw`(?:'([^']+)'|"([^"]+)")`;
const NAV_ROWS: NavRow[] = [
  ...operationsCatalog().matchAll(
    new RegExp(
      String.raw`en: ${LABEL},\s*\n\s*ar: ${LABEL},[\s\S]*?route: '([^']+)',\s*\n\s*icon: '([^']+)',[\s\S]*?permission: '([^']+)',`,
      'g',
    ),
  ),
].map((m) => ({
  en: (m[1] ?? m[2]) as string,
  ar: (m[3] ?? m[4]) as string,
  route: m[5] as string,
  icon: m[6] as string,
  permission: m[7] as string,
}));

// ── The frontend routes ─────────────────────────────────────────────────────────────────────────

/**
 * Every guarded Operations route, as the router declares it: `path="x"` followed by the
 * `RequirePermission` that wraps it. The index route has no `path`, so the module home is added
 * from its own marker below rather than guessed at.
 */
const ROUTE_SOURCE = read('../../web/src/modules/operations/routes.tsx');

const FRONTEND_ROUTES: { route: string; permission: string }[] = [
  ...ROUTE_SOURCE.matchAll(/path="([^"*]+)"\s*\n\s*element=\{\s*\n\s*<RequirePermission permission="([^"]+)"/g),
].map((m) => ({ route: `/operations/${m[1] as string}`, permission: m[2] as string }));

const HAS_INDEX_ROUTE = /<Route index element=\{<OperationsOverviewPage \/>\} \/>/.test(ROUTE_SOURCE);

// ── Guard the parse ─────────────────────────────────────────────────────────────────────────────

describe('the parse itself', () => {
  it('found the catalog rows, the frontend routes and the module home', () => {
    // An empty set satisfies every "all covered" assertion below, so the counts come first.
    expect(NAV_ROWS.length).toBeGreaterThanOrEqual(14);
    expect(FRONTEND_ROUTES.length).toBeGreaterThanOrEqual(13);
    expect(HAS_INDEX_ROUTE, 'the module home is an index route').toBe(true);
  });
});

// ── The category ────────────────────────────────────────────────────────────────────────────────

describe('the Operations category', () => {
  const block = operationsCatalog();

  it('is declared with a bilingual name, an icon and a sort order', () => {
    expect(block).toContain("en: 'Operations',");
    expect(block).toContain("ar: 'العمليات',");
    expect(block).toMatch(/icon: '[a-z]+',/);
    expect(block).toMatch(/sortOrder: \d+,/);
  });

  it('sorts between Fleet and Organization — a cash day is planned against Fleet duty rows', () => {
    const source = read('./seed-navigation.ts');
    const orderOf = (name: string): number => {
      const at = source.indexOf(`en: '${name}',`);
      expect(at, `${name} category`).toBeGreaterThan(-1);
      // Bounded by the category's own `apps:` rather than a fixed window: a long comment between
      // the name and the order would otherwise slide out of view and read as "not declared".
      const header = source.slice(at, source.indexOf('apps: [', at));
      const match = /sortOrder: (\d+),/.exec(header);
      expect(match, `${name} sortOrder`).not.toBeNull();
      return Number(match?.[1]);
    };
    expect(orderOf('Fleet')).toBeLessThan(orderOf('Operations'));
    expect(orderOf('Operations')).toBeLessThan(orderOf('Organization'));
  });
});

// ── The rows ────────────────────────────────────────────────────────────────────────────────────

describe('the Operations navigation rows', () => {
  it('carries every screen B1-B6 and C1 shipped, module home included', () => {
    expect(NAV_ROWS.map((r) => r.route).sort()).toEqual(
      [
        '/operations',
        '/operations/attendance',
        '/operations/catalogs',
        '/operations/crew-board',
        // C1 — the captain's phone surface. Listed like any other app: the grant decides who may
        // open it, and the screen itself answers whether the holder is rostered today.
        '/operations/my-day',
        '/operations/reports/banks',
        '/operations/reports/captains',
        '/operations/reports/vault',
        '/operations/requirements',
        '/operations/secured',
        '/operations/shipments',
        '/operations/vault',
        '/operations/vault/dispatch',
        '/operations/vault/receive',
      ].sort(),
    );
  });

  it('names every row in both languages — an unlabelled sidebar row is unusable', () => {
    for (const row of NAV_ROWS) {
      expect(row.en.length, row.route).toBeGreaterThan(0);
      expect(row.ar.length, row.route).toBeGreaterThan(0);
      // The Arabic label must actually be Arabic, not the English one copied across.
      expect(row.ar, row.route).toMatch(/[؀-ۿ]/);
    }
  });

  it('lists each route exactly once — the sync keys on route, so a duplicate is a real collision', () => {
    expect(new Set(NAV_ROWS.map((r) => r.route)).size).toBe(NAV_ROWS.length);
  });

  it('uses only icon names the sidebar registry resolves', () => {
    // An unregistered name falls back silently to a neutral glyph, which looks like a choice.
    const registry = read('../../web/src/platform/navigation/app-icon.tsx');
    const known = new Set([...registry.matchAll(/^ {2}([a-z]+):/gm)].map((m) => m[1] as string));
    expect(known.size).toBeGreaterThan(10);
    for (const row of NAV_ROWS) {
      expect(known.has(row.icon), `${row.route} icon '${row.icon}'`).toBe(true);
    }
    const categoryIcon = /icon: '([a-z]+)',\n\s*sortOrder:/.exec(operationsCatalog())?.[1];
    expect(known.has(String(categoryIcon)), `category icon '${String(categoryIcon)}'`).toBe(true);
  });
});

// ── Permissions: the SAME keys, not a parallel system ───────────────────────────────────────────

describe('permissions are the module\'s own', () => {
  const declared = new Set(operationsPermissions.map((p) => p.key));

  it('declares a permission on every row — a row without one is entitled to nobody', () => {
    for (const row of NAV_ROWS) {
      expect(row.permission, row.route).toBeTruthy();
    }
  });

  it('uses keys the Operations module actually registered — no parallel permission system', () => {
    for (const row of NAV_ROWS) {
      expect(declared.has(row.permission), `${row.route} → ${row.permission}`).toBe(true);
    }
  });

  it('matches the permission the CLIENT ROUTE GUARD checks, route by route', () => {
    // The whole point of the catalog's `permission` field: it must be the same key the guard
    // uses, or the sidebar offers a row the router then refuses.
    const guardOf = new Map(FRONTEND_ROUTES.map((r) => [r.route, r.permission]));
    for (const row of NAV_ROWS) {
      if (row.route === '/operations') continue; // the index route carries no guard of its own
      if (row.route === '/operations/attendance') continue; // two chained guards — asserted below
      expect(guardOf.get(row.route), `${row.route} guard`).toBe(row.permission);
    }
  });

  it('declares the OPERATIONS half of the attendance page\'s two chained guards', () => {
    // The page requires `operationsCrew.view` AND HR's `attendance.view`; a catalog row carries
    // one key. The Operations half is the right one: an HR account holding `attendance.view` and
    // no Operations grant must not be shown an Operations category. The second guard still holds
    // at the route and at the endpoint, so this narrows nothing and leaks nothing.
    const row = NAV_ROWS.find((r) => r.route === '/operations/attendance');
    expect(row?.permission).toBe('operationsCrew.view');
    expect(ROUTE_SOURCE).toContain('<RequirePermission permission="attendance.view">');
  });
});

// ── The direction that was actually broken ──────────────────────────────────────────────────────

describe('no shipped screen is URL-only', () => {
  it('gives every guarded frontend route a navigation row', () => {
    // THE REGRESSION GUARD. This is the assertion that would have failed on B1 through B6: a
    // screen can be routed, guarded, translated and tested and still be unreachable, because
    // nothing links to it. If a future slice adds a route without a row, this fails here.
    const catalogued = new Set(NAV_ROWS.map((r) => r.route));
    const missing = FRONTEND_ROUTES.filter((r) => !catalogued.has(r.route)).map((r) => r.route);
    expect(missing, 'routed screens with no sidebar row').toEqual([]);
  });

  it('points every navigation row at a route the frontend actually serves', () => {
    // The other direction: a row for a page that does not exist is a 404 in the sidebar.
    const served = new Set(FRONTEND_ROUTES.map((r) => r.route));
    served.add('/operations'); // the index route
    const dangling = NAV_ROWS.filter((r) => !served.has(r.route)).map((r) => r.route);
    expect(dangling, 'sidebar rows pointing nowhere').toEqual([]);
  });
});
