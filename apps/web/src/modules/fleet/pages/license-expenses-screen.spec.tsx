// «مصروفات التراخيص», proven against what it produces: the memo sheet is the department's own (its
// title, the card's table and the cash table, the totals and the signatures); a record that holds
// both memos prints as two; the list offers the eye, edit and delete by grant; and a new memo
// starts with the counters of the department's items and the set-up's names.
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
  type FleetCatalogItemDto,
  type FleetLicenseExpenseDto,
  type FleetLicenseExpenseTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { LicenseExpensesPage, carCodesOf, moneyOf } from './LicenseExpensesPage';
import { LicenseExpenseEditorPage } from './LicenseExpenseEditorPage';
import { CatalogsPage } from './CatalogsPage';
import { CatalogItemDialog } from '../components/CatalogDialogs';
import { carsPhrase, memoHtml, memosOf, memoTitle, sumOf } from '../lib/license-expense-memo';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const me = (permissions: string[]): MeDto =>
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
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const SIGNATURES = {
  agent: 'طلعت جابر بحيري',
  director: 'عميد / إيهاب عبد السلام',
  generalManager: 'لواء أ ح / جمال أحمد أبو إسماعيل\nالمدير العام التنفيذي',
};

const memo = (over: Partial<FleetLicenseExpenseDto> = {}): FleetLicenseExpenseDto => ({
  id: 'lx-1',
  date: '2026-10-04',
  renewal: {
    vehicles: [
      { vehicleId: 'v-1', code: '204', plate: 'أ ق 1761' },
      { vehicleId: null, code: null, plate: 'أ ق 1791' },
    ],
    items: [
      { itemId: 'i-1', label: 'أمان', amount: 600, count: 1, paidBy: 'visa', receipt: true },
      { itemId: 'i-2', label: 'دمغة', amount: 5, count: 4, paidBy: 'cash', receipt: false },
    ],
  },
  extension: null,
  signatures: SIGNATURES,
  version: 0,
  createdAt: '2026-10-04T00:00:00.000Z',
  updatedAt: '2026-10-04T00:00:00.000Z',
  ...over,
});

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const ALL = [
  'fleetLicenseExpense.view',
  'fleetLicenseExpense.create',
  'fleetLicenseExpense.edit',
  'fleetLicenseExpense.delete',
];

/** The list's first request: page one, the newest memo first — the arrows' default order. */
export const LIST_PARAMS = {
  page: 1,
  pageSize: 25,
  sortBy: 'date',
  sortDir: 'desc',
  sort: 'date:desc',
} as const;

const TOTALS: FleetLicenseExpenseTotalsDto = { count: 1, cars: 2, visaTotal: 600, cashTotal: 20 };

const renderList = (permissions = ALL, rows = [memo()]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'licenseExpenses', LIST_PARAMS), {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'licenseExpenses', { summary: true }), TOTALS);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/license-expenses']}>
          <Routes>
            <Route path="/fleet/license-expenses" element={<LicenseExpensesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const catalogItem = (
  id: string,
  name: string,
  licenseExpenseKind: 'renewal' | 'extension' | null = null,
): FleetCatalogItemDto =>
  ({
    id,
    kind: 'licenseExpenseItem',
    name: { ar: name, en: name },
    licenseExpenseKind,
    isActive: true,
  }) as unknown as FleetCatalogItemDto;

const renderEditor = (
  items: FleetCatalogItemDto[] = [catalogItem('i-1', 'براءة ذمة'), catalogItem('i-2', 'ضرائب')],
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'licenseExpenseItem' }), {
    items,
    meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: [],
    meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
  });
  qc.setQueryData(['fleet', 'licenseExpenses', 'settings'], {
    signatures: SIGNATURES,
    templates: { renewal: { visa: [], cash: [] }, extension: { visa: [], cash: [] } },
    version: 0,
  });
  return renderToStaticMarkup(
    <Provider store={store(ALL)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/license-expenses/new']}>
          <Routes>
            <Route path="/fleet/license-expenses/:id" element={<LicenseExpenseEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the licensing-expenses memo', () => {
  it('is titled the way the department writes it', () => {
    const [doc] = memosOf(memo());
    expect(memoTitle(doc!)).toBe('مذكرة بمصروفات تجديد تراخيص سيارتين شهر أكتوبر 2026/10/04');
    expect(carsPhrase(1)).toBe('سيارة واحدة');
    expect(carsPhrase(5)).toBe('5 سيارات');
    expect(carsPhrase(13)).toBe('13 سيارة');
  });

  it('carries the plates, the card table, the cash table, the totals and the signatures', () => {
    const html = memoHtml(memosOf(memo())[0]!);
    expect(html).toContain('أ ق 1761');
    expect(html).toContain('أ ق 1791');
    expect(html).toContain('ما تم صرفه بفيزا إدارة الحركة');
    expect(html).toContain('تم صرفه نقدًا');
    // 600 by the card + 5 × 4 in cash.
    expect(html).toContain('620.00');
    expect(html).toContain('متوافر إيصال');
    expect(html).toContain('لا يوجد');
    expect(html).toContain('طلعت جابر بحيري');
    expect(html).toContain('لواء أ ح / جمال أحمد أبو إسماعيل<br/>المدير العام التنفيذي');
  });

  it('puts each table on its own page and signs once, after the last', () => {
    const html = memoHtml(memosOf(memo())[0]!);
    // «كل جدول فى صفحة … بس امضى واحده»: two tables, two sheets, one signature block.
    expect(html.split('class="lx-sheet"').length - 1).toBe(2);
    expect(html.split('مندوب التراخيص').length - 1).toBe(1);
    const second = html.slice(html.lastIndexOf('class="lx-sheet"'));
    expect(second, 'the cash table and the close on the last page').toContain('تم صرفه نقدًا');
    expect(second).toContain('مندوب التراخيص');
    expect(second, 'the title only on the first').not.toContain('مذكرة بمصروفات');
  });

  it('draws no table for a group with nothing in it', () => {
    // «لو مفيش جدول للفيزا متعملش جدول ادام مفيش بيانات وكذلك نقدى».
    const cashOnly = memo({
      renewal: {
        vehicles: [],
        items: [
          { itemId: null, label: 'دمغة', amount: 5, count: 1, paidBy: 'cash', receipt: false },
        ],
      },
    });
    const html = memoHtml(memosOf(cashOnly)[0]!);
    expect(html).not.toContain('ما تم صرفه بفيزا');
    expect(html).toContain('تم صرفه نقدًا');
    expect(html.split('class="lx-sheet"').length - 1, 'one table, one page').toBe(1);
  });

  it('prints a record holding both as two memos, the renewal first', () => {
    const both = memo({
      extension: {
        vehicles: [{ vehicleId: null, code: null, plate: 'ن ص 1' }],
        items: [
          { itemId: null, label: 'تصوير', amount: 18, count: 1, paidBy: 'cash', receipt: false },
        ],
      },
    });
    const docs = memosOf(both);
    expect(docs.map((doc) => doc.kind)).toEqual(['renewal', 'extension']);
    expect(memoTitle(docs[1]!)).toContain('مد مدة سيارة واحدة');
    // An extension with nothing paid by the card has no card table.
    expect(memoHtml(docs[1]!)).not.toContain('ما تم صرفه بفيزا');
    expect(sumOf(docs.flatMap((doc) => doc.items))).toBe(638);
  });
});

describe('the licensing-expenses list', () => {
  it('lists a memo with its kind, cars and money, and the eye, edit, print and delete', () => {
    const html = renderList();
    expect(html).toContain(ar('fleet.licenseExpenses.kinds.renewal'));
    expect(html).toContain('204');
    // «مش عاوز رقم اللوحة يظهر الكود بس»: neither the registry car's plate nor a typed one.
    expect(html).not.toContain('أ ق 1761');
    expect(html).not.toContain('أ ق 1791');
    expect(html).toContain('600.00');
    expect(html).toContain('20.00');
    expect(html).toContain('620.00');
    expect(html).toContain('data-license-expense-view="lx-1"');
    expect(html).toContain('data-license-expense-edit="lx-1"');
    expect(html).toContain('data-license-expense-print="lx-1"');
    expect(html).toContain('data-license-expense-delete="lx-1"');
    expect(html).toContain('data-license-expense-new="true"');
  });

  it('offers only what the grants allow', () => {
    const html = renderList(['fleetLicenseExpense.view']);
    expect(html).toContain('data-license-expense-view="lx-1"');
    expect(html).toContain('data-license-expense-print="lx-1"');
    expect(html).not.toContain('data-license-expense-edit=');
    expect(html).not.toContain('data-license-expense-delete=');
    expect(html).not.toContain('data-license-expense-new=');
  });
});

/** The page's source, comments stripped — for what a static render cannot reach. */
const HERE = dirname(fileURLToPath(import.meta.url));
const code = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('«ضيف كل حاجه كنا عملنها» — the list wears what the other boards wear', () => {
  it('opens on the toolbar: the count as a status, the Excel / PDF pill, the set-up and the add', () => {
    const html = renderList();
    expect(html).toContain('data-license-expenses-toolbar="true"');
    expect(html).toMatch(/role="status" data-filtered-count="true"/u);
    expect(html).toContain(`title="${ar('fleet.filters.matchedRows')}"`);
    expect(html).toContain('data-export="license-expenses"');
    expect(html).toContain('data-print="license-expenses"');
    expect(html).toContain('data-license-expense-stats-toggle="true"');
    expect(html).toContain('data-license-expense-setup="true"');
    expect(html, 'no page title').not.toContain('<h1');
  });

  it('filters by the memo’s dates too — the coloured calendar opens the picker', () => {
    const html = renderList();
    expect(html).toContain('data-date-caption="from"');
    expect(html).toContain('data-date-caption="to"');
    expect(html.split('data-date-picker-button="true"').length - 1).toBe(2);
  });

  it('writes the date year first, the money with «ج.م.» apart, each code a bold chip', () => {
    const html = renderList();
    expect(html).toContain('>2026/10/04</span>');
    // The figure and the currency are two spans — the boards' monospace figure, the page's «ج.م.».
    expect(html).toMatch(/>600\.00<\/span><span class="text-sm[^"]*">ج\.م\.‏?<\/span>/u);
    expect(html).toContain('>620.00</span>');
    expect(html).toContain('data-license-expense-cars="lx-1"');
  });

  it('shows the cars by their registry codes only — a typed plate is counted, never written', () => {
    const html = renderList();
    const cell = html.slice(
      html.indexOf('data-license-expense-cars="lx-1"'),
      html.indexOf('data-license-expense-view="lx-1"'),
    );
    // How many — both cars, the hand-typed one too — as a Latin figure ahead of the chips.
    expect(cell).toMatch(
      /data-license-expense-cars-count="lx-1" class="[^"]*rounded-full[^"]*">2</u,
    );
    // The code: a chip in the boards' figure type, left to right.
    expect(cell).toMatch(
      /<span dir="ltr" data-license-expense-car-code="204" class="rounded-md border[^"]*">204<\/span>/u,
    );
    expect(cell.split('data-license-expense-car-code=').length - 1).toBe(1);
    // The typed one: a muted count after the chips, so it does not silently disappear.
    expect(cell).toMatch(
      /data-license-expense-unregistered="lx-1" class="[^"]*text-slate-500[^"]*">\u2066\+1\u2069 غير مسجلة</u,
    );
    // The hover title says the same — codes and the count, no plate.
    expect(html).toContain('title="204، 1 غير مسجلة"');
    expect(cell).not.toContain('أ ق');
  });

  it('draws a memo of typed plates only as its count and «غير مسجلة» — no chip, no plate', () => {
    const html = renderList(ALL, [
      memo({
        renewal: {
          vehicles: [
            { vehicleId: null, code: null, plate: 'ن ص 1' },
            { vehicleId: null, code: null, plate: 'ن ص 2' },
          ],
          items: [],
        },
      }),
    ]);
    expect(html).toMatch(/data-license-expense-cars-count="lx-1" class="[^"]*">2</u);
    expect(html).not.toContain('data-license-expense-car-code=');
    expect(html).toMatch(/data-license-expense-unregistered="lx-1" class="[^"]*">غير مسجلة</u);
    expect(html).toContain('title="2 غير مسجلة"');
    expect(html).not.toContain('ن ص');
  });

  it('reads the codes from both halves in order, and counts a car without one', () => {
    const both = memo({
      renewal: {
        vehicles: [
          { vehicleId: 'v-1', code: '204', plate: 'أ ق 1761' },
          { vehicleId: null, code: null, plate: 'أ ق 1791' },
        ],
        items: [],
      },
      extension: {
        vehicles: [
          { vehicleId: 'v-2', code: ' 318 ', plate: 'ب ج 22' },
          { vehicleId: null, code: '', plate: 'د هـ 3' },
        ],
        items: [],
      },
    });
    expect(carCodesOf(both)).toEqual({ codes: ['204', '318'], unregistered: 2 });
    expect(carCodesOf(memo({ renewal: { vehicles: [], items: [] } }))).toEqual({
      codes: [],
      unregistered: 0,
    });
    // The cell never reaches for a plate; the arrow still orders by every car.
    const source = code('LicenseExpensesPage.tsx');
    const column = source.slice(source.indexOf("key: 'cars',"), source.indexOf("key: 'visa',"));
    expect(column).toContain("sortKey: 'carsCount'");
    expect(column).toContain('carCodesOf(row)');
    expect(column, 'no plate on the screen').not.toMatch(/plate|carName/u);
  });

  it('draws an empty cell as a grey dash — a memo with no cars and nothing in cash', () => {
    const html = renderList(ALL, [
      memo({
        renewal: {
          vehicles: [],
          items: [
            { itemId: null, label: 'أمان', amount: 600, count: 1, paidBy: 'visa', receipt: true },
          ],
        },
      }),
    ]);
    expect(html).not.toContain('data-license-expense-cars=');
    expect(html.split('<span class="text-slate-400">—</span>').length - 1).toBe(2);
  });

  it('leaves the same cells empty in the Excel and the PDF — no «0.00» nobody paid', () => {
    // One rule for the cell, the sheet and the print: `null` is the dash.
    const cardOnly = memo({
      renewal: {
        vehicles: [],
        items: [
          { itemId: null, label: 'أمان', amount: 600, count: 1, paidBy: 'visa', receipt: true },
        ],
      },
    });
    expect(moneyOf(cardOnly, 'visa')).toBe(600);
    expect(moneyOf(cardOnly, 'cash')).toBeNull();
    expect(moneyOf(cardOnly, 'total')).toBe(600);
    const empty = memo({ renewal: { vehicles: [], items: [] } });
    expect(moneyOf(empty, 'total')).toBeNull();
    // A line with no amount written was still paid that way: a figure, not a dash.
    const unwritten = memo({
      renewal: {
        vehicles: [],
        items: [
          { itemId: null, label: 'دمغة', amount: null, count: 2, paidBy: 'cash', receipt: true },
        ],
      },
    });
    expect(moneyOf(unwritten, 'cash')).toBe(0);
    // Both files read their money cells through it, a blank in the sheet and the dash in the PDF.
    const source = code('LicenseExpensesPage.tsx');
    expect(source).toContain("...MONEY_COLUMNS.map((column) => moneyOf(row, column) ?? ''),");
    expect(source).toContain("return value === null ? '—' : reportMoney(value);");
    expect(source, 'no money cell bypasses it').not.toMatch(
      /reportMoney\(sumOf|reportMoney\(paid/u,
    );
  });

  it('centres every column but the actions, in the boards’ table and the alarms board’s type', () => {
    const source = code('LicenseExpensesPage.tsx');
    for (const key of ['date', 'kind', 'cars', 'visa', 'cash', 'total']) {
      const at = source.indexOf(`key: '${key}',`);
      expect(source.slice(at, source.indexOf("key: '", at + 10)), key).toContain("align: 'center'");
    }
    expect(source).toContain('DARK_TABLE,');
    expect(source).toContain('ALARMS_TYPE,');
    expect(source).toContain('[&_td+td]:!border-s-0 [&_th+th]:!border-s-0');
    expect(source).toContain('minColumnWidth={4}');
  });

  it('puts an arrow on every column and asks the server, several at once', () => {
    const html = renderList();
    // Six sortable headers; the default order lights the date's arrow, descending.
    expect(
      html.split('<button type="button" class="inline-flex items-center gap-1 rounded').length - 1,
    ).toBe(6);
    // How the click and the request are wired is the Fleet tables' census
    // (`fleet-table-sort.spec.tsx`), which counts this page among the server-paged registers.
  });

  it('reads «الإحصائيات» from the server’s sums over the whole filtered set, not this page', () => {
    const source = code('LicenseExpensesPage.tsx');
    expect(source).toContain('useLicenseExpenseSummary(filters)');
    expect(source, 'nothing summed from the rows on screen').not.toMatch(/rows\.reduce/u);
    // «الاجماليات تكون بين الجدول والفلاتر».
    const strip = source.indexOf('data-license-expense-figures="true"');
    expect(strip).toBeGreaterThan(source.indexOf('<FilterBar'));
    expect(strip).toBeLessThan(source.indexOf('<DataTable'));
  });

  it('remembers the dates and the order with the other filters', () => {
    expect(code('LicenseExpensesPage.tsx')).toContain(
      "const REMEMBERED_FILTERS = ['from', 'to', 'vehicleCodes', 'kind', 'size', 'sort'] as const;",
    );
  });
});

describe('a new licensing-expenses memo', () => {
  it('starts as a renewal with a counter per item, a live preview and the department names', () => {
    const html = renderEditor();
    expect(html).toMatch(/aria-pressed="true"[^>]*data-license-expense-kind="renewal"/u);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-license-expense-kind="extension"/u);
    // «يبقى فيه تجميع»: the card's group and the cash group, each with its own counters.
    expect(html).toContain('data-license-expense-group="renewal:visa"');
    expect(html).toContain('data-license-expense-group="renewal:cash"');
    expect(html).toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(html).toContain('data-license-expense-count="renewal:cash:i-2"');
    expect(html, 'no per-line visa / cash switch').not.toContain('data-segment="paid-');
    expect(html).toContain('data-license-expense-preview="renewal"');
    expect(html).not.toContain('data-license-expense-preview="extension"');
    expect(html).toContain('طلعت جابر بحيري');
    expect(html).toContain('data-license-expense-save="true"');
    expect(html).toContain('data-license-expense-save-defaults="true"');
  });

  it('wears the forms’ design: the header with Save on it, sections with icons, nothing required', () => {
    const html = renderEditor();
    // `DesignSave`: the indigo button, told when it is busy.
    expect(html).toMatch(
      /aria-busy="false"[^>]*data-license-expense-save="true"|data-license-expense-save="true"[^>]*aria-busy="false"/u,
    );
    expect(html).toContain('<header');
    for (const title of [
      'fleet.licenseExpenses.memoSection',
      'fleet.licenseExpenses.carsSection',
      'fleet.licenseExpenses.group.visa',
      'fleet.licenseExpenses.group.cash',
      'fleet.licenseExpenses.signaturesSection',
    ]) {
      expect(html, title).toMatch(
        new RegExp(
          `<h3 class="flex items-center gap-2[^"]*"><svg[^]*?</svg>${ar(title)}</h3>`,
          'u',
        ),
      );
    }
    expect(html, 'no star — nothing on the memo is required').not.toContain('text-rose-500">*');
    // The memo's title as it prints, under the page's.
    expect(html).toContain('مذكرة بمصروفات تجديد تراخيص');
  });

  it('keeps the visa and cash groups out of the state colours', () => {
    const group = code('../components/LicenseExpensePaidGroup.tsx');
    expect(group).not.toMatch(/emerald|amber/u);
  });
});

describe("each memo's items, as «قوائم الحركة» sets them", () => {
  // «هضيف البنود واحدد تبع تجديد التراخيص ولا مد المده».
  const ITEMS = [
    catalogItem('i-1', 'براءة ذمة', 'renewal'),
    catalogItem('i-2', 'استعلام أمني', 'extension'),
    catalogItem('i-3', 'ضرائب'),
  ];

  it("counts the renewal's items and those in both, in the card's group and the cash group", () => {
    const html = renderEditor(ITEMS);
    for (const paid of ['visa', 'cash']) {
      expect(html).toContain(`data-license-expense-count="renewal:${paid}:i-1"`);
      expect(html).toContain(`data-license-expense-count="renewal:${paid}:i-3"`);
      expect(html, 'an extension item').not.toContain(
        `data-license-expense-count="renewal:${paid}:i-2"`,
      );
    }
  });

  it('offers every item while none says which memo it belongs to, as before', () => {
    const html = renderEditor();
    expect(html).toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(html).toContain('data-license-expense-count="renewal:visa:i-2"');
  });
});

describe('«قوائم الحركة» says which memo each item belongs to', () => {
  const ITEMS = [
    catalogItem('i-1', 'براءة ذمة', 'renewal'),
    catalogItem('i-2', 'استعلام أمني', 'extension'),
    catalogItem('i-3', 'ضرائب'),
  ];
  const mount = (node: JSX.Element, route = '/fleet/catalogs'): string => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
    });
    qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'licenseExpenseItem' }), {
      items: ITEMS,
      meta: { page: 1, pageSize: 100, totalItems: ITEMS.length, totalPages: 1 },
    });
    return renderToStaticMarkup(
      <Provider store={store([...ALL, 'fleetCatalog.manage'])}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('shows the memo on the items tab — the renewal, the extension, or both', () => {
    const html = mount(<CatalogsPage />, '/fleet/catalogs?kind=licenseExpenseItem');
    expect(html).toContain(ar('fleet.catalogs.fields.licenseExpenseKind'));
    expect(html).toMatch(/data-license-expense-kind="renewal"[^>]*>تجديد تراخيص</u);
    expect(html).toMatch(/data-license-expense-kind="extension"[^>]*>مد مدة</u);
    expect(html).toMatch(/data-license-expense-kind="both"[^>]*>كليهما</u);
  });

  it('asks it in the item form, the saved one pressed and both for a new item', () => {
    const edit = mount(
      <CatalogItemDialog
        open
        onClose={() => undefined}
        kind="licenseExpenseItem"
        item={ITEMS[1]!}
      />,
    );
    expect(edit).toMatch(/aria-pressed="true"[^>]*data-license-expense-kind-option="extension"/u);
    expect(edit).toMatch(/aria-pressed="false"[^>]*data-license-expense-kind-option="renewal"/u);
    expect(edit).toMatch(/aria-pressed="false"[^>]*data-license-expense-kind-option="both"/u);
    const fresh = mount(
      <CatalogItemDialog open onClose={() => undefined} kind="licenseExpenseItem" item={null} />,
    );
    // Nothing is required: a new item is in both until somebody says otherwise.
    expect(fresh).toMatch(/aria-pressed="true"[^>]*data-license-expense-kind-option="both"/u);
  });

  it('asks it of no other list', () => {
    const html = mount(
      <CatalogItemDialog open onClose={() => undefined} kind="workshop" item={null} />,
    );
    expect(html).not.toContain('data-license-expense-kind-option');
  });
});
