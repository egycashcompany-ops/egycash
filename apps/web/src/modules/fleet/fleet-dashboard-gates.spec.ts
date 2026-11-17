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
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PAGELESS_SECTIONS,
  FLEET_DASHBOARD_PAGE_KEYS,
  FLEET_DASHBOARD_PART_SECTIONS,
  FLEET_DASHBOARD_PERIOD_KEYS,
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
/**
 * The sections that open the page: every gate but a PART's (drawn only inside a tab already seen)
 * and a PAGELESS one's (it reads R2, beside a tab another section already shows).
 */
const PAGE_SECTIONS = SECTIONS.filter(
  (section) =>
    !(FLEET_DASHBOARD_PART_SECTIONS as readonly string[]).includes(section) &&
    !(FLEET_DASHBOARD_PAGELESS_SECTIONS as readonly string[]).includes(section),
);

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
  it('opens for a reader holding ANY key of any section — the union of the gates, parts and PAGELESS left out', () => {
    expect(GUARDS.get('index')).toEqual(['anyOf:FLEET_DASHBOARD_PAGE_KEYS']);
    expect(ROUTES).toContain("import { FLEET_DASHBOARD_PAGE_KEYS } from '@ecms/contracts';");
    const union = new Set(PAGE_SECTIONS.flatMap((section) => fleetDashboardGateKeys(section)));
    expect([...FLEET_DASHBOARD_PAGE_KEYS].sort()).toEqual([...union].sort());
  });

  it('never opens on the supply contracts’ key alone — a part of «توزيع السيارات», not a section of the page', () => {
    expect(FLEET_DASHBOARD_PART_SECTIONS).toEqual(['supplyContracts']);
    // The part's gate IS the contracts screen's guard, so its «فتح» never lands on a 403…
    expect(GUARDS.get('vehicle-contracts')).toEqual(['fleetVehicleContract.view']);
    expect(fleetDashboardGateKeys('supplyContracts')).toEqual(['fleetVehicleContract.view']);
    // …and holding it opens nothing on the dashboard (no new permission key, no access widened).
    expect(FLEET_DASHBOARD_PAGE_KEYS).not.toContain('fleetVehicleContract.view');
    expect(dashboardReads((key) => key === 'fleetVehicleContract.view')).toEqual({
      now: false,
      period: false,
      custody: false,
    });
  });

  it('never opens on the licence expenses’ key alone — PAGELESS: it reads R2, it opens no page', () => {
    expect(FLEET_DASHBOARD_PAGELESS_SECTIONS).toEqual(['licenceSpend']);
    expect(GUARDS.get('license-expenses')).toEqual(['fleetLicenseExpense.view']);
    expect(fleetDashboardGateKeys('licenceSpend')).toEqual(['fleetLicenseExpense.view']);
    expect(FLEET_DASHBOARD_PERIOD_KEYS).toContain('fleetLicenseExpense.view');
    expect(FLEET_DASHBOARD_PAGE_KEYS).not.toContain('fleetLicenseExpense.view');
    expect(FLEET_DASHBOARD_NOW_KEYS).not.toContain('fleetLicenseExpense.view');
  });

  it('gains no key from the overview’s two new sections — no new permission key', () => {
    // «مخالفات قائمة» is gated as the year's fines, «زيارات الصيانة» by exit day as the visits.
    expect(fleetDashboardGateKeys('violationsOpen')).toEqual(
      fleetDashboardGateKeys('violationsYear'),
    );
    expect(fleetDashboardGateKeys('exits')).toEqual(fleetDashboardGateKeys('visits'));
    const before = new Set(
      PAGE_SECTIONS.filter(
        (section) => section !== 'violationsOpen' && section !== 'exits',
      ).flatMap((section) => fleetDashboardGateKeys(section)),
    );
    expect([...FLEET_DASHBOARD_PAGE_KEYS].sort()).toEqual([...before].sort());
  });

  it('gains no key from the two new tabs’ sections — each is gated as the screen it opens', () => {
    // «المخالفات المرورية والتسويات»: the period's fines and their rows are the register's.
    for (const section of ['violations', 'violationList'] as const) {
      expect(fleetDashboardGateKeys(section)).toEqual(fleetDashboardGateKeys('violationsYear'));
      expect(FLEET_DASHBOARD_GATES[section].read).toBe('period');
    }
    // «الوقود والمصروفات»: the flagged cards on the charging screen, the sheet card on the
    // reconcile screen (both behind the charging guard), the day series as the receipts, the
    // invoices' rows as the dealership.
    expect(fleetDashboardGateKeys('fuelCardList')).toEqual(fleetDashboardGateKeys('fuelCharging'));
    expect(fleetDashboardGateKeys('fuelSheets')).toEqual(fleetDashboardGateKeys('fuelCharging'));
    expect(FLEET_DASHBOARD_GATES.fuelSheets.path).toBe('/fleet/fuel-cards/reconcile');
    expect(fleetDashboardGateKeys('opexSeries')).toEqual(fleetDashboardGateKeys('opex'));
    expect(fleetDashboardGateKeys('dealershipList')).toEqual(fleetDashboardGateKeys('dealership'));
    const before = new Set(
      PAGE_SECTIONS.filter(
        (section) =>
          ![
            'violations',
            'violationList',
            'fuelCardList',
            'fuelSheets',
            'opexSeries',
            'dealershipList',
          ].includes(section),
      ).flatMap((section) => fleetDashboardGateKeys(section)),
    );
    expect([...FLEET_DASHBOARD_PAGE_KEYS].sort()).toEqual([...before].sort());
  });

  it('gains no key from «العهدة» and «التراخيص والتجديدات» — the R2 union grows by two, the page by none', () => {
    // «العهدة»'s period states are the receipts' AND the custody fund's (the custody spend
    // screen's guard); «مصروفات التراخيص» is the licence register's, PAGELESS.
    expect([...fleetDashboardGateKeys('custodyStates')].sort()).toEqual([
      'fleetCustody.view',
      'fleetReceipt.view',
    ]);
    expect(FLEET_DASHBOARD_GATES.custodyStates).toMatchObject({
      read: 'period',
      page: ['fleetCustody.view'],
      path: '/fleet/custody-expenses',
    });
    expect(FLEET_DASHBOARD_GATES.licenceSpend).toMatchObject({
      read: 'period',
      path: '/fleet/license-expenses',
    });
    const before = new Set(
      PAGE_SECTIONS.filter((section) => section !== 'custodyStates').flatMap((section) =>
        fleetDashboardGateKeys(section),
      ),
    );
    expect([...FLEET_DASHBOARD_PAGE_KEYS].sort()).toEqual([...before].sort());
    for (const key of ['fleetCustody.view', 'fleetLicenseExpense.view'])
      expect(FLEET_DASHBOARD_PERIOD_KEYS).toContain(key);
    // «آخر ما سُجّل» is retired: its two sections are gone, and their keys stay the page's.
    expect(SECTIONS).not.toContain('recentWorkshop');
    expect(SECTIONS).not.toContain('recentAccidents');
    for (const key of ['fleetMaintenance.view', 'fleetAccident.view'])
      expect(FLEET_DASHBOARD_PAGE_KEYS).toContain(key);
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

  it('sends R2 too for a violations-only reader — the period’s fines are its own (PERIOD_KEYS)', () => {
    expect(FLEET_DASHBOARD_PERIOD_KEYS).toContain('fleetViolation.view');
    expect(FLEET_DASHBOARD_NOW_KEYS).toContain('fleetViolation.view');
    expect(dashboardReads(holding('fleetViolation.view'))).toEqual({
      now: true,
      period: true,
      custody: false,
    });
    // The R2 union is exactly the period gates' keys.
    const period = new Set(
      SECTIONS.filter((section) => FLEET_DASHBOARD_GATES[section].read === 'period').flatMap(
        (section) => fleetDashboardGateKeys(section),
      ),
    );
    expect([...FLEET_DASHBOARD_PERIOD_KEYS].sort()).toEqual([...period].sort());
  });

  it('mounts the custody hooks only with `fleetCustody.view` — and sends no R2 on it alone (plan D5)', () => {
    // The custody key is an R2 key now (`custodyStates`), but it answers no section without the
    // receipts': R2 goes out only when some period section is fully permitted.
    expect(FLEET_DASHBOARD_PERIOD_KEYS).toContain('fleetCustody.view');
    expect(dashboardReads(holding('fleetCustody.view'))).toEqual({
      now: false,
      period: false,
      custody: true,
    });
    expect(dashboardReads(holding('fleetCustody.view', 'fleetReceipt.view'))).toEqual({
      now: false,
      period: true,
      custody: true,
    });
  });

  it('sends R2 for the licence expenses only beside a licences section (PAGELESS), a licensing-only reader R1 alone', () => {
    // The key alone: no tab draws its section, so nothing is sent.
    expect(dashboardReads(holding('fleetLicenseExpense.view'))).toEqual({
      now: false,
      period: false,
      custody: false,
    });
    // A custody clerk with it: «العهدة» shows, «التراخيص والتجديدات» does not — still no R2.
    expect(dashboardReads(holding('fleetCustody.view', 'fleetLicenseExpense.view'))).toEqual({
      now: false,
      period: false,
      custody: true,
    });
    // Beside the board's papers (the licences tab shows): the spend band reads R2.
    expect(dashboardReads(holding('fleetLicensing.view', 'fleetLicenseExpense.view'))).toEqual({
      now: true,
      period: true,
      custody: false,
    });
    expect(dashboardReads(holding('fleetLicensing.view'))).toEqual({
      now: true,
      period: false,
      custody: false,
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
