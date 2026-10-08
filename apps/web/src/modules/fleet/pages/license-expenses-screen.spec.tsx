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
import { LicenseExpenseItemChoiceDialog } from '../components/LicenseExpenseItemChoiceDialog';
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

const catalogItem = (id: string, name: string): FleetCatalogItemDto =>
  ({
    id,
    kind: 'licenseExpenseItem',
    name: { ar: name, en: name },
    isActive: true,
  }) as unknown as FleetCatalogItemDto;

const renderEditor = (
  options: {
    items?: { renewal: string[] | null; extension: string[] | null };
    permissions?: string[];
  } = {},
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'catalogs', { kind: 'licenseExpenseItem' }), {
    items: [catalogItem('i-1', 'براءة ذمة'), catalogItem('i-2', 'ضرائب')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: [],
    meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 },
  });
  qc.setQueryData(['fleet', 'licenseExpenses', 'settings'], {
    signatures: SIGNATURES,
    templates: { renewal: { visa: [], cash: [] }, extension: { visa: [], cash: [] } },
    ...(options.items === undefined ? {} : { items: options.items }),
    version: 0,
  });
  return renderToStaticMarkup(
    <Provider store={store(options.permissions ?? ALL)}>
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

describe("each memo's items, as the owner chooses them", () => {
  it('offers every item while nobody has chosen, as before', () => {
    const html = renderEditor({ items: { renewal: null, extension: null } });
    expect(html).toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(html).toContain('data-license-expense-count="renewal:visa:i-2"');
    expect(html).toContain(ar('fleet.licenseExpenses.itemChoice.button', { n: 2, total: 2 }));
  });

  it("offers only the memo's chosen items as counters, in the card's group and the cash group", () => {
    // «انا اللى احدد يبقى فى كل واحده».
    const html = renderEditor({ items: { renewal: ['i-2'], extension: null } });
    expect(html).toContain('data-license-expense-count="renewal:visa:i-2"');
    expect(html).toContain('data-license-expense-count="renewal:cash:i-2"');
    expect(html).not.toContain('data-license-expense-count="renewal:visa:i-1"');
    expect(html).not.toContain('data-license-expense-count="renewal:cash:i-1"');
    expect(html).toContain('data-license-expense-choose-items="renewal"');
    expect(html).toContain(ar('fleet.licenseExpenses.itemChoice.button', { n: 1, total: 2 }));
  });

  it('keeps the choosing to a writer who may keep the set-up', () => {
    const html = renderEditor({
      items: { renewal: ['i-2'], extension: null },
      permissions: ['fleetLicenseExpense.view', 'fleetLicenseExpense.create'],
    });
    expect(html).not.toContain('data-license-expense-choose-items=');
    // The choice still applies to them.
    expect(html).not.toContain('data-license-expense-count="renewal:visa:i-1"');
  });
});

describe("the list the owner ticks a memo's items in", () => {
  const ITEMS = [
    { id: 'i-1', name: 'براءة ذمة' },
    { id: 'i-2', name: 'ضرائب' },
    { id: 'i-3', name: 'دمغة' },
  ];
  const dialog = (chosen: ReadonlySet<string> | null, items = ITEMS): string =>
    renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <LicenseExpenseItemChoiceDialog
          open
          onClose={() => undefined}
          kind="extension"
          items={items}
          chosen={chosen}
          saving={false}
          onSave={() => undefined}
        />
      </Provider>,
    );

  it("lists every item, the memo's own pressed", () => {
    const html = dialog(new Set(['i-2']));
    expect(html).toContain(ar('fleet.licenseExpenses.itemChoice.title.extension'));
    expect(html).toMatch(
      /aria-pressed="false"[^>]*data-license-expense-item-choice="extension:i-1"/u,
    );
    expect(html).toMatch(
      /aria-pressed="true"[^>]*data-license-expense-item-choice="extension:i-2"/u,
    );
    expect(html).toMatch(
      /aria-pressed="false"[^>]*data-license-expense-item-choice="extension:i-3"/u,
    );
  });

  it('cannot be saved before the list has loaded — an empty list would erase the choice', () => {
    const html = dialog(new Set(['i-2']), []);
    expect(html).toMatch(/disabled=""[^>]*data-license-expense-item-choice-save="extension"/u);
  });
});
