// «لوحة تحكم الحركة» — the ONE link builder (plan R-28, unified.md §6.2). A figure on the dashboard
// opens the screen that shows the same number, so every link it can make is pinned here:
//   · it names a real route of the fleet module;
//   · no list link is bare (a bare list URL restores the reader's remembered filters, CR-11) — only a
//     record and the two screens that keep no filter may be named by their path alone;
//   · every link that counts over days carries those days explicitly, from the server's echo;
//   · a type, operation or branch travels as `type` / `operation` / `branch`, whatever its size — the
//     branch being the switcher's, else the reader's own branches («كل فروعي» as a list);
//   · a link to another tab of the page keeps the page's filters as they stand;
//   · a figure with no exact list gets no link (`null`), never an approximate one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLEET_DASHBOARD_GATES,
  addDaysYmd,
  licenceWindows,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardSection,
  type FleetDashboardVehicleScopeDto,
} from '@ecms/contracts';
import {
  LINK_CODES_CAP,
  PATH_ONLY,
  custodyDashboardLink,
  nowLinks,
  echoTabFilters,
  periodLinks,
  tabLink,
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
/** The index route — `/fleet` itself, the dashboard (a tab link opens another of its tabs). */
const ROUTE_RES = [...routePatterns(), ...(/<Route\s+index\b/u.test(ROUTES) ? [/^\/fleet$/u] : [])];
const isRoute = (pathname: string): boolean => ROUTE_RES.some((re) => re.test(pathname));

const TODAY = '2026-11-01';
const parse = (link: DashLink): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = link.to.split('?');
  return { pathname, params: new URLSearchParams(search) };
};
const ids = (n: number, base: number): string[] =>
  Array.from({ length: n }, (_, i) => (base + i).toString(16).padStart(24, '0'));
const codes = (n: number): string[] => Array.from({ length: n }, (_, i) => String(100 + i));

const B1_NAMED = { id: 'b1', name: { ar: 'القاهرة', en: 'Cairo' } };
const B2_NAMED = { id: 'b2', name: { ar: 'الجيزة', en: 'Giza' } };
const NOW = nowLinks({ today: TODAY, branchId: null, scopeBranches: null });
const NOW_BRANCH = nowLinks({ today: TODAY, branchId: 'b1', scopeBranches: [B1_NAMED] });
/** A reader of one branch with no switcher: the figures are that branch's (plan D9). */
const NOW_ONE = nowLinks({ today: TODAY, branchId: null, scopeBranches: [B1_NAMED] });
/** «كل فروعي»: two branches, no switcher. */
const NOW_MINE = nowLinks({ today: TODAY, branchId: null, scopeBranches: [B1_NAMED, B2_NAMED] });
const NO_SET: FleetDashboardVehicleScopeDto = {
  count: null,
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
  branchId: null,
  scopeBranches: null,
};
const MINE_SET: FleetDashboardVehicleScopeDto = {
  ...NO_SET,
  count: 39,
  scopeBranches: [B1_NAMED, B2_NAMED],
};
const RANGE = { from: '2026-10-01', to: '2026-10-31' };
/** An alarm as R1 sends it: `codes` null for the company, per level (≤ 50, else `[]`) narrowed. */
const ALARM = (
  red: number,
  yellow: number,
  codes: FleetDashboardNowAlarmDto['codes'],
): FleetDashboardNowAlarmDto => ({
  red,
  overdue: 0,
  yellow,
  codes,
  redKm: 300,
  yellowKm: 1000,
  rows: [],
});

/** Every link the builder can emit, each builder called with representative arguments. */
const everyLink = (): DashLink[] => {
  const all: (DashLink | null)[] = [];
  for (const L of [NOW, NOW_BRANCH, NOW_ONE, NOW_MINE]) {
    all.push(
      L.rosterCar('133'),
      L.rosterAbsentAll(),
      L.rosterUnavailableAll(),
      L.violationsOpen(),
      L.alarm('red', null),
      L.alarm('yellow', ['133']),
      L.alarmRow('red', '133'),
      L.alarmsAll(ALARM(2, 1, null)),
      L.alarmsAll(ALARM(1, 1, { red: ['133'], yellow: ['141'] })),
      L.workshopCar('141'),
      L.supplyContracts('supplyContracts.open'),
      L.supplyContracts('supplyContracts.red', 'red'),
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
      L.noticesOpenAll(),
      L.noticesOpenAll('notices.all'),
      L.noticeRow({ code: '207', number: '24117', date: '2026-10-12' }),
      L.noticeRow({ code: null, number: '7001', date: null }),
      L.noticeRow({ code: null, number: null, date: null }),
      L.accidentsOpenAll(),
      L.noReadingCar('112'),
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
      L.visitDay('231', TODAY, true),
      L.visitDay('295', '2026-10-31', false),
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
    {
      ...NO_SET,
      typeIds: ['t1'],
      branchId: 'b1',
      scopeBranches: [B1_NAMED],
      vehicleCodes: ['133'],
    },
    MINE_SET,
  ]) {
    const P = periodLinks({ range: RANGE, vehicleScope: scope });
    all.push(
      P.exits(),
      P.opexFuel(),
      P.km(),
      P.carKm('133', 'km.top'),
      P.carKmDay('154', '2026-10-11', 'km.invalidList.row'),
      P.vehiclesByCodes(['305', '318'], 'km.noDistance'),
      P.vehicle('v1', 'km.vehicle'),
      P.visits(),
      P.visits('visits.closed', { state: 'closed' }),
      P.exits('exits.byWorkType', { workTypes: ['w1'] }),
      P.exits('exits.byWorkshop', { workshops: ['s1'] }),
      P.exits('exits.topVehicle', { vehicleCodes: ['207'] }),
      P.accidents(),
      P.accidents('accidents.open', 'open'),
      P.accidentDay('154', '2026-10-05'),
      P.opex(),
      P.opex('opex.card', 'card'),
      P.opexCustody(),
      P.dealership(),
    );
  }
  const sp = new URLSearchParams('tab=overview&period=last30&type=t1');
  for (const tab of ['today', 'distribution', 'maintenance', 'accidents', 'period'] as const) {
    all.push(tabLink(tab, `${tab === 'today' ? 'roster' : 'visits'}.tab`, sp, [tab]));
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
      ['/fleet/maintenance', ['from', 'to', 'state', 'outFrom']],
      // A year's fines carry the year; «مخالفات قائمة» (every year) carries what is still owed.
      ['/fleet/violations', ['year', 'cset']],
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

describe('a recent workshop row (T4.8, R-12)', () => {
  it('opens an open visit on its check-in day and a closed one on its check-out day', () => {
    // The row's date is its business day: the check-in while open, the check-out once closed. The
    // screen's `from`/`to` bound the check-in, so a closed row must travel as `outFrom`/`outTo`.
    expect(NOW.visitDay('231', TODAY, true).to).toBe(
      `/fleet/maintenance?vehicleCodes=231&from=${TODAY}&to=${TODAY}`,
    );
    expect(NOW.visitDay('295', '2026-10-31', false).to).toBe(
      '/fleet/maintenance?vehicleCodes=295&outFrom=2026-10-31&outTo=2026-10-31',
    );
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
      // «سجل الحوادث» / «سجل الزيارات»: the lists above them are the branch's.
      NOW_BRANCH.accidentsRecent(30),
      NOW_BRANCH.visitsRecent(30),
    ]) {
      expect(parse(link).params.get('branch'), link.to).toBe('b1');
    }
    expect(parse(NOW.accidentsRecent(30)).params.has('branch')).toBe(false);
    expect(parse(NOW.visitsRecent(30)).params.has('branch')).toBe(false);
    expect(Object.fromEntries(parse(NOW_BRANCH.visitsRecent(30)).params)).toEqual({
      from: addDaysYmd(TODAY, -29),
      to: TODAY,
      branch: 'b1',
    });
    // The company-wide sources take no branch (fuel); the notices follow the car's branch.
    expect(parse(NOW_BRANCH.charging('low')).params.has('branch')).toBe(false);
    for (const link of [
      NOW_BRANCH.noticesOpen(),
      NOW_BRANCH.noticesCheckImage(),
      NOW_BRANCH.noticesOpenAll(),
      NOW_BRANCH.accidentsOpenAll(),
    ]) {
      expect(parse(link).params.get('branch'), link.to).toBe('b1');
    }
    expect(parse(NOW.noticesOpen()).params.has('branch')).toBe(false);
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
        scopeBranches: [B1_NAMED],
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

describe('the branch the figures cover (plan D12): the switcher, else the reader’s own branches', () => {
  it('sends a reader’s one branch, and «كل فروعي» as the list of both, to every branch-scoped screen', () => {
    for (const [L, branch] of [
      [NOW_ONE, 'b1'],
      [NOW_MINE, 'b1,b2'],
    ] as const) {
      for (const link of [
        L.workshopOpen(),
        L.dealershipPending(),
        L.accidentsOpen(),
        L.drivers(),
        L.driverLicencesExpired(),
        L.violationsOpen(),
        L.violationsCompany(2026),
        L.visitsRecent(30),
      ]) {
        expect(parse(link).params.get('branch'), link.to).toBe(branch);
      }
      // The company-wide sources still take no branch; the notices are the branch's cars'.
      expect(parse(L.charging('low')).params.has('branch')).toBe(false);
      for (const link of [
        L.noticesOpen(),
        L.noticesCheckImage(),
        L.noticesOpenAll('notices.all'),
        L.noticeRow({ code: '207', number: null, date: null }),
        L.accidentsOpenAll(),
      ]) {
        expect(parse(link as DashLink).params.get('branch'), link?.to).toBe(branch);
      }
    }
  });

  it('keeps the switcher’s branch exact when it names one inside the reader’s branches', () => {
    const L = nowLinks({ today: TODAY, branchId: 'b2', scopeBranches: [B1_NAMED, B2_NAMED] });
    expect(parse(L.workshopOpen()).params.get('branch')).toBe('b2');
  });

  it('narrows the period set the same way, and a row’s own branch still wins (km by branch)', () => {
    const P = periodLinks({ range: RANGE, vehicleScope: MINE_SET });
    expect(parse(P.km()).params.get('branch')).toBe('b1,b2');
    expect(parse(P.visits()).params.get('branch')).toBe('b1,b2');
    const row = periodLinks({ range: RANGE, vehicleScope: { ...MINE_SET, branchId: 'b2' } });
    expect(parse(row.km('km.byBranch')).params.get('branch')).toBe('b2');
  });

  it('sends the custody part to the receipts for a narrowed reader, «كل فروعي» included (D20)', () => {
    const mine = periodLinks({ range: RANGE, vehicleScope: MINE_SET }).opexCustody();
    expect(parse(mine).pathname).toBe('/fleet/receipts');
    expect(parse(mine).params.get('branch')).toBe('b1,b2');
    expect(parse(periodLinks({ range: RANGE, vehicleScope: NO_SET }).opexCustody()).pathname).toBe(
      '/fleet/custody-expenses',
    );
  });
});

describe('the links of «نظرة عامة» and «الحركة اليوم»', () => {
  it('opens a row of «سيارات بلا سائق اليوم» on the day’s board, searched for that car', () => {
    expect(NOW.rosterCar('133')).toEqual({
      to: `/fleet/roster?date=${TODAY}&q=133`,
      metric: 'roster.unmannedRows',
    });
  });

  it('opens «الغائبون اليوم» on the two absence reasons, and the unavailable on all five', () => {
    expect(NOW.rosterAbsentAll()).toEqual({
      to: `/fleet/roster?date=${TODAY}&unavailable=fleetUnavailability,hrLeave`,
      metric: 'roster.absent',
    });
    expect(NOW.rosterUnavailableAll()).toEqual({
      to: `/fleet/roster?date=${TODAY}&unavailable=profileInactive,notEmployed,fleetUnavailability,hrLeave,licenceExpired`,
      metric: 'roster.unavailable',
    });
  });

  it('opens «مخالفات قائمة» on every year’s unpaid fines — company and drivers, no year', () => {
    expect(NOW.violationsOpen()).toEqual({
      to: '/fleet/violations?cset=false&dset=false',
      metric: 'violationsOpen.total',
    });
    expect(NOW_BRANCH.violationsOpen().to).toBe(
      '/fleet/violations?cset=false&dset=false&branch=b1',
    );
  });

  it('counts the month’s visits by the day they LEFT the workshop — never by check-in', () => {
    const P = periodLinks({ range: RANGE, vehicleScope: { ...NO_SET, typeIds: ['t1'] } });
    expect(P.exits()).toEqual({
      to: `/fleet/maintenance?outFrom=${RANGE.from}&outTo=${RANGE.to}&type=t1`,
      metric: 'exits.count',
    });
    expect(parse(P.exits()).params.has('from')).toBe(false);
    expect(parse(P.exits()).params.has('to')).toBe(false);
  });

  it('counts every period figure of «الصيانة والورش» by exit day: a bar adds its catalog id, a car replaces the codes', () => {
    const P = periodLinks({
      range: RANGE,
      vehicleScope: {
        ...NO_SET,
        typeIds: ['t1'],
        operationIds: ['o1'],
        vehicleCodes: ['133', '141'],
        branchId: 'b1',
        scopeBranches: [B1_NAMED],
      },
    });
    const head = `/fleet/maintenance?outFrom=${RANGE.from}&outTo=${RANGE.to}&type=t1&operation=o1&branch=b1`;
    expect(P.exits()).toEqual({ to: `${head}&vehicleCodes=133,141`, metric: 'exits.count' });
    expect(P.exits('exits.byWorkType', { workTypes: ['w1'] })).toEqual({
      to: `${head}&vehicleCodes=133,141&workTypes=w1`,
      metric: 'exits.byWorkType',
    });
    expect(P.exits('exits.byWorkshop', { workshops: ['s1'] })).toEqual({
      to: `${head}&vehicleCodes=133,141&workshops=s1`,
      metric: 'exits.byWorkshop',
    });
    expect(P.exits('exits.topVehicle', { vehicleCodes: ['207'] })).toEqual({
      to: `${head}&vehicleCodes=207`,
      metric: 'exits.topVehicle',
    });
    for (const link of [P.exits(), P.exits('exits.byWorkType', { workTypes: ['w1'] })]) {
      expect(parse(link).params.has('from')).toBe(false);
      expect(parse(link).params.has('to')).toBe(false);
    }
    // «أرقام الفترة» keeps its check-in days, and its state alone.
    expect(P.visits('visits.open', { state: 'open' }).to).toBe(
      `/fleet/maintenance?from=${RANGE.from}&to=${RANGE.to}&type=t1&operation=o1&branch=b1&vehicleCodes=133,141&state=open`,
    );
  });

  it('opens a «الآن» row of «الصيانة والورش» on its own car: the alarms board, the open visit', () => {
    expect(NOW.alarmRow('red', '247')).toEqual({
      to: '/fleet/maintenance-alarms?level=red&vehicleCodes=247',
      metric: 'maintenanceAlarm.row',
    });
    expect(NOW.workshopCar('247')).toEqual({
      to: '/fleet/maintenance?state=open&vehicleCodes=247',
      metric: 'workshop.longest',
    });
    expect(NOW_BRANCH.workshopCar('247').to).toBe(
      '/fleet/maintenance?state=open&vehicleCodes=247&branch=b1',
    );
    expect(NOW_MINE.workshopCar('247').to).toBe(
      '/fleet/maintenance?state=open&vehicleCodes=247&branch=b1,b2',
    );
    // The alarms board has no branch filter: a row names its car, whatever the scope.
    expect(NOW_BRANCH.alarmRow('yellow', '305').to).toBe(
      '/fleet/maintenance-alarms?level=yellow&vehicleCodes=305',
    );
  });

  it('opens «كل إنذارات الصيانة» on both levels — under a branch, on the branch’s cars by code', () => {
    expect(NOW.alarmsAll(ALARM(2, 6, null))).toEqual({
      to: '/fleet/maintenance-alarms?level=red,yellow',
      metric: 'maintenanceAlarm.all',
    });
    expect(NOW_BRANCH.alarmsAll(ALARM(1, 2, { red: ['133'], yellow: ['141', '207'] }))).toEqual({
      to: '/fleet/maintenance-alarms?level=red,yellow&vehicleCodes=133,141,207',
      metric: 'maintenanceAlarm.all',
    });
    // A level with no car names no codes, and needs none.
    expect(NOW_BRANCH.alarmsAll(ALARM(0, 1, { red: [], yellow: ['141'] }))?.to).toBe(
      '/fleet/maintenance-alarms?level=red,yellow&vehicleCodes=141',
    );
  });

  it('opens the supply contracts dated in today’s year — with one alarm level for red / yellow', () => {
    expect(NOW.supplyContracts('supplyContracts.received')).toEqual({
      to: '/fleet/vehicle-contracts?from=2026-01-01&to=2026-12-31',
      metric: 'supplyContracts.received',
    });
    expect(NOW.supplyContracts('supplyContracts.red', 'red').to).toBe(
      '/fleet/vehicle-contracts?from=2026-01-01&to=2026-12-31&alarm=red',
    );
    // Contracts carry no branch: the company's, whatever the scope.
    expect(NOW_BRANCH.supplyContracts('supplyContracts.yellow', 'yellow').to).toBe(
      '/fleet/vehicle-contracts?from=2026-01-01&to=2026-12-31&alarm=yellow',
    );
    const newYear = nowLinks({ today: '2027-01-01', branchId: null, scopeBranches: null });
    expect(newYear.supplyContracts('supplyContracts.open').to).toBe(
      '/fleet/vehicle-contracts?from=2027-01-01&to=2027-12-31',
    );
  });

  it('opens «مصروف الوقود» on the fuel receipts of the range', () => {
    const P = periodLinks({ range: RANGE, vehicleScope: NO_SET });
    expect(P.opexFuel()).toEqual({
      to: `/fleet/receipts?from=${RANGE.from}&to=${RANGE.to}&kind=fuel`,
      metric: 'opex.fuel',
    });
  });

  it('opens another tab with the page’s filters as they stand, or not at all when it is hidden', () => {
    const sp = new URLSearchParams(
      'tab=overview&period=custom&from=2026-10-01&to=2026-10-09&type=t1',
    );
    expect(tabLink('accidents', 'accidents.tab', sp, ['overview', 'accidents'])).toEqual({
      to: '/fleet?tab=accidents&period=custom&from=2026-10-01&to=2026-10-09&type=t1',
      metric: 'accidents.tab',
    });
    expect(tabLink('accidents', 'accidents.tab', sp, ['overview'])).toBeNull();
    expect(tabLink('today', 'roster.tab', new URLSearchParams('tab=overview'), ['today'])?.to).toBe(
      '/fleet?tab=today',
    );
  });

  it('opens a tab on a figure’s OWN slice when it names one — the page’s filters never ride along', () => {
    const sp = new URLSearchParams('tab=overview&period=lastMonth&type=t1&vehicleCodes=133');
    const month = {
      range: {
        preset: 'thisMonth' as const,
        from: '2026-11-01',
        to: TODAY,
        days: 1,
        granularity: 'day' as const,
      },
      vehicleScope: NO_SET,
    };
    expect(echoTabFilters(month)).toEqual({ period: 'thisMonth' });
    expect(
      tabLink('accidents', 'accidents.month', sp, ['accidents'], echoTabFilters(month)),
    ).toEqual({
      to: '/fleet?tab=accidents&period=thisMonth',
      metric: 'accidents.month',
    });
    // A custom range names its days; a read's own filters come from its echo, never the page.
    const custom = {
      range: {
        preset: 'custom' as const,
        from: '2026-10-01',
        to: '2026-10-09',
        days: 9,
        granularity: 'day' as const,
      },
      vehicleScope: { ...NO_SET, typeIds: ['t2'], operationIds: ['o1'], vehicleCodes: ['207'] },
    };
    expect(
      tabLink('accidents', 'accidents.month', sp, ['accidents'], echoTabFilters(custom))?.to,
    ).toBe(
      '/fleet?tab=accidents&period=custom&from=2026-10-01&to=2026-10-09&type=t2&operation=o1&vehicleCodes=207',
    );
    expect(
      tabLink('accidents', 'accidents.month', sp, ['overview'], echoTabFilters(month)),
    ).toBeNull();
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

  it('gives «كل إنذارات الصيانة» no link under a branch over the cap — a level’s list or the two together', () => {
    // A level with cars whose list came back `[]` is over the screens' cap.
    expect(NOW_BRANCH.alarmsAll(ALARM(60, 1, { red: [], yellow: ['141'] }))).toBeNull();
    expect(NOW_BRANCH.alarmsAll(ALARM(1, 60, { red: ['133'], yellow: [] }))).toBeNull();
    // Each level fits, the two together do not.
    expect(
      NOW_BRANCH.alarmsAll(ALARM(30, 30, { red: codes(30), yellow: codes(60).slice(30) })),
    ).toBeNull();
    expect(
      NOW_BRANCH.alarmsAll(ALARM(25, 25, { red: codes(25), yellow: codes(50).slice(25) })),
    ).not.toBeNull();
    // No car in alarm under the branch: nothing to open.
    expect(NOW_BRANCH.alarmsAll(ALARM(0, 0, { red: [], yellow: [] }))).toBeNull();
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

describe('the links of «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين» (exact URLs)', () => {
  it('opens the notices of the figures: open, without the cheque, and one row by what it carries', () => {
    expect(NOW.noticesOpen()).toEqual({
      to: '/fleet/notices?status=open',
      metric: 'notices.missingAny',
    });
    expect(NOW_BRANCH.noticesCheckImage()).toEqual({
      to: '/fleet/notices?status=open&checkImage=missing&branch=b1',
      metric: 'notices.missingCheckImage',
    });
    expect(NOW_MINE.noticesOpenAll()).toEqual({
      to: '/fleet/notices?status=open&branch=b1,b2',
      metric: 'notices.open',
    });
    expect(NOW.noticesOpenAll('notices.all').metric).toBe('notices.all');
    expect(NOW.noticeRow({ code: '207', number: '24117', date: '2026-10-12' })).toEqual({
      to: '/fleet/notices?status=open&vehicleCodes=207&number=24117&from=2026-10-12&to=2026-10-12',
      metric: 'notices.row',
    });
    // Each part only when the notice carries it; none of the three → no link at all.
    expect(NOW_BRANCH.noticeRow({ code: null, number: '7001', date: null })?.to).toBe(
      '/fleet/notices?status=open&number=7001&branch=b1',
    );
    expect(NOW.noticeRow({ code: null, number: null, date: null })).toBeNull();
  });

  it('opens the open accident files, the branch’s when there is one', () => {
    expect(NOW.accidentsOpenAll()).toEqual({
      to: '/fleet/accidents?status=open',
      metric: 'accidentsOpen.all',
    });
    expect(NOW_ONE.accidentsOpenAll().to).toBe('/fleet/accidents?status=open&branch=b1');
  });

  it('opens a stale car’s whole odometer history, a review row’s ONE day, and the cars by code', () => {
    expect(NOW.noReadingCar('112')).toEqual({
      to: '/fleet/odometer?vehicleCodes=112&period=all',
      metric: 'noReading.row',
    });
    const P = periodLinks({ range: RANGE, vehicleScope: MINE_SET });
    expect(P.carKmDay('154', '2026-10-11', 'km.invalidList.row')).toEqual({
      to: '/fleet/odometer?vehicleCodes=154&from=2026-10-11&to=2026-10-11',
      metric: 'km.invalidList.row',
    });
    expect(P.vehiclesByCodes(['305', '318'], 'km.noDistance')).toEqual({
      to: '/fleet/vehicles?vehicleCodes=305,318',
      metric: 'km.noDistance',
    });
    expect(P.vehiclesByCodes([], 'km.noDistance')).toBeNull();
    expect(P.vehiclesByCodes(ids(51, 0x300), 'km.noDistance')).toBeNull();
  });
});
