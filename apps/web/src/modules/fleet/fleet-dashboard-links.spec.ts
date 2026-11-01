// «لوحة تحكم الحركة» — the ONE link builder (plan R-28, unified.md §6.2). A figure on the dashboard
// opens the screen that shows the same number, so every link it can make is pinned here:
//   · it names a real route of the fleet module;
//   · no list link is bare (a bare list URL restores the reader's remembered filters, CR-11) — only a
//     record and the two screens that keep no filter may be named by their path alone;
//   · every link that counts over days carries those days explicitly, from the server's echo;
//   · a type, operation or branch travels as `type` / `operation` / `branch`, whatever its size;
//   · a figure with no exact list gets no link (`null`), never an approximate one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLEET_DASHBOARD_GATES,
  addDaysYmd,
  licenceWindows,
  type FleetDashboardSection,
  type FleetDashboardVehicleScopeDto,
} from '@ecms/contracts';
import {
  LINK_CODES_CAP,
  PATH_ONLY,
  custodyDashboardLink,
  nowLinks,
  periodLinks,
  type DashLink,
} from './lib/fleet-dashboard-links';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(join(HERE, 'routes.tsx'), 'utf8');

/** Every route the fleet module serves, as `/fleet/<path>` patterns. */
const routePatterns = (): RegExp[] =>
  [...ROUTES.matchAll(/path="([^"]+)"/gu)]
    .map((m) => m[1] as string)
    .filter((path) => path !== '*')
    .map((path) => new RegExp(`^/fleet/${path.replace(/:[a-zA-Z]+\??/gu, '[^/?]+')}$`, 'u'));
const ROUTE_RES = routePatterns();
const isRoute = (pathname: string): boolean => ROUTE_RES.some((re) => re.test(pathname));

const TODAY = '2026-11-01';
const parse = (link: DashLink): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = link.to.split('?');
  return { pathname, params: new URLSearchParams(search) };
};
const ids = (n: number, base: number): string[] =>
  Array.from({ length: n }, (_, i) => (base + i).toString(16).padStart(24, '0'));
const codes = (n: number): string[] => Array.from({ length: n }, (_, i) => String(100 + i));

const NOW = nowLinks({ today: TODAY, branchId: null });
const NOW_BRANCH = nowLinks({ today: TODAY, branchId: 'b1' });
const NO_SET: FleetDashboardVehicleScopeDto = {
  count: null,
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
  branchId: null,
};
const RANGE = { from: '2026-10-01', to: '2026-10-31' };

/** Every link the builder can emit, each builder called with representative arguments. */
const everyLink = (): DashLink[] => {
  const all: (DashLink | null)[] = [];
  for (const L of [NOW, NOW_BRANCH]) {
    all.push(
      L.alarm('red', null),
      L.alarm('yellow', ['133']),
      L.vehicleLicencesExpired(),
      L.vehicleLicencesExpiring(30),
      L.vehicleLicencesSoon(30),
      L.vehicleLicencesWithin60(),
      L.vehicle('v1', 'licenceVehicles.row'),
      L.driverLicencesExpired(),
      L.driverLicencesExpiring(30),
      L.driverLicencesSoon(30),
      L.driverLicencesNotRecorded(),
      L.fuelCardsExpired(),
      L.fuelCardsExpiring(30),
      L.crewGap(),
      L.charging('requested'),
      L.charging('low'),
      L.charging('charged'),
      L.chargingCompany('wataniya'),
      L.chargingCompany('chillout'),
      L.dealershipPending(),
      L.noticesOpen(),
      L.noticesCheckImage(),
      L.custodyDashboard('custodyFund.lines'),
      L.custodyExpenses(),
      L.noReading(['304', '112']),
      L.neverRead(['318']),
      L.vehiclesActive(),
      L.vehiclesOutOfService(),
      L.rosterReady(),
      L.rosterUnmanned(),
      L.rosterWorkshop(),
      L.rosterAvailable(),
      L.rosterAbsent('fleetUnavailability'),
      L.rosterAbsent('hrLeave'),
      L.rosterUnavailable('profileInactive', 'roster.profileInactive'),
      L.attendance(),
      L.workshopOpen(),
      L.vehiclesBy({ typeId: 't1', branchId: 'b1' }, 'distributionVehicles.cell'),
      L.vehiclesBy({}, 'distributionVehicles.total'),
      L.vehiclesBy({ operationIds: ['o1', 'o2'] }, 'distributionVehicles.cash'),
      L.drivers(),
      L.driversBySpec(['s1'], 'distributionDrivers.cash'),
      L.licensing('insurance'),
      L.licensing('tax'),
      L.visitDay('231', TODAY),
      L.accidentDay('154', TODAY),
      L.accidentsRecent(30),
      L.visitsRecent(30),
      L.accidentsOpen(),
      L.violationsCompany(2026),
      L.violationsDrivers(2026),
      L.violationsUnknown(2026),
      L.reconcile(),
    );
  }
  for (const scope of [
    NO_SET,
    { ...NO_SET, typeIds: ['t1'], branchId: 'b1', vehicleCodes: ['133'] },
  ]) {
    const P = periodLinks({ range: RANGE, vehicleScope: scope });
    all.push(
      P.km(),
      P.carKm('133', 'km.top'),
      P.vehicle('v1', 'km.vehicle'),
      P.visits(),
      P.visits('visits.closed', { state: 'closed' }),
      P.visits('visits.workType', { workTypes: ['w1'] }),
      P.accidents(),
      P.accidents('accidents.open', 'open'),
      P.accidentDay('154', '2026-10-05'),
      P.opex(),
      P.opex('opex.card', 'card'),
      P.opexCustody(),
      P.dealership(),
    );
  }
  return all.flatMap((link) => (link === null ? [] : [link]));
};

describe('every link the dashboard can make', () => {
  const links = everyLink();

  it('names a real route of the fleet module', () => {
    expect(links.filter((link) => !isRoute(parse(link).pathname)).map((l) => l.to)).toEqual([]);
  });

  it('is never a bare list link — only a record or a screen that keeps no filter goes without a query', () => {
    const bare = links.filter((link) => !link.to.includes('?'));
    const allowed = (to: string): boolean =>
      PATH_ONLY.includes(to) || /^\/fleet\/vehicles\/[^/?]+$/u.test(to);
    expect(bare.filter((link) => !allowed(link.to)).map((l) => l.to)).toEqual([]);
    expect(PATH_ONLY).toEqual(['/fleet/custody/dashboard', '/fleet/fuel-cards/reconcile']);
  });

  it('names its figure as <section>.<field>, the section one of the gated sections', () => {
    const sections = new Set<string>(Object.keys(FLEET_DASHBOARD_GATES));
    expect(
      links.filter((link) => !sections.has(link.metric.split('.')[0] ?? '')).map((l) => l.metric),
    ).toEqual([]);
  });

  it('carries every day it counts over, explicitly, from the echo', () => {
    const dated: [string, string[]][] = [
      ['/fleet/roster', ['date']],
      ['/fleet/attendance', ['date']],
      ['/fleet/odometer', ['from', 'to', 'period']],
      ['/fleet/custody-expenses', ['from', 'to']],
      ['/fleet/receipts', ['from', 'to']],
      ['/fleet/dealership', ['from', 'to', 'state']],
      ['/fleet/accidents', ['from', 'to', 'status']],
      ['/fleet/maintenance', ['from', 'to', 'state']],
      ['/fleet/violations', ['year']],
    ];
    for (const link of links) {
      const { pathname, params } = parse(link);
      const rule = dated.find(([path]) => path === pathname);
      if (rule === undefined) continue;
      expect(
        rule[1].some((p) => params.has(p)),
        link.to,
      ).toBe(true);
    }
    expect(parse(NOW.rosterReady()).params.get('date')).toBe(TODAY);
    expect(parse(NOW.custodyExpenses()).params.get('from')).toBe(addDaysYmd(TODAY, -29));
    expect(parse(NOW.custodyExpenses()).params.get('to')).toBe(TODAY);
  });
});

describe('the licence windows (R-02, R-10)', () => {
  it('are the contracts’ disjoint windows, on the vehicles and the drivers screens alike', () => {
    const w = licenceWindows(TODAY, 30);
    const expired = parse(NOW.vehicleLicencesExpired()).params;
    expect(expired.get('status')).toBe('active');
    expect(expired.get('licExpBefore')).toBe(w.expired.to);
    expect(expired.has('licExpFrom')).toBe(false);
    const expiring = parse(NOW.vehicleLicencesExpiring(30)).params;
    expect([expiring.get('licExpFrom'), expiring.get('licExpBefore')]).toEqual([
      w.expiring.from,
      w.expiring.to,
    ]);
    const soon = parse(NOW.vehicleLicencesSoon(30) as DashLink).params;
    expect([soon.get('licExpFrom'), soon.get('licExpBefore')]).toEqual([w.soon?.from, w.soon?.to]);
    const drivers = parse(NOW.driverLicencesExpiring(30)).params;
    expect([drivers.get('licExpFrom'), drivers.get('licExpBefore')]).toEqual([
      w.expiring.from,
      w.expiring.to,
    ]);
  });

  it('has no grey window, and so no link, when the warning reaches 60 days', () => {
    expect(NOW.vehicleLicencesSoon(60)).toBeNull();
    expect(NOW.driverLicencesSoon(75)).toBeNull();
  });

  it('opens the drivers without a licence date on `licExp=none`', () => {
    expect(NOW.driverLicencesNotRecorded().to).toBe('/fleet/drivers?licExp=none');
  });

  it('bounds the expiring fuel cards on both sides, so expired cards stay out (T4.7)', () => {
    const p = parse(NOW.fuelCardsExpiring(30)).params;
    expect([p.get('expiresFrom'), p.get('expiresBefore')]).toEqual([
      addDaysYmd(TODAY, 1),
      addDaysYmd(TODAY, 30),
    ]);
  });
});

describe('the branch and the vehicle set travel as filters', () => {
  it('adds `branch` to the branch-scoped screens when a branch is chosen, and only then', () => {
    expect(parse(NOW.workshopOpen()).params.has('branch')).toBe(false);
    for (const link of [
      NOW_BRANCH.workshopOpen(),
      NOW_BRANCH.dealershipPending(),
      NOW_BRANCH.accidentsOpen(),
      NOW_BRANCH.drivers(),
      NOW_BRANCH.driverLicencesExpired(),
      NOW_BRANCH.violationsUnknown(2026),
    ]) {
      expect(parse(link).params.get('branch'), link.to).toBe('b1');
    }
    // The company-wide sources take no branch (fuel, notices).
    expect(parse(NOW_BRANCH.charging('low')).params.has('branch')).toBe(false);
    expect(parse(NOW_BRANCH.noticesOpen()).params.has('branch')).toBe(false);
  });

  it('keeps a 60-car type a link: the type goes as `type`, never as a list of codes', () => {
    const many = ids(60, 0x100);
    const P = periodLinks({ range: RANGE, vehicleScope: { ...NO_SET, count: 60, typeIds: many } });
    for (const link of [P.km(), P.visits(), P.accidents(), P.opex(), P.dealership()]) {
      const params = parse(link).params;
      expect(params.get('type')?.split(','), link.to).toEqual(many);
      expect(params.has('vehicleCodes'), link.to).toBe(false);
      expect([params.get('from'), params.get('to')]).toEqual([RANGE.from, RANGE.to]);
    }
  });

  it('carries operation, branch and the reader’s own codes under the screens’ names', () => {
    const P = periodLinks({
      range: RANGE,
      vehicleScope: {
        count: 3,
        typeIds: [],
        operationIds: ['o1'],
        vehicleCodes: ['133', '207'],
        branchId: 'b1',
      },
    });
    const p = parse(P.km()).params;
    expect([p.get('operation'), p.get('branch'), p.get('vehicleCodes')]).toEqual([
      'o1',
      'b1',
      '133,207',
    ]);
  });

  it('sends the custody part of the spend to «مصروفات العهدة» only when nothing but codes narrows (D20)', () => {
    const plain = periodLinks({
      range: RANGE,
      vehicleScope: { ...NO_SET, vehicleCodes: ['133'] },
    }).opexCustody();
    expect(parse(plain).pathname).toBe('/fleet/custody-expenses');
    const typed = periodLinks({
      range: RANGE,
      vehicleScope: { ...NO_SET, typeIds: ['t1'] },
    }).opexCustody();
    expect(parse(typed).pathname).toBe('/fleet/receipts');
    expect(parse(typed).params.get('source')).toBe('custody');
  });

  it('opens the vehicles of the operations a kind matched — all of them (T3.5)', () => {
    expect(
      parse(NOW.vehiclesBy({ operationIds: ['o1', 'o2'] }, 'distributionVehicles.cash')).params.get(
        'operation',
      ),
    ).toBe('o1,o2');
  });
});

describe('a figure with no exact list has no link', () => {
  it('narrows the alarms to the branch’s cars, and drops the link over the screens’ cap (D19)', () => {
    expect(NOW.alarm('red', null)?.to).toBe('/fleet/maintenance-alarms?level=red');
    expect(NOW.alarm('red', ['133', '207'])?.to).toBe(
      '/fleet/maintenance-alarms?level=red&vehicleCodes=133,207',
    );
    expect(NOW.alarm('red', [])).toBeNull();
    expect(NOW.alarm('red', codes(LINK_CODES_CAP + 1))).toBeNull();
    expect(NOW.alarm('red', codes(LINK_CODES_CAP))).not.toBeNull();
  });

  it('opens the stale cars’ whole history, and gives no link past 50 of them (T1.12)', () => {
    expect(NOW.noReading(['304'])?.to).toBe('/fleet/odometer?vehicleCodes=304&period=all');
    expect(NOW.noReading(codes(LINK_CODES_CAP + 1))).toBeNull();
    expect(NOW.noReading([])).toBeNull();
    expect(NOW.neverRead([])).toBeNull();
  });

  it('gives a specialisation figure no link when no catalog item matched', () => {
    expect(NOW.driversBySpec([], 'distributionDrivers.atm')).toBeNull();
  });
});

describe('the custody figures', () => {
  it('open «لوحة تحكم العهدة» by its path, with no R1 echo needed (T1.11, D3)', () => {
    const sections: FleetDashboardSection[] = ['custodyFund'];
    const link = custodyDashboardLink('custodyFund.total');
    expect(link.to).toBe(FLEET_DASHBOARD_GATES[sections[0] as FleetDashboardSection].path);
  });
});
