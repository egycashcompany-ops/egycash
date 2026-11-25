// The Administrative Affairs surface, checked as source (design §13.4, "Specs that hold the tree
// together"). Each guards a mistake no render test catches, because the broken version renders
// perfectly well:
//
// 1. **Every route is permission-gated** but the index — which renders only the tiles the reader's
//    grants allow and says so when there are none — and the 404. A page reachable without its key
//    is a screen of refusals, and a reviewer reading the routes cannot tell what is protected.
// 2. **Only the module's own keys** gate its routes, and literal segments come before `:id`.
// 3. **The header comment is the route → key table**, every route on it with its guard.
// 4. **Navigation never links to a route that does not exist**, each row asks the key its route
//    guard asks, and each row's label is the page's title, word for word, in both languages.
// 5. **The mount** sits inside `RequireAuth`, above the platform's `/` and the `/*` catch-all.
// 6. **The home's tiles** are served routes, on their guards, with a sidebar row each.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../platform/localization/i18n';
import { ADMINISTRATION_SHORTCUTS } from './pages/AdministrationHomePage';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
const APP = readFileSync(resolve(HERE, '../../platform/app/App.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

/** `path="x"` → the declared child paths of the subtree. */
const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** The keys guarding the route declared at `path`, as its block writes them. */
const guardOf = (path: string): string[] => {
  const at = ROUTES.indexOf(`path="${path}"`);
  expect(at, path).toBeGreaterThan(-1);
  const block = ROUTES.slice(at, ROUTES.indexOf('</RequirePermission>', at));
  return [
    ...block.matchAll(/<RequirePermission (?:permission="([^"]+)"|anyOf=\{\[([^\]]+)\]\})>/g),
  ].flatMap((m) =>
    m[1] !== undefined
      ? [m[1]]
      : [...(m[2] ?? '').matchAll(/'([^']+)'/g)].map((k) => k[1] as string),
  );
};

/** The Administrative Affairs block of the navigation catalog — from its category to the next. */
const catalogBlock = (): string => {
  const start = SEED.indexOf("en: 'Administrative Affairs',");
  const end = SEED.indexOf("en: 'Administration',", start);
  expect(start, 'the category').toBeGreaterThan(-1);
  expect(end, 'System Administration follows it').toBeGreaterThan(start);
  return SEED.slice(start, end);
};

interface NavRow {
  en: string;
  ar: string;
  route: string;
  permission: string;
}
const NAV_ROWS: NavRow[] = [
  ...catalogBlock().matchAll(
    /\{\s*en: '([^']+)',\s*ar: '([^']+)',\s*route: '([^']+)',\s*icon: '[^']+',\s*permission: '([^']+)',\s*\}/g,
  ),
].map((m) => ({
  en: m[1] as string,
  ar: m[2] as string,
  route: m[3] as string,
  permission: m[4] as string,
}));

describe('the Administrative Affairs routes', () => {
  const paths = declaredPaths();

  it('declare the Phase 1 surface — and no create, edit or act as a route', () => {
    expect([...paths].sort()).toEqual(
      ['catalogs', 'items', 'items/:id', 'suppliers', 'suppliers/:id', 'warehouses'].sort(),
    );
    for (const act of ['new', 'edit', 'create']) {
      expect(
        paths.filter((p) => p.split('/').includes(act)),
        act,
      ).toEqual([]);
    }
  });

  it('gate every one of them, the index and the 404 excepted', () => {
    const guarded = [...ROUTES.matchAll(/<RequirePermission (?:permission|anyOf)=/g)].length;
    expect(guarded).toBe(paths.length);
    expect(ROUTES).toContain('<Route index element={<AdministrationHomePage />} />');
    expect(ROUTES).toContain('<Route path="*" element={<NotFoundPage />} />');
    expect(ROUTES.indexOf('<Route element={<AppShell />}>')).toBeLessThan(
      ROUTES.indexOf('<Route index'),
    );
  });

  it('gate on the keys their endpoints take, and on this module’s keys only', () => {
    expect(guardOf('warehouses')).toEqual(['administrationWarehouse.view']);
    expect(guardOf('items')).toEqual(['administrationItem.view']);
    expect(guardOf('items/:id')).toEqual(['administrationItem.view']);
    expect(guardOf('catalogs')).toEqual(['administrationCatalog.manage']);
    expect(guardOf('suppliers')).toEqual(['administrationSupplier.view']);
    expect(guardOf('suppliers/:id')).toEqual(['administrationSupplier.view']);
    for (const path of paths) {
      for (const key of guardOf(path)) expect(key, path).toMatch(/^administration[A-Z]/u);
    }
  });

  it('declare every literal segment before an `:id` that would swallow it', () => {
    for (const path of paths.filter((p) => p.includes(':'))) {
      const parent = path.slice(0, path.indexOf('/:'));
      for (const literal of paths.filter((p) => p.startsWith(`${parent}/`) && !p.includes(':'))) {
        expect(ROUTES.indexOf(`path="${literal}"`), literal).toBeLessThan(
          ROUTES.indexOf(`path="${path}"`),
        );
      }
    }
  });

  it('name every route in the header table, with its guard', () => {
    expect(ROUTES).toMatch(/\/\/ {3}\/administration {2,}none/u);
    for (const path of paths) {
      const escaped = `/administration/${path}`.replaceAll('/', '\\/');
      const key = (guardOf(path)[0] ?? '').replace('.', '\\.');
      expect(ROUTES, path).toMatch(new RegExp(`// {3}${escaped} {2,}${key}`, 'u'));
    }
  });
});

describe('the mount', () => {
  it('is lazy, inside RequireAuth, above the platform’s `/` and the catch-all', () => {
    expect(APP).toContain(
      "const AdministrationRoutes = lazy(() => import('../../modules/administration/routes'));",
    );
    const at = APP.indexOf('path="/administration/*"');
    expect(at).toBeGreaterThan(-1);
    const block = APP.slice(at, APP.indexOf('/>\n', APP.indexOf('</RequireAuth>', at)));
    expect(block).toContain('<RequireAuth>');
    expect(block).toContain('<AdministrationRoutes />');
    expect(at).toBeLessThan(APP.indexOf('path="/"'));
    expect(at).toBeLessThan(APP.indexOf('path="/*"'));
  });
});

describe('the sidebar rows match the routes that exist', () => {
  it('finds the module’s five rows — the supplier register last (P1b.W)', () => {
    expect(NAV_ROWS.map((row) => row.route)).toEqual([
      '/administration',
      '/administration/warehouses',
      '/administration/items',
      '/administration/catalogs',
      '/administration/suppliers',
    ]);
  });

  it('points every row at a declared route', () => {
    const declared = new Set([
      '/administration',
      ...declaredPaths().map((p) => `/administration/${p}`),
    ]);
    expect(NAV_ROWS.filter((row) => !declared.has(row.route)).map((row) => row.route)).toEqual([]);
  });

  it('keys every row on its route’s guard — the home on the items key, as the design fixes it', () => {
    for (const row of NAV_ROWS) {
      if (row.route === '/administration') {
        expect(row.permission).toBe('administrationItem.view');
        continue;
      }
      expect(guardOf(row.route.replace('/administration/', '')), row.route).toEqual([
        row.permission,
      ]);
    }
  });

  it('gives each row the page’s own title, word for word, in both languages', () => {
    const KEYS: Record<string, string> = {
      '/administration': 'administration.nav.home',
      '/administration/warehouses': 'administration.nav.warehouses',
      '/administration/items': 'administration.nav.items',
      '/administration/catalogs': 'administration.nav.catalogs',
      '/administration/suppliers': 'administration.nav.suppliers',
    };
    for (const row of NAV_ROWS) {
      const key = KEYS[row.route] as string;
      expect(translate('en', key), row.route).toBe(row.en);
      expect(translate('ar', key), row.route).toBe(row.ar);
    }
  });

  it('names the category «الشئون الإدارية», never the System Administration’s English name', () => {
    expect(catalogBlock()).toContain("ar: 'الشئون الإدارية',");
    expect(translate('en', 'administration.module.title')).toBe('Administrative Affairs');
    expect(translate('ar', 'administration.module.title')).toBe('الشئون الإدارية');
  });
});

describe('the home’s tiles, the routes, the guards and the rows', () => {
  it('points every tile at a route this module serves', () => {
    const served = new Set([
      '/administration',
      ...declaredPaths().map((p) => `/administration/${p}`),
    ]);
    expect(ADMINISTRATION_SHORTCUTS.map((card) => card.to).filter((to) => !served.has(to))).toEqual(
      [],
    );
  });

  it.each(ADMINISTRATION_SHORTCUTS.map((card) => ({ card })))(
    'shows the $card.to tile on the key its route guard asks, under a sidebar row on that key',
    ({ card }) => {
      expect(guardOf(card.to.replace('/administration/', ''))).toEqual([card.permission]);
      expect(NAV_ROWS.find((row) => row.route === card.to)?.permission).toBe(card.permission);
      expect(card.titleKey).toMatch(/^administration\.nav\./u);
    },
  );

  it('offers every routed screen a tile but the records, which their registers open', () => {
    const tiled = new Set(ADMINISTRATION_SHORTCUTS.map((card) => card.to));
    const untiled = declaredPaths()
      .map((p) => `/administration/${p}`)
      .filter((route) => !tiled.has(route));
    expect(untiled).toEqual(['/administration/items/:id', '/administration/suppliers/:id']);
  });
});
