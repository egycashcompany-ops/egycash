// «المواقع» (2026-11-19) — the catalogs page's fourth tab: each branch's places, after the catalog's
// kinds and not one of them, with «في عهدته الآن» opening what is held there and a retired place
// said to be retired.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ItLocationDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { ItCatalogsPage } from './ItCatalogsPage';

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
  permissions: { 'itCatalog.manage': 'organization', 'itAsset.view': 'organization' },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const T = '2026-11-19T09:00:00.000Z';
const place = (over: Partial<ItLocationDto>): ItLocationDto => ({
  id: 'l-servers',
  branchId: 'b-asyut',
  name: { ar: 'غرفة السيرفرات', en: 'Server room' },
  code: 'SRV',
  description: 'الدور الثاني',
  sortOrder: 0,
  isActive: true,
  heldAssets: 3,
  version: 0,
  createdAt: T,
  updatedAt: T,
  ...over,
});
const PLACES = [
  place({}),
  place({
    id: 'l-old',
    name: { ar: 'المخزن القديم', en: 'Old store' },
    code: null,
    description: null,
    isActive: false,
    heldAssets: 0,
  }),
];

const render = (path: string): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const page = <T,>(items: T[]) => ({
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  });
  qc.setQueryData(listKey('it', 'locations', { page: 1, pageSize: 25 }), page(PLACES));
  qc.setQueryData(
    listKey('it', 'locations', { page: 1, pageSize: 25, branchId: 'b-asyut', isActive: true }),
    page([PLACES[0]]),
  );
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-asyut', code: '04', name: { ar: 'أسيوط', en: 'Asyut' }, parentId: null },
  ]);
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
            <Route path="/it/catalogs" element={<ItCatalogsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the catalogs page’s «المواقع» tab', () => {
  const html = render('/it/catalogs?kind=location');

  it('is a fourth tab after the kinds, chosen by `?kind=location`', () => {
    expect(html).toMatch(/aria-selected="true"[^>]*data-catalogs-tab="location"/u);
    expect(html.indexOf(ar('it.catalogs.kind.consumableType'))).toBeLessThan(
      html.indexOf(ar('it.locations.tab')),
    );
    // The header's action adds a place here, not a catalog row.
    expect(html).toContain(ar('it.locations.add'));
    expect(html).not.toContain(ar('it.catalogs.addItem'));
  });

  it('lists each place with its branch, and «في عهدته الآن» opening what is held there', () => {
    expect(html).toContain('غرفة السيرفرات');
    expect(html).toContain('أسيوط');
    expect(html).toContain(ar('it.locations.columns.heldAssets'));
    expect(html).toContain('href="/it/assets?location=l-servers"');
    // Nothing held: a figure, not a link.
    expect(html).not.toContain('href="/it/assets?location=l-old"');
  });

  it('says a retired place is retired — never deleted', () => {
    expect(html).toContain(ar('it.locations.retired'));
  });

  it('asks for the branch and the status the bar names', () => {
    const narrowed = render('/it/catalogs?kind=location&branch=b-asyut&active=true');
    expect(narrowed).toContain('غرفة السيرفرات');
    expect(narrowed).not.toContain('المخزن القديم');
  });

  it('the kinds’ tabs are unchanged — no place on them', () => {
    const categories = render('/it/catalogs');
    expect(categories).toMatch(/aria-selected="false"[^>]*data-catalogs-tab="location"/u);
    expect(categories).not.toContain('غرفة السيرفرات');
    expect(categories).toContain(ar('it.catalogs.addItem'));
  });
});
