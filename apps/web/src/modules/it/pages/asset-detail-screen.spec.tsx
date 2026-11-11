// The asset's page on a phone: its header carries up to five actions (print, edit, return,
// transfer, «نقل إلى فرع»), and the row that holds them wraps rather than running off the screen —
// the page header's own wrap cannot do it, since the row is its only child.
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
import { detailKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { AssetDetailPage } from './AssetDetailPage';

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
  permissions: {
    'itAsset.view': 'organization',
    'itAsset.edit': 'organization',
    'itAsset.assign': 'organization',
  },
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

const HELD: ItAssetDto = {
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
    employeeName: 'وليد صفوت جلال',
    assignedAt: '2026-10-07T09:00:00.000Z',
  },
  hasActiveMaintenance: false,
  version: 0,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
};

const render = (): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(detailKey('it', 'assets', HELD.id), HELD);
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
        <MemoryRouter initialEntries={[`/it/assets/${HELD.id}`]}>
          <Routes>
            <Route path="/it/assets/:id" element={<AssetDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the asset page header', () => {
  const html = render();
  const row = ((): string => {
    const at = html.indexOf('data-asset-actions');
    expect(at).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
  })();

  it('offers the held asset’s actions, the move to another branch among them', () => {
    expect(html).toContain(ar('it.custody.return'));
    expect(html).toContain(ar('it.custody.transfer'));
    expect(html).toContain(ar('it.assets.move.title'));
  });

  it('wraps its row of actions on a narrow screen', () => {
    expect(row).toMatch(/class="[^"]*\bflex-wrap\b[^"]*"/u);
  });
});
