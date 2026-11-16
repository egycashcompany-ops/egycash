// «لوحة تحكم الحركة» — the fixtures the dashboard's web specs share: one R1 answer with every section,
// one R2 answer, the custody screen's own reads, and a renderer that mounts the real page in the node
// test environment (`renderToStaticMarkup` over seeded caches — no DOM, no fetch).
//
// The figures agree with each other the way the server's do: ready = rows − in the workshop −
// licence expired (33 = 40 − 5 − 2); the registry = available + absent + inactive + suspended +
// licence expired (52 = 44 + 5 + 1 + 1 + 1); the matrix adds up to the active cars (40), and each
// branch's cars by operation kind add up to its column (Σ cash = 24, Σ ATM = 11, «أخرى» 5); the alarm
// rows are the first 8 of the 3 red + 6 yellow (red first, the most overdue first); the longest stays
// are the 5 oldest of the 6 open visits (the oldest first, = `oldest`); every exit bar list adds up
// to the exits (19).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_PAGE_KEYS,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyOutsideKindDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { custodyQueryKeys } from './api/fleet-queries';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import { FleetDashboardPage } from './pages/FleetDashboardPage';

export const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

export const B1 = '650000000000000000000101';
export const B2 = '650000000000000000000102';
export const T1 = '650000000000000000000201';
export const T2 = '650000000000000000000202';
export const OP_CASH = '650000000000000000000301';
export const OP_ATM = '650000000000000000000302';
export const SP_CASH = '650000000000000000000401';
export const SP_ATM = '650000000000000000000402';
export const DRIVER = '64b1f0dddddddddddddddd01';
export const WT_TYRES = '650000000000000000000511';
export const WT_BRAKES_FX = '650000000000000000000512';
export const WS_COMPANY_FX = '650000000000000000000611';
export const WS_HARAMAIN = '650000000000000000000612';

const ARMOURED = { ar: 'مصفحة', en: 'Armoured' };
const JEEP = { ar: 'جيب', en: 'Jeep' };
const COMPANY_WS = { ar: 'ورشة الشركة', en: 'Company workshop' };
const HARAMAIN_WS = { ar: 'ورشة الحرمين', en: 'Haramain workshop' };
const TYRES = { ar: 'كاوتش', en: 'Tyres' };
const BRAKES = { ar: 'فرامل', en: 'Brakes' };

type AlarmRow = NonNullable<FleetDashboardNowDto['maintenanceAlarm']>['rows'][number];
const alarmRow = (
  code: string,
  level: 'red' | 'yellow',
  remainingKm: number,
  typeName: AlarmRow['typeName'],
  lastServiceAt: string | null,
  inWorkshop: AlarmRow['inWorkshop'] = null,
): AlarmRow => ({
  vehicleId: `v${code}`,
  code,
  typeName,
  level,
  remainingKm,
  sinceServiceKm: 10_000 - remainingKm,
  intervalKm: 10_000,
  lastServiceAt,
  inWorkshop,
});

/** Cairo today, and the server's clock at 10:00 Cairo (EET, UTC+2, after the October change). */
export const TODAY = '2026-11-01';
export const AS_OF = '2026-11-01T08:00:00.000Z';

export const NOW_DTO: FleetDashboardNowDto = {
  today: TODAY,
  asOf: AS_OF,
  branchId: null,
  scopeBranches: null,
  vehicles: {
    active: 40,
    outOfService: 2,
    disposed: 1,
    outOfServiceList: [
      { vehicleId: 'v154', code: '154', reason: 'حادث' },
      { vehicleId: 'v260', code: '260', reason: null },
    ],
  },
  roster: {
    date: TODAY,
    licenceRule: 'flag',
    rows: 40,
    ready: 33,
    inWorkshop: 5,
    licenceExpired: 2,
    readyManned: 28,
    unmanned: 5,
    unmannedCrewGap: 2,
    unmannedStalePlan: 1,
    unmannedNoCrew: 2,
    crewGap: { vehicles: 2, otherReasons: 0, covered: 3, stalePlan: 1 },
    registry: 52,
    available: 44,
    availableWithoutVehicle: 6,
    availableLicenceNotRecorded: 2,
    availableNoProfile: 1,
    absent: { attendance: 3, leave: 2 },
    profileInactive: 1,
    notEmployed: 1,
    licenceExpiredDrivers: 1,
    // The lists agree with the counts: 5 unmanned = 2 crewGap + 1 stalePlan + 2 noCrew + 0
    // unassigned (all five listed, class then code); 5 absent = 3 «تمام» + 2 leave, crew first.
    unmannedRows: [
      {
        vehicleId: 'v121',
        code: '121',
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        branch: { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } },
        mission: { ar: 'نقل نقدية', en: 'Cash transit' },
        why: 'crewGap',
        absent: { employeeId: 'e-abs-1', reason: 'fleetUnavailability' },
      },
      {
        vehicleId: 'v133',
        code: '133',
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        branch: { id: B2, name: { ar: 'الجيزة', en: 'Giza' } },
        mission: null,
        why: 'crewGap',
        absent: { employeeId: 'e-abs-4', reason: 'hrLeave' },
      },
      {
        vehicleId: 'v145',
        code: '145',
        typeName: { ar: 'جيب', en: 'Jeep' },
        branch: { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } },
        mission: null,
        why: 'stalePlan',
        absent: { employeeId: 'e-abs-2', reason: 'fleetUnavailability' },
      },
      {
        vehicleId: 'v162',
        code: '162',
        typeName: { ar: 'جيب', en: 'Jeep' },
        branch: null,
        mission: null,
        why: 'noCrew',
        absent: null,
      },
      {
        vehicleId: 'v170',
        code: '170',
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        branch: { id: B2, name: { ar: 'الجيزة', en: 'Giza' } },
        mission: null,
        why: 'noCrew',
        absent: null,
      },
    ],
    unmannedUnassigned: 0,
    absentDrivers: [
      {
        employeeId: 'e-abs-1',
        reason: 'fleetUnavailability',
        crewVehicle: { vehicleId: 'v121', code: '121' },
      },
      { employeeId: 'e-abs-4', reason: 'hrLeave', crewVehicle: { vehicleId: 'v133', code: '133' } },
      { employeeId: 'e-abs-2', reason: 'fleetUnavailability', crewVehicle: null },
      { employeeId: 'e-abs-3', reason: 'fleetUnavailability', crewVehicle: null },
      { employeeId: 'e-abs-5', reason: 'hrLeave', crewVehicle: null },
    ],
  },
  workshop: {
    open: 6,
    openActive: 5,
    openOutOfService: 1,
    oldest: { vehicleId: 'v141', code: '141', inDate: '2026-10-23', days: 9, deleted: false },
    // The 5 oldest of the 6 open visits, the oldest first (`oldest` = the first).
    longest: [
      {
        visitId: 'w141',
        vehicleId: 'v141',
        code: '141',
        deleted: false,
        typeName: ARMOURED,
        inDate: '2026-10-23',
        days: 9,
        workshop: COMPANY_WS,
        workType: BRAKES,
      },
      {
        visitId: 'w158',
        vehicleId: 'v158',
        code: '158',
        deleted: false,
        typeName: JEEP,
        inDate: '2026-10-26',
        days: 6,
        workshop: HARAMAIN_WS,
        workType: TYRES,
      },
      {
        visitId: 'w187',
        vehicleId: 'v187',
        code: '187',
        deleted: false,
        typeName: ARMOURED,
        inDate: '2026-10-29',
        days: 3,
        workshop: COMPANY_WS,
        workType: null,
      },
      {
        visitId: 'w203',
        vehicleId: 'v203',
        code: '203',
        deleted: false,
        typeName: JEEP,
        inDate: '2026-10-31',
        days: 1,
        workshop: null,
        workType: BRAKES,
      },
      {
        visitId: 'w1',
        vehicleId: 'v231',
        code: '231',
        deleted: false,
        typeName: ARMOURED,
        inDate: TODAY,
        days: 0,
        workshop: HARAMAIN_WS,
        workType: TYRES,
      },
    ],
  },
  // 3 red (one past the limit) and 6 yellow; the table's 8 rows: red first, the most overdue first.
  maintenanceAlarm: {
    red: 3,
    overdue: 1,
    yellow: 6,
    codes: null,
    redKm: 300,
    yellowKm: 1000,
    rows: [
      alarmRow('141', 'red', -120, ARMOURED, '2026-06-02', { workshop: COMPANY_WS }),
      alarmRow('127', 'red', 140, ARMOURED, '2026-06-19'),
      alarmRow('166', 'red', 260, JEEP, null),
      alarmRow('112', 'yellow', 420, JEEP, '2026-07-04'),
      alarmRow('139', 'yellow', 560, ARMOURED, '2026-07-11'),
      alarmRow('174', 'yellow', 700, ARMOURED, '2026-07-20'),
      alarmRow('190', 'yellow', 830, JEEP, '2026-07-28'),
      alarmRow('214', 'yellow', 950, null, '2026-08-03'),
    ],
  },
  noReading: {
    days: 3,
    stale: [
      { vehicleId: 'v304', code: '304', lastDate: '2026-10-28' },
      { vehicleId: 'v112', code: '112', lastDate: '2026-10-22' },
    ],
    neverRead: [{ vehicleId: 'v318', code: '318' }],
    // The counts are the lists'; the rows the longest gap first (lastDate asc), days to TODAY.
    staleCount: 2,
    neverReadCount: 1,
    staleRows: [
      { vehicleId: 'v112', code: '112', typeName: JEEP, lastDate: '2026-10-22', days: 10 },
      { vehicleId: 'v304', code: '304', typeName: ARMOURED, lastDate: '2026-10-28', days: 4 },
    ],
    neverReadRows: [{ vehicleId: 'v318', code: '318', typeName: JEEP }],
  },
  distributionVehicles: {
    branches: [
      { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } },
      { id: B2, name: { ar: 'الجيزة', en: 'Giza' } },
    ],
    rows: [
      {
        typeId: T1,
        name: { ar: 'مصفحة', en: 'Armoured' },
        counts: { [B1]: 16, [B2]: 8 },
        noBranch: 0,
        total: 24,
      },
      {
        typeId: T2,
        name: { ar: 'جيب', en: 'Jeep' },
        counts: { [B1]: 9, [B2]: 6 },
        noBranch: 1,
        total: 16,
      },
    ],
    totals: { counts: { [B1]: 25, [B2]: 14 }, noBranch: 1, total: 40 },
    branchCount: 2,
    cash: { vehicles: 24, operationIds: [OP_CASH] },
    atm: { vehicles: 11, operationIds: [OP_ATM] },
    // Each column by operation kind (25 = 15 + 7 + 3, 14 = 8 + 4 + 2, «بلا فرع» 1 = 1 + 0 + 0).
    kinds: {
      [B1]: { cash: 15, atm: 7, other: 3 },
      [B2]: { cash: 8, atm: 4, other: 2 },
    },
    noBranchKinds: { cash: 1, atm: 0, other: 0 },
    other: { vehicles: 5 },
  },
  distributionDrivers: {
    total: 52,
    cash: { drivers: 31, legacy: 2, specializationIds: [SP_CASH] },
    atm: { drivers: 15, legacy: 1, specializationIds: [SP_ATM] },
  },
  licenceVehicles: {
    warnDays: 30,
    expired: 2,
    expiring: 4,
    soon: 2,
    outOfServiceExpired: 1,
    list: [
      { vehicleId: 'v249', code: '249', expiresAt: '2026-10-14T00:00:00.000Z', days: -18 },
      { vehicleId: 'v118', code: '118', expiresAt: '2026-10-26T00:00:00.000Z', days: -6 },
      { vehicleId: 'v152', code: '152', expiresAt: '2026-11-05T00:00:00.000Z', days: 4 },
      { vehicleId: 'v211', code: '211', expiresAt: '2026-11-09T00:00:00.000Z', days: 8 },
      { vehicleId: 'v297', code: '297', expiresAt: '2026-11-17T00:00:00.000Z', days: 16 },
      { vehicleId: 'v176', code: '176', expiresAt: '2026-11-24T00:00:00.000Z', days: 23 },
    ],
    more: 2,
  },
  licenceDrivers: {
    warnDays: 30,
    expired: 1,
    expiring: 3,
    soon: 2,
    notRecorded: 2,
    unregistered: 1,
  },
  papers: { insurance: 3, tax: 1 },
  fuelCards: { warnDays: 30, expired: 1, expiring: 2 },
  fuelCharging: {
    wataniya: 84200,
    chillout: 31750,
    requested: { count: 4, amount: 6500 },
    low: { belowYellow: 3, belowRed: 1, yellowAt: 300, redAt: 100 },
    charged24h: 7500,
    cards: 24,
  },
  recentWorkshop: [
    {
      visitId: 'w1',
      vehicleId: 'v231',
      code: '231',
      date: TODAY,
      recordedAt: '2026-11-01T07:12:00.000Z',
      workshop: { ar: 'ورشة الحرمين', en: 'Haramain workshop' },
      workType: { ar: 'كاوتش', en: 'Tyres' },
      open: true,
    },
    {
      visitId: 'w2',
      vehicleId: 'v295',
      code: '295',
      date: '2026-10-31',
      recordedAt: '2026-10-31T13:47:00.000Z',
      workshop: { ar: 'ورشة الشركة', en: 'Company workshop' },
      workType: { ar: 'فرامل', en: 'Brakes' },
      open: false,
    },
  ],
  recentAccidents: [
    {
      accidentId: 'a1',
      vehicleId: 'v154',
      code: '154',
      date: TODAY,
      culprit: 'طرف ثالث',
      culpritEmployeeIds: [],
      status: 'open',
    },
    {
      accidentId: 'a2',
      vehicleId: 'v207',
      code: '207',
      date: '2026-10-30',
      culprit: 'محمود عبد العزيز',
      culpritEmployeeIds: [DRIVER],
      status: 'closed',
    },
  ],
  // The three open notices missing an attachment, the oldest notice day first and the undated
  // (carless) one last: two miss a licence image, two the cheque image.
  notices: {
    open: 4,
    missingAny: 3,
    missingLicences: 2,
    missingCheckImage: 2,
    rows: [
      {
        noticeId: 'n1',
        template: 'misrInsurance',
        vehicleId: 'v207',
        code: '207',
        typeName: ARMOURED,
        noticeNumber: '24117',
        noticeDate: '2026-10-12',
        missing: { vehicleLicense: false, driverLicense: false, checkImage: true },
      },
      {
        noticeId: 'n2',
        template: 'deltaInsurance',
        vehicleId: 'v295',
        code: '295',
        typeName: JEEP,
        noticeNumber: '24130',
        noticeDate: '2026-10-20',
        missing: { vehicleLicense: true, driverLicense: false, checkImage: true },
      },
      {
        noticeId: 'n3',
        template: 'misrInsurance',
        vehicleId: null,
        code: null,
        typeName: null,
        noticeNumber: '7001',
        noticeDate: null,
        missing: { vehicleLicense: true, driverLicense: true, checkImage: false },
      },
    ],
  },
  dealershipPending: { rows: 3 },
  accidentsOpen: { count: 5, remaining: 23400 },
  violationsYear: {
    year: 2026,
    company: 4200,
    drivers: {
      total: 2250,
      attributed: 1650,
      unknown: { amount: 450, count: 3 },
      unlinked: { amount: 150, count: 1 },
    },
    total: 6450,
  },
  // Every year still owed: this year's (violationsYear) plus older statements and fines.
  violationsOpen: {
    company: { amount: 5600, count: 9 },
    drivers: { total: { amount: 3050, count: 7 } },
    total: { amount: 8650, count: 16 },
  },
  alerts: [
    { id: 'maintenanceRed', level: 'red', count: 3 },
    { id: 'vehicleLicenceExpired', level: 'red', count: 2 },
    { id: 'driverLicenceExpired', level: 'red', count: 1 },
    { id: 'fuelCardExpired', level: 'red', count: 1 },
    { id: 'crewAbsent', level: 'orange', count: 2 },
    { id: 'fuelRequests', level: 'orange', count: 4 },
    { id: 'fuelLow', level: 'orange', count: 3 },
    { id: 'dealershipPending', level: 'orange', count: 3 },
    { id: 'noticesMissing', level: 'orange', count: 3 },
    { id: 'noReading', level: 'orange', count: 2 },
  ],
  vehicleScope: null,
  unavailable: [],
};

export const PERIOD_DTO: FleetDashboardPeriodDto = {
  today: TODAY,
  asOf: AS_OF,
  range: { preset: 'thisMonth', from: TODAY, to: TODAY, days: 1, granularity: 'day' },
  vehicleScope: {
    count: null,
    typeIds: [],
    operationIds: [],
    vehicleCodes: [],
    branchId: null,
    scopeBranches: null,
  },
  km: {
    total: 4896,
    invalidRows: 0,
    perVehicleAvg: 122.4,
    // 41 active, one of them in the workshop all month: of = 41 − 1 − 0; every counted car read.
    coverage: { withReadings: 40, of: 40, active: 41, inWorkshop: 1, joinedAfter: 0 },
    noDistance: { cars: 0, neverRead: 0, codes: [], neverReadCodes: [] },
    invalidList: [],
    confirmedThrough: null,
    closedDays: 0,
    average: null,
    buckets: [],
    spans: { km: 0, count: 0 },
    byBranch: [],
    byType: null,
    unregistered: 0,
    top5: [],
    bottom5: [],
    withoutReadings: [],
  },
  // By CHECK-IN day («أرقام الفترة»).
  visits: { count: 27, closed: 20, open: 7 },
  // By EXIT day: each bar list adds up to the 19; one old-book exit (unranked).
  exits: {
    count: 19,
    avgStayDays: 2.6,
    byWorkType: [
      { id: WT_TYRES, name: TYRES, count: 11 },
      { id: WT_BRAKES_FX, name: BRAKES, count: 8 },
    ],
    byWorkshop: [
      { id: WS_COMPANY_FX, name: COMPANY_WS, count: 12 },
      { id: WS_HARAMAIN, name: HARAMAIN_WS, count: 7 },
    ],
    topVehicles: [
      {
        vehicleId: 'v295',
        code: '295',
        typeName: JEEP,
        visits: 2,
        lastInDate: '2026-10-29',
        lastWorkType: BRAKES,
      },
      {
        vehicleId: 'v207',
        code: '207',
        typeName: ARMOURED,
        visits: 1,
        lastInDate: '2026-10-30',
        lastWorkType: TYRES,
      },
    ],
    unregistered: 1,
  },
  accidents: {
    count: 4,
    open: 2,
    openRemaining: 1000,
    undated: 0,
    // The four files as they stand now: 2,500 + 600 − 2,300 + 400 − 200 = 1,000 (the closed ones owe 0).
    totals: {
      amountCollected: 2500,
      companyCost: 600,
      paidAmount: 2300,
      transferredIn: 400,
      transferredOut: 200,
      remaining: 1000,
    },
  },
  accidentList: null,
  opex: null,
  dealership: null,
  unavailable: [],
};

// ── The custody screen's own reads (D3) ───────────────────────────────────────────────────────

const outside = (
  kind: FleetCustodyOutsideKindDto['kind'],
  count: number,
  total: number,
  stale: [number, number],
): FleetCustodyOutsideKindDto => ({
  kind,
  count,
  total,
  oldest: '2026-09-07',
  stale: { count: stale[0], total: stale[1] },
});

/** One kind with receipts past 30 days: exactly ONE line on the fund's banner. */
export const CUSTODY_OUTSIDE: FleetCustodyOutsideKindDto[] = [
  outside('maintenance', 3, 5720, [0, 0]),
  outside('wash', 4, 600, [2, 300]),
];
export const CUSTODY_FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 159974.54,
  charged: { count: 2, amount: 300000 },
  spent: { count: 126, amount: 97794 },
  replenished: { count: 1, amount: 81908, memos: 5 },
  settled: { count: 1, amount: 124139.46, parts: 3 },
  held: { count: 0, amount: 0, memos: 0, receipts: 0 },
  cancelled: { count: 0, amount: 0 },
  operations: 4,
  memos: { count: 5, pending: 0, pendingTotal: 9566 },
  outside: CUSTODY_OUTSIDE,
  // Batch 3's «العمليات المحذوفة» pill: none deleted, so the fund reads as it always did.
  deleted: { count: 0 },
};

export const seedCustody = (qc: QueryClient): void => {
  qc.setQueryData(custodyQueryKeys.fund(), CUSTODY_FUND);
  qc.setQueryData(custodyQueryKeys.candidates('replenish'), {
    memos: [],
    outside: CUSTODY_OUTSIDE,
    fundTotal: CUSTODY_FUND.fundTotal,
    chargedTotal: 300000,
  });
  qc.setQueryData(custodyQueryKeys.candidates('settle'), {
    parts: [],
    fundTotal: CUSTODY_FUND.fundTotal,
  });
};

// ── Mounting the page ─────────────────────────────────────────────────────────────────────────

/** Every key the page's gates name, and the attendance screen's guard (a secondary link). */
export const ALL_KEYS: readonly string[] = [...FLEET_DASHBOARD_PAGE_KEYS, 'fleetAvailability.view'];

export const PERIOD_KEY = fleetDashboardKeys.period('live', { preset: 'thisMonth' });

/** R2's key for the filters a dashboard URL's address bar holds — the page's own read. */
export const pagePeriodKey = (url: string): readonly unknown[] => {
  const query = toPeriodQuery(readPeriodFilters(new URL(url, 'http://x').searchParams));
  return fleetDashboardKeys.period(periodLiveness(query, TODAY), query);
};

/**
 * The caches the page reads: R1 (`now`), «هذا الشهر» with no filter (`period`, the default page key
 * and the month read), the custody screen's reads, and — `page` — an R2 answer under the key the
 * URL's filters make (the page's own read when the address bar holds filters), beside R1.
 */
export const dashboardClient = (
  seed: {
    now?: FleetDashboardNowDto | null;
    period?: FleetDashboardPeriodDto | null;
    custody?: boolean;
    page?: { url: string; dto: FleetDashboardPeriodDto };
  } = {},
): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (seed.now !== null) qc.setQueryData(fleetDashboardKeys.now, seed.now ?? NOW_DTO);
  if (seed.period !== null) qc.setQueryData(PERIOD_KEY, seed.period ?? PERIOD_DTO);
  if (seed.page !== undefined) qc.setQueryData(pagePeriodKey(seed.page.url), seed.page.dto);
  if (seed.custody !== false) seedCustody(qc);
  return qc;
};

export const renderDashboard = ({
  permissions = ALL_KEYS,
  url = '/fleet',
  client = dashboardClient(),
  locale = 'ar',
}: {
  permissions?: readonly string[];
  url?: string;
  client?: QueryClient;
  locale?: Locale;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });
  return renderToStaticMarkup(
    createElement(Provider, {
      store,
      children: createElement(
        QueryClientProvider,
        { client },
        createElement(MemoryRouter, { initialEntries: [url] }, createElement(FleetDashboardPage)),
      ),
    }),
  );
};
