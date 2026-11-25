// The Administrative Affairs sidebar, checked against the code it describes (design §13.3–§13.4,
// §19.8) — the Operations nav spec's shape (`seed-navigation-operations.spec.ts`).
//
// Three files have to agree and nothing else makes them:
//
//   seed-navigation.ts                  which Administrative Affairs pages EXIST as sidebar rows
//   web/…/administration/routes.tsx     which routes exist and what guards them
//   administration.module.ts            which permissions the module actually declares
//
// All three are read as SOURCE (or as the declarations the seed exports) and compared. A routed
// screen with no row is invisible; a row for a page that does not exist is a 404 in the sidebar; a
// row keyed on another key than its route's guard is offered to a reader the router then refuses.
// Unlike Operations, a routed screen may go without a row — the item record, opened from its
// register — but then it is NAMED below with the page that links to it, so a screen nothing links
// to still fails here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { administrationPermissions } from './modules/administration/administration.module';
import { NAVIGATION_CATALOG } from './seed-navigation';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const WEB = '../../web/src/modules/administration';

const SEED = read('./seed-navigation.ts');
const ROUTES = read(`${WEB}/routes.tsx`);

const category = NAVIGATION_CATALOG.find((c) => c.en === 'Administrative Affairs');
const rows = category?.apps ?? [];

/** Every guarded route the web subtree declares, as `/administration/<path>` → its one key. */
const FRONTEND_ROUTES = [
  ...ROUTES.matchAll(/path="([^"*]+)"\s*element=\{\s*<RequirePermission permission="([^"]+)">/gu),
].map((m) => ({ route: `/administration/${m[1] as string}`, permission: m[2] as string }));

/** The routed screens that have no row, each with the page that links to it. */
const ROWLESS: Record<string, { page: string; link: RegExp }> = {
  // The item record, opened from its register's row.
  '/administration/items/:id': {
    page: 'pages/ItemsPage.tsx',
    link: /navigate\(`\/administration\/items\/\$\{item\.id\}`\)/u,
  },
};

describe('the Administrative Affairs category', () => {
  it('is seeded under its own English name — never System Administration’s', () => {
    expect(category, 'the category').toBeDefined();
    expect(category?.ar).toBe('الشئون الإدارية');
    expect(NAVIGATION_CATALOG.filter((c) => c.en === 'Administration')).toHaveLength(1);
  });

  it('sits right after ATM in the catalog, ordered between ATM and System Administration', () => {
    const order = NAVIGATION_CATALOG.map((c) => c.en);
    expect(order.indexOf('Administrative Affairs')).toBe(order.indexOf('ATM') + 1);
    expect(order.indexOf('Administration')).toBe(order.indexOf('Administrative Affairs') + 1);
    const sortOf = (en: string): number =>
      NAVIGATION_CATALOG.find((c) => c.en === en)?.sortOrder ?? NaN;
    expect(category?.sortOrder).toBe(29);
    expect(sortOf('ATM')).toBeLessThan(29);
    expect(sortOf('Administration')).toBeGreaterThan(29);
    // Outside the spans the HR-sections and Operations specs read as text.
    const at = SEED.indexOf("en: 'Administrative Affairs',");
    expect(at).toBeGreaterThan(SEED.indexOf("en: 'ATM',"));
    expect(at).toBeGreaterThan(SEED.indexOf("en: 'Organization',"));
    expect(at).toBeGreaterThan(SEED.indexOf("en: 'Fleet',"));
  });

  it('keeps its icon line directly above its sortOrder — the launcher spec reads it there', () => {
    expect(SEED).toMatch(
      /en: 'Administrative Affairs',\n\s*ar: 'الشئون الإدارية',\n(?:\s*\/\/.*\n)*\s*icon: 'box',\n\s*sortOrder: 29,/u,
    );
  });

  it('ships no sections and no retirements yet (OD-62 A)', () => {
    expect(category?.retired).toBeUndefined();
    expect(category?.iconRevision).toBeUndefined();
  });
});

describe('the rows', () => {
  it('are the four Phase 1 screens, in order', () => {
    expect(rows.map((row) => [row.en, row.ar, row.route])).toEqual([
      ['Administrative Affairs Home', 'الرئيسية', '/administration'],
      ['Warehouses', 'المخازن', '/administration/warehouses'],
      ['Items', 'الأصناف', '/administration/items'],
      ['Units and categories', 'وحدات القياس والتصنيفات', '/administration/catalogs'],
    ]);
  });

  it('use keys the module actually declares — no parallel permission system', () => {
    const declared = new Set(administrationPermissions.map((p) => p.key));
    for (const row of rows) expect(declared.has(row.permission), row.route).toBe(true);
  });

  it('key the home on the items key — the index itself carries no guard', () => {
    expect(rows.find((row) => row.route === '/administration')?.permission).toBe(
      'administrationItem.view',
    );
    expect(ROUTES).toContain('<Route index element={<AdministrationHomePage />} />');
  });

  it('match the permission the client route guard checks, route by route', () => {
    expect(FRONTEND_ROUTES.length).toBeGreaterThan(0);
    const guardOf = new Map(FRONTEND_ROUTES.map((r) => [r.route, r.permission]));
    for (const row of rows) {
      if (row.route === '/administration') continue;
      expect(guardOf.get(row.route), `${row.route} guard`).toBe(row.permission);
    }
  });

  it('use only icon names the sidebar registry resolves, none twice', () => {
    // An unregistered name falls back silently to a neutral glyph, which looks like a choice.
    const registry = read('../../web/src/platform/navigation/app-icon.tsx');
    const known = new Set([...registry.matchAll(/^ {2}([a-z]+):/gmu)].map((m) => m[1] as string));
    expect(known.size).toBeGreaterThan(10);
    for (const row of rows)
      expect(known.has(row.icon), `${row.route} icon '${row.icon}'`).toBe(true);
    expect(known.has(category?.icon ?? ''), `category icon '${category?.icon ?? ''}'`).toBe(true);
    expect(rows.map((row) => row.icon)).toEqual(['home', 'warehouse', 'box', 'tag']);
    expect(new Set(rows.map((row) => row.icon)).size).toBe(rows.length);
  });
});

describe('no shipped screen is unreachable', () => {
  it('gives every guarded route a row, or names the page that links to it', () => {
    const catalogued = new Set(rows.map((row) => row.route));
    const unlinked = FRONTEND_ROUTES.filter((r) => !catalogued.has(r.route)).flatMap((r) => {
      const rowless = ROWLESS[r.route];
      if (rowless === undefined) return [r.route];
      return rowless.link.test(read(`${WEB}/${rowless.page}`)) ? [] : [`${r.route} (no link)`];
    });
    expect(unlinked, 'routed screens with neither a row nor a page linking to them').toEqual([]);
  });

  it('names no rowless screen that has a row, or that is not routed', () => {
    const routed = new Set(FRONTEND_ROUTES.map((r) => r.route));
    for (const route of Object.keys(ROWLESS)) {
      expect(routed.has(route), route).toBe(true);
      expect(rows.map((row) => row.route)).not.toContain(route);
    }
  });

  it('points every row at a route the frontend serves', () => {
    const served = new Set(['/administration', ...FRONTEND_ROUTES.map((r) => r.route)]);
    expect(rows.filter((row) => !served.has(row.route)).map((row) => row.route)).toEqual([]);
  });
});
