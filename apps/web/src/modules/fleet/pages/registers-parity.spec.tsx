// «اتاكد من ال10 شاشات دول المعلومات اللى فيها هى هى اللى فى باقى الشاشه» — the registers a dashboard
// figure opens, pinned to say what the figure says (the ten-screens audit, package W6):
//
//   D03  «المخالفات»: the drivers' footer «إجمالي السائقين» is the SERVER's owed sum over the whole
//        filter (`meta.outstandingAmount`), not the rows loaded so far — 1,588 = the dashboard's
//        «قائمة على السائقين», where a hundred rows in hand added up to 1,288.
//   D40  an archived drivers' type keeps its name on the chip; the bar and the filter still offer
//        only the active ones.
//   D41  the day column prints the STORED day, Latin digits — a fine stored at 22:30Z on the 31st
//        is the 31st's, in any browser zone.
//   D43  a fine that names nobody reads «مجهول», however «مجهول» was spaced, never «—».
//   D10  «الإخطارات» reads `missing=any` («ينقصها مرفق»): sent to the list AND the summary, shown as
//        a removable chip, remembered with the other filters.
//   D05  «مصروفات التراخيص»: under «النوع» / «التسوية» a row's money and cars are its MATCHED memos
//        only (L3 under «لم تُسوَّ» is its 80 extension, not 280), and the count beside the
//        toolbar is the memos, as «عدد المذكرات» is.
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
  MAX_PAGE_SIZE,
  type FleetCatalogItemDto,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseTotalsDto,
  type FleetNoticeDto,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type FleetViolationsListMeta,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatMoney, formatMoneyParts } from '../../../shared/lib/format';
import { listKey } from '../../../shared/lib/query-keys';
import { ViolationsPage } from './ViolationsPage';
import { NoticesPage } from './NoticesPage';
import {
  LicenseExpensesPage,
  carCodesOf,
  matchedMemosOf,
  moneyOf,
  type MemoHalves,
} from './LicenseExpensesPage';

// The notices screen portals its dialogs into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(join(HERE, file), 'utf8');
/** A file's code with its comments taken out — for what a static render cannot reach. */
const code = (file: string): string =>
  source(file)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
/** What a screen declared, read out of its own `REMEMBERED_FILTERS` — the census's reading. */
const remembered = (file: string): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/u.exec(source(file));
  return block === null ? [] : [...(block[1] ?? '').matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? '');
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  }) as unknown as MeDto;

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const mount = (
  qc: QueryClient,
  permissions: readonly string[],
  route: string,
  pattern: string,
  page: JSX.Element,
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={pattern} element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** One element's own text, from its marker to the tag that closes it. */
const textAt = (html: string, marker: string, close = '</span>'): string => {
  const at = html.indexOf(marker);
  expect(at, `${marker} is on screen`).toBeGreaterThan(-1);
  return html.slice(html.indexOf('>', at) + 1, html.indexOf(close, at));
};

/** The table row that carries `marker`, whole. */
const rowOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  expect(at, `${marker} is on screen`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

// ── «المخالفات المرورية والتسويات» — the drivers' half ────────────────────────────────────────

const DT_SPEED = '650000000000000000000031';
const DT_RETIRED = '650000000000000000000039';
const E1 = '650000000000000000000011';

const catalogItem = (id: string, name: string, isActive: boolean): FleetCatalogItemDto => ({
  id,
  kind: 'violationType',
  name: { ar: name, en: name },
  countsForAlarm: false,
  sortOrder: null,
  violationSide: 'driver',
  licenseExpenseKind: null,
  licenseExpensePaidBy: null,
  builtIn: false,
  isActive,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
/** «سرعة» in use, and «نوع مؤرشف» retired since a fine was filed under it. */
const DRIVER_TYPES = [
  catalogItem(DT_SPEED, 'سرعة', true),
  catalogItem(DT_RETIRED, 'نوع مؤرشف', false),
];

const fine = (over: Partial<FleetViolationDto> = {}): FleetViolationDto => ({
  id: 'vio-1',
  kind: 'driver',
  vehicleId: null,
  vehicleCode: '801',
  violationTypeId: DT_SPEED,
  amount: 50,
  year: null,
  count: null,
  unitValue: null,
  date: '2026-10-12T00:00:00.000Z',
  filedYear: null,
  homeVehicleId: null,
  driverEmployeeId: E1,
  driverName: null,
  collected: false,
  fromOldBook: false,
  version: 0,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...over,
});

const rollupRow = (): FleetViolationRollupDto => ({
  vehicleId: 'v1',
  code: '168',
  year: 2026,
  vehicleCount: 1,
  vehicleAmount: 100,
  driverCount: 0,
  driverAmount: 0,
  totalCount: 1,
  totalAmount: 100,
  outstandingVehicleAmount: 100,
  outstandingDriverAmount: 0,
  outstandingTotalAmount: 100,
  outstandingVehicleCount: 1,
  outstandingDriverCount: 0,
  outstandingTotalCount: 1,
  rowCount: 1,
  collectedCount: 0,
  totalBeforeGrievance: 0,
});

const VIOLATION_KEYS = [
  'fleetViolation.view',
  'fleetViolation.record',
  'fleetViolation.edit',
  'fleetViolation.collect',
];

/**
 * The register at `/fleet/violations`, the drivers' ledger seeded as the server answers it: the
 * pages in hand, how many rows matched, and the owed sum over EVERY one of them.
 */
const violations = ({
  pages,
  matched,
  outstanding,
}: {
  pages: FleetViolationDto[][];
  matched: number;
  outstanding: number;
}): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'catalogs', { kind: 'violationType', violationSide: 'driver' }),
    { items: DRIVER_TYPES, meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } },
  );
  qc.setQueryData(['fleet', 'violations', 'rollup', { year: '', vehicleCodes: '' }], [rollupRow()]);
  const size = MAX_PAGE_SIZE;
  qc.setQueryData(
    listKey('fleet', 'violations', {
      kind: 'driver',
      pageSize: size,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
      paged: 'infinite',
    }),
    {
      pages: pages.map((items, at) => ({
        items,
        meta: {
          page: at + 1,
          pageSize: size,
          totalItems: matched,
          totalPages: Math.max(1, Math.ceil(matched / size)),
          outstandingAmount: outstanding,
        } satisfies FleetViolationsListMeta,
      })),
      pageParams: pages.map((_, at) => at + 1),
    },
  );
  return mount(qc, VIOLATION_KEYS, '/fleet/violations', '/fleet/violations', <ViolationsPage />);
};

/** The drivers' half of the screen — the company half is drawn first. */
const driversHalf = (html: string): string =>
  html.slice(html.indexOf('data-violations-panel="driver"'));

describe('«المخالفات»: the drivers’ footer is the owed sum over the whole filter (D03)', () => {
  // The audit's figures: 130 owed fines; the first hundred loaded at 12.88 = 1,288.00 in hand;
  // the server's owed sum over all 130 — the dashboard's «قائمة على السائقين» — is 1,588.00.
  const hundred = Array.from({ length: 100 }, (_, i) =>
    fine({ id: `vio-${i + 1}`, amount: 12.88 }),
  );
  const thirty = Array.from({ length: 30 }, (_, i) => fine({ id: `vio-${i + 101}`, amount: 10 }));

  it('prints 1,588.00 over the first hundred rows — not the 1,288.00 they add up to', () => {
    const html = driversHalf(violations({ pages: [hundred], matched: 130, outstanding: 1588 }));
    const total = textAt(html, 'data-driver-outstanding', '</td>');
    expect(total).toBe(formatMoney(1588, 'EGP', 'ar'));
    expect(total).not.toBe(formatMoney(1288, 'EGP', 'ar'));
  });

  it('prints the same figure once every page is in hand — every page carries it', () => {
    const html = driversHalf(
      violations({ pages: [hundred, thirty], matched: 130, outstanding: 1588 }),
    );
    expect(textAt(html, 'data-driver-outstanding', '</td>')).toBe(formatMoney(1588, 'EGP', 'ar'));
  });

  it('prints nothing owed when the server says nothing is — a settled filter, say', () => {
    const settled = [fine({ id: 'vio-s', amount: 75, collected: true })];
    const html = driversHalf(violations({ pages: [settled], matched: 1, outstanding: 0 }));
    expect(textAt(html, 'data-driver-outstanding', '</td>')).toBe(formatMoney(0, 'EGP', 'ar'));
  });

  it('reads the figure off the server’s meta — the API types it, and the board sums no rows', () => {
    const api = code('../api/fleet-api.ts');
    expect(api).toContain('meta: FleetViolationsListMeta;');
    expect(api).toContain('Promise<FleetViolationsPage>');
    const panel = code('../components/DriverViolationsPanel.tsx');
    expect(panel).toContain('formatMoney(meta.outstandingAmount');
    expect(panel, 'no sum of the rows in hand').not.toMatch(/rows\s*\.filter\([^)]*collected/u);
  });
});

describe('«المخالفات»: a retired drivers’ type keeps its name (D40)', () => {
  const html = driversHalf(
    violations({
      pages: [[fine({ id: 'vio-old', violationTypeId: DT_RETIRED, amount: 55 })]],
      matched: 1,
      outstanding: 55,
    }),
  );

  it('names the fine’s chip «نوع مؤرشف», as the dashboard names its bar — never «—»', () => {
    expect(textAt(html, `data-violation-type-chip="${DT_RETIRED}"`)).toBe('نوع مؤرشف');
  });

  it('still offers only the active types on the counting bar and in the filter', () => {
    expect(html, 'the active type is counted').toContain(`data-driver-count="${DT_SPEED}"`);
    expect(html, 'the retired one is not').not.toContain(`data-driver-count="${DT_RETIRED}"`);
    const panel = code('../components/DriverViolationsPanel.tsx');
    expect(panel).toMatch(/\.filter\(\(item\) => item\.isActive\)/u);
    expect(panel).toContain('types.map((type) => ({ value: type.id, label: type.name }))');
  });
});

describe('«المخالفات»: the day column prints the stored day (D41)', () => {
  it('prints 2026-10-31 for a fine stored at 22:30Z on the 31st — the 1st in a Cairo browser before', () => {
    const stored = '2026-10-31T22:30:00.000Z';
    // What the old cell printed for a reader in Cairo: the next day.
    const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(
      new Date(stored),
    );
    expect(cairo).toBe('2026-11-01');
    const html = driversHalf(
      violations({
        pages: [
          [
            fine({ id: 'vio-late', date: stored }),
            fine({ id: 'vio-evening', date: '2026-10-20T21:00:00.000Z' }),
          ],
        ],
        matched: 2,
        outstanding: 100,
      }),
    );
    // The stored day, written «yyyy/mm/dd» as the dashboard's row writes it (V8).
    expect(textAt(html, 'data-violation-day="vio-late"')).toBe('2026/10/31');
    expect(textAt(html, 'data-violation-day="vio-evening"')).toBe('2026/10/20');
  });

  it('is the day the filter, the Excel and the print read — one slice, Latin digits', () => {
    const panel = code('../components/DriverViolationsPanel.tsx');
    expect(panel).toContain("row.date === null ? '—' : row.date.slice(0, 10).replace(/-/gu, '/')");
    expect(panel, 'never the browser’s zone').not.toContain('formatDate(row.date');
  });
});

describe('«المخالفات»: a fine that names nobody reads «مجهول» (D43)', () => {
  const html = driversHalf(
    violations({
      pages: [
        [
          fine({ id: 'vio-null', driverEmployeeId: null, driverName: null }),
          // « مجهول» with a no-break space — the old book's spelling the filter now finds (D42).
          fine({ id: 'vio-nbsp', driverEmployeeId: null, driverName: ' مجهول' }),
          fine({ id: 'vio-book', driverEmployeeId: null, driverName: 'سائق دفتر' }),
          fine({ id: 'vio-hr' }),
        ],
      ],
      matched: 4,
      outstanding: 200,
    }),
  );
  const unknown = ar('fleet.violations.unknownDriver');

  it('writes «مجهول» on a fine with no employee and no name — never «—»', () => {
    expect(unknown).toBe('مجهول');
    expect(textAt(html, 'data-driver-unknown="vio-null"')).toBe(unknown);
  });

  it('writes the same word for «مجهول» however it was spaced', () => {
    expect(textAt(html, 'data-driver-unknown="vio-nbsp"')).toBe(unknown);
    expect(html, 'not the raw spelling').not.toContain(' مجهول');
  });

  it('leaves a name the old book wrote, and an HR driver, as they were', () => {
    expect(html).not.toContain('data-driver-unknown="vio-book"');
    expect(rowOf(html, 'data-violation-day="vio-book"')).toContain('data-legacy-name="true"');
    expect(html).not.toContain('data-driver-unknown="vio-hr"');
  });
});

// ── «الإخطارات» — «ينقصها مرفق» (D10) ──────────────────────────────────────────────────────────

const notice = (over: Partial<FleetNoticeDto> = {}): FleetNoticeDto => ({
  id: 'nt-1',
  template: 'misrInsurance',
  values: {},
  checks: {},
  vehicleId: 'v-247',
  vehicleCode: '247',
  driverEmployeeId: null,
  accidentId: null,
  noticeNumber: '24117',
  noticeDate: '2026-10-21',
  noticeImage: null,
  vehicleLicense: null,
  driverLicense: null,
  vehicleLicenseOnFile: false,
  driverLicenseOnFile: false,
  checkImage: null,
  completedAt: null,
  version: 0,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  ...over,
});

/** The notices at `route`, the list seeded ONLY under the request `filters` must become. */
const noticesAt = (
  route: string,
  filters: Record<string, unknown>,
): { html: string; qc: QueryClient } => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'notices', { page: 1, pageSize: 25, ...filters }), {
    items: [notice()],
    meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
  });
  const html = mount(qc, ['fleetNotice.view'], route, '/fleet/notices', <NoticesPage />);
  return { html, qc };
};
const asked = (qc: QueryClient, params: Record<string, unknown>): boolean =>
  qc.getQueryCache().find({ queryKey: listKey('fleet', 'notices', params), exact: true }) !==
  undefined;
const MISSING = { status: 'open', missing: 'any' } as const;

describe('«الإخطارات» reads «ينقصها مرفق» — what the overview’s line counts (D10)', () => {
  it('asks the list AND the figures for the notices missing an attachment', () => {
    const { html, qc } = noticesAt('/fleet/notices?status=open&missing=any', MISSING);
    expect(html, 'the seeded notice is listed').toContain('data-notice-row="nt-1"');
    expect(asked(qc, { page: 1, pageSize: 25, ...MISSING }), 'the list').toBe(true);
    expect(asked(qc, { summary: true, ...MISSING }), 'and the figures').toBe(true);
  });

  it('never answers it from the un-narrowed list', () => {
    const { html } = noticesAt('/fleet/notices?status=open&missing=any', { status: 'open' });
    expect(html).not.toContain('data-notice-row="nt-1"');
  });

  it('shows it as a chip that comes off — and a plain toggle that puts it on by hand', () => {
    const { html } = noticesAt('/fleet/notices?status=open&missing=any', MISSING);
    const chip = textAt(html, 'data-notice-missing="any"', '<span aria-hidden');
    expect(chip).toBe(ar('fleet.notices.filters.missingAny'));
    expect(html).toContain(
      `aria-label="${ar('common.remove')} ${ar('fleet.notices.filters.missingAny')}"`,
    );
    expect(html).toContain('aria-pressed="true"');
    const plain = noticesAt('/fleet/notices?status=open', { status: 'open' });
    expect(plain.html).toContain('data-notice-row="nt-1"');
    expect(plain.html).not.toContain('data-notice-missing="any"');
    // Off, it is still on the bar: the owner's «فلتر «ينقصها مرفق»», pressed by hand.
    expect(textAt(plain.html, 'data-notice-missing="off"', '</button>')).toBe(
      ar('fleet.notices.filters.missingAny'),
    );
    expect(plain.html).toContain('aria-pressed="false"');
    const page = code('NoticesPage.tsx').replace(/\s+/gu, ' ');
    expect(page, 'one press puts it on, the next takes it off').toContain(
      "onClick={() => patch({ missing: missingAny ? null : 'any' })}",
    );
    expect(page, 'so does the bar’s «إعادة الضبط»').toMatch(
      /onClear=\{\(\) => patch\(\{[^}]*missing: null,[^}]*\.\.\.CLEAR_VEHICLE_SET,/u,
    );
  });

  it('asks nothing of a value it does not know — the strict summary would refuse it', () => {
    const { html, qc } = noticesAt('/fleet/notices?status=open&missing=cheque', {
      status: 'open',
    });
    expect(html).toContain('data-notice-row="nt-1"');
    expect(html).not.toContain('data-notice-missing="any"');
    expect(asked(qc, { summary: true, status: 'open' })).toBe(true);
  });

  it('remembers it with the other filters and reads it in its own source', () => {
    expect(remembered('NoticesPage.tsx')).toEqual(
      expect.arrayContaining(['status', 'checkImage', 'missing']),
    );
    expect(source('NoticesPage.tsx')).toContain("sp.get('missing')");
  });
});

// ── «مصروفات التراخيص» — the matched memos (D05) ───────────────────────────────────────────────

const SETTLED = { operationId: 'op-9', date: '2026-10-05' };
const SIGNATURES = { agent: 'أ', director: 'ب', generalManager: 'ج' };
const line = (amount: number, paidBy: 'visa' | 'cash') => ({
  itemId: null,
  label: 'رسوم',
  amount,
  count: 1,
  paidBy,
  receipt: true,
});
const car = (code: string) => ({ vehicleId: `v-${code}`, code, plate: `ل ${code}` });
const record = (
  id: string,
  renewal: FleetLicenseExpenseDto['renewal'],
  extension: FleetLicenseExpenseDto['extension'],
): FleetLicenseExpenseDto => ({
  id,
  date: '2026-10-04',
  renewal,
  extension,
  signatures: SIGNATURES,
  version: 0,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
});
// The audit's three records: L1 renewal 250 + extension 30, both waiting; L2 renewal 400 waiting;
// L3 renewal 200 SETTLED + extension 80 waiting. «تنتظر التسوية» = four memos, 760.
const L1 = record(
  'L1',
  { vehicles: [car('101')], items: [line(250, 'visa')], settlement: null },
  { vehicles: [car('102')], items: [line(30, 'cash')], settlement: null },
);
const L2 = record(
  'L2',
  { vehicles: [car('201')], items: [line(400, 'visa')], settlement: null },
  null,
);
const L3 = record(
  'L3',
  { vehicles: [car('301')], items: [line(200, 'visa')], settlement: SETTLED },
  { vehicles: [car('302')], items: [line(80, 'cash')], settlement: null },
);

const LIST_PARAMS = {
  page: 1,
  pageSize: 25,
  sortBy: 'date',
  sortDir: 'desc',
  sort: 'date:desc',
} as const;

/** The register at `?search`, seeded under the request those filters make — rows and strip. */
const licenceList = (
  search: string,
  filters: Record<string, string>,
  rows: FleetLicenseExpenseDto[],
  totals: FleetLicenseExpenseTotalsDto,
): string => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'licenseExpenses', { ...LIST_PARAMS, ...filters }), {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'licenseExpenses', { summary: true, ...filters }), totals);
  return mount(
    qc,
    ['fleetLicenseExpense.view'],
    `/fleet/license-expenses${search}`,
    '/fleet/license-expenses',
    <LicenseExpensesPage />,
  );
};

/** A money cell's figure as the table sets it — `>760.00<`, so «80.00» is never found in «280.00». */
const figure = (value: number): string => `>${formatMoneyParts(value, 'EGP', 'ar').figure}<`;
const rowTotal = (row: FleetLicenseExpenseDto, halves: MemoHalves): number =>
  moneyOf(row, 'total', halves) ?? 0;

describe('«مصروفات التراخيص»: a row is its matched memos under «النوع» / «التسوية» (D05)', () => {
  const WAITING: MemoHalves = { status: 'waiting' };

  it('sums the waiting memos only — 760 over the three records, as «تنتظر التسوية» says', () => {
    expect([L1, L2, L3].map((row) => rowTotal(row, WAITING))).toEqual([280, 400, 80]);
    expect([L1, L2, L3].reduce((sum, row) => sum + rowTotal(row, WAITING), 0)).toBe(760);
    // The settled renewal is no part of it — and nothing filters, everything counts.
    expect(rowTotal(L3, {})).toBe(280);
    expect(moneyOf(L3, 'visa', WAITING), 'its only visa line is the settled renewal').toBeNull();
  });

  it('sums one kind’s waiting memos — renewal 650, extension 110', () => {
    const renewal: MemoHalves = { kind: 'renewal', status: 'waiting' };
    const extension: MemoHalves = { kind: 'extension', status: 'waiting' };
    expect(rowTotal(L1, renewal) + rowTotal(L2, renewal)).toBe(650);
    expect(rowTotal(L1, extension) + rowTotal(L3, extension)).toBe(110);
    expect(matchedMemosOf(L3, { status: 'settled' }).map((memo) => memo.kind)).toEqual(['renewal']);
  });

  it('names the matched memos’ cars only', () => {
    expect(carCodesOf(L3, WAITING)).toEqual({ codes: ['302'], unregistered: 0 });
    expect(carCodesOf(L3, {})).toEqual({ codes: ['301', '302'], unregistered: 0 });
    expect(carCodesOf(L1, { kind: 'renewal' })).toEqual({ codes: ['101'], unregistered: 0 });
  });

  it('draws L3 under «لم تُسوَّ» as its waiting 80 and its one car — not 280 and two', () => {
    const html = licenceList('?status=waiting', { status: 'waiting' }, [L1, L2, L3], {
      count: 4,
      cars: 4,
      visaTotal: 650,
      cashTotal: 110,
    });
    const l3 = rowOf(html, 'data-license-expense-status="L3"');
    expect(l3).toContain(figure(80));
    expect(l3).not.toContain(figure(280));
    expect(l3).not.toContain(figure(200));
    expect(l3).toContain('data-license-expense-car-code="302"');
    expect(l3).not.toContain('data-license-expense-car-code="301"');
    expect(rowOf(html, 'data-license-expense-status="L1"')).toContain(figure(280));
  });

  it('draws a renewal row under «مد مدة» as its extension only', () => {
    const html = licenceList(
      '?kind=extension&status=waiting',
      { kind: 'extension', status: 'waiting' },
      [L1, L3],
      { count: 2, cars: 2, visaTotal: 0, cashTotal: 110 },
    );
    const l1 = rowOf(html, 'data-license-expense-status="L1"');
    expect(l1).toContain(figure(30));
    expect(l1).not.toContain(figure(280));
    expect(l1).not.toContain(figure(250));
  });

  it('draws a whole record, both memos, when nothing narrows', () => {
    const html = licenceList('', {}, [L3], { count: 2, cars: 2, visaTotal: 200, cashTotal: 80 });
    const l3 = rowOf(html, 'data-license-expense-status="L3"');
    expect(l3).toContain(figure(280));
    expect(l3).toContain('data-license-expense-car-code="301"');
    expect(l3).toContain('data-license-expense-car-code="302"');
  });

  it('counts MEMOS beside the toolbar — «عدد المذكرات», four, over three rows', () => {
    const html = licenceList('?status=waiting', { status: 'waiting' }, [L1, L2, L3], {
      count: 4,
      cars: 4,
      visaTotal: 650,
      cashTotal: 110,
    });
    const at = html.indexOf('data-filtered-count');
    const said = html.slice(html.indexOf('>', at) + 1, html.indexOf('</span>', at));
    // Latin digits, as the strip and the pager on the same screen (V7).
    expect(said).toBe(ar('fleet.licenseExpenses.count', { count: '4' }));
    expect(html.slice(html.lastIndexOf('<span', at), html.indexOf('>', at))).toContain(
      `title="${ar('fleet.licenseExpenses.stats.memos')}"`,
    );
  });

  it('writes the Excel and the PDF from the same matched memos', () => {
    const page = code('LicenseExpensesPage.tsx');
    expect(page).toContain("...MONEY_COLUMNS.map((column) => moneyOf(row, column, halves) ?? ''),");
    expect(page).toContain('const value = moneyOf(row, column, halves);');
    expect(page.match(/carsOf\(row, halves\)\.length/gu)?.length, 'the count, both files').toBe(2);
    expect(page.match(/carsOf\(row, halves\)\.map\(carName\)/gu)?.length, 'the list, both').toBe(2);
  });
});
