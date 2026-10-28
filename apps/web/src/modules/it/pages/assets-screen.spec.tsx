// «عايز فى شاشة الأصول /it/assets تزودلى بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة · وعايز
// فى الفلتر زود بعد الحالات وقبل الفئة (الاسم) ويكون Drop Down مع قابليه للكتابة» — the asset
// register, proven against what it renders: the holder's column sits right after the status, names
// the person with a link to what they hold and their code under it, and is a dash for an asset in
// stock; the name filter is a box you can type into, between the status and the category, and the
// name in the URL is what the register asks for.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ItAssetDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { AssetsListPage } from './AssetsListPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string): string => translate('ar', key);

const me: MeDto = {
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

const asset = (over: Partial<ItAssetDto> = {}): ItAssetDto => ({
  id: 'asset-1',
  assetCode: 'AST-00012',
  name: 'Lenovo ThinkCentre neo 50a 24',
  description: null,
  categoryId: 'c-pc',
  status: 'assigned',
  serialNumber: 'MP30EPER',
  model: null,
  manufacturer: null,
  externalTag: null,
  branchId: 'b-oct',
  location: null,
  purchase: null,
  warranty: null,
  currentAssignmentId: 'a-1',
  disposal: null,
  notes: null,
  specs: null,
  accessories: [],
  holder: {
    employeeId: 'e-1',
    employeeCode: '0100052',
    employeeName: 'محمد أحمد علي',
    assignedAt: '2026-10-07T09:00:00.000Z',
  },
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
  ...over,
});

const HELD = asset();
// HR has no name for this holder: the row still names them, by the id it carries.
const UNNAMED = asset({
  id: 'asset-2',
  assetCode: 'AST-00013',
  currentAssignmentId: 'a-2',
  holder: {
    employeeId: 'e-9',
    employeeCode: null,
    employeeName: null,
    assignedAt: '2026-10-08T09:00:00.000Z',
  },
});
const IN_STOCK = asset({
  id: 'asset-3',
  assetCode: 'AST-00014',
  status: 'inStock',
  currentAssignmentId: null,
  holder: null,
});

const NAME = 'Lenovo ThinkCentre neo 50a 24';
const FIRST_PAGE = { page: 1, pageSize: 25, sortBy: 'assetCode', sortDir: 'asc' };

const render = (path = '/it/assets'): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const page = (items: ItAssetDto[]) => ({
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  });
  // The register's first page as the screen asks for it — unfiltered, and narrowed to one name.
  qc.setQueryData(listKey('it', 'assets', FIRST_PAGE), page([HELD, UNNAMED, IN_STOCK]));
  qc.setQueryData(listKey('it', 'assets', { ...FIRST_PAGE, name: NAME }), page([HELD]));
  qc.setQueryData(listKey('it', 'assets', { names: true }), { names: [NAME, 'طابعة HP'] });
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
            <Route path="/it/assets" element={<AssetsListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '').trim();

/** The table's column headings, in order. */
const headings = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map((m) => text(m[1] ?? ''));

/** The cells of the row that carries `assetCode`, as markup. */
const rowOf = (html: string, assetCode: string): string[] => {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].find((m) =>
    (m[1] ?? '').includes(assetCode),
  );
  expect(row, assetCode).toBeDefined();
  return [...(row?.[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => m[1] ?? '');
};

describe('the holder’s column', () => {
  const html = render();
  const columns = headings(html);
  const holderAt = columns.indexOf(ar('it.custody.holder'));

  it('comes right after the status — «بعد الحالة»', () => {
    expect(holderAt).toBeGreaterThan(-1);
    expect(columns[holderAt - 1]).toBe(ar('it.assets.columns.status'));
  });

  it('names the holder with a link to what they hold, and their code under the name', () => {
    const cell = rowOf(html, 'AST-00012')[holderAt] ?? '';
    expect(cell).toContain('href="/it/employees/e-1"');
    expect(cell).toContain('محمد أحمد علي');
    expect(cell).toContain('0100052');
  });

  it('shows a holder HR cannot name by the id the row carries — still a link', () => {
    const cell = rowOf(html, 'AST-00013')[holderAt] ?? '';
    expect(cell).toContain('href="/it/employees/e-9"');
    expect(text(cell)).toBe('e-9');
  });

  it('is a dash for an asset nobody holds', () => {
    expect(text(rowOf(html, 'AST-00014')[holderAt] ?? '')).toBe('—');
  });
});

describe('the name filter', () => {
  it('is a box to type into, after the status and before the category — «الاسم»', () => {
    const html = render();
    const status = html.indexOf(`aria-label="${ar('it.assets.columns.status')}"`);
    const name = html.indexOf(`role="combobox" aria-label="${ar('it.assets.columns.name')}"`);
    const category = html.indexOf(`aria-label="${ar('it.assets.columns.category')}"`);
    expect(status).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(status);
    expect(category).toBeGreaterThan(name);
    expect(html).toContain(`placeholder="${ar('it.assets.columns.name')}"`);
  });

  it('asks the register for the name in the URL, shows it picked, and offers the reset', () => {
    const html = render(`/it/assets?name=${encodeURIComponent(NAME)}`);
    expect(html).toContain(`value="${NAME}"`);
    // Only the one asset by that name — the request carried `name`.
    expect(html).toContain('AST-00012');
    expect(html).not.toContain('AST-00014');
    expect(html).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('offers no reset while nothing is filtered', () => {
    expect(render()).not.toContain(`aria-label="${ar('common.filters.clear')}"`);
  });
});
