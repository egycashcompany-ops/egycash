// The machine map is reachable (docs/12-planning/atm-map-zones.md §8.1, §7.3, §7.4) — the
// `operations-navigation.spec.ts` join, read as source: the routes this module serves, behind the
// keys the spec names, and the overview card that points at them. The nav row «خريطة الماكينات» is
// the api's (seed-navigation.spec.ts); its route must be one this file serves.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATM_SHORTCUTS } from './pages/AtmOverviewPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, './routes.tsx'), 'utf8');

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

describe('routes.tsx serves the map', () => {
  it('/atm/map behind atmMap.view', () => {
    const block = routeBlock('map');
    expect(block).toContain('<MachineMapPage />');
    expect(keysOf(block)).toEqual(['atmMap.view']);
  });

  it('/atm/map/unlocated behind atmMap.view AND atmMachine.locate', () => {
    const block = routeBlock('map/unlocated');
    expect(block).toContain('<UnlocatedMachinesPage />');
    expect(keysOf(block)).toEqual(['atmMap.view', 'atmMachine.locate']);
  });

  it('names both routes in its header list', () => {
    expect(ROUTES).toMatch(/\/\/ {3}\/atm\/map {2,}atmMap\.view/);
    expect(ROUTES).toMatch(/\/\/ {3}\/atm\/map\/unlocated {2,}atmMap\.view \+ atmMachine\.locate/);
  });
});

describe('the ATM overview card', () => {
  it('points at /atm/map, shown to an atmMap.view holder', () => {
    const card = ATM_SHORTCUTS.find((shortcut) => shortcut.to === '/atm/map');
    expect(card).toMatchObject({
      titleKey: 'atm.nav.map',
      descKey: 'atm.cards.map',
      permission: 'atmMap.view',
    });
  });

  it('every overview card is a route this module serves', () => {
    const served = new Set([
      '/atm',
      ...[...ROUTES.matchAll(/path="([^"*]+)"/g)].map((m) => `/atm/${m[1] as string}`),
    ]);
    expect(ATM_SHORTCUTS.map((s) => s.to).filter((to) => !served.has(to))).toEqual([]);
  });
});
