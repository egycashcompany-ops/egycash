// Test fixtures for the Administrative Affairs screens: a signed-in reader holding exactly the keys
// a case names, a query cache seeded with what the screen asks for, and the module's records as the
// API answers them. Imported by specs only. The names are invented: the repository is public.
import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
  type AdministrationWarehouseBranchOptionDto,
  type AdministrationWarehouseDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';

export const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const STAMP = '2026-11-24T09:00:00.000Z';

/** A signed-in reader holding `keys`, each at organization scope. */
export const meWith = (keys: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'reader@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(keys.map((key) => [key, 'organization'])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

export const pageOf = <T,>(items: T[], totalItems = items.length): Paginated<T> => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 25)) },
});

/**
 * The screen's markup, rendered at `path` under `route`, for a reader holding `keys`, with the
 * cache seeded by `seed` — and `failing` keys answering as failed reads.
 */
export const renderScreen = ({
  element,
  route,
  path,
  keys,
  seed = [],
  failing = [],
}: {
  element: ReactElement;
  route: string;
  path: string;
  keys: readonly string[];
  seed?: readonly (readonly [readonly unknown[], unknown])[];
  failing?: readonly (readonly unknown[])[];
}): string => {
  const qc = new QueryClient({
    // `retryOnMount: false`, or a failed read would be shown as loading again on mount.
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  for (const [key, value] of seed) qc.setQueryData(key, value);
  for (const key of failing) {
    // A read that failed, as TanStack Query keeps one: no data, an error, status `error`.
    qc.getQueryCache()
      .build(qc, { queryKey: key })
      .setState({
        status: 'error',
        error: new Error('boom'),
        fetchStatus: 'idle',
      });
  }
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: meWith(keys), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Text without its markup. */
export const text = (markup: string): string => markup.replace(/<[^>]*>/gu, '').trim();

/** The table's column headings, in order. */
export const headings = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gu)].map((m) => text(m[1] ?? ''));

/** The cells of the row that carries `marker`, as markup. */
export const rowOf = (html: string, marker: string): string[] => {
  const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gu)].find((m) =>
    (m[1] ?? '').includes(marker),
  );
  return [...(row?.[1] ?? '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gu)].map((m) => m[1] ?? '');
};

// ── Records as the API answers them ─────────────────────────────────────────

export const unit = (
  over: Partial<AdministrationCatalogItemDto> = {},
): AdministrationCatalogItemDto => ({
  id: 'u-pcs',
  kind: 'unit',
  code: 'pcs',
  name: { ar: 'قطعة', en: 'Piece' },
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const category = (
  over: Partial<AdministrationItemCategoryDto> = {},
): AdministrationItemCategoryDto => ({
  id: 'c-ink',
  code: null,
  name: { ar: 'الأحبار', en: 'Inks' },
  parentId: null,
  parentName: null,
  description: null,
  sortOrder: 0,
  isActive: true,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const item = (over: Partial<AdministrationItemDto> = {}): AdministrationItemDto => ({
  id: 'i-1',
  code: 'ITM-00001',
  barcode: '6221234567890',
  name: { ar: 'حبر HP 85A', en: 'HP 85A toner' },
  categoryId: 'c-laser',
  categoryName: { ar: 'حبر ليزر', en: 'Laser toner' },
  categoryParentId: 'c-ink',
  categoryParentName: { ar: 'الأحبار', en: 'Inks' },
  unitId: 'u-pcs',
  unitName: { ar: 'قطعة', en: 'Piece' },
  minQty: 2,
  reorderPointQty: 5,
  maxQty: 20,
  description: null,
  notes: null,
  stockTracked: true,
  isActive: true,
  version: 3,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const warehouse = (
  over: Partial<AdministrationWarehouseDto> = {},
): AdministrationWarehouseDto => ({
  id: 'w-1',
  code: 'CAI-01',
  name: { ar: 'مخزن القاهرة الرئيسي', en: 'Cairo main store' },
  branchId: 'b-cai',
  branchName: { ar: 'القاهرة', en: 'Cairo' },
  type: 'main',
  departmentId: null,
  responsibleEmployeeId: 'e-1',
  keeper: { employeeId: 'e-1', code: '0100052', fullNameAr: 'سامح عادل منير', status: 'active' },
  location: null,
  notes: null,
  isActive: true,
  canEdit: true,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const branchOption = (
  over: Partial<AdministrationWarehouseBranchOptionDto> = {},
): AdministrationWarehouseBranchOptionDto => ({
  branchId: 'b-cai',
  name: { ar: 'القاهرة', en: 'Cairo' },
  canView: true,
  canCreate: true,
  ...over,
});
