// «لوحة تحكم» on the custody board — «جمب الاحصائيات داش بورد تفتح ف الشاشه كلها زى موديل كل حاجة
// بالتفصيل» — and, since «عاوز دى تكون فى شاشه العهد لما ادوس على لوحة التحكم فى اللايت سيم والدارك
// سيم», the owner's design of it, section by section and in its order, in the dark theme and the
// light map. Proven against what it produces: the button beside «الإحصائيات», the modal over the
// whole screen asking the board's own filters (read only, the reset), the alerts (only real ones,
// counted from the receipts), the five figures with the fuel's «شل أوت / وطنية» and its «بدون شركة»
// line, the three tiles, the clustered time chart, the ring of the kinds, the cars, the drivers'
// rings, the fuel without its station panel — Latin digits throughout, every share left to right.
// Since «عاوز اضيف صيانة … وتظهر فى مكان التوكيل فى شاشه العهدة» and «التوكيل … ملهاش علاقة ب
// حاجة», «صيانة» — a receipt — stands where التوكيل stood, in its blue, and no dealership bill is
// anywhere on the board or the dashboard. «عاوزك تشيل من الداش بورد الجدول اللى فى العربيات والسجل
// يكون برا زى ما هو»: the dashboard no longer draws «ملخص لكل سيارة» nor «سجل كل الحركات» — the
// board holds both, a car's «السجل» opens from the board, and «وخلى الالوان زى ما انت عامل فى الداش
// بورد» — the board's two tables wear the colours the dashboard's tables wore. Since «هادية», the
// board's look calmer: its figures the dashboard's KPI cards with the share's bar, each table on a
// table card under a strip with its count, the pager in the card's foot, a car's sums in plain ink
// — and, as the owner asked, «انت مش كنت خليت الارقام بتاعت التوكيل و الوقود وكدا بيكون جمبهم نقط
// الوان غيرتها ليه», a dot of the kind's colour beside every sum that is not zero and on each
// kind's heading. The toolbar's «الإحصائيات» and «لوحة تحكم» stay the site's purple.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetCustodyDashboardDto,
  type FleetCustodyMovementDto,
  type FleetCustodySummaryDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { CustodyPage } from './CustodyPage';
import { ALARMS_CODE_TYPE } from './MaintenanceAlarmsPage';
import {
  CustodyAlerts,
  CustodyDashboard,
  CustodyDashboardBody,
  CustodyDashboardContent,
  CustodyDashboardFilterBar,
  custodyDashboardView,
  custodyFilterChips,
  custodyFiltered,
  custodyHasAlerts,
  CustodyKpis,
  custodyTrapFocus,
  type CustodyDashboardFilters,
} from '../components/CustodyDashboard';
import {
  CUSTODY_RINGS,
  CustodyByKindSource,
  CustodyFuelBreakdown,
  custodyPlotMinWidth,
  custodyReceipts,
  CustodyTimeline,
  custodyTimelineFrame,
  custodyTopKinds,
  CustodyTopCars,
  CustodyTopDrivers,
} from '../components/CustodyDashboardCharts';
import {
  custodyCarLogQuery,
  custodyCarOf,
  CustodyCarLog,
  CustodyCarLogBody,
  custodyCurrentCar,
  custodyKindText,
  LOG_ICON,
} from '../components/CustodyCarLog';
import {
  CAIRO,
  CARD,
  CARD_BORDER,
  CARD_SURFACE,
  COMPANY,
  TABLE_CARD,
  TITLE,
  custodyArcs,
  custodyCountForm,
  custodyPeriod,
  custodyShare1,
  custodyTicks,
} from '../components/custody-dashboard-parts';
import { CustodyFigures, custodyShare, custodySharePct } from '../components/CustodyFigures';
import {
  CUSTODY_KIND,
  CUSTODY_KINDS,
  CUSTODY_TOTAL_ACCENT,
  CUSTODY_TOTAL_TILE,
} from '../components/CustodyKinds';
import { FleetPager } from '../components/FleetPager';
import { NUM } from '../components/FuelCardBoard';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const PAGE = read('CustodyPage.tsx');
const MODAL = read('../components/CustodyDashboard.tsx');
const CHARTS = read('../components/CustodyDashboardCharts.tsx');
const PARTS = read('../components/custody-dashboard-parts.tsx');
const KINDS = read('../components/CustodyKinds.tsx');
const FIGURES = read('../components/CustodyFigures.tsx');
const PAGER = read('../components/FleetPager.tsx');
const QUERIES = read('../api/fleet-queries.ts');
const CAR_LOG = read('../components/CustodyCarLog.tsx');
const DASHBOARD = [MODAL, CHARTS, PARTS, CAR_LOG].join('\n');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const me = (): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: { 'fleetCustody.view': 'organization' },
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
const mount = (qc: QueryClient, node: JSX.Element, path = '/fleet/custody'): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
const draw = (node: JSX.Element): string => mount(client(), node);

/** 12 October 2026, mid-morning UTC — the time chart's «today». */
const NOW = Date.UTC(2026, 9, 12, 10);

/**
 * Every part adds up: the kinds, the cars, the stretches, the drivers and the receipts. Car 63's
 * «صيانة» receipt (850) names no driver — it is one of the two lines of «بدون سائق».
 */
const dashboard: FleetCustodyDashboardDto = {
  count: 6,
  total: 4335.5,
  maintenance: 850,
  fuel: 1965.5,
  tyres: 1400,
  wash: 120,
  // The fund — what «شحن العهدة» charged into it — 4,335.50 of it spent: «8.7%».
  fundTotal: 50_000,
  vehicles: [
    {
      vehicleId: 'v-204',
      vehicleCode: '204',
      maintenance: 0,
      fuel: 1650.5,
      tyres: 0,
      wash: 120,
      total: 1770.5,
    },
    {
      vehicleId: 'v-63',
      vehicleCode: '63',
      maintenance: 850,
      fuel: 0,
      tyres: 1400,
      wash: 0,
      total: 2250,
    },
    {
      vehicleId: 'v-160',
      vehicleCode: '160',
      maintenance: 0,
      fuel: 315,
      tyres: 0,
      wash: 0,
      total: 315,
    },
  ],
  vehicleCount: 3,
  counts: { maintenance: 1, fuel: 3, tyres: 1, wash: 1 },
  bySource: [{ ref: 'receipt', count: 6, amount: 4335.5 }],
  timeline: {
    granularity: 'month',
    buckets: [
      { key: '2026-08', maintenance: 0, fuel: 315, tyres: 0, wash: 0, total: 315, count: 1 },
      { key: '2026-09', maintenance: 0, fuel: 0, tyres: 0, wash: 0, total: 0, count: 0 },
      {
        key: '2026-10',
        maintenance: 850,
        fuel: 1650.5,
        tyres: 1400,
        wash: 120,
        total: 4020.5,
        count: 5,
      },
    ],
  },
  drivers: [
    {
      driverEmployeeId: 'e-7',
      driverName: 'محمد رأفت عبد الله',
      maintenance: 0,
      fuel: 500,
      tyres: 1400,
      wash: 0,
      total: 1900,
      count: 2,
    },
    {
      driverEmployeeId: null,
      driverName: 'سائق اللوحة',
      maintenance: 0,
      fuel: 1465.5,
      tyres: 0,
      wash: 0,
      total: 1465.5,
      count: 2,
    },
  ],
  noDriver: { count: 2, amount: 970 },
  fuelTypes: [
    { fuelType: 'petrol80', count: 1, amount: 315, litres: 20, companies: [] },
    { fuelType: 'diesel', count: 1, amount: 500, litres: 43.48, companies: ['wataniya'] },
    { fuelType: null, count: 1, amount: 1150.5, litres: 0, companies: [] },
  ],
  litres: 63.48,
  litresMissing: 1,
  // 10 August to 7 October, both kept.
  periodDays: 59,
  fuelByCompany: {
    companies: [
      {
        company: 'wataniya',
        amount: 500,
        count: 1,
        litres: 43.48,
        types: [{ fuelType: 'diesel', amount: 500, count: 1, litres: 43.48 }],
      },
      { company: 'chillout', amount: 0, count: 0, litres: 0, types: [] },
    ],
    none: {
      amount: 1465.5,
      count: 2,
      litres: 20,
      types: [
        { fuelType: 'petrol80', amount: 315, count: 1, litres: 20 },
        { fuelType: null, amount: 1150.5, count: 1, litres: 0 },
      ],
    },
  },
  alerts: {
    doubleFuel: [],
    receiptsWithoutPhoto: 0,
    duplicateReceipts: 0,
  },
};

/**
 * The server's answer when nothing moved (`custodyDashboard([], {})`): every sum and count zero,
 * the receipts and both companies at zero, no month on the time chart — and a fund with money in
 * it.
 */
const nothing: FleetCustodyDashboardDto = {
  count: 0,
  total: 0,
  maintenance: 0,
  fuel: 0,
  tyres: 0,
  wash: 0,
  fundTotal: 50_000,
  vehicles: [],
  vehicleCount: 0,
  counts: { maintenance: 0, fuel: 0, tyres: 0, wash: 0 },
  bySource: [{ ref: 'receipt', count: 0, amount: 0 }],
  timeline: { granularity: 'month', buckets: [] },
  drivers: [],
  noDriver: { count: 0, amount: 0 },
  fuelTypes: [],
  litres: 0,
  litresMissing: 0,
  periodDays: 0,
  fuelByCompany: {
    companies: [
      { company: 'wataniya', amount: 0, count: 0, litres: 0, types: [] },
      { company: 'chillout', amount: 0, count: 0, litres: 0, types: [] },
    ],
    none: { amount: 0, count: 0, litres: 0, types: [] },
  },
  alerts: {
    doubleFuel: [],
    receiptsWithoutPhoto: 0,
    duplicateReceipts: 0,
  },
};

/** Every alert the server can raise, the first one four times over. */
const alerting: FleetCustodyDashboardDto['alerts'] = {
  doubleFuel: [
    { vehicleId: 'v-150', vehicleCode: '150', date: '2026-10-04', count: 2 },
    { vehicleId: 'v-77', vehicleCode: '77', date: '2026-10-03', count: 3 },
    { vehicleId: 'v-204', vehicleCode: '204', date: '2026-10-02', count: 2 },
    { vehicleId: 'v-63', vehicleCode: '63', date: '2026-10-01', count: 2 },
  ],
  receiptsWithoutPhoto: 1,
  duplicateReceipts: 0,
};

const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  source: undefined,
  driver: undefined,
};

const body = (data: FleetCustodyDashboardDto = dashboard): string =>
  mount(client(), <CustodyDashboardBody data={data} now={NOW} />);

/** The markup of one section of the body, up to the next one. */
const section = (html: string, id: string): string => {
  const at = html.indexOf(`data-custody-dashboard-section="${id}"`);
  expect(at, `the «${id}» section`).toBeGreaterThan(-1);
  const next = html.indexOf('data-custody-dashboard-section=', at + 10);
  return html.slice(at, next === -1 ? undefined : next);
};
/** The opening tag's class list of the first element carrying `attr`. */
const classesOf = (html: string, attr: string): string[] => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  const tag = html.slice(Math.max(0, html.lastIndexOf('<', at)), html.indexOf('>', at));
  return (/class="([^"]*)"/u.exec(tag)?.[1] ?? '').split(' ');
};
/**
 * A piece's words as a reader sees them: every tag a gap (the boxes and chips stand apart on the
 * screen), the rest of a tag it was cut in the middle of dropped, brackets hugging what they hold.
 */
const text = (part: string): string =>
  part
    .replace(/^[^<]*>/u, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .replace(/\(\s+/gu, '(')
    .replace(/\s+\)/gu, ')')
    .replace(/\s+([:.،])(?=\s|$)/gu, '$1')
    .trim();
/** A class list as React writes it into the markup — `&`, `>`, `'` and `"` escaped. */
const esc = (classes: string): string =>
  classes
    .replace(/&/gu, '&amp;')
    .replace(/>/gu, '&gt;')
    .replace(/'/gu, '&#x27;')
    .replace(/"/gu, '&quot;');
/** A share as the board writes it: a span of its own, left to right, holding exactly `share`. */
const pct = (share: string): RegExp =>
  new RegExp(`<span dir="ltr" data-custody-pct="true" class="[^"]*">${share}</span>`, 'u');

const movement = (over: Partial<FleetCustodyMovementDto>): FleetCustodyMovementDto => ({
  id: 'm',
  ref: 'receipt',
  source: 'fuel',
  date: '2026-10-05T08:00:00.000Z',
  vehicleId: 'v-150',
  vehicleCode: '150',
  driverEmployeeId: 'e-1',
  driverName: 'إبراهيم جميل رمضان داود',
  fuelType: 'petrol92',
  company: 'chillout',
  detail: null,
  amount: 150,
  ...over,
});
const logRows: FleetCustodyMovementDto[] = [
  movement({ id: 'f1' }),
  movement({ id: 'f2', fuelType: 'diesel', company: 'wataniya', amount: 151 }),
  movement({ id: 'f3', fuelType: null, company: null, amount: 152 }),
  // A wash with a «kind» the receipt never records — the log must not invent one either.
  movement({ id: 'w1', source: 'wash', fuelType: null, company: null, detail: 'غسيل كيماوي' }),
  movement({ id: 't1', source: 'tyres', fuelType: null, company: null, amount: 750 }),
  // «صيانة» — a receipt like the tyres and the wash: no fuel type, no company, a driver named.
  movement({ id: 'm1', source: 'maintenance', fuelType: null, company: null, amount: 1470 }),
];

/**
 * The custody board itself, over no filter: «ملخص لكل سيارة» the dashboard's three cars (and the
 * fund's totals) — or what `over` puts in their place — «كل الحركات» the `rows` given, newest first.
 */
const board = (
  rows: FleetCustodyMovementDto[] = [movement({})],
  search = '',
  over: Partial<FleetCustodySummaryDto> = {},
): string => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'custody', { summary: true, ...FILTERS }), {
    count: dashboard.count,
    total: dashboard.total,
    maintenance: dashboard.maintenance,
    fuel: dashboard.fuel,
    tyres: dashboard.tyres,
    wash: dashboard.wash,
    vehicles: dashboard.vehicles,
    fundTotal: dashboard.fundTotal,
    ...over,
  } satisfies FleetCustodySummaryDto);
  qc.setQueryData(
    listKey('fleet', 'custody', {
      ...FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  return mount(qc, <CustodyPage />, `/fleet/custody${search}`);
};

/**
 * «وطنيه لوخدها وشيل اوت لوحدها»: the fund's fuel by company with each company's own types —
 * Wataniya diesel and 92, Chill Out 80/92/95 and a receipt with no type, two with no company.
 */
const split: FleetCustodyDashboardDto = {
  ...dashboard,
  fuel: 2400,
  fuelByCompany: {
    companies: [
      {
        company: 'wataniya',
        amount: 1200,
        count: 4,
        litres: 70,
        types: [
          { fuelType: 'petrol92', amount: 300, count: 1, litres: 20 },
          { fuelType: 'diesel', amount: 900, count: 3, litres: 50 },
        ],
      },
      {
        company: 'chillout',
        amount: 800,
        count: 4,
        litres: 40,
        types: [
          { fuelType: 'petrol80', amount: 200, count: 1, litres: 10 },
          { fuelType: 'petrol92', amount: 250, count: 1, litres: 15 },
          { fuelType: 'petrol95', amount: 300, count: 1, litres: 15 },
          { fuelType: null, amount: 50, count: 1, litres: 0 },
        ],
      },
    ],
    none: {
      amount: 400,
      count: 2,
      litres: 12,
      types: [
        { fuelType: 'diesel', amount: 350, count: 1, litres: 12 },
        { fuelType: null, amount: 50, count: 1, litres: 0 },
      ],
    },
  },
};
/** One company's part of «تفصيل استهلاك الوقود», up to the next company. */
const company = (html: string, name: string): string => {
  const at = html.indexOf(`data-custody-fuel-company="${name}"`);
  expect(at, name).toBeGreaterThan(-1);
  const next = html.indexOf('data-custody-fuel-company="', at + 10);
  return html.slice(
    html.lastIndexOf('<', at),
    next === -1 ? undefined : html.lastIndexOf('<', next),
  );
};
/** A company's header — everything before its first fuel type. */
const headOf = (part: string): string =>
  part.slice(0, part.lastIndexOf('<', part.indexOf('data-custody-fuel-type=')));
/** The fuel types a company lists, in order. */
const types = (part: string): string[] =>
  [...part.matchAll(/data-custody-fuel-type="(\w+)"/gu)].map((m) => m[1] ?? '');
/** One fuel type's row under a company. */
const fuelRow = (part: string, type: string): string => {
  const at = part.indexOf(`data-custody-fuel-type="${type}"`);
  expect(at, type).toBeGreaterThan(-1);
  const next = part.indexOf('data-custody-fuel-type="', at + 10);
  return part.slice(
    part.lastIndexOf('<', at),
    next === -1 ? undefined : part.lastIndexOf('<', next),
  );
};

describe('«لوحة تحكم» on the custody board', () => {
  it('sits right beside «الإحصائيات», closed on the way in, and asks the board’s own filters', () => {
    const qc = client();
    qc.setQueryData(listKey('fleet', 'custody', { summary: true, ...FILTERS }), {
      count: 0,
      total: 0,
      maintenance: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      vehicles: [],
      fundTotal: 0,
    } satisfies FleetCustodySummaryDto);
    const html = mount(qc, <CustodyPage />);
    const stats = html.indexOf('data-custody-stats-toggle="true"');
    const open = html.indexOf('data-custody-dashboard-open="true"');
    const excel = html.indexOf('data-export="custody"');
    expect(stats).toBeGreaterThan(-1);
    expect(open, 'after «الإحصائيات»').toBeGreaterThan(stats);
    expect(excel, 'and before the files').toBeGreaterThan(open);
    // No other control between the two: beside it.
    expect(html.slice(stats, html.lastIndexOf('<button', open))).not.toContain('<button');
    const button = html.slice(html.lastIndexOf('<button', open), html.indexOf('</button>', open));
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(ar('fleet.custody.dashboard.open')).toBe('لوحة تحكم');
    expect(button).toContain(ar('fleet.custody.dashboard.open'));
    expect(html, 'closed on the way in').not.toContain('data-custody-dashboard="true"');
    // The very `filters` the figures read — never a second copy of them.
    expect(PAGE).toContain('filters={filters}');
    expect(PAGE).toContain('useCustodySummary(filters)');
    expect(MODAL).toContain('useCustodyDashboard({ ...filters }, open)');
  });

  it('wires what the dashboard asks of the board: reset and «عرض حركات الصيانة»', () => {
    // «إعادة ضبط الفلاتر» is the filter bar's own clear — one function for both.
    expect(PAGE).toContain(
      '<FilterBar hasActiveFilters={hasActiveFilters} onClear={clearFilters}>',
    );
    expect(PAGE).toContain('onClearFilters={clearFilters}');
    // «عرض حركات الصيانة»: the board's «المصدر» set to «صيانة» — where «عرض حركات التوكيل» was —
    // the dashboard closed.
    expect(PAGE).toMatch(
      /onShowMaintenance=\{\(\) => \{\s*patch\(\{ source: 'maintenance' \}\);\s*setDashOpen\(false\);/u,
    );
    expect(PAGE).not.toContain('onShowDealership');
    // «تصفية متقدمة» sat on the dashboard's «سجل كل الحركات», which is gone — and the hand-off of
    // the focus to the filter bar went with it.
    for (const gone of ['onAdvancedFilter', 'focusFilters', 'ref={filterBar}']) {
      expect(PAGE, gone).not.toContain(gone);
      expect(MODAL, gone).not.toContain(gone);
    }
    const html = mount(client(), <CustodyPage />);
    expect(html).toContain('data-custody-filter-bar="true"');
  });

  it('drops a remembered «المصدر» of التوكيل — no custody kind any more — rather than ask for it', () => {
    // `?source=dealership` from a bookmark or an older visit: read as no «المصدر» at all, so the
    // board asks the very question it asks with none — and the server never refuses it.
    const html = board([movement({ amount: 177 })], '?source=dealership');
    expect(html).toContain('data-custody-grand-total="true"');
    expect(html).toContain('177.00');
    expect(PAGE).toContain('const sources = custodySources(sourcesParam);');
    expect(PAGE).toContain('(FLEET_CUSTODY_SOURCES as readonly string[]).includes(v)');
  });

  it('wears the site’s purple on «الإحصائيات» and «لوحة تحكم», as every other board does — the pager keeps the design’s emerald', () => {
    // «لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات».
    const html = mount(client(), <CustodyPage />);
    for (const attr of ['data-custody-stats-toggle="true"', 'data-custody-dashboard-open="true"']) {
      const cls = classesOf(html, attr);
      expect(cls, attr).toEqual(
        expect.arrayContaining(['border-brand-500/50', 'bg-brand-500/15', 'text-brand-700']),
      );
      expect(cls.join(' '), attr).not.toMatch(/emerald-/u);
    }
    // «لا بنفسجى»: the custody pager's current page is the site's purple, like every other board.
    expect(PAGE).not.toContain('tone="emerald"');
    const meta = { page: 2, pageSize: 25, totalItems: 60, totalPages: 3 };
    const plain = draw(<FleetPager meta={meta} onPageChange={() => undefined} />);
    expect(classesOf(plain, 'aria-current="page"')).toEqual(
      expect.arrayContaining(['bg-brand-600', 'text-white']),
    );
  });

  it('opens over the whole screen — a labelled modal with ×, the design’s page in both themes', () => {
    const qc = client();
    const filters: CustodyDashboardFilters = {
      from: '2026-10-01',
      to: '2026-10-31',
      vehicleCodes: ['204', '63'],
      source: ['fuel', 'wash'],
      driver: 'رأفت',
    };
    qc.setQueryData(listKey('fleet', 'custody', { dashboard: true, ...filters }), dashboard);
    const html = mount(qc, <CustodyDashboard open onClose={() => undefined} filters={filters} />);
    expect(html).toContain('data-custody-dashboard="true"');
    const shell = html.slice(0, html.indexOf('data-custody-dashboard-body'));
    expect(shell).toContain('fixed inset-0 z-[90]');
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain('h-full w-full');
    const labelledBy = /aria-labelledby="([^"]+)"/u.exec(shell)?.[1];
    expect(labelledBy).toBeDefined();
    expect(shell).toContain(`id="${labelledBy ?? ''}"`);
    expect(shell).toContain(ar('fleet.custody.dashboard.title'));
    expect(shell).toContain('data-custody-dashboard-close="true"');
    expect(shell).toContain(`aria-label="${ar('common.close')}"`);
    // The design's body — #f8fafc and slate-800 on the light page, #0b0f19 and slate-200 dark —
    // and its header bar; the body scrolls inside the modal.
    const dialog = classesOf(shell, 'role="dialog"');
    expect(dialog).toEqual(
      expect.arrayContaining([
        'bg-[#f8fafc]',
        'text-slate-800',
        'dark:bg-[#0b0f19]',
        'dark:text-slate-200',
      ]),
    );
    expect(shell).toContain('dark:bg-[#0c111e]/95');
    expect(shell).toContain('overflow-y-auto');
    expect(shell).toContain('max-w-[1600px]');
    // The board's filters lead the body, as the design's filter section does.
    expect(shell.indexOf('data-custody-dashboard-section="filters"')).toBeGreaterThan(-1);
    expect(html).toContain('data-custody-dashboard-body="true"');
    // Closed, nothing at all.
    expect(
      mount(client(), <CustodyDashboard open={false} onClose={() => undefined} filters={{}} />),
    ).toBe('');
  });

  it('closes on Escape and ×, keeps Tab inside, locks the page behind and gives the focus back', () => {
    expect(MODAL).toContain("if (e.key === 'Escape' && !e.defaultPrevented)");
    expect(MODAL).toContain("document.addEventListener('keydown', onKey)");
    expect(MODAL).toContain("document.removeEventListener('keydown', onKey)");
    expect(MODAL).toContain("if (e.key !== 'Tab') return;");
    expect(MODAL).toContain("document.addEventListener('focusin', onFocusIn)");
    expect(MODAL).toContain("document.removeEventListener('focusin', onFocusIn)");
    expect(MODAL).toContain('custodyTrapFocus<Element>({ back, active, first, last, inside })');
    expect(MODAL).toContain("document.body.style.overflow = 'hidden'");
    expect(MODAL).toContain('closeButton.current?.focus()');
    expect(MODAL).toContain('opener?.focus()');
    expect(MODAL).toContain('createPortal(');
  });

  it('wears its faces — the frame while loading, the error with a retry, and every answer whole', () => {
    expect(custodyDashboardView({ isPending: true, isError: false, data: undefined })).toBe(
      'loading',
    );
    expect(custodyDashboardView({ isPending: false, isError: true, data: undefined })).toBe(
      'error',
    );
    expect(custodyDashboardView({ isPending: false, isError: false, data: dashboard })).toBe(
      'ready',
    );
    // «على الاقل الاشكال موجودة»: no movement is still an answer — no face of its own.
    expect(custodyDashboardView({ isPending: false, isError: false, data: nothing })).toBe('ready');
    // A refetch that failed keeps the last answer on screen.
    expect(custodyDashboardView({ isPending: false, isError: true, data: dashboard })).toBe(
      'ready',
    );
    const face = (view: Parameters<typeof CustodyDashboardContent>[0]['view']): string =>
      draw(
        <CustodyDashboardContent
          view={view}
          data={view === 'ready' ? dashboard : undefined}
          error={null}
          onRetry={() => undefined}
        />,
      );
    expect(face('loading')).toContain('data-custody-dashboard-loading="true"');
    expect(face('error')).toContain(ar('common.retry'));
    // The board's filters reach every card — the words of their line, the time chart's months.
    expect(MODAL).toContain('filters={filters}');
    expect(MODAL).not.toContain('EmptyState');
    // Reopened over other filters, never the last filters' sums under the new filters' words.
    const hook = QUERIES.slice(QUERIES.indexOf('export const useCustodyDashboard'));
    expect(hook.slice(0, hook.indexOf('});'))).not.toContain('placeholderData');
    // A refetch dims the last answer rather than blanking it.
    expect(MODAL).toContain("query.isFetching && view === 'ready' && 'opacity-60");
    expect(face('ready')).toContain('data-custody-dashboard-body="true"');
  });

  it('draws the design’s sections in its order — and nothing the design tool added', () => {
    const html = body({ ...dashboard, alerts: alerting });
    const ids = [...html.matchAll(/data-custody-dashboard-section="(\w+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual([
      'alerts',
      'kpis',
      'timeline',
      'byKindSource',
      'topCars',
      'topDrivers',
      'fuel',
    ]);
    // Latin digits throughout, money with «ج.م.» in a span of its own.
    expect(html, 'no Arabic-Indic digit anywhere').not.toMatch(/[٠-٩]/u);
    expect(html).toMatch(/>4,335\.50<\/span><span[^>]*>ج\.م\.<\/span>/u);
    // The design tool's caption is not part of the screen.
    expect(html).not.toContain('نظام إدارة العهدة');
    expect(html).not.toContain('النمط التنفيذي');
  });

  it('serves Cairo from the bundle — never a font from Google at run time', () => {
    expect(DASHBOARD).not.toMatch(/fonts\.googleapis|fonts\.gstatic/u);
    expect(PARTS).toContain("import { BOARD_FONT, ymd } from './FuelCardBoard';");
    expect(read('../components/FuelCardBoard.tsx')).toContain(
      "import '@fontsource/cairo/900.css';",
    );
    // Titles and figures in Cairo, as the design's `font-cairo`.
    const kpis = section(body(), 'kpis');
    expect(kpis).toContain('[font-family:&#x27;Cairo&#x27;,sans-serif]');
  });
});

describe('(0) the board’s filters, read only', () => {
  const bar = (filters: CustodyDashboardFilters, onClearFilters?: () => void): string =>
    draw(<CustodyDashboardFilterBar filters={filters} onClearFilters={onClearFilters} />);

  it('writes the board’s filters as chips — no filter is built inside the dashboard', () => {
    const html = bar({
      from: '2026-10-01',
      to: '2026-10-31',
      vehicleCodes: ['204', '63'],
      source: ['fuel', 'wash'],
    });
    for (const chip of [
      ar('fleet.custody.dashboard.filters.from', { date: '2026/10/01' }),
      ar('fleet.custody.dashboard.filters.to', { date: '2026/10/31' }),
      ar('fleet.custody.dashboard.filters.cars', { codes: '204، 63' }),
      ar('fleet.custody.dashboard.filters.kinds', { kinds: 'وقود، غسيل' }),
    ]) {
      expect(html).toContain(chip);
    }
    for (const control of ['<input', '<select', '<textarea']) expect(html).not.toContain(control);
    // The design's input boxes, as read-only chips, in both themes.
    const chip = html.slice(html.indexOf('<li'), html.indexOf('</li>'));
    expect(chip).toContain('bg-slate-50');
    expect(chip).toContain('dark:bg-[#0a0e17]');
    expect(chip).toContain('dark:border-[#223048]');
    // Nothing chosen: «كل الحركات — بلا فلاتر», and no reset to offer.
    const none = bar({}, () => undefined);
    expect(none).toContain(ar('fleet.custody.dashboard.filters.none'));
    expect(none).not.toContain('data-custody-reset-filters');
  });

  it('says nothing of dealership bills over a driver — every movement is a receipt now', () => {
    // The design's note («تُستثنى فواتير التوكيل…») went with the bills: a driver filter leaves
    // nothing out that the board would otherwise count.
    const withDriver = bar({ driver: 'رأفت' });
    expect(withDriver).not.toContain('data-custody-driver-note');
    expect(withDriver).toContain(ar('fleet.custody.dashboard.filters.driver', { name: 'رأفت' }));
    expect(withDriver).not.toContain('التوكيل');
    expect(MODAL).not.toContain('driverNote');
    expect(bar({ driver: 'رأفت' }, () => undefined)).toContain('data-custody-reset-filters="true"');
  });

  it('offers «إعادة ضبط الفلاتر» only over a filter, and only as the board’s own clear', () => {
    expect(bar({ source: ['fuel'] }, () => undefined)).toContain(
      ar('fleet.custody.dashboard.filters.reset'),
    );
    // No way to clear the board's filters handed in: no button.
    expect(bar({ source: ['fuel'] })).not.toContain('data-custody-reset-filters');
  });

  it('knows a filtered dashboard from an unfiltered one, and writes a long list of cars as a count', () => {
    expect(custodyFiltered({})).toBe(false);
    expect(
      custodyFiltered({ from: '', to: undefined, vehicleCodes: [], source: [], driver: '' }),
    ).toBe(false);
    expect(custodyFiltered({ from: '2026-10-01' })).toBe(true);
    expect(custodyFiltered({ vehicleCodes: ['63'] })).toBe(true);
    expect(custodyFiltered({ driver: 'رأفت' })).toBe(true);
    const t = (key: string, params?: Record<string, string | number>): string => ar(key, params);
    expect(custodyFilterChips({}, t, 'ar')).toEqual([ar('fleet.custody.dashboard.filters.none')]);
    expect(
      custodyFilterChips(
        { vehicleCodes: ['1', '2', '3', '4', '5', '6', '7'], source: ['tyres', 'wash'] },
        t,
        'ar',
      ),
    ).toEqual([
      ar('fleet.custody.dashboard.filters.carCount', { count: '7' }),
      ar('fleet.custody.dashboard.filters.kinds', { kinds: 'كاوتش، غسيل' }),
    ]);
  });
});

describe('(1) the alerts — every one counted from the rows, none estimated', () => {
  const banner = (alerts: FleetCustodyDashboardDto['alerts'] = alerting): string =>
    draw(<CustodyAlerts alerts={alerts} />);

  it('is not drawn at all when there is nothing to warn about', () => {
    expect(custodyHasAlerts(dashboard.alerts)).toBe(false);
    expect(banner(dashboard.alerts)).toBe('');
    expect(body()).not.toContain('data-custody-dashboard-section="alerts"');
    // Any one of the three is enough.
    for (const one of [
      { ...dashboard.alerts, receiptsWithoutPhoto: 1 },
      { ...dashboard.alerts, duplicateReceipts: 2 },
      { ...dashboard.alerts, doubleFuel: alerting.doubleFuel.slice(0, 1) },
    ]) {
      expect(custodyHasAlerts(one)).toBe(true);
    }
  });

  it('names up to three cars fuelled from the fund twice in a day, then «+N»', () => {
    const html = banner();
    const lines = [...html.matchAll(/data-custody-alert="doubleFuel"/gu)];
    expect(lines).toHaveLength(3);
    expect(text(html)).toContain('سيارة 150 قامت بتفويلتين من العهدة في نفس اليوم (2026/10/04).');
    // Three times in a day says so, in the same words.
    expect(text(html)).toContain('سيارة 77 قامت بـ3 تفويلات من العهدة في نفس اليوم (2026/10/03).');
    expect(html).toMatch(/<strong class="[^"]*">150<\/strong>/u);
    expect(html).not.toContain('>63<');
    const more = html.slice(html.indexOf('data-custody-alert="doubleFuelMore"'));
    expect(text(more.slice(more.indexOf('>') + 1, more.indexOf('</span>')))).toBe('+1');
  });

  it('raises nothing for a dealership bill — «التوكيل … ملهاش علاقة ب حاجة», none waits on the fund', () => {
    // The private cars' bills «بانتظار الفاتورة» were the fund's once; no invoice is now.
    const html = banner();
    expect(html).not.toContain('data-custody-alert="pendingBills"');
    expect(html).not.toContain('data-custody-pending-count');
    expect(text(html)).not.toContain('فاتورة ملاكي');
    expect(text(html)).not.toContain('فواتير ملاكي');
    expect(text(html)).not.toContain(ar('fleet.dealership.pending'));
    expect(html).not.toContain('ج.م');
    expect(html).not.toContain('تكلفة معلقة');
    for (const gone of ['pendingPrivateBills', 'pendingBills', 'privateBill', 'custodyDaysSince']) {
      expect(DASHBOARD, gone).not.toContain(gone);
    }
  });

  it('writes the audit line — receipts without a photo, duplicated receipts — in the design’s words', () => {
    const html = banner();
    const audit = html.slice(html.indexOf('data-custody-alert="audit"'));
    expect(text(audit.slice(audit.indexOf('>') + 1, audit.indexOf('</p>')))).toBe(
      '🔍 1 إيصال مسجل بدون صورة مرفقة | 0 إيصالات مكررة بالمبلغ والتاريخ',
    );
    const many = banner({ ...alerting, receiptsWithoutPhoto: 12, duplicateReceipts: 3 });
    expect(text(many)).toContain(
      '12 إيصالًا مسجلًا بدون صورة مرفقة | 3 إيصالات مكررة بالمبلغ والتاريخ',
    );
  });

  it('is not drawn over a dashboard of no movement — every alert is counted from the receipts', () => {
    expect(custodyDashboardView({ isPending: false, isError: false, data: nothing })).toBe('ready');
    const html = draw(
      <CustodyDashboardContent
        view="ready"
        data={nothing}
        error={null}
        onRetry={() => undefined}
        filters={{ driver: 'محمد' }}
        now={NOW}
      />,
    );
    expect(html).not.toContain('data-custody-dashboard-section="alerts"');
    // The figures are all there — and the cards say nothing matched the filter.
    expect(html).toContain('data-custody-dashboard-section="kpis"');
    expect(html).toContain(ar('fleet.custody.dashboard.noMatch'));
    const quiet = draw(
      <CustodyDashboardContent
        view="ready"
        data={nothing}
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(quiet).not.toContain('data-custody-dashboard-section="alerts"');
    expect(quiet).toContain('data-custody-dashboard-section="kpis"');
    expect(quiet).toContain(ar('fleet.custody.dashboard.noMovements'));
  });

  it('wears the design’s amber in both themes', () => {
    const cls = classesOf(banner(), 'data-custody-dashboard-section="alerts"');
    expect(cls).toEqual(
      expect.arrayContaining([
        'bg-amber-50/80',
        'border-amber-200/90',
        'shadow-sm',
        'dark:bg-amber-950/20',
        'dark:border-amber-500/40',
      ]),
    );
    expect(banner()).toContain('text-amber-900 dark:font-semibold dark:text-amber-200');
    // Only a car's code is set in white on the dark, as the design sets it.
    expect(banner()).toMatch(/<strong class="[^"]*dark:text-white[^"]*">150<\/strong>/u);
  });
});

describe('(2) the five figures and the three tiles', () => {
  const kpis = (data: FleetCustodyDashboardDto = dashboard): string =>
    draw(<CustodyKpis data={data} />);
  const card = (html: string, kind: string): string => {
    const at = html.indexOf(`data-custody-kpi="${kind}"`);
    expect(at, kind).toBeGreaterThan(-1);
    const next = html.indexOf('data-custody-kpi="', at + 10);
    return html.slice(at, next === -1 ? html.indexOf('data-custody-tile') : next);
  };

  it('leads with the total in emerald — «100% من المصروف الكلي» and the period’s days', () => {
    const html = kpis();
    const order = [...html.matchAll(/data-custody-kpi="(\w+)"/gu)].map((m) => m[1]);
    // «إجمالي العهدة» first — the fund before what it paid for.
    expect(order).toEqual(['fund', 'total', 'maintenance', 'fuel', 'tyres', 'wash']);
    const total = card(html, 'total');
    expect(total).toContain('4,335.50');
    expect(text(total)).toContain('100% من المصروف الكلي');
    // 59 days: «59 يومًا», as Arabic counts past ten.
    expect(text(total)).toContain('59 يومًا');
    expect(classesOf(total, 'data-custody-kpi="total"')).toEqual(
      expect.arrayContaining([
        'border-emerald-300',
        'bg-gradient-to-br',
        'from-emerald-50/70',
        'dark:border-emerald-500/40',
      ]),
    );
    expect(total).toContain('text-emerald-800 dark:font-semibold dark:text-emerald-300');
    // Ten days, as the design writes them; no period, no chip.
    expect(text(card(kpis({ ...dashboard, periodDays: 10 }), 'total'))).toContain('10 أيام');
    expect(card(kpis({ ...dashboard, periodDays: 0 }), 'total')).not.toContain(
      'data-custody-period-days',
    );
  });

  it('gives each kind its colour edge, its share of the total and its count', () => {
    const html = kpis();
    for (const [kind, sum, share, count] of [
      ['maintenance', '850.00', '20%', '1 حركة'],
      ['fuel', '1,965.50', '45%', '3 حركات وقود'],
      ['tyres', '1,400.00', '32%', '1 حركة'],
      ['wash', '120.00', '3%', '1 حركة'],
    ] as const) {
      const part = card(html, kind);
      expect(part, kind).toContain(sum);
      expect(text(part), kind).toContain(`${share} ${ar('fleet.custody.totals.ofTotal')}`);
      expect(part, kind).toMatch(pct(share));
      const chip = part.slice(part.indexOf(`data-custody-kpi-count="${kind}"`));
      expect(text(chip.slice(chip.indexOf('>') + 1, chip.indexOf('</span>'))), kind).toBe(count);
      // The design's edge and tile — the light map's shade, the dark design's.
      const cls = classesOf(part, `data-custody-kpi="${kind}"`);
      expect(cls, kind).toEqual(
        expect.arrayContaining(CUSTODY_KIND[kind].accent.split(' ').concat(['border-l-4'])),
      );
      expect(part, kind).toContain(CUSTODY_KIND[kind].tile);
      expect(part, kind).toContain(CUSTODY_KIND[kind].label);
    }
    // The light map's edges: blue-600, amber-500, rose-500, cyan-600; the dark design's 500s.
    expect(CUSTODY_KIND.maintenance.accent).toContain('border-l-blue-600');
    expect(CUSTODY_KIND.maintenance.accent).toContain('dark:border-l-blue-500');
    expect(CUSTODY_KIND.fuel.accent).toContain('border-l-amber-500');
    expect(CUSTODY_KIND.tyres.accent).toContain('border-l-rose-500');
    expect(CUSTODY_KIND.wash.accent).toContain('border-l-cyan-600');
    expect(CUSTODY_KIND.wash.accent).toContain('dark:border-l-cyan-500');
  });

  it('splits the fuel into «شل أوت» and «وطنية» by the receipts’ own company — Chill Out first', () => {
    const fuel = card(kpis(), 'fuel');
    const boxes = [...fuel.matchAll(/data-custody-company="(\w+)"/gu)].map((m) => m[1]);
    expect(boxes).toEqual(['chillout', 'wataniya', 'none']);
    const box = (company: string): string => {
      const at = fuel.indexOf(`data-custody-company="${company}"`);
      return fuel.slice(at, fuel.indexOf('data-custody-company=', at + 10));
    };
    // The fuel cards' own word for the company: «شل أوت».
    expect(text(box('chillout'))).toContain(ar('fleet.fuelCards.company.chillout'));
    expect(ar('fleet.fuelCards.company.chillout')).toBe('شل أوت');
    expect(text(box('chillout'))).toContain('0 ج.م. 0% • 0 حركات');
    // 500 of the fuel's 1,965.50: 25%, one receipt.
    expect(text(box('wataniya'))).toContain('500 ج.م. 25% • 1 حركة');
    expect(box('chillout')).toContain('border-amber-200 bg-amber-50/70');
    expect(box('wataniya')).toContain('border-emerald-200 bg-emerald-50/70');
    expect(box('wataniya')).toContain('dark:bg-[#090e18]');
  });

  it('keeps the receipts that name no company on a line of their own — never folded into one', () => {
    const fuel = card(kpis(), 'fuel');
    const none = fuel.slice(fuel.indexOf('data-custody-company="none"'));
    expect(text(none.slice(none.indexOf('>') + 1, none.indexOf('</div>')))).toBe(
      'بدون شركة: 1,466 ج.م. (2)',
    );
    // Nothing without a company: no line at all.
    const named = card(
      kpis({
        ...dashboard,
        fuelByCompany: {
          ...dashboard.fuelByCompany,
          none: { amount: 0, count: 0, litres: 0, types: [] },
        },
      }),
      'fuel',
    );
    expect(named).not.toContain('data-custody-company="none"');
  });

  it('closes on the movements and their rate, the cars and their average, the litres', () => {
    const html = kpis();
    const tile = (id: string): string => {
      const at = html.indexOf(`data-custody-tile="${id}"`);
      const next = html.indexOf('data-custody-tile=', at + 10);
      return text(html.slice(at, next === -1 ? undefined : next));
    };
    // 6 movements over 59 days: 0.1 a day, one decimal at most.
    expect(tile('movements')).toContain('6 حركات');
    expect(tile('movements')).toContain('معدل 0.1 حركات/يوم');
    // 4,335.50 over 3 cars.
    expect(tile('cars')).toContain(ar('fleet.custody.dashboard.kpi.carsServed'));
    expect(tile('cars')).toContain('3 سيارات');
    expect(tile('cars')).toContain('متوسط 1,445 ج.م/سيارة');
    expect(tile('litres')).toContain('63.48 لتر');
    expect(tile('litres')).toContain(ar('fleet.custody.dashboard.litresMissing', { count: '1' }));
    // No period, no car, no litres missing: no chip — never a rate over nothing.
    const bare = kpis({ ...dashboard, periodDays: 0, vehicleCount: 0, litresMissing: 0 });
    for (const chip of [
      'data-custody-rate',
      'data-custody-per-car',
      'data-custody-litres-missing',
    ]) {
      expect(bare, chip).not.toContain(chip);
    }
    expect(bare).not.toMatch(/NaN|Infinity/u);
  });
});

describe('(3) «المصروف عبر الزمن» — clustered, not stacked', () => {
  const chart = (data: FleetCustodyDashboardDto = dashboard, table = false): string =>
    draw(<CustodyTimeline data={data} initialTable={table} />);
  const column = (html: string, i: number): string => {
    const at = html.indexOf(`data-custody-column="${i}"`);
    const next = html.indexOf('data-custody-column=', at + 10);
    return html.slice(at, next === -1 ? html.indexOf('data-custody-legend') : next);
  };

  it('draws four thin bars a period in the kinds’ order — a kind with nothing a 2px stub', () => {
    const html = chart();
    expect([...html.matchAll(/data-custody-column="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '0',
      '1',
      '2',
    ]);
    const october = column(html, 2);
    const marks = [...october.matchAll(/data-custody-mark="(\w+)"[^>]*style="height:([\d.]+)%"/gu)];
    expect(marks.map((m) => m[1])).toEqual(['maintenance', 'fuel', 'tyres', 'wash']);
    // Each bar against the axis's top (2,000 — the round step over the dearest BAR, 1,650.50):
    // 850 is 42.5%, 1,650.50 is 82.525%. Not stacked: no bar is the period's total.
    expect(Number(marks[0]?.[2])).toBeCloseTo(42.5, 3);
    expect(Number(marks[1]?.[2])).toBeCloseTo(82.525, 3);
    expect(custodyTicks(1650.5)).toEqual([0, 500, 1000, 1500, 2000]);
    // August: fuel only — the other three are stubs in their pale shade.
    const august = column(html, 0);
    expect([...august.matchAll(/data-custody-stub="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'maintenance',
      'tyres',
      'wash',
    ]);
    expect(august).toContain(CUSTODY_KIND.tyres.stub);
    // September spent nothing: four stubs, no bar.
    expect(column(html, 1)).not.toContain('data-custody-mark');
    for (const kind of CUSTODY_KINDS) {
      expect(october).toContain(CUSTODY_KIND[kind].fill);
    }
  });

  it('reads out the latest period in emerald, the dearest in amber — and the keys still walk it', () => {
    const html = chart();
    // October is both the latest and the dearest: the read-out period wins.
    expect(column(html, 2)).toMatch(/data-custody-current="true"[^>]*>4,021</u);
    expect(html).not.toContain('data-custody-peak');
    expect(column(html, 2)).toContain(
      'bg-emerald-50 ring-1 ring-emerald-400 dark:bg-emerald-950/30 dark:ring-emerald-400/50',
    );
    // A dearest period that is not the latest carries its total in amber.
    const earlier = chart({
      ...dashboard,
      timeline: {
        granularity: 'month',
        buckets: [dashboard.timeline.buckets[2], dashboard.timeline.buckets[0]].map(
          (bucket, i) => ({ ...bucket!, key: i === 0 ? '2026-09' : '2026-10' }),
        ),
      },
    });
    expect(column(earlier, 0)).toMatch(/data-custody-peak="true"[^>]*>4,021</u);
    expect(column(earlier, 0)).toContain('text-amber-700 dark:text-amber-300');
    expect(column(earlier, 0)).toContain(
      'bg-amber-50/60 ring-1 ring-amber-300 dark:bg-emerald-950/20 dark:ring-emerald-500/30',
    );
    expect(column(earlier, 1)).toMatch(/data-custody-current="true"[^>]*>315</u);
    // One stop on the Tab path, the arrows from the current implementation.
    expect(html.match(/tabindex="0"/gu)?.length).toBe(1);
    expect(CHARTS).toContain("e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0");
    expect(CHARTS).toContain("e.key === 'Home' ? 0 : e.key === 'End' ? buckets.length - 1");
    // Each column says what it holds to a screen reader; time runs left to right.
    expect(html).toContain(
      'aria-label="2026/10: 4,020.50 ج.م.، صيانة 850.00 ج.م. (21%)، وقود 1,650.50 ج.م. (41%)',
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('dir="ltr"');
  });

  it('writes the readout — the period, its total, each kind’s sum and share, its movements', () => {
    const readout = chart().slice(chart().indexOf('data-custody-readout="true"'));
    const strip = readout.slice(0, readout.indexOf('data-custody-column'));
    expect(text(strip)).toContain('2026/10');
    expect(text(strip)).toContain('إجمالي: 4,020.50 ج.م.');
    for (const [kind, sum, share] of [
      ['maintenance', '850.00', '21%'],
      ['fuel', '1,650.50', '41%'],
      ['tyres', '1,400.00', '35%'],
      ['wash', '120.00', '3%'],
    ] as const) {
      const at = strip.indexOf(`data-custody-tip-row="${kind}"`);
      const row = strip.slice(at, strip.indexOf('data-custody-tip-row', at + 1));
      expect(text(row.slice(row.indexOf('>') + 1)), kind).toContain(
        `${ar(`fleet.custody.source.${kind}`)}: ${sum} (${share})`,
      );
      expect(row, kind).toContain(CUSTODY_KIND[kind].soft);
    }
    expect(text(strip)).toContain('| 5 حركات');
    expect(chart()).toContain('aria-live="polite" data-custody-readout="true"');
    expect(strip).toContain('dark:border-emerald-500/30');
  });

  it('switches «رسم بياني / جدول» — pressed emerald dark, a white pill light — and says the granularity', () => {
    const html = chart();
    const pressed = classesOf(html, 'data-custody-view="chart"');
    expect(html).toMatch(/aria-pressed="true" data-custody-view="chart"/u);
    expect(html).toMatch(/aria-pressed="false" data-custody-view="table"/u);
    expect(pressed).toEqual(
      expect.arrayContaining([
        'bg-white',
        'font-bold',
        'text-slate-900',
        'shadow-sm',
        'dark:bg-emerald-600',
      ]),
    );
    expect(ar('fleet.custody.dashboard.showChart')).toBe('رسم بياني');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.byMonth'));
    expect(ar('fleet.custody.dashboard.byMonth')).toBe('شهريًا بشهر');
    expect(ar('fleet.custody.dashboard.byDay')).toBe('يوميًا');
    // The table: every period, every kind, its total and count.
    const table = chart(dashboard, true);
    expect(table).toMatch(/aria-pressed="true" data-custody-view="table"/u);
    expect(table).not.toContain('data-custody-column');
    const october = table.slice(table.indexOf('data-custody-period-row="2026-10"'));
    expect(text(october.slice(0, october.indexOf('</tr>')))).toBe(
      '2026/10 850.00 1,650.50 1,400.00 120.00 4,020.50 ج.م. 5',
    );
    // The legend under the chart, the kinds in their colours.
    const legend = html.slice(html.indexOf('data-custody-legend="true"'));
    expect([...legend.matchAll(/data-custody-swatch="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...CUSTODY_KINDS,
    ]);
  });

  it('goes day by day when the filter spans a month', () => {
    const days: FleetCustodyDashboardDto = {
      ...dashboard,
      timeline: {
        granularity: 'day',
        buckets: Array.from({ length: 31 }, (_, i) => ({
          key: `2026-10-${String(i + 1).padStart(2, '0')}`,
          maintenance: 0,
          fuel: i === 3 ? 500 : 0,
          tyres: 0,
          wash: 0,
          total: i === 3 ? 500 : 0,
          count: i === 3 ? 1 : 0,
        })),
      },
    };
    const html = chart(days);
    expect(text(html)).toContain(ar('fleet.custody.dashboard.byDay'));
    expect(html.match(/data-custody-column="/gu)?.length).toBe(31);
    expect(html).toContain('2026/10');
    expect(html).toContain(`min-width:${custodyPlotMinWidth(31, true)}px`);
  });

  it('fits a month of days and a year of months in its card — a scroller only past that', () => {
    // The card beside the rings (7 of 12) holds about 510px of plot from a 1,024px screen up and
    // 650px at 1,280px; a plot wider than that opens scrolled, hiding the first periods.
    const ROOM = 510;
    expect(custodyPlotMinWidth(31, true)).toBeLessThanOrEqual(ROOM);
    expect(custodyPlotMinWidth(12, false)).toBeLessThanOrEqual(ROOM);
    // Still room for four bars of 2px a day and a gap: the minimum is not zero.
    expect(custodyPlotMinWidth(31, true)).toBeGreaterThanOrEqual(31 * (4 * 2 + 3 + 2) + 48);
    // On a phone (about 300px of plot) a month of days or a year of months scrolls inside the card.
    expect(custodyPlotMinWidth(31, true)).toBeGreaterThan(343);
    expect(custodyPlotMinWidth(12, false)).toBeGreaterThan(343);
    // The months the dashboard draws carry the same minimum.
    expect(chart()).toContain(`min-width:${custodyPlotMinWidth(3, false)}px`);
  });
});

describe('(4) «حسب النوع» — the ring of the kinds', () => {
  const card = (onShow?: () => void, data = dashboard): string =>
    draw(<CustodyByKindSource data={data} onShowMaintenance={onShow} />);

  it('is titled without the stations — there is no station data — and without the source', () => {
    const html = card();
    expect(text(html)).toContain('حسب النوع');
    // «المصدر» was the receipts screen against the dealership's bills: one source now, no ring.
    expect(text(html)).not.toContain('حسب النوع والمصدر');
    expect(html).not.toContain('محطات');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.donut.chip'));
  });

  it('rings the kinds — no ring of the source — the total in the middle, each theme its shades', () => {
    const html = card();
    const arcs = [
      ...html.matchAll(/data-custody-arc="(\w+)"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/gu),
    ];
    // «صيانة» first, where التوكيل was; nothing for the receipts screen or the dealership.
    expect(arcs.map((m) => m[1])).toEqual([...CUSTODY_KINDS]);
    expect(arcs.map((m) => m[1])[0]).toBe('maintenance');
    // The ring's length is 402.12 (r 64); the inner one (r 44) is gone.
    expect(arcs[0]?.[3]).toBe('402.12');
    expect(html).not.toContain('276.46');
    // Fuel 45% of the ring, less the design's 4 between parts.
    expect(Number(arcs[1]?.[2])).toBeCloseTo((1965.5 / 4335.5) * 402.1239 - 4, 1);
    expect(html).toContain('stroke-[#e2e8f0] dark:stroke-[#162032]');
    expect(html).not.toContain('stroke-[#f1f5f9] dark:stroke-[#131b29]');
    expect(CUSTODY_KIND.maintenance.stroke).toBe('stroke-[#2563eb] dark:stroke-[#3b82f6]');
    expect(CUSTODY_KIND.tyres.stroke).toBe('stroke-[#e11d48] dark:stroke-[#f43f5e]');
    expect(CUSTODY_KIND.wash.stroke).toBe('stroke-[#0891b2] dark:stroke-[#06b6d4]');
    expect(html).not.toContain('stroke-[#059669] dark:stroke-[#10b981]');
    const middle = html.indexOf('pointer-events-none absolute inset-0 flex flex-col');
    const centre = text(html.slice(middle, html.indexOf('data-custody-donut-legend')));
    expect(centre).toContain('المصروف 4,336 100%');
    expect(html).toMatch(
      /role="img" data-custody-donut="true" aria-label="صيانة: 850\.00 ج\.م\. \(20%\)/u,
    );
    const label = /data-custody-donut="true" aria-label="([^"]*)"/u.exec(html)?.[1] ?? '';
    expect(label).toMatch(/غسيل: 120\.00 ج\.م\. \(3%\)$/u);
    expect(label).not.toContain('التوكيل');
  });

  it('writes the legend — fuel’s box with «شل أوت / وطنية» and the receipts with no company', () => {
    const html = card();
    const legend = html.slice(html.indexOf('data-custody-donut-legend'));
    expect(text(legend)).toContain('الحلقة (النوع ومورّد الوقود) 4 فئات');
    const fuel = legend.slice(legend.indexOf('data-custody-legend-kind="fuel"'));
    expect(text(fuel.slice(0, fuel.indexOf('data-custody-legend-kind="tyres"')))).toContain(
      'وقود (شل أوت / وطنية) 45% (1,966 ج.م.)',
    );
    expect(text(fuel)).toContain('⛽ شل أوت: 0 (0%)');
    expect(text(fuel)).toContain('⛽ وطنية: 500 (25%)');
    expect(text(fuel)).toContain('بدون شركة: 1,466 (75%)');
    expect(fuel).toContain('border-amber-200 bg-amber-50/70');
    expect(text(legend)).toContain('صيانة 20% (850 ج.م.)');
    // No part of the legend for a source: the receipts are the fund's one source now.
    expect(text(legend)).not.toContain('الحلقة الداخلية');
    expect(text(legend)).not.toContain('مصدران');
    expect(text(legend)).not.toContain('التوكيل');
    expect(legend).not.toContain('data-custody-source-row');
  });

  it('tabulates the kinds — amount, share, movements — fuel split by company under its name', () => {
    const html = card();
    const rows = [...html.matchAll(/data-custody-kind-row="(\w+)"/gu)].map((m) => m[1]);
    expect(rows).toEqual([...CUSTODY_KINDS]);
    const fuel = html.slice(html.indexOf('data-custody-kind-row="fuel"'));
    expect(text(fuel.slice(0, fuel.indexOf('</tr>')))).toBe(
      'وقود (شل أوت / وطنية) شل أوت: 0 ج.م. | وطنية: 500 ج.م. | بدون شركة: 1,466 ج.م. 1,965.50 ج.م. 45% 3',
    );
    expect(html).toContain(
      'bg-slate-100 text-[11px] text-slate-600 dark:border-transparent dark:bg-[#0b101c]',
    );
  });

  it('names the fuel suppliers in its footer and offers «عرض حركات الصيانة» when the board can', () => {
    const html = card(() => undefined);
    const footer = html.slice(html.indexOf('data-custody-suppliers="true"'));
    expect(text(footer.slice(0, footer.indexOf('<button')))).toContain(
      'مورّدو الوقود: شل أوت (0%) • وطنية (25%) • بدون شركة (75%)',
    );
    expect(html).toContain('data-custody-show-maintenance="true"');
    expect(text(html)).toContain('عرض حركات الصيانة');
    expect(text(html)).not.toContain('عرض حركات التوكيل');
    expect(card()).not.toContain('data-custody-show-maintenance');
    // No fuel: no suppliers named.
    const dry = card(undefined, { ...dashboard, fuel: 0 });
    const dryFooter = dry.slice(dry.indexOf('data-custody-suppliers="true"'));
    expect(dryFooter.slice(0, dryFooter.indexOf('</span>'))).not.toContain('مورّدو');
  });

  it('draws an arc for a share only — a kind with nothing draws none, one part closes the ring', () => {
    expect(custodyArcs([0, 0], 100, 4)).toEqual([
      { length: 0, offset: -0, value: 0 },
      { length: 0, offset: -0, value: 0 },
    ]);
    expect(custodyArcs([5, 0], 100, 4)[0]).toEqual({ length: 100, offset: -0, value: 5 });
    const two = custodyArcs([1, 3], 100, 4);
    expect(two[0]).toEqual({ length: 21, offset: -0, value: 1 });
    expect(two[1]).toEqual({ length: 71, offset: -25, value: 3 });
    const html = card(undefined, { ...dashboard, wash: 0, total: dashboard.total - 120 });
    expect(html).not.toContain('data-custody-arc="wash"');
  });
});

describe('(5) the cars, (6) the drivers, (7) the fuel', () => {
  it('ranks the cars — each bar the FULL width, split by that car’s own kinds', () => {
    const html = draw(<CustodyTopCars data={dashboard} />);
    expect([...html.matchAll(/data-custody-car="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '63',
      '204',
      '160',
    ]);
    expect(text(html)).toContain('أعلى 3 سيارات استهلاكًا للعهدة');
    expect(html).toContain('data-custody-legend="true"');
    // The legend names each kind as everywhere else — «صيانة», where the design wrote «توكيل».
    const legend = html.slice(html.indexOf('data-custody-legend="true"'));
    expect(text(legend.slice(0, legend.indexOf('</div>')))).toContain('صيانة وقود كاوتش غسيل');
    expect(text(html)).not.toContain('توكيل');
    const car63 = html.slice(
      html.indexOf('data-custody-car="63"'),
      html.indexOf('data-custody-car="204"'),
    );
    const widths = [...car63.matchAll(/data-custody-mark="(\w+)"[^>]*style="width:([\d.]+)%"/gu)];
    expect(widths.map((m) => m[1])).toEqual(['maintenance', 'tyres']);
    expect(widths.reduce((sum, m) => sum + Number(m[2]), 0)).toBeCloseTo(100, 6);
    expect(text(car63)).toContain('2,250.00 ج.م. 52%');
    expect(car63).toContain('aria-label="63: 2,250.00 ج.م. (52%)');
    expect(car63).toContain('bg-blue-100');
    expect(car63).toContain('dark:bg-blue-950/60');
    expect(car63).toContain('bg-slate-200 shadow-inner');
  });

  it('rings the drivers by rank — emerald, amber, blue, cyan — each a share of the receipts', () => {
    const many = {
      ...dashboard,
      drivers: Array.from({ length: 9 }, (_, i) => ({
        driverEmployeeId: `e-${i}`,
        driverName: `سائق ${i}`,
        maintenance: 0,
        fuel: 100 - i,
        tyres: 0,
        wash: 0,
        total: 100 - i,
        count: 1,
      })),
    };
    const html = draw(<CustodyTopDrivers data={many} />);
    const rings = [...html.matchAll(/data-custody-ring="(\d+)" class="([^"]*)"/gu)];
    // Seven drivers, as the design ranks them.
    expect(rings).toHaveLength(7);
    expect(rings.map((m) => m[2])).toEqual(
      [0, 1, 2, 3, 0, 1, 2].map((i) => CUSTODY_RINGS[i]?.ring),
    );
    expect(CUSTODY_RINGS.map((tone) => tone.ring)).toEqual([
      'text-emerald-600 dark:text-emerald-400',
      'text-amber-500 dark:text-amber-400',
      'text-blue-600 dark:text-blue-400',
      'text-cyan-600 dark:text-cyan-400',
    ]);
    expect(text(html)).toContain('أعلى 7');
    // The ring's arc is the driver's share of the receipts — every kind is a receipt's now, «صيانة»
    // too, so they are everything the fund paid (4,335.50).
    const drivers = draw(<CustodyTopDrivers data={dashboard} />);
    expect(drivers).toMatch(/data-custody-ring="0"[^>]*stroke-dasharray="43\.82, 100"/u);
    const first = drivers.slice(
      drivers.indexOf('data-custody-driver="0"'),
      drivers.indexOf('data-custody-driver="1"'),
    );
    expect(first).toMatch(pct('44%'));
    expect(custodyReceipts(dashboard), 'maintenance + fuel + tyres + washing').toBe(4335.5);
    expect(custodyReceipts(dashboard)).toBe(dashboard.total);
    // The two biggest kinds of his own total, dearest first.
    expect(custodyTopKinds(dashboard.drivers[0]!)).toEqual(['tyres', 'fuel']);
    expect(text(first)).toContain('كاوتش 74% • وقود 26%');
    expect(first).toContain('text-rose-700 dark:text-rose-400');
    // The receipts with no driver, under the rings.
    const none = drivers.slice(drivers.indexOf('data-custody-no-driver="true"'));
    expect(text(none)).toContain('إيصالات بدون سائق محدد (2) 970.00 ج.م.');
  });

  it('says so when no receipt names a driver — never an empty card titled «أعلى 0»', () => {
    const html = draw(
      <CustodyTopDrivers data={{ ...dashboard, drivers: [], noDriver: { count: 0, amount: 0 } }} />,
    );
    expect(html).toContain('data-custody-no-drivers="true"');
    expect(html).not.toContain(ar('fleet.custody.dashboard.topCount', { count: '0' }));
    const unnamed = draw(
      <CustodyTopDrivers
        data={{ ...dashboard, drivers: [], noDriver: { count: 2, amount: 160 } }}
      />,
    );
    expect(unnamed).toContain('data-custody-no-driver="true"');
    expect(unnamed).toContain('160.00');
  });

  it('splits the fuel in two — «وطنية» on its own, «شل أوت» on its own, each with its own types', () => {
    const html = draw(<CustodyFuelBreakdown data={split} />);
    expect(text(html)).toContain('تفصيل استهلاك الوقود');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.fuelNote'));
    // The owner's order: وطنية, then شل أوت — then «بدون شركة», never folded into either.
    expect([...html.matchAll(/data-custody-fuel-company="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'wataniya',
      'chillout',
      'none',
    ]);
    const wataniya = company(html, 'wataniya');
    const head = headOf(wataniya);
    // The company's header: its name, money, litres, receipts and share of the fund's fuel.
    expect(text(head)).toBe('وطنية 50% 1,200.00 ج.م. الكمية: 70.00 لتر 4 حركات');
    expect(head).toMatch(pct('50%'));
    // A labelled group a reader can find by the company's name.
    const group =
      /role="group" aria-labelledby="([^"]+)" data-custody-fuel-company="wataniya"/u.exec(html);
    expect(html).toContain(`<h4 id="${group?.[1] ?? '?'}"`);
    // Under it, diesel first and lifted out, then بنزين 92 — each a share of THIS company.
    expect(types(wataniya)).toEqual(['diesel', 'petrol92']);
    const diesel = fuelRow(wataniya, 'diesel');
    expect(text(diesel)).toBe(
      '⭐ سولار (الأولوية الأولى) 900.00 ج.م. الكمية: 50.00 لتر 3 حركات (75%)',
    );
    expect(classesOf(diesel, 'data-custody-fuel-type="diesel"')).toEqual(
      expect.arrayContaining([
        'border-2',
        'border-amber-400',
        'bg-amber-50/70',
        'ring-2',
        'ring-amber-200/50',
        'dark:border-emerald-500/40',
        'dark:bg-[#0c1322]',
      ]),
    );
    expect(diesel).toContain('width:75%');
    expect(text(fuelRow(wataniya, 'petrol92'))).toBe(
      'بنزين 92 300.00 ج.م. الكمية: 20.00 لتر 1 حركة (25%)',
    );
    // The company is the section: no company chip on its rows.
    expect(html).not.toContain('data-custody-fuel-companies');
    // شل أوت: 92, 95, 80 after the diesel it did not sell — and its receipt with no type last.
    const chillout = company(html, 'chillout');
    expect(text(headOf(chillout))).toBe('شل أوت 33% 800.00 ج.م. الكمية: 40.00 لتر 4 حركات');
    expect(types(chillout)).toEqual(['petrol92', 'petrol95', 'petrol80', 'none']);
    expect(text(fuelRow(chillout, 'petrol92'))).toContain('1 حركة (31%)');
    expect(fuelRow(chillout, 'petrol95')).toContain('bg-amber-600 dark:bg-orange-400');
    expect(text(fuelRow(chillout, 'none'))).toBe('بلا نوع محدد 50.00 ج.م. (1 حركة)');
    // «بدون شركة»: its money, litres, receipts and share — and its own types.
    const none = company(html, 'none');
    expect(text(none)).toBe(
      'بدون شركة 400.00 ج.م. الكمية: 12.00 لتر 2 حركات (17%) سولار 350.00 ج.م. (1 حركة) بلا نوع محدد 50.00 ج.م. (1 حركة)',
    );
    expect([...none.matchAll(/data-custody-fuel-none-type="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'diesel',
      'none',
    ]);
  });

  it('wears each company’s colour — وطنية emerald, شل أوت amber — in the light map and the dark design', () => {
    const html = draw(<CustodyFuelBreakdown data={split} />);
    for (const [name, ink] of [
      ['wataniya', 'emerald'],
      ['chillout', 'amber'],
    ] as const) {
      const box = company(html, name);
      expect(classesOf(box, `data-custody-fuel-company="${name}"`)).toEqual(
        expect.arrayContaining([
          'bg-slate-50',
          'border-slate-200',
          'dark:bg-[#090e18]',
          'dark:border-[#233552]',
        ]),
      );
      expect(classesOf(box, `data-custody-fuel-company-head="${name}"`)).toEqual(
        expect.arrayContaining([
          `border-${ink}-300`,
          'bg-white',
          `dark:border-${ink}-500/30`,
          'dark:bg-[#0e1626]',
        ]),
      );
      expect(box).toContain(COMPANY[name].dot);
      expect(box).toContain(COMPANY[name].heading);
      expect(classesOf(box, `data-custody-fuel-company-share="${name}"`)).toEqual(
        expect.arrayContaining(COMPANY[name].pct.split(' ')),
      );
      expect(box).toContain(`h-full rounded-full ${COMPANY[name].bar}`);
    }
    expect(COMPANY.wataniya.bar).toBe('bg-emerald-600 dark:bg-emerald-400');
    expect(COMPANY.chillout.bar).toBe('bg-amber-500 dark:bg-amber-400');
    expect(company(html, 'wataniya')).toContain('width:50%');
  });

  it('keeps both companies in view — one that sold nothing shows its zeros; «بدون شركة» only with money', () => {
    // The board's fixture: Wataniya sold the diesel, Chill Out nothing.
    const html = draw(<CustodyFuelBreakdown data={dashboard} />);
    const chillout = company(html, 'chillout');
    expect(text(chillout)).toBe(
      `شل أوت 0% 0.00 ج.م. الكمية: — 0 حركات ${ar('fleet.custody.dashboard.fuelCompanyEmpty')}`,
    );
    expect(chillout).toContain('data-custody-fuel-company-empty="chillout"');
    expect(types(company(html, 'wataniya'))).toEqual(['diesel']);
    // «بدون شركة» holds the 80 and the receipt with no type: shown, never put on a company.
    expect(text(company(html, 'none'))).toContain('بدون شركة 1,465.50 ج.م.');
    // No money without a company: no box for it.
    const named = draw(
      <CustodyFuelBreakdown
        data={{
          ...dashboard,
          fuelByCompany: {
            ...dashboard.fuelByCompany,
            none: { amount: 0, count: 0, litres: 0, types: [] },
          },
        }}
      />,
    );
    expect(named).not.toContain('data-custody-fuel-company="none"');
    // No fuel at all: both companies still there, at zero, and one line saying so.
    const dry = draw(
      <CustodyFuelBreakdown
        data={{
          ...dashboard,
          fuel: 0,
          fuelTypes: [],
          fuelByCompany: {
            companies: [],
            none: { amount: 0, count: 0, litres: 0, types: [] },
          },
        }}
      />,
    );
    expect([...dry.matchAll(/data-custody-fuel-company="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'wataniya',
      'chillout',
    ]);
    expect(dry).not.toContain('data-custody-fuel-company-empty');
    expect(dry).toContain('data-custody-no-fuel="true"');
    expect(text(company(dry, 'wataniya'))).toBe('وطنية — 0.00 ج.م. الكمية: — 0 حركات');
    expect(dry).not.toMatch(/NaN|Infinity/u);
  });

  it('«شيلهم» — the station panel is gone, and so are the station words', () => {
    const html = body();
    expect(html).not.toContain('توزيع محطات التزويد');
    expect(html).not.toContain('محطات');
    expect(html).not.toContain('والمحطات');
    for (const key of ['byKind', 'fuelTitle', 'fuelNote', 'donut.outer']) {
      expect(ar(`fleet.custody.dashboard.${key}`), key).not.toContain('محطات');
    }
    expect(draw(<CustodyFuelBreakdown data={{ ...dashboard, fuelTypes: [] }} />)).toContain(
      'data-custody-no-fuel="true"',
    );
  });
});

describe('«عاوز الداش بورد بكل حاجة تكون ظاهره حتى لو لسه مفيش اى اكشن او حركه او خصم او زياده فاهم يعنى على الاقل الاشكال موجودة» — every section with no movement', () => {
  /** The months a frame draws, oldest first. */
  const months = (filters: CustodyDashboardFilters = {}): string[] =>
    custodyTimelineFrame(nothing.timeline, filters, NOW).buckets.map((bucket) => bucket.key);
  /** One of the time chart's columns, up to the next (cut before the next one's tag). */
  const column = (html: string, i: number): string => {
    const at = html.indexOf(`data-custody-column="${i}"`);
    expect(at, `column ${i}`).toBeGreaterThan(-1);
    const next = html.indexOf('data-custody-column=', at + 10);
    const end = next === -1 ? html.indexOf('data-custody-legend') : next;
    return html.slice(at, html.lastIndexOf('<', end));
  };
  /** A figure's card, up to the next one. */
  const card = (html: string, kind: string): string => {
    const at = html.indexOf(`data-custody-kpi="${kind}"`);
    expect(at, kind).toBeGreaterThan(-1);
    const next = html.indexOf('data-custody-kpi="', at + 10);
    return html.slice(at, next === -1 ? html.indexOf('data-custody-tile') : next);
  };
  const lines = (html: string): string[] =>
    [...html.matchAll(/data-custody-no-movements="(\w+)"/gu)].map((m) => m[1] ?? '');

  it('draws every section in the design’s order — never the old card «لم يُخصم شيء من العهدة بعد»', () => {
    const html = body(nothing);
    const ids = [...html.matchAll(/data-custody-dashboard-section="(\w+)"/gu)].map((m) => m[1]);
    // The banner keeps its own rules: nothing to warn about, no banner.
    expect(ids).toEqual(['kpis', 'timeline', 'byKindSource', 'topCars', 'topDrivers', 'fuel']);
    expect(html).not.toContain(ar('fleet.custody.empty'));
    expect(html).not.toContain(ar('fleet.violations.report.empty'));
    expect(html).not.toMatch(/NaN|Infinity/u);
    // One line inside each card with nothing to draw — the figures need none, they are zeros.
    for (const id of ['timeline', 'byKindSource', 'topCars', 'topDrivers', 'fuel']) {
      expect(lines(section(html, id)), id).toEqual(['all']);
      expect(text(section(html, id)), id).toContain(ar('fleet.custody.dashboard.noMovements'));
    }
    expect(lines(section(html, 'kpis'))).toEqual([]);
    expect(ar('fleet.custody.dashboard.noMovements')).toBe('لا توجد حركات بعد.');
    // Over a filter, nothing MATCHING it — never «لا توجد حركات بعد».
    const filtered = mount(
      client(),
      <CustodyDashboardBody data={nothing} filters={{ vehicleCodes: ['150'] }} now={NOW} />,
    );
    expect(lines(filtered)).toEqual(['filtered', 'filtered', 'filtered', 'filtered', 'filtered']);
    expect(filtered).toContain(ar('fleet.custody.dashboard.noMatch'));
    expect(filtered).not.toContain(ar('fleet.custody.dashboard.noMovements'));
    expect(ar('fleet.custody.dashboard.noMatch')).toBe('لا توجد حركات مطابقة للفلاتر.');
    expect(translate('en', 'fleet.custody.dashboard.noMovements')).toBe('No movements yet.');
    expect(translate('en', 'fleet.custody.dashboard.noMatch')).toBe(
      'No movements match the filters.',
    );
  });

  it('writes the six figures and the three tiles at zero — the fund «0%» spent, a share of nothing «—»', () => {
    const html = draw(<CustodyKpis data={nothing} />);
    expect([...html.matchAll(/data-custody-kpi="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'fund',
      'total',
      'maintenance',
      'fuel',
      'tyres',
      'wash',
    ]);
    // The fund is the fund: with money in it, it is written whole, and nothing of it spent yet is
    // «0%».
    const fund = card(html, 'fund');
    expect(fund).toContain('50,000.00');
    expect(fund).toMatch(/data-custody-fund-pct="true"[^>]*>0%</u);
    // Nothing charged into it yet («شحن العهدة»): «0.00 ج.م.», never «—» — and its share «—».
    const empty = card(draw(<CustodyKpis data={{ ...nothing, fundTotal: 0 }} />), 'fund');
    expect(empty).toMatch(/data-custody-fund-value="true"[^>]*>0\.00</u);
    expect(empty).toMatch(/data-custody-fund-pct="true"[^>]*>—</u);
    // The total and each kind: «0.00», their share of nothing «—», their count «0 حركات».
    expect(card(html, 'total')).toContain('0.00');
    expect(card(html, 'total')).toMatch(pct('—'));
    expect(card(html, 'total')).not.toContain('data-custody-period-days');
    for (const kind of CUSTODY_KINDS) {
      const part = card(html, kind);
      expect(part, kind).toContain('0.00');
      expect(part, kind).toMatch(pct('—'));
      const chip = part.slice(part.indexOf(`data-custody-kpi-count="${kind}"`));
      expect(text(chip.slice(chip.indexOf('>') + 1, chip.indexOf('</span>'))), kind).toContain(
        '0 حركات',
      );
    }
    // Fuel's two companies, both at zero.
    expect(
      [...card(html, 'fuel').matchAll(/data-custody-company="(\w+)"/gu)].map((m) => m[1]),
    ).toEqual(['chillout', 'wataniya']);
    expect(card(html, 'fuel')).not.toContain('data-custody-company="none"');
    // The tiles: zero movements, zero cars, zero litres — and no chip over nothing.
    const tiles = text(html.slice(html.indexOf('data-custody-tile="movements"')));
    expect(tiles).toContain('0 حركات');
    expect(tiles).toContain('0 سيارات');
    expect(tiles).toContain('0.00 لتر');
    for (const chip of [
      'data-custody-rate',
      'data-custody-per-car',
      'data-custody-litres-missing',
    ]) {
      expect(html, chip).not.toContain(chip);
    }
    expect(html).not.toMatch(/NaN|Infinity/u);
  });

  it('frames the time chart — the last six months by the month, four stubs a month, the axis’s hairlines and its «0»', () => {
    const html = draw(<CustodyTimeline data={nothing} now={NOW} />);
    // 12 October 2026: May to October, by the month — the server's own granularity with no dates.
    expect([...html.matchAll(/data-custody-column="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(html).toContain('data-custody-granularity="month"');
    expect(html).toContain(ar('fleet.custody.dashboard.byMonth'));
    expect(text(column(html, 0))).toBe('05 2026');
    // The last, «10» — then, after the plot, the line over it.
    expect(text(column(html, 5))).toBe(`10 ${ar('fleet.custody.dashboard.noMovements')}`);
    for (let i = 0; i < 6; i += 1) {
      const part = column(html, i);
      expect([...part.matchAll(/data-custody-stub="(\w+)"/gu)].map((m) => m[1])).toEqual([
        ...CUSTODY_KINDS,
      ]);
      expect(part).not.toContain('data-custody-mark');
    }
    // No figure over a column of nothing, no dearest period.
    expect(html).not.toContain('data-custody-current');
    expect(html).not.toContain('data-custody-peak');
    // The axis: «0» alone — no value made up — over four hairlines.
    expect(html.match(/data-custody-blank-grid="true"/gu)).toHaveLength(4);
    const axis = html.slice(
      html.indexOf('bottom-9 top-6'),
      html.lastIndexOf('<', html.indexOf('data-custody-column="0"')),
    );
    expect(text(axis)).toBe('0');
    // The readout: the latest month, its nothing, its no movement.
    const readout = text(html.slice(html.indexOf('data-custody-readout="true"')));
    expect(readout.startsWith('2026/10')).toBe(true);
    expect(readout).toContain('0.00 ج.م.');
    expect(readout).toContain('| 0 حركات');
    // The line over the plot, on its own pill in both themes.
    expect(lines(html)).toEqual(['all']);
    expect(classesOf(html, 'data-custody-no-movements="all"')).toEqual(
      expect.arrayContaining([
        'bg-white/90',
        'border-slate-200',
        'text-slate-500',
        'dark:bg-[#0c1322]/90',
        'dark:border-slate-800',
        'dark:text-slate-400',
      ]),
    );
    // Six months fit a 375px phone's card (≈303px inside) without its scroller.
    expect(custodyPlotMinWidth(6, false)).toBe(276);
    expect(html).toContain('min-width:276px');
    // «جدول»: the six months, «—» for every sum, 0 movements.
    const table = draw(<CustodyTimeline data={nothing} now={NOW} initialTable />);
    expect([...table.matchAll(/data-custody-period-row="([\d-]+)"/gu)].map((m) => m[1])).toEqual(
      months(),
    );
    const may = table.slice(table.indexOf('data-custody-period-row="2026-05"'));
    expect(text(may.slice(0, may.indexOf('</tr>')))).toBe('2026/05 — — — — — 0');
    expect(html + table).not.toMatch(/NaN|Infinity/u);
  });

  it('frames the months the filter names — and six months by the month when it names none', () => {
    // No date: the last six months to this one.
    expect(months()).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(custodyTimelineFrame(nothing.timeline, {}, NOW).granularity).toBe('month');
    expect(
      custodyTimelineFrame(nothing.timeline, {}, NOW).buckets.every(
        (bucket) =>
          bucket.total === 0 &&
          bucket.count === 0 &&
          CUSTODY_KINDS.every((kind) => bucket[kind] === 0),
      ),
    ).toBe(true);
    // «من» alone: from its month to this one.
    expect(months({ from: '2026-07-15' })).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    // «إلى» alone: the six months up to it, over the turn of a year.
    expect(months({ to: '2026-02-10' })).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    // Both, more than a month apart (the server frames a month or less day by day itself).
    expect(months({ from: '2025-11-01', to: '2026-02-28' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    // Turned round, the same months in time's order.
    expect(months({ from: '2026-06-01', to: '2026-04-01' })).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
    // «من» after today: its month alone.
    expect(months({ from: '2027-01-01' })).toEqual(['2027-01']);
    // A slip of the year never draws a thousand columns — the latest 120 months at most.
    const long = months({ from: '1990-01-01' });
    expect(long).toHaveLength(120);
    expect(long[0]).toBe('2016-11');
    expect(long[119]).toBe('2026-10');
    // What is not a date is no date.
    expect(months({ from: 'later', to: '' })).toEqual(months());
    // With movements, the server's own stretch, untouched — days and all.
    expect(custodyTimelineFrame(dashboard.timeline, {}, NOW)).toBe(dashboard.timeline);
    const days = {
      granularity: 'day' as const,
      buckets: [{ ...dashboard.timeline.buckets[1]!, key: '2026-10-01' }],
    };
    expect(custodyTimelineFrame(days, { from: '2026-10-01', to: '2026-10-07' }, NOW)).toBe(days);
    // Over a filter with its own months, the chart draws them.
    const filtered = draw(
      <CustodyTimeline
        data={nothing}
        filters={{ from: '2025-11-01', to: '2026-02-28' }}
        now={NOW}
        initialTable
      />,
    );
    expect([...filtered.matchAll(/data-custody-period-row="([\d-]+)"/gu)].map((m) => m[1])).toEqual(
      ['2025-11', '2025-12', '2026-01', '2026-02'],
    );
  });

  it('rings nothing in grey round a «0» — the legend and the table at zero', () => {
    const html = draw(<CustodyByKindSource data={nothing} onShowMaintenance={() => undefined} />);
    // The ring's track, no arc — and no inner track: there is no ring of the source.
    expect(html).not.toContain('data-custody-arc');
    expect(html).toContain('stroke-[#e2e8f0] dark:stroke-[#162032]');
    expect(html).not.toContain('stroke-[#f1f5f9] dark:stroke-[#131b29]');
    const centre = html.slice(
      html.indexOf('pointer-events-none absolute inset-0'),
      html.lastIndexOf('<', html.indexOf('data-custody-donut-legend')),
    );
    expect(text(centre)).toBe(`${ar('fleet.custody.dashboard.donut.centre')} 0 —`);
    // The legend: each kind «— (0 ج.م.)».
    for (const kind of CUSTODY_KINDS) {
      const at = html.indexOf(`data-custody-legend-kind="${kind}"`);
      expect(at, kind).toBeGreaterThan(-1);
      const row = html.slice(at, html.indexOf('data-custody-legend-kind=', at + 10));
      expect(text(row), kind).toContain('— (0 ج.م.)');
    }
    expect(html).not.toContain('data-custody-source-row');
    // The kinds' table: four rows of «0.00 ج.م.», «—», 0.
    const rows = [...html.matchAll(/data-custody-kind-row="(\w+)"/gu)].map((m) => m[1]);
    expect(rows).toEqual([...CUSTODY_KINDS]);
    const tyres = html.slice(html.indexOf('data-custody-kind-row="tyres"'));
    expect(text(tyres.slice(0, tyres.indexOf('</tr>')))).toBe('كاوتش 0.00 ج.م. — 0');
    expect(html).not.toContain('data-custody-kind-row-companies');
    // The footer: the line in place of the suppliers, «عرض حركات الصيانة» still there.
    expect(html).not.toContain('data-custody-suppliers');
    expect(lines(html)).toEqual(['all']);
    expect(html).toContain('data-custody-show-maintenance="true"');
    expect(html).not.toMatch(/NaN|Infinity/u);
  });

  it('keeps the cars’, the drivers’ and the fuel’s cards — their frames, one line in each', () => {
    const cars = draw(<CustodyTopCars data={nothing} />);
    expect(text(cars)).toContain(ar('fleet.custody.dashboard.topCars'));
    // The legend stays; no ranking, and never «أعلى 0 سيارات» nor a «0 سيارات» chip.
    expect([...cars.matchAll(/data-custody-swatch="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...CUSTODY_KINDS,
    ]);
    expect(cars).not.toContain('data-custody-top-cars');
    expect(cars).not.toContain('0 سيارات');
    expect(lines(cars)).toEqual(['all']);
    const drivers = draw(<CustodyTopDrivers data={nothing} />);
    expect(text(drivers)).toContain(ar('fleet.custody.dashboard.topDrivers'));
    expect(text(drivers)).toContain(ar('fleet.custody.dashboard.topDriversNote'));
    // No movement is not «no receipt names a driver».
    expect(drivers).not.toContain('data-custody-no-drivers');
    expect(drivers).not.toContain(ar('fleet.custody.dashboard.topCount', { count: '0' }));
    expect(lines(drivers)).toEqual(['all']);
    // The fuel: both companies, at zero, then the line — not «لا وقود من العهدة هنا».
    const fuel = draw(<CustodyFuelBreakdown data={nothing} />);
    expect([...fuel.matchAll(/data-custody-fuel-company="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'wataniya',
      'chillout',
    ]);
    expect(text(company(fuel, 'wataniya'))).toBe('وطنية — 0.00 ج.م. الكمية: — 0 حركات');
    expect(text(company(fuel, 'chillout')).startsWith('شل أوت — 0.00 ج.م. الكمية: — 0 حركات')).toBe(
      true,
    );
    expect(fuel).not.toContain('data-custody-no-fuel');
    expect(fuel).not.toContain('data-custody-fuel-company-empty');
    expect(lines(fuel)).toEqual(['all']);
    // A filter that matches nothing says so in each.
    for (const node of [
      <CustodyTopCars key="cars" data={nothing} filters={{ driver: 'محمد' }} />,
      <CustodyTopDrivers key="drivers" data={nothing} filters={{ driver: 'محمد' }} />,
      <CustodyFuelBreakdown key="fuel" data={nothing} filters={{ driver: 'محمد' }} />,
    ]) {
      expect(lines(draw(node))).toEqual(['filtered']);
    }
    expect(cars + drivers + fuel).not.toMatch(/NaN|Infinity/u);
  });
});

describe('«عاوزك تشيل من الداش بورد الجدول اللى فى العربيات والسجل يكون برا زى ما هو» — both tables live on the board', () => {
  it('draws neither «ملخص لكل سيارة» nor «سجل كل الحركات» in the dashboard — nor any «السجل»', () => {
    const html = body({ ...dashboard, alerts: alerting });
    for (const gone of [
      'data-custody-dashboard-section="perVehicle"',
      'data-custody-dashboard-section="log"',
      'data-custody-car-row=',
      'data-custody-car-search',
      'data-custody-car-kinds',
      'data-custody-dashboard-grand-total',
      'data-custody-log-row=',
      'data-custody-advanced-filter',
      'data-custody-car-log-open=',
      'data-custody-car-log=',
    ]) {
      expect(html, gone).not.toContain(gone);
    }
    expect(text(html)).not.toContain(ar('fleet.custody.perVehicle'));
    expect(text(html)).not.toContain('سجل كل الحركات');
    // «أعلى السيارات صرفًا» ranks the cars and opens nothing: the log is the board's.
    expect(draw(<CustodyTopCars data={dashboard} />)).not.toContain('data-custody-car-log-open');
    expect(CHARTS).not.toContain('CustodyCarLogButton');
    expect(CHARTS).not.toContain('onOpenLog');
    // Nothing of the two tables is left behind: no movements of the dashboard's own, no car log
    // drawn over it, no layer for one, no file for the tables.
    for (const gone of ['useCustodyLog', 'CustodyCarLog', 'CustodyPerCar', 'CustodyLog']) {
      expect(MODAL, gone).not.toContain(gone);
    }
    expect(DASHBOARD).not.toContain('CustodyDashboardLayer');
    expect(existsSync(join(HERE, '../components/CustodyDashboardTables.tsx'))).toBe(false);
    // …and no word of theirs is left in the dictionary.
    for (const key of [
      'fleet.custody.dashboard.perCar.search',
      'fleet.custody.dashboard.perCar.kindsButton',
      'fleet.custody.dashboard.grandTotal',
      'fleet.custody.dashboard.log.title',
      'fleet.custody.dashboard.log.advanced',
      'fleet.custody.dashboard.columns.kindSpec',
    ]) {
      expect(translate('ar', key), key).toBe(key);
      expect(translate('en', key), key).toBe(key);
    }
  });

  it('keeps both on the board — «ملخص لكل سيارة» with «السجل» on every car, then «كل الحركات»', () => {
    const html = board();
    const perVehicle = html.indexOf('data-custody-per-vehicle="true"');
    const movements = html.indexOf('data-custody-movements="true"');
    expect(perVehicle).toBeGreaterThan(-1);
    expect(movements).toBeGreaterThan(perVehicle);
    const table = html.slice(perVehicle, movements);
    expect(
      [...table.matchAll(/data-custody-car-log-open="(\d+)"/gu)].map((m) => m[1]).sort(),
    ).toEqual(['160', '204', '63']);
    expect(html.slice(movements)).toContain('data-custody-kind="fuel"');
  });
});

/** The board's per-car table, from its section to the movements. */
const perCar = (html: string): string =>
  html.slice(
    html.indexOf('data-custody-per-vehicle="true"'),
    html.indexOf('data-custody-movements="true"'),
  );
/** The row of a table holding `needle`. */
const rowOf = (html: string, needle: string): string => {
  const at = html.indexOf(needle, html.indexOf('<tbody'));
  expect(at, needle).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};
/** The `<td>`s of a row: each one's class list and its inner markup. */
const cells = (row: string): { cls: string[]; inner: string }[] =>
  [...row.matchAll(/<td [^>]*class="([^"]*)"[^>]*>(.*?)<\/td>/gu)].map((m) => ({
    cls: (m[1] ?? '').split(' '),
    inner: m[2] ?? '',
  }));
/** «—» where a car paid nothing that way. */
const NONE = '<span class="text-slate-400 dark:text-slate-500">—</span>';
/** The lines of the per-car table's body — every car's, then «الإجمالي». */
const carRows = (table: string): string[] =>
  [...table.slice(table.indexOf('<tbody')).matchAll(/<tr\b[\s\S]*?<\/tr>/gu)].map((m) => m[0]);

describe('«وخلى الالوان زى ما انت عامل فى الداش بورد» — the board’s tables in the dashboard’s colours', () => {
  it('writes a car’s sums in plain ink, a dot of the kind’s colour before each — a muted «—» where a car paid nothing that way', () => {
    const table = perCar(board());
    const car63 = rowOf(table, '>63<');
    expect(text(car63)).toBe('63 السجل 850.00 ج.م. — 1,400.00 ج.م. — 2,250.00 ج.م.');
    const [, maintenance, fuel, tyres, wash] = cells(car63);
    // «هادية»: the figure slate-800 / slate-200, «ج.م.» muted, the kind's colour only in its dot.
    for (const [kind, cell, figure] of [
      ['maintenance', maintenance, '850\\.00'],
      ['tyres', tyres, '1,400\\.00'],
    ] as const) {
      expect(cell?.inner, kind).toMatch(
        new RegExp(
          `^<span class="inline-flex items-center gap-1\\.5" data-custody-kind-sum="${kind}"><span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full ${CUSTODY_KIND[kind].dot}"></span><span class="inline-flex items-baseline gap-1 text-slate-800 dark:text-slate-200"><span class="[^"]*">${figure}</span><span class="text-sm text-slate-500 dark:text-slate-400">ج\\.م\\.</span></span></span>$`,
          'u',
        ),
      );
    }
    expect(fuel?.inner).toBe(NONE);
    expect(wash?.inner).toBe(NONE);
    const car204 = rowOf(table, '>204<');
    const [, d204, f204, t204, w204] = cells(car204);
    expect(d204?.inner).toBe(NONE);
    expect(f204?.inner).toContain(CUSTODY_KIND.fuel.dot);
    expect(t204?.inner).toBe(NONE);
    expect(w204?.inner).toContain(CUSTODY_KIND.wash.dot);
    // No sum of any car, nor of the foot, in a kind's ink any more: the dot carries the colour.
    const rows = carRows(table);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      for (const cell of cells(row).slice(1, 5)) {
        expect(cell.inner).not.toMatch(/\btext-(?:blue|amber|rose|cyan)-/u);
      }
    }
    // The four dots — blue, amber, rose, cyan — the kinds' badge dots, one shade per theme.
    expect(CUSTODY_KIND.maintenance.dot).toBe('bg-blue-600 dark:bg-blue-400');
    expect(CUSTODY_KIND.fuel.dot).toBe('bg-amber-500 dark:bg-amber-400');
    expect(CUSTODY_KIND.tyres.dot).toBe('bg-rose-500 dark:bg-rose-400');
    expect(CUSTODY_KIND.wash.dot).toBe('bg-cyan-600 dark:bg-cyan-400');
  });

  it('puts the car’s code in the dashboard’s blue chip, and sets the «الإجمالي» column apart', () => {
    const table = perCar(board());
    expect(classesOf(table, '>63<')).toEqual(
      expect.arrayContaining([
        'border-blue-200',
        'bg-blue-50',
        'text-blue-700',
        'dark:border-blue-500/30',
        'dark:bg-blue-500/10',
        'dark:text-blue-400',
        'font-bold',
        ...ALARMS_CODE_TYPE.split(' '),
      ]),
    );
    expect(table).toMatch(/<span dir="ltr" class="[^"]*border-blue-200[^"]*">63<\/span>/u);
    // The head: the board's own six columns — no share column — each with its arrow.
    const thead = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
    const heads = [...thead.matchAll(/<th [^>]*class="([^"]*)"/gu)].map((m) => m[1] ?? '');
    expect(heads).toHaveLength(6);
    expect((thead.match(/<th\b[^>]*><button type="button"/gu) ?? []).length).toBe(6);
    expect(thead).not.toContain('%');
    // «الإجمالي»: the light map's slate-200 under its heading, the design's #131f35 dark; its
    // cells on slate-50 / #131f35 at half, the car's total slate-900 / white.
    expect(heads[5]?.split(' ')).toEqual(
      expect.arrayContaining(['bg-slate-200/80', 'dark:bg-[#131f35]']),
    );
    const car63 = rowOf(table, '>63<');
    const total = cells(car63)[5];
    expect(total?.cls).toEqual(expect.arrayContaining(['bg-slate-50', 'dark:bg-[#131f35]/50']));
    expect(total?.inner).toContain(
      'class="inline-flex items-baseline gap-1 text-slate-900 dark:text-white"',
    );
    // Its heading's ink and weight reach past the board table's own `!important` ones.
    const wrapper = classesOf(table, 'lg:flex lg:min-h-0 lg:flex-col');
    expect(wrapper).toEqual(
      expect.arrayContaining([
        '[&amp;_thead_th:last-child]:!font-extrabold',
        '[&amp;_thead_th:last-child]:!text-slate-900',
        'dark:[&amp;_thead_th:last-child]:!text-emerald-300',
        '[&amp;_thead_th:last-child_button]:!text-inherit',
      ]),
    );
    // Sticky head and its own scroll, as before.
    expect(table).toContain('<thead class="sticky top-0 z-10">');
    expect(table).toContain('h-full overflow-auto');
  });

  it('draws «الإجمالي» as the dashboard’s foot — the emerald rule and word, each kind’s total beside its dot, the fund’s total boxed', () => {
    const table = perCar(board());
    const at = table.indexOf('data-custody-grand-total="true"');
    expect(at).toBeGreaterThan(-1);
    const grand = table.slice(table.lastIndexOf('<tr', at), table.indexOf('</tr>', at));
    expect(text(grand)).toBe(
      'الإجمالي 850.00 ج.م. 1,965.50 ج.م. 1,400.00 ج.م. 120.00 ج.م. 4,335.50 ج.م.',
    );
    expect(grand).not.toContain('data-custody-car-log-open');
    // The foot's slate-100 / #090e18, the 2px emerald-500 rule over every cell, and the fund's
    // total in its emerald box — the light map's emerald-200 sides, the design's faint line dark.
    expect(classesOf(grand, 'data-custody-grand-total="true"')).toEqual(
      expect.arrayContaining([
        'bg-slate-100',
        'dark:bg-[#090e18]',
        '[&amp;&gt;td]:shadow-[inset_0_2px_0_#10b981]',
        '[&amp;&gt;td:last-child]:bg-emerald-50',
        'dark:[&amp;&gt;td:last-child]:bg-[#122238]',
        '[&amp;&gt;td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_1px_0_0_#a7f3d0,inset_-1px_0_0_#a7f3d0]',
        'dark:[&amp;&gt;td:last-child]:shadow-[inset_0_2px_0_#10b981,inset_0_3px_0_rgba(16,185,129,0.3)]',
        '[&amp;&gt;td_span]:!font-black',
      ]),
    );
    const [word, ...sums] = cells(grand);
    expect(word?.inner).toBe(
      `<span class="text-emerald-800 dark:text-emerald-400">${ar('fleet.custody.grandTotal')}</span>`,
    );
    // Each kind's total in the foot's slate-900 / white, its dot before it; the fund's in emerald.
    CUSTODY_KINDS.forEach((kind, i) => {
      expect(sums[i]?.inner, kind).toContain(
        `<span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full ${CUSTODY_KIND[kind].dot}"></span>`,
      );
      expect(sums[i]?.inner, kind).toContain('gap-1 text-slate-900 dark:text-white"');
      expect(sums[i]?.inner, kind).not.toContain(CUSTODY_KIND[kind].text);
    });
    expect(sums[4]?.inner).toContain('gap-1 text-emerald-800 dark:text-emerald-300"');
    // It stays the last line whichever way the arrows point.
    const cheapFirst = perCar(board([movement({})], '?carSort=total:asc'));
    expect(cheapFirst.indexOf('data-custody-grand-total="true"')).toBeGreaterThan(
      cheapFirst.indexOf('>63<'),
    );
  });

  it('keeps «السجل» its own size — the board table squeezes a cell’s buttons into icons', () => {
    const table = perCar(board());
    expect(classesOf(table, 'lg:flex lg:min-h-0 lg:flex-col')).toEqual(
      expect.arrayContaining([
        '[&amp;_td_button[data-custody-car-log-open]]:!h-auto',
        '[&amp;_td_button[data-custody-car-log-open]]:!w-auto',
      ]),
    );
    // The board table's squeeze it answers.
    expect(read('VehiclesListPage.tsx')).toContain('[&_td_button]:!h-7 [&_td_button]:!w-7');
  });

  it('badges each kind of «كل الحركات» as the dashboard’s log did — and names a fuel receipt’s company', () => {
    const html = board(logRows);
    const movements = html.slice(html.indexOf('data-custody-movements="true"'));
    const row = (amount: string): string => rowOf(movements, `>${amount}<`);
    // The kind's soft pill with its dot, its fuel type or work beside it, as before.
    for (const [amount, kind] of [
      ['150.00', 'fuel'],
      ['750.00', 'tyres'],
      ['1,470.00', 'maintenance'],
    ] as const) {
      const badge = classesOf(row(amount), `data-custody-kind="${kind}"`);
      expect(badge, kind).toEqual(expect.arrayContaining(CUSTODY_KIND[kind].badge.split(' ')));
      expect(row(amount), kind).toContain(CUSTODY_KIND[kind].dot);
    }
    // «وطنية» emerald, «شل أوت» amber — the dashboard log's company badges.
    const chill = row('150.00');
    expect(text(chill)).toContain('وقود بنزين 92 شل أوت (ChillOut)');
    expect(classesOf(chill, 'data-custody-company-badge="chillout"')).toEqual(
      expect.arrayContaining(COMPANY.chillout.badge.split(' ')),
    );
    const wataniya = row('151.00');
    expect(text(wataniya)).toContain('وقود سولار وطنية (Wataniya)');
    expect(classesOf(wataniya, 'data-custody-company-badge="wataniya"')).toEqual(
      expect.arrayContaining(COMPANY.wataniya.badge.split(' ')),
    );
    // A fuel receipt that names no company: none drawn. Nor on any kind but fuel.
    expect(row('152.00')).not.toContain('data-custody-company-badge');
    expect(row('750.00')).not.toContain('data-custody-company-badge');
    // «هادية»: «من» in the row's plain ink — «صيانة» a receipt like the fuel, the kind's pill says
    // which. No dealership bill is among them any more.
    expect(movements).not.toContain('data-custody-from="dealershipInvoice"');
    for (const [amount, ref] of [
      ['1,470.00', 'receipt'],
      ['150.00', 'receipt'],
    ] as const) {
      expect(classesOf(row(amount), `data-custody-from="${ref}"`), ref).toEqual([
        'text-slate-600',
        'dark:text-slate-300',
      ]);
    }
  });

  it('writes «كل الحركات» in the dashboard log’s inks — the date muted, the code in its chip, the amount slate-900 / white', () => {
    const html = board([...logRows, movement({ id: 'n1', vehicleCode: null, amount: 153 })]);
    const movements = html.slice(html.indexOf('data-custody-movements="true"'));
    const [date, code, , , , amount] = cells(rowOf(movements, '>150.00<'));
    // Each on a span of its own: the board's table sets the cell's ink with `!important`.
    expect(text(date?.inner ?? '')).toBe('2026/10/05');
    expect(classesOf(date?.inner ?? '', 'data-custody-movement-date="true"')).toEqual(
      expect.arrayContaining(['text-slate-500', 'dark:text-slate-400']),
    );
    // The light map's slate chip, white and bare on the dark design — at the board's code size.
    expect(text(code?.inner ?? '')).toBe('150');
    expect(classesOf(code?.inner ?? '', 'data-custody-movement-code="true"')).toEqual(
      expect.arrayContaining([
        'rounded',
        'border',
        'border-slate-200',
        'bg-slate-100',
        'text-slate-900',
        'dark:border-transparent',
        'dark:bg-transparent',
        'dark:px-0',
        'dark:text-white',
        'font-bold',
        ...ALARMS_CODE_TYPE.split(' '),
      ]),
    );
    // The whole sum, figure and «ج.م.», slate-900 / white — no grey currency.
    expect(amount?.inner).toMatch(
      /^<span class="inline-flex items-baseline gap-1 text-slate-900 dark:text-white"><span class="[^"]*">150\.00<\/span><span class="text-sm text-slate-900 dark:text-white">ج\.م\.<\/span><\/span>$/u,
    );
    // A line that names no car: the board's grey dash, no chip.
    const [, none] = cells(rowOf(movements, '>153.00<'));
    expect(none?.inner).toBe('<span class="text-slate-400">—</span>');
  });

  it('heads both tables in the dashboard’s darker ink — over the board table’s own `!important` one', () => {
    const html = board();
    // «ملخص لكل سيارة»: the dashboard's slate-700 light, the design's slate-300 dark.
    expect(classesOf(perCar(html), 'lg:flex lg:min-h-0 lg:flex-col')).toEqual(
      expect.arrayContaining([
        '[&amp;_thead_tr_th]:!text-slate-700',
        'dark:[&amp;_thead_tr_th]:!text-slate-300',
      ]),
    );
    // «كل الحركات»: slate-700 light; the design's dark head is the board's own slate-400.
    const movements = html.slice(html.indexOf('data-custody-movements="true"'));
    const wrapper = classesOf(movements, '[&amp;_thead_tr_th]:!text-slate-700');
    expect(wrapper).toEqual(expect.arrayContaining(['[&amp;_thead_th]:!text-slate-500']));
    expect(wrapper.filter((c) => c.startsWith('dark:[&amp;_thead_tr_th]'))).toEqual([]);
    // One selector deeper than the board table's, which a same-depth rule would only tie.
    expect(read('VehiclesListPage.tsx')).toContain(
      "'[&_thead_tr]:!bg-slate-100 dark:[&_thead_tr]:!bg-[#0c121e] [&_thead_th]:!text-slate-500 dark:[&_thead_th]:!text-slate-400",
    );
  });

  it('keeps the files as they were — the kind and its type, no company', () => {
    const line = PAGE.slice(PAGE.indexOf('const line = '), PAGE.indexOf('const writeSheet'));
    expect(line).toContain('`${sourceLabel(row)} ${detailOf(row)}`.trim(),');
    expect(line).not.toContain('company');
    expect(PAGE).toContain('moneyColumns: [5],');
  });
});

describe('«انت مش كنت خليت الارقام بتاعت التوكيل و الوقود وكدا بيكون جمبهم نقط الوان غيرتها ليه» — the dots beside the kinds’ numbers', () => {
  /** A dot of `kind`'s colour, as the per-car table draws it before a sum. */
  const dot = (kind: (typeof CUSTODY_KINDS)[number]): string =>
    `<span aria-hidden="true" class="h-2 w-2 shrink-0 rounded-full ${CUSTODY_KIND[kind].dot}"></span>`;

  it('puts a dot of the kind’s colour before every sum that is not zero — every car’s and the foot’s', () => {
    // Remove the dots and this fails: the colour beside the numbers is what the owner asked back.
    const rows = carRows(perCar(board()));
    expect(rows).toHaveLength(4);
    const dotted: string[] = [];
    for (const row of rows) {
      cells(row)
        .slice(1, 5)
        .forEach((cell, i) => {
          const kind = CUSTODY_KINDS[i]!;
          if (cell.inner === NONE) return;
          expect(cell.inner, `${kind} in ${text(row)}`).toMatch(
            new RegExp(
              `^<span class="inline-flex items-center gap-1\\.5" data-custody-kind-sum="${kind}">${dot(kind)}<span class="inline-flex items-baseline gap-1 `,
              'u',
            ),
          );
          dotted.push(kind);
        });
    }
    // 63: صيانة and كاوتش; 160: وقود; 204: وقود and غسيل; «الإجمالي»: all four.
    expect(dotted.sort()).toEqual(
      [
        'maintenance',
        'tyres',
        'fuel',
        'fuel',
        'wash',
        'maintenance',
        'fuel',
        'tyres',
        'wash',
      ].sort(),
    );
    // The dot is the kinds' own — written once, in `CustodyKinds.tsx` — never a copy of it.
    const kindCol = PAGE.slice(
      PAGE.indexOf('const kindCol = '),
      PAGE.indexOf('const vehicleColumns'),
    );
    expect(kindCol).toContain('CUSTODY_KIND[kind].dot');
  });

  it('draws no dot before a zero — the foot’s «0.00 ج.م.» stands alone, a car’s nothing is «—»', () => {
    const noWash = board([movement({})], '', {
      total: dashboard.total - dashboard.wash,
      wash: 0,
      vehicles: dashboard.vehicles.map((car) => ({ ...car, wash: 0, total: car.total - car.wash })),
    });
    const rows = carRows(perCar(noWash));
    const grand = rows.find((row) => row.includes('data-custody-grand-total="true"')) ?? '';
    const wash = cells(grand)[4];
    expect(text(wash?.inner ?? '')).toBe('0.00 ج.م.');
    expect(wash?.inner).toContain('data-custody-kind-sum="wash"');
    expect(wash?.inner).not.toContain('rounded-full');
    for (const row of rows.filter((line) => line !== grand)) {
      expect(cells(row)[4]?.inner).toBe(NONE);
    }
  });

  it('puts the same dot before each kind’s heading — and none on the car’s nor the total’s', () => {
    const table = perCar(board());
    const thead = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
    const heads = [...thead.matchAll(/<th [^>]*class="([^"]*)"[^>]*>(<button type="button")?/gu)];
    expect(heads).toHaveLength(6);
    // The dot rides on the heading's arrow button: it must be the `<th>`'s own child.
    expect(heads.every((m) => m[2] !== undefined)).toBe(true);
    const ring = [
      '[&>button]:before:inline-block',
      '[&>button]:before:h-2',
      '[&>button]:before:w-2',
      '[&>button]:before:shrink-0',
      '[&>button]:before:rounded-full',
      "[&>button]:before:content-['']",
    ].map(esc);
    CUSTODY_KINDS.forEach((kind, i) => {
      const cls = (heads[i + 1]?.[1] ?? '').split(' ');
      expect(
        text(thead.slice(heads[i + 1]?.index ?? 0)).startsWith(ar(`fleet.custody.source.${kind}`)),
        kind,
      ).toBe(true);
      expect(cls, kind).toEqual(expect.arrayContaining(ring));
      // The cells' dot, shade for shade: `bg-blue-600 dark:bg-blue-400` on the button's `::before`.
      const ink = CUSTODY_KIND[kind].dot
        .split(' ')
        .map((c) =>
          c.startsWith('dark:')
            ? `dark:[&>button]:before:${c.slice('dark:'.length)}`
            : `[&>button]:before:${c}`,
        )
        .map(esc);
      expect(cls, kind).toEqual(expect.arrayContaining(ink));
    });
    for (const i of [0, 5]) {
      expect(heads[i]?.[1], `heading ${i}`).not.toContain('before:');
    }
  });
});

describe('«هادية» — the board in the dashboard’s cards, the dashboard itself untouched', () => {
  it('puts each table on the dashboard’s table card, under a strip with its title and count', () => {
    const html = board(logRows);
    const perVehicle = html.slice(
      html.lastIndexOf('<section', html.indexOf('data-custody-per-vehicle="true"')),
      html.indexOf('data-custody-movements="true"'),
    );
    const movements = html.slice(
      html.lastIndexOf('<section', html.indexOf('data-custody-movements="true"')),
    );
    for (const [name, part] of [
      ['perVehicle', perVehicle],
      ['movements', movements],
    ] as const) {
      expect(classesOf(part, '<section'), name).toEqual(
        expect.arrayContaining([...TABLE_CARD.split(' '), 'overflow-hidden', 'flex', 'flex-col']),
      );
      // The strip: the dashboard's slate-50 / #0a101b over a rule, the title in Cairo.
      const strip = part.slice(part.indexOf('<div'));
      expect(classesOf(strip, '<div'), name).toEqual(
        expect.arrayContaining([
          'border-b',
          'border-slate-200',
          'bg-slate-50/80',
          'dark:border-[#1c293f]',
          'dark:bg-[#0a101b]',
        ]),
      );
      // The table inside loses its own frame: the card is the frame.
      expect(part, name).toContain('[&amp;&amp;&gt;div]:!rounded-none');
      expect(part, name).toContain('[&amp;&amp;&gt;div]:!border-0');
    }
    expect(perVehicle).toContain(
      `<h2 class="${esc(TITLE)}">${ar('fleet.custody.perVehicle')}</h2>`,
    );
    expect(movements).toContain(`<h2 class="${esc(TITLE)}">${ar('fleet.custody.movements')}</h2>`);
    // The counts: the cars on the design's emerald chip, the movements on its slate one.
    const cars = perVehicle.slice(perVehicle.indexOf('data-custody-car-count="true"'));
    expect(text(cars.slice(0, cars.indexOf('</span>')))).toBe('3 سيارات');
    expect(classesOf(perVehicle, 'data-custody-car-count="true"')).toEqual(
      expect.arrayContaining([
        'rounded-full',
        'bg-emerald-100',
        'text-emerald-800',
        'dark:bg-emerald-500/10',
      ]),
    );
    const moves = movements.slice(movements.indexOf('data-custody-movement-count="true"'));
    expect(text(moves.slice(0, moves.indexOf('</span>')))).toBe('6 حركات');
    expect(classesOf(movements, 'data-custody-movement-count="true"')).toEqual(
      expect.arrayContaining(['bg-slate-200/80', 'text-slate-700', 'dark:bg-[#142135]']),
    );
    // Nothing to count, no chip — and no pager.
    const empty = board([], '', {
      count: 0,
      total: 0,
      maintenance: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      vehicles: [],
    });
    for (const gone of [
      'data-custody-car-count',
      'data-custody-movement-count',
      'data-fleet-pager',
    ]) {
      expect(empty, gone).not.toContain(gone);
    }
  });

  it('puts the pager in the movements card’s foot — under the rows, on the strip’s colours, its current page purple', () => {
    const html = board(logRows);
    const movements = html.slice(html.indexOf('data-custody-movements="true"'));
    const pager = movements.indexOf('data-fleet-pager="true"');
    expect(pager, 'inside the movements’ card').toBeGreaterThan(-1);
    expect(pager, 'under the rows').toBeGreaterThan(movements.indexOf('</table>'));
    const foot = movements.slice(
      movements.lastIndexOf('<div', movements.lastIndexOf('<div', pager) - 1),
    );
    expect(classesOf(foot, '<div')).toEqual(
      expect.arrayContaining([
        'border-t',
        'border-slate-200',
        'bg-slate-50/80',
        'dark:border-slate-800',
        'dark:bg-[#0a101b]',
      ]),
    );
    // «لا بنفسجى»: the current page in the site's purple, as on every other board.
    expect(classesOf(movements, 'aria-current="page"')).toEqual(
      expect.arrayContaining(['bg-brand-600', 'text-white']),
    );
    // …and the per-car card has none: its rows are every car.
    expect(perCar(html)).not.toContain('data-fleet-pager');
  });

  it('keeps «الإحصائيات» and «لوحة تحكم» the site’s purple — and no comment says otherwise', () => {
    // «لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات».
    const html = board();
    for (const attr of ['data-custody-stats-toggle="true"', 'data-custody-dashboard-open="true"']) {
      const cls = classesOf(html, attr);
      expect(cls, attr).toEqual(
        expect.arrayContaining([
          'border-brand-500/50',
          'bg-brand-500/15',
          'text-brand-700',
          'hover:bg-brand-500/25',
          'dark:text-brand-200',
        ]),
      );
      expect(cls.join(' '), attr).not.toMatch(/emerald|blue-|amber-|rose-|cyan-/u);
    }
    // No sentence of a comment on the board, its figures, its kinds' colours or the pager puts the
    // toolbar — or what is pressed — in emerald, or says the screen's design overrides its purple.
    const comments = (source: string): string[] =>
      [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu)]
        .map((m) => m[0].replace(/^\/\/|^\/\*+|\*+\/$|\n\s*(?:\/\/|\*)?/gu, ' '))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .split(/(?<=[.;])\s/u);
    for (const [name, source] of [
      ['CustodyPage.tsx', PAGE],
      ['CustodyFigures.tsx', FIGURES],
      ['CustodyKinds.tsx', KINDS],
      ['FleetPager.tsx', PAGER],
    ] as const) {
      for (const sentence of comments(source)) {
        if (/toolbar|two buttons|PRESS_BUTTON|pressed/iu.test(sentence)) {
          expect(sentence, name).not.toMatch(/emerald|overrid/iu);
        }
      }
    }
    // The kinds say the toolbar and the pager's current page stay purple («لا بنفسجى»); the pager
    // says the custody screen's current page is purple.
    const kinds = comments(KINDS).join(' ');
    expect(kinds).toMatch(/toolbar[^.;]*purple/iu);
    expect(kinds).toMatch(/current page[^.;]*purple/iu);
    expect(kinds).not.toMatch(/current page[^.;]*emerald|emerald[^.;]*current page/iu);
    expect(comments(PAGER).join(' ')).toMatch(/custody[^.;]*purple|purple[^.;]*custody/iu);
  });

  it('paints every light surface of the board’s figures and strips with its dark one too', () => {
    // A light-only background would leave a white box on the dark theme.
    const html = board(logRows);
    const parts = [
      draw(<CustodyFigures totals={dashboard} />),
      ...['data-custody-per-vehicle="true"', 'data-custody-movements="true"'].map((attr) => {
        const at = html.indexOf(attr);
        // The card, its strip and chip — up to the table — and the foot under the rows.
        const section = html.slice(at, html.indexOf('</section>', at));
        return (
          section.slice(0, section.indexOf('<table')) + section.slice(section.indexOf('</table>'))
        );
      }),
    ];
    const lightSurfaces =
      /^(?:bg-white|bg-slate-50|bg-slate-100|bg-slate-50\/80|bg-slate-200\/80|bg-emerald-100)$/u;
    let checked = 0;
    for (const part of parts) {
      for (const m of part.matchAll(/class="([^"]*)"/gu)) {
        const cls = (m[1] ?? '').split(' ');
        if (!cls.some((c) => lightSurfaces.test(c))) continue;
        checked += 1;
        expect(
          cls.some((c) => c.startsWith('dark:bg-')),
          cls.join(' '),
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('«السجل» — every car’s own log, over the board', () => {
  // «عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته ك سجل للعربيه»
  const ON: CustodyDashboardFilters = {
    from: '2026-10-01',
    source: ['maintenance', 'fuel', 'tyres'],
  };
  const car63 = dashboard.vehicles.find((car) => car.vehicleCode === '63')!;
  const car204 = dashboard.vehicles.find((car) => car.vehicleCode === '204')!;
  const on = (id: string, code: string) => (over: Partial<FleetCustodyMovementDto>) =>
    movement({ vehicleId: id, vehicleCode: code, ...over });
  // Car 63's line: its «صيانة» receipt (no driver named) and its tyres — 850 + 1,400.
  const rows63 = [
    on(
      'v-63',
      '63',
    )({
      id: 'c63t',
      source: 'tyres',
      fuelType: null,
      company: null,
      amount: 1400,
      date: '2026-10-06T08:00:00.000Z',
    }),
    on(
      'v-63',
      '63',
    )({
      id: 'c63m',
      source: 'maintenance',
      driverEmployeeId: null,
      driverName: null,
      fuelType: null,
      company: null,
      amount: 850,
      date: '2026-10-01T00:00:00.000Z',
    }),
  ];
  // Car 204's line: diesel at Wataniya, a 92 that names no company, a wash — 1,770.50.
  const rows204 = [
    on('v-204', '204')({ id: 'c204f', fuelType: 'diesel', company: 'wataniya', amount: 500 }),
    on('v-204', '204')({ id: 'c204n', fuelType: 'petrol92', company: null, amount: 1150.5 }),
    on(
      'v-204',
      '204',
    )({
      id: 'c204w',
      source: 'wash',
      fuelType: null,
      company: null,
      amount: 120,
      date: '2026-10-02T08:00:00.000Z',
    }),
  ];
  const carKey = (
    filters: CustodyDashboardFilters,
    car: { vehicleId: string } | { bookCode: string },
    page = 1,
    pageSize = 25,
  ) => listKey('fleet', 'custody', { log: true, ...filters, ...car, page, pageSize });
  const pageOf = (
    items: FleetCustodyMovementDto[],
    page = 1,
    pageSize = 25,
    totalItems = items.length,
  ): Paginated<FleetCustodyMovementDto> => ({
    items,
    meta: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  });
  const opened = (filters: CustodyDashboardFilters = ON): string => {
    const qc = client();
    qc.setQueryData(carKey(filters, { vehicleId: 'v-63' }), pageOf(rows63));
    return mount(
      qc,
      <CustodyCarLog
        car={car63}
        spendTotal={dashboard.total}
        filters={filters}
        opener={null}
        onClose={() => undefined}
      />,
    );
  };
  const carLog = (
    car = car204,
    items = rows204,
    {
      page = 1,
      pageSize = 25,
      totalItems = items.length,
      filters = {} as CustodyDashboardFilters,
    } = {},
  ): string => {
    const qc = client();
    const ref = custodyCarOf(car);
    if (ref !== null)
      qc.setQueryData(
        carKey(filters, ref, page, pageSize),
        pageOf(items, page, pageSize, totalItems),
      );
    return mount(
      qc,
      <CustodyCarLogBody
        car={car}
        spendTotal={dashboard.total}
        filters={filters}
        initialPage={page}
        initialPageSize={pageSize}
      />,
    );
  };
  const button = (html: string, code: string): string => {
    const at = html.indexOf(`data-custody-car-log-open="${code}"`);
    expect(at, code).toBeGreaterThan(-1);
    const from = html.lastIndexOf('<button', at);
    return html.slice(from, html.indexOf('</button>', at) + '</button>'.length);
  };
  const logRow = (html: string, id: string): string => {
    const at = html.indexOf(`data-custody-car-log-row="${id}"`);
    expect(at, id).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
  };

  it('puts «السجل» on every car of the board’s «ملخص لكل سيارة» — named for its car, the word on it', () => {
    const html = board();
    const table = html.slice(
      html.indexOf('data-custody-per-vehicle="true"'),
      html.indexOf('data-custody-movements="true"'),
    );
    const b63 = button(table, '63');
    expect(ar('fleet.custody.dashboard.carLog.open', { code: '63' })).toBe('السجل — السيارة 63');
    // Its name starts with the word it shows, and names the car.
    expect(b63).toContain('aria-label="السجل — السيارة 63"');
    expect(text(b63)).toBe('السجل');
    expect(b63).toContain(`d="${LOG_ICON[0] ?? '?'}"`);
    expect(b63).toContain('type="button"');
    // The icon-only variant went with «أعلى السيارات صرفًا»'s: the word is always on it.
    expect(b63).not.toContain('title=');
    expect(CAR_LOG).not.toContain('compact');
    // An old book's line has its log, by its code; a line that names no car has none.
    expect(custodyCarOf({ vehicleId: 'v-63', vehicleCode: '63' })).toEqual({ vehicleId: 'v-63' });
    expect(custodyCarOf({ vehicleId: null, vehicleCode: 'كوستر الدفتر' })).toEqual({
      bookCode: 'كوستر الدفتر',
    });
    expect(custodyCarOf({ vehicleId: null, vehicleCode: null })).toBeNull();
    expect(custodyCarOf({ vehicleId: null, vehicleCode: ' ' })).toBeNull();
  });

  it('opens over the board — titled for its car, the board’s filters read only', () => {
    expect(body()).not.toContain('data-custody-car-log=');
    const html = opened();
    const log = html.slice(html.indexOf('data-custody-car-log="true"'));
    expect(html.indexOf('data-custody-car-log="true"')).toBeGreaterThan(-1);
    const dialog = /role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/u.exec(log);
    expect(dialog).not.toBeNull();
    const title = log.slice(log.indexOf(`id="${dialog?.[1] ?? '?'}"`));
    expect(text(title.slice(0, title.indexOf('</h2>')))).toBe('سجل السيارة 63');
    expect(log).toMatch(/data-custody-car-log-close="true"/u);
    expect(log).toContain(`aria-label="${ar('common.close')}"`);
    expect(log).toContain('data-custody-car-log-backdrop="true"');
    // The board's filters, as chips — read only, nothing to type in.
    const chips = log.slice(log.indexOf('data-custody-car-log-filters'));
    expect(text(chips.slice(0, chips.indexOf('</ul>')))).toBe(
      'من 2026/10/01 النوع: صيانة، وقود، كاوتش',
    );
    expect(chips.slice(0, chips.indexOf('</ul>'))).not.toMatch(/<input|<select|<button/u);
    expect(text(log)).toContain(ar('fleet.custody.dashboard.carLog.note'));
    // No filter: the board's own «no filter» chip.
    const bare = opened({});
    const none = bare.slice(bare.indexOf('data-custody-car-log-filters'));
    expect(text(none.slice(0, none.indexOf('</ul>')))).toBe(
      ar('fleet.custody.dashboard.filters.none'),
    );
  });

  it('heads the log with the car’s totals — each kind and its share of the car, the total and its share of all', () => {
    const html = opened();
    const totals = html.slice(html.indexOf('data-custody-car-log-totals'));
    expect(text(totals.slice(0, totals.indexOf('</section>')))).toBe(
      'صيانة 850.00 ج.م. 38% من إجمالي السيارة وقود — كاوتش 1,400.00 ج.م. 62% من إجمالي السيارة غسيل — الإجمالي 2,250.00 ج.م. 51.9% من إجمالي مصروفات العهدة',
    );
    expect([...totals.matchAll(/data-custody-car-log-kind="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...CUSTODY_KINDS,
      'total',
    ]);
    // Each kind in its own colour, the total emerald.
    for (const kind of CUSTODY_KINDS) {
      expect(classesOf(totals, `data-custody-car-log-kind="${kind}"`)).toEqual(
        expect.arrayContaining(CUSTODY_KIND[kind].accent.split(' ')),
      );
    }
    expect(classesOf(totals, 'data-custody-car-log-kind="total"')).toEqual(
      expect.arrayContaining(['border-emerald-300', 'dark:border-emerald-500/40']),
    );
    // The same figures as the car's line of «ملخص لكل سيارة» — never a sum of one page.
    expect(car63.total).toBe(2250);
    expect(custodyShare1(car63.total, dashboard.total)).toBe('51.9%');
  });

  it('names the total’s share for what it is — of all the custody spent, never of the fund («إجمالي العهدة»)', () => {
    // «إجمالي العهدة» is the fund itself now (what «شحن العهدة» charges into it, no filter changes
    // it); the car's 51.9% is of what the fund paid over the same filters, so it says «من إجمالي
    // مصروفات العهدة» — the board's own name for that figure — in Arabic as in English.
    expect(ar('fleet.custody.dashboard.carLog.ofSpend')).toBe(
      `من ${ar('fleet.custody.totals.total')}`,
    );
    expect(ar('fleet.custody.dashboard.carLog.ofSpend')).not.toBe(
      `من ${ar('fleet.custody.fund.title')}`,
    );
    expect(translate('en', 'fleet.custody.dashboard.carLog.ofSpend')).toBe('of all custody spend');
    // The fund, set far above the spend, changes nothing in the log: its share is of the spend.
    expect(dashboard.fundTotal).not.toBe(dashboard.total);
    const html = opened();
    const totals = html.slice(html.indexOf('data-custody-car-log-kind="total"'));
    expect(text(totals.slice(0, totals.indexOf('</section>')))).toMatch(
      /51\.9% من إجمالي مصروفات العهدة$/u,
    );
    expect(totals).not.toContain(ar('fleet.custody.fund.title') + '<');
    // The page hands the log the summary's spend, never `fundTotal`, under a name that cannot be
    // taken for the fund.
    expect(PAGE).toContain('spendTotal={summary.data?.total ?? 0}');
    expect(PAGE).not.toMatch(/<CustodyCarLog[^>]*fundTotal=/u);
    expect(CAR_LOG).not.toMatch(/\bfundTotal\s*[:=,}]/u);
  });

  it('lists every movement of the car — date, kind and its type or work, company, driver, source, amount', () => {
    const html = carLog();
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    // It is one car's log: no car column.
    expect(text(head)).toBe('التاريخ النوع الشركة السائق المصدر المبلغ');
    // The server's order — newest first — kept.
    expect([...html.matchAll(/data-custody-car-log-row="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'c204f',
      'c204n',
      'c204w',
    ]);
    expect(text(logRow(html, 'c204f'))).toBe(
      '2026/10/05 وقود (سولار) وطنية (Wataniya) إبراهيم جميل رمضان داود خصم الإيصالات 500.00 ج.م.',
    );
    expect(logRow(html, 'c204f')).toContain('data-custody-company-badge="wataniya"');
    expect(logRow(html, 'c204f')).toContain(COMPANY.wataniya.badge);
    expect(logRow(html, 'c204f')).toContain(CUSTODY_KIND.fuel.badge);
    // A fuel receipt that names no company says so — never a company guessed.
    expect(text(logRow(html, 'c204n'))).toContain('وقود (بنزين 92) بدون شركة');
    expect(logRow(html, 'c204n')).toContain('data-custody-car-log-company="none"');
    expect(logRow(html, 'c204n')).not.toContain('data-custody-company-badge');
    // Not fuel: no company at all.
    expect(text(logRow(html, 'c204w'))).toBe(
      '2026/10/02 غسيل — إبراهيم جميل رمضان داود خصم الإيصالات 120.00 ج.م.',
    );
    // «صيانة»: a receipt like the rest — no company, here no driver, «خصم الإيصالات» its source,
    // in the row's plain ink. No dealership bill is a line of the car's log.
    const car63Log = carLog(car63, rows63);
    expect(text(logRow(car63Log, 'c63m'))).toBe('2026/10/01 صيانة — — خصم الإيصالات 850.00 ج.م.');
    expect(logRow(car63Log, 'c63m')).toContain(CUSTODY_KIND.maintenance.badge);
    expect(logRow(car63Log, 'c63m')).not.toContain('text-blue-700 dark:font-medium');
    expect(CAR_LOG).not.toContain('dealershipInvoice');
    // «شيلهم»: a wash is only «غسيل» — the receipt records no kind of wash; «صيانة» only itself.
    expect(custodyKindText(ar, logRows[3]!)).toBe('غسيل');
    expect(custodyKindText(ar, logRows[5]!)).toBe('صيانة');
    expect(custodyKindText(ar, logRows[0]!)).toBe('وقود (بنزين 92)');
  });

  it('asks `/movements` over the board’s filters and that one car — its registry id, or the old book’s code whole', () => {
    expect(custodyCarLogQuery(ON, car63)).toEqual({ ...ON, vehicleId: 'v-63' });
    expect(custodyCarLogQuery(ON, { vehicleId: null, vehicleCode: 'كوستر الدفتر' })).toEqual({
      ...ON,
      bookCode: 'كوستر الدفتر',
    });
    expect(custodyCarLogQuery(ON, { vehicleId: null, vehicleCode: null })).toBeNull();
    // The board's own cars stay as they are: the car narrows them, never replaces them.
    expect(custodyCarLogQuery({ vehicleCodes: ['63', '204'] }, car63)).toEqual({
      vehicleCodes: ['63', '204'],
      vehicleId: 'v-63',
    });
    expect(CAR_LOG).toContain(
      'useCustodyLog({ ...(ask ?? filters) }, page, pageSize, ask !== null)',
    );
    // The board's log hook, its own page and size — under the ledger's key, so a receipt saved
    // or deleted refreshes it too.
    expect(QUERIES).toContain(
      "listKey(MODULE, 'custody', { log: true, ...filters, page, pageSize })",
    );
    // An old book's line asks by its code, spaces and all.
    const book = {
      vehicleId: null,
      vehicleCode: 'كوستر الدفتر',
      maintenance: 300,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 300,
    };
    const line = movement({
      id: 'b1',
      source: 'maintenance',
      vehicleId: null,
      vehicleCode: 'كوستر الدفتر',
      driverEmployeeId: null,
      driverName: null,
      fuelType: null,
      company: null,
      amount: 300,
    });
    expect(carLog(book, [line], { filters: ON })).toContain('data-custody-car-log-row="b1"');
    // Over other filters it is another question — drawn only from its own answer.
    expect(carLog(car204, rows204, { filters: ON })).toContain('data-custody-car-log-row="c204f"');
  });

  it('pages on its own — 25, 50 or 100 a page, «عرض X - Y من أصل N»', () => {
    const many = carLog(car204, rows204, { totalItems: 60 });
    expect(text(many.slice(many.indexOf('data-custody-car-log-count')))).toMatch(/^60 حركة/u);
    expect(text(many.slice(many.indexOf('data-custody-log-range')))).toContain(
      'عرض 1 - 25 من أصل 60 حركة',
    );
    const sizes = many.slice(many.indexOf('data-custody-log-size'), many.indexOf('</select>'));
    expect([...sizes.matchAll(/<option value="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '25',
      '50',
      '100',
    ]);
    expect([...many.matchAll(/data-custody-log-page="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(classesOf(many, 'aria-current="page"')).toEqual(
      expect.arrayContaining(['bg-emerald-600', 'text-white']),
    );
    const second = carLog(car204, rows204, { page: 2, totalItems: 60 });
    expect(text(second.slice(second.indexOf('data-custody-log-range')))).toContain(
      'عرض 26 - 50 من أصل 60 حركة',
    );
    expect(second).toMatch(/aria-current="page" data-custody-log-page="2"/u);
    const fifty = carLog(car204, rows204, { pageSize: 50, totalItems: 60 });
    expect(text(fifty.slice(fifty.indexOf('data-custody-log-range')))).toContain(
      'عرض 1 - 50 من أصل 60 حركة',
    );
  });

  it('wears its faces — shimmering while its page comes, the error with a retry, «لا حركات» when none', () => {
    const waiting = draw(
      <CustodyCarLogBody car={car63} spendTotal={dashboard.total} filters={{}} />,
    );
    expect(waiting).toContain('data-custody-car-log-loading="true"');
    // The totals are the dashboard's own — on screen at once.
    expect(waiting).toContain('data-custody-car-log-totals="true"');
    const empty = carLog(car63, []);
    expect(empty).toContain('data-custody-car-log-empty="true"');
    expect(empty).toContain(ar('fleet.custody.dashboard.carLog.empty'));
    expect(empty).not.toContain('<table');
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
      },
    });
    qc.getQueryCache()
      .build(qc, { queryKey: carKey({}, { vehicleId: 'v-63' }) })
      .setState({
        data: undefined,
        dataUpdateCount: 0,
        dataUpdatedAt: 0,
        error: new Error('boom'),
        errorUpdateCount: 1,
        errorUpdatedAt: NOW,
        fetchFailureCount: 1,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: false,
        status: 'error',
        fetchStatus: 'idle',
      });
    const failed = mount(
      qc,
      <CustodyCarLogBody car={car63} spendTotal={dashboard.total} filters={{}} />,
    );
    expect(failed).toContain(ar('common.retry'));
    expect(failed).not.toContain('data-custody-car-log-loading');
  });

  it('closes on Escape before anything beneath hears it, keeps Tab inside, mutes the board and gives the focus back', () => {
    // Escape is taken on its way down (the capture phase) and stopped: nothing on the board
    // beneath hears it, so it closes the log and nothing else.
    expect(CAR_LOG).toContain("document.addEventListener('keydown', onKey, true)");
    expect(CAR_LOG).toContain("document.removeEventListener('keydown', onKey, true)");
    expect(CAR_LOG).toMatch(
      /if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*close\.current\(\);/u,
    );
    // Tab rounds inside the log, by the dashboard's own rule.
    expect(CAR_LOG).toContain('custodyTrapFocus<Element>({ back, active, first, last, inside })');
    expect(CAR_LOG).toContain("document.addEventListener('focusin', onFocusIn, true)");
    expect(CAR_LOG).toContain("document.removeEventListener('focusin', onFocusIn, true)");
    // The board beneath is out of reach while the log is up, and back after.
    expect(CAR_LOG).toContain('for (const el of muted) el.inert = true;');
    expect(CAR_LOG).toContain('for (const el of muted) el.inert = false;');
    expect(CAR_LOG).toContain('closeButton.current?.focus()');
    // The focus goes back to the «السجل» pressed — handed in by the click, not read off the page.
    expect(CAR_LOG).toContain('returnTo.current?.focus()');
    expect(CAR_LOG).toContain('onClick={(e) => onOpen(car, e.currentTarget)}');
    // Over the board, on <body> — no dashboard layer to be drawn into any more.
    expect(CAR_LOG).toMatch(/\n {4}document\.body,\n {2}\);/u);
    expect(CAR_LOG).not.toContain('useContext');
    expect(PARTS).not.toContain('createContext');
    // Another car's log starts afresh, on its first page.
    expect(PAGE).toContain('key={carLog.key}');
    const alone = draw(
      <CustodyCarLog
        car={car63}
        spendTotal={dashboard.total}
        filters={{}}
        opener={null}
        onClose={() => undefined}
      />,
    );
    expect(alone).toContain('role="dialog" aria-modal="true"');
  });

  it('closes on × and on a click outside it, and its body scrolls on its own under a fixed header', () => {
    const html = opened();
    const log = html.slice(html.indexOf('data-custody-car-log="true"'));
    // The JSX element carrying `attr`, as written: its whole opening tag (and, for a button, all
    // of it) — so what a click on it does is read off the very element.
    const element = (attr: string, open: string, end: string): string => {
      const at = CAR_LOG.indexOf(attr);
      expect(at, attr).toBeGreaterThan(-1);
      return CAR_LOG.slice(CAR_LOG.lastIndexOf(open, at), CAR_LOG.indexOf(end, at) + end.length);
    };
    // A click outside the panel lands on the backdrop — the screen around it, beneath the panel —
    // and closes the log; so does ×. Both call the latest `onClose`.
    const backdrop = element('data-custody-car-log-backdrop="true"', '<div', '/>');
    expect(backdrop).toContain('onClick={() => close.current()}');
    const cross = element('data-custody-car-log-close="true"', '<button', '</button>');
    expect(cross).toContain('onClick={() => close.current()}');
    expect(cross).toContain('type="button"');
    expect(CAR_LOG).toContain('close.current = onClose;');
    expect(classesOf(html, 'data-custody-car-log="true"')).toEqual(
      expect.arrayContaining(['fixed', 'inset-0']),
    );
    expect(classesOf(log, 'data-custody-car-log-backdrop="true"')).toEqual(
      expect.arrayContaining(['absolute', 'inset-0']),
    );
    expect(log.indexOf('data-custody-car-log-backdrop="true"')).toBeLessThan(
      log.indexOf('role="dialog"'),
    );
    expect(classesOf(log, 'role="dialog"')).toEqual(
      expect.arrayContaining(['relative', 'flex', 'h-full', 'flex-col']),
    );
    // The header keeps its place; the body under it — the totals and the movements — scrolls on
    // its own, and its scroll never runs on into the dashboard beneath.
    const bodyAt = log.indexOf('data-custody-car-log-scroll="true"');
    expect(bodyAt).toBeGreaterThan(log.indexOf('data-custody-car-log-close="true"'));
    expect(classesOf(log, 'data-custody-car-log-scroll="true"')).toEqual(
      expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain']),
    );
    expect(log.indexOf('data-custody-car-log-body="true"')).toBeGreaterThan(bodyAt);
    expect(log.indexOf('data-custody-car-log-totals="true"')).toBeGreaterThan(bodyAt);
    expect(log.indexOf('data-custody-car-log-row=')).toBeGreaterThan(bodyAt);
    expect(classesOf(log, '<header')).toContain('shrink-0');
    // It holds the page beneath still, and gives it back as it was.
    expect(CAR_LOG).toContain('const overflow = document.body.style.overflow;');
    expect(CAR_LOG).toContain("document.body.style.overflow = 'hidden';");
    expect(CAR_LOG).toContain('document.body.style.overflow = overflow;');
    expect(CAR_LOG).not.toContain('ownLock');
  });

  it('puts «السجل» on every line that names a car — an old book’s too — never on «الإجمالي»', () => {
    const qc = client();
    const book = {
      vehicleId: null,
      vehicleCode: 'كوستر الدفتر',
      maintenance: 300,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 300,
    };
    const nameless = { ...book, vehicleCode: null, maintenance: 0, fuel: 10, total: 10 };
    qc.setQueryData(listKey('fleet', 'custody', { summary: true, ...FILTERS }), {
      count: dashboard.count + 2,
      total: dashboard.total + 310,
      maintenance: dashboard.maintenance + 300,
      fuel: dashboard.fuel + 10,
      tyres: dashboard.tyres,
      wash: dashboard.wash,
      vehicles: [...dashboard.vehicles, book, nameless],
      fundTotal: dashboard.fundTotal,
    } satisfies FleetCustodySummaryDto);
    const html = mount(qc, <CustodyPage />);
    const table = html.slice(
      html.indexOf('data-custody-per-vehicle="true"'),
      html.indexOf('data-custody-movements="true"'),
    );
    // Every car, the old book's line by its code; the line that names no car has none.
    expect(
      [...table.matchAll(/data-custody-car-log-open="([^"]*)"/gu)].map((m) => m[1]).sort(),
    ).toEqual(['160', '204', '63', 'كوستر الدفتر']);
    // Beside the car's code, in its cell — the word on it, its name saying which car.
    const at = table.indexOf('data-custody-car-log-open="63"');
    const cell = table.slice(table.lastIndexOf('<td', at), table.indexOf('</td>', at));
    expect(text(cell)).toBe('63 السجل');
    expect(cell).toContain('aria-label="السجل — السيارة 63"');
    expect(cell).toContain('type="button"');
    // «الإجمالي الختامي» is the whole fund's — it has no log.
    const grand = table.slice(table.indexOf('data-custody-grand-total="true"'));
    expect(text(grand.slice(0, grand.indexOf('</tr>')))).toMatch(/^الإجمالي/u);
    expect(grand.slice(0, grand.indexOf('</tr>'))).not.toContain('data-custody-car-log-open');
    expect(PAGE).toMatch(
      /row\.vehicleId === GRAND_TOTAL \? \(\s*<span className=\{GRAND_WORD\}>\{row\.vehicleCode\}<\/span>/u,
    );
    // Closed on the way in; pressed, the car's log over the board — its line as the summary holds
    // it, its share of what the fund paid over the same filters (the summary's `total`, never the
    // fund itself, `fundTotal`), the board's own filters, the focus back on «السجل».
    expect(html).not.toContain('data-custody-car-log="true"');
    expect(PAGE).toContain(
      'onOpen={(car, opener) => setCarLog({ key: custodyCarKey(car), car, opener })}',
    );
    expect(PAGE).toMatch(
      /<CustodyCarLog\s+key=\{carLog\.key\}\s+car=\{custodyCurrentCar\(summary\.data\?\.vehicles, carLog\)\}\s+spendTotal=\{summary\.data\?\.total \?\? 0\}\s+filters=\{filters\}\s+opener=\{carLog\.opener\}\s+onClose=\{\(\) => setCarLog\(null\)\}/u,
    );
  });

  it('keeps an open log’s totals the server’s — the line now, nothing once it is gone', () => {
    const open = { key: 'v-63', car: car63, opener: null };
    const moved = { ...car63, tyres: 1500, total: 2350 };
    expect(custodyCurrentCar([car204, moved], open)).toBe(moved);
    // The filters no longer reach it: its kinds are nothing, never the old sums.
    expect(custodyCurrentCar([car204], open)).toEqual({
      ...car63,
      maintenance: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 0,
    });
    // No answer at all yet: the line as it was opened.
    expect(custodyCurrentCar(undefined, open)).toBe(car63);
    expect(PAGE).toContain('car={custodyCurrentCar(summary.data?.vehicles, carLog)}');
  });

  it('wears the dashboard’s look in both themes, and fits a 375px phone without a side-scroll', () => {
    const html = opened();
    const log = html.slice(html.indexOf('data-custody-car-log="true"'));
    expect(classesOf(log, 'role="dialog"')).toEqual(
      expect.arrayContaining([
        'h-full',
        'w-full',
        'max-w-4xl',
        'bg-[#f8fafc]',
        'dark:bg-[#0b0f19]',
      ]),
    );
    // Two figures a row on a phone, the total across; five in one row from `sm`.
    expect(classesOf(log, 'data-custody-car-log-totals')).toEqual(
      expect.arrayContaining(['grid-cols-2', 'sm:grid-cols-5']),
    );
    expect(classesOf(log, 'data-custody-car-log-kind="total"')).toEqual(
      expect.arrayContaining(['col-span-2', 'sm:col-span-1']),
    );
    // The table scrolls inside its card; the chips and the title wrap.
    expect(log).toMatch(/class="overflow-x-auto[^"]*"><table[^>]*class="w-full min-w-\[40rem\]/u);
    expect(classesOf(log, 'data-custody-car-log-filters')).toContain('flex-wrap');
    // Every light surface says what it paints in the dark.
    const tags = [...log.matchAll(/class="([^"]*)"/gu)].map((m) => (m[1] ?? '').split(' '));
    for (const cls of tags) {
      if (
        !cls.some((c) =>
          /^(?:bg-white|bg-slate-50|bg-slate-100|bg-slate-50\/80|bg-\[#f8fafc\])$/u.test(c),
        )
      )
        continue;
      expect(
        cls.some((c) => c.startsWith('dark:bg-')),
        cls.join(' '),
      ).toBe(true);
    }
  });
});

describe('both themes — the dark design and the light map', () => {
  it('draws every card on the design’s surface: white with #e2e8f0 light, the obsidian gradient dark', () => {
    for (const cls of [
      'bg-white',
      'border-[#e2e8f0]',
      'hover:border-[#cbd5e1]',
      'dark:bg-transparent',
      'dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)]',
      'dark:border-[rgba(42,58,84,.65)]',
      'dark:hover:border-[rgba(59,130,246,.45)]',
      'dark:backdrop-blur-[12px]',
    ]) {
      expect(CARD.split(' '), cls).toContain(cls);
    }
    const html = body();
    for (const id of ['timeline', 'byKindSource', 'topCars', 'topDrivers', 'fuel']) {
      const cls = classesOf(html, `data-custody-dashboard-section="${id}"`);
      expect(cls, id).toEqual(expect.arrayContaining(['bg-white', 'dark:bg-transparent']));
    }
    // A table card — a car's movements in its «السجل» — wears the design's `shadow-2xl` on the
    // dark INSTEAD of the card's own: Tailwind writes an arbitrary shadow after `shadow-2xl`, so a
    // card carrying both keeps the shallow one and the 2xl never shows.
    const log = draw(
      <CustodyCarLogBody car={dashboard.vehicles[0]!} spendTotal={dashboard.total} filters={{}} />,
    );
    const cls = classesOf(log, 'data-custody-car-log-movements="true"');
    expect(cls).toEqual(expect.arrayContaining(['bg-white', 'dark:bg-transparent']));
    expect(cls).toContain('dark:shadow-2xl');
    expect(cls.filter((c) => c.startsWith('dark:shadow-['))).toEqual([]);
    // …and keeps the card's hover shadow.
    expect(cls.some((c) => c.startsWith('dark:hover:shadow-['))).toBe(true);
    expect(TABLE_CARD.split(' ')).toContain('dark:shadow-2xl');
    expect(CARD.split(' ').filter((c) => c.startsWith('dark:shadow-['))).toHaveLength(1);
  });

  it('gives every light colour of a card its dark counterpart', () => {
    // A light-only class on a surface would leave a white box on the dark theme: every element
    // that paints a light background also says what it paints in the dark.
    const html = body({ ...dashboard, alerts: alerting });
    const tags = [...html.matchAll(/class="([^"]*)"/gu)].map((m) => (m[1] ?? '').split(' '));
    const lightSurfaces = /^(?:bg-white|bg-slate-50|bg-slate-100|bg-slate-50\/80)$/u;
    for (const cls of tags) {
      if (!cls.some((c) => lightSurfaces.test(c))) continue;
      expect(
        cls.some((c) => c.startsWith('dark:bg-')),
        cls.join(' '),
      ).toBe(true);
    }
  });
});

describe('«والنسب باينه» — every share in Latin digits, left to right', () => {
  it('writes every share as a whole per cent («<1%», «>99%») — one decimal only in a car’s «السجل» and under ten per cent of the fund', () => {
    const html = body({ ...dashboard, alerts: alerting });
    const shares = [...html.matchAll(/>([^<>]*%)</gu)];
    expect(shares.length).toBeGreaterThan(25);
    let ofFund = 0;
    for (const m of shares) {
      const share = m[1] ?? '';
      const tag = html.slice(html.lastIndexOf('<', m.index), (m.index ?? 0) + 1);
      if (tag.includes('data-custody-fund-pct="true"')) {
        // «صُرف منها 8.7%» — what was spent of the fund: one decimal under ten per cent.
        ofFund += 1;
        expect(share).toMatch(/^(?:\d\.\d%|\d{2,3}%|&lt;0\.1%|&gt;99%|&gt;100%)$/u);
      } else {
        expect(share).toMatch(/^(?:\d{1,3}%|&lt;1%|&gt;99%)$/u);
      }
      expect(tag, `«${share}» sits in a left-to-right span`).toMatch(/^<span [^>]*dir="ltr"/u);
    }
    expect(ofFund).toBe(1);
    // A car's share of all the custody spent, at the top of its «السجل»: one decimal, as designed.
    const log = draw(
      <CustodyCarLogBody car={dashboard.vehicles[1]!} spendTotal={dashboard.total} filters={{}} />,
    );
    expect(log).toMatch(/<span dir="ltr" data-custody-pct1="true" class="[^"]*">51\.9%<\/span>/u);
  });

  it('writes a share in whole per cent, «<1%» for a sliver, a dash of nothing', () => {
    expect(custodyShare(1965.5, 4335.5)).toBe('45%');
    expect(custodyShare(1, 1000)).toBe('<1%');
    expect(custodyShare(0, 1000)).toBe('0%');
    expect(custodyShare(5, 0)).toBe('—');
    expect(custodyShare(9980, 10000)).toBe('>99%');
    expect(custodyShare(10000, 10000)).toBe('100%');
    expect(custodySharePct(5, 0)).toBe(0);
  });

  it('never writes «NaN%» when everything is zero', () => {
    const zero: FleetCustodyDashboardDto = {
      ...dashboard,
      total: 0,
      maintenance: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      vehicles: dashboard.vehicles.map((car) => ({
        ...car,
        maintenance: 0,
        fuel: 0,
        tyres: 0,
        wash: 0,
        total: 0,
      })),
      bySource: dashboard.bySource.map((line) => ({ ...line, amount: 0 })),
      timeline: {
        granularity: 'month',
        buckets: dashboard.timeline.buckets.map((bucket) => ({
          ...bucket,
          maintenance: 0,
          fuel: 0,
          tyres: 0,
          wash: 0,
          total: 0,
        })),
      },
      drivers: dashboard.drivers.map((driver) => ({
        ...driver,
        fuel: 0,
        tyres: 0,
        wash: 0,
        total: 0,
      })),
      noDriver: { count: 1, amount: 0 },
      fuelTypes: dashboard.fuelTypes.map((line) => ({ ...line, amount: 0 })),
      fuelByCompany: {
        companies: dashboard.fuelByCompany.companies.map((row) => ({
          ...row,
          amount: 0,
          types: row.types.map((line) => ({ ...line, amount: 0 })),
        })),
        none: { amount: 0, count: 0, litres: 0, types: [] },
      },
    };
    const html = body(zero);
    expect(html).not.toMatch(/NaN|Infinity/u);
    expect(html).not.toContain('data-custody-arc=');
    expect(html).not.toContain('data-custody-ring=');
  });
});

describe('the arithmetic of the words', () => {
  it('counts in Arabic as the design does — «1 حركة», «9 حركات», «15 حركة», «0 إيصالات»', () => {
    expect(custodyCountForm('ar', 1)).toBe('one');
    expect(custodyCountForm('ar', 0)).toBe('few');
    expect(custodyCountForm('ar', 2)).toBe('few');
    expect(custodyCountForm('ar', 9)).toBe('few');
    expect(custodyCountForm('ar', 10)).toBe('few');
    expect(custodyCountForm('ar', 15)).toBe('other');
    expect(custodyCountForm('ar', 103)).toBe('few');
    expect(custodyCountForm('ar', 100)).toBe('other');
    expect(custodyCountForm('en', 1)).toBe('one');
    expect(custodyCountForm('en', 2)).toBe('other');
    // «فاتورة ملاكي» is no noun of the fund's any more — no bill waits on it.
    for (const noun of ['movement', 'day', 'car']) {
      for (const form of ['one', 'few', 'other']) {
        const key = `fleet.custody.dashboard.noun.${noun}.${form}`;
        expect(translate('ar', key), key).not.toBe(key);
        expect(translate('en', key), key).not.toBe(key);
      }
    }
  });

  it('writes a period year first, as the board writes a date', () => {
    expect(custodyPeriod('2026-10')).toBe('2026/10');
    expect(custodyPeriod('2026-10-04')).toBe('2026/10/04');
  });

  it('steps the value axis in round numbers, the top at or over the dearest bar', () => {
    expect(custodyTicks(0)).toEqual([0]);
    expect(custodyTicks(4000)).toEqual([0, 1000, 2000, 3000, 4000]);
    for (const max of [1, 7, 99, 315, 1234.5, 98_765]) {
      const ticks = custodyTicks(max);
      expect(ticks[ticks.length - 1], String(max)).toBeGreaterThanOrEqual(max);
      expect(ticks.length, String(max)).toBeLessThanOrEqual(6);
    }
  });

  it('keeps Tab inside the modal — round at either end, and back in from the page behind', () => {
    const [first, middle, last] = ['×', 'جدول', 'السائقين'];
    const trap = (back: boolean, active: string | null, inside = true): string | null =>
      custodyTrapFocus({ back, active, first, last, inside });
    expect(trap(false, middle)).toBeNull();
    expect(trap(false, last)).toBe(first);
    expect(trap(true, first)).toBe(last);
    expect(trap(false, 'pageSize', false)).toBe(first);
    expect(trap(true, 'pageSize', false)).toBe(last);
  });
});

describe('the kinds’ colours on the WHOLE custody screen — the owner’s design', () => {
  it('draws صيانة blue — التوكيل’s blue, in its place — وقود amber, كاوتش rose, غسيل cyan, the design’s shade in each theme', () => {
    expect(CUSTODY_KIND.maintenance.fill).toBe('bg-blue-600 dark:bg-blue-500');
    expect(CUSTODY_KINDS[0]).toBe('maintenance');
    expect(CUSTODY_KIND.fuel.fill).toBe('bg-amber-500');
    expect(CUSTODY_KIND.tyres.fill).toBe('bg-rose-500');
    expect(CUSTODY_KIND.wash.fill).toBe('bg-cyan-600 dark:bg-cyan-500');
    expect(new Set(CUSTODY_KINDS.map((kind) => CUSTODY_KIND[kind].fill)).size).toBe(4);
    // The pale badge: the light map's 50 / 800 / 300, the dark design's 500/10 / 400 / 500/25.
    expect(CUSTODY_KIND.fuel.badge).toContain('bg-amber-50');
    expect(CUSTODY_KIND.fuel.badge).toContain('text-amber-800');
    expect(CUSTODY_KIND.fuel.badge).toContain('border-amber-300');
    expect(CUSTODY_KIND.fuel.badge).toContain('dark:bg-amber-500/10');
    expect(CUSTODY_KIND.fuel.badge).toContain('dark:text-amber-400');
    expect(CUSTODY_KIND.fuel.badge).toContain('dark:border-amber-500/25');
  });

  it('wears them on the board’s figures too — the dashboard’s KPI cards, each kind’s edge, tile and share bar, the total emerald', () => {
    const html = draw(<CustodyFigures totals={dashboard} />);
    /** One figure's markup, up to the next figure. */
    const figure = (id: string): string => {
      const at = html.indexOf(`data-custody-figure="${id}"`);
      expect(at, id).toBeGreaterThan(-1);
      const next = html.indexOf('data-custody-figure="', at + 10);
      return html.slice(at, next === -1 ? undefined : next);
    };
    /** The card inside a figure's cell — its first `<div>`. */
    const cardOf = (part: string): string[] => {
      const at = part.indexOf('<div');
      return (/class="([^"]*)"/u.exec(part.slice(at, part.indexOf('>', at)))?.[1] ?? '').split(' ');
    };
    expect([...html.matchAll(/data-custody-figure="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'fund',
      'total',
      ...CUSTODY_KINDS,
    ]);
    for (const kind of CUSTODY_KINDS) {
      const part = figure(kind);
      const look = CUSTODY_KIND[kind];
      // The dashboard's card — its surface and border in both themes, rounded-2xl — with the
      // kind's edge; the kind's words over the figure, its icon on its tile.
      expect(cardOf(part), kind).toEqual(
        expect.arrayContaining([
          ...CARD_SURFACE.split(' '),
          ...CARD_BORDER.split(' '),
          ...look.accent.split(' '),
          'rounded-2xl',
          'p-4',
          'h-full',
        ]),
      );
      expect(part, kind).toContain(`<span class="block text-xs ${look.label}">`);
      expect(text(part), kind).toContain(ar(`fleet.custody.totals.${kind}`));
      expect(part, kind).toContain(look.tile);
      // The figure black in the boards' monospace, as the board's tiles always wrote it — and in
      // that one font only: a second font-family class (Cairo) would lose to it unseen.
      expect(part, kind).toContain(
        `<span class="text-2xl font-black tracking-tight text-slate-900 dark:text-white ${esc(NUM)}">`,
      );
      expect(part, kind).not.toContain(esc(CAIRO));
      // «20% من الإجمالي» over a thin bar of the kind's fill, as long as the share.
      const share = part.slice(part.indexOf(`data-custody-figure-share="${kind}"`));
      expect(text(share.slice(0, share.indexOf('<span aria-hidden="true"'))), kind).toBe(
        `${custodyShare(dashboard[kind], dashboard.total)} ${ar('fleet.custody.totals.ofTotal')}`,
      );
      expect(part, kind).toContain(
        '<span aria-hidden="true" class="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]">',
      );
      expect(part, kind).toContain(
        `<span class="block h-full rounded-full ${look.fill}" style="width:${custodySharePct(dashboard[kind], dashboard.total)}%"></span>`,
      );
    }
    // The kinds' bars add up to the whole: four shares of one total. (The fund's bar, first, is
    // what was spent of the fund — a share of another whole.)
    const widths = [
      ...html
        .slice(html.indexOf('data-custody-figure="total"'))
        .matchAll(/style="width:([\d.]+)%"/gu),
    ].map((m) => Number(m[1]));
    expect(widths).toHaveLength(4);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    // The total: the dashboard's emerald card, its edge and tile, the movements counted under it.
    const total = figure('total');
    expect(cardOf(total)).toEqual(
      expect.arrayContaining([
        ...CARD_SURFACE.split(' '),
        ...CUSTODY_TOTAL_ACCENT.split(' '),
        'border-emerald-300',
        'bg-gradient-to-br',
        'from-emerald-50/70',
        'dark:border-emerald-500/40',
        'rounded-2xl',
      ]),
    );
    expect(total).toContain(CUSTODY_TOTAL_TILE);
    expect(total).toContain(
      `<span class="text-2xl font-black tracking-tight text-slate-900 dark:text-white ${esc(NUM)}">`,
    );
    expect(total).not.toContain(esc(CAIRO));
    // No element of the figures carries two fonts: `cn` merges nothing, so of two font-family
    // classes the stylesheet's order would pick, whatever the markup or a comment says.
    for (const m of html.matchAll(/class="([^"]*)"/gu)) {
      expect((m[1] ?? '').match(/\[font-family:/gu)?.length ?? 0, m[1]).toBeLessThanOrEqual(1);
    }
    expect(text(total)).toContain(
      `${ar('fleet.custody.totals.total')} 4,335.50 ج.م. ${ar('fleet.custody.dashboard.kpi.movements')} 6 حركات`,
    );
    expect(total).not.toContain('style="width:');
    // Not the boards' small `FigureChip` any more.
    expect(FIGURES).not.toContain('FigureChip');
    expect(html).not.toContain('dark:bg-[#111827]');
    // Of nothing, no share and no bar — never «NaN%» nor a bar of «NaN%» width. The fund's bar is
    // drawn, empty: nothing in it yet to spend.
    const none = draw(
      <CustodyFigures
        totals={{
          count: 0,
          total: 0,
          maintenance: 0,
          fuel: 0,
          tyres: 0,
          wash: 0,
          vehicles: [],
          fundTotal: 0,
        }}
      />,
    );
    expect(none).not.toContain('data-custody-figure-share');
    expect([...none.matchAll(/style="width:([^"]*)"/gu)].map((m) => m[1])).toEqual(['0%']);
    expect(html + none).not.toMatch(/NaN/u);
  });

  it('keeps the site’s purple to the two toolbar buttons — and the colours to the custody files', () => {
    const purple = /\b(?:[a-z]+:)?(?:bg|text|border|ring)-(?:brand|purple|violet|indigo)-/u;
    for (const [name, source] of [
      ['kinds', KINDS],
      ['figures', FIGURES],
      ['dashboard', DASHBOARD],
    ] as const) {
      expect(source, name).not.toMatch(purple);
    }
    // «لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات» — the toolbar's pressed
    // buttons, and nothing else on the screen.
    const page = PAGE.replace(/const PRESS_BUTTON =\s*'[^']*';/u, '');
    expect(page, 'page').not.toMatch(purple);
  });
});

describe('the owner’s words, quoted as he wrote them', () => {
  const FUEL_ASK = 'تفاصيل استهلاك الوقود يتقسم اتنين وطنيه لوخدها وشيل اوت لوحدها';
  const LOG_ASK =
    'عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته ك سجل للعربيه';
  const DOTS_ASK =
    'انت مش كنت خليت الارقام بتاعت التوكيل و الوقود وكدا بيكون جمبهم نقط الوان غيرتها ليه';
  const PURPLE_ASK = 'لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات';
  const SHAPES_ASK =
    'عاوز الداش بورد بكل حاجة تكون ظاهره حتى لو لسه مفيش اى اكشن او حركه او خصم او زياده فاهم يعنى على الاقل الاشكال موجودة';
  const API = '../../../../../api/';
  const CONTRACTS = '../../../../../../packages/contracts/src/modules/';
  const SOURCES: Record<string, string> = {
    'CustodyDashboard.tsx': MODAL,
    'CustodyDashboardCharts.tsx': CHARTS,
    'custody-dashboard-parts.tsx': PARTS,
    'CustodyCarLog.tsx': CAR_LOG,
    'CustodyPage.tsx': PAGE,
    'CustodyFigures.tsx': FIGURES,
    'custody-dashboard.spec.tsx': read('custody-dashboard.spec.tsx'),
    'custody-dashboard.ts': read(`${API}src/modules/fleet/custody/custody-dashboard.ts`),
    'custody-dashboard.spec.ts': read(`${API}src/modules/fleet/custody/custody-dashboard.spec.ts`),
    'custody.service.ts': read(`${API}src/modules/fleet/custody/custody.service.ts`),
    'tests/integration/fleet.spec.ts': read(`${API}tests/integration/fleet.spec.ts`),
    'contracts fleet.ts': read(`${CONTRACTS}fleet.ts`),
    'contracts fleet.spec.ts': read(`${CONTRACTS}fleet.spec.ts`),
  };
  /** Every «…» in a source, a comment's line breaks (and its `//` or ` * `) read as one space. */
  const quotes = (source: string): string[] =>
    [
      ...source
        .replace(/[ \t]*\r?\n[ \t]*(?:\/\/|\*(?!\/))?[ \t]*/gu, ' ')
        .matchAll(/«([^«»]{1,200})»/gu),
    ].map((m) => m[1] ?? '');

  it('quotes the requests word for word, wherever a piece of them is quoted', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      for (const quote of quotes(source)) {
        // The split's own words — not the card's title, nor the owner's other asks about the two
        // companies (a car's two cards, a transfer between them).
        if (/استهلاك الوقود يتقسم|اوت لوحدها|وطني[هة] لو[خح]?دها/u.test(quote)) {
          expect(FUEL_ASK, `${name}: «${quote}»`).toContain(quote);
        }
        if (/علامه السجل/u.test(quote)) expect(LOG_ASK, `${name}: «${quote}»`).toContain(quote);
        if (/نقط الوان|جمبهم/u.test(quote))
          expect(DOTS_ASK, `${name}: «${quote}»`).toContain(quote);
        if (/لونهم موف/u.test(quote)) expect(PURPLE_ASK, `${name}: «${quote}»`).toContain(quote);
        if (/الاشكال موجودة|مفيش اى اكشن/u.test(quote)) {
          expect(SHAPES_ASK, `${name}: «${quote}»`).toContain(quote);
        }
      }
    }
    // The whole request, as written, where the split is made: the contract, the server, the card.
    for (const name of [
      'contracts fleet.ts',
      'custody-dashboard.ts',
      'CustodyDashboardCharts.tsx',
    ]) {
      expect(quotes(SOURCES[name] ?? ''), name).toContain(FUEL_ASK);
    }
    for (const name of ['CustodyCarLog.tsx', 'CustodyPage.tsx', 'contracts fleet.ts']) {
      expect(quotes(SOURCES[name] ?? ''), name).toContain(LOG_ASK);
    }
    // The dots, where they are drawn and where they are proven; the purple, where it is worn.
    for (const name of ['CustodyPage.tsx', 'custody-dashboard.spec.tsx']) {
      expect(quotes(SOURCES[name] ?? ''), name).toContain(DOTS_ASK);
      expect(quotes(SOURCES[name] ?? ''), name).toContain(PURPLE_ASK);
    }
    // Every section with no movement: where the empty face was taken away, and where the line is.
    for (const name of ['CustodyDashboard.tsx', 'custody-dashboard-parts.tsx']) {
      expect(quotes(SOURCES[name] ?? ''), name).toContain(SHAPES_ASK);
    }
  });
});
