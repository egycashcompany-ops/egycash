// «عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول» — the two buttons
// on the custody register, beside the hand-over, for everybody who can read the register. What the
// files hold is `lib/custody-register-export.spec.ts`.
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

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'CustodyPage.tsx'), 'utf8');
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

const render = (permissions: string[]): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // The register's first page as the screen asks for it by default: open custody, newest first.
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
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/it/custody']}>
          <Routes>
            <Route path="/it/custody" element={<CustodyPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the register’s Excel and PDF', () => {
  it('sit beside «تسليم عهدة», in the page’s header, above the filters', () => {
    const html = render(['itAsset.view', 'itAsset.assign']);
    const handOver = html.indexOf(ar('it.custody.receipt.title'));
    const excel = html.indexOf('data-export="it-custody"');
    const pdf = html.indexOf('data-print="it-custody"');
    expect(handOver).toBeGreaterThan(-1);
    expect(excel).toBeGreaterThan(handOver);
    expect(pdf).toBeGreaterThan(excel);
    // The header's own action row, not somewhere down the page.
    expect(pdf).toBeLessThan(html.indexOf(ar('it.custody.filterOpen')));
    expect(html).toContain(ar('it.custody.export.excel'));
    expect(html).toContain(ar('it.custody.export.pdf'));
  });

  it('are offered to whoever can read the register, though only some may hand over', () => {
    const html = render(['itAsset.view']);
    expect(html).not.toContain(ar('it.custody.receipt.title'));
    expect(html).toContain('data-export="it-custody"');
    expect(html).toContain('data-print="it-custody"');
  });

  it('ask for the table’s own filters and sort, unpaged — not the page on screen', () => {
    // The walk itself is proven in the lib spec; here, that the screen hands it ITS params.
    expect(PAGE).toContain('gatherCustodyRegister(params, api.listAssignments)');
  });

  it('are not offered when the list failed — the file behind them would be short', () => {
    expect(PAGE).toMatch(/\{!isError && \(\s*<>\s*<Button[\s\S]*?data-export="it-custody"/u);
  });
});
