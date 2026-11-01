// «وفى /it/custody بردو عايز الصنف يبقي بعد الفئة (فى الفلتر فقط) ونفس الكلام يتفلتر والأتنين يكونوا
// Multiselect» — the custody register's bar, proven against what it renders: the free-text search
// stays first under «بحث», then «الفئة», then «الصنف» right after it, both taking several answers;
// the lists in the URL are what the register asks for, a name holding a comma among them; and the
// table's own columns keep their order. What the files say is `lib/custody-register-export.spec.ts`.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { joinNameList, type ItAssetAssignmentDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { CustodyPage } from './CustodyPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

const me = {
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
  permissions: { 'itAsset.view': 'organization' },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const interval = (over: Partial<ItAssetAssignmentDto> = {}): ItAssetAssignmentDto => ({
  id: 'a-1',
  assetId: 'asset-1',
  assignedToEmployeeId: 'e-1',
  assignedToEmployeeCode: '0100052',
  assignedToEmployeeName: 'محمد أحمد علي',
  assetCode: 'AST-00012',
  assetName: 'Lenovo ThinkCentre neo 50a 24',
  assetSerialNumber: 'PF3ABC12',
  assignedByUserId: null,
  assignedAt: '2026-10-07T09:00:00.000Z',
  conditionOnIssue: null,
  expectedReturnAt: null,
  returnedAt: null,
  returnedToUserId: null,
  conditionOnReturn: null,
  notes: null,
  branchId: 'b-hq',
  receiptId: null,
  receiptSigned: null,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const NAME = 'Lenovo ThinkCentre neo 50a 24';
// Free text, so it may hold a comma — and must reach the filter whole.
const COMMA_NAME = 'Raml, Station';
const LENOVO = interval();
const PRINTER = interval({
  id: 'a-2',
  assetId: 'asset-2',
  assetCode: 'AST-00015',
  assetName: COMMA_NAME,
});
const OTHER = interval({ id: 'a-3', assetId: 'asset-3', assetCode: 'AST-00099', assetName: 'X' });

const DEFAULT = { page: 1, pageSize: 25, sortBy: 'assignedAt', sortDir: 'desc', open: true };

const category = (id: string, name: string) => ({
  id,
  kind: 'assetCategory' as const,
  code: null,
  name: { ar: name, en: name },
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
});

const render = (path = '/it/custody'): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const page = (items: ItAssetAssignmentDto[]) => ({
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  });
  // The register as the screen asks for it: unfiltered; by one category (a link from when the
  // filter took one); and by two categories and two items, one holding a comma — the request
  // carries the items as ONE escaped list in `assetName`.
  qc.setQueryData(listKey('it', 'custody', DEFAULT), page([LENOVO, PRINTER, OTHER]));
  qc.setQueryData(listKey('it', 'custody', { ...DEFAULT, categoryId: 'c-pc' }), page([LENOVO]));
  qc.setQueryData(
    listKey('it', 'custody', {
      ...DEFAULT,
      categoryId: 'c-printer,c-pc',
      assetName: joinNameList([COMMA_NAME, NAME]),
    }),
    page([LENOVO, PRINTER]),
  );
  qc.setQueryData(listKey('it', 'assets', { names: true, categoryId: [] }), {
    names: [NAME, COMMA_NAME, 'X'],
    truncated: false,
  });
  qc.setQueryData(listKey('it', 'assets', { names: true, categoryId: ['c-pc', 'c-printer'] }), {
    names: [NAME, COMMA_NAME],
    truncated: false,
  });
  qc.setQueryData(listKey('it', 'catalogs', { kind: 'assetCategory', select: true }), {
    items: [category('c-pc', 'كمبيوتر'), category('c-printer', 'طابعات')],
    meta: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
  });
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/it/custody" element={<CustodyPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '').trim();

/** The bar's filters by the names written above them, in the order they stand. */
const fields = (html: string): string[] =>
  [...html.matchAll(/data-filter-field="([^"]*)"/gu)].map((m) => m[1] ?? '');

/** The table's column headings, in order. */
const headings = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map((m) => text(m[1] ?? ''));

/** Where a multi-select's trigger sits in the markup — by the question it asks. */
const multiSelectAt = (html: string, label: string): number =>
  html.indexOf(`aria-haspopup="listbox" aria-expanded="false" aria-label="${label}"`);

describe('the custody register’s bar', () => {
  const html = render();
  const bar = fields(html);
  const search = ar('common.search');
  const categoryLabel = ar('it.assets.columns.category');
  const item = ar('it.custody.asset');

  it('keeps the search first, named «بحث» so the bar does not ask «الصنف» twice', () => {
    expect(bar[0]).toBe(search);
    expect(bar.filter((name) => name === item)).toHaveLength(1);
    expect(html).toContain(`placeholder="${ar('it.custody.searchPlaceholder')}"`);
  });

  it('puts «الصنف» right after «الفئة» — «الصنف يبقي بعد الفئة» — then the rest as before', () => {
    expect(bar.slice(0, 4)).toEqual([search, categoryLabel, item, ar('it.custody.assignedAt')]);
  });

  it('makes both of them take several answers — «Multiselect»', () => {
    expect(multiSelectAt(html, categoryLabel)).toBeGreaterThan(-1);
    expect(multiSelectAt(html, item)).toBeGreaterThan(multiSelectAt(html, categoryLabel));
    // Nothing chosen: under the names above them, the triggers say «all».
    expect(html).toContain(ar('it.assets.allCategories'));
  });

  it('changes the bar only — the table still opens on the item', () => {
    expect(headings(html)[0]).toBe(item);
  });
});

describe('the lists in the URL', () => {
  it('read a link from when the category took one value — a list of one', () => {
    const html = render('/it/custody?category=c-pc');
    expect(html).toContain('AST-00012');
    expect(html).not.toContain('AST-00015');
    expect(html).toContain('title="كمبيوتر"');
  });

  it('ask for every category and every item — a name holding a comma, whole', () => {
    const query = new URLSearchParams({
      category: 'c-printer,c-pc',
      asset: joinNameList([COMMA_NAME, NAME]),
    });
    const html = render(`/it/custody?${query.toString()}`);
    expect(html).toContain('AST-00012');
    expect(html).toContain('AST-00015');
    expect(html).not.toContain('AST-00099');
    expect(html).toContain('title="طابعات, كمبيوتر"');
    expect(html).toContain(`title="${COMMA_NAME}, ${NAME}"`);
    expect(html).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });
});
