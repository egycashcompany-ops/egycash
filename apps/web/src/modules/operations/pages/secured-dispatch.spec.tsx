// «صرف الخزينة» in Round 10, rendered against the real Arabic catalog, a real store and query client
// — what reaches the screen; the rules themselves are pinned in lib/secured-dispatch.spec.ts.
//
//   · «صرف الخزنية … اعملها بقى بشكل الجديد للشاشات اللى احنا عملناها»: the secured screen's board —
//     its figures, filter bar, dark table with «تاريخ الاستلام» and «تاريخ التسليم», stage badges;
//   · «كله يبقى موجود فى تاريخ يتفلتر»: every محصنة in the vault, in the server's order (late first),
//     with ONE optional delivery-day picker; late and due-today rows marked and counted;
//   · its two acts kept — the delivery crew, read from the ROW's own delivery day, and the release,
//     of one row or of the rows ticked, one vehicle per call — each for its own grant; and nothing
//     that edits a row the vault has received.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type Locale,
  type MeDto,
  type OperationsCrewBoardDto,
  type OperationsCrewDirectoryDto,
  type OperationsCurrencyDto,
  type OperationsSecuredDispatchBoardDto,
  type OperationsSecuredDispatchRowDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { formatNumber } from '../../../shared/lib/format';
import { HISTORY_TOO_LARGE } from '../lib/shipment-history';
import { __securedDispatchBoardKey } from '../api/operations-queries';
import { AssignDeliveryCrewDialog } from '../components/AssignDeliveryCrewDialog';
import { DispatchSecuredDialog } from '../components/DispatchSecuredDialog';
import { SecuredDispatchPage } from './SecuredDispatchPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

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

const currency = (id: string, code: string, name: string, sortOrder: number) =>
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
const CURRENCIES = [currency('egp', '1', 'مصري', 0), currency('usd', '2', 'دولار', 1)];

const crewOf = (crewAssignmentId: string, vehicleCode: string, captain: [string, string]) => ({
  crewAssignmentId,
  vehicleId: `v-${vehicleCode}`,
  vehicleCode,
  captainEmployeeId: captain[0],
  captainName: captain[1],
  captainCode: null,
  captainPhone: null,
  captainBranchId: null,
});

const inVault = (
  id: string,
  deliveryDay: string | null,
  over: Partial<OperationsSecuredDispatchRowDto> = {},
): OperationsSecuredDispatchRowDto => ({
  id,
  shipmentType: 'secured',
  status: 'inVault',
  mainBankId: 'b-ahly',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'الجيزة',
  lines: [
    { currencyId: 'egp', amount: 1_000_000 },
    { currencyId: 'usd', amount: 20_000 },
  ],
  collectionDate: '2026-11-08T00:00:00.000Z',
  deliveryDate: deliveryDay === null ? null : `${deliveryDay}T00:00:00.000Z`,
  receiptNumber: 'R-1',
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 6,
  createdAt: '2026-11-08T08:00:00.000Z',
  updatedAt: '2026-11-09T08:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-ahly', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع الدقي', code: 'D1', bankId: 'b-ahly', bankName: 'الأهلي' },
  crew: null,
  captainDeliveredAt: null,
  securedStage: 'inVault',
  pickedUpBy: 'captain',
  pickedUpAt: '2026-11-08T07:30:00.000Z',
  vaultReceivedAt: '2026-11-08T09:15:00.000Z',
  overdue: false,
  deliveryLegVersion: null,
  ...over,
});

const TODAY = '2026-11-12';
// In the server's order: delivery day ascending, so the late one leads; no delivery day last.
const LATE = inVault('s-late', '2026-11-10', {
  overdue: true,
  crew: crewOf('ca-1', '150', ['e-1', 'محمود حسن']),
  deliveryLegVersion: 2,
});
const DUE_TODAY = inVault('s-today', TODAY);
const LATER = inVault('s-later', '2026-11-14', {
  crew: crewOf('ca-2', '210', ['e-3', 'سيد علي']),
  deliveryLegVersion: 0,
});
const UNDATED = inVault('s-undated', null);
const ROWS = [LATE, DUE_TODAY, LATER, UNDATED];

const answer = (
  date: string | null,
  shipments: OperationsSecuredDispatchRowDto[],
): OperationsSecuredDispatchBoardDto => ({
  date: date === null ? null : `${date}T00:00:00.000Z`,
  today: `${TODAY}T00:00:00.000Z`,
  shipments,
  crews: [],
});

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

/** The desk treasurer: reads the rows and their log, crews them and releases them. */
const FULL = [
  'operationsVault.view',
  'operationsVault.dispatch',
  'operationsShipment.view',
  'operationsShipment.edit',
  'operationsShipment.delete',
  'operationsShipment.create',
  'operationsCrew.view',
];

const storeFor = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });

const clientWithCatalogs = (): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('operations', 'banks', {
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    }),
    page([{ id: 'b-ahly', opsName: 'بنك الأهلي' }]),
  );
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  return qc;
};

const render = ({
  path = '/operations/vault/dispatch',
  permissions = FULL,
  seed,
}: {
  path?: string;
  permissions?: string[];
  seed: (qc: QueryClient) => void;
}): string => {
  const qc = clientWithCatalogs();
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/vault/dispatch" element={<SecuredDispatchPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The `<tr>` holding the row whose «السجل» names `id` (every reader of these renders has it). */
const rowOf = (html: string, id: string): string => {
  const marker = html.indexOf(`data-shipment-log="${id}"`);
  expect(marker, `row ${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', marker);
  return html.slice(start, html.indexOf('</tr>', marker));
};

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('./SecuredDispatchPage.tsx');
const ASSIGN = read('../components/AssignDeliveryCrewDialog.tsx');
const RELEASE = read('../components/DispatchSecuredDialog.tsx');
const QUERIES = read('../api/operations-queries.ts');
const BOARD = read('../components/ShipmentsBoard.tsx');

const EDIT = `aria-label="${ar('common.edit')}"`;
const REMOVE = `aria-label="${ar('common.remove')}"`;

describe('«صرف الخزينة» — every محصنة in the vault, on the boards’ board', () => {
  const html = render({
    seed: (qc) => qc.setQueryData(__securedDispatchBoardKey(null), answer(null, ROWS)),
  });

  it('is the shared board: its figures, its filter bar, the secured screen’s two dates', () => {
    expect(html).toContain('data-shipment-figures="true"');
    expect(html).toContain('data-shipment-filters="true"');
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(ar('operations.board.collectedOn'));
    expect(head).toContain(ar('operations.shipment.deliveryDate'));
    // Every row is a محصنة: no «النوع».
    expect(head).not.toContain(`>${ar('operations.shipment.type')}<`);
  });

  it('lists the rows in the server’s order — the late one first, no delivery day last', () => {
    const at = ROWS.map((row) => html.indexOf(`data-shipment-log="${row.id}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('offers ONE delivery-day picker, empty — every day the vault holds — named in the day’s place', () => {
    expect(html.match(/type="date"/g)).toHaveLength(1);
    expect(html).toMatch(/type="date"[^>]*value=""/);
    // Empty: its name where the browser's «mm/dd/yyyy» would be (unseen until typed into).
    expect(html).toContain(`data-date-label="date"`);
    expect(html).toContain('[&amp;&amp;:not(:focus)]:!text-transparent');
    // Nothing to reset: the screen is on its default.
    expect(html).not.toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('marks the late row «متأخرة» and today’s «تسليمها اليوم», under its delivery day', () => {
    const late = rowOf(html, 's-late');
    expect(late).toContain('data-dispatch-due="overdue"');
    expect(late).toContain(`>${ar('operations.secured.dispatch.overdue')}<`);
    expect(late).toContain('bg-rose-100');
    const today = rowOf(html, 's-today');
    expect(today).toContain('data-dispatch-due="today"');
    expect(today).toContain(`>${ar('operations.secured.dispatch.dueToday')}<`);
    expect(rowOf(html, 's-later')).not.toContain('data-dispatch-due');
    expect(rowOf(html, 's-undated')).not.toContain('data-dispatch-due');
  });

  it('counts the late rows and today’s in the toolbar, over the rows shown', () => {
    for (const due of ['overdue', 'today'] as const) {
      const chip = html.slice(html.indexOf(`data-dispatch-legend="${due}"`));
      expect(chip.slice(0, chip.indexOf('</span></span>'))).toMatch(
        new RegExp(`>${formatNumber(1, 'ar')}$`),
      );
    }
  });

  it('keeps the stage’s own colour and badge — «بالخزينة», green, as on every board', () => {
    for (const row of ROWS) {
      const tr = rowOf(html, row.id);
      expect(tr).toContain('data-secured-stage="inVault"');
      expect(tr).toContain('!bg-emerald-50');
    }
  });

  it('says since when each one has been in the vault, under its badge', () => {
    expect(rowOf(html, 's-late')).toContain('data-dispatch-received="s-late"');
    // The Cairo day it came in — 09:15 UTC on the 8th is still the 8th in Cairo.
    expect(rowOf(html, 's-late')).toContain(
      ar('operations.secured.dispatch.inVaultSince', { at: '\u20662026-11-08\u2069' }),
    );
  });

  it('offers the crew on every row with a delivery day — «تغيير» where one is assigned', () => {
    expect(rowOf(html, 's-late')).toContain('data-assign-delivery-open="s-late"');
    expect(rowOf(html, 's-late')).toContain(
      `aria-label="${ar('operations.secured.dispatch.reassignAction')}"`,
    );
    expect(rowOf(html, 's-today')).toContain(
      `aria-label="${ar('operations.secured.dispatch.assignAction')}"`,
    );
    // No delivery day: no crew can be planned for it — its square stays, empty.
    expect(rowOf(html, 's-undated')).not.toContain('data-assign-delivery-open');
  });

  it('offers the release only on a row that has its crew — and its tick box with it', () => {
    for (const id of ['s-late', 's-later']) {
      const tr = rowOf(html, id);
      expect(tr).toContain(`data-dispatch-open="${id}"`);
      expect(tr).toContain(`data-board-select="${id}"`);
    }
    for (const id of ['s-today', 's-undated']) {
      const tr = rowOf(html, id);
      expect(tr).not.toContain('data-dispatch-open');
      expect(tr).not.toContain('data-board-select');
    }
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(`>${ar('operations.board.select')}<`);
  });

  it('offers «صرف المحدد» in the toolbar, off while nothing is ticked', () => {
    const button = html.slice(html.lastIndexOf('<button', html.indexOf('data-dispatch-selected')));
    expect(button).toMatch(/^<button type="button" data-dispatch-selected="0"/);
    expect(button.slice(0, button.indexOf('>'))).toContain('disabled=""');
    expect(button).toContain(
      ar('operations.secured.dispatch.releaseSelected', { count: formatNumber(0, 'ar') }),
    );
  });

  it('offers no add, no edit, no delete and no photo change — every row is locked', () => {
    expect(html).not.toContain('data-shipment-new');
    expect(html).not.toContain(EDIT);
    expect(html).not.toContain(REMOVE);
    expect(html).not.toContain('data-shipment-receipt-upload');
    // Nor the pickup ✓ — it is the secured screen's, before the vault.
    expect(html).not.toContain('data-secured-pickup');
  });

  it('keeps «السجل» for the reader who may read it', () => {
    expect(rowOf(html, 's-late')).toContain('data-shipment-log="s-late"');
  });

  it('offers «إلغاء استلام الخزينة» to nobody without its special grant', () => {
    expect(html).not.toContain('data-cancel-receipt-open');
  });
});

describe('«صرف الخزينة» filtered on a delivery day', () => {
  const path = `/operations/vault/dispatch?date=${TODAY}`;

  it('asks for that day, shows it in the picker, and offers the reset', () => {
    const html = render({
      path,
      seed: (qc) => qc.setQueryData(__securedDispatchBoardKey(TODAY), answer(TODAY, [DUE_TODAY])),
    });
    expect(html).toMatch(new RegExp(`type="date"[^>]*value="${TODAY}"`));
    // A day in the box: the day alone — the name stays its title, never over the digits.
    expect(html).not.toContain('data-date-label="date"');
    expect(html).not.toContain('[&amp;&amp;:not(:focus)]:!text-transparent');
    expect(html).toContain('data-shipment-log="s-today"');
    expect(html).not.toContain('data-shipment-log="s-late"');
    expect(html).toContain(`aria-label="${ar('common.filters.clear')}"`);
  });

  it('says an empty day in its own words — and an empty vault in another', () => {
    const day = render({
      path,
      seed: (qc) => qc.setQueryData(__securedDispatchBoardKey(TODAY), answer(TODAY, [])),
    });
    expect(day).toContain(ar('operations.secured.dispatch.empty'));
    const all = render({
      seed: (qc) => qc.setQueryData(__securedDispatchBoardKey(null), answer(null, [])),
    });
    expect(all).toContain(ar('operations.secured.dispatch.emptyAll'));
  });

  it('reads a malformed day as every day, never sending it', () => {
    const html = render({
      path: '/operations/vault/dispatch?date=not-a-day',
      seed: (qc) => qc.setQueryData(__securedDispatchBoardKey(null), answer(null, ROWS)),
    });
    expect(html).toContain('data-shipment-log="s-late"');
  });
});

describe('each act for its own grant', () => {
  const seed = (qc: QueryClient): void => {
    qc.setQueryData(__securedDispatchBoardKey(null), answer(null, ROWS));
  };

  it('a treasurer who may only look sees the rows, the marks — and no acts', () => {
    const html = render({ permissions: ['operationsVault.view'], seed });
    expect(html).toContain('data-dispatch-due="overdue"');
    expect(html).not.toContain('data-row-actions="shipment"');
    expect(html).not.toContain('data-board-select');
    expect(html).not.toContain('data-dispatch-selected');
    expect(html).not.toContain('data-assign-delivery-open');
  });

  it('a treasurer who releases but does not crew: the release and the ticks, no crew act', () => {
    const html = render({
      permissions: ['operationsVault.view', 'operationsVault.dispatch'],
      seed,
    });
    expect(html).toContain('data-dispatch-open="s-late"');
    expect(html).toContain('data-board-select="s-late"');
    expect(html).toContain('data-dispatch-selected="0"');
    expect(html).not.toContain('data-assign-delivery-open');
  });

  it('the desk that crews but does not release: the crew act, no ticks and no release', () => {
    const html = render({ permissions: ['operationsVault.view', 'operationsShipment.edit'], seed });
    expect(html).toContain('data-assign-delivery-open="s-today"');
    expect(html).not.toContain('data-dispatch-open');
    expect(html).not.toContain('data-board-select');
    expect(html).not.toContain('data-dispatch-selected');
  });

  it('whoever holds the special grant may cancel a receipt here — every row is in the vault', () => {
    const html = render({ permissions: [...FULL, 'operationsVault.cancelReceipt'], seed });
    expect(rowOf(html, 's-late')).toContain('data-cancel-receipt-open="s-late"');
  });
});

// The server REFUSES more shipments than one screen may show (never cuts it short). Said in the
// table's place with what narrows it here — a delivery day — never with an earlier answer beside it.
describe('a vault too full to list at once', () => {
  const refused = (qc: QueryClient, kept?: OperationsSecuredDispatchBoardDto): void => {
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
    const query = qc.getQueryCache().build(qc, { queryKey: [...__securedDispatchBoardKey(null)] });
    query.setState({
      ...query.state,
      ...(kept === undefined ? {} : { data: kept, dataUpdatedAt: 1 }),
      status: 'error',
      error: new ApiError(HISTORY_TOO_LARGE, 'too many', 422),
      errorUpdatedAt: 2,
      fetchStatus: 'idle',
    });
  };

  it('says so, and asks for a delivery day', () => {
    const html = render({ seed: (qc) => refused(qc) });
    expect(html).toContain(
      ar('operations.secured.dispatch.tooLarge', {
        max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, 'ar'),
      }),
    );
    // The picker stays: it is what lifts the refusal.
    expect(html).toContain('data-date-label="date"');
  });

  it('shows neither the rows, the figures nor the counts of an earlier answer beside it', () => {
    const html = render({ seed: (qc) => refused(qc, answer(null, ROWS)) });
    expect(html).not.toContain('data-shipment-log=');
    expect(html).not.toContain('data-dispatch-legend=');
    expect(html).not.toContain('data-shipment-figures');
  });
});

// ── The two dialogs ─────────────────────────────────────────────────────────────────────────────

const crewBoard = (date: string): OperationsCrewBoardDto => ({
  date: `${date}T00:00:00.000Z`,
  day: null,
  rows: [
    {
      vehicleId: 'v-150',
      vehicleCode: '150',
      fleetDutyAssignmentId: 'fd-1',
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      missionTypeId: null,
      crew: {
        id: 'ca-1',
        captainEmployeeIds: ['e-1'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
        direction: null,
        plannedTime: null,
        notes: null,
      },
    },
  ],
});
const directory = (date: string): OperationsCrewDirectoryDto => ({
  date: `${date}T00:00:00.000Z`,
  members: [
    { employeeId: 'e-1', fullNameAr: 'محمود حسن' } as OperationsCrewDirectoryDto['members'][number],
  ],
  rosterIsDerived: false,
});

const renderDialog = (
  node: JSX.Element,
  permissions: string[],
  seed?: (qc: QueryClient) => void,
) => {
  const qc = clientWithCatalogs();
  seed?.(qc);
  return renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

describe('«تعيين طاقم التسليم» — the crew of the ROW’s delivery day', () => {
  // The late row is due on the 10th; the screen may be filtered on any day, or none.
  const seed = (qc: QueryClient): void => {
    qc.setQueryData(
      listKey('operations', 'crewBoard', { date: '2026-11-10' }),
      crewBoard('2026-11-10'),
    );
    qc.setQueryData(
      listKey('operations', 'crewDirectory', { date: '2026-11-10' }),
      directory('2026-11-10'),
    );
  };
  const target = { row: LATE, caption: 'بنك الأهلي · فرع المهندسين ← فرع الدقي · 2026-11-10' };

  it('reads the crew from the shipment’s own delivery day, and says which day', () => {
    const html = renderDialog(
      <AssignDeliveryCrewDialog target={target} onClose={() => undefined} />,
      FULL,
      seed,
    );
    expect(html).toContain('data-assign-delivery="s-late"');
    expect(html).toContain('data-assign-delivery-day="2026-11-10"');
    expect(html).toContain(ar('operations.secured.dispatch.reassignAction'));
    // Opens on the crew already assigned: the captain's name in his list, the van in its own.
    expect(html).toMatch(/<option value="ca-1:e-1" selected="">محمود حسن<\/option>/);
    expect(html).toMatch(/<option value="v-150" selected="">150<\/option>/);
    expect(html).toContain('data-assign-delivery-held="true"');
    expect(html).not.toContain('data-assign-delivery-no-crew');
  });

  it('says plainly when that day has no crew with a captain', () => {
    const html = renderDialog(
      <AssignDeliveryCrewDialog
        target={{ row: DUE_TODAY, caption: '…' }}
        onClose={() => undefined}
      />,
      FULL,
      (qc) => {
        qc.setQueryData(listKey('operations', 'crewBoard', { date: TODAY }), {
          ...crewBoard(TODAY),
          rows: [],
        });
        qc.setQueryData(listKey('operations', 'crewDirectory', { date: TODAY }), directory(TODAY));
      },
    );
    expect(html).toContain(ar('operations.secured.dispatch.assignAction'));
    expect(html).toContain('data-assign-delivery-no-crew="true"');
    expect(html).not.toContain('data-assign-delivery-held');
  });

  it('tells a reader who may not read the crew board why, instead of two empty lists', () => {
    const html = renderDialog(
      <AssignDeliveryCrewDialog target={target} onClose={() => undefined} />,
      ['operationsVault.view', 'operationsShipment.edit'],
    );
    expect(html).toContain(ar('operations.secured.dispatch.assignNoAccess'));
    expect(html).not.toContain('data-assign-delivery-captain');
  });
});

describe('«صرف من الخزينة» — one load per vehicle, said before the click', () => {
  const SAME_VAN = inVault('s-van', '2026-11-11', {
    crew: crewOf('ca-1', '150', ['e-2', 'كريم سمير']),
    lines: [{ currencyId: 'egp', amount: 500_000 }],
  });
  const html = renderDialog(
    <DispatchSecuredDialog
      rows={[LATE, LATER, SAME_VAN]}
      onClose={() => undefined}
      onDispatched={() => undefined}
    />,
    FULL,
  );

  it('groups the rows by vehicle, with each one’s captains and count', () => {
    expect(html).toContain('data-dispatch-secured="3"');
    const first = html.slice(
      html.indexOf('data-dispatch-load="ca-1"'),
      html.indexOf('data-dispatch-load="ca-2"'),
    );
    expect(first).toContain(ar('operations.secured.dispatch.vehicleLoad', { vehicle: '150' }));
    expect(first).toContain('محمود حسن · كريم سمير');
    expect(first).toContain('data-dispatch-load-count="2"');
    expect(first).toContain('data-dispatch-load-row="s-late"');
    expect(first).toContain('data-dispatch-load-row="s-van"');
    const second = html.slice(html.indexOf('data-dispatch-load="ca-2"'));
    expect(second).toContain('data-dispatch-load-count="1"');
    expect(second).toContain('سيد علي');
  });

  it('says what leaves in each currency, and what the click does', () => {
    const first = html.slice(
      html.indexOf('data-dispatch-load="ca-1"'),
      html.indexOf('data-dispatch-load="ca-2"'),
    );
    // 1,000,000 + 500,000 pounds on the first van.
    expect(first).toContain('1,500,000');
    expect(html).toContain(ar('operations.secured.dispatch.body'));
    expect(html).toContain(
      ar('operations.secured.dispatch.release', { count: formatNumber(3, 'ar') }),
    );
    expect(html).toContain(`>${ar('operations.secured.dispatch.back')}<`);
  });
});

describe('the lines a refactor could quietly undo', () => {
  it('reads the list under the day board’s key, polling for a reader who hears no crew assigned', () => {
    expect(PAGE).toContain(
      "useOperationsSecuredDispatchBoard(date, true, !can('operationsShipment.view'))",
    );
    expect(PAGE).toContain("const date = readDispatchDate(sp.get('date'));");
    expect(QUERIES).toContain("...featureKey(MODULE, 'dayBoard'),\n  'securedDispatch',");
  });

  it('offers nothing that edits a received row, and no pickup ✓', () => {
    expect(PAGE).toContain('canEditRows={false}');
    expect(PAGE).toContain('canCreate={false}');
    expect(PAGE).not.toContain('canConfirmPickup');
  });

  it('crews a row from ITS delivery day, on its delivery leg’s version', () => {
    expect(ASSIGN).toContain('const day = row === null ? null : deliveryDayOf(row);');
    expect(ASSIGN).toContain('const crewBoard = useOperationsCrewBoard(day, crewOn);');
    expect(ASSIGN).toContain('version: deliveryAssignVersion(row),');
  });

  it('releases one vehicle per call, each to its own crew row', () => {
    expect(RELEASE).toContain('const loads = dispatchLoads(rows);');
    expect(RELEASE).toContain(
      'await dispatch.mutateAsync({ crewAssignmentId: load.crewAssignmentId, shipmentIds: ids });',
    );
  });

  it('lets only shown, crewed ticks go out', () => {
    expect(PAGE).toContain('const ticked = canDispatch ? tickedForDispatch(shown, selected) : [];');
    expect(PAGE).toContain('selectable: offersDispatch,');
  });

  it('words a refusal once, in the dialog, and re-reads the board on it', () => {
    for (const hook of ['useAssignSecuredDelivery', 'useDispatchSecured']) {
      const body = QUERIES.slice(QUERIES.indexOf(`export const ${hook} =`));
      const end = body.indexOf('\n};');
      expect(body.slice(0, end)).toContain('onSettled:');
      expect(body.slice(0, end)).toContain('onError: formOwnsTheError,');
    }
  });

  it('marks a row’s delivery day through the board’s own hook, under the date', () => {
    expect(PAGE).toContain('deliveryNote={deliveryNote}');
    expect(BOARD).toContain('const note = deliveryNote?.(row);');
  });
});
