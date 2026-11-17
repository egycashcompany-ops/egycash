// The reference-data screen's currencies tab, dragged into order — «اعملى فى شاشة البيانات المرجعية
// ان اقدر اعدل زى شاشة الحركة بالظبط». Rendered against the real Arabic catalog, a real store and
// query client: the list in the catalog's order, whole, on one page; for a manager a grip on every
// row, the rows draggable, and the arrows beside the pen (how a keyboard moves a row). The drop and
// step rules themselves are pinned in lib/catalog-order.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { CURRENCY_TAB_PARAMS, CatalogsPage } from './CatalogsPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

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

const currency = (id: string, code: string, name: string, sortOrder: number | null) =>
  ({
    id,
    code,
    name,
    legacyAliases: [],
    sortOrder,
    isActive: true,
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) satisfies OperationsCurrencyDto;

// As the server answers: in the catalog's order — the dollar dragged first, the riyal never placed.
const SERVER_ORDER = [
  currency('usd', '2', 'دولار', 0),
  currency('egp', '1', 'مصري', 1),
  currency('eur', '3', 'يورو', 2),
  currency('sar', '4', 'ريال سعودي', null),
];

const render = (permissions: string[]): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('operations', 'currencies', CURRENCY_TAB_PARAMS), {
    items: SERVER_ORDER,
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: SERVER_ORDER.length, totalPages: 1 },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/catalogs?kind=currencies']}>
          <Routes>
            <Route path="/operations/catalogs" element={<CatalogsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The `<tr>` of a currency, by its grip or by its action box. */
const rowOf = (html: string, id: string): string => {
  const at = html.indexOf(`data-currency-actions="${id}"`);
  expect(at, `the ${id} row`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

describe('the currencies tab — dragged into order, «زى شاشة الحركة بالظبط»', () => {
  const html = render(['operationsCatalog.manage']);

  it('asks for the WHOLE catalog in its own order — one page, no column sort', () => {
    // No `sortBy`: the server's default IS the dragged order. One page: a list cannot be dragged
    // into order across pages.
    expect(CURRENCY_TAB_PARAMS).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
  });

  it('lists the currencies in the order the server answered — the catalog’s', () => {
    const at = SERVER_ORDER.map((c) => html.indexOf(`data-currency-actions="${c.id}"`));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('gives every row a grip and makes it draggable, for a manager', () => {
    for (const { id } of SERVER_ORDER) {
      expect(html).toContain(`data-drag-handle="${id}"`);
      expect(rowOf(html, id)).toMatch(/^<tr[^>]*draggable="true"/);
    }
    expect(html).toContain(ar('operations.catalogs.currency.dragToOrder'));
    expect(html).toContain(ar('operations.catalogs.currency.orderHint'));
  });

  it('puts the arrows beside the pen — the first cannot go up, the last cannot go down', () => {
    const up = `aria-label="${ar('operations.catalogs.currency.moveUp')}"`;
    const down = `aria-label="${ar('operations.catalogs.currency.moveDown')}"`;
    const first = rowOf(html, 'usd');
    const last = rowOf(html, 'sar');
    const middle = rowOf(html, 'egp');
    // `disabled=""` — the attribute; the classes say `disabled:` too.
    expect(first).toMatch(new RegExp(`${up}[^>]*disabled=""`));
    expect(first).not.toMatch(new RegExp(`${down}[^>]*disabled=""`));
    expect(last).toMatch(new RegExp(`${down}[^>]*disabled=""`));
    expect(last).not.toMatch(new RegExp(`${up}[^>]*disabled=""`));
    expect(middle).not.toContain('disabled=""');
    // The pen stays first in the box.
    expect(middle.indexOf(`aria-label="${ar('common.edit')}"`)).toBeLessThan(middle.indexOf(up));
  });

  it('shows no pager — the whole list is on screen', () => {
    expect(html).not.toContain(ar('common.pagination.perPage'));
  });
});

describe('the currencies tab without the catalog grant', () => {
  const html = render([]);

  it('lists them in the same order, with no grip, no drag and no arrows', () => {
    expect(html).toContain('data-currency-actions="usd"');
    expect(html).not.toContain('data-drag-handle');
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain(ar('operations.catalogs.currency.moveUp'));
    expect(html).not.toContain(ar('operations.catalogs.currency.orderHint'));
  });
});
