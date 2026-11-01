// «لوحة تحكم الحركة» — the gates the server and the screens agree on (plan R-28, §5.5).
//
// A section is returned only to a reader holding its data's API key AND the guard of the screen its
// figure opens: a figure whose screen answers 403 would be a link to nowhere. `FLEET_DASHBOARD_GATES`
// names that guard (`page`) and that screen (`path`); this spec reads `routes.tsx` itself and pins the
// two to each other, so a route guard that moves without the gate (or the other way) fails here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_PAGE_KEYS,
  fleetDashboardGateKeys,
  type FleetDashboardSection,
} from '@ecms/contracts';
import { dashboardReads } from './pages/FleetDashboardPage';
import { sectionPermitted } from './lib/fleet-dashboard-tabs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(join(HERE, 'routes.tsx'), 'utf8');

/** Each `<Route>` of the module: its path (`index` for the home) and every guard it is wrapped in. */
const routeGuards = (): Map<string, string[]> => {
  const guards = new Map<string, string[]>();
  for (const chunk of ROUTES.split('<Route').slice(1)) {
    const path = /^\s+index\b/u.test(chunk) ? 'index' : /path="([^"]+)"/u.exec(chunk)?.[1];
    if (path === undefined) continue;
    const keys = [...chunk.matchAll(/permission="([^"]+)"/gu)].map((m) => m[1] as string);
    const anyOf = /anyOf=\{([A-Z_]+)\}/u.exec(chunk)?.[1];
    guards.set(path, anyOf === undefined ? keys : [`anyOf:${anyOf}`]);
  }
  return guards;
};

const GUARDS = routeGuards();
const SECTIONS = Object.keys(FLEET_DASHBOARD_GATES) as FleetDashboardSection[];

describe('every gate names the guard of the screen it links to', () => {
  it.each(SECTIONS)('%s', (section) => {
    const gate = FLEET_DASHBOARD_GATES[section];
    const route = gate.path.replace(/^\/fleet\//u, '');
    expect(GUARDS.has(route), `${gate.path} is a route of the module`).toBe(true);
    expect([...(GUARDS.get(route) ?? [])].sort()).toEqual([...gate.page].sort());
  });

  it('asks for the charging page’s guard AND the cards’ API key for the charging figures', () => {
    expect([...fleetDashboardGateKeys('fuelCharging')].sort()).toEqual([
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
    ]);
  });
});

describe('the home route', () => {
  it('opens for a reader holding ANY key of any section — the union of the gates', () => {
    expect(GUARDS.get('index')).toEqual(['anyOf:FLEET_DASHBOARD_PAGE_KEYS']);
    expect(ROUTES).toContain("import { FLEET_DASHBOARD_PAGE_KEYS } from '@ecms/contracts';");
    const union = new Set(SECTIONS.flatMap((section) => fleetDashboardGateKeys(section)));
    expect([...FLEET_DASHBOARD_PAGE_KEYS].sort()).toEqual([...union].sort());
  });
});

describe('a reader asks only for what a gate lets them see', () => {
  const holding =
    (...keys: string[]) =>
    (permission: string) =>
      keys.includes(permission);

  it('sends neither read and mounts no custody hook without a key', () => {
    expect(dashboardReads(holding())).toEqual({ now: false, period: false, custody: false });
  });

  it('sends R1 alone for a «الآن» key, R2 alone for a period-only key', () => {
    expect(dashboardReads(holding('fleetRoster.view'))).toEqual({
      now: true,
      period: false,
      custody: false,
    });
    expect(dashboardReads(holding('fleetReceipt.view'))).toEqual({
      now: false,
      period: true,
      custody: false,
    });
  });

  it('mounts the custody hooks only with `fleetCustody.view`', () => {
    expect(dashboardReads(holding('fleetCustody.view'))).toEqual({
      now: false,
      period: false,
      custody: true,
    });
  });

  it('never shows a section on its API key alone (the API key without the page guard is not enough)', () => {
    expect(sectionPermitted('fuelCharging', holding('fleetFuelCard.view'))).toBe(false);
    expect(
      sectionPermitted('fuelCharging', holding('fleetFuelCard.view', 'fleetFuelCharge.view')),
    ).toBe(true);
    expect(sectionPermitted('maintenanceAlarm', holding('fleetMaintenance.view'))).toBe(false);
  });
});
