// What the accidents board SHOWS — asserted as markup facts, from real renders. Rewritten on purpose
// for the owner-approved board (2026-11-09, «شكل تعديل الشاشه بتاعت الحوادث تمام»): the Fleet
// boards' toolbar, dark filter bar and table, the totals behind «الإحصائيات», the transfer line
// under «إجمالي المتبقي», and the car card on the code.
//
// This suite has no DOM, so nothing can be clicked and no effect runs. What it can prove is the
// part that has bitten before: that the row's colour is read from the persisted status and from
// nothing the screen remembers, that the figures are the SERVER's and not a sum of the page, and
// that the params the page asks for carry every filter in the URL — because a page that quietly
// dropped one would still render, just wrongly.
//
// What the server enforces — how the filters combine, what a code resolves to — is proven in
// `apps/api/src/modules/fleet/accidents/accident-filters.spec.ts`. The form is
// `accidents-form.spec.tsx`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetAccidentDto,
  type FleetAccidentTotalsDto,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { AccidentFigures, AccidentsPage } from './AccidentsPage';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'AccidentsPage.tsx'), 'utf8');
/** Comments name the bug they replaced, so a rule about the code reads the code alone. */
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const ar = (key: string): string => translate('ar', key);

/** The closed file's tint, restated on the row's `data-closed` over the boards' own hover. */
const CLOSED_TINT = 'bg-emerald-50/70';

const accident = (over: Partial<FleetAccidentDto> = {}): FleetAccidentDto => ({
  id: 'a-1',
  vehicleId: 'v-1',
  vehicleCode: null,
  occurredAt: '2026-03-09T00:00:00.000Z',
  culpritEmployeeId: null,
  culpritEmployeeIds: [],
  culprit: 'محمود محمد فهمى محمود',
  statement: 'فنوس شمال امامى',
  companyCost: 0,
  amountCollected: 1500,
  paidAmount: 1500,
  transferredIn: 0,
  transferredOut: 0,
  carHasTransfers: false,
  status: 'open',
  notes: null,
  version: 0,
  createdAt: '2026-03-09T00:00:00.000Z',
  updatedAt: '2026-03-09T00:00:00.000Z',
  ...over,
});

const vehicle = (id: string, code: string): FleetVehicleDto =>
  ({
    id,
    code,
    plateNumber: `س ص ${code}`,
    status: 'active',
    inWorkshop: false,
  }) as FleetVehicleDto;

const totals = (over: Partial<FleetAccidentTotalsDto> = {}): FleetAccidentTotalsDto => ({
  count: 1180,
  amountCollected: 87_835,
  companyCost: 174_710,
  paidAmount: 240_540,
  transferredIn: 0,
  transferredOut: 0,
  remaining: 22_005,
  ...over,
});

const me = (permissions: string[]): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
});

const paged = <T,>(items: T[], page = 1, pageSize = 25, totalItems = items.length) => ({
  items,
  meta: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
});

/** The params the page is expected to build for a given URL — the list key it will read. */
const listParams = (over: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 25,
  sortBy: 'occurredAt',
  sortDir: 'desc',
  // The whole order the reader clicked, beside the first column of it — see `lib/table-sort`.
  sort: 'occurredAt:desc',
  ...over,
});

const summaryParams = (over: Record<string, unknown> = {}) => ({ summary: true, ...over });

const VIEW_ALL = [
  'fleetAccident.view',
  'fleetAccident.close',
  'fleetAccident.edit',
  'fleetVehicle.view',
];

const makeStore = (locale: Locale, permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const render = ({
  locale = 'ar',
  permissions = VIEW_ALL,
  path = '/fleet/accidents',
  seed = () => undefined,
}: {
  locale?: Locale;
  permissions?: string[];
  path?: string;
  seed?: (qc: QueryClient) => void;
} = {}): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // The page reads the WHOLE registry (`useAllVehicles`) — every page, not the first 100 — and
  // only for a reader who may read it.
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: [vehicle('v-1', '150'), vehicle('v-2', '151')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={makeStore(locale, permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/accidents" element={<AccidentsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Seed one page of accidents plus its totals, under the keys the page will actually read. */
const withRows =
  (
    rows: FleetAccidentDto[],
    {
      list = {},
      summary = {},
      figures = totals(),
      meta,
    }: {
      list?: Record<string, unknown>;
      summary?: Record<string, unknown>;
      figures?: FleetAccidentTotalsDto;
      meta?: { page: number; pageSize: number; totalItems: number };
    } = {},
  ) =>
  (qc: QueryClient): void => {
    qc.setQueryData(
      listKey('fleet', 'accidents', listParams(list)),
      meta === undefined ? paged(rows) : paged(rows, meta.page, meta.pageSize, meta.totalItems),
    );
    qc.setQueryData(listKey('fleet', 'accidents', summaryParams(summary)), figures);
  };

/** The markup of one table row, found by a value it contains. */
const rowWith = (html: string, needle: string): string => {
  const found = html.split('<tr').find((row) => row.includes(needle));
  if (found === undefined) throw new Error(`no row containing ${needle}`);
  return found;
};
/** The `<td>` cells of a row, in order. */
const cellsOf = (row: string): string[] =>
  row
    .split('<td')
    .slice(1)
    .map((cell) => `<td${cell.slice(0, cell.indexOf('</td>'))}`);
/** What a piece of markup PRINTS — its text, not its markup. */
const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '');
const headersOf = (html: string): string[] => {
  const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
  return head
    .split(/<th(?=[\s>])/u)
    .slice(1)
    .map((th) => text(`<th${th.slice(0, th.indexOf('</th>'))}`).trim());
};
const toolbarOf = (html: string): string =>
  html.slice(html.indexOf('data-accidents-toolbar'), html.indexOf('data-accidents-filters'));
const barOf = (html: string): string =>
  html.slice(html.indexOf('data-accidents-filters'), html.indexOf('data-accidents-table'));

describe('the board opens on its toolbar — «زى باقى شاشات الحركة»', () => {
  it('has no page title: «N نتيجة», «الإحصائيات», the Excel pill and «تسجيل حادث»', () => {
    const html = render({
      permissions: [...VIEW_ALL, 'fleetAccident.create'],
      seed: withRows([accident()], { meta: { page: 1, pageSize: 25, totalItems: 1204 } }),
    });
    expect(html).not.toContain('<h1');
    const toolbar = toolbarOf(html);
    // Latin digits, grouped — every figure on the board; `formatNumber` would print «١٬٢٠٤».
    expect(text(toolbar)).toContain('1,204 نتيجة');
    expect(toolbar).toContain('data-accident-stats-toggle="true"');
    expect(toolbar).toContain(ar('fleet.vehicles.board.breakdown'));
    expect(toolbar).toContain('data-export="accidents"');
    expect(toolbar).toContain(ar('fleet.fuelCards.board.excel'));
    expect(toolbar).toContain('data-accident-new="true"');
    expect(toolbar).toContain(ar('fleet.accidents.record'));
    // The purple gradient of «تسجيل حادث», as on maintenance and receipts.
    expect(toolbar).toContain('bg-gradient-to-r from-brand-700 to-brand-500');
  });

  it('offers «تسجيل حادث» only to a reader who may record one', () => {
    expect(render({ seed: withRows([accident()]) })).not.toContain('data-accident-new');
  });

  it('keeps «الإحصائيات» CLOSED on the way in', () => {
    const html = render({ seed: withRows([accident()]) });
    expect(toolbarOf(html)).toContain('aria-expanded="false"');
    expect(html, 'no figures until it is opened').not.toContain('data-accident-figures');
    expect(PAGE_CODE).toContain('useState(false)');
    expect(PAGE_CODE).toContain(
      'statsOpen && summary.data !== undefined && <AccidentFigures totals={summary.data} />',
    );
  });

  it('offers no Excel when the list failed — the file behind it would be empty or short', () => {
    const failed = render({
      seed: (qc) => {
        // The list as TanStack holds it after a failed fetch: no data, an error, nothing running —
        // and not retried just because the page drew again.
        qc.setQueryDefaults(listKey('fleet', 'accidents', listParams()), { retryOnMount: false });
        qc.getQueryCache()
          .build(qc, { queryKey: listKey('fleet', 'accidents', listParams()) })
          .setState({ status: 'error', error: new Error('down'), fetchStatus: 'idle' });
      },
    });
    expect(failed).not.toContain('data-export="accidents"');
    expect(failed, 'and no rows').not.toContain('data-transfer-log-open');
    expect(render({ seed: withRows([accident()]) })).toContain('data-export="accidents"');
  });
});

describe('the columns the reader asked for, in the boards’ order', () => {
  it('runs التاريخ → كود السيارة → المتسبب → البيان → المحصل → الشركة → المدفوع → المتبقي → السجل → ملاحظات', () => {
    const html = render({ seed: withRows([accident()]) });
    expect(headersOf(html)).toEqual([
      'تاريخ الحادث',
      'كود السيارة',
      'المتسبب',
      'بيان الحادث',
      'المبلغ المحصَّل',
      'تكلفة الشركة',
      'المبلغ المدفوع',
      'إجمالي المتبقي',
      // «يتحط زرار فى كل صف يكون قبل الملاحظات» — the car's transfer log.
      'السجل',
      'ملاحظات',
      'إجراءات',
    ]);
  });

  it('writes the date year first, in Latin digits', () => {
    const cells = cellsOf(rowWith(render({ seed: withRows([accident()]) }), 'فنوس شمال'));
    expect(text(cells[0] ?? '')).toBe('2026/03/09');
  });

  it('shows NO status column — the state is the colour, the action and a word for screen readers', () => {
    const html = render({ seed: withRows([accident({ status: 'closed' })]) });
    expect(headersOf(html)).not.toContain('الحالة');
    const code = cellsOf(rowWith(html, 'فنوس شمال'))[1] ?? '';
    expect(code, 'the code cell').toContain('150');
    expect(code, 'carries the state for a reader the colour misses').toContain('sr-only');
    expect(code).toContain('مغلق');
  });

  it('numbers no rows — the serial column and its page offset went together', () => {
    const html = render({
      path: '/fleet/accidents?page=3',
      seed: withRows([accident(), accident({ id: 'a-2', statement: 'فنوس خلفى' })], {
        list: { page: 3 },
        meta: { page: 3, pageSize: 25, totalItems: 180 },
      }),
    });
    expect(rowWith(html, 'فنوس شمال')).not.toContain('>51<');
    expect(PAGE_CODE).not.toContain('serialOffset');
    expect(PAGE_CODE).not.toContain('fleet.accidents.columns.serial');
  });

  it('keeps the culprit’s driver card — «زى اما اقف على اسم السواق»', () => {
    expect(PAGE_CODE).toContain('<CulpritCell accident={r} />');
    expect(PAGE_CODE).toContain('<DriverHoverText');
  });
});

describe('the car card on the code — «عاوز لما اماوس يقف على كود عربيه يجيب بيانات»', () => {
  it('hangs on the code of a registry car, for a reader who may read the registry', () => {
    const code = cellsOf(rowWith(render({ seed: withRows([accident()]) }), 'فنوس شمال'))[1] ?? '';
    expect(code).toContain('data-vehicle-hover="true"');
  });

  it('gives a file kept from the old book with no registry car no card', () => {
    const html = render({
      seed: withRows([accident({ vehicleId: null, vehicleCode: 'OLD-1' })]),
    });
    const code = cellsOf(rowWith(html, 'فنوس شمال'))[1] ?? '';
    expect(text(code)).toContain('OLD-1');
    expect(code).not.toContain('data-vehicle-hover');
  });

  it('is not offered without fleetVehicle.view — and the whole registry is not read for them', () => {
    const html = render({
      permissions: ['fleetAccident.view'],
      seed: withRows([accident({ vehicleCode: '150' })]),
    });
    const code = cellsOf(rowWith(html, 'فنوس شمال'))[1] ?? '';
    expect(text(code)).toContain('150');
    expect(code).not.toContain('data-vehicle-hover');
    expect(PAGE_CODE).toContain("useAllVehicles({ anyStatus: true }, can('fleetVehicle.view'))");
  });

  it('uses the shared card, keyed by the row’s car id', () => {
    expect(PAGE_CODE).toMatch(/<VehicleHoverCode\s+vehicleId=\{r\.vehicleId\}/u);
  });
});

describe('إجمالي المتبقي — derived on the row', () => {
  it('is collected + company − paid', () => {
    const html = render({
      seed: withRows([accident({ amountCollected: 400, companyCost: 500, paidAmount: 200 })]),
    });
    // Money renders in Latin digits even in Arabic, to two places.
    expect(rowWith(html, 'فنوس شمال')).toContain('700.00');
  });

  it('prints a wash as 0 and NEVER as a negative zero', () => {
    for (const row of [
      accident({ amountCollected: 0, companyCost: 0, paidAmount: 0 }),
      accident({ amountCollected: 0.1, companyCost: 0.2, paidAmount: 0.3 }),
      accident({ amountCollected: 1500, companyCost: 0, paidAmount: 1500 }),
    ]) {
      const cells = cellsOf(rowWith(render({ seed: withRows([row]) }), 'فنوس شمال'));
      const remaining = text(cells[7] ?? '');
      expect(remaining, JSON.stringify(row)).toContain('0.00');
      expect(remaining).not.toMatch(/[-−]0/u);
    }
  });

  it('shows an overpayment as a red «−150.00», the minus in front of the figure', () => {
    const html = render({
      seed: withRows([accident({ amountCollected: 100, companyCost: 0, paidAmount: 250 })]),
    });
    const remaining = cellsOf(rowWith(html, 'فنوس شمال'))[7] ?? '';
    expect(remaining).toContain('data-negative="true"');
    expect(remaining).toContain('dir="ltr"');
    expect(text(remaining)).toContain('−150.00');
    expect(remaining).toContain('text-red-600');
  });

  it('counts what the file took and gave, and says so under the figure', () => {
    // 400 + 500 − 200, plus 1,500 taken from another car, less 300 another file took from it.
    const html = render({
      seed: withRows([
        accident({
          amountCollected: 400,
          companyCost: 500,
          paidAmount: 200,
          transferredIn: 1500,
          transferredOut: 300,
        }),
      ]),
    });
    const remaining = cellsOf(rowWith(html, 'فنوس شمال'))[7] ?? '';
    expect(text(remaining)).toContain('1,900.00');
    expect(remaining).toContain('data-transfer-line="in"');
    expect(remaining).toContain('data-transfer-line="out"');
    expect(text(remaining)).toContain(`${ar('fleet.accidents.transferLine.in')}+1,500.00`);
    expect(text(remaining)).toContain(`${ar('fleet.accidents.transferLine.out')}−300.00`);
    expect(ar('fleet.accidents.transferLine.in')).toBe('تحويل وارد');
    expect(ar('fleet.accidents.transferLine.out')).toBe('تحويل صادر');
  });

  it('prints no transfer line on a file that moved nothing', () => {
    const html = render({ seed: withRows([accident()]) });
    expect(rowWith(html, 'فنوس شمال')).not.toContain('data-transfer-line');
  });
});

describe('the figures behind «الإحصائيات» are the SERVER’s', () => {
  const figures = (over: Partial<FleetAccidentTotalsDto> = {}): string =>
    renderToStaticMarkup(
      <Provider store={makeStore('ar', VIEW_ALL)}>
        <AccidentFigures totals={totals(over)} />
      </Provider>,
    );

  it('shows the five sums the server sent, the count in Latin digits', () => {
    const html = figures();
    for (const value of ['1,180', '87,835.00', '174,710.00', '240,540.00', '22,005.00']) {
      expect(html).toContain(value);
    }
    for (const key of ['count', 'amountCollected', 'companyCost', 'paidAmount', 'remaining']) {
      expect(html).toContain(ar(`fleet.accidents.totals.${key}`));
    }
  });

  it('names them in formal spelling — the hamza, and the column’s own shadda', () => {
    expect(ar('fleet.accidents.totals.amountCollected')).toBe('إجمالي المبلغ المحصَّل');
    expect(ar('fleet.accidents.totals.companyCost')).toBe('إجمالي حساب الشركة');
    expect(ar('fleet.accidents.totals.remaining')).toBe('إجمالي المتبقي');
  });

  it('writes a negative remaining «−11,287.50» in red, isolated left to right', () => {
    const html = figures({ remaining: -11_287.5 });
    const tile = html.slice(html.indexOf('data-accident-figure="remaining"'));
    expect(tile).toContain('⁦−11,287.50⁩');
    expect(tile, 'the red wins over the chip’s own colour').toContain('!text-red-600');
    expect(tile).not.toContain('11,287.50−');
  });

  it('asks for them by the filters alone — paging cannot reach them', () => {
    expect(PAGE_CODE).toContain('const summary = useAccidentSummary(filters);');
  });
});

describe('the green row is the DATABASE’s status', () => {
  it('tints a closed file and leaves an open one alone — on the row’s data-closed too', () => {
    const html = render({
      seed: withRows([
        accident({ id: 'a-open', statement: 'مفتوح هنا' }),
        accident({ id: 'a-closed', status: 'closed', statement: 'مغلق هنا' }),
      ]),
    });
    expect(rowWith(html, 'مغلق هنا')).toContain(CLOSED_TINT);
    expect(rowWith(html, 'مغلق هنا')).toContain('data-closed="true"');
    expect(rowWith(html, 'مفتوح هنا')).not.toContain(CLOSED_TINT);
    expect(rowWith(html, 'مفتوح هنا')).toContain('data-closed="false"');
    // The boards' table paints its own hover; the tint is restated over it (`CLOSED_ROW`).
    expect(html).toContain('[&amp;_tbody_tr[data-closed=true]]:!bg-emerald-50');
  });

  it('survives a RELOAD — a brand new client, and the colour is still there', () => {
    const first = render({ seed: withRows([accident({ status: 'closed' })]) });
    const afterReload = render({ seed: withRows([accident({ status: 'closed' })]) });
    expect(first).toContain(CLOSED_TINT);
    expect(afterReload, 'the tint is re-derived, not remembered').toContain(CLOSED_TINT);
  });

  it('offers the ONE flip the current state allows', () => {
    const html = render({
      seed: withRows([
        accident({ id: 'a-open', statement: 'مفتوح هنا' }),
        accident({ id: 'a-closed', status: 'closed', statement: 'مغلق هنا' }),
      ]),
    });
    expect(rowWith(html, 'مفتوح هنا')).toContain('غلق الملف');
    expect(rowWith(html, 'مفتوح هنا')).not.toContain('إعادة فتح الملف');
    expect(rowWith(html, 'مغلق هنا')).toContain('إعادة فتح الملف');
  });

  it('offers no flip at all without the grant — and the row is still readable', () => {
    const html = render({
      permissions: ['fleetAccident.view'],
      seed: withRows([accident({ status: 'closed' })]),
    });
    expect(html).not.toContain('إعادة فتح الملف');
    expect(html, 'the state is still announced').toContain('مغلق');
  });
});

describe('the boards’ table — bold like Receipts', () => {
  it('wears DARK_TABLE with Cairo words and the figures in Azeret Mono', () => {
    const html = render({ seed: withRows([accident()]) });
    const frame = html.slice(html.indexOf('data-accidents-table') - 2000);
    expect(frame).toContain('[&amp;_td]:[font-family:&#x27;Cairo&#x27;');
    expect(rowWith(html, 'فنوس شمال')).toContain('Azeret_Mono');
    // «سيب شكل الخط كدا» — the bold board, not the maintenance register's plain type.
    expect(PAGE_CODE).not.toContain('PLAIN_CELLS');
    expect(PAGE_CODE).not.toContain('ALARMS_TYPE');
  });

  it('centres every value under a centred header', () => {
    const columns = PAGE_CODE.slice(
      PAGE_CODE.indexOf('const columns'),
      PAGE_CODE.indexOf('const dateBound'),
    );
    expect(columns.match(/align: 'center'/gu)?.length).toBe(11);
  });
});

describe('the dark filter bar', () => {
  it('runs من → إلى → كود السيارة → المتسبب → الملاحظات → الحالة, an icon on every filter', () => {
    const bar = barOf(render());
    const order = [
      'data-date-caption="from"',
      'data-date-caption="to"',
      'كود السيارة',
      ar('fleet.accidents.fields.culprit'),
      'بحث في الملاحظات',
      ar('fleet.vehicles.columns.status'),
    ];
    let at = -1;
    for (const label of order) {
      const next = bar.indexOf(label, at + 1);
      expect(next, `${label} appears after the one before it`).toBeGreaterThan(at);
      at = next;
    }
    expect(PAGE_CODE).toContain('DARK_FILTER_BAR');
  });

  it('writes «من» and «إلى» inside the empty date boxes, through our calendar', () => {
    const bar = barOf(render());
    expect(bar).toContain(`data-date-caption="from"`);
    expect(bar).toContain(`>${ar('fleet.odometer.from')}<`);
    expect(bar).toContain(`>${ar('fleet.odometer.to')}<`);
    expect(PAGE_CODE).toContain('datePicker={{ label: t(labelKey) }}');
  });

  it('offers Reset once ANY filter is on — and not when nothing is', () => {
    for (const path of [
      '/fleet/accidents?vehicleCodes=FLT210',
      '/fleet/accidents?culpritBy=64b1f1f1f1f1f1f1f1f1f1f1',
      '/fleet/accidents?status=open',
      '/fleet/accidents?from=2026-01-01',
      '/fleet/accidents?to=2026-12-31',
      '/fleet/accidents?notes=%D9%88%D8%B1%D8%B4%D8%A9',
    ]) {
      expect(render({ path }), path).toContain('مسح عوامل التصفية');
    }
    expect(render()).not.toContain('مسح عوامل التصفية');
  });

  it('keeps «مفتوح» / «مغلق» ONE answer', () => {
    expect(PAGE_CODE).toContain(
      'onChange={(next) => patch({ status: pickOne(one(status), next) })}',
    );
  });

  it('sends ONE vehicle question to the server — the codes, ORed', () => {
    const html = render({
      path: '/fleet/accidents?vehicleCodes=FLT210,FLT211',
      seed: withRows([accident({ statement: 'كلاهما مطبق' })], {
        list: { vehicleCodes: ['FLT210', 'FLT211'] },
        summary: { vehicleCodes: ['FLT210', 'FLT211'] },
      }),
    });
    expect(html).toContain('كلاهما مطبق');
  });

  it('keeps a picked «كورولا 1» ONE car — through the URL the filter writes, and a reload', () => {
    const picked = ['كورولا 1', 'MG 2'];
    const address = new URLSearchParams({ vehicleCodes: picked.join(',') }).toString();
    const html = render({
      path: `/fleet/accidents?${address}`,
      seed: withRows([accident({ statement: 'كورولا واحدة بس' })], {
        list: { vehicleCodes: picked },
        summary: { vehicleCodes: picked },
      }),
    });
    expect(html).toContain('كورولا واحدة بس');
    expect(html).toContain('كورولا 1');
  });

  it('sends the NOTE search to the server — «عاوز اقدر ابحث فى الملاحظات»', () => {
    const html = render({
      path: '/fleet/accidents?notes=%D9%88%D8%B1%D8%B4%D8%A9',
      seed: withRows([accident({ statement: 'اتفلتر بالملاحظة' })], {
        list: { notes: 'ورشة' },
        summary: { notes: 'ورشة' },
      }),
    });
    expect(html).toContain('اتفلتر بالملاحظة');
  });

  it('sends the culprit — as an EMPLOYEE, not a typed name — and the date range', () => {
    const CULPRIT = '64b1f1f1f1f1f1f1f1f1f1f1';
    const html = render({
      path: `/fleet/accidents?culpritBy=${CULPRIT}&from=2026-01-01&to=2026-12-31`,
      seed: withRows([accident({ statement: 'فُلتر على الخادم' })], {
        list: { culpritEmployeeId: CULPRIT, from: '2026-01-01', to: '2026-12-31' },
        summary: { culpritEmployeeId: CULPRIT, from: '2026-01-01', to: '2026-12-31' },
      }),
    });
    expect(html).toContain('فُلتر على الخادم');
  });

  it('sends the status as the one value picked', () => {
    const html = render({
      path: '/fleet/accidents?status=closed',
      seed: withRows([accident({ status: 'closed', statement: 'المغلق فقط' })], {
        list: { status: 'closed' },
        summary: { status: 'closed' },
      }),
    });
    expect(html).toContain('المغلق فقط');
  });
});

describe('transfers between cars, on the board', () => {
  const LOG = readFileSync(join(HERE, '../components/AccidentTransferLogDialog.tsx'), 'utf8');

  it('puts the log button in every row, in the column before «ملاحظات»', () => {
    const html = render({ seed: withRows([accident(), accident({ id: 'a-2' })]) });
    expect(html).toContain('data-transfer-log-open="a-1"');
    expect(html).toContain('data-transfer-log-open="a-2"');
    const at = PAGE.indexOf("key: 'transferLog'");
    expect(at).toBeGreaterThan(PAGE.indexOf("key: 'remaining'"));
    expect(at).toBeLessThan(PAGE.indexOf("key: 'notes'"));
  });

  it('offers no log for a file kept from the old book with no registry car', () => {
    const html = render({ seed: withRows([accident({ vehicleId: null, vehicleCode: 'OLD-1' })]) });
    expect(html).not.toContain('data-transfer-log-open=');
  });

  it('turns the log button yellow once the car has at least one transfer', () => {
    const html = render({
      seed: withRows([accident({ carHasTransfers: true }), accident({ id: 'a-2' })]),
    });
    const yellow = html.slice(
      html.lastIndexOf('<button', html.indexOf('data-transfer-log-open="a-1"')),
    );
    expect(yellow.slice(0, yellow.indexOf('>'))).toContain('bg-amber-100');
    const plain = html.slice(
      html.lastIndexOf('<button', html.indexOf('data-transfer-log-open="a-2"')),
    );
    expect(plain.slice(0, plain.indexOf('>'))).not.toContain('bg-amber-100');
  });

  it('names the two directions as the owner asked', () => {
    expect(ar('fleet.accidents.log.paidFrom')).toBe('تم الدفع من');
    expect(ar('fleet.accidents.log.paidTo')).toBe('تم الدفع لـ');
    expect(LOG).toContain(
      "entry.direction === 'in' ? 'fleet.accidents.log.paidFrom' : 'fleet.accidents.log.paidTo'",
    );
  });

  it('lets only a reader who may edit remove a transfer', () => {
    expect(PAGE).toContain("mayRemove={can('fleetAccident.edit')}");
  });
});

describe('the Excel — «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس»', () => {
  const body = PAGE.slice(PAGE.indexOf('const exportSheet'), PAGE.indexOf('const runExport'));

  it('walks the whole filtered set, not the page', () => {
    expect(body).toContain('filtersOnly(params)');
    expect(body).toContain('fetchFilteredRows(');
  });

  it('carries the log — «الحوادث ضيف السجل فى الاكسيل» — before «ملاحظات»', () => {
    expect(body.indexOf("t('fleet.accidents.log.column')")).toBeLessThan(
      body.indexOf("t('fleet.accidents.fields.notes')"),
    );
    expect(body).toContain('fleetApi.accidentCarTransfers(vehicleId)');
    expect(body).toContain('logCell(r.vehicleId)');
    expect(body, 'only cars that have a transfer are asked').toContain('r.carHasTransfers');
  });

  it('heads the car «كود السيارة» as the screen does, and the remaining by the contract', () => {
    expect(body).toContain("t('fleet.odometer.columns.vehicle')");
    expect(body).toContain('fleetAccidentRemaining(r)');
    expect(body).toContain('moneyColumns: [5, 6, 7, 8]');
  });

  it('says so when the sheet could not be made', () => {
    expect(PAGE_CODE).toMatch(
      /catch \(failure\) \{\s*toast\.error\(errorMessage\(failure, locale\)\);/u,
    );
  });
});
