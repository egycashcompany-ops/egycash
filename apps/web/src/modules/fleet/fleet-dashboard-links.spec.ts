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
  FleetNoticesSummaryQuerySchema,
  ListFleetNoticesQuerySchema,
  addDaysYmd,
  licenceWindows,
  parseFleetSort,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardNowFuelCardRowDto,
  type FleetDashboardSection,
  type FleetDashboardVehicleScopeDto,
} from '@ecms/contracts';
import {
  LINK_CODES_CAP,
  PATH_ONLY,
  custodyDashboardLink,
  custodyLinks,
  nowLinks,
  echoTabFilters,
  periodLinks,
  tabLink,
  type DashLink,
  type NowLinks,
  type PeriodLinks,
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
/** A link's path and query — a builder that answered `null` (no link) fails the spec here. */
const parse = (link: DashLink | null): { pathname: string; params: URLSearchParams } => {
  if (link === null) throw new Error('expected a link, got none (null)');
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
/** A reader whose branch reach holds NO branch (audit D21): the figures cover nothing. */
const NOW_NONE = nowLinks({ today: TODAY, branchId: null, scopeBranches: [] });
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
/** A reader of one branch, no switcher, no page filter. */
const ONE_SET: FleetDashboardVehicleScopeDto = { ...NO_SET, count: 20, scopeBranches: [B1_NAMED] };
/** The empty reach on R2 (D21). */
const NONE_SET: FleetDashboardVehicleScopeDto = { ...NO_SET, count: 0, scopeBranches: [] };
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

/** A row of «كروت تحتاج متابعة»: a wataniya card on car 214 unless told otherwise. */
const CARD = (over: Partial<FleetDashboardNowFuelCardRowDto>): FleetDashboardNowFuelCardRowDto => ({
  cardId: 'k1',
  company: 'wataniya',
  number: '7045112000984417',
  vehicleId: 'v214',
  code: '214',
  typeName: null,
  vehicleDeleted: false,
  label: null,
  balance: 1240,
  requestedAmount: null,
  expiresAt: '2027-06-15',
  states: ['expired'],
  ...over,
});

/** Every link the builder can emit, each builder called with representative arguments. */
const everyLink = (): DashLink[] => {
  const all: (DashLink | null)[] = [];
  for (const L of [NOW, NOW_BRANCH, NOW_ONE, NOW_MINE, NOW_NONE]) {
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
      L.papersOpen('insurance'),
      L.papersOpen('tax'),
      L.vehicleLicenceMonth('2026-11'),
      L.driverLicenceMonth('2027-02'),
      L.driverLicencesWithin60(),
      L.driver('p520', 'licenceDrivers.row'),
      L.accidentsOpen(),
      L.violationsCompany(2026),
      L.violationsDrivers(2026),
      L.violationsUnknown(2026),
      L.reconcile(),
      L.reconcile('fuelSheets.reconcile'),
      L.violationsOpen('violationsOpen.totalAll'),
      L.violationsOpenCompany(),
      L.violationsOpenDrivers(),
      L.violationsOpenDrivers('violationsOpen.driversAll'),
      L.violationsOpenUnknown(),
      L.chargingStates(['requested', 'low']),
      L.fuelCardsDue(30),
      L.fuelCardRow(CARD({})),
      L.fuelCardRow(CARD({ states: ['critical', 'requested'] })),
      L.fuelCardRow(CARD({ vehicleId: null, code: null, label: 'سفر 1', states: ['low'] })),
      L.fuelCardRow(CARD({ vehicleDeleted: true, states: ['requested'] })),
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
    NONE_SET,
  ]) {
    const P = periodLinks({ range: RANGE, vehicleScope: scope });
    all.push(
      P.exits(),
      P.opexFuel(),
      P.km(),
      P.carKm('133', 'km.top'),
      P.carKmDay('154', '2026-10-11', 'km.invalidList.row'),
      P.kmDay('2026-10-11', 'km.invalidList.row'),
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
      P.violations('violations.count'),
      P.violations('violations.owed', { dset: 'false' }),
      P.violations('violations.byType', { dtype: 'vt1' }),
      P.violationRow({ code: '214', date: '2026-10-12', violationTypeId: 'vt1' }),
      P.opexKind('opex.card', 'fuel', 'card'),
      P.opexKind('opex.tyres', 'tyres'),
      P.dealershipRow({ code: '221', date: '2026-10-29', workKind: 'maintenance' }),
      P.opex(),
      P.opex('opex.card', 'card'),
      P.opexCustody(),
      P.custodySpend('opex.custody'),
      P.custodySpend('opex.custody.tyres', 'tyres'),
      P.licenceSpend('licenceSpend.total'),
      P.dealership(),
    );
  }
  // «العهدة»'s «الآن» links: no echo (the custody screens read no branch and keep no period).
  all.push(
    custodyLinks.log('charge', 'custodyFund.charged'),
    custodyLinks.log(null, 'custodyFund.log'),
    custodyLinks.open('op1', 'custodyFund.letter'),
    custodyLinks.memos({ status: 'pending' }, 'custodyFund.inMemos'),
    custodyLinks.memos({ kind: 'wash' }, 'custodyFund.outside.wash'),
    custodyLinks.days('2026-10-06', '2026-10-11', 'custodyFund.recent'),
    custodyLinks.licenceWaiting('renewal', 'custodyFund.settlePart'),
    custodyLinks.licenceWaiting(null, 'custodyFund.settle'),
  );
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
      PATH_ONLY.includes(to) || /^\/fleet\/(?:vehicles|drivers)\/[^/?]+$/u.test(to);
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
      // A year's fines carry the year; every year's owed fines carry what is still owed (on the
      // company half, the drivers' half, or both); a period's drivers' fines carry the FINE's days.
      ['/fleet/violations', ['year', 'cset', 'dset', 'dfrom']],
      // A licence memo counts by its day; «تنتظر التسوية» is what waits now, whatever its day.
      ['/fleet/license-expenses', ['from', 'status']],
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

describe('the links of «التراخيص والتجديدات» (exact URLs, plan §8 and D20)', () => {
  it('opens the OPEN papers of a kind on the licensing board — never the bare page, never `sort`', () => {
    expect(NOW.papersOpen('insurance')).toEqual({
      to: '/fleet/licensing?paper=insurance',
      metric: 'papers.insurance',
    });
    expect(NOW_BRANCH.papersOpen('tax')).toEqual({
      to: '/fleet/licensing?paper=tax',
      metric: 'papers.tax',
    });
  });

  it('opens a month’s column: the active cars by their licence month, the drivers by its two bounds', () => {
    expect(NOW_BRANCH.vehicleLicenceMonth('2026-11')).toEqual({
      to: '/fleet/vehicles?status=active&licenseMonths=2026-11',
      metric: 'licenceVehicles.month',
    });
    expect(NOW.driverLicenceMonth('2027-02')).toEqual({
      to: '/fleet/drivers?licExpFrom=2027-02-01&licExpBefore=2027-02-28',
      metric: 'licenceDrivers.month',
    });
    expect(NOW_BRANCH.driverLicenceMonth('2026-12')?.to).toBe(
      '/fleet/drivers?licExpFrom=2026-12-01&licExpBefore=2026-12-31&branch=b1',
    );
    expect(NOW_MINE.driverLicenceMonth('2028-02')?.to).toBe(
      '/fleet/drivers?licExpFrom=2028-02-01&licExpBefore=2028-02-29&branch=b1,b2',
    );
  });

  it('opens «عرض الباقي» of the drivers up to today+60, nearest expiry first, and a driver’s file as a record', () => {
    expect(NOW_ONE.driverLicencesWithin60()).toEqual({
      to: `/fleet/drivers?licExpBefore=${addDaysYmd(TODAY, 60)}&sort=licenseExpiresAt:asc&branch=b1`,
      metric: 'licenceDrivers.more',
    });
    expect(NOW.driver('p520', 'licenceDrivers.row')).toEqual({
      to: '/fleet/drivers/p520',
      metric: 'licenceDrivers.row',
    });
  });

  it('opens the period’s licence memos over the range alone — a memo has no branch, type or codes', () => {
    const P = periodLinks({
      range: RANGE,
      vehicleScope: { ...NO_SET, typeIds: ['t1'], branchId: 'b1', scopeBranches: [B1_NAMED] },
    });
    expect(P.licenceSpend('licenceSpend.total')).toEqual({
      to: `/fleet/license-expenses?from=${RANGE.from}&to=${RANGE.to}`,
      metric: 'licenceSpend.total',
    });
  });

  it('no longer has a builder for the retired «آخر ما سُجّل» or the board’s sorted page', () => {
    const builders = Object.keys(NOW);
    for (const name of ['licensing', 'visitDay', 'accidentDay', 'accidentsRecent', 'visitsRecent'])
      expect(builders, name).not.toContain(name);
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
    expect(NOW.driverLicencesNotRecorded()?.to).toBe('/fleet/drivers?licExp=none');
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
      // The drivers follow their HR branch: every drivers' licence list is the branch's.
      NOW_BRANCH.driverLicenceMonth('2026-12'),
      NOW_BRANCH.driverLicencesWithin60(),
    ]) {
      expect(parse(link).params.get('branch'), link?.to).toBe('b1');
    }
    expect(parse(NOW.driverLicencesWithin60()).params.has('branch')).toBe(false);
    // A car column rides the vehicles screen's own scope, as every cars' licence window does (the
    // figure is counted in the screen's scope, the active branch included): no `branch` param.
    expect(parse(NOW_BRANCH.vehicleLicenceMonth('2026-11')).params.has('branch')).toBe(false);
    // The notices and the fuel cards follow the car's branch (plan D10): every one of their links
    // carries it — the cards' and the charging screen's.
    for (const link of [
      NOW_BRANCH.charging('low'),
      NOW_BRANCH.chargingCompany('wataniya'),
      NOW_BRANCH.chargingStates(['requested', 'low']),
      NOW_BRANCH.fuelCardsExpired(),
      NOW_BRANCH.fuelCardsExpiring(30),
      NOW_BRANCH.fuelCardsDue(30),
      NOW_BRANCH.noticesOpen(),
      NOW_BRANCH.noticesCheckImage(),
      NOW_BRANCH.noticesOpenAll(),
      NOW_BRANCH.accidentsOpenAll(),
    ]) {
      expect(parse(link).params.get('branch'), link?.to).toBe('b1');
    }
    expect(parse(NOW.noticesOpen()).params.has('branch')).toBe(false);
  });

  it('keeps a 60-car type a link: the type goes as `type`, never as a list of codes', () => {
    const many = ids(60, 0x100);
    const P = periodLinks({ range: RANGE, vehicleScope: { ...NO_SET, count: 60, typeIds: many } });
    for (const link of [P.km(), P.visits(), P.accidents(), P.opex(), P.dealership()]) {
      const params = parse(link).params;
      expect(params.get('type')?.split(','), link?.to).toEqual(many);
      expect(params.has('vehicleCodes'), link?.to).toBe(false);
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
        L.driverLicencesWithin60(),
      ]) {
        expect(parse(link).params.get('branch'), link?.to).toBe(branch);
      }
      // The notices and the fuel cards are the branch's cars'.
      for (const link of [
        L.charging('low'),
        L.chargingCompany('chillout'),
        L.fuelCardsExpired(),
        L.violationsOpenCompany(),
        L.violationsOpenDrivers(),
        L.violationsOpenUnknown(),
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
    expect(NOW_BRANCH.violationsOpen()?.to).toBe(
      '/fleet/violations?cset=false&dset=false&branch=b1',
    );
  });

  it('counts the month’s visits by the day they LEFT the workshop — never by check-in', () => {
    const P = periodLinks({ range: RANGE, vehicleScope: { ...NO_SET, typeIds: ['t1'] } });
    expect(P.exits()).toEqual({
      to: `/fleet/maintenance?outFrom=${RANGE.from}&outTo=${RANGE.to}&type=t1&sort=outDate:desc`,
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
    const byExit = 'sort=outDate:desc';
    expect(P.exits()).toEqual({
      to: `${head}&vehicleCodes=133,141&${byExit}`,
      metric: 'exits.count',
    });
    expect(P.exits('exits.byWorkType', { workTypes: ['w1'] })).toEqual({
      to: `${head}&vehicleCodes=133,141&workTypes=w1&${byExit}`,
      metric: 'exits.byWorkType',
    });
    expect(P.exits('exits.byWorkshop', { workshops: ['s1'] })).toEqual({
      to: `${head}&vehicleCodes=133,141&workshops=s1&${byExit}`,
      metric: 'exits.byWorkshop',
    });
    expect(P.exits('exits.topVehicle', { vehicleCodes: ['207'] })).toEqual({
      to: `${head}&vehicleCodes=207&${byExit}`,
      metric: 'exits.topVehicle',
    });
    for (const link of [P.exits(), P.exits('exits.byWorkType', { workTypes: ['w1'] })]) {
      expect(parse(link).params.has('from')).toBe(false);
      expect(parse(link).params.has('to')).toBe(false);
    }
    // «أرقام الفترة» keeps its check-in days, and its state alone.
    expect(P.visits('visits.open', { state: 'open' })?.to).toBe(
      `/fleet/maintenance?from=${RANGE.from}&to=${RANGE.to}&type=t1&operation=o1&branch=b1&vehicleCodes=133,141&state=open`,
    );
  });

  it('opens a «الآن» row of «الصيانة والورش» on its own car: the alarms board, the open visit', () => {
    expect(NOW.alarmRow('red', '247')).toEqual({
      to: '/fleet/maintenance-alarms?level=red&vehicleCodes=247',
      metric: 'maintenanceAlarm.row',
    });
    expect(NOW.workshopCar('247')).toEqual({
      to: `/fleet/maintenance?state=open&to=${TODAY}&vehicleCodes=247`,
      metric: 'workshop.longest',
    });
    expect(NOW_BRANCH.workshopCar('247')?.to).toBe(
      `/fleet/maintenance?state=open&to=${TODAY}&vehicleCodes=247&branch=b1`,
    );
    expect(NOW_MINE.workshopCar('247')?.to).toBe(
      `/fleet/maintenance?state=open&to=${TODAY}&vehicleCodes=247&branch=b1,b2`,
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

  it('open «سجل العهدة» on one register, every operation newest first, or one operation (D13)', () => {
    expect(custodyLinks.log('replenish', 'custodyFund.replenished')).toEqual({
      to: '/fleet/custody/log?op=replenish',
      metric: 'custodyFund.replenished',
    });
    expect(custodyLinks.log(null, 'custodyFund.total').to).toBe(
      '/fleet/custody/log?sort=date:desc',
    );
    expect(custodyLinks.open('op-held', 'custodyFund.letter').to).toBe(
      '/fleet/custody/log?open=op-held',
    );
  });

  it('open «المذكرات» by status or kind, a «صرف» run on its days, the licences by part — never `?fund=`', () => {
    expect(custodyLinks.memos({ status: 'held' }, 'custodyFund.held').to).toBe(
      '/fleet/custody/memos?status=held',
    );
    expect(custodyLinks.memos({ kind: 'fuel' }, 'custodyFund.outside.fuel').to).toBe(
      '/fleet/custody/memos?kind=fuel',
    );
    expect(custodyLinks.days('2026-10-06', '2026-10-11', 'custodyFund.recent').to).toBe(
      '/fleet/custody-expenses?from=2026-10-06&to=2026-10-11',
    );
    expect(custodyLinks.licenceWaiting('extension', 'custodyFund.settlePart').to).toBe(
      '/fleet/license-expenses?kind=extension&status=waiting',
    );
    expect(custodyLinks.licenceWaiting(null, 'custodyFund.settle').to).toBe(
      '/fleet/license-expenses?status=waiting',
    );
  });

  it('open the period’s custody spend on «مصروفات العهدة» when nothing but codes narrows, else the receipts (D20)', () => {
    const plain = periodLinks({ range: RANGE, vehicleScope: { ...NO_SET, vehicleCodes: ['133'] } });
    expect(plain.custodySpend('opex.custody.wash', 'wash')?.to).toBe(
      `/fleet/custody-expenses?source=wash&from=${RANGE.from}&to=${RANGE.to}&vehicleCodes=133`,
    );
    expect(plain.custodySpend('opex.custody')).toEqual(plain.opexCustody());
    const mine = periodLinks({ range: RANGE, vehicleScope: MINE_SET });
    expect(mine.custodySpend('opex.custody.maintenance', 'maintenance')?.to).toBe(
      `/fleet/receipts?from=${RANGE.from}&to=${RANGE.to}&branch=b1,b2&kind=maintenance&source=custody`,
    );
  });
});

describe('the links of «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين» (exact URLs)', () => {
  it('opens the notices of the figures: open, without the cheque, and one row by what it carries', () => {
    expect(NOW.noticesOpen()).toEqual({
      to: '/fleet/notices?status=open&missing=any',
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
    expect(NOW.noticesOpenAll('notices.all')?.metric).toBe('notices.all');
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
    expect(NOW_ONE.accidentsOpenAll()?.to).toBe('/fleet/accidents?status=open&branch=b1');
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
    // A car deleted since: the register finds no deleted car by code, so that ONE day under the
    // set's branches (types, operations) and without any code.
    expect(P.kmDay('2026-10-11', 'km.invalidList.row')).toEqual({
      to: '/fleet/odometer?from=2026-10-11&to=2026-10-11&branch=b1,b2',
      metric: 'km.invalidList.row',
    });
    const coded = periodLinks({
      range: RANGE,
      vehicleScope: { ...MINE_SET, typeIds: ['t1'], vehicleCodes: ['154'] },
    });
    expect(coded.kmDay('2026-10-11', 'km.invalidList.row')?.to).not.toContain('vehicleCodes');
    expect(coded.kmDay('2026-10-11', 'km.invalidList.row')?.to).toContain('type=t1');
    expect(P.vehiclesByCodes(['305', '318'], 'km.noDistance')).toEqual({
      to: '/fleet/vehicles?vehicleCodes=305,318',
      metric: 'km.noDistance',
    });
    expect(P.vehiclesByCodes([], 'km.noDistance')).toBeNull();
    expect(P.vehiclesByCodes(ids(51, 0x300), 'km.noDistance')).toBeNull();
  });
});

describe('the links of «المخالفات المرورية والتسويات» (exact URLs, plan §7)', () => {
  it('opens every year’s owed fines — the company half, the drivers’ half, «مجهول», both — with no year', () => {
    expect(NOW.violationsOpen()).toEqual({
      to: '/fleet/violations?cset=false&dset=false',
      metric: 'violationsOpen.total',
    });
    expect(NOW.violationsOpen('violationsOpen.totalAll')?.metric).toBe('violationsOpen.totalAll');
    expect(NOW.violationsOpenCompany()).toEqual({
      to: '/fleet/violations?cset=false',
      metric: 'violationsOpen.company',
    });
    expect(NOW.violationsOpenDrivers()).toEqual({
      to: '/fleet/violations?dset=false',
      metric: 'violationsOpen.drivers',
    });
    expect(NOW.violationsOpenDrivers('violationsOpen.driversAll')?.metric).toBe(
      'violationsOpen.driversAll',
    );
    expect(NOW.violationsOpenUnknown()).toEqual({
      to: '/fleet/violations?dunknown=true&dset=false',
      metric: 'violationsOpen.unknown',
    });
    expect(NOW_BRANCH.violationsOpenDrivers()?.to).toBe('/fleet/violations?dset=false&branch=b1');
    for (const link of [
      NOW.violationsOpen(),
      NOW.violationsOpenCompany(),
      NOW.violationsOpenDrivers(),
      NOW.violationsOpenUnknown(),
    ]) {
      expect(parse(link).params.has('year'), link?.to).toBe(false);
      expect(parse(link).params.has('dyear'), link?.to).toBe(false);
    }
  });

  it('opens the period’s drivers’ fines by the FINE’s days on the drivers’ half — never `from` / `vehicleCodes`', () => {
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
    const head = `/fleet/violations?dfrom=${RANGE.from}&dto=${RANGE.to}&dcodes=133,141&type=t1&operation=o1&branch=b1`;
    expect(P.violations('violations.count')).toEqual({ to: head, metric: 'violations.count' });
    expect(P.violations('violations.owed', { dset: 'false' })?.to).toBe(`${head}&dset=false`);
    expect(P.violations('violations.byType', { dtype: 'vt1' })?.to).toBe(`${head}&dtype=vt1`);
    for (const name of ['from', 'to', 'vehicleCodes', 'year', 'dyear'])
      expect(parse(P.violations('violations.count')).params.has(name), name).toBe(false);
    // The company view at «كل فروعي»: the reader's two branches, no set.
    expect(
      periodLinks({ range: RANGE, vehicleScope: MINE_SET }).violations('violations.amount')?.to,
    ).toBe(`/fleet/violations?dfrom=${RANGE.from}&dto=${RANGE.to}&branch=b1,b2`);
  });

  it('opens a fine’s «فتح» on its car, its day and its type — this fine and any that share them', () => {
    const P = periodLinks({ range: RANGE, vehicleScope: MINE_SET });
    expect(P.violationRow({ code: '295', date: '2026-10-14', violationTypeId: 'vt9' })).toEqual({
      to: '/fleet/violations?dcodes=295&dfrom=2026-10-14&dto=2026-10-14&dtype=vt9',
      metric: 'violationList.row',
    });
  });

  it('a fine no code names opens its day and type under the period’s set — never `dcodes=—`', () => {
    const P = periodLinks({
      range: RANGE,
      vehicleScope: {
        ...NO_SET,
        typeIds: ['t1'],
        vehicleCodes: ['133'],
        branchId: 'b1',
        scopeBranches: [B1_NAMED],
      },
    });
    expect(P.violationRow({ code: null, date: '2026-10-14', violationTypeId: 'vt9' })).toEqual({
      to: '/fleet/violations?dfrom=2026-10-14&dto=2026-10-14&dtype=vt9&type=t1&branch=b1',
      metric: 'violationList.row',
    });
  });
});

describe('the links of «الوقود والمصروفات» (exact URLs, plan §7 and D17)', () => {
  it('opens the balances, the requests, the low cards and the expiring ones of the figures’ branch', () => {
    expect(NOW.chargingCompany('wataniya')).toEqual({
      to: '/fleet/fuel-cards/charging?company=wataniya',
      metric: 'fuelCharging.wataniya',
    });
    expect(NOW_BRANCH.charging('requested')).toEqual({
      to: '/fleet/fuel-cards/charging?state=requested&branch=b1',
      metric: 'fuelCharging.requested',
    });
    expect(NOW_MINE.charging('charged')?.to).toBe(
      '/fleet/fuel-cards/charging?state=charged&branch=b1,b2',
    );
    expect(NOW_BRANCH.fuelCardsExpired()).toEqual({
      to: `/fleet/fuel-cards?expiresBefore=${TODAY}&branch=b1`,
      metric: 'fuelCards.expired',
    });
    expect(NOW_BRANCH.fuelCardsExpiring(30)?.to).toBe(
      `/fleet/fuel-cards?expiresFrom=${addDaysYmd(TODAY, 1)}&expiresBefore=${addDaysYmd(TODAY, 30)}&branch=b1`,
    );
    expect(NOW.chargingStates(['requested', 'low'])).toEqual({
      to: '/fleet/fuel-cards/charging?state=requested,low',
      metric: 'fuelCardList.chargingStates',
    });
    expect(NOW_BRANCH.fuelCardsDue(30)).toEqual({
      to: `/fleet/fuel-cards?expiresBefore=${addDaysYmd(TODAY, 30)}&branch=b1`,
      metric: 'fuelCardList.expiry',
    });
    expect(NOW.reconcile('fuelSheets.reconcile')).toEqual({
      to: '/fleet/fuel-cards/reconcile',
      metric: 'fuelSheets.reconcile',
    });
    expect(NOW.reconcile().metric).toBe('fuelCharging.reconcile');
  });

  it('opens a card’s «فتح» by what leads it — its car and company, or its number — never the branch', () => {
    // Led by an expiry state: the cards list on its car and company.
    expect(NOW_BRANCH.fuelCardRow(CARD({ states: ['expired'] }))).toEqual({
      to: '/fleet/fuel-cards?vehicleCodes=214&company=wataniya',
      metric: 'fuelCardList.row',
    });
    expect(NOW.fuelCardRow(CARD({ company: 'chillout', states: ['expiring'] })).to).toBe(
      '/fleet/fuel-cards?vehicleCodes=214&company=chillout',
    );
    // Led by a balance or a request: the charging screen on them.
    for (const states of [['critical', 'requested'], ['requested'], ['low']] as const) {
      expect(NOW_MINE.fuelCardRow(CARD({ states: [...states] })).to, states.join()).toBe(
        '/fleet/fuel-cards/charging?vehicleCodes=214&company=wataniya',
      );
    }
    // On no car, or on a car deleted since (the screens find live cars by code): by the number.
    expect(
      NOW_BRANCH.fuelCardRow(
        CARD({ vehicleId: null, code: null, label: 'سفر 1', states: ['low'] }),
      ),
    ).toEqual({ to: '/fleet/fuel-cards?number=7045112000984417', metric: 'fuelCardList.row' });
    expect(NOW.fuelCardRow(CARD({ vehicleDeleted: true, states: ['requested'] })).to).toBe(
      '/fleet/fuel-cards?number=7045112000984417',
    );
  });

  it('opens a kind of the period’s receipts, and a dealership row on its car, its exit day and its work', () => {
    const P = periodLinks({
      range: RANGE,
      vehicleScope: { ...NO_SET, typeIds: ['t1'], branchId: 'b1', scopeBranches: [B1_NAMED] },
    });
    expect(P.opexKind('opex.card', 'fuel', 'card')).toEqual({
      to: `/fleet/receipts?from=${RANGE.from}&to=${RANGE.to}&type=t1&branch=b1&kind=fuel&source=card`,
      metric: 'opex.card',
    });
    expect(P.opexKind('opex.wash', 'wash')?.to).toBe(
      `/fleet/receipts?from=${RANGE.from}&to=${RANGE.to}&type=t1&branch=b1&kind=wash`,
    );
    expect(P.dealershipRow({ code: '221', date: '2026-10-29', workKind: 'repair' })).toEqual({
      to: '/fleet/dealership?vehicleCodes=221&from=2026-10-29&to=2026-10-29&work=repair',
      metric: 'dealershipList.row',
    });
    // A row no code names: that exit day's rows of the work under the period's set.
    expect(P.dealershipRow({ code: null, date: '2026-10-29', workKind: 'repair' })).toEqual({
      to: '/fleet/dealership?from=2026-10-29&to=2026-10-29&work=repair&type=t1&branch=b1',
      metric: 'dealershipList.row',
    });
  });
});

// ── The audit's link fixes (audit-10 D07, D10, D20, D21, D37) ───────────────────────────────────

/** Every builder of `nowLinks`, called with representative arguments (D21's rule is per builder). */
const NOW_CALLS: [keyof NowLinks, (L: NowLinks) => DashLink | null][] = [
  ['alarm', (L) => L.alarm('red', ['133'])],
  ['alarmRow', (L) => L.alarmRow('red', '133')],
  ['alarmsAll', (L) => L.alarmsAll(ALARM(1, 1, null))],
  ['vehicleLicencesExpired', (L) => L.vehicleLicencesExpired()],
  ['vehicleLicencesExpiring', (L) => L.vehicleLicencesExpiring(30)],
  ['vehicleLicencesSoon', (L) => L.vehicleLicencesSoon(30)],
  ['vehicleLicencesWithin60', (L) => L.vehicleLicencesWithin60()],
  ['vehicle', (L) => L.vehicle('v1', 'licenceVehicles.row')],
  ['driverLicencesExpired', (L) => L.driverLicencesExpired()],
  ['driverLicencesExpiring', (L) => L.driverLicencesExpiring(30)],
  ['driverLicencesSoon', (L) => L.driverLicencesSoon(30)],
  ['driverLicencesNotRecorded', (L) => L.driverLicencesNotRecorded()],
  ['driverLicencesWithin60', (L) => L.driverLicencesWithin60()],
  ['driver', (L) => L.driver('p520', 'licenceDrivers.row')],
  ['vehicleLicenceMonth', (L) => L.vehicleLicenceMonth('2026-12')],
  ['driverLicenceMonth', (L) => L.driverLicenceMonth('2026-12')],
  ['fuelCardsExpired', (L) => L.fuelCardsExpired()],
  ['fuelCardsExpiring', (L) => L.fuelCardsExpiring(30)],
  ['fuelCardsDue', (L) => L.fuelCardsDue(30)],
  ['fuelCardRow', (L) => L.fuelCardRow(CARD({}))],
  ['crewGap', (L) => L.crewGap()],
  ['charging', (L) => L.charging('requested')],
  ['chargingCompany', (L) => L.chargingCompany('wataniya')],
  ['chargingStates', (L) => L.chargingStates(['requested', 'low'])],
  ['dealershipPending', (L) => L.dealershipPending()],
  ['noticesOpen', (L) => L.noticesOpen()],
  ['noticesCheckImage', (L) => L.noticesCheckImage()],
  ['noticesOpenAll', (L) => L.noticesOpenAll()],
  ['noticeRow', (L) => L.noticeRow({ code: '207', number: '24117', date: '2026-10-12' })],
  ['custodyDashboard', (L) => L.custodyDashboard('custodyFund.total')],
  ['custodyExpenses', (L) => L.custodyExpenses()],
  ['noReading', (L) => L.noReading(['304'])],
  ['noReadingCar', (L) => L.noReadingCar('304')],
  ['neverRead', (L) => L.neverRead(['318'])],
  ['vehiclesActive', (L) => L.vehiclesActive()],
  ['vehiclesOutOfService', (L) => L.vehiclesOutOfService()],
  ['rosterReady', (L) => L.rosterReady()],
  ['rosterUnmanned', (L) => L.rosterUnmanned()],
  ['rosterWorkshop', (L) => L.rosterWorkshop()],
  ['rosterAvailable', (L) => L.rosterAvailable()],
  ['rosterAbsent', (L) => L.rosterAbsent('hrLeave')],
  ['rosterUnavailable', (L) => L.rosterUnavailable('notEmployed', 'roster.notEmployed')],
  ['rosterCar', (L) => L.rosterCar('133')],
  ['rosterAbsentAll', (L) => L.rosterAbsentAll()],
  ['rosterUnavailableAll', (L) => L.rosterUnavailableAll()],
  ['attendance', (L) => L.attendance()],
  ['workshopOpen', (L) => L.workshopOpen()],
  ['workshopCar', (L) => L.workshopCar('806')],
  [
    'vehiclesBy',
    (L) => L.vehiclesBy({ typeId: 't1', branchId: 'b1' }, 'distributionVehicles.cell'),
  ],
  ['drivers', (L) => L.drivers()],
  ['driversBySpec', (L) => L.driversBySpec(['s1'], 'distributionDrivers.cash')],
  ['supplyContracts', (L) => L.supplyContracts('supplyContracts.open')],
  ['papersOpen', (L) => L.papersOpen('insurance')],
  ['accidentsOpen', (L) => L.accidentsOpen()],
  ['accidentsOpenAll', (L) => L.accidentsOpenAll()],
  ['violationsCompany', (L) => L.violationsCompany(2026)],
  ['violationsDrivers', (L) => L.violationsDrivers(2026)],
  ['violationsUnknown', (L) => L.violationsUnknown(2026)],
  ['violationsOpen', (L) => L.violationsOpen()],
  ['violationsOpenCompany', (L) => L.violationsOpenCompany()],
  ['violationsOpenDrivers', (L) => L.violationsOpenDrivers()],
  ['violationsOpenUnknown', (L) => L.violationsOpenUnknown()],
  ['reconcile', (L) => L.reconcile()],
];

/** Every builder of `periodLinks` (a row builder twice: with its car's code, and with none). */
const PERIOD_CALLS: [string, (P: PeriodLinks) => DashLink | null][] = [
  ['km', (P) => P.km()],
  ['carKm', (P) => P.carKm('790', 'km.top5')],
  ['carKmDay', (P) => P.carKmDay('154', '2026-10-11', 'km.invalidList.row')],
  ['kmDay', (P) => P.kmDay('2026-10-11', 'km.invalidList.row')],
  ['vehiclesByCodes', (P) => P.vehiclesByCodes(['305'], 'km.noDistance')],
  ['vehicle', (P) => P.vehicle('v1', 'km.vehicle')],
  ['visits', (P) => P.visits()],
  ['exits', (P) => P.exits()],
  ['accidents', (P) => P.accidents()],
  ['accidentDay', (P) => P.accidentDay('154', '2026-10-05')],
  ['opex', (P) => P.opex()],
  ['opexFuel', (P) => P.opexFuel()],
  ['opexCustody', (P) => P.opexCustody()],
  ['custodySpend', (P) => P.custodySpend('opex.custody.wash', 'wash')],
  ['licenceSpend', (P) => P.licenceSpend('licenceSpend.total')],
  ['dealership', (P) => P.dealership()],
  ['opexKind', (P) => P.opexKind('opex.tyres', 'tyres')],
  [
    'dealershipRow',
    (P) => P.dealershipRow({ code: '221', date: '2026-10-29', workKind: 'repair' }),
  ],
  [
    'dealershipRow (no code)',
    (P) => P.dealershipRow({ code: null, date: '2026-10-29', workKind: 'repair' }),
  ],
  ['violations', (P) => P.violations('violations.count')],
  [
    'violationRow',
    (P) => P.violationRow({ code: '214', date: '2026-10-12', violationTypeId: 'vt1' }),
  ],
  [
    'violationRow (no code)',
    (P) => P.violationRow({ code: null, date: '2026-10-12', violationTypeId: 'vt1' }),
  ],
];

describe('the audit’s link fixes (D07, D10, D20, D21, D37)', () => {
  it('D07: opens «في الورشة الآن» on the open visits checked in by TODAY — the echo’s day, never the clock', () => {
    expect(NOW.workshopOpen()).toEqual({
      to: `/fleet/maintenance?state=open&to=${TODAY}`,
      metric: 'workshop.open',
    });
    expect(NOW_BRANCH.workshopOpen()?.to).toBe(
      `/fleet/maintenance?state=open&to=${TODAY}&branch=b1`,
    );
    expect(NOW_MINE.workshopOpen()?.to).toBe(
      `/fleet/maintenance?state=open&to=${TODAY}&branch=b1,b2`,
    );
    // The bound is the server's Cairo day (R1's `today`), whatever the browser's clock says.
    const later = nowLinks({ today: '2027-03-05', branchId: null, scopeBranches: null });
    expect(parse(later.workshopOpen()).params.get('to')).toBe('2027-03-05');
    expect(parse(later.workshopCar('806')).params.get('to')).toBe('2027-03-05');
    // Every «الآن» workshop link: open visits, check-in day ≤ today — never an exit bound or a
    // first check-in day (MaintenancePage reads `to` as the check-in day's last day).
    for (const link of [
      NOW.workshopOpen(),
      NOW.workshopOpen('workshop.all'),
      NOW.workshopOpen('workshop.longest'),
      NOW.workshopCar('806'),
    ]) {
      const p = parse(link).params;
      expect([p.get('state'), p.get('to')], link?.to).toEqual(['open', TODAY]);
      for (const name of ['from', 'outFrom', 'outTo']) expect(p.has(name), link?.to).toBe(false);
    }
  });

  it('D10: opens «إخطارات مفتوحة ينقصها مرفق» on the notices screen’s own «ينقصها مرفق» (missing=any)', () => {
    expect(NOW.noticesOpen()).toEqual({
      to: '/fleet/notices?status=open&missing=any',
      metric: 'notices.missingAny',
    });
    expect(NOW_BRANCH.noticesOpen()?.to).toBe('/fleet/notices?status=open&missing=any&branch=b1');
    expect(NOW_MINE.noticesOpen()?.to).toBe('/fleet/notices?status=open&missing=any&branch=b1,b2');
    // The value is the contract's own (the list and its summary both read it).
    const q = parse(NOW.noticesOpen()).params;
    const asked = { status: q.get('status'), missing: q.get('missing') };
    expect(ListFleetNoticesQuerySchema.safeParse(asked).success).toBe(true);
    expect(FleetNoticesSummaryQuerySchema.safeParse(asked).success).toBe(true);
    // Only the union figure narrows by it: every other notices link opens what it did.
    for (const link of [
      NOW.noticesOpenAll(),
      NOW.noticesOpenAll('notices.all'),
      NOW.noticesCheckImage(),
      NOW.noticeRow({ code: '207', number: null, date: null }),
    ]) {
      expect(parse(link).params.has('missing'), link?.to).toBe(false);
    }
  });

  it('D20: a ranked car’s km opens the register under the period’s types, operations and branches', () => {
    // Nothing narrows: the car's code and the days — the register folds the old-book rows filed
    // under that code into the car, as the figure now does (car 790: 200 = 200).
    expect(periodLinks({ range: RANGE, vehicleScope: NO_SET }).carKm('790', 'km.top5')).toEqual({
      to: `/fleet/odometer?vehicleCodes=790&from=${RANGE.from}&to=${RANGE.to}`,
      metric: 'km.top5',
    });
    // A type, an operation or a branch narrows: they travel too, so the register keeps the book
    // rows apart exactly as the figure does. The car's code replaces the page's codes.
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
    expect(P.carKm('133', 'km.bottom5')).toEqual({
      to: `/fleet/odometer?vehicleCodes=133&from=${RANGE.from}&to=${RANGE.to}&type=t1&operation=o1&branch=b1`,
      metric: 'km.bottom5',
    });
    // The same narrowing as the period's km total, less the codes.
    const total = parse(P.km()).params;
    const car = parse(P.carKm('133', 'km.top5')).params;
    for (const name of ['from', 'to', 'type', 'operation', 'branch'])
      expect(car.get(name), name).toBe(total.get(name));
    // «كل فروعي»: the reader's two branches narrow the register as they narrow the figure.
    expect(periodLinks({ range: RANGE, vehicleScope: MINE_SET }).carKm('790', 'km.top5')?.to).toBe(
      `/fleet/odometer?vehicleCodes=790&from=${RANGE.from}&to=${RANGE.to}&branch=b1,b2`,
    );
  });

  it('D21: a reader whose reach holds no branch gets no company+set link — the figure stands plain', () => {
    // The rule, builder by builder: `null` for that reader exactly where a one-branch reader's
    // link carries the FIGURES' branch — one the company's link does not (a matrix cell names its
    // own column's branch) — since the screens behind those do not narrow by the reader's reach;
    // every other link is the company's, unchanged (a record, a row's own car, a screen with no
    // branch param).
    const echoBranch = (one: DashLink | null, company: DashLink | null): boolean =>
      one !== null &&
      parse(one).params.has('branch') &&
      (company === null || !parse(company).params.has('branch'));
    expect(new Set(NOW_CALLS.map(([name]) => name))).toEqual(new Set(Object.keys(NOW)));
    const dropped: string[] = [];
    for (const [name, call] of NOW_CALLS) {
      if (echoBranch(call(NOW_ONE), call(NOW))) {
        expect(call(NOW_NONE), name).toBeNull();
        dropped.push(name);
      } else {
        expect(call(NOW_NONE), name).toEqual(call(NOW));
      }
    }
    // Not vacuous: the audit's cases (accidents F1, violations F4) and the rest of the branch's.
    expect(dropped).toEqual(
      expect.arrayContaining([
        'accidentsOpen',
        'accidentsOpenAll',
        'noticesOpen',
        'noticesOpenAll',
        'noticesCheckImage',
        'noticeRow',
        'violationsOpen',
        'violationsOpenCompany',
        'violationsOpenDrivers',
        'violationsOpenUnknown',
        'workshopOpen',
        'workshopCar',
        'drivers',
        'driverLicencesExpired',
        'fuelCardsExpired',
        'charging',
        'dealershipPending',
      ]),
    );
    expect(dropped).toHaveLength(30);
    // Before the fix these opened the whole company: `/fleet/accidents?status=open`.
    expect(NOW_NONE.accidentsOpen()).toBeNull();
    expect(NOW_NONE.noticesOpenAll('notices.all')).toBeNull();
    expect(NOW_NONE.violationsOpen('violationsOpen.totalAll')).toBeNull();
    // The roster and the vehicles screens carry no branch: unchanged.
    expect(NOW_NONE.rosterReady()).toEqual(NOW.rosterReady());
    expect(NOW_NONE.vehicleLicencesExpired()).toEqual(NOW.vehicleLicencesExpired());

    // The period: `null` exactly where a one-branch reader's link carries `branch`.
    const one = periodLinks({ range: RANGE, vehicleScope: ONE_SET });
    const none = periodLinks({ range: RANGE, vehicleScope: NONE_SET });
    const company = periodLinks({ range: RANGE, vehicleScope: NO_SET });
    expect(new Set(PERIOD_CALLS.map(([name]) => name.split(' ')[0]))).toEqual(
      new Set(Object.keys(company)),
    );
    const droppedP: string[] = [];
    for (const [name, call] of PERIOD_CALLS) {
      if (echoBranch(call(one), call(company))) {
        expect(call(none), name).toBeNull();
        droppedP.push(name);
      } else {
        expect(call(none), name).toEqual(call(company));
      }
    }
    expect(droppedP.sort()).toEqual(
      [
        'accidents',
        'carKm',
        'custodySpend',
        'dealership',
        'dealershipRow (no code)',
        'exits',
        'kmDay',
        'km',
        'opex',
        'opexCustody',
        'opexFuel',
        'opexKind',
        'violationRow (no code)',
        'violations',
        'visits',
      ].sort(),
    );
    // A licence memo has no branch (the figure is the whole company's for every reader): kept.
    expect(none.licenceSpend('licenceSpend.total')).toEqual(
      company.licenceSpend('licenceSpend.total'),
    );
  });

  it('D21: a switcher’s branch inside the reader’s branches is never the empty reach', () => {
    const L = nowLinks({ today: TODAY, branchId: 'b2', scopeBranches: [B2_NAMED] });
    expect(L.accidentsOpen()?.to).toBe('/fleet/accidents?status=open&branch=b2');
    // The whole company (`null`) is not the empty reach either.
    expect(NOW.accidentsOpen()?.to).toBe('/fleet/accidents?status=open');
  });

  it('D37: the linked lists open in the order of the card they come from', () => {
    // «كل السيارات في الورشة (N)» — oldest check-in first, as «أطول بقاء في الورشة الآن» lists them.
    expect(NOW.workshopOpen('workshop.all')).toEqual({
      to: `/fleet/maintenance?state=open&to=${TODAY}&sort=inDate:asc`,
      metric: 'workshop.all',
    });
    expect(NOW_BRANCH.workshopOpen('workshop.all')?.to).toBe(
      `/fleet/maintenance?state=open&to=${TODAY}&sort=inDate:asc&branch=b1`,
    );
    // The headline and a row keep the screen's own order.
    expect(parse(NOW.workshopOpen()).params.has('sort')).toBe(false);
    expect(parse(NOW.workshopOpen('workshop.longest')).params.has('sort')).toBe(false);
    expect(parse(NOW.workshopCar('806')).params.has('sort')).toBe(false);
    // The visits that LEFT the workshop open by the exit day, newest first — every variant.
    const P = periodLinks({ range: RANGE, vehicleScope: NO_SET });
    for (const link of [
      P.exits(),
      P.exits('exits.byWorkType', { workTypes: ['w1'] }),
      P.exits('exits.byWorkshop', { workshops: ['s1'] }),
      P.exits('exits.topVehicle', { vehicleCodes: ['194'] }),
    ]) {
      expect(parse(link).params.get('sort'), link?.to).toBe('outDate:desc');
    }
    // «أرقام الفترة» counts check-ins: its list keeps the screen's own order.
    expect(parse(P.visits()).params.has('sort')).toBe(false);
    // «عرض الباقي» of «أقرب التراخيص»: nearest expiry first, as the card's rows.
    expect(NOW.vehicleLicencesWithin60()).toEqual({
      to: `/fleet/vehicles?status=active&licExpBefore=${addDaysYmd(TODAY, 60)}&sort=licenseExpiresAt:asc`,
      metric: 'licenceVehicles.more',
    });
    expect(NOW.driverLicencesWithin60()).toEqual({
      to: `/fleet/drivers?licExpBefore=${addDaysYmd(TODAY, 60)}&sort=licenseExpiresAt:asc`,
      metric: 'licenceDrivers.more',
    });
    expect(NOW_MINE.driverLicencesWithin60()?.to).toBe(
      `/fleet/drivers?licExpBefore=${addDaysYmd(TODAY, 60)}&sort=licenseExpiresAt:asc&branch=b1,b2`,
    );
    // The licence windows keep the screens' own order (they are counts, not «the rest»).
    for (const link of [
      NOW.vehicleLicencesExpired(),
      NOW.vehicleLicencesExpiring(30),
      NOW.driverLicencesExpired(),
      NOW.vehicleLicenceMonth('2026-12'),
    ]) {
      expect(parse(link).params.has('sort'), link?.to).toBe(false);
    }
    // Each order is the contract's spelling — what the table writes back into `?sort=`.
    for (const link of [
      NOW.workshopOpen('workshop.all'),
      P.exits(),
      NOW.vehicleLicencesWithin60(),
      NOW.driverLicencesWithin60(),
    ]) {
      const raw = parse(link).params.get('sort');
      expect(parseFleetSort(raw), raw ?? '').toHaveLength(1);
    }
  });
});
