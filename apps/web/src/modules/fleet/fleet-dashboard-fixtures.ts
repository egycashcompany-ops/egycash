// «لوحة تحكم الحركة» — the fixtures the dashboard's web specs share: one R1 answer with every section,
// one R2 answer, the custody screen's own reads, and a renderer that mounts the real page in the node
// test environment (`renderToStaticMarkup` over seeded caches — no DOM, no fetch).
//
// The figures agree with each other the way the server's do: ready = rows − in the workshop −
// licence expired (33 = 40 − 5 − 2); the registry = available + absent + inactive + suspended +
// licence expired (52 = 44 + 5 + 1 + 1 + 1); the matrix adds up to the active cars (40).
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

/** Cairo today, and the server's clock at 10:00 Cairo (EET, UTC+2, after the October change). */
export const TODAY = '2026-11-01';
export const AS_OF = '2026-11-01T08:00:00.000Z';

export const NOW_DTO: FleetDashboardNowDto = {
  today: TODAY,
  asOf: AS_OF,
  branchId: null,
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
  },
  workshop: {
    open: 6,
    openActive: 5,
    openOutOfService: 1,
    oldest: { vehicleId: 'v141', code: '141', inDate: '2026-10-23', days: 9 },
  },
  maintenanceAlarm: { red: 3, overdue: 1, yellow: 6, codes: null },
  noReading: {
    days: 3,
    stale: [
      { vehicleId: 'v304', code: '304', lastDate: '2026-10-28' },
      { vehicleId: 'v112', code: '112', lastDate: '2026-10-22' },
    ],
    neverRead: [{ vehicleId: 'v318', code: '318' }],
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
    cash: { vehicles: 24, operationIds: [OP_CASH] },
    atm: { vehicles: 11, operationIds: [OP_ATM] },
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
  notices: { open: 4, missingAny: 3, missingLicences: 2, missingCheckImage: 2 },
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
  vehicleScope: { count: null, typeIds: [], operationIds: [], vehicleCodes: [], branchId: null },
  km: {
    total: 4896,
    invalidRows: 0,
    perVehicleAvg: 122.4,
    coverage: { withReadings: 40, of: 40 },
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
  visits: {
    count: 27,
    closed: 20,
    open: 7,
    byWorkType: [],
    byWorkshop: [],
    topVehicles: [],
    unregistered: null,
  },
  accidents: { count: 4, open: 2, openRemaining: 1000, undated: 0 },
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

export const dashboardClient = (
  seed: {
    now?: FleetDashboardNowDto | null;
    period?: FleetDashboardPeriodDto | null;
    custody?: boolean;
  } = {},
): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (seed.now !== null) qc.setQueryData(fleetDashboardKeys.now, seed.now ?? NOW_DTO);
  if (seed.period !== null) qc.setQueryData(PERIOD_KEY, seed.period ?? PERIOD_DTO);
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
