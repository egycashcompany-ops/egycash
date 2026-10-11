// «لوحة تحكم» on the custody board — «جمب الاحصائيات داش بورد تفتح ف الشاشه كلها زى موديل كل حاجة
// بالتفصيل» — proven against what it produces: the button beside «الإحصائيات», the modal over the
// whole screen asking the board's own filters, every section of the body drawn from the server's
// numbers in Latin digits with «ج.م.» apart, the three faces of the query, and the kinds' colours
// kept clear of the state and pressed colours. «والنسب باينه»: every place the money is split writes
// each part's share — on the figures, on the bar of the kinds (a sliver's above it), by each source,
// car and driver, in the readout of a stretch and in the fuel table — Latin, left to right.
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
  type FleetCustodySummaryDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { CustodyPage } from './CustodyPage';
import {
  CUSTODY_SHARE_INSIDE_MIN,
  CustodyDashboard,
  CustodyDashboardBody,
  CustodyDashboardContent,
  custodyDashboardView,
  custodyFilterChips,
  custodyFiltered,
  custodyTrapFocus,
  custodyPeriod,
  CustodyDriversTable,
  custodyReceipts,
  custodyShareFits,
  custodyTicks,
  type CustodyDashboardFilters,
} from '../components/CustodyDashboard';
import { CustodyFigures, custodyShare, custodySharePct } from '../components/CustodyFigures';
import { CUSTODY_KIND, CUSTODY_KINDS } from '../components/CustodyKinds';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'CustodyPage.tsx'), 'utf8');
const MODAL = readFileSync(join(HERE, '../components/CustodyDashboard.tsx'), 'utf8');
const KINDS = readFileSync(join(HERE, '../components/CustodyKinds.tsx'), 'utf8');
const FIGURES = readFileSync(join(HERE, '../components/CustodyFigures.tsx'), 'utf8');
const QUERIES = readFileSync(join(HERE, '../api/fleet-queries.ts'), 'utf8');
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
    { fuelType: 'petrol80', count: 1, amount: 315, litres: 20 },
    { fuelType: 'diesel', count: 1, amount: 500, litres: 43.48 },
    { fuelType: null, count: 1, amount: 1150.5, litres: 0 },
  ],
  litres: 63.48,
  litresMissing: 1,
};

const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  source: undefined,
  driver: undefined,
};

const body = (data: FleetCustodyDashboardDto = dashboard): string =>
  mount(client(), <CustodyDashboardBody data={data} />);

/** The markup of one section of the body. */
const section = (html: string, id: string): string => {
  const at = html.indexOf(`data-custody-dashboard-section="${id}"`);
  expect(at, `the «${id}» section`).toBeGreaterThan(-1);
  const next = html.indexOf('data-custody-dashboard-section=', at + 10);
  return html.slice(at, next === -1 ? undefined : next);
};

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
    expect(button).toContain(ar('fleet.custody.dashboard.open'));
    expect(ar('fleet.custody.dashboard.open')).toBe('لوحة تحكم');
    expect(html, 'closed on the way in').not.toContain('data-custody-dashboard="true"');
    // The very `filters` the figures read — never a second copy of them.
    expect(PAGE).toContain(
      '<CustodyDashboard open={dashOpen} onClose={() => setDashOpen(false)} filters={filters} />',
    );
    expect(PAGE).toContain('useCustodySummary(filters)');
    expect(MODAL).toContain('useCustodyDashboard({ ...filters }, open)');
  });

  it('opens over the whole screen — a labelled modal with ×, the filters written out, the body inside', () => {
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
    // The board's filters, as words.
    expect(shell).toContain(ar('fleet.custody.dashboard.filters.from', { date: '2026/10/01' }));
    expect(shell).toContain(ar('fleet.custody.dashboard.filters.to', { date: '2026/10/31' }));
    expect(shell).toContain(ar('fleet.custody.dashboard.filters.cars', { codes: '204، 63' }));
    expect(shell).toContain(ar('fleet.custody.dashboard.filters.driver', { name: 'رأفت' }));
    // The body scrolls inside the modal; dark and light both have their surface.
    expect(shell).toContain('overflow-y-auto');
    expect(shell).toContain('bg-slate-50 dark:bg-[#0b1120]');
    expect(html).toContain('data-custody-dashboard-body="true"');
    // Closed, nothing at all.
    expect(
      mount(client(), <CustodyDashboard open={false} onClose={() => undefined} filters={{}} />),
    ).toBe('');
  });

  it('closes on Escape and ×, keeps Tab inside, locks the page behind and gives the focus back', () => {
    expect(MODAL).toContain("if (e.key === 'Escape')");
    expect(MODAL).toContain("document.addEventListener('keydown', onKey)");
    expect(MODAL).toContain("document.removeEventListener('keydown', onKey)");
    expect(MODAL).toContain("if (e.key !== 'Tab') return;");
    // The focus that reached the page behind (a click on plain text, then Tab past the last stop
    // or Shift+Tab before the first) is pulled straight back in — measured in Chromium, it used
    // to land on the board's own buttons.
    expect(MODAL).toContain("document.addEventListener('focusin', onFocusIn)");
    expect(MODAL).toContain("document.removeEventListener('focusin', onFocusIn)");
    expect(MODAL).toContain('custodyTrapFocus<Element>({ back, active, first, last, inside })');
    expect(MODAL).toContain("document.body.style.overflow = 'hidden'");
    expect(MODAL).toContain('closeButton.current?.focus()');
    expect(MODAL).toContain('opener?.focus()');
    expect(MODAL).toContain('createPortal(');
    // Read only while open.
    expect(MODAL).toContain('useCustodyDashboard({ ...filters }, open)');
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
      custodyDashboardView({
        isPending: false,
        isError: false,
        data: { ...dashboard, count: 0 },
      }),
    ).toBe('empty');
    // A refetch that failed keeps the last answer on screen.
    expect(custodyDashboardView({ isPending: false, isError: true, data: dashboard })).toBe(
      'ready',
    );
    const face = (view: Parameters<typeof CustodyDashboardContent>[0]['view']): string =>
      mount(
        client(),
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
    const filteredEmpty = mount(
      client(),
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
    expect(face('ready')).toContain('data-custody-dashboard-body="true"');
  });

  it('draws every section of the spend — figures, kinds, time, cars, drivers, fuel, every car', () => {
    const html = body();
    const ids = [...html.matchAll(/data-custody-dashboard-section="(\w+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual([
      'figures',
      'byKind',
      'timeline',
      'topCars',
      'topDrivers',
      'fuel',
      'perVehicle',
    ]);
    // Latin digits throughout, money with «ج.م.» in a span of its own.
    expect(html, 'no Arabic-Indic digit anywhere').not.toMatch(/[٠-٩]/u);
    expect(html).toMatch(/>4,335\.50<\/span><span[^>]*>ج\.م\.<\/span>/u);
  });

  it('leads with the five figures, then how many movements, cars and litres', () => {
    const figures = section(body(), 'figures');
    const order = [...figures.matchAll(/data-custody-figure="(\w+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(['total', 'dealership', 'fuel', 'tyres', 'wash']);
    for (const value of ['4,335.50', '850.00', '1,965.50', '1,400.00', '120.00']) {
      expect(figures).toContain(value);
    }
    expect(figures).toContain(ar('fleet.custody.dashboard.kpi.movements'));
    expect(figures).toMatch(/>6<\/span><span[^>]*>حركة<\/span>/u);
    expect(figures).toContain(ar('fleet.custody.dashboard.kpi.cars'));
    expect(figures).toMatch(/>3<\/span><span[^>]*>سيارة<\/span>/u);
    expect(figures).toMatch(/>63\.48<\/span><span[^>]*>لتر<\/span>/u);
    expect(figures).toContain(ar('fleet.custody.dashboard.litresMissing', { count: '1' }));
  });

  it('breaks the whole down by kind — one bar in the kinds’ colours, a legend table with the share', () => {
    const part = section(body(), 'byKind');
    const marks = [...part.matchAll(/data-custody-mark="(\w+)" class="([^"]*)"/gu)];
    // The bar of the whole, then the two screens' bars.
    const whole = marks.slice(0, 4);
    expect(whole.map((m) => m[1])).toEqual(['dealership', 'fuel', 'tyres', 'wash']);
    for (const [, kind, cls] of whole) {
      expect(cls).toContain(CUSTODY_KIND[kind as keyof typeof CUSTODY_KIND].fill);
    }
    const rows = [...part.matchAll(/data-custody-kind-row="(\w+)"/gu)].map((m) => m[1]);
    expect(rows).toEqual(['dealership', 'fuel', 'tyres', 'wash']);
    const fuel = part.slice(part.indexOf('data-custody-kind-row="fuel"'));
    const fuelRow = fuel.slice(0, fuel.indexOf('</tr>'));
    expect(fuelRow).toContain('1,965.50');
    expect(fuelRow).toContain('45%');
    expect(fuelRow).toMatch(/>3<\/td>/u);
    // «حسب المصدر»: the receipts screen and the dealership, with their counts and sums.
    const receipts = part.slice(part.indexOf('data-custody-source-row="receipt"'));
    expect(receipts.slice(0, receipts.indexOf('</li>'))).toContain('3,485.50');
    expect(receipts).toContain(ar('fleet.custody.from.receipt'));
    const bills = part.slice(part.indexOf('data-custody-source-row="dealershipInvoice"'));
    expect(bills.slice(0, bills.indexOf('</li>'))).toContain('850.00');
  });

  it('runs the spend over time left to right, stacked by kind, the latest stretch read out', () => {
    const part = section(body(), 'timeline');
    expect(part).toContain(ar('fleet.custody.dashboard.byMonth'));
    expect(part).toContain('dir="ltr"');
    expect(part).toContain('data-custody-legend="true"');
    const columns = [...part.matchAll(/data-custody-column="(\d+)"/gu)].map((m) => m[1]);
    expect(columns).toEqual(['0', '1', '2']);
    // One stop on the Tab path: the read-out column.
    expect(part.match(/tabindex="0"/gu)?.length).toBe(1);
    const readout = part.slice(part.indexOf('data-custody-readout="true"'));
    expect(readout.slice(0, readout.indexOf('data-custody-column'))).toContain('2026/10');
    expect(readout).toContain('4,020.50');
    // The dearest stretch carries its total on its cap; the empty month draws no mark.
    expect(part).toMatch(/data-custody-peak="true"[^>]*>4,021</u);
    const september = part.slice(
      part.indexOf('data-custody-column="1"'),
      part.indexOf('data-custody-column="2"'),
    );
    expect(september).not.toContain('data-custody-mark');
    // Each column's marks in the fixed kind order, its top one rounded.
    const october = part.slice(part.indexOf('data-custody-column="2"'));
    const marks = [...october.matchAll(/data-custody-mark="(\w+)" class="([^"]*)"/gu)];
    expect(marks.map((m) => m[1])).toEqual(['dealership', 'fuel', 'tyres', 'wash']);
    expect(marks[3]?.[2]).toContain('rounded-t-[4px]');
    // A table instead of the chart, one press away.
    expect(part).toContain('data-custody-view-toggle="timeline"');
    expect(part).toContain('aria-pressed="false"');
    // Each column says what it holds to a screen reader.
    expect(part).toContain('aria-label="2026/10: 4,020.50 ج.م.');
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
    const part = section(body(days), 'timeline');
    expect(part).toContain(ar('fleet.custody.dashboard.byDay'));
    expect(part.match(/data-custody-column="/gu)?.length).toBe(31);
    // The month under the first day; the axis never crams a label under every column.
    expect(part).toContain('2026/10');
  });

  it('ranks the cars by their spend, the code bold and left to right, stacked by kind', () => {
    const part = section(body(), 'topCars');
    const codes = [...part.matchAll(/dir="ltr" class="[^"]*font-bold[^"]*">(\d+)</gu)].map(
      (m) => m[1],
    );
    expect(codes).toEqual(['63', '204', '160']);
    expect(part).toContain('data-custody-legend="true"');
    expect(part).toContain(ar('fleet.custody.dashboard.topCount', { count: '3' }));
    // Car 63: its dealership and tyres, nothing else.
    const first = part.slice(part.indexOf('>63<'), part.indexOf('>204<'));
    expect([...first.matchAll(/data-custody-mark="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'dealership',
      'tyres',
    ]);
    expect(first).toContain('2,250.00');
    // Read aloud, a row says whose it is before what it cost.
    expect(part).toContain('aria-label="63: 2,250.00 ج.م.');
  });

  it('ranks the drivers by their receipts, whole names, and says what names none', () => {
    const part = section(body(), 'topDrivers');
    expect(part.indexOf('محمد رأفت عبد الله')).toBeLessThan(part.indexOf('سائق اللوحة'));
    expect(part).toContain('aria-label="محمد رأفت عبد الله: 1,900.00 ج.م.');
    expect(part).toContain('1,900.00');
    expect(part).not.toContain('data-custody-mark="dealership"');
    const none = part.slice(part.indexOf('data-custody-no-driver="true"'));
    expect(none).toContain(ar('fleet.custody.dashboard.noDriver'));
    expect(none).toContain('120.00');
    expect(part).toContain('data-custody-view-toggle="drivers"');
  });

  it('says so when no receipt names a driver — never an empty card titled «أعلى 0»', () => {
    const part = section(
      body({ ...dashboard, drivers: [], noDriver: { count: 0, amount: 0 } }),
      'topDrivers',
    );
    expect(part).toContain('data-custody-no-drivers="true"');
    expect(part).toContain(ar('fleet.custody.dashboard.noDrivers'));
    expect(part).not.toContain(ar('fleet.custody.dashboard.topCount', { count: '0' }));
    expect(part).not.toContain('data-custody-view-toggle="drivers"');
    expect(part).not.toContain('data-custody-legend="true"');
    // Receipts on no driver are still counted under it.
    const unnamed = section(
      body({ ...dashboard, drivers: [], noDriver: { count: 2, amount: 160 } }),
      'topDrivers',
    );
    expect(unnamed).toContain('data-custody-no-drivers="true"');
    expect(unnamed).toContain('data-custody-no-driver="true"');
    expect(unnamed).toContain('160.00');
  });

  it('reads out the fuel — the litres, each type, the receipts that name none', () => {
    const part = section(body(), 'fuel');
    expect(part).toContain('63.48');
    const types = [...part.matchAll(/data-custody-fuel-type="(\w+)"/gu)].map((m) => m[1]);
    expect(types).toEqual(['petrol80', 'diesel', 'none']);
    expect(part).toContain(ar('fleet.receipts.fuelType.petrol80'));
    expect(part).toContain(ar('fleet.custody.dashboard.noFuelType'));
    expect(part).toContain('43.48');
  });

  it('ends on every car with every kind, its total and share, and the grand total last', () => {
    const part = section(body(), 'perVehicle');
    expect(part).toContain(ar('fleet.custody.perVehicle'));
    expect(part.indexOf('>63<')).toBeLessThan(part.indexOf('>204<'));
    expect(part.indexOf('>204<')).toBeLessThan(part.indexOf('>160<'));
    const total = part.slice(part.indexOf('data-custody-dashboard-grand-total="true"'));
    expect(total.indexOf('>160<'), 'after every car').toBe(-1);
    for (const value of ['850.00', '1,965.50', '1,400.00', '120.00', '4,335.50', '100%']) {
      expect(total).toContain(value);
    }
    expect(part).toContain('52%');
  });
});

describe('«والنسب باينه» — every split of the money writes each part’s share', () => {
  /** A share as the board writes it: a span of its own, left to right, holding exactly `share`. */
  const pct = (share: string): RegExp =>
    new RegExp(`<span dir="ltr" data-custody-pct="true" class="[^"]*">${share}</span>`, 'u');
  /** One figure tile of `CustodyFigures`, as the board and the dashboard draw it. */
  const tile = (html: string, kind: string): string => {
    const at = html.indexOf(`data-custody-figure="${kind}"`);
    expect(at, kind).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('</div></div>', at));
  };
  const nothing: FleetCustodySummaryDto = {
    count: 0,
    total: 0,
    dealership: 0,
    fuel: 0,
    tyres: 0,
    wash: 0,
    vehicles: [],
  };

  it('(1) writes each kind’s share of the whole on its figure — none on the total, none of nothing', () => {
    expect(ar('fleet.custody.totals.ofTotal')).toBe('من الإجمالي');
    expect(translate('en', 'fleet.custody.totals.ofTotal')).toBe('of total');
    // The board's «الإحصائيات» and the dashboard's top row are the same five tiles.
    const board = mount(client(), <CustodyFigures totals={dashboard} />);
    const figures = section(body(), 'figures');
    for (const html of [board, figures]) {
      expect(tile(html, 'total')).not.toContain('%');
      expect(tile(html, 'total')).not.toContain(ar('fleet.custody.totals.ofTotal'));
      for (const [kind, share] of [
        ['dealership', '20%'],
        ['fuel', '45%'],
        ['tyres', '32%'],
        ['wash', '3%'],
      ] as const) {
        // «45% من الإجمالي»: the share first, on its chip, then the words.
        expect(tile(html, kind)).toMatch(
          new RegExp(
            `data-custody-figure-share="${kind}">${pct(share).source} ${ar('fleet.custody.totals.ofTotal')}</span>`,
            'u',
          ),
        );
      }
    }
    // Of nothing, no share at all — never «NaN%» nor «0%» under a zero.
    const empty = mount(client(), <CustodyFigures totals={nothing} />);
    // Every card fills its cell: five across, the total (no line under it) stops level with the
    // kinds' cards rather than 14px short of them.
    for (const html of [board, empty]) {
      for (const kind of ['total', ...CUSTODY_KINDS]) {
        const card = new RegExp(`data-custody-figure="${kind}"><div class="([^"]*)"`, 'u').exec(
          html,
        );
        expect((card?.[1] ?? '').split(' '), `${kind} fills its cell`).toContain('h-full');
      }
    }
    // «من الإجمالي» as bright as the label over it on a dark tile — slate-500 there is about 3.7:1.
    for (const kind of CUSTODY_KINDS) {
      const note = new RegExp(
        `<span class="([^"]*)"><span data-custody-figure-share="${kind}">`,
        'u',
      ).exec(board);
      expect((note?.[1] ?? '').split(' '), kind).toEqual(
        expect.arrayContaining(['text-slate-500', 'dark:text-slate-400']),
      );
    }
    expect(empty).not.toContain('data-custody-figure-share');
    expect(empty).not.toContain('%');
    expect(empty).not.toMatch(/NaN|Infinity/u);
    // A kind with nothing beside others that have something says so: 0%.
    const noWash = mount(
      client(),
      <CustodyFigures totals={{ ...dashboard, wash: 0, total: dashboard.total - 120 }} />,
    );
    expect(tile(noWash, 'wash')).toMatch(pct('0%'));
  });

  it('(2) writes each part’s share ON the 40px bar of the kinds, bold, in the kind’s own ink', () => {
    const part = section(body(), 'byKind');
    const bar = part.slice(part.indexOf('data-custody-kind-bar="true"'), part.indexOf('<table'));
    expect(bar).toContain('flex h-10 gap-0.5');
    // Still one picture read aloud, its shares in its label.
    expect(part).toMatch(/role="img" aria-label="[^"]*وقود: 1,965\.50 ج\.م\. \(45%\)/u);
    for (const [kind, share] of [
      ['dealership', '20%'],
      ['fuel', '45%'],
      ['tyres', '32%'],
    ] as const) {
      const label = new RegExp(
        `data-custody-mark="${kind}" class="[^"]*"[^>]*><span data-custody-share="${kind}" data-custody-share-at="inside" dir="ltr" class="([^"]*)">${share}</span>`,
        'u',
      ).exec(bar);
      expect(label, kind).not.toBeNull();
      expect(label?.[1], `${kind} in its ink`).toContain(CUSTODY_KIND[kind].ink);
      expect(label?.[1]).toContain('font-bold');
    }
    // Washing is 3% of the whole — too narrow for «3%» on a phone: it is written just above its
    // part, on the row of the bar's own parts, before the bar.
    expect(bar).toMatch(
      /data-custody-share="wash" data-custody-share-at="above"[^>]*><span[^>]*data-custody-swatch="wash"[^>]*><\/span><span dir="ltr" class="[^"]*">3%<\/span>/u,
    );
    expect(bar.indexOf('data-custody-kind-bar-above="true"')).toBeLessThan(
      bar.indexOf('data-custody-mark="dealership"'),
    );
    // Every kind on the bar shows its share, once.
    expect([...bar.matchAll(/data-custody-share="(\w+)"/gu)].map((m) => m[1]).sort()).toEqual(
      ['dealership', 'fuel', 'tyres', 'wash'].sort(),
    );
    // Nothing needs to go above: no row above.
    const wide = section(
      body({ ...dashboard, total: 3000, dealership: 1000, fuel: 1000, tyres: 500, wash: 500 }),
      'byKind',
    );
    expect(wide).not.toContain('data-custody-kind-bar-above');
    expect(wide.match(/data-custody-share-at="inside"/gu)?.length).toBe(4);
  });

  it('(2) gives every sliver its share above the bar — side by side, never one over another', () => {
    const narrow = { ...dashboard, total: 5100, dealership: 30, fuel: 5000, tyres: 40, wash: 30 };
    const part = section(body(narrow), 'byKind');
    const bar = part.slice(part.indexOf('data-custody-kind-bar="true"'), part.indexOf('<table'));
    expect(bar).toMatch(/data-custody-share="fuel" data-custody-share-at="inside"[^>]*>98%</u);
    for (const kind of ['dealership', 'tyres', 'wash']) {
      expect(bar, kind).toMatch(
        new RegExp(
          `data-custody-share="${kind}" data-custody-share-at="above"[^>]*><span[^>]*></span><span dir="ltr" class="[^"]*">&lt;1%</span>`,
          'u',
        ),
      );
    }
    // A sliver's cell is never narrower than its label, so neighbours cannot overlap.
    const above = bar.slice(0, bar.indexOf('flex h-10'));
    expect(above.match(/min-w-max/gu)?.length).toBe(3);
    // Every part — on the bar or over it — still says its share aloud.
    expect(part).toContain('التوكيل: 30.00 ج.م. (&lt;1%)');
  });

  it('never writes «100%» beside a «<1%» of the same whole — the top end is «>99%»', () => {
    const top = {
      ...dashboard,
      total: 10000,
      dealership: 9980,
      fuel: 0,
      tyres: 0,
      wash: 20,
    };
    const figures = mount(client(), <CustodyFigures totals={top} />);
    expect(tile(figures, 'dealership')).toMatch(pct('&gt;99%'));
    expect(tile(figures, 'wash')).toMatch(pct('&lt;1%'));
    const part = section(body(top), 'byKind');
    const bar = part.slice(part.indexOf('data-custody-kind-bar="true"'), part.indexOf('<table'));
    expect(bar).toMatch(
      /data-custody-share="dealership" data-custody-share-at="inside"[^>]*>&gt;99%</u,
    );
    expect(bar).toMatch(/data-custody-share="wash" data-custody-share-at="above"/u);
    expect(part).toContain('التوكيل: 9,980.00 ج.م. (&gt;99%)');
    // Neither the tiles nor the bar nor its table claims all of it for one kind.
    for (const html of [figures, section(body(top), 'figures'), part]) {
      expect(html).not.toMatch(/>100%</u);
    }
  });

  it('(3) writes each source’s share of the whole beside its sum', () => {
    const part = section(body(), 'byKind');
    for (const [ref, amount, share] of [
      ['receipt', '3,485.50', '80%'],
      ['dealershipInvoice', '850.00', '20%'],
    ] as const) {
      const at = part.indexOf(`data-custody-source-row="${ref}"`);
      const row = part.slice(at, part.indexOf('</li>', at));
      expect(row, ref).toMatch(pct(share));
      expect(row.indexOf(amount), 'the sum, then its share').toBeLessThan(row.search(pct(share)));
    }
  });

  it('(4) writes each car’s share of the whole, each driver’s of the receipts', () => {
    const cars = section(body(), 'topCars');
    for (const [code, share, next] of [
      ['63', '52%', '>204<'],
      ['204', '41%', '>160<'],
      ['160', '7%', '</ol>'],
    ] as const) {
      const row = cars.slice(cars.indexOf(`>${code}<`), cars.indexOf(next));
      expect(row, code).toMatch(pct(share));
    }
    expect(cars).toContain('aria-label="63: 2,250.00 ج.م. (52%)');
    // Drivers: of the receipts (3,485.50), never of the whole fund (4,335.50) — a dealership bill
    // names no driver. 1,900 is 55% of the receipts; of the whole it would read 44%.
    const drivers = section(body(), 'topDrivers');
    expect(drivers).toContain(ar('fleet.custody.dashboard.receiptsShare'));
    const first = drivers.slice(
      drivers.indexOf('محمد رأفت عبد الله'),
      drivers.indexOf('سائق اللوحة'),
    );
    expect(first).toMatch(pct('55%'));
    expect(first).not.toMatch(pct('44%'));
    expect(drivers).toContain('aria-label="محمد رأفت عبد الله: 1,900.00 ج.م. (55%)');
    const second = drivers.slice(
      drivers.indexOf('سائق اللوحة'),
      drivers.indexOf('data-custody-no-driver="true"'),
    );
    expect(second).toMatch(pct('42%'));
    // «إيصالات بدون سائق» on the same base: 55% + 42% + 3% — the whole of the receipts.
    const none = drivers.slice(drivers.indexOf('data-custody-no-driver="true"'));
    expect(none).toMatch(pct('3%'));
    expect(custodyReceipts(dashboard), 'fuel + tyres + washing').toBe(3485.5);
    expect(MODAL).toContain('<CustodyShare part={data.noDriver.amount} whole={receipts} pill />');
    // The table view («جدول») is the one `CustodyDriversTable`, drawn in (4) below.
    expect(MODAL).toContain(') : table ? (\n        <CustodyDriversTable data={data} />');
  });

  it('(4) gives the drivers’ «جدول» «النسبة» after the total — each driver’s share of the receipts', () => {
    const html = mount(client(), <CustodyDriversTable data={dashboard} />);
    /** A cell's words, its tags taken off. */
    const text = (cell: string): string => cell.replace(/<[^>]*>/gu, '').trim();
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const heads = [...head.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/gu)].map((m) =>
      text(m[1] ?? ''),
    );
    expect(heads).toEqual([
      ar('fleet.custody.dashboard.columns.driver'),
      ar('fleet.custody.source.fuel'),
      ar('fleet.custody.source.tyres'),
      ar('fleet.custody.source.wash'),
      ar('fleet.custody.dashboard.columns.total'),
      ar('fleet.custody.dashboard.columns.share'),
      ar('fleet.custody.dashboard.columns.count'),
    ]);
    const share = heads.indexOf(ar('fleet.custody.dashboard.columns.share'));
    const rows = [...html.matchAll(/<tr class="border-t[^"]*">(.*?)<\/tr>/gu)].map((m) =>
      [...(m[1] ?? '').matchAll(/<td[^>]*>(.*?)<\/td>/gu)].map((c) => c[1] ?? ''),
    );
    expect(rows).toHaveLength(dashboard.drivers.length);
    // 1,900 and 1,465.50 of the receipts' 3,485.50 — of the whole fund they would read 44% and 34%.
    for (const [i, [name, total, pctText]] of [
      ['محمد رأفت عبد الله', '1,900.00', '55%'],
      ['سائق اللوحة', '1,465.50', '42%'],
    ].entries()) {
      const row = rows[i] ?? [];
      expect(row, `${name}: a cell under every heading`).toHaveLength(heads.length);
      expect(text(row[0] ?? '')).toBe(name);
      expect(text(row[share - 1] ?? ''), `${name}: the total before the share`).toContain(total);
      expect(row[share], `${name}: the share under «النسبة»`).toMatch(pct(pctText ?? ''));
      expect(text(row[share + 1] ?? ''), `${name}: the movements after it`).toBe('2');
    }
  });

  it('(5) follows each kind’s sum in a stretch with its share of that stretch', () => {
    const part = section(body(), 'timeline');
    const readout = part.slice(
      part.indexOf('data-custody-readout="true"'),
      part.indexOf('data-custody-column'),
    );
    for (const [kind, amount, share] of [
      ['dealership', '850.00', '21%'],
      ['fuel', '1,650.50', '41%'],
      ['tyres', '1,400.00', '35%'],
      ['wash', '120.00', '3%'],
    ] as const) {
      const at = readout.indexOf(`data-custody-tip-row="${kind}"`);
      expect(at, kind).toBeGreaterThan(-1);
      const row = readout.slice(at, readout.indexOf('data-custody-tip-row', at + 1));
      expect(row, kind).toMatch(pct(share));
      expect(row.indexOf(`>${amount}<`), `${kind}: the sum, then its share`).toBeLessThan(
        row.search(pct(share)),
      );
    }
    // The column says the same aloud, and a ranked line's tip splits its own total the same way.
    expect(part).toContain('وقود 1,650.50 ج.م. (41%)');
    const cars = section(body(), 'topCars');
    const car63 = cars.slice(cars.indexOf('>63<'), cars.indexOf('>204<'));
    expect(car63.slice(car63.indexOf('data-custody-tip-row="dealership"'))).toMatch(pct('38%'));
    expect(car63.slice(car63.indexOf('data-custody-tip-row="tyres"'))).toMatch(pct('62%'));
  });

  it('(6) gives the fuel table «النسبة» — each type’s share of the fuel', () => {
    const part = section(body(), 'fuel');
    const head = part.slice(part.indexOf('<thead'), part.indexOf('</thead>'));
    const heads = [...head.matchAll(/<th scope="col"[^>]*>([^<]+)</gu)].map((m) => m[1]);
    expect(heads).toEqual([
      ar('fleet.custody.dashboard.columns.fuelType'),
      ar('fleet.custody.dashboard.columns.amount'),
      ar('fleet.custody.dashboard.columns.share'),
      ar('fleet.custody.dashboard.columns.litres'),
      ar('fleet.custody.dashboard.columns.count'),
    ]);
    // 315 + 500 + 1,150.50 = 1,965.50, the fuel the fund paid.
    for (const [type, share] of [
      ['petrol80', '16%'],
      ['diesel', '25%'],
      ['none', '59%'],
    ] as const) {
      const at = part.indexOf(`data-custody-fuel-type="${type}"`);
      expect(part.slice(at, part.indexOf('</tr>', at)), type).toMatch(pct(share));
    }
    const noTypes = section(body({ ...dashboard, fuelTypes: [] }), 'fuel');
    expect(noTypes, 'the empty line spans the new column too').toContain('colSpan="5"');
  });

  it('(7) writes every share in Latin digits, left to right, so «%» keeps its side in Arabic', () => {
    const html = body();
    const shares = [...html.matchAll(/>([^<>]*%)</gu)];
    expect(shares.length).toBeGreaterThan(30);
    for (const m of shares) {
      const text = m[1] ?? '';
      expect(text, 'a whole number of per cent, «<1%» or «>99%»').toMatch(
        /^(?:\d{1,3}%|&lt;1%|&gt;99%)$/u,
      );
      const tag = html.slice(html.lastIndexOf('<', m.index), (m.index ?? 0) + 1);
      expect(tag, `«${text}» sits in a left-to-right span`).toMatch(/^<span [^>]*dir="ltr"/u);
    }
    // The same in a sliver's «<1%».
    const narrow = body({
      ...dashboard,
      total: 5100,
      dealership: 30,
      fuel: 5000,
      tyres: 40,
      wash: 30,
    });
    expect(narrow).toMatch(/<span dir="ltr" class="[^"]*">&lt;1%<\/span>/u);
  });

  it('never writes «NaN%» when everything is zero — a dash, or nothing at all', () => {
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
    };
    const html = body(zero);
    expect(html).not.toMatch(/NaN|Infinity/u);
    expect(html).not.toContain('data-custody-figure-share');
    expect(html).not.toContain('data-custody-share=');
    // Of nothing, a share is a dash.
    expect(section(html, 'perVehicle')).toMatch(pct('—'));
    expect(section(html, 'topDrivers')).toMatch(pct('—'));
  });
});

describe('the dashboard’s arithmetic of drawing', () => {
  it('writes a share in whole per cent, «<1%» for a sliver, a dash of nothing', () => {
    expect(custodyShare(1965.5, 4335.5)).toBe('45%');
    expect(custodyShare(1, 1000)).toBe('<1%');
    expect(custodyShare(0, 1000)).toBe('0%');
    expect(custodyShare(5, 0)).toBe('—');
    // The top end mirrors the bottom: 9,980 of 10,000 is «>99%» beside the other 20's «<1%» —
    // never «100%» and «<1%» of one whole. All of it is 100%; 99% itself rounds as any other.
    expect(custodyShare(9980, 10000)).toBe('>99%');
    expect(custodyShare(20, 10000)).toBe('<1%');
    expect(custodyShare(9901, 10000)).toBe('>99%');
    expect(custodyShare(9900, 10000)).toBe('99%');
    expect(custodyShare(9890, 10000)).toBe('99%');
    expect(custodyShare(10000, 10000)).toBe('100%');
    // The number behind it, for the drawing to decide by: of nothing, 0 — never NaN.
    expect(custodySharePct(1965.5, 4335.5)).toBeCloseTo(45.335, 3);
    expect(custodySharePct(5, 0)).toBe(0);
    expect(custodySharePct(0, 0)).toBe(0);
  });

  it('writes a share on its part of the bar only where it fits — by the share and by the label', () => {
    expect(CUSTODY_SHARE_INSIDE_MIN).toBe(7);
    expect(custodyShareFits(45.33, '45%')).toBe(true);
    expect(custodyShareFits(100, '100%')).toBe(true);
    expect(custodyShareFits(99.8, '>99%')).toBe(true);
    expect(custodyShareFits(7, '7%')).toBe(true);
    // Under 7%, above the bar — however short its label.
    expect(custodyShareFits(6.99, '7%')).toBe(false);
    expect(custodyShareFits(2.77, '3%')).toBe(false);
    expect(custodyShareFits(0.5, '<1%')).toBe(false);
    // A label wider than its part goes above too, whatever the share.
    expect(custodyShareFits(8, '100.0%')).toBe(false);
  });

  it('steps the value axis in round numbers, the top at or over the dearest stretch', () => {
    expect(custodyTicks(0)).toEqual([0]);
    expect(custodyTicks(4020.5)).toEqual([0, 2000, 4000, 6000]);
    expect(custodyTicks(4000)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(custodyTicks(45)).toEqual([0, 20, 40, 60]);
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
    expect(trap(false, middle), 'inside, Tab moves as usual').toBeNull();
    expect(trap(true, middle)).toBeNull();
    expect(trap(false, last), 'Tab on the last stop rounds to the first').toBe(first);
    expect(trap(true, first), 'Shift+Tab on the first rounds to the last').toBe(last);
    expect(trap(false, first)).toBeNull();
    expect(trap(true, last)).toBeNull();
    // The page behind took it: back in at the end Tab was heading for.
    expect(trap(false, 'pageSize', false)).toBe(first);
    expect(trap(true, 'pageSize', false)).toBe(last);
    expect(trap(false, null, false)).toBe(first);
  });

  it('knows a filtered dashboard from an unfiltered one', () => {
    expect(custodyFiltered({})).toBe(false);
    expect(
      custodyFiltered({ from: '', to: undefined, vehicleCodes: [], source: [], driver: '' }),
    ).toBe(false);
    expect(custodyFiltered({ from: '2026-10-01' })).toBe(true);
    expect(custodyFiltered({ to: '2026-10-31' })).toBe(true);
    expect(custodyFiltered({ vehicleCodes: ['63'] })).toBe(true);
    expect(custodyFiltered({ source: ['wash'] })).toBe(true);
    expect(custodyFiltered({ driver: 'رأفت' })).toBe(true);
  });

  it('writes a period year first, as the board writes a date', () => {
    expect(custodyPeriod('2026-10')).toBe('2026/10');
    expect(custodyPeriod('2026-10-04')).toBe('2026/10/04');
  });

  it('writes the filters as words — a long list of cars as a count, nothing chosen as «بلا فلاتر»', () => {
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

describe('the kinds’ colours — «عاوز اغير لون النوع»', () => {
  it('gives every kind its own fill, and none of them a state’s or the pressed colour', () => {
    const fills = CUSTODY_KINDS.map((kind) => CUSTODY_KIND[kind].fill);
    expect(new Set(fills).size).toBe(4);
    // Green, amber and red are states; purple is what is pressed or picked. Teal reads as green,
    // pink and rose as red, orange and yellow as amber.
    const forbidden =
      /\b(?:[a-z]+:)?(?:bg|text|border|ring|fill|stroke)-(?:green|emerald|teal|lime|amber|yellow|orange|red|rose|pink|purple|violet|indigo|fuchsia|brand)-/u;
    for (const kind of CUSTODY_KINDS) {
      const { fill, ink } = CUSTODY_KIND[kind];
      expect(`${fill} ${ink}`, kind).not.toMatch(forbidden);
    }
    expect(KINDS, 'nowhere in the kinds’ file').not.toMatch(forbidden);
    expect(FIGURES, 'nor on the figures').not.toMatch(forbidden);
    // Each fill has its dark-theme step written out where the light one would not read.
    expect(CUSTODY_KIND.fuel.fill).toContain('dark:bg-');
    expect(CUSTODY_KIND.tyres.fill).toContain('dark:bg-');
    expect(CUSTODY_KIND.tyres.ink).toContain('dark:text-');
  });

  it('draws the dashboard’s marks only in the kinds’ colours — the brand only on what is pressed or focused', () => {
    const states =
      /\b(?:bg|text|border)-(?:green|emerald|teal|lime|amber|yellow|orange|red|rose|pink|purple|violet|indigo|fuchsia)-/u;
    expect(MODAL).not.toMatch(states);
    for (const line of MODAL.split('\n').filter((l) => l.includes('brand-'))) {
      expect(line, line.trim()).toMatch(/border-brand-500\/50 bg-brand-500\/15|ring-brand-500/u);
    }
  });
});
