// «عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول», then «اعمل نفس
// الزرارين في شاشة الأصول · كمان عايز الزرارين قبل مش بعد زرار الـ Action بتاع الفورم · كمان عايزك
// تشيل كلمة تصدير من الزراير» — the two buttons on the custody register and on the asset list,
// BEFORE each screen's own action, saying just «Excel» and «PDF», for everybody who can read the
// list — and on the mobile lines (FR-19) the same. What the files hold is the `lib/*-export.spec.ts`
// files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ItAssetAssignmentDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { CustodyPage } from './CustodyPage';
import { AssetsListPage } from './AssetsListPage';
import { MobileLinesPage } from './MobileLinesPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'CustodyPage.tsx'), 'utf8');
const ASSETS = readFileSync(join(HERE, 'AssetsListPage.tsx'), 'utf8');
const LINES = readFileSync(join(HERE, 'MobileLinesPage.tsx'), 'utf8');
const ar = (key: string): string => translate('ar', key);

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

const interval: ItAssetAssignmentDto = {
  id: 'a-1',
  assetId: 'asset-1',
  assignedToEmployeeId: 'e-1',
  assignedToEmployeeCode: '0100052',
  assignedToEmployeeName: 'محمد أحمد علي',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
  assignedByUserId: null,
  assignedAt: '2026-10-07T09:00:00.000Z',
  conditionOnIssue: null,
  expectedReturnAt: null,
  returnedAt: null,
  returnedToUserId: null,
  conditionOnReturn: null,
  notes: null,
  branchId: 'b-hq',
  receiptId: 'r-1',
  receiptSigned: false,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
};

const asset = {
  id: 'asset-1',
  assetCode: 'AST-00012',
  name: 'لاب توب Lenovo',
  description: null,
  categoryId: 'c-laptop',
  status: 'assigned',
  serialNumber: 'PF3ABC12',
  model: null,
  manufacturer: null,
  externalTag: null,
  branchId: 'b-hq',
  location: null,
  purchase: null,
  warranty: null,
  currentAssignmentId: 'a-1',
  disposal: null,
  notes: null,
  specs: null,
  accessories: [],
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
};

type Screen = 'custody' | 'assets' | 'lines';
const PATHS: Record<Screen, string> = {
  custody: '/it/custody',
  assets: '/it/assets',
  lines: '/it/mobile-lines',
};
const PAGES: Record<Screen, JSX.Element> = {
  custody: <CustodyPage />,
  assets: <AssetsListPage />,
  lines: <MobileLinesPage />,
};

const render = (screen: Screen, permissions: string[]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // Each register's first page as the screen asks for it by default.
  qc.setQueryData(
    listKey('it', 'custody', {
      page: 1,
      pageSize: 25,
      sortBy: 'assignedAt',
      sortDir: 'desc',
      open: true,
    }),
    { items: [interval], meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
  );
  qc.setQueryData(
    listKey('it', 'assets', { page: 1, pageSize: 25, sortBy: 'assetCode', sortDir: 'asc' }),
    { items: [asset], meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
  );
  // The lines' register in its own order (no sort chosen), and its cards' figures.
  qc.setQueryData(listKey('it', 'mobileLines', { page: 1, pageSize: 25 }), {
    items: [],
    meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
  });
  qc.setQueryData(listKey('it', 'mobileLines', { summary: true }), { networks: [] });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const path = PATHS[screen];
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={PAGES[screen]} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The text of the button carrying `attribute`, its markup stripped. */
const buttonText = (html: string, attribute: string): string => {
  const at = html.indexOf(attribute);
  expect(at, attribute).toBeGreaterThan(-1);
  const inner = html.slice(html.indexOf('>', at) + 1, html.indexOf('</button>', at));
  return inner.replace(/<[^>]*>/gu, '').trim();
};

describe.each([
  {
    screen: 'custody' as const,
    name: 'it-custody',
    action: 'it.custody.receipt.title',
    actionPermission: 'itAsset.assign',
    filter: 'it.custody.filterOpen',
    source: PAGE,
    list: 'gatherRegister(params, api.listAssignments)',
  },
  {
    screen: 'assets' as const,
    name: 'it-assets',
    action: 'it.assets.create',
    actionPermission: 'itAsset.create',
    filter: 'it.assets.allStatuses',
    source: ASSETS,
    list: 'gatherRegister(params, api.listAssets)',
  },
  {
    screen: 'lines' as const,
    name: 'it-mobile-lines',
    action: 'it.mobileLines.create',
    actionPermission: 'itAsset.create',
    filter: 'it.mobileLines.allStatuses',
    source: LINES,
    list: 'gatherRegister(params, api.listMobileLines)',
  },
])(
  'the $screen screen’s Excel and PDF',
  ({ screen, name, action, actionPermission, filter, source, list }) => {
    it('come BEFORE the form’s action, in the page’s header, above the filters', () => {
      const html = render(screen, ['itAsset.view', actionPermission]);
      const excel = html.indexOf(`data-export="${name}"`);
      const pdf = html.indexOf(`data-print="${name}"`);
      const formAction = html.indexOf(ar(action));
      expect(excel).toBeGreaterThan(-1);
      expect(pdf).toBeGreaterThan(excel);
      expect(formAction).toBeGreaterThan(pdf);
      // The header's own action row, not somewhere down the page.
      expect(formAction).toBeLessThan(html.indexOf(ar(filter)));
    });

    it('say just «Excel» and «PDF» — no «تصدير»', () => {
      const html = render(screen, ['itAsset.view', actionPermission]);
      expect(buttonText(html, `data-export="${name}"`)).toBe('Excel');
      expect(buttonText(html, `data-print="${name}"`)).toBe('PDF');
      expect(html).not.toContain('تصدير');
    });

    it('are offered to whoever can read the list, though only some may use its action', () => {
      const html = render(screen, ['itAsset.view']);
      expect(html).not.toContain(ar(action));
      expect(html).toContain(`data-export="${name}"`);
      expect(html).toContain(`data-print="${name}"`);
    });

    it('ask for the table’s own filters and sort, unpaged — not the page on screen', () => {
      // The walk itself is proven in the lib spec; here, that the screen hands it ITS params.
      expect(source).toContain(list);
    });

    it('are not offered when the list failed — the file behind them would be short', () => {
      expect(source).toMatch(
        new RegExp(`\\{!isError && \\(\\s*<RegisterExportButtons name="${name}"`, 'u'),
      );
    });
  },
);
