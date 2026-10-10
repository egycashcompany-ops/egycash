// «مصروفات التراخيص», proven against what it produces: the memo sheet is the department's own (its
// title, the card's table and the cash table, the totals and the signatures); a record that holds
// both memos prints as two; the list offers the eye, edit and delete by grant; and a new memo
// starts with the counters of the department's items and the set-up's names.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetCatalogItemDto,
  type FleetLicenseExpenseDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { LicenseExpensesPage } from './LicenseExpensesPage';
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

const renderList = (permissions = ALL, rows = [memo()]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'licenseExpenses', { page: 1, pageSize: 25 }), {
    items: rows,
    meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
  });
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
    expect(html).toContain('أ ق 1791');
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
