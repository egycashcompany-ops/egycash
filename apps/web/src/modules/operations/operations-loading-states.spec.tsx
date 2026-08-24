// WHY THIS EXISTS. Every table on all eleven Operations screens showed
// "تعذّر التحميل / حدث خطأ ما. يُرجى المحاولة مجددًا." while the API behind them answered 200.
// The reported screenshot carried its own contradiction: the pager read «عرض 0 من 0 شحنة» — a
// count only a SUCCESSFUL response can produce — directly above the error panel.
//
// `DataTable` decided "did this fail?" with `error !== undefined`. TanStack Query's value for
// "this query has not failed" is `null`, which passes that test, so the error branch won on every
// successful load. The generic copy came from `errorMessage(null)` matching none of its branches.
//
// These cases assert what the screens SHOW, against a cache holding a successful response — the
// exact condition that was rendering as a failure. `errors.spec.ts` pins the predicate itself;
// this proves the pages downstream of it.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { listKey } from '../../shared/lib/query-keys';
import { DataTable } from '../../shared/ui/DataTable';
import { VaultInventoryPage } from './pages/VaultInventoryPage';
import { SecuredBacklogPage } from './pages/SecuredBacklogPage';

// The generic copy the eleven screens were stuck on, in both locales.
const UNKNOWN_AR = 'حدث خطأ ما. يُرجى المحاولة مجددًا.';
const UNKNOWN_EN = 'Something went wrong. Please try again.';
const ERROR_TITLE_AR = 'تعذّر التحميل';

const me = (permissions: string[]): MeDto => ({
  id: 'u-1',
  email: 'user@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'ar',
  theme: 'system',
  navLayout: 'rail',
  branchId: null,
  employeeId: 'e-1',
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
});

const emptyPage = { items: [], meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 } };

const render = (
  node: JSX.Element,
  {
    locale = 'ar',
    permissions = [],
    path = '/operations/vault',
    seed = () => undefined,
  }: {
    locale?: Locale;
    permissions?: string[];
    path?: string;
    seed?: (qc: QueryClient) => void;
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/vault" element={node} />
            <Route path="/operations/secured" element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('DataTable — a successful query is not a failure', () => {
  const columns = [{ key: 'a', header: 'A', render: (r: { id: string }) => r.id }];
  const table = (error: unknown, rows: { id: string }[] = []): string =>
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} error={error} />);

  it('shows no error panel when the query reports null (its success value)', () => {
    const html = table(null);
    expect(html).not.toContain(ERROR_TITLE_AR);
    expect(html).not.toContain(UNKNOWN_AR);
  });

  it('renders the rows it was given rather than an error, when the error is null', () => {
    expect(table(null, [{ id: 'row-visible' }])).toContain('row-visible');
  });

  it('still shows the error panel — and names the failure — when one really was thrown', () => {
    // Regression in the other direction: the fix must not have made the table swallow failures.
    const html = table(new Error('the sky fell'));
    expect(html).toContain(ERROR_TITLE_AR);
    expect(html).toContain('the sky fell');
  });
});

describe('the Operations screens on a successful, empty response', () => {
  it('vault inventory shows its empty copy, not the generic failure', () => {
    const html = render(<VaultInventoryPage />, {
      permissions: ['operationsVault.view'],
      seed: (qc) => qc.setQueryData(listKey('operations', 'vault', { page: 1, pageSize: 25 }), emptyPage),
    });
    expect(html).not.toContain(UNKNOWN_AR);
    expect(html).not.toContain(UNKNOWN_EN);
    expect(html).toContain('الخزينة فارغة');
  });

  it('the secured backlog shows its empty copy, not the generic failure', () => {
    const html = render(<SecuredBacklogPage />, {
      path: '/operations/secured',
      permissions: ['operationsShipment.view'],
      seed: (qc) =>
        qc.setQueryData(
          listKey('operations', 'securedBacklog', { page: 1, pageSize: 25, sortDir: 'desc' }),
          emptyPage,
        ),
    });
    expect(html).not.toContain(UNKNOWN_AR);
    expect(html).toContain('لا توجد محصنات مفتوحة');
  });
});
