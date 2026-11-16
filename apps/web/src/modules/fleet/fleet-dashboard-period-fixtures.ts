// «لوحة تحكم الحركة» — the fixtures of the period specs («أرقام الفترة» and the period parts of the
// three mixed panels): one R2 answer with every section
// over «آخر 30 يومًا» (2026-10-03 … today 2026-11-01, by the day), the same over «هذه السنة» (by the
// month), and the renderers that mount the real page (or one period tab alone) in the node test
// environment over seeded caches — no DOM, no fetch.
//
// The figures agree with each other the way the server's do (R-15, R-16, R-18, R-23):
//   km.total = Σ confirmedKm + Σ spanKm = Σ byBranch + unregistered;
//   the average = the closed km of 10/03 … 10/30 ÷ 28 closed calendar days;
//   visits.count = closed + open (CHECK-IN day, «أرقام الفترة»);
//   Σ exits.byWorkType = Σ exits.byWorkshop = exits.count (EXIT day, «الصيانة والورش»);
//   opex.total = card + custody (and the dealership figure is never added to it);
//   km.coverage.of = active − inWorkshop − joinedAfter, noDistance.cars = of − withReadings;
//   accidents.totals.remaining = collected + company − paid + in − out (= the open files' rest).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  addDaysYmd,
  type FleetDashboardKmBucketDto,
  type FleetDashboardPeriodDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { PeriodTab, type PeriodTabProps } from './components/fleet-dashboard/period-tabs';
import { CLEARED } from './components/fleet-dashboard/period-filter-bar';
import {
  ALL_KEYS,
  AS_OF,
  B1,
  B2,
  DRIVER,
  TODAY,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

export const FROM_30 = '2026-10-03';
const SPRINTER = { ar: 'سبرينتر', en: 'Sprinter' };
const ATEGO = { ar: 'أتيجو', en: 'Atego' };
export const WT_SERVICE = '650000000000000000000501';
export const WT_BRAKES = '650000000000000000000502';
export const WS_COMPANY = '650000000000000000000601';
export const WS_TOYOTA = '650000000000000000000602';
export const DRIVER_2 = '64b1f0dddddddddddddddd02';

// ── The 30 days, one bucket each ──────────────────────────────────────────────────────────────

const day = (i: number): string => addDaysYmd(FROM_30, i);
const KM = [
  3960, 3210, 4750, 5670, 5480, 3880, 0, 3280, 4840, 5750, 5560, 5510, 3910, 3150, 4710, 5800, 5600,
  5480, 5530, 3850, 3240, 4820, 5670, 5410, 3700, 4900, 5120, 5010, 4350, 0,
] as const;

/** The day without any chain row (an empty slot). */
export const EMPTY_DAY = day(6); // 2026-10-09
/** A span's start day: 3,880 single-day km and 1,990 km over the unread day after it. */
export const SPAN_DAY = day(5); // 2026-10-08
/** A confirmed day with a car that has had no reading since (a stale marker, still solid). */
export const STALE_DAY = day(15); // 2026-10-18
/** The day before today: 8 cars still waiting for their next reading. */
export const PENDING_DAY = day(28); // 2026-10-31

const bucketOf = (i: number): FleetDashboardKmBucketDto => {
  const key = day(i);
  const base: FleetDashboardKmBucketDto = {
    key,
    hasRows: true,
    confirmed: true,
    confirmedKm: KM[i] ?? 0,
    spanKm: 0,
    pending: 0,
    stale: 0,
    spanTo: null,
    spanVehicles: 0,
  };
  if (key === EMPTY_DAY) return { ...base, hasRows: false, confirmedKm: 0 };
  if (key === SPAN_DAY)
    return { ...base, spanKm: 1990, spanTo: addDaysYmd(key, 2), spanVehicles: 8 };
  if (key === day(12))
    return { ...base, spanKm: 1960, spanTo: addDaysYmd(key, 2), spanVehicles: 7 };
  if (key === STALE_DAY) return { ...base, stale: 1 };
  if (key === day(19))
    return { ...base, stale: 1, spanKm: 1930, spanTo: addDaysYmd(key, 2), spanVehicles: 6 };
  if (key === PENDING_DAY) return { ...base, confirmed: false, pending: 8 };
  if (key === TODAY) return { ...base, confirmed: false, pending: 31 };
  return base;
};

export const BUCKETS: FleetDashboardKmBucketDto[] = KM.map((_, i) => bucketOf(i));

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const SPAN_KM = sum(BUCKETS.map((b) => b.spanKm));
export const KM_TOTAL = sum(BUCKETS.map((b) => b.confirmedKm)) + SPAN_KM;
const CLOSED = BUCKETS.filter((b) => b.key <= '2026-10-30');
const CLOSED_KM = sum(CLOSED.map((b) => b.confirmedKm + b.spanKm));
const CAIRO_KM = Math.round(KM_TOTAL * 0.45);
const GIZA_KM = Math.round(KM_TOTAL * 0.35);
const NO_BRANCH_KM = Math.round(KM_TOTAL * 0.12);
export const UNREGISTERED_KM = KM_TOTAL - CAIRO_KM - GIZA_KM - NO_BRANCH_KM;

export const PERIOD_FULL: FleetDashboardPeriodDto = {
  today: TODAY,
  asOf: AS_OF,
  range: { preset: 'last30', from: FROM_30, to: TODAY, days: 30, granularity: 'day' },
  vehicleScope: {
    count: null,
    typeIds: [],
    operationIds: [],
    vehicleCodes: [],
    branchId: null,
    scopeBranches: null,
  },
  km: {
    total: KM_TOTAL,
    invalidRows: 2,
    perVehicleAvg: KM_TOTAL / 38,
    // 40 active cars count (none held in the workshop all period, none joined after it); 38 have a
    // distance, the other two are 318 (no reading — never read at all) and 305 (only an open one).
    coverage: { withReadings: 38, of: 40, active: 40, inWorkshop: 0, joinedAfter: 0 },
    noDistance: { cars: 2, neverRead: 1, codes: ['305', '318'], neverReadCodes: ['318'] },
    // The two rows to review, the oldest day first: to = from + km, km < 0.
    invalidList: [
      {
        vehicleId: 'v154',
        code: '154',
        deleted: false,
        typeName: ATEGO,
        date: '2026-10-11',
        from: 143_905,
        to: 134_950,
        km: -8_955,
      },
      {
        vehicleId: 'v207',
        code: '207',
        deleted: false,
        typeName: SPRINTER,
        date: '2026-10-20',
        from: 186_420,
        to: 186_240,
        km: -180,
      },
    ],
    confirmedThrough: '2026-10-30',
    closedDays: 28,
    average: CLOSED_KM / 28,
    buckets: BUCKETS,
    spans: { km: SPAN_KM, count: 21 },
    byBranch: [
      { branchId: B1, name: { ar: 'القاهرة', en: 'Cairo' }, km: CAIRO_KM },
      { branchId: B2, name: { ar: 'الجيزة', en: 'Giza' }, km: GIZA_KM },
      { branchId: null, name: null, km: NO_BRANCH_KM },
    ],
    byType: null,
    unregistered: UNREGISTERED_KM,
    // Each car's make (one with no make named: nothing under its chip).
    top5: [
      { vehicleId: 'v182', code: '182', km: 5140, typeName: SPRINTER },
      { vehicleId: 'v207', code: '207', km: 4890, typeName: SPRINTER },
      { vehicleId: 'v150', code: '150', km: 4760, typeName: ATEGO },
      { vehicleId: 'v295', code: '295', km: 4610, typeName: SPRINTER },
      { vehicleId: 'v154', code: '154', km: 4420, typeName: ATEGO },
    ],
    bottom5: [
      { vehicleId: 'v141', code: '141', km: 980, inWorkshopSince: '2026-10-23', typeName: ATEGO },
      { vehicleId: 'v199', code: '199', km: 1240, inWorkshopSince: null, typeName: SPRINTER },
      { vehicleId: 'v133', code: '133', km: 1905, inWorkshopSince: null, typeName: null },
      { vehicleId: 'v118', code: '118', km: 2310, inWorkshopSince: null, typeName: SPRINTER },
      { vehicleId: 'v304', code: '304', km: 2480, inWorkshopSince: null, typeName: ATEGO },
    ],
    withoutReadings: [
      { vehicleId: 'v318', code: '318', reason: 'noRow' },
      { vehicleId: 'v305', code: '305', reason: 'onlyOpen' },
      { vehicleId: 'v260', code: '260', reason: 'notActive' },
    ],
  },
  // By CHECK-IN day: the 27 visits that entered in the 30 days, and their state now.
  visits: { count: 27, closed: 21, open: 6 },
  // By EXIT day: the 18 visits that left in the 30 days; two of them old-book (counted, not ranked).
  exits: {
    count: 18,
    avgStayDays: 2.4,
    byWorkType: [
      { id: WT_SERVICE, name: { ar: 'صيانة دورية', en: 'Service' }, count: 7 },
      { id: WT_BRAKES, name: { ar: 'فرامل', en: 'Brakes' }, count: 4 },
      { id: '650000000000000000000503', name: { ar: 'كهرباء', en: 'Electrics' }, count: 3 },
      { id: '650000000000000000000504', name: { ar: 'كاوتش', en: 'Tyres' }, count: 2 },
      { id: '650000000000000000000505', name: null, count: 2 },
    ],
    byWorkshop: [
      { id: WS_COMPANY, name: { ar: 'ورشة الشركة — القاهرة', en: 'Company workshop' }, count: 8 },
      { id: WS_TOYOTA, name: { ar: 'مركز خدمة تويوتا', en: 'Toyota service' }, count: 5 },
      {
        id: '650000000000000000000603',
        name: { ar: 'ورشة النور للكهرباء', en: 'Al-Nour' },
        count: 3,
      },
      {
        id: '650000000000000000000604',
        name: { ar: 'الحرمين للكاوتش', en: 'Al-Haramain' },
        count: 2,
      },
    ],
    topVehicles: [
      {
        vehicleId: 'v182',
        code: '182',
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        visits: 3,
        lastInDate: '2026-10-28',
        lastWorkType: { ar: 'صيانة دورية', en: 'Service' },
      },
      {
        vehicleId: 'v295',
        code: '295',
        typeName: { ar: 'جيب', en: 'Jeep' },
        visits: 2,
        lastInDate: '2026-10-26',
        lastWorkType: { ar: 'فرامل', en: 'Brakes' },
      },
      {
        vehicleId: 'v207',
        code: '207',
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        visits: 2,
        lastInDate: '2026-10-19',
        lastWorkType: null,
      },
    ],
    unregistered: 2,
  },
  accidents: {
    count: 4,
    open: 2,
    openRemaining: 9800,
    undated: 25,
    // The four files as their amounts stand now (open AND closed):
    // 12,000 + 4,500 − 7,200 + 1,000 − 500 = 9,800 — the open files' 6,500 + 3,300 (closed owe 0).
    totals: {
      amountCollected: 12000,
      companyCost: 4500,
      paidAmount: 7200,
      transferredIn: 1000,
      transferredOut: 500,
      remaining: 9800,
    },
  },
  accidentList: {
    // Newest first; each with its «بيان» as recorded and its car's make (the old-book file has none).
    rows: [
      {
        accidentId: 'a1',
        typeName: SPRINTER,
        statement: 'اصطدام خلفي أثناء الوقوف في إشارة شارع الهرم',
        vehicleId: 'v207',
        code: '207',
        date: '2026-10-27',
        culprit: 'محمود عبد العزيز سالم',
        culpritEmployeeIds: [DRIVER],
        status: 'open',
        remaining: 6500,
      },
      {
        accidentId: 'a2',
        typeName: ATEGO,
        statement: 'احتكاك جانبي مع ميكروباص أجرة عند الدوران',
        vehicleId: 'v154',
        code: '154',
        date: '2026-10-27',
        culprit: 'طرف ثالث — ميكروباص أجرة',
        culpritEmployeeIds: [],
        status: 'open',
        remaining: 3300,
      },
      {
        accidentId: 'a3',
        typeName: SPRINTER,
        statement: 'كسر المرآة الجانبية اليمنى أثناء الدخول إلى الجراج',
        vehicleId: 'v182',
        code: '182',
        date: '2026-10-14',
        culprit: 'كريم السيد إبراهيم',
        culpritEmployeeIds: [DRIVER_2],
        status: 'closed',
        remaining: 0,
      },
      {
        accidentId: 'a4',
        typeName: null,
        statement: '',
        vehicleId: null,
        code: '295',
        date: '2026-10-06',
        culprit: null,
        culpritEmployeeIds: [],
        status: 'closed',
        remaining: 0,
      },
    ],
    more: 0,
  },
  // Of the 112,450: 71,300 is fuel (card + custody fuel), the rest maintenance, wash and the like.
  opex: {
    card: 64600,
    custody: 47850,
    fuel: 71300,
    total: 112450,
    count: 210,
    dataFrom: '2026-09-14',
  },
  dealership: { amount: 38900, rows: 9, pending: 3, dataFrom: '2026-09-01' },
  unavailable: [],
};

/** «هذه السنة»: 2026-01-01 … today, by the month; February has no chain row at all. */
export const PERIOD_YEAR: FleetDashboardPeriodDto = {
  ...PERIOD_FULL,
  range: { preset: 'thisYear', from: '2026-01-01', to: TODAY, days: 305, granularity: 'month' },
  km: {
    ...(PERIOD_FULL.km as NonNullable<FleetDashboardPeriodDto['km']>),
    buckets: [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ].map((key): FleetDashboardKmBucketDto => ({
      key,
      hasRows: key !== '2026-02',
      confirmed: key !== '2026-02' && key !== '2026-11',
      confirmedKm: key === '2026-02' ? 0 : key === '2026-11' ? 0 : 130_000,
      spanKm: key === '2026-02' || key === '2026-11' ? 0 : 6000,
      pending: key === '2026-11' ? 31 : 0,
      stale: 0,
      spanTo: null,
      spanVehicles: 0,
    })),
  },
};

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────

/** The client the page reads: R1, custody, and `dto` under the key the URL's filters make. */
export const periodClient = (url: string, dto: FleetDashboardPeriodDto | null): QueryClient =>
  dashboardClient({ period: null, ...(dto === null ? {} : { page: { url, dto } }) });

/** The real page at `url`, with `dto` as R2's answer for that URL's filters. */
export const renderPeriod = ({
  url,
  dto = PERIOD_FULL,
  permissions = ALL_KEYS,
  locale = 'ar',
}: {
  url: string;
  dto?: FleetDashboardPeriodDto | null;
  permissions?: readonly string[];
  locale?: Locale;
}): string => renderDashboard({ url, permissions, locale, client: periodClient(url, dto) });

/** One period tab alone, with its props as given (the read's states: loading, failed). */
export const renderPeriodTab = (
  props: Partial<PeriodTabProps> & Pick<PeriodTabProps, 'tab'>,
  permissions: readonly string[] = ALL_KEYS,
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });
  const full: PeriodTabProps = {
    data: undefined,
    loading: false,
    error: false,
    onRetry: () => undefined,
    filters: CLEARED,
    onFilters: () => undefined,
    updatedAt: 0,
    onRefresh: () => undefined,
    can: (key) => permissions.includes(key),
    ...props,
  };
  return renderToStaticMarkup(
    createElement(Provider, {
      store,
      children: createElement(
        QueryClientProvider,
        { client: dashboardClient({ period: null }) },
        createElement(MemoryRouter, { initialEntries: ['/fleet'] }, createElement(PeriodTab, full)),
      ),
    }),
  );
};
