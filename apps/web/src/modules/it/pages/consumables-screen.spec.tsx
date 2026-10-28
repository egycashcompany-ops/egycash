// «وأقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك وأتبدل لمين واطبعله مذكره» — the consumables
// screens (FR-20), proven against what they render: the store's filters are what the register asks
// the server for, an item at its minimum is marked in words as well as colour, each row offers the
// movements its figures and the reader's grants allow, and the ledger reads every movement by its
// kind — who received it, what it was installed on, why, and the memo it was signed on. The asset's
// and the person's cards read the same ledger.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ItConsumableDto,
  type ItConsumableMovementDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { AssetConsumablesCard, EmployeeConsumablesCard } from '../components/ConsumableMovements';
import { ConsumablesPage } from './ConsumablesPage';
import { ConsumableMovementsPage } from './ConsumableMovementsPage';

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

const ALL = ['itAsset.view', 'itAsset.create', 'itAsset.edit', 'itAsset.assign'];

const item = (over: Partial<ItConsumableDto> = {}): ItConsumableDto => ({
  id: 'c-1',
  code: 'CON-00004',
  name: 'Mouse',
  typeId: 'ty-mice',
  unit: 'قطعة',
  branchId: 'b-hq',
  minQty: 5,
  notes: null,
  active: true,
  onHandQty: 13,
  issuedQty: 4,
  scrappedQty: 1,
  belowMin: false,
  version: 0,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  ...over,
});

const LOW = item({
  id: 'c-2',
  code: 'CON-00007',
  name: 'HDMI Cable 10 m',
  onHandQty: 2,
  belowMin: true,
});
const EMPTY = item({
  id: 'c-3',
  code: 'CON-00008',
  name: 'Power Cable',
  onHandQty: 0,
  belowMin: true,
});
const RETIRED = item({ id: 'c-4', code: 'CON-00009', name: 'VGA Cable', active: false });

const movement = (over: Partial<ItConsumableMovementDto> = {}): ItConsumableMovementDto => ({
  id: 'm-1',
  consumableId: 'c-1',
  kind: 'issued',
  qty: 2,
  at: '2026-10-21T08:30:00.000Z',
  branchId: 'b-hq',
  consumableCode: 'CON-00004',
  consumableName: 'Mouse',
  typeId: 'ty-mice',
  employeeId: 'e-1',
  employeeCode: '0100052',
  employeeName: 'محمد أحمد علي',
  assetId: 'a-12',
  assetCode: 'AST-00012',
  assetName: 'لاب توب Lenovo',
  reason: 'replacement',
  memoId: 'memo-1',
  memoNumber: 7,
  memoSigned: false,
  byUserId: 'u-it',
  notes: null,
  createdAt: '2026-10-21T08:30:00.000Z',
  ...over,
});

const SCRAPPED = movement({
  id: 'm-2',
  kind: 'scrapped',
  qty: 1,
  employeeId: null,
  employeeCode: null,
  employeeName: null,
  assetId: null,
  assetCode: null,
  assetName: null,
  reason: 'انكسر الموصل',
  memoId: null,
  memoNumber: null,
  memoSigned: null,
});

const page = <T,>(items: T[], pageSize = 25) => ({
  items,
  meta: { page: 1, pageSize, totalItems: items.length, totalPages: 1 },
});

const render = ({
  path,
  element,
  permissions = ALL,
  seed,
}: {
  path: string;
  element: JSX.Element;
  permissions?: string[];
  seed: (qc: QueryClient) => void;
}): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('it', 'branchOptions'), [
    { id: 'b-hq', code: '01', name: { ar: 'المهندسين', en: 'HQ' }, parentId: null },
  ]);
  qc.setQueryData(listKey('it', 'catalogs', { kind: 'consumableType', select: true }), {
    items: [
      {
        id: 'ty-mice',
        kind: 'consumableType',
        code: 'mice',
        name: { ar: 'ماوس', en: 'Mice' },
        description: null,
        sortOrder: 4,
        isActive: true,
        version: 0,
        createdAt: '2026-10-28T09:00:00.000Z',
        updatedAt: '2026-10-28T09:00:00.000Z',
      },
    ],
    meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
  });
  seed(qc);
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const pathname = path.split('?')[0] ?? path;
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pathname} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The store's register at a URL, its list answered for exactly the request expected. */
const store = ({
  search = '',
  query = { page: 1, pageSize: 25, active: true },
  rows = [item()],
  permissions = ALL,
}: {
  search?: string;
  query?: Record<string, unknown>;
  rows?: ItConsumableDto[];
  permissions?: string[];
} = {}): string =>
  render({
    path: `/it/consumables${search}`,
    element: <ConsumablesPage />,
    permissions,
    seed: (qc) => qc.setQueryData(listKey('it', 'consumables', query), page(rows)),
  });

/** The table's body — what is drawn for the rows, after the header and the filters. */
const tableBody = (html: string): string => {
  const at = html.indexOf('<tbody');
  expect(at, 'the table has a body').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</tbody>', at));
};

/** The row that carries `marker`, opening tag to closing tag. */
const rowOf = (body: string, marker: string): string => {
  const at = body.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  return body.slice(body.lastIndexOf('<tr', at), body.indexOf('</tr>', at));
};

const actions = (html: string): string[] =>
  [...html.matchAll(/data-consumable-action="([^"]+)"/gu)].map((m) => m[1] ?? '');

describe('the consumables register', () => {
  it('asks the server for the active items by default, in its own order', () => {
    // The row below renders only if the screen asked for that very key.
    expect(tableBody(store())).toContain('CON-00004');
  });

  it('asks for exactly the filters the URL names — type, branch, minimum, state, search', () => {
    const html = store({
      search: '?q=mouse&type=ty-mice&branch=b-hq&belowMin=true&active=all',
      query: {
        page: 1,
        pageSize: 25,
        search: 'mouse',
        typeId: 'ty-mice',
        branchId: 'b-hq',
        belowMin: true,
      },
      rows: [LOW],
    });
    expect(tableBody(html)).toContain('CON-00007');
    // The retired-only view asks for `active: false`.
    expect(
      tableBody(
        store({
          search: '?active=false',
          query: { page: 1, pageSize: 25, active: false },
          rows: [RETIRED],
        }),
      ),
    ).toContain('CON-00009');
  });

  it('offers every filter: search, type, branch, state and «at its minimum»', () => {
    const html = store();
    expect(html).toContain(ar('it.consumables.searchPlaceholder'));
    expect(html).toContain(ar('it.consumables.allTypes'));
    expect(html).toContain(ar('it.assets.allBranches'));
    expect(html).toContain(ar('it.consumables.filterActive'));
    expect(html).toContain(ar('it.consumables.belowMinOnly'));
  });

  it('writes each row from the server: code, item, type by name, branch, unit and the figures', () => {
    const row = rowOf(tableBody(store()), 'CON-00004');
    expect(row).toContain('Mouse');
    expect(row).toContain('ماوس');
    expect(row).toContain('المهندسين');
    expect(row).toContain('قطعة');
    // On hand, issued, scrapped, minimum — in the reader's digits.
    for (const figure of ['١٣', '٤', '١', '٥']) expect(row).toContain(figure);
  });

  it('marks an item at its minimum in words as well as colour — and only that item', () => {
    const body = tableBody(store({ rows: [item(), LOW] }));
    const low = rowOf(body, 'CON-00007');
    expect(low).toContain('data-below-min="true"');
    expect(low).toContain(ar('it.consumables.belowMin'));
    expect(low).toContain('text-amber-700');
    const fine = rowOf(body, 'CON-00004');
    expect(fine).toContain('data-below-min="false"');
    expect(fine).not.toContain(ar('it.consumables.belowMin'));
  });

  it('offers each movement where the item’s figures and the grant allow it', () => {
    const body = tableBody(store({ rows: [item(), EMPTY, RETIRED] }));
    expect(actions(rowOf(body, 'CON-00004'))).toEqual([
      'receive',
      'issue',
      'scrap',
      'return',
      'edit',
      'movements',
    ]);
    // Nothing on hand: nothing to issue or scrap — stock can still come in, or back.
    expect(actions(rowOf(body, 'CON-00008'))).toEqual(['receive', 'return', 'edit', 'movements']);
    // Retired: no new stock and no issue; a scrap or a return is still recorded.
    expect(actions(rowOf(body, 'CON-00009'))).toEqual(['scrap', 'return', 'edit', 'movements']);
    expect(rowOf(body, 'CON-00009')).toContain(ar('it.consumables.state.inactive'));
  });

  it('a reader holding only the view grant may look at the movements, and nothing else', () => {
    const html = store({ permissions: ['itAsset.view'], rows: [item(), LOW] });
    expect(actions(tableBody(html))).toEqual(['movements', 'movements']);
    expect(html).not.toContain(ar('it.consumables.create'));
    expect(html).not.toContain(ar('it.consumables.issueAction'));
    // The ledger is a read, so its way in is offered to every reader.
    expect(html).toContain('href="/it/consumables/movements"');
  });

  it('puts the files first, then «سجل الحركات», «صرف لموظف» and «إضافة صنف»', () => {
    const html = store();
    const order = [
      html.indexOf('data-export="it-consumables"'),
      html.indexOf('data-print="it-consumables"'),
      html.indexOf('data-consumables-movements'),
      html.indexOf(ar('it.consumables.issueAction')),
      html.indexOf(ar('it.consumables.create')),
    ];
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/** The ledger at a URL, its list answered for exactly the request expected. */
const ledger = ({
  search = '',
  query = { movements: true, page: 1, pageSize: 25 },
  rows = [movement(), SCRAPPED],
  permissions = ALL,
}: {
  search?: string;
  query?: Record<string, unknown>;
  rows?: ItConsumableMovementDto[];
  permissions?: string[];
} = {}): string =>
  render({
    path: `/it/consumables/movements${search}`,
    element: <ConsumableMovementsPage />,
    permissions,
    seed: (qc) => qc.setQueryData(listKey('it', 'consumables', query), page(rows)),
  });

describe('the consumables ledger («حركات المستهلكات»)', () => {
  it('asks for exactly the filters the URL names — kind, type, branch, person, asset, days, search', () => {
    const html = ledger({
      search:
        '?kind=issued&type=ty-mice&branch=b-hq&employee=e-1&asset=a-12&from=2026-10-01&to=2026-10-31&q=mouse',
      query: {
        movements: true,
        page: 1,
        pageSize: 25,
        kind: 'issued',
        typeId: 'ty-mice',
        branchId: 'b-hq',
        employeeId: 'e-1',
        assetId: 'a-12',
        from: '2026-10-01',
        to: '2026-10-31',
        search: 'mouse',
      },
      rows: [movement()],
    });
    expect(tableBody(html)).toContain('CON-00004');
  });

  it('drops a kind the filter does not offer, rather than asking for it', () => {
    expect(tableBody(ledger({ search: '?kind=stolen' }))).toContain('CON-00004');
  });

  it('reads an issue by its kind: who received it, what it went into, why, and its memo', () => {
    const row = rowOf(tableBody(ledger()), 'data-movement-qty="issued"');
    expect(row).toContain(ar('it.consumables.kind.issued'));
    // Out of the store: the sign is the kind's.
    expect(row).toMatch(/data-movement-qty="issued"[^>]*>−٢</u);
    expect(row).toContain('href="/it/employees/e-1"');
    expect(row).toContain('محمد أحمد علي (0100052)');
    expect(row).toContain('href="/it/assets/a-12"');
    expect(row).toContain('AST-00012 — لاب توب Lenovo');
    // «بدل تالف», said in so many words: the damaged unit is scrap too.
    expect(row).toContain(ar('it.consumables.reason.replacement'));
    expect(row).toContain(ar('it.consumables.replacementNote'));
    // The memo: its number, print it again, and the signed copy awaited.
    expect(row).toContain('EGYCASH-IT-CON-0007');
    expect(row).toContain('data-receipt-print="memo-1"');
    expect(row).toContain(ar('it.custody.receipt.awaitingSignature'));
  });

  it('reads a scrap by its kind: its own reason, no person, no paper', () => {
    const row = rowOf(tableBody(ledger()), 'data-movement-qty="scrapped"');
    expect(row).toContain(ar('it.consumables.kind.scrapped'));
    expect(row).toContain('انكسر الموصل');
    expect(row).not.toContain('data-receipt-print');
    expect(row).not.toContain('/it/employees/');
  });

  it('offers its files to every reader, before the way back to the store', () => {
    const html = ledger({ permissions: ['itAsset.view'] });
    expect(html).toContain('data-export="it-consumable-movements"');
    expect(html.indexOf('data-print="it-consumable-movements"')).toBeLessThan(
      html.indexOf(ar('it.consumables.backToStore')),
    );
  });
});

describe('the ledger’s cards on an asset and on a person', () => {
  it('«المستهلكات المركّبة عليه» — what was installed on the asset, without naming it again', () => {
    const html = render({
      path: '/it/assets/a-12',
      element: <AssetConsumablesCard assetId="a-12" />,
      seed: (qc) =>
        qc.setQueryData(
          listKey('it', 'consumables', { movements: true, assetId: 'a-12', page: 1, pageSize: 10 }),
          page([movement()], 10),
        ),
    });
    expect(html).toContain(ar('it.consumables.assetCard.title'));
    const body = tableBody(html);
    expect(body).toContain('Mouse');
    expect(body).toContain('محمد أحمد علي (0100052)');
    expect(body).toContain('data-receipt-print="memo-1"');
    // The page IS the asset: no «مركّب على» column pointing back at it.
    expect(body).not.toContain('data-installed-on');
  });

  it('a person’s card — what they were issued and gave back, without naming them again', () => {
    const html = render({
      path: '/it/employees/e-1',
      element: <EmployeeConsumablesCard employeeId="e-1" />,
      seed: (qc) =>
        qc.setQueryData(
          listKey('it', 'consumables', {
            movements: true,
            employeeId: 'e-1',
            page: 1,
            pageSize: 10,
          }),
          page([movement()], 10),
        ),
    });
    expect(html).toContain(ar('it.nav.consumables'));
    const body = tableBody(html);
    expect(body).toContain('data-installed-on="a-12"');
    expect(body).not.toContain('href="/it/employees/e-1"');
  });

  it('says so when there is nothing', () => {
    const html = render({
      path: '/it/assets/a-1',
      element: <AssetConsumablesCard assetId="a-1" />,
      seed: (qc) =>
        qc.setQueryData(
          listKey('it', 'consumables', { movements: true, assetId: 'a-1', page: 1, pageSize: 10 }),
          page([], 10),
        ),
    });
    expect(html).toContain(ar('it.consumables.assetCard.empty'));
  });
});
