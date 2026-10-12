// «لوحة تحكم» on the custody board — «جمب الاحصائيات داش بورد تفتح ف الشاشه كلها زى موديل كل حاجة
// بالتفصيل» — and, since «عاوز دى تكون فى شاشه العهد لما ادوس على لوحة التحكم فى اللايت سيم والدارك
// سيم», the owner's design of it, section by section and in its order, in the dark theme and the
// light map. Proven against what it produces: the button beside «الإحصائيات», the modal over the
// whole screen asking the board's own filters (read only, the driver's note, the reset), the alerts
// (only real ones, no amount on a waiting bill), the five figures with the fuel's «شل أوت / وطنية»
// and its «بدون شركة» line, the three tiles, the clustered time chart, the rings of kind and source,
// the cars, the drivers' rings, the fuel without its station panel, every car with its search and
// funnel, every movement with its own pages — Latin digits throughout, every share left to right.
import { readFileSync } from 'node:fs';
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
  custodyTopKinds,
  CustodyTopCars,
  CustodyTopDrivers,
} from '../components/CustodyDashboardCharts';
import {
  custodyCarRows,
  custodyKindText,
  CustodyLog,
  CustodyPerCar,
} from '../components/CustodyDashboardTables';
import {
  CARD,
  TABLE_CARD,
  custodyArcs,
  custodyCountForm,
  custodyDaysSince,
  custodyPeriod,
  custodyShare1,
  custodyTicks,
} from '../components/custody-dashboard-parts';
import { CustodyFigures, custodyShare, custodySharePct } from '../components/CustodyFigures';
import { CUSTODY_KIND, CUSTODY_KINDS } from '../components/CustodyKinds';
import { FleetPager } from '../components/FleetPager';

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
const TABLES = read('../components/CustodyDashboardTables.tsx');
const PARTS = read('../components/custody-dashboard-parts.tsx');
const KINDS = read('../components/CustodyKinds.tsx');
const FIGURES = read('../components/CustodyFigures.tsx');
const QUERIES = read('../api/fleet-queries.ts');
const DASHBOARD = [MODAL, CHARTS, TABLES, PARTS].join('\n');
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

/** 12 October 2026, mid-morning UTC — the day the waiting bills are aged against. */
const NOW = Date.UTC(2026, 9, 12, 10);

/** Every part adds up: the kinds, the cars, the stretches, the drivers and the two screens. */
const dashboard: FleetCustodyDashboardDto = {
  count: 6,
  total: 4335.5,
  dealership: 850,
  fuel: 1965.5,
  tyres: 1400,
  wash: 120,
  vehicles: [
    {
      vehicleId: 'v-204',
      vehicleCode: '204',
      dealership: 0,
      fuel: 1650.5,
      tyres: 0,
      wash: 120,
      total: 1770.5,
    },
    {
      vehicleId: 'v-63',
      vehicleCode: '63',
      dealership: 850,
      fuel: 0,
      tyres: 1400,
      wash: 0,
      total: 2250,
    },
    {
      vehicleId: 'v-160',
      vehicleCode: '160',
      dealership: 0,
      fuel: 315,
      tyres: 0,
      wash: 0,
      total: 315,
    },
  ],
  vehicleCount: 3,
  counts: { dealership: 1, fuel: 3, tyres: 1, wash: 1 },
  bySource: [
    { ref: 'receipt', count: 5, amount: 3485.5 },
    { ref: 'dealershipInvoice', count: 1, amount: 850 },
  ],
  timeline: {
    granularity: 'month',
    buckets: [
      { key: '2026-08', dealership: 0, fuel: 315, tyres: 0, wash: 0, total: 315, count: 1 },
      { key: '2026-09', dealership: 0, fuel: 0, tyres: 0, wash: 0, total: 0, count: 0 },
      {
        key: '2026-10',
        dealership: 850,
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
      fuel: 500,
      tyres: 1400,
      wash: 0,
      total: 1900,
      count: 2,
    },
    {
      driverEmployeeId: null,
      driverName: 'سائق اللوحة',
      fuel: 1465.5,
      tyres: 0,
      wash: 0,
      total: 1465.5,
      count: 2,
    },
  ],
  noDriver: { count: 1, amount: 120 },
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
      { company: 'wataniya', amount: 500, count: 1, litres: 43.48 },
      { company: 'chillout', amount: 0, count: 0, litres: 0 },
    ],
    none: { amount: 1465.5, count: 2, litres: 20 },
  },
  alerts: {
    doubleFuel: [],
    pendingPrivateBills: { count: 0, oldestOutDate: null },
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
  pendingPrivateBills: { count: 2, oldestOutDate: '2026-10-08' },
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
  movement({
    id: 'd1',
    ref: 'dealershipInvoice',
    source: 'dealership',
    driverEmployeeId: null,
    driverName: null,
    fuelType: null,
    company: null,
    detail: 'صيانة',
    amount: 1470,
  }),
];
const logPage = (
  page: number,
  pageSize = 25,
  items = logRows,
): Paginated<FleetCustodyMovementDto> => ({
  items,
  meta: { page, pageSize, totalItems: 60, totalPages: Math.ceil(60 / pageSize) },
});
const logKey = (filters: CustodyDashboardFilters, page: number, pageSize = 25) =>
  listKey('fleet', 'custody', { log: true, ...filters, page, pageSize });

describe('«لوحة تحكم» on the custody board', () => {
  it('sits right beside «الإحصائيات», closed on the way in, and asks the board’s own filters', () => {
    const qc = client();
    qc.setQueryData(listKey('fleet', 'custody', { summary: true, ...FILTERS }), {
      count: 0,
      total: 0,
      dealership: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      vehicles: [],
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

  it('wires what the dashboard asks of the board: reset, «عرض حركات التوكيل», «تصفية متقدمة»', () => {
    // «إعادة ضبط الفلاتر» is the filter bar's own clear — one function for both.
    expect(PAGE).toContain(
      '<FilterBar hasActiveFilters={hasActiveFilters} onClear={clearFilters}>',
    );
    expect(PAGE).toContain('onClearFilters={clearFilters}');
    // «عرض حركات التوكيل»: the board's «المصدر» set to التوكيل, the dashboard closed.
    expect(PAGE).toMatch(
      /onShowDealership=\{\(\) => \{\s*patch\(\{ source: 'dealership' \}\);\s*setDashOpen\(false\);/u,
    );
    // «تصفية متقدمة»: closed, and the focus lands on the board's filter bar after the dashboard
    // has handed it back to «لوحة تحكم».
    expect(PAGE).toMatch(
      /onAdvancedFilter=\{\(\) => \{\s*focusFilters\.current = true;\s*setDashOpen\(false\);/u,
    );
    expect(PAGE).toContain('ref={filterBar}');
    expect(PAGE).toContain('if (dashOpen || !focusFilters.current) return;');
    expect(PAGE).toContain("?.querySelector<HTMLElement>('input, button, select");
    const html = mount(client(), <CustodyPage />);
    expect(html).toContain('data-custody-filter-bar="true"');
  });

  it('wears the design’s emerald for what is pressed on the custody screen — the other boards keep purple', () => {
    const html = mount(client(), <CustodyPage />);
    for (const attr of ['data-custody-stats-toggle="true"', 'data-custody-dashboard-open="true"']) {
      const cls = classesOf(html, attr);
      expect(cls, attr).toEqual(
        expect.arrayContaining(['border-emerald-500/50', 'bg-emerald-500/15', 'text-emerald-700']),
      );
      expect(cls.join(' '), attr).not.toMatch(/brand-/u);
    }
    expect(PAGE).not.toMatch(/brand-/u);
    expect(PAGE).toContain('tone="emerald"');
    const meta = { page: 2, pageSize: 25, totalItems: 60, totalPages: 3 };
    const emerald = draw(<FleetPager tone="emerald" meta={meta} onPageChange={() => undefined} />);
    expect(classesOf(emerald, 'aria-current="page"')).toEqual(
      expect.arrayContaining(['bg-emerald-600', 'text-white']),
    );
    const plain = draw(<FleetPager meta={meta} onPageChange={() => undefined} />);
    expect(classesOf(plain, 'aria-current="page"'), 'every other board').toContain('bg-brand-600');
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
    // The cars' funnel list takes its own Escape first, focus on the funnel or in the list — it
    // never closes the whole dashboard while the list is open.
    expect(TABLES).toMatch(
      /if \(!menu \|\| e\.key !== 'Escape'\) return;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*setMenu\(false\);\s*funnelRef\.current\?\.focus\(\);/u,
    );
  });

  it('wears three faces — the frame while loading, the error with a retry, the empty ledger', () => {
    expect(custodyDashboardView({ isPending: true, isError: false, data: undefined })).toBe(
      'loading',
    );
    expect(custodyDashboardView({ isPending: false, isError: true, data: undefined })).toBe(
      'error',
    );
    expect(custodyDashboardView({ isPending: false, isError: false, data: dashboard })).toBe(
      'ready',
    );
    expect(
      custodyDashboardView({ isPending: false, isError: false, data: { ...dashboard, count: 0 } }),
    ).toBe('empty');
    // A refetch that failed keeps the last answer on screen.
    expect(custodyDashboardView({ isPending: false, isError: true, data: dashboard })).toBe(
      'ready',
    );
    const face = (view: Parameters<typeof CustodyDashboardContent>[0]['view']): string =>
      draw(
        <CustodyDashboardContent
          view={view}
          data={
            view === 'ready' ? dashboard : view === 'empty' ? { ...dashboard, count: 0 } : undefined
          }
          error={null}
          onRetry={() => undefined}
        />,
      );
    expect(face('loading')).toContain('data-custody-dashboard-loading="true"');
    expect(face('error')).toContain(ar('common.retry'));
    expect(face('empty')).toContain(ar('fleet.custody.empty'));
    // Over a filter, nothing MATCHING it — never «لم يُخصم شيء من العهدة بعد».
    const filteredEmpty = draw(
      <CustodyDashboardContent
        view="empty"
        data={{ ...dashboard, count: 0 }}
        error={null}
        onRetry={() => undefined}
        filtered
      />,
    );
    expect(filteredEmpty).toContain(ar('fleet.violations.report.empty'));
    expect(filteredEmpty).not.toContain(ar('fleet.custody.empty'));
    expect(MODAL).toContain('filtered={custodyFiltered(filters)}');
    // Reopened over other filters, never the last filters' sums under the new filters' words.
    const hook = QUERIES.slice(QUERIES.indexOf('export const useCustodyDashboard'));
    expect(hook.slice(0, hook.indexOf('});'))).not.toContain('placeholderData');
    // The log is drawn keyed by its filters: other filters start it afresh.
    expect(MODAL).toContain('key={JSON.stringify(filters)}');
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
      'perVehicle',
      'log',
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

  it('shows the design’s driver note only when a driver is filtered', () => {
    expect(ar('fleet.custody.dashboard.filters.driverNote')).toBe(
      'ملاحظة: عند تصفية السائق، تُستثنى فواتير التوكيل تلقائيًا لعدم ارتباطها بسائق معين.',
    );
    const withDriver = bar({ driver: 'رأفت' });
    expect(withDriver).toContain('data-custody-driver-note="true"');
    expect(withDriver).toContain(ar('fleet.custody.dashboard.filters.driverNote'));
    expect(withDriver).toContain(ar('fleet.custody.dashboard.filters.driver', { name: 'رأفت' }));
    expect(bar({ from: '2026-10-01' })).not.toContain('data-custody-driver-note');
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
    draw(<CustodyAlerts alerts={alerts} now={NOW} />);

  it('is not drawn at all when there is nothing to warn about', () => {
    expect(custodyHasAlerts(dashboard.alerts)).toBe(false);
    expect(banner(dashboard.alerts)).toBe('');
    expect(body()).not.toContain('data-custody-dashboard-section="alerts"');
    // Any one of the four is enough.
    for (const one of [
      { ...dashboard.alerts, receiptsWithoutPhoto: 1 },
      { ...dashboard.alerts, duplicateReceipts: 2 },
      { ...dashboard.alerts, pendingPrivateBills: { count: 1, oldestOutDate: '2026-10-11' } },
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

  it('counts the private cars’ bills waiting for their invoice and how long the oldest waited — never an amount', () => {
    const html = banner();
    const pending = html.slice(html.indexOf('data-custody-alert="pendingBills"'));
    // 8 October to 12 October: four days.
    expect(text(pending.slice(0, pending.indexOf('</span></span>')))).toContain(
      '2 فواتير ملاكي بانتظار الفاتورة — أقدمها من 4 أيام',
    );
    // «تكلفة معلقة ~3,400» is gone: a waiting bill has no amount yet.
    expect(html).not.toContain('ج.م');
    expect(html).not.toContain('تكلفة معلقة');
    const one = banner({
      ...alerting,
      pendingPrivateBills: { count: 1, oldestOutDate: '2026-10-12' },
    });
    expect(text(one)).toContain('1 فاتورة ملاكي بانتظار الفاتورة — أقدمها خرجت اليوم');
    const undated = banner({ ...alerting, pendingPrivateBills: { count: 3, oldestOutDate: null } });
    expect(text(undated)).toContain('3 فواتير ملاكي بانتظار الفاتورة');
    expect(text(undated)).not.toContain('أقدمها');
    expect(custodyDaysSince('2026-10-08', NOW)).toBe(4);
    expect(custodyDaysSince('2026-10-12T23:59:00.000Z', NOW)).toBe(0);
    expect(custodyDaysSince('2026-10-20', NOW), 'never below nothing').toBe(0);
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

  it('stays over an empty ledger — a bill waiting for its invoice is not a movement', () => {
    // «تكلفة معلقة» has no amount, so it is never a movement: nothing in the period, and still a
    // private car's bill waiting — the banner says so above the empty ledger.
    const waiting: FleetCustodyDashboardDto = {
      ...dashboard,
      count: 0,
      alerts: {
        ...dashboard.alerts,
        pendingPrivateBills: { count: 1, oldestOutDate: '2026-10-08' },
      },
    };
    expect(custodyDashboardView({ isPending: false, isError: false, data: waiting })).toBe('empty');
    const html = draw(
      <CustodyDashboardContent
        view="empty"
        data={waiting}
        error={null}
        onRetry={() => undefined}
        filtered
        now={NOW}
      />,
    );
    const at = html.indexOf('data-custody-dashboard-section="alerts"');
    expect(at, 'the banner').toBeGreaterThan(-1);
    expect(text(html)).toContain('1 فاتورة ملاكي بانتظار الفاتورة — أقدمها من 4 أيام');
    // Above the empty ledger, which still says nothing matched.
    expect(html.indexOf(ar('fleet.violations.report.empty'))).toBeGreaterThan(at);
    // Nothing to warn about: the empty ledger alone.
    const quiet = draw(
      <CustodyDashboardContent
        view="empty"
        data={{ ...dashboard, count: 0 }}
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(quiet).not.toContain('data-custody-dashboard-section="alerts"');
    expect(quiet).toContain(ar('fleet.custody.empty'));
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
    // «2 فواتير ملاكي» is bold in the line's own slate-300 on the dark — only a car's code is
    // white, as the design sets them.
    const pending = classesOf(banner(), 'data-custody-pending-count="true"');
    expect(pending).toEqual(
      expect.arrayContaining(['font-bold', 'text-slate-900', 'dark:text-inherit']),
    );
    expect(pending).not.toContain('dark:text-white');
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
    expect(order).toEqual(['total', 'dealership', 'fuel', 'tyres', 'wash']);
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
      ['dealership', '850.00', '20%', '1 حركة'],
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
    expect(CUSTODY_KIND.dealership.accent).toContain('border-l-blue-600');
    expect(CUSTODY_KIND.dealership.accent).toContain('dark:border-l-blue-500');
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
        fuelByCompany: { ...dashboard.fuelByCompany, none: { amount: 0, count: 0, litres: 0 } },
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
    expect(marks.map((m) => m[1])).toEqual(['dealership', 'fuel', 'tyres', 'wash']);
    // Each bar against the axis's top (2,000 — the round step over the dearest BAR, 1,650.50):
    // 850 is 42.5%, 1,650.50 is 82.525%. Not stacked: no bar is the period's total.
    expect(Number(marks[0]?.[2])).toBeCloseTo(42.5, 3);
    expect(Number(marks[1]?.[2])).toBeCloseTo(82.525, 3);
    expect(custodyTicks(1650.5)).toEqual([0, 500, 1000, 1500, 2000]);
    // August: fuel only — the other three are stubs in their pale shade.
    const august = column(html, 0);
    expect([...august.matchAll(/data-custody-stub="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'dealership',
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
      'aria-label="2026/10: 4,020.50 ج.م.، التوكيل 850.00 ج.م. (21%)، وقود 1,650.50 ج.م. (41%)',
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
      ['dealership', '850.00', '21%'],
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
          dealership: 0,
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

describe('(4) «حسب النوع والمصدر» — two concentric rings', () => {
  const card = (onShow?: () => void, data = dashboard): string =>
    draw(<CustodyByKindSource data={data} onShowDealership={onShow} />);

  it('is titled without the stations — there is no station data', () => {
    const html = card();
    expect(text(html)).toContain('حسب النوع والمصدر');
    expect(html).not.toContain('محطات');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.donut.chip'));
  });

  it('rings the kinds outside, the sources inside, the total in the middle — each theme its shades', () => {
    const html = card();
    const arcs = [
      ...html.matchAll(/data-custody-arc="(\w+)"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/gu),
    ];
    expect(arcs.map((m) => m[1])).toEqual([...CUSTODY_KINDS, 'receipt', 'dealershipInvoice']);
    // The outer ring's length is 402.12 (r 64), the inner one's 276.46 (r 44).
    expect(arcs[0]?.[3]).toBe('402.12');
    expect(arcs[4]?.[3]).toBe('276.46');
    // Fuel 45% of the ring, less the design's 4 between parts.
    expect(Number(arcs[1]?.[2])).toBeCloseTo((1965.5 / 4335.5) * 402.1239 - 4, 1);
    expect(html).toContain('stroke-[#e2e8f0] dark:stroke-[#162032]');
    expect(html).toContain('stroke-[#f1f5f9] dark:stroke-[#131b29]');
    expect(CUSTODY_KIND.dealership.stroke).toBe('stroke-[#2563eb] dark:stroke-[#3b82f6]');
    expect(CUSTODY_KIND.tyres.stroke).toBe('stroke-[#e11d48] dark:stroke-[#f43f5e]');
    expect(CUSTODY_KIND.wash.stroke).toBe('stroke-[#0891b2] dark:stroke-[#06b6d4]');
    expect(html).toContain('stroke-[#059669] dark:stroke-[#10b981]');
    const middle = html.indexOf('pointer-events-none absolute inset-0 flex flex-col');
    const centre = text(html.slice(middle, html.indexOf('data-custody-donut-legend')));
    expect(centre).toContain('المصروف 4,336 100%');
    expect(html).toMatch(
      /role="img" data-custody-donut="true" aria-label="التوكيل: 850\.00 ج\.م\. \(20%\)/u,
    );
  });

  it('writes the legend — fuel’s box with «شل أوت / وطنية» and the receipts with no company', () => {
    const html = card();
    const legend = html.slice(html.indexOf('data-custody-donut-legend'));
    expect(text(legend)).toContain('الحلقة الخارجية (النوع ومورّد الوقود) 4 فئات');
    const fuel = legend.slice(legend.indexOf('data-custody-legend-kind="fuel"'));
    expect(text(fuel.slice(0, fuel.indexOf('data-custody-legend-kind="tyres"')))).toContain(
      'وقود (شل أوت / وطنية) 45% (1,966 ج.م.)',
    );
    expect(text(fuel)).toContain('⛽ شل أوت: 0 (0%)');
    expect(text(fuel)).toContain('⛽ وطنية: 500 (25%)');
    expect(text(fuel)).toContain('بدون شركة: 1,466 (75%)');
    expect(fuel).toContain('border-amber-200 bg-amber-50/70');
    expect(text(legend)).toContain('الحلقة الداخلية (المصدر) مصدران');
    expect(text(legend)).toContain('خصم إيصالات 80% (5 حركات)');
    expect(text(legend)).toContain('التوكيل ملاكي 20% (1 حركة)');
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

  it('names the fuel suppliers in its footer and offers «عرض حركات التوكيل» when the board can', () => {
    const html = card(() => undefined);
    const footer = html.slice(html.indexOf('data-custody-suppliers="true"'));
    expect(text(footer.slice(0, footer.indexOf('<button')))).toContain(
      'مورّدو الوقود: شل أوت (0%) • وطنية (25%) • بدون شركة (75%)',
    );
    expect(html).toContain('data-custody-show-dealership="true"');
    expect(text(html)).toContain('عرض حركات التوكيل');
    expect(card()).not.toContain('data-custody-show-dealership');
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
    expect(text(html)).toContain('توكيل');
    const car63 = html.slice(
      html.indexOf('data-custody-car="63"'),
      html.indexOf('data-custody-car="204"'),
    );
    const widths = [...car63.matchAll(/data-custody-mark="(\w+)"[^>]*style="width:([\d.]+)%"/gu)];
    expect(widths.map((m) => m[1])).toEqual(['dealership', 'tyres']);
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
    // The ring's arc is the driver's share of the receipts (3,485.50), never of the whole fund.
    const drivers = draw(<CustodyTopDrivers data={dashboard} />);
    expect(drivers).toMatch(/data-custody-ring="0"[^>]*stroke-dasharray="54\.51, 100"/u);
    const first = drivers.slice(
      drivers.indexOf('data-custody-driver="0"'),
      drivers.indexOf('data-custody-driver="1"'),
    );
    expect(first).toMatch(pct('55%'));
    expect(first).not.toMatch(pct('44%'));
    expect(custodyReceipts(dashboard), 'fuel + tyres + washing').toBe(3485.5);
    // The two biggest kinds of his own total, dearest first.
    expect(custodyTopKinds(dashboard.drivers[0]!)).toEqual(['tyres', 'fuel']);
    expect(text(first)).toContain('كاوتش 74% • وقود 26%');
    expect(first).toContain('text-rose-700 dark:text-rose-400');
    // The receipts with no driver, under the rings.
    const none = drivers.slice(drivers.indexOf('data-custody-no-driver="true"'));
    expect(text(none)).toContain('إيصالات بدون سائق محدد (1) 120.00 ج.م.');
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

  it('puts diesel first and lifts it out — «⭐ سولار (الأولوية الأولى)» with the companies it names', () => {
    const html = draw(<CustodyFuelBreakdown data={dashboard} />);
    expect(text(html)).toContain('تفصيل استهلاك الوقود');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.fuelNote'));
    const types = [...html.matchAll(/data-custody-fuel-type="(\w+)"/gu)].map((m) => m[1]);
    expect(types).toEqual(['diesel', 'petrol80', 'none']);
    const diesel = html.slice(
      html.indexOf('data-custody-fuel-type="diesel"'),
      html.indexOf('data-custody-fuel-type="petrol80"'),
    );
    expect(text(diesel)).toContain('⭐ سولار (الأولوية الأولى - وطنية)');
    // The light map writes the companies in the title; the dark design only on the chip.
    expect(diesel).toContain('<span class="dark:hidden"> - وطنية</span>');
    expect(diesel).toMatch(
      /data-custody-fuel-companies="true" class="[^"]*border-emerald-300 bg-emerald-100 text-emerald-800/u,
    );
    expect(text(diesel)).toContain('الكمية: 43.48 لتر');
    // 500 of the fuel's 1,965.50.
    expect(text(diesel)).toContain('1 حركة (25%)');
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
    // A type no receipt named a company for: no chip, nothing guessed.
    const petrol = html.slice(
      html.indexOf('data-custody-fuel-type="petrol80"'),
      html.indexOf('data-custody-fuel-type="none"'),
    );
    expect(petrol).not.toContain('data-custody-fuel-companies');
    // «بلا نوع محدد» and «بدون شركة» on lines of their own.
    expect(text(html)).toContain('بلا نوع محدد 1,150.50 ج.م. (1 حركة)');
    expect(text(html)).toContain('بدون شركة 1,465.50 ج.م. (2 حركات)');
    // «شل أوت + وطنية» where both companies fuelled a type.
    const both = draw(
      <CustodyFuelBreakdown
        data={{
          ...dashboard,
          fuelTypes: [
            {
              fuelType: 'petrol92',
              count: 2,
              amount: 600,
              litres: 30,
              companies: ['wataniya', 'chillout'],
            },
          ],
        }}
      />,
    );
    expect(text(both)).toContain('شل أوت + وطنية');
  });

  it('«شيلهم» — the station panel is gone, and so are the station words', () => {
    const html = body();
    expect(html).not.toContain('توزيع محطات التزويد');
    expect(html).not.toContain('محطات');
    expect(html).not.toContain('والمحطات');
    for (const key of ['byKindSource', 'fuelTitle', 'fuelNote', 'donut.outer']) {
      expect(ar(`fleet.custody.dashboard.${key}`), key).not.toContain('محطات');
    }
    expect(draw(<CustodyFuelBreakdown data={{ ...dashboard, fuelTypes: [] }} />)).toContain(
      'data-custody-no-fuel="true"',
    );
  });
});

describe('(8) «ملخص لكل سيارة» — search, funnel, sticky head and «الإجمالي الختامي»', () => {
  it('lists every car dearest first, each kind, its total and its share with ONE decimal', () => {
    const html = draw(<CustodyPerCar data={dashboard} />);
    expect([...html.matchAll(/data-custody-car-row="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '63',
      '204',
      '160',
    ]);
    const car63 = html.slice(html.indexOf('data-custody-car-row="63"'));
    expect(text(car63.slice(0, car63.indexOf('</tr>')))).toBe(
      '63 850.00 ج.م. — 1,400.00 ج.م. — 2,250.00 ج.م. 51.9%',
    );
    expect(custodyShare1(2250, 4335.5)).toBe('51.9%');
    expect(custodyShare1(315, 4335.5)).toBe('7.3%');
    expect(custodyShare1(1, 10000)).toBe('<0.1%');
    expect(custodyShare1(9999.5, 10000)).toBe('>99.9%');
    expect(custodyShare1(5, 0)).toBe('—');
    expect(text(html)).toContain('3 سيارات مسجلة');
    // The kinds in their ink; an empty kind the grey dash.
    expect(car63).toContain(CUSTODY_KIND.dealership.text);
    expect(car63).toContain('text-slate-400 dark:text-slate-500');
  });

  it('holds its head and «الإجمالي الختامي» in place inside a 480px scroller — in both themes', () => {
    const html = draw(<CustodyPerCar data={dashboard} />);
    expect(html).toContain('max-h-[480px] overflow-auto');
    const head = classesOf(html, '<thead');
    expect(head).toEqual(
      expect.arrayContaining(['sticky', 'top-0', 'bg-slate-100', 'font-bold', 'dark:bg-[#0c1322]']),
    );
    const foot = classesOf(html, 'data-custody-dashboard-grand-total="true"');
    expect(foot).toEqual(
      expect.arrayContaining(['sticky', 'bottom-0', 'bg-slate-100', 'dark:bg-[#090e18]']),
    );
    // The table collapses its borders, and a collapsed border is painted where the row would sit
    // unstuck — a border on the head or the foot is gone exactly while it is held in place. So
    // neither carries one: the rules are inset shadows on their cells, which move with them.
    for (const group of [head, foot]) {
      expect(group.filter((c) => /^(?:dark:)?border-/u.test(c))).toEqual([]);
    }
    const thead = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const heads = [...thead.matchAll(/<th [^>]*class="([^"]*)"/gu)].map((m) => m[1] ?? '');
    expect(heads).toHaveLength(7);
    for (const cls of heads) {
      expect(cls.split(' ')).toEqual(
        expect.arrayContaining([
          'shadow-[inset_0_-1px_0_#cbd5e1,0_1px_2px_0_rgba(0,0,0,.05)]',
          'dark:shadow-[inset_0_-1px_0_#233552]',
        ]),
      );
    }
    const total = html.slice(html.indexOf('data-custody-dashboard-grand-total="true"'));
    const feet = [...total.matchAll(/<td [^>]*class="([^"]*)"/gu)].map((m) => m[1] ?? '');
    expect(feet).toHaveLength(7);
    // The design's 2px emerald-500 rule over every cell of «الإجمالي الختامي».
    for (const cls of feet) expect(cls).toMatch(/(?:^| )shadow-\[inset_0_2px_0_#10b981[\],]/u);
    // The grand total keeps its own edges: emerald-200 sides light, the faint line dark.
    expect(feet[5]?.split(' ')).toEqual(
      expect.arrayContaining([
        'shadow-[inset_0_2px_0_#10b981,inset_1px_0_0_#a7f3d0,inset_-1px_0_0_#a7f3d0]',
        'dark:shadow-[inset_0_2px_0_#10b981,inset_0_3px_0_rgba(16,185,129,0.3)]',
      ]),
    );
    expect(text(total)).toBe(
      'الإجمالي الختامي 850.00 ج.م. 1,965.50 ج.م. 1,400.00 ج.م. 120.00 ج.م. 4,335.50 ج.م. 100%',
    );
    expect(total).toContain('bg-emerald-50 p-4 font-black text-emerald-800');
    expect(total).toContain('dark:bg-[#122238]');
  });

  it('finds a car by its code — Arabic-Indic digits too — and says so when none matches', () => {
    expect(custodyCarRows(dashboard.vehicles, '٦٣', []).map((car) => car.vehicleCode)).toEqual([
      '63',
    ]);
    expect(custodyCarRows(dashboard.vehicles, ' 20 ', []).map((car) => car.vehicleCode)).toEqual([
      '204',
    ]);
    const searched = draw(<CustodyPerCar data={dashboard} initialSearch="160" />);
    expect([...searched.matchAll(/data-custody-car-row="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '160',
    ]);
    const none = draw(<CustodyPerCar data={dashboard} initialSearch="999" />);
    expect(none).toContain('data-custody-car-none="true"');
    expect(none).toContain(ar('fleet.custody.dashboard.perCar.noMatch'));
    // The grand total stays the whole fund's.
    expect(none).toContain('4,335.50');
    expect(searched).toContain(`placeholder="${ar('fleet.custody.dashboard.perCar.search')}"`);
  });

  it('keeps only the cars with a chosen kind through its funnel menu', () => {
    expect(custodyCarRows(dashboard.vehicles, '', ['wash']).map((car) => car.vehicleCode)).toEqual([
      '204',
    ]);
    expect(
      custodyCarRows(dashboard.vehicles, '', ['dealership', 'wash']).map((car) => car.vehicleCode),
    ).toEqual(['63', '204']);
    const closed = draw(<CustodyPerCar data={dashboard} />);
    expect(closed).not.toContain('data-custody-car-menu');
    // A disclosure: it says whether its list is open — no «menu» it does not have, no «pressed»
    // on top of «expanded»; the kinds it keeps are in its name.
    const funnel = (html: string): string => {
      const at = html.indexOf('data-custody-car-kinds="true"');
      return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at));
    };
    expect(funnel(closed)).toContain('aria-expanded="false"');
    expect(funnel(closed)).toContain(
      `aria-label="${ar('fleet.custody.dashboard.perCar.kindsButton')}"`,
    );
    for (const html of [closed]) {
      expect(funnel(html)).not.toContain('aria-haspopup');
      expect(funnel(html)).not.toContain('aria-pressed');
      expect(funnel(html)).not.toContain('aria-controls');
    }
    const open = draw(<CustodyPerCar data={dashboard} initialMenu initialKinds={['tyres']} />);
    expect(funnel(open)).toContain('aria-expanded="true"');
    expect(funnel(open)).not.toContain('aria-haspopup');
    expect(funnel(open)).not.toContain('aria-pressed');
    const controls = /aria-controls="([^"]+)"/u.exec(funnel(open))?.[1];
    expect(open).toContain(`id="${controls ?? '?'}" role="group"`);
    expect(funnel(open)).toContain(
      `aria-label="${ar('fleet.custody.dashboard.perCar.kindsButtonActive', {
        kinds: ar('fleet.custody.source.tyres'),
      })}"`,
    );
    // Escape folds the list, not the dashboard — wherever the focus is when it is pressed. Right
    // after the funnel opens it the focus is still on the funnel, outside the list: the key is
    // caught around BOTH, and only while the list is open.
    const tools = open.indexOf('data-custody-car-tools="true"');
    expect(tools).toBeGreaterThan(-1);
    expect(open.indexOf('data-custody-car-kinds="true"')).toBeGreaterThan(tools);
    expect(open.indexOf('data-custody-car-menu="true"')).toBeGreaterThan(
      open.indexOf('data-custody-car-kinds="true"'),
    );
    expect(open.indexOf('<table')).toBeGreaterThan(open.indexOf('data-custody-car-menu="true"'));
    const wrapper = TABLES.slice(TABLES.indexOf('ref={menuRef}'));
    const handler = wrapper.slice(0, wrapper.indexOf('<input'));
    expect(handler).toContain('onKeyDown');
    expect(handler).toContain("if (!menu || e.key !== 'Escape') return;");
    expect(handler).toContain('e.preventDefault();');
    const list = TABLES.slice(TABLES.indexOf('id={menuId}'));
    expect(list.slice(0, list.indexOf('>'))).not.toContain('onKeyDown');
    const menu = open.slice(open.indexOf('data-custody-car-menu="true"'));
    expect([...menu.matchAll(/data-custody-car-kind="(\w+)"/gu)].map((m) => m[1])).toEqual([
      ...CUSTODY_KINDS,
    ]);
    expect(menu).toMatch(/data-custody-car-kind="tyres"[^>]*checked=""/u);
    expect(menu).not.toMatch(/data-custody-car-kind="wash"[^>]*checked=""/u);
    expect(text(menu)).toContain(ar('fleet.custody.dashboard.perCar.allCars'));
    expect([...open.matchAll(/data-custody-car-row="(\d+)"/gu)].map((m) => m[1])).toEqual(['63']);
    // A chosen kind presses the funnel in emerald.
    expect(classesOf(open, 'data-custody-car-kinds="true"')).toEqual(
      expect.arrayContaining(['bg-emerald-600', 'text-white']),
    );
  });
});

describe('(9) «سجل كل الحركات» — the board’s movements, its own pages', () => {
  const log = (
    page = 1,
    pageSize = 25,
    onAdvanced?: () => void,
    filters: CustodyDashboardFilters = {},
  ): string => {
    const qc = client();
    qc.setQueryData(logKey(filters, page, pageSize), logPage(page, pageSize));
    return mount(
      qc,
      <CustodyLog
        filters={filters}
        initialPage={page}
        initialPageSize={pageSize}
        onAdvancedFilter={onAdvanced}
      />,
    );
  };
  const row = (html: string, id: string): string => {
    const at = html.indexOf(`data-custody-log-row="${id}"`);
    return html.slice(at, html.indexOf('</tr>', at));
  };

  it('asks `/movements` with the board’s filters and the log’s own page and size', () => {
    const hook = QUERIES.slice(QUERIES.indexOf('export const useCustodyLog'));
    expect(hook).toContain("listKey(MODULE, 'custody', { log: true, ...filters, page, pageSize })");
    expect(hook).toContain('api.listCustodyMovements({ ...filters, page, pageSize })');
    expect(TABLES).toContain('useCustodyLog({ ...filters }, page, pageSize)');
    const filtered = log(1, 25, undefined, { from: '2026-10-01', driver: 'إبراهيم' });
    expect(filtered).toContain('data-custody-log-row="f1"');
  });

  it('wears a badge per kind — fuel its type and company, a wash only «غسيل», a bill its work', () => {
    const html = log();
    expect(text(row(html, 'f1'))).toBe(
      '2026/10/05 150 وقود (بنزين 92) شل أوت (ChillOut) إبراهيم جميل رمضان داود خصم الإيصالات 150.00 ج.م.',
    );
    expect(row(html, 'f1')).toContain('data-custody-company-badge="chillout"');
    expect(row(html, 'f1')).toContain('bg-amber-100 text-amber-900');
    expect(text(row(html, 'f2'))).toContain('وقود (سولار) وطنية (Wataniya)');
    expect(row(html, 'f2')).toContain('bg-emerald-100 text-emerald-900');
    // A fuel receipt with no type and no company: the kind alone, no badge invented.
    expect(text(row(html, 'f3'))).toContain('وقود إبراهيم');
    expect(row(html, 'f3')).not.toContain('data-custody-company-badge');
    // «شيلهم»: a wash is only «غسيل».
    expect(row(html, 'w1')).toMatch(
      /data-custody-kind="wash"[^>]*><span[^>]*><\/span>غسيل<\/span>/u,
    );
    expect(html).not.toContain('كيماوي');
    expect(text(row(html, 't1'))).toContain('كاوتش');
    const bill = row(html, 'd1');
    expect(text(bill)).toBe(
      '2026/10/05 150 التوكيل (صيانة) — التوكيل (ملاكي بلا رقم الفاتورة) 1,470.00 ج.م.',
    );
    expect(bill).toContain('font-bold text-blue-700 dark:font-medium dark:text-blue-300');
    for (const kind of CUSTODY_KINDS) {
      expect(html, kind).toContain(CUSTODY_KIND[kind].badge);
    }
    expect(custodyKindText(ar, logRows[3]!)).toBe('غسيل');
    expect(custodyKindText(ar, logRows[5]!)).toBe('التوكيل (صيانة)');
  });

  it('pages on its own — 25, 50 or 100 a page, the current page emerald', () => {
    const html = log();
    expect(text(html.slice(html.indexOf('data-custody-log-count')))).toContain('عرض 6 من أصل 60');
    expect(text(html.slice(html.indexOf('data-custody-log-range')))).toContain(
      'عرض 1 - 25 من أصل 60 حركة',
    );
    const sizes = html.slice(html.indexOf('data-custody-log-size'), html.indexOf('</select>'));
    expect([...sizes.matchAll(/<option value="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '25',
      '50',
      '100',
    ]);
    expect([...html.matchAll(/data-custody-log-page="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(classesOf(html, 'aria-current="page"')).toEqual(
      expect.arrayContaining(['bg-emerald-600', 'text-white']),
    );
    const second = log(2);
    expect(text(second.slice(second.indexOf('data-custody-log-range')))).toContain(
      'عرض 26 - 50 من أصل 60 حركة',
    );
    expect(second).toMatch(/aria-current="page" data-custody-log-page="2"/u);
    const fifty = log(1, 50);
    expect(text(fifty.slice(fifty.indexOf('data-custody-log-range')))).toContain(
      'عرض 1 - 50 من أصل 60 حركة',
    );
    expect([...fifty.matchAll(/data-custody-log-page="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '1',
      '2',
    ]);
  });

  it('offers «تصفية متقدمة» when the board can take it; shimmers while its page comes', () => {
    expect(log(1, 25, () => undefined)).toContain('data-custody-advanced-filter="true"');
    expect(log()).not.toContain('data-custody-advanced-filter');
    const waiting = draw(<CustodyLog filters={{}} />);
    expect(waiting).toContain('data-custody-log-loading="true"');
    // The log scrolls inside its card on a phone rather than squeezing its columns.
    expect(log()).toContain('min-w-[48rem]');
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
    for (const id of [
      'timeline',
      'byKindSource',
      'topCars',
      'topDrivers',
      'fuel',
      'perVehicle',
      'log',
    ]) {
      const cls = classesOf(html, `data-custody-dashboard-section="${id}"`);
      expect(cls, id).toEqual(expect.arrayContaining(['bg-white', 'dark:bg-transparent']));
    }
    // The two table cards wear the design's `shadow-2xl` on the dark INSTEAD of the card's own:
    // Tailwind writes an arbitrary shadow after `shadow-2xl`, so a card carrying both keeps the
    // shallow one and the 2xl never shows.
    for (const id of ['perVehicle', 'log']) {
      const cls = classesOf(html, `data-custody-dashboard-section="${id}"`);
      expect(cls, id).toContain('dark:shadow-2xl');
      expect(
        cls.filter((c) => c.startsWith('dark:shadow-[')),
        id,
      ).toEqual([]);
      // …and keep the card's hover shadow.
      expect(
        cls.some((c) => c.startsWith('dark:hover:shadow-[')),
        id,
      ).toBe(true);
    }
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
  it('writes every share as a whole per cent («<1%», «>99%»), or with one decimal in the per-car table', () => {
    const html = body({ ...dashboard, alerts: alerting });
    const shares = [...html.matchAll(/>([^<>]*%)</gu)];
    expect(shares.length).toBeGreaterThan(30);
    for (const m of shares) {
      const share = m[1] ?? '';
      expect(share).toMatch(/^(?:\d{1,3}%|\d{1,3}\.\d%|&lt;1%|&gt;99%|&lt;0\.1%|&gt;99\.9%)$/u);
      const tag = html.slice(html.lastIndexOf('<', m.index), (m.index ?? 0) + 1);
      expect(tag, `«${share}» sits in a left-to-right span`).toMatch(/^<span [^>]*dir="ltr"/u);
    }
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
      dealership: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      vehicles: dashboard.vehicles.map((car) => ({
        ...car,
        dealership: 0,
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
          dealership: 0,
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
        companies: dashboard.fuelByCompany.companies.map((row) => ({ ...row, amount: 0 })),
        none: { amount: 0, count: 0, litres: 0 },
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
    for (const noun of ['movement', 'day', 'car', 'privateBill']) {
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
  it('draws التوكيل blue, وقود amber, كاوتش rose, غسيل cyan — the design’s shade in each theme', () => {
    expect(CUSTODY_KIND.dealership.fill).toBe('bg-blue-600 dark:bg-blue-500');
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

  it('wears them on the board’s figures too — each kind’s edge and tile, the total emerald', () => {
    const html = draw(<CustodyFigures totals={dashboard} />);
    for (const kind of CUSTODY_KINDS) {
      const at = html.indexOf(`data-custody-figure="${kind}"`);
      const tile = html.slice(at, html.indexOf('</div></div>', at));
      expect(tile, kind).toContain(CUSTODY_KIND[kind].tile);
      expect(tile, kind).toContain(CUSTODY_KIND[kind].accent);
    }
    const total = html.slice(html.indexOf('data-custody-figure="total"'));
    expect(total).toContain('border-l-emerald-500');
    expect(total).toContain('bg-emerald-100 text-emerald-700');
    expect(html).not.toMatch(/NaN/u);
  });

  it('keeps the site’s purple out of the custody screen — and the colours to the custody files', () => {
    for (const [name, source] of [
      ['kinds', KINDS],
      ['figures', FIGURES],
      ['dashboard', DASHBOARD],
      ['page', PAGE],
    ] as const) {
      expect(source, name).not.toMatch(
        /\b(?:[a-z]+:)?(?:bg|text|border|ring)-(?:brand|purple|violet|indigo)-/u,
      );
    }
  });
});
