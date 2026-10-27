// The settlement screens are reachable, each behind its key (docs/12-planning/
// atm-settlements-phase1.md §9.1, §7.3, §9.8) — read as source, the `atm-map-navigation.spec.ts`
// join: the routes this module serves, the guard on each, the header list naming them, the overview
// cards pointing at them, and the API's nav rows asking the same key the route guard asks.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATM_SHORTCUTS } from './pages/AtmOverviewPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, './routes.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

/** The JSX of one `<Route path="…">`, up to the route after it. */
const routeBlock = (path: string): string => {
  const start = ROUTES.indexOf(`path="${path}"`);
  if (start < 0) return '';
  const next = ROUTES.indexOf('<Route', start);
  return ROUTES.slice(start, next < 0 ? undefined : next);
};

/** The keys a route's guards ask, outermost first. */
const keysOf = (block: string): string[] =>
  [...block.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1] as string);

/** The five screens: path under /atm, page, guard. */
const SCREENS = [
  ['settlements/plans', 'SettlementPlanPage', 'atmSettlementPlan.view'],
  ['settlements/layouts', 'CassetteLayoutsPage', 'atmCassetteLayout.view'],
  ['settlements/layouts/import', 'LayoutImportPage', 'atmCassetteLayout.import'],
  ['preparation', 'PreparationPage', 'atmPreparation.view'],
  ['control', 'ControlPage', 'atmControl.view'],
] as const;

/** The nav row of a route in the API's seed: its `permission`. */
const navPermission = (route: string): string | null => {
  const at = SEED.indexOf(`route: '${route}'`);
  if (at < 0) return null;
  const tail = SEED.slice(at, SEED.indexOf('}', at));
  return /permission: '([^']+)'/.exec(tail)?.[1] ?? null;
};

describe('routes.tsx serves the settlement screens', () => {
  it.each(SCREENS.map(([path, page, key]) => ({ path, page, key })))(
    '/atm/$path renders $page behind $key alone',
    ({ path, page, key }) => {
      const block = routeBlock(path);
      expect(block).toContain(`<${page} />`);
      expect(keysOf(block)).toEqual([key]);
    },
  );

  it('names every screen in its header list, with its guard', () => {
    for (const [path, , key] of SCREENS) {
      const escaped = `/atm/${path}`.replaceAll('/', '\\/');
      expect(ROUTES).toMatch(new RegExp(`// {3}${escaped} {2,}${key.replace('.', '\\.')}`));
    }
  });
});

describe('the overview cards and the nav rows', () => {
  const CARDS = [
    ['/atm/settlements/plans', 'settlementPlan', 'atmSettlementPlan.view'],
    ['/atm/settlements/layouts', 'cassetteLayouts', 'atmCassetteLayout.view'],
    ['/atm/preparation', 'preparation', 'atmPreparation.view'],
    ['/atm/control', 'control', 'atmControl.view'],
  ] as const;

  it.each(CARDS.map(([to, name, key]) => ({ to, name, key })))(
    'a card points at $to, shown to a $key holder',
    ({ to, name, key }) => {
      expect(ATM_SHORTCUTS.find((s) => s.to === to)).toMatchObject({
        titleKey: `atm.nav.${name}`,
        descKey: `atm.cards.${name}`,
        permission: key,
      });
    },
  );

  it('every overview card is a route this module serves', () => {
    const served = new Set([
      '/atm',
      ...[...ROUTES.matchAll(/path="([^"*]+)"/g)].map((m) => `/atm/${m[1] as string}`),
    ]);
    expect(ATM_SHORTCUTS.map((s) => s.to).filter((to) => !served.has(to))).toEqual([]);
  });

  it.each(CARDS.map(([to]) => ({ to })))(
    'the nav row of $to asks the key its route guard asks',
    ({ to }) => {
      const guard = keysOf(routeBlock(to.replace('/atm/', '')));
      expect(navPermission(to)).toBe(guard[0]);
    },
  );

  it('gives the import page no nav row of its own — it nests under the layouts', () => {
    expect(navPermission('/atm/settlements/layouts/import')).toBeNull();
  });
});
