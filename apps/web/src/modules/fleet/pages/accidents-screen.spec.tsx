// What the accidents screen SHOWS — asserted as markup facts, from real renders.
//
// This suite has no DOM, so nothing can be clicked and no effect runs. What it can prove is the
// part that has bitten before: that the row's colour is read from the persisted status and from
// nothing the screen remembers, that the figures above the table are the SERVER's and not a sum of
// the page, and that the params the page asks for carry every filter in the URL — because a page
// that quietly dropped one would still render, just wrongly.
//
// What the server enforces — how the filters combine, what a code resolves to — is proven in
// `apps/api/src/modules/fleet/accidents/accident-filters.spec.ts`. Nothing here can enforce it.
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
import { AccidentsPage } from './AccidentsPage';

const GREEN = 'bg-emerald-50';
/** Arabic renders MONEY in Latin digits (`moneyLocale`), to two places; counts stay Arabic-Indic. */
const MONEY_TOTALS = ['22,005.00', '87,835.00', '174,710.00', '240,540.00'];

const accident = (over: Partial<FleetAccidentDto> = {}): FleetAccidentDto => ({
  id: 'a-1',
  vehicleId: 'v-1',
  occurredAt: '2026-03-09T00:00:00.000Z',
  culprit: 'محمود محمد فهمى محمود',
  statement: 'فنوس شمال امامى',
  companyCost: 0,
  amountCollected: 1500,
  paidAmount: 1500,
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
  count: 180,
  amountCollected: 87_835,
  companyCost: 174_710,
  paidAmount: 240_540,
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
  code: undefined,
  vehicleId: undefined,
  culprit: undefined,
  status: undefined,
  from: undefined,
  to: undefined,
  page: 1,
  pageSize: 25,
  sortBy: 'occurredAt',
  sortDir: 'desc',
  ...over,
});

const summaryParams = (over: Record<string, unknown> = {}) => ({
  summary: true,
  code: undefined,
  vehicleId: undefined,
  culprit: undefined,
  status: undefined,
  from: undefined,
  to: undefined,
  ...over,
});

const render = ({
  locale = 'ar',
  permissions = ['fleetAccident.view', 'fleetAccident.close', 'fleetAccident.edit'],
  path = '/fleet/accidents',
  seed = () => undefined,
}: {
  locale?: Locale;
  permissions?: string[];
  path?: string;
  seed?: (qc: QueryClient) => void;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // The registry both the code column and the dropdown read — one key serves both.
  qc.setQueryData(listKey('fleet', 'vehicles', { pageSize: 100, sortBy: 'code', sortDir: 'asc' }), {
    items: [vehicle('v-1', '150'), vehicle('v-2', '151')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
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
const withRows = (
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
) => {
  return (qc: QueryClient): void => {
    qc.setQueryData(
      listKey('fleet', 'accidents', listParams(list)),
      meta === undefined ? paged(rows) : paged(rows, meta.page, meta.pageSize, meta.totalItems),
    );
    qc.setQueryData(listKey('fleet', 'accidents', summaryParams(summary)), figures);
  };
};

/** The markup of one table row, found by a value it contains. */
const rowWith = (html: string, needle: string): string => {
  const rows = html.split('<tr');
  const found = rows.find((row) => row.includes(needle));
  if (found === undefined) throw new Error(`no row containing ${needle}`);
  return found;
};

describe('the columns the reader asked for, in order', () => {
  it('runs م → الكود → التاريخ → المتسبب → البيان → المحصل → الشركة → المدفوع → المتبقي → ملاحظات', () => {
    const html = render({ seed: withRows([accident()]) });
    const headers = [...html.matchAll(/<th[^>]*>(?:<[^>]+>)*([^<]*)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(headers).toEqual([
      'م',
      'الكود',
      'تاريخ الحادث',
      'المتسبب',
      'بيان الحادث',
      'المبلغ المحصَّل',
      'تكلفة الشركة',
      'المبلغ المدفوع',
      'إجمالي المتبقي',
      'ملاحظات',
      'إجراءات',
    ]);
  });

  it('shows NO status column — the state is the colour, the action and a word for screen readers', () => {
    const html = render({ seed: withRows([accident({ status: 'closed' })]) });
    expect(html).not.toContain('<th'.concat('>الحالة'));
    const headers = [...html.matchAll(/<th[^>]*>(?:<[^>]+>)*([^<]*)/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(headers).not.toContain('الحالة');
    // …but the word is still THERE, for a reader the tint does not reach.
    expect(rowWith(html, 'فنوس شمال')).toContain('sr-only');
    expect(rowWith(html, 'فنوس شمال')).toContain('مغلق');
  });

  it('numbers the rows from the start of the LIST, not of the page', () => {
    const html = render({
      path: '/fleet/accidents?page=3',
      seed: withRows([accident(), accident({ id: 'a-2', statement: 'فنوس خلفى' })], {
        list: { page: 3 },
        meta: { page: 3, pageSize: 25, totalItems: 180 },
      }),
    });
    expect(rowWith(html, 'فنوس شمال')).toContain('>51<');
    expect(rowWith(html, 'فنوس خلفى')).toContain('>52<');
  });
});

describe('إجمالي المتبقي — derived on the row', () => {
  it('is collected + company − paid', () => {
    const html = render({
      seed: withRows([accident({ amountCollected: 400, companyCost: 500, paidAmount: 200 })]),
    });
    // Money renders in Latin digits even in Arabic (`moneyLocale`), to two places.
    expect(rowWith(html, 'فنوس شمال')).toContain('700.00');
  });

  it('prints a wash as 0 and NEVER as -0', () => {
    // The float route to it too: 0.1 + 0.2 − 0.3 is not zero in binary, and two decimals of that
    // residue reads "-0.00" — a debt of nothing, with a minus sign in front of it.
    for (const row of [
      accident({ amountCollected: 0, companyCost: 0, paidAmount: 0 }),
      accident({ amountCollected: 0.1, companyCost: 0.2, paidAmount: 0.3 }),
      accident({ amountCollected: 1500, companyCost: 0, paidAmount: 1500 }),
    ]) {
      const cells = rowWith(render({ seed: withRows([row]) }), 'فنوس شمال');
      expect(cells, JSON.stringify(row)).not.toContain('-0');
      expect(cells, 'and the wash is actually printed').toContain('0.00');
    }
  });

  it('shows a real overpayment as negative — it does not clamp at zero', () => {
    const html = render({
      seed: withRows([accident({ amountCollected: 100, companyCost: 0, paidAmount: 250 })]),
    });
    expect(rowWith(html, 'فنوس شمال')).toContain('-150.00');
  });
});

describe('the figures above the table are the SERVER’s', () => {
  it('shows the totals the server sent, not the sum of the rows on screen', () => {
    // One row worth 1,500 on a page of a 180-file search. A strip that summed what it could see
    // would print 1,500; the point of the strip is that it prints the whole search.
    const html = render({ seed: withRows([accident()], { figures: totals() }) });
    expect(html, 'the count is Arabic-Indic — it is not money').toContain('١٨٠');
    for (const figure of MONEY_TOTALS) expect(html).toContain(figure);
  });

  it('is UNCHANGED by paging — page 3 of the same search shows the same five figures', () => {
    // The summary is keyed on the filters alone, so turning the page cannot reach it. Seeded
    // ONLY under the page-free key: if the page asked for a paged summary it would find nothing.
    const one = render({ seed: withRows([accident()], { figures: totals() }) });
    const three = render({
      path: '/fleet/accidents?page=3&size=10',
      seed: withRows([accident({ id: 'a-9', statement: 'فنوس خلفى' })], {
        list: { page: 3, pageSize: 10 },
        meta: { page: 3, pageSize: 10, totalItems: 180 },
        figures: totals(),
      }),
    });
    for (const figure of ['١٨٠', ...MONEY_TOTALS]) {
      expect(one, `page 1 shows ${figure}`).toContain(figure);
      expect(three, `page 3 shows the same ${figure}`).toContain(figure);
    }
  });

  it('holds the space while the sums are in flight instead of printing zeros', () => {
    // Seed the rows but NOT the totals: a strip that defaulted to 0 would state, briefly and
    // confidently, that the search is worth nothing.
    const html = render({
      seed: (qc) =>
        qc.setQueryData(listKey('fleet', 'accidents', listParams()), paged([accident()])),
    });
    expect(html).not.toContain('22,005.00');
    expect(html, 'a skeleton, not a number').toContain('animate-pulse');
  });
});

describe('the green row is the DATABASE’s status', () => {
  it('tints a closed file and leaves an open one alone', () => {
    const html = render({
      seed: withRows([
        accident({ id: 'a-open', statement: 'مفتوح هنا' }),
        accident({ id: 'a-closed', status: 'closed', statement: 'مغلق هنا' }),
      ]),
    });
    expect(rowWith(html, 'مغلق هنا')).toContain(GREEN);
    expect(rowWith(html, 'مفتوح هنا')).not.toContain(GREEN);
  });

  it('survives a RELOAD — a brand new client, and the colour is still there', () => {
    // The scenario that would break a screen holding the state in `useState`: everything the
    // browser remembered is gone, and only what the server said is left.
    const first = render({ seed: withRows([accident({ status: 'closed' })]) });
    const afterReload = render({ seed: withRows([accident({ status: 'closed' })]) });
    expect(first).toContain(GREEN);
    expect(afterReload, 'the tint is re-derived, not remembered').toContain(GREEN);
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
    expect(rowWith(html, 'مغلق هنا')).not.toContain('غلق الملف');
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

describe('the screen is laid out to be read, not scanned', () => {
  // The pixels are proven in a browser; what these hold is the WIRING that produces them, so a
  // later edit cannot quietly drop a prop and leave the screen looking like it did before.
  it('names each total ABOVE its figure, and centres both', () => {
    const html = render({ seed: withRows([accident()]) });
    const strip = html.slice(html.indexOf('grid-cols-5'));
    const label = strip.indexOf('اجمالي المبلغ المحصل');
    const value = strip.indexOf('22,005.00');
    expect(label, 'the label is in the markup').toBeGreaterThan(-1);
    expect(value, 'and so is the figure').toBeGreaterThan(-1);
    expect(label, 'the label comes first').toBeLessThan(value);
    expect(strip, 'and the tile centres its contents').toContain('items-center');
    expect(strip).toContain('text-center');
  });

  it('gives the totals a figure larger than the word beside it', () => {
    const strip = render({ seed: withRows([accident()]) }).slice(
      render({ seed: withRows([accident()]) }).indexOf('grid-cols-5'),
    );
    expect(strip, 'the figure').toContain('text-2xl');
    expect(strip, 'the label, one step down').toContain('text-sm');
  });

  it('runs the table one step up the type scale', () => {
    const html = render({ seed: withRows([accident()]) });
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const bodyRow = rowWith(html, 'فنوس شمال');
    expect(head, 'headers are no longer text-xs').not.toContain('text-xs');
    expect(head).toContain('text-sm');
    expect(bodyRow, 'and the cells are no longer text-sm').toContain('text-base');
  });

  it('sizes the filter controls to match, and keeps them on ONE row on desktop', () => {
    const html = render();
    // The threshold is this bar's own, measured: seven controls at this size do not fit at 1400.
    expect(html).toContain('min-[1440px]:flex-nowrap');
    expect(html).not.toContain('min-[1400px]:flex-nowrap');
    const bar = html.slice(html.indexOf('flex flex-wrap items-center gap-2 rounded-lg'));
    const controls = [...bar.matchAll(/<(?:input|select)[^>]*class="([^"]*)"/g)].map(
      (m) => m[1] ?? '',
    );
    // Five now: the code box and the vehicle dropdown collapsed into ONE vehicle-code picker,
    // which is a button rather than an input and so is counted separately below.
    expect(controls.length, 'culprit, from, to, status').toBe(4);
    for (const cls of controls) expect(cls, cls).toContain('text-base');
  });

  it('puts «من» and «إلى» BESIDE their boxes, not above them', () => {
    // A stacked label is what made the bar two rows tall and pushed the seventh control off it.
    const html = render();
    const bar = html.slice(html.indexOf('flex flex-wrap items-center gap-2 rounded-lg'));
    const group = bar.slice(bar.indexOf('accidents-from') - 400, bar.indexOf('accidents-from'));
    expect(group, 'the label and the box share a row').toContain('flex shrink-0 items-center');
    expect(bar).toContain('for="accidents-from"');
    expect(bar).toContain('for="accidents-to"');
  });
});

describe('a failed fetch states the failure instead of inventing a screen', () => {
  it('shows no rows, no green, and no figures when the list fails', () => {
    const html = render({
      seed: (qc) => {
        qc.setQueryData(listKey('fleet', 'accidents', listParams()), undefined);
        qc.setQueryDefaults(listKey('fleet', 'accidents', listParams()), {
          queryFn: () => Promise.reject(new Error('down')),
        });
      },
    });
    expect(html).not.toContain(GREEN);
    expect(html).not.toContain('22,005.00');
    expect(html, 'a zero would be a claim about data nobody has').not.toContain('0.00');
  });
});

describe('the filter bar', () => {
  it('carries its controls on one row, in the order asked for', () => {
    const html = render();
    // The single-row threshold is this bar's own — see the `singleRowFrom` case below.
    expect(html).toContain('flex-nowrap');
    const bar = html.slice(html.indexOf('flex flex-wrap items-center gap-2 rounded-lg'));
    // Matched on things unique to each control rather than on its visible word, which can occur
    // elsewhere in the markup: two placeholders, the "all vehicles" option, the two date ids, and
    // the "all statuses" option.
    // One vehicle control where there were two — see «one vehicle control» below.
    const order = [
      'كود السيارة',
      'اسم المتسبب',
      'accidents-from',
      'accidents-to',
      'كل الحالات',
    ];
    let at = -1;
    for (const label of order) {
      const next = bar.indexOf(label, at + 1);
      expect(next, `${label} appears after the one before it`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('offers Reset once ANY filter is on — including the vehicle codes alone', () => {
    for (const path of [
      '/fleet/accidents?vehicleCodes=FLT210',
      '/fleet/accidents?vehicleCodes=FLT210,FLT211',
      '/fleet/accidents?culprit=%D8%A7%D8%B4%D8%B1%D9%81',
      '/fleet/accidents?status=open',
      '/fleet/accidents?from=2026-01-01',
      '/fleet/accidents?to=2026-12-31',
    ]) {
      expect(render({ path }), path).toContain('مسح عوامل التصفية');
    }
  });

  it('does not offer Reset when nothing is filtered', () => {
    expect(render()).not.toContain('مسح عوامل التصفية');
  });

  it('sends ONE vehicle question to the server — the codes, ORed', () => {
    // There used to be two controls on this axis: a substring code box AND a single-car dropdown,
    // which the server intersected. Picking 215 while typing 216 produced an empty page the filter
    // bar itself had offered. Seeded ONLY under the unified key, so a page still sending either of
    // the old two — or filtering in the browser — would look for a different key and render
    // nothing.
    const html = render({
      path: '/fleet/accidents?vehicleCodes=FLT210,FLT211',
      seed: withRows([accident({ statement: 'كلاهما مطبق' })], {
        list: { vehicleCodes: ['FLT210', 'FLT211'] },
        summary: { vehicleCodes: ['FLT210', 'FLT211'] },
      }),
    });
    expect(html).toContain('كلاهما مطبق');
  });

  it('sends the culprit search and the date range to the server too', () => {
    const html = render({
      path: '/fleet/accidents?culprit=%D8%A7%D8%B4%D8%B1%D9%81&from=2026-01-01&to=2026-12-31',
      seed: withRows([accident({ statement: 'فُلتر على الخادم' })], {
        list: { culprit: 'اشرف', from: '2026-01-01', to: '2026-12-31' },
        summary: { culprit: 'اشرف', from: '2026-01-01', to: '2026-12-31' },
      }),
    });
    expect(html).toContain('فُلتر على الخادم');
  });
});
