// «شاشة استلام الخزينه», rendered against the real Arabic catalog, a real store and query client:
// the shipments with the captain on a YELLOW row, today's receipts on a GREEN one, and «الكل»
// adding the ones no captain has collected yet on a white one — «لما القائد هيستلم من البنك ويعمل
// علامة صح هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها هتبقى اخضر». The rules are pinned in
// lib/vault-queue.spec.ts; this pins what reaches the screen.
//
// Since «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل اليومى برضو» the screen is the operations
// board (`components/ShipmentsBoard.tsx`): its figures, its filter bar, its dark table with the
// secured screen's columns — and, in the row's actions, the vault's ✓ in place of the desk's. A
// treasurer may read it on the vault's grants alone; what he may not read is not offered to him.
//
// Round 10: «لو قائد تم الاستلام من القائد و لو العمليات تم الاستلام من العمليات وهتبقى صفر بس وهتكون
// ظاهره ل شاشة استلام الخزينة بس مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح» — the
// desk's pickup is yellow and receivable like the captain's, a white row under «الكل» is for viewing
// only, and «إلغاء استلام الخزينة» sits on a green row still in the vault for its special grant.
//
// Round 12: «إضافة محصنة» — the secured screen's button and form — for whoever may book.
//
// Round 13: «انا عايز الجدول بتاع استلام الخزينه يكون مكان الحاله عمودين. العمود الاولاني يبقى خاص
// يبين ان اللي حصل استلام من القائد او من العمليات، والعمود التاني بتاع الحاله برضو يبين استلام من
// الخزينه. واستلام الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه
// تستلم عادي» — «حالة الاستلام» and «حالة الخزينة» in «الحالة»'s place, the vault's ✓ on every row
// not yet received (white too: Round 10's view-only white row is gone), and a receipt nobody handed
// over green with «لم يتم الاستلام» beside «بالخزينة».
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
  type OperationsCurrencyDto,
  type OperationsSecuredStage,
  type OperationsShipmentStatus,
  type OperationsVaultQueueDto,
  type OperationsVaultQueueShipmentDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { HISTORY_TOO_LARGE } from '../lib/shipment-history';
import { __vaultQueueKey } from '../api/operations-queries';
import {
  ReceiveIntoVaultDialog,
  ReceiveSaveButton,
  SealBoxes,
  SealRepeatNotice,
  SealSummaryLine,
} from '../components/ReceiveIntoVaultDialog';
import {
  NO_SEAL_LIST,
  sealRepeatNotice,
  sealRepeatTitle,
  sealRepeats,
  shownSeals,
  typeSeal,
  type SealList,
  type SealRepeats,
} from '../lib/vault-receipt';
import { VaultReceivePage } from './VaultReceivePage';

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
// Arranged on the reference-data screen: the dollar dragged above the pound.
const CURRENCIES = [currency('usd', '2', 'دولار', 0), currency('egp', '1', 'مصري', 1)];

const queueRow = (
  id: string,
  status: OperationsShipmentStatus,
  securedStage: OperationsSecuredStage,
  over: Partial<OperationsVaultQueueShipmentDto> = {},
): OperationsVaultQueueShipmentDto => ({
  id,
  shipmentType: 'secured',
  status,
  mainBankId: 'b-ahly',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'الجيزة',
  // Stored pound first; the catalog puts the dollar first.
  lines: [
    { currencyId: 'egp', amount: 2_500_000 },
    { currencyId: 'usd', amount: 40_000 },
  ],
  collectionDate: '2026-11-11T00:00:00.000Z',
  deliveryDate: '2026-11-12T00:00:00.000Z',
  receiptNumber: null,
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  // Each row's own note — the specs' handle on its `<tr>` (the notes column prints it).
  notes: `note-${id}`,
  receivedById: null,
  receivedAt: null,
  version: 3,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-11T08:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-ahly', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع الدقي', code: 'D1', bankId: 'b-ahly', bankName: 'الأهلي' },
  crew: {
    crewAssignmentId: 'ca-1',
    vehicleId: 'v-1',
    vehicleCode: '150',
    captainEmployeeId: 'e-9',
    captainName: 'محمود حسن',
    captainCode: null,
    captainPhone: null,
    captainBranchId: null,
  },
  captainDeliveredAt: null,
  securedStage,
  pickedUpBy: securedStage === 'awaitingPickup' ? null : 'captain',
  pickedUpAt: securedStage === 'awaitingPickup' ? null : '2026-11-11T07:30:00.000Z',
  vaultReceivedAt: status === 'draft' ? null : '2026-11-11T09:15:00.000Z',
  ...over,
});

const WITH_CAPTAIN = queueRow('s-yellow', 'draft', 'withCaptain');
// Round 10 — the Operations desk confirmed the pickup on the secured screen: the same yellow.
const WITH_OPERATIONS = queueRow('s-desk', 'draft', 'withOperations', {
  pickedUpBy: 'operations',
  pickedUpAt: '2026-11-11T08:05:00.000Z',
});
const RECEIVED = queueRow('s-green', 'inVault', 'inVault');
// Round 13 — nobody confirmed collecting it, and it is on the default list (its collection day has
// come): white, and receivable as it is.
const AWAITING = queueRow('s-white', 'draft', 'awaitingPickup');
// Round 13 — received with nobody's ✓: green, and its pickup column says nobody, for good.
const DIRECT = queueRow('s-direct', 'inVault', 'inVault', { pickedUpBy: null, pickedUpAt: null });
// Received this morning and sent out since: blue on the Operations boards, today's receipt here.
const RECEIVED_THEN_OUT = queueRow('s-out', 'dispatched', 'dispatched', {
  receiptImage: {
    fileId: 'f-1',
    fileName: 'receipt.jpg',
    mime: 'image/jpeg',
    size: 1,
    uploadedAt: '2026-11-11T08:00:00.000Z',
  },
});
// Received this morning, out and delivered since — still today's receipt.
const DELIVERED = queueRow('s-done', 'completed', 'completed');
// «الكل» only — a white one booked for a later collection day.
const BOOKED_AHEAD = queueRow('s-ahead', 'draft', 'awaitingPickup', {
  collectionDate: '2026-11-20T00:00:00.000Z',
  deliveryDate: '2026-11-21T00:00:00.000Z',
});

const queue = (
  all: boolean,
  shipments: OperationsVaultQueueShipmentDto[],
): OperationsVaultQueueDto => ({
  date: '2026-11-11T00:00:00.000Z',
  all,
  shipments,
  crews: [],
});

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const render = ({
  path = '/operations/vault/receive',
  permissions = ['operationsVault.view', 'operationsVault.receive'],
  seed,
}: {
  path?: string;
  permissions?: string[];
  seed: (qc: QueryClient) => void;
}): string => {
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
  // The board's own bank request — by code, as every board names its banks.
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
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/vault/receive" element={<VaultReceivePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The `<tr>` of the row `id` — found by its own note, which the notes column prints. */
const rowOf = (html: string, id: string): string => {
  const at = html.indexOf(`>note-${id}<`);
  expect(at, `the row ${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
};

/** A row's cell in one of the two status columns — its `data-vault-…` span to the end of the cell. */
const cellOf = (tr: string, column: 'pickup' | 'hold'): string => {
  const at = tr.indexOf(`data-vault-${column}=`);
  expect(at, `the ${column} cell`).toBeGreaterThan(-1);
  return tr.slice(at, tr.indexOf('</td>', at));
};

/** The vault's ✓ on a row — the day board's ✓, named for what it does here. */
const RECEIVE_LABEL = `aria-label="${ar('operations.vault.queue.receive')}"`;
/** The page's own source, for the lines a refactor could quietly undo. */
const PAGE = readFileSync(
  fileURLToPath(new URL('./VaultReceivePage.tsx', import.meta.url)),
  'utf8',
);
const DIALOG = readFileSync(
  fileURLToPath(new URL('../components/ReceiveIntoVaultDialog.tsx', import.meta.url)),
  'utf8',
);
const QUERIES = readFileSync(
  fileURLToPath(new URL('../api/operations-queries.ts', import.meta.url)),
  'utf8',
);
const BOARD = readFileSync(
  fileURLToPath(new URL('../components/ShipmentsBoard.tsx', import.meta.url)),
  'utf8',
);

/** A desk reader — he also holds the shipment grant, so «السجل» and the receipt's eye are his. */
const DESK_TREASURER = [
  'operationsVault.view',
  'operationsVault.receive',
  'operationsShipment.view',
  'operationsShipment.edit',
  'operationsShipment.delete',
  'operationsShipment.complete',
  'operationsShipment.create',
];

/** What a chip of the legend counts — its last figure. */
const chipCount = (html: string, state: string): string => {
  const at = html.slice(html.indexOf(`data-vault-legend="${state}"`));
  return at.slice(0, at.indexOf('</span></span>'));
};

const DEFAULT_ROWS = [
  AWAITING,
  WITH_CAPTAIN,
  WITH_OPERATIONS,
  DIRECT,
  RECEIVED,
  RECEIVED_THEN_OUT,
  DELIVERED,
];

describe('the vault’s receive queue — by default, what it can receive now and today’s receipts', () => {
  const html = render({
    seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, DEFAULT_ROWS)),
  });

  // «مكان الحاله عمودين» — in «الحالة»'s place, after «تاريخ التسليم» and before «ملاحظات».
  it('says its status in TWO columns where «الحالة» stood — «حالة الاستلام», then «حالة الخزينة»', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const pickup = head.indexOf(`>${ar('operations.vault.queue.pickupColumn')}<`);
    const vault = head.indexOf(`>${ar('operations.vault.queue.vaultColumn')}<`);
    expect(pickup).toBeGreaterThan(head.indexOf(ar('operations.shipment.deliveryDate')));
    expect(vault).toBeGreaterThan(pickup);
    expect(head.indexOf(`>${ar('operations.shipment.notes')}<`)).toBeGreaterThan(vault);
    expect(head).not.toContain(`>${ar('operations.common.status')}<`);
    expect(ar('operations.vault.queue.pickupColumn')).toBe('حالة الاستلام');
    expect(ar('operations.vault.queue.vaultColumn')).toBe('حالة الخزينة');
    // Every row has one of each — and no stage badge of the single column.
    expect(html.match(/data-vault-pickup="/g)).toHaveLength(DEFAULT_ROWS.length);
    expect(html.match(/data-vault-hold="/g)).toHaveLength(DEFAULT_ROWS.length);
    expect(html).not.toContain('data-secured-stage=');
  });

  // «والخزنه تستلم عادي» — the white row is the vault's work too: the ✓ is on it.
  it('lists the WHITE row by default, with the vault’s ✓ on it — nobody has to hand it over first', () => {
    const white = rowOf(html, 's-white');
    expect(white).not.toContain('!bg-amber-50');
    expect(white).not.toContain('!bg-emerald-50');
    expect(white).toContain('data-vault-receive="s-white"');
    expect(white).toContain(RECEIVE_LABEL);
    // «لم يتم الاستلام», muted, no time — and the vault's side not yet.
    const pickup = cellOf(white, 'pickup');
    expect(pickup).toMatch(/^data-vault-pickup="none"/);
    expect(pickup).toContain(ar('operations.vault.queue.awaiting'));
    expect(pickup).toContain('!bg-transparent');
    expect(pickup).not.toContain('data-vault-stamp');
    const hold = cellOf(white, 'hold');
    expect(hold).toMatch(/^data-vault-hold="waiting"/);
    expect(hold).toContain(ar('operations.vault.queue.hold.waiting'));
    expect(hold).not.toContain('data-vault-stamp');
    // The view-only line of Round 10 is gone.
    expect(html).not.toContain('للعرض فقط');
  });

  it('paints the shipment with the captain YELLOW, says it was his and when, and offers the ✓', () => {
    const yellow = rowOf(html, 's-yellow');
    expect(yellow).toContain('!bg-amber-50');
    expect(yellow).toContain('data-vault-receive="s-yellow"');
    const pickup = cellOf(yellow, 'pickup');
    expect(pickup).toMatch(/^data-vault-pickup="captain"/);
    expect(pickup).toContain(ar('operations.board.stage.withCaptain'));
    expect(pickup).toContain('dateTime="2026-11-11T07:30:00.000Z"');
    expect(pickup).not.toContain('!bg-transparent');
    expect(cellOf(yellow, 'hold')).toMatch(/^data-vault-hold="waiting"/);
  });

  it('says the desk collected the other yellow one — «تم الاستلام من العمليات» — and when', () => {
    const desk = rowOf(html, 's-desk');
    expect(desk).toContain('!bg-amber-50');
    expect(desk).toContain('data-vault-receive="s-desk"');
    const pickup = cellOf(desk, 'pickup');
    expect(pickup).toMatch(/^data-vault-pickup="operations"/);
    expect(pickup).toContain(ar('operations.board.stage.withOperations'));
    expect(pickup).toContain('dateTime="2026-11-11T08:05:00.000Z"');
  });

  // The two columns tell who did what: the vault received it, nobody handed it over.
  it('paints a receipt nobody handed over GREEN, with «لم يتم الاستلام» beside «بالخزينة»', () => {
    const direct = rowOf(html, 's-direct');
    expect(direct).toContain('!bg-emerald-50');
    expect(direct).not.toContain(RECEIVE_LABEL);
    const pickup = cellOf(direct, 'pickup');
    expect(pickup).toMatch(/^data-vault-pickup="none"/);
    expect(pickup).toContain(ar('operations.vault.queue.awaiting'));
    expect(pickup).not.toContain('data-vault-stamp');
    const hold = cellOf(direct, 'hold');
    expect(hold).toMatch(/^data-vault-hold="inVault"/);
    expect(hold).toContain(ar('operations.board.stage.inVault'));
    expect(hold).toContain('dateTime="2026-11-11T09:15:00.000Z"');
    expect(hold).toContain(ar('operations.vault.queue.receivedAt', { at: '' }).trim());
  });

  it('paints today’s receipt GREEN, with no ✓ — it stays, its captain’s pickup still his', () => {
    const green = rowOf(html, 's-green');
    expect(green).toContain('!bg-emerald-50');
    expect(green).not.toContain(RECEIVE_LABEL);
    expect(cellOf(green, 'pickup')).toMatch(/^data-vault-pickup="captain"/);
    expect(cellOf(green, 'hold')).toMatch(/^data-vault-hold="inVault"/);
  });

  it('keeps a receipt GREEN once it has gone out, and says where it went — «خرجت» / «تم التسليم»', () => {
    const out = rowOf(html, 's-out');
    expect(out).toContain('!bg-emerald-50');
    expect(out).not.toContain('bg-sky-50');
    expect(out).not.toContain(RECEIVE_LABEL);
    const outHold = cellOf(out, 'hold');
    expect(outHold).toMatch(/^data-vault-hold="dispatched"/);
    expect(outHold).toContain(ar('operations.board.stage.dispatched'));
    // Still with the vault's own time — when it was received, not when it left.
    expect(outHold).toContain(ar('operations.vault.queue.receivedAt', { at: '' }).trim());
    const done = rowOf(html, 's-done');
    expect(done).toContain('!bg-emerald-50');
    expect(cellOf(done, 'hold')).toMatch(/^data-vault-hold="completed"/);
    expect(cellOf(done, 'hold')).toContain(ar('operations.board.stage.completed'));
  });

  it('says how many rows wear each colour — white, yellow, green, in that order', () => {
    const order = ['awaiting', 'pickedUp', 'received'].map((state) =>
      html.indexOf(`data-vault-legend="${state}"`),
    );
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(chipCount(html, 'awaiting')).toMatch(new RegExp(`>${formatNumber(1, 'ar')}$`));
    expect(chipCount(html, 'pickedUp')).toMatch(new RegExp(`>${formatNumber(2, 'ar')}$`));
    expect(chipCount(html, 'received')).toMatch(new RegExp(`>${formatNumber(4, 'ar')}$`));
    expect(ar('operations.vault.queue.awaiting')).toBe('لم يتم الاستلام');
    expect(ar('operations.vault.queue.pickedUp')).toBe('مع القائد أو العمليات');
    expect(ar('operations.vault.queue.receivedToday')).toBe('بالخزينة اليوم');
  });

  it('offers «الكل» as a toggle, off, after the legend', () => {
    const toggle = html.slice(html.indexOf('data-vault-all-toggle'));
    expect(toggle).toMatch(/^data-vault-all-toggle="true" aria-pressed="false"/);
    expect(toggle).toContain(`${ar('operations.vault.queue.all')}</button>`);
    expect(html.indexOf('data-vault-legend="received"')).toBeLessThan(
      html.indexOf('data-vault-all-toggle'),
    );
  });

  it('prints the money in the catalog’s order — the dollar dragged above the pound', () => {
    const yellow = rowOf(html, 's-yellow');
    expect(yellow.indexOf('دولار')).toBeGreaterThan(-1);
    expect(yellow.indexOf('دولار')).toBeLessThan(yellow.indexOf('مصري'));
  });

  it('names the bank, the branches, the captain and his van', () => {
    const yellow = rowOf(html, 's-yellow');
    // «اسم البنك» from the catalog — the list a treasurer may read on the vault grant.
    expect(yellow).toContain('بنك الأهلي');
    expect(yellow).toContain('فرع المهندسين');
    expect(yellow).toContain('فرع الدقي');
    expect(yellow).toContain('محمود حسن');
    expect(yellow).toContain('150');
  });
});

describe('«خليها زى شاشة التشغيل اليومى» — the operations board’s look', () => {
  const html = render({
    permissions: DESK_TREASURER,
    seed: (qc) =>
      qc.setQueryData(
        __vaultQueueKey(false),
        queue(false, [AWAITING, WITH_CAPTAIN, RECEIVED, RECEIVED_THEN_OUT]),
      ),
  });

  it('opens on the board’s toolbar and figures, over the rows shown', () => {
    expect(html).toContain('data-shipments-toolbar="true"');
    const figures = html.slice(html.indexOf('data-shipment-figures="true"'));
    expect(figures).toContain(ar('operations.board.figures.count'));
    expect(figures).toContain('data-figure="EGP"');
    expect(figures).toContain('data-figure="USD"');
    expect(figures).toContain('data-figure="others"');
    // The legend and «الكل» sit in the toolbar, not in a header of their own.
    const toolbar = html.slice(
      html.indexOf('data-shipments-toolbar'),
      html.indexOf('data-shipment-filters'),
    );
    expect(toolbar).toContain('data-vault-legend="awaiting"');
    expect(toolbar).toContain('data-vault-legend="pickedUp"');
    expect(toolbar).toContain('data-vault-all-toggle');
  });

  it('wears the board’s dark filter bar, with no date to pick', () => {
    expect(html).toContain('data-shipment-filters="true"');
    expect(html).toContain(`aria-label="${ar('operations.board.vehicleCode')}"`);
    expect(html).not.toContain('type="date"');
  });

  // Each status column has its own box, where the stage box stands on the secured screen.
  it('filters each status column by its own box, in the stage box’s place', () => {
    const bar = html.slice(html.indexOf('data-shipment-filters'));
    const pickup = bar.indexOf(`aria-label="${ar('operations.vault.queue.pickupColumn')}"`);
    const vault = bar.indexOf(`aria-label="${ar('operations.vault.queue.vaultColumn')}"`);
    expect(pickup).toBeGreaterThan(bar.indexOf(`aria-label="${ar('operations.board.captain')}"`));
    expect(vault).toBeGreaterThan(pickup);
    expect(bar.indexOf(`aria-label="${ar('operations.shipment.notes')}"`)).toBeGreaterThan(vault);
    expect(bar).not.toContain(`aria-label="${ar('operations.common.status')}"`);
  });

  it('draws the secured screen’s columns — «تاريخ الاستلام» and «تاريخ التسليم», no «النوع»', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(ar('operations.board.collectedOn'));
    expect(head).toContain(ar('operations.shipment.deliveryDate'));
    expect(head).toContain(ar('operations.board.receiptImage'));
    expect(head).not.toContain(`>${ar('operations.shipment.type')}<`);
  });

  it('offers no edit or delete and no desk ✓ — only the vault’s ✓ and «السجل» on a row', () => {
    expect(html).not.toContain(`aria-label="${ar('common.edit')}"`);
    expect(html).not.toContain(`aria-label="${ar('common.remove')}"`);
    expect(html).not.toContain(`aria-label="${ar('operations.shipment.receive')}"`);
    // No pickup ✓ of the desk's either — the vault never writes the pickup.
    expect(html).not.toContain('data-secured-pickup=');
    for (const id of ['s-white', 's-yellow']) {
      const row = rowOf(html, id);
      // The ✓ at the desk ✓'s place, before the log, in the same group.
      expect(row).toContain('data-row-actions="shipment"');
      expect(row.indexOf(RECEIVE_LABEL)).toBeLessThan(row.indexOf(`data-shipment-log="${id}"`));
    }
    // A green row keeps the ✓'s square, empty, so the log stands where it stands on every row.
    const green = rowOf(html, 's-green');
    expect(green).toContain('data-shipment-log="s-green"');
    expect(green).toMatch(
      /<span aria-hidden="true" class="[^"]*invisible[^"]*"><\/span><button[^>]*data-shipment-log="s-green"/,
    );
  });

  it('shows the receipt photo’s eye, never its replace or delete', () => {
    const out = rowOf(html, 's-out');
    expect(out).toContain('data-shipment-receipt-view="s-out"');
    expect(out).not.toContain('data-shipment-receipt-replace');
    expect(out).not.toContain('data-shipment-receipt-delete');
    expect(html).not.toContain('data-shipment-receipt-upload');
  });
});

describe('«الكل» — the white محصنات booked for a later collection day, too — receivable as well', () => {
  const html = render({
    path: '/operations/vault/receive?all=1',
    seed: (qc) =>
      qc.setQueryData(__vaultQueueKey(true), queue(true, [AWAITING, WITH_CAPTAIN, BOOKED_AHEAD])),
  });

  it('is pressed, and counts the white rows it added under the same chip', () => {
    expect(html).toContain('data-vault-all-toggle="true" aria-pressed="true"');
    expect(chipCount(html, 'awaiting')).toMatch(new RegExp(`>${formatNumber(2, 'ar')}$`));
  });

  // Round 13 — a white row is receivable wherever it is listed; «الكل» only widens the list.
  it('offers the vault’s ✓ on the row booked ahead too', () => {
    const ahead = rowOf(html, 's-ahead');
    expect(ahead).toContain('data-vault-receive="s-ahead"');
    expect(cellOf(ahead, 'pickup')).toMatch(/^data-vault-pickup="none"/);
    expect(cellOf(ahead, 'hold')).toMatch(/^data-vault-hold="waiting"/);
  });

  it('tells the reader of the toggle what it adds — not that it is for viewing only', () => {
    expect(ar('operations.vault.queue.allHint')).not.toContain('للعرض فقط');
    expect(ar('operations.vault.queue.allHint')).toContain('لاحق');
    expect(html).toContain(`title="${ar('operations.vault.queue.allHint')}"`);
  });
});

// Round 10 — «لو العمليات تم الاستلام من العمليات وهتبقى صفر بس»: the desk's ✓ on the secured
// screen makes a row yellow exactly as the captain's does.
describe('the desk’s pickup ✓ — yellow, as the captain’s, under ONE chip', () => {
  const html = render({
    seed: (qc) =>
      qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN, WITH_OPERATIONS])),
  });

  it('counts both yellows under ONE chip, and the empty colours at nought', () => {
    expect(html.match(/data-vault-legend="/g)).toHaveLength(3);
    expect(chipCount(html, 'pickedUp')).toMatch(new RegExp(`>${formatNumber(2, 'ar')}$`));
    expect(chipCount(html, 'awaiting')).toMatch(new RegExp(`>${formatNumber(0, 'ar')}$`));
    expect(chipCount(html, 'received')).toMatch(new RegExp(`>${formatNumber(0, 'ar')}$`));
  });

  it('tells the two apart in the pickup column — a van for the captain, the office for the desk', () => {
    expect(cellOf(rowOf(html, 's-yellow'), 'pickup')).toMatch(/^data-vault-pickup="captain"/);
    expect(cellOf(rowOf(html, 's-desk'), 'pickup')).toMatch(/^data-vault-pickup="operations"/);
  });
});

// Round 10 — «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: a special grant, on a green row in the vault.
describe('«إلغاء استلام الخزينة» — on a green row still in the vault, for its grant alone', () => {
  const CANCEL = `aria-label="${ar('operations.secured.cancelReceipt.action')}"`;
  const rows = [AWAITING, WITH_CAPTAIN, RECEIVED, DIRECT, RECEIVED_THEN_OUT];

  it('is offered on the rows in the vault — a direct receipt too — not on one gone out, nor a draft', () => {
    const html = render({
      permissions: [
        'operationsVault.view',
        'operationsVault.receive',
        'operationsVault.cancelReceipt',
      ],
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, rows)),
    });
    const green = rowOf(html, 's-green');
    expect(green).toContain('data-cancel-receipt-open="s-green"');
    expect(green).toContain(CANCEL);
    expect(green).toContain('aria-haspopup="dialog"');
    expect(rowOf(html, 's-direct')).toContain('data-cancel-receipt-open="s-direct"');
    expect(rowOf(html, 's-out')).not.toContain('data-cancel-receipt-open');
    expect(rowOf(html, 's-yellow')).not.toContain('data-cancel-receipt-open');
    expect(rowOf(html, 's-white')).not.toContain('data-cancel-receipt-open');
  });

  it('is offered to nobody without the grant — a treasurer who receives included', () => {
    const html = render({
      permissions: [...DESK_TREASURER],
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, rows)),
    });
    expect(html).not.toContain('data-cancel-receipt-open');
    expect(html).not.toContain(CANCEL);
  });
});

describe('the two status filters — and the legend counts the rows SHOWN, as the figures do', () => {
  const at = (path: string): string =>
    render({
      path: `/operations/vault/receive${path}`,
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, DEFAULT_ROWS)),
    });
  const shown = (html: string): string[] =>
    DEFAULT_ROWS.map((row) => row.id).filter((id) => html.includes(`>note-${id}<`));

  it('«حالة الاستلام» keeps the rows nobody handed over — a direct receipt among them', () => {
    const html = at('?pickup=none');
    expect(shown(html)).toEqual(['s-white', 's-direct']);
    expect(chipCount(html, 'awaiting')).toMatch(new RegExp(`>${formatNumber(1, 'ar')}$`));
    expect(chipCount(html, 'pickedUp')).toMatch(new RegExp(`>${formatNumber(0, 'ar')}$`));
    expect(chipCount(html, 'received')).toMatch(new RegExp(`>${formatNumber(1, 'ar')}$`));
  });

  it('«حالة الخزينة» keeps the rows not received yet — white and yellow alike', () => {
    expect(shown(at('?vault=waiting'))).toEqual(['s-white', 's-yellow', 's-desk']);
    expect(shown(at('?vault=dispatched'))).toEqual(['s-out']);
  });

  it('asks both together', () => {
    expect(shown(at('?pickup=captain&vault=inVault'))).toEqual(['s-green']);
  });

  // The stage box is the secured screen's; a `?stage=` left in the URL narrows nothing here.
  it('reads a stage param as no filter — the vault’s board has no stage box', () => {
    expect(shown(at('?stage=withCaptain'))).toEqual(DEFAULT_ROWS.map((row) => row.id));
  });
});

describe('who may receive, and who may read what', () => {
  it('shows the rows and their colours, but no ✓, to a reader without the grant — white rows included', () => {
    const html = render({
      permissions: ['operationsVault.view'],
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, [AWAITING, WITH_CAPTAIN])),
    });
    expect(rowOf(html, 's-yellow')).toContain('!bg-amber-50');
    expect(html).not.toContain(RECEIVE_LABEL);
    // Nothing to do on a row, and no log to read: no column of empty boxes.
    expect(html).not.toContain('data-row-actions="shipment"');
    expect(html).not.toContain(`>${ar('operations.board.actions')}<`);
  });

  // A treasurer holding the vault's grants alone: the screen offers nothing the server would
  // refuse him — no «السجل» (the shipment grant's), no eye on the receipt photo (its bytes are the
  // shipment grant's too) — and still names the bank and the currencies (their lists answer the
  // vault grant).
  it('offers a vault-only treasurer the ✓ on white and yellow rows, never «السجل» or the receipt’s eye', () => {
    const html = render({
      seed: (qc) =>
        qc.setQueryData(
          __vaultQueueKey(false),
          queue(false, [AWAITING, WITH_CAPTAIN, RECEIVED_THEN_OUT]),
        ),
    });
    expect(rowOf(html, 's-white')).toContain(RECEIVE_LABEL);
    expect(rowOf(html, 's-yellow')).toContain(RECEIVE_LABEL);
    expect(html).not.toContain('data-shipment-log=');
    expect(html).not.toContain('data-shipment-receipt-view');
    // A green row has nothing left for him to do: a dash in the actions' place, not an empty box.
    expect(rowOf(html, 's-out')).not.toContain('data-row-actions="shipment"');
    expect(rowOf(html, 's-yellow')).toContain('بنك الأهلي');
    expect(html).toContain('دولار');
  });

  // The test above seeds the cache, so it would still find the names if the board stopped ASKING
  // for them. Following the Operations reads' habit (`enabled` on the reader's grant), a
  // later edit could tie the board's two catalog reads to `operationsShipment.view`, and a
  // vault-only treasurer would see a blank «اسم البنك» and unnamed money again. Their lists answer
  // the vault grant too (bank.routes.ts, currency.routes.ts), so the board asks whoever reads it.
  it('asks for the bank and currency lists whatever the reader’s grant', () => {
    expect(BOARD).toMatch(
      /const banks = useOperationsBanks\(\{\s*page: 1,\s*pageSize: MAX_PAGE_SIZE,\s*sortBy: 'code',\s*sortDir: 'asc',\s*\}\);/,
    );
    expect(BOARD).toContain(
      'const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });',
    );
    expect(QUERIES).toContain(
      'export const useOperationsBanks = (params: OperationsListParams, enabled = true) =>',
    );
    expect(QUERIES).toContain(
      'export const useOperationsCurrencies = (params: OperationsListParams, enabled = true) =>',
    );
  });

  it('says so when nothing waits', () => {
    const html = render({
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, [])),
    });
    expect(html).toContain(ar('operations.secured.receive.empty'));
  });
});

// Round 18 — «إستلام محصنة», the legacy receive form: «عاوز اخلى الفورم دا لما اجى استلم محصنة».
// «انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله اختيارى»: no treasurers, nothing
// of the receipt required; the shipment's data editable in the same form («تعدّلها عادي»), with the
// shipment form's own boxes and rules; «إيصال» prints the receipt. The rules themselves are pinned
// in lib/vault-receipt.spec.ts and lib/vault-receipt-print.spec.ts; this pins what reaches the form.
describe('«استلام محصنة» — the receive form opened from the ✓', () => {
  const dialog = (
    permissions: string[],
    shipment: OperationsVaultQueueShipmentDto = WITH_CAPTAIN,
  ): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(permissions), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <ReceiveIntoVaultDialog shipment={shipment} onClose={() => undefined} />
        </QueryClientProvider>
      </Provider>,
    );
  };
  const VAULT_ONLY = ['operationsVault.view', 'operationsVault.receive'];

  it('names nobody — no treasurer to pick, no roster asked for, no «شخصان مختلفان»', () => {
    const html = dialog(VAULT_ONLY);
    expect(html).toContain('data-receive-form="open"');
    expect(html).not.toContain('الأمين الأول');
    expect(html).not.toContain('الأمين الثاني');
    expect(html).not.toContain('شخصان مختلفان');
    expect(html).not.toContain('data-receive-no-roster');
    // The receiver is whoever is signed in — said, never picked, never sent.
    expect(html).toContain('data-receive-receiver="true"');
    expect(html).toContain(ar('operations.secured.receive.receiverNote', { name: 'أ ب' }));
    expect(DIALOG).not.toContain('useOperationsCrewDirectory');
    expect(DIALOG).not.toMatch(/receivedBy(Primary|Secondary)Id/);
    // The retired words are gone from the catalog with the pickers.
    for (const key of [
      'primary',
      'secondary',
      'dualControl',
      'sameTreasurer',
      'noRoster',
      'sealsHint',
    ]) {
      expect(ar(`operations.secured.receive.${key}`)).toBe(`operations.secured.receive.${key}`);
    }
  });

  it('requires nothing of the receipt — the number, the counts, the notes counted, the seals', () => {
    const html = dialog(VAULT_ONLY);
    const receipt = html.slice(
      html.indexOf('data-receive-band="receipt"'),
      html.indexOf('data-receive-band="seals"'),
    );
    expect(receipt).toContain('data-receive-number="true"');
    expect(receipt).not.toContain('required=""');
    expect(receipt).not.toContain('aria-required');
    // No star on any of its labels.
    expect(receipt).not.toContain('text-rose-500">*');
    // «استلام» is offered as the form opens, empty as it is.
    expect(html).toMatch(/<button type="button"[^>]*data-receive-save="true"/);
    expect(html).not.toMatch(/data-receive-save="true"[^>]*disabled=""/);
  });

  // «ومش عاوز اى خانة من الخانات دى اجبارى كله اختيارى» — and the form says «جميع الخانات اختيارية»
  // under its title: no box anywhere on it carries the rose star, the shipment's own included (they
  // arrive filled; the vault only corrects them). The shipment form, where they are filled in, keeps
  // its stars.
  it('marks nothing mandatory anywhere — not even the shipment’s data it arrives with', () => {
    const html = dialog(VAULT_ONLY);
    expect(html).toContain(ar('operations.secured.receive.formSubtitle'));
    const form = html.slice(html.indexOf('data-receive-band="shipment"'));
    expect(form).not.toMatch(/text-rose-500">\*/);
    expect(form).not.toContain('required=""');
    expect(form).not.toContain('aria-required');
    for (const box of [
      '<MainBankField',
      '<DraftBranchSide',
      '<CollectionDateField',
      '<DeliveryDateField',
    ]) {
      const at = DIALOG.indexOf(box);
      expect(at, box).toBeGreaterThan(-1);
      expect(DIALOG.slice(at, DIALOG.indexOf('/>', at)), box).toContain('starred={false}');
    }
  });

  it('is legacy’s three bands: the shipment’s data, the receipt, the seals', () => {
    const html = dialog(VAULT_ONLY);
    const at = (band: string): number => html.indexOf(`data-receive-band="${band}"`);
    expect(at('shipment')).toBeGreaterThan(-1);
    expect(at('shipment')).toBeLessThan(at('receipt'));
    expect(at('receipt')).toBeLessThan(at('seals'));
    // The shipment's data: its banks and branches, the area, the money, the crew, the days, «سيريال».
    const shipment = html.slice(at('shipment'), at('receipt'));
    for (const label of [
      'operations.shipment.form.mainBank',
      'operations.shipment.origin',
      'operations.shipment.destination',
      'operations.shipment.area',
      'operations.secured.receive.money',
      'operations.shipment.form.captain',
      'operations.shipment.form.vehicle',
      'operations.board.collectedOn',
      'operations.shipment.deliveryDate',
      'operations.shipment.notes',
      'operations.secured.receive.serial',
    ]) {
      expect(shipment, label).toContain(ar(label));
    }
    expect(shipment).toContain('data-receive-serial="true"');
    // The receipt: the number, bags with «2×»/«3×», boxes, cartons, nine denominations.
    const receipt = html.slice(at('receipt'), at('seals'));
    expect(receipt).toContain('data-receive-per-bag="2"');
    expect(receipt).toContain('data-receive-per-bag="3"');
    expect(receipt).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*data-receive-per-bag="2"/);
    for (const count of ['bags', 'boxes', 'cartons']) {
      expect(receipt).toContain(`data-receive-count="${count}"`);
    }
    expect(receipt.match(/data-receive-denomination="/g)).toHaveLength(9);
    expect(receipt).toContain('data-receive-denomination="0.50"');
    expect(receipt).toContain('data-receive-total="none"');
    // The seals: bags then boxes — no box drawn before a count is typed.
    const seals = html.slice(at('seals'));
    expect(seals.indexOf('data-seal-list="bag"')).toBeLessThan(
      seals.indexOf('data-seal-list="box"'),
    );
    expect(seals).not.toContain('data-seal-input=');
    expect(seals).toContain(ar('operations.secured.receive.sealsEmpty'));
  });

  // Round 18b — «خلى الفئات لوحدها كدا فوق رقم الايصال والكلام دا»: the notes of each denomination
  // on a row of their own, over the receipt number and the packages, as legacy drew them — no
  // longer a column beside them.
  it('puts «عدد الورق من كل فئة» on a row of its own, OVER the receipt number and the packages', () => {
    const html = dialog(VAULT_ONLY);
    const band = html.slice(
      html.indexOf('data-receive-band="receipt"'),
      html.indexOf('data-receive-band="seals"'),
    );
    const order = [
      'data-receive-denominations="true"',
      ar('operations.secured.receive.receiptNumber'),
      'data-receive-number="true"',
      'data-receive-per-bag="2"',
      'data-receive-count="bags"',
      'data-receive-count="boxes"',
      'data-receive-count="cartons"',
    ].map((mark) => band.indexOf(mark));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The row holds the nine boxes, the words and what they come to — and none of the receipt's
    // own fields beside them.
    const row = band.slice(order[0], order[1]);
    expect(row.match(/data-receive-denomination="/g)).toHaveLength(9);
    expect(row).toContain(ar('operations.secured.receive.denominations'));
    expect(row).toContain('data-receive-total="none"');
    expect(row).toContain(ar('operations.secured.receive.shipmentPound'));
    expect(row).not.toContain('data-receive-count=');
    expect(row).not.toContain('data-receive-per-bag=');
    // Nine across from a tablet up — the old side-by-side split of the band is gone.
    expect(DIALOG).toContain('grid grid-cols-5 gap-1.5 sm:grid-cols-9');
    expect(DIALOG).not.toContain('xl:grid-cols-[minmax(0,4.5fr)_minmax(0,5.5fr)]');
  });

  // «والكراتين اقدر اكتب رقم بس ملهاش سيريال ولا الكلام دا رقم عادى».
  it('takes the cartons as a plain count — no seal box, no serial', () => {
    const html = dialog(VAULT_ONLY);
    expect(html).toContain('data-receive-count="cartons"');
    expect(html.match(/data-seal-list="/g)).toHaveLength(2);
    expect(html).not.toContain('data-seal-list="carton"');
    expect(DIALOG).toMatch(/rule="integer"\s+value=\{cartonCount\}/);
    expect(DIALOG).not.toMatch(/carton\w*Seal|kind="carton"/i);
  });

  // Round 18b — «عاوز لو دخل اول خانة فى الحقائب او الصناديق و دخل فى الخانة الاخير رقم يملى اللى ف
  // النص بالترتيب بينهم». The rules are `fillSealRange`'s, pinned in lib/vault-receipt.spec.ts; this
  // pins that the form runs them — on each list alone, on every box typed, and when the count or
  // «2×»/«3×» moves the last box — and sends what the boxes show.
  it('fills the boxes between the first and the last — bags and boxes each on their own', () => {
    expect(DIALOG).toContain('set((prev) => typeSeal(prev, boxes, index, value));');
    expect(DIALOG).toContain('onChange={setSeal(setBagSeals, slots.bags)}');
    expect(DIALOG).toContain('onChange={setSeal(setBoxSeals, slots.boxes)}');
    expect(DIALOG).toContain(
      'useEffect(() => setBagSeals((list) => fillSealRange(list, slots.bags)), [slots.bags]);',
    );
    expect(DIALOG).toContain(
      'useEffect(() => setBoxSeals((list) => fillSealRange(list, slots.boxes)), [slots.boxes]);',
    );
    // Sent and printed as the boxes show them, the filled ones with the rest.
    expect(DIALOG).toContain('bagSeals: bagSeals.seals,');
    expect(DIALOG).toContain('boxSeals: boxSeals.seals,');
    expect(DIALOG).toContain('bagSeals: sealsToSend(bagSeals.seals, slots.bags),');
    expect(DIALOG).toContain('boxSeals: sealsToSend(boxSeals.seals, slots.boxes),');
    // A new receipt starts with no box typed and none filled.
    expect(DIALOG).toContain('setBagSeals(NO_SEAL_LIST);');
    expect(DIALOG).toContain('setBoxSeals(NO_SEAL_LIST);');
  });

  it('tints a box the fill wrote, and says a run that does not fit beside the summary line', () => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(VAULT_ONLY), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const bags = (first: string, last: string): string =>
      renderToStaticMarkup(
        <Provider store={store}>
          <SealBoxes
            kind="bag"
            title={ar('operations.secured.receive.bagSeals')}
            list={typeSeal(typeSeal(NO_SEAL_LIST, 4, 0, first), 4, 3, last)}
            slots={4}
            perUnit={2}
            onChange={() => undefined}
          />
        </Provider>,
      );
    // 1 … 4 over four boxes: 2 and 3 written by the form, tinted and titled so.
    const filled = bags('1', '4');
    expect(filled.match(/data-seal-filled="true"/g)).toHaveLength(2);
    const inputs = filled.match(/<input[^>]*>/g) ?? [];
    expect(inputs.filter((tag) => tag.includes('data-seal-filled="true"'))).toEqual([
      expect.stringContaining('value="2"'),
      expect.stringContaining('value="3"'),
    ]);
    expect(filled).toContain(
      `title="${ar('operations.secured.receive.bagSealInput', { unit: 1, seal: 2 })} — ${ar('operations.secured.receive.sealFilled')}"`,
    );
    expect(filled).not.toContain('data-seal-range');
    // 1 … 5 over four boxes: nothing filled, and the bar says why — after the summary it explains.
    const said = bags('1', '5');
    expect(said).not.toContain('data-seal-filled');
    expect(said).toContain('data-seal-range="mismatch"');
    expect(said).toContain(
      ar('operations.secured.receive.rangeMismatch', { from: '1', to: '5', boxes: 4 }),
    );
    const bar = said.slice(0, said.indexOf('<input'));
    expect(bar.indexOf('data-seal-summary')).toBeGreaterThan(-1);
    expect(bar.indexOf('data-seal-summary')).toBeLessThan(bar.indexOf('data-seal-range'));
  });

  // Round 21 — the owner, over this very form with bags 1 … 6 and boxes 1 and 3: «مينفعش يكون فيه
  // رقم للحقائب و الصناديق زى بعض برضو». The rules are `sealRepeats`'s (lib/vault-receipt.spec.ts);
  // this pins what reaches the form: the red boxes, the ONE notice, «استلام» held.
  describe('one seal, once per receipt — the red boxes, the one notice, «استلام» held', () => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
      preloadedState: {
        locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
        auth: { me: me(VAULT_ONLY), status: 'signedIn' as const },
        ui: { theme: 'light' as const, sidebarOpen: false },
      },
    });
    const wrap = (node: JSX.Element): string =>
      renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
    // The owner's screen: bags 1 … 6 — typed at the ends, the fill writing 2 … 5 — boxes 1 and 3.
    const BAGS = typeSeal(typeSeal(NO_SEAL_LIST, 6, 0, '1'), 6, 5, '6');
    const BOXES: SealList = { seals: ['1', '3'], filled: [] };
    const FOUND = sealRepeats(shownSeals(BAGS, 6), shownSeals(BOXES, 2));
    const titles = (list: 'bag' | 'box', marks: SealRepeats['bags']): (string | null)[] =>
      marks.map((repeat, index) =>
        repeat === null ? null : sealRepeatTitle(repeat, { list, index }, 2, ar, 'ar'),
      );
    const NOTICE = sealRepeatNotice(FOUND.repeats, ar, 'ar');

    it('draws every box of a repeat red and invalid, titled with where else its seal is', () => {
      const bags = wrap(
        <SealBoxes
          kind="bag"
          title={ar('operations.secured.receive.bagSeals')}
          list={BAGS}
          slots={6}
          perUnit={2}
          repeated={titles('bag', FOUND.bags)}
          onChange={() => undefined}
        />,
      );
      const inputs = bags.match(/<input[^>]*>/g) ?? [];
      expect(inputs.map((tag) => tag.includes('data-seal-repeat="true"'))).toEqual([
        true,
        false,
        true,
        false,
        false,
        false,
      ]);
      expect(inputs[0]).toContain('aria-invalid="true"');
      expect(inputs[0]).toContain('border-rose-500');
      expect(inputs[0]).toContain(
        `title="${ar('operations.secured.receive.bagSealInput', { unit: 1, seal: 1 })} — مكرر — موجود أيضًا في الصندوق 1، الختم 1"`,
      );
      expect(inputs[1]).not.toContain('aria-invalid');
      expect(inputs[1]).not.toContain('border-rose-500');
      // The 3 the range fill wrote collides too: still the fill's, and marked all the same.
      expect(inputs[2]).toContain('data-seal-filled="true"');
      expect(inputs[2]).toContain('aria-invalid="true"');
      expect(inputs[2]).toContain(
        `title="${ar('operations.secured.receive.bagSealInput', { unit: 2, seal: 1 })} — ${ar('operations.secured.receive.sealFilled')} — مكرر — موجود أيضًا في الصندوق 1، الختم 2"`,
      );
      const boxes = wrap(
        <SealBoxes
          kind="box"
          title={ar('operations.secured.receive.boxSeals')}
          list={BOXES}
          slots={2}
          perUnit={2}
          repeated={titles('box', FOUND.boxes)}
          onChange={() => undefined}
        />,
      );
      const boxInputs = boxes.match(/<input[^>]*>/g) ?? [];
      expect(boxInputs.every((tag) => tag.includes('aria-invalid="true"'))).toBe(true);
      expect(boxInputs[1]).toContain('موجود أيضًا في الحقيبة 2، الختم 1');
      // Nothing repeated, nothing marked.
      const clean = wrap(
        <SealBoxes
          kind="box"
          title={ar('operations.secured.receive.boxSeals')}
          list={{ seals: ['7', '8'], filled: [] }}
          slots={2}
          perUnit={2}
          onChange={() => undefined}
        />,
      );
      expect(clean).not.toContain('aria-invalid');
      expect(clean).not.toContain('data-seal-repeat');
    });

    it('says it ONCE, under both lists — the amber «مكرر» beside each summary line is gone', () => {
      expect(NOTICE).toBe('الرقمان 1 و3 مكرران — في الحقائب والصناديق');
      const notice = wrap(<SealRepeatNotice id="seal-notice" text={NOTICE} />);
      expect(notice).toContain('role="alert"');
      expect(notice).toContain('id="seal-notice"');
      expect(notice).toContain('data-seal-repeat="true"');
      expect(notice).toContain(NOTICE);
      expect(notice).toContain(ar('operations.secured.receive.sealRepeatRule'));
      // A seal typed twice in one list is listed once on its line, with no chip of its own.
      const line = wrap(<SealSummaryLine seals={['5', '6', '5']} />);
      expect(line).toContain('[5 - 6]');
      expect(line).not.toContain('data-seal-duplicates');
      expect(line).not.toContain(ar('operations.secured.receive.duplicates', { seals: '5' }));
      // The form reads both lists ON SCREEN as one, and says it once, after both, in the band.
      expect(DIALOG).toContain(
        'const repeats = sealRepeats(shownSeals(bagSeals, slots.bags), shownSeals(boxSeals, slots.boxes));',
      );
      expect(DIALOG).toContain("repeated={repeatedAt('bag', repeats.bags)}");
      expect(DIALOG).toContain("repeated={repeatedAt('box', repeats.boxes)}");
      const band = DIALOG.slice(DIALOG.indexOf('data-receive-band="seals"'));
      expect(band.indexOf("repeated={repeatedAt('box', repeats.boxes)}")).toBeLessThan(
        band.indexOf('<SealRepeatNotice id={noticeId} text={sealsSaid} />'),
      );
      expect(band.indexOf('<SealRepeatNotice')).toBeLessThan(band.indexOf('</Band>'));
      expect(DIALOG.match(/<SealRepeatNotice /g)).toHaveLength(1);
    });

    it('holds «استلام» while a seal repeats — the reason its title, the notice its description', () => {
      const held = wrap(
        <ReceiveSaveButton
          busy={false}
          blocked={NOTICE}
          describedBy="n"
          onClick={() => undefined}
        />,
      );
      expect(held).toMatch(/<button[^>]*disabled=""/);
      expect(held).toContain(`title="${NOTICE}"`);
      expect(held).toContain('aria-describedby="n"');
      expect(held).toContain('data-receive-blocked="seals"');
      expect(held).toContain(ar('operations.secured.receive.action'));
      const free = wrap(
        <ReceiveSaveButton busy={false} blocked={null} describedBy="n" onClick={() => undefined} />,
      );
      expect(free).not.toContain('disabled=""');
      expect(free).not.toContain('title=');
      expect(free).not.toContain('aria-describedby');
      // The form holds it on the notice it shows — and never sends past it.
      expect(DIALOG).toContain("blocked={repeatNotice === '' ? null : repeatNotice}");
      const submit = DIALOG.slice(DIALOG.indexOf('const submit = async'));
      expect(submit.indexOf("if (repeatNotice !== '') return;")).toBeGreaterThan(-1);
      expect(submit.indexOf("if (repeatNotice !== '') return;")).toBeLessThan(
        submit.indexOf('receive.mutateAsync'),
      );
    });

    it('says the server’s refusal of a repeat in the same words, on the form', () => {
      // Read from what was SENT, in the notice's own words — not «بعض الحقول تحتاج إلى مراجعة».
      expect(DIALOG).toContain("refusal.field === 'seals'");
      expect(DIALOG).toContain('sealRepeats(body.bagSeals ?? [], body.boxSeals ?? []).repeats,');
      expect(DIALOG).toContain(
        "const sealsSaid = repeatNotice !== '' ? repeatNotice : (refusedOn('seals') ?? '');",
      );
      // Said until the seals change.
      expect(DIALOG).toContain(
        "() => setRefused((prev) => (prev?.field === 'seals' ? null : prev)),",
      );
    });

    it('opens with nothing to say — no red box, no notice, «استلام» offered', () => {
      const html = dialog(VAULT_ONLY);
      expect(html).not.toContain('data-seal-repeat');
      expect(html).not.toContain('aria-invalid');
      expect(html).not.toContain('data-receive-blocked');
    });
  });

  it('shows the captain and the van read only — the crew is set on the crew screens', () => {
    const html = dialog(VAULT_ONLY);
    expect(html).toMatch(/data-receive-captain="true"[^>]*role="textbox"[^>]*aria-readonly="true"/);
    expect(html).toMatch(/data-receive-captain="true"[^>]*>محمود حسن</);
    expect(html).toMatch(/data-receive-vehicle="true"[^>]*>150</);
    expect(html).toContain(ar('operations.secured.receive.crewReadOnly'));
  });

  it('offers «إيصال» beside «استلام» — a draft before the receipt, the receipt after it', () => {
    const html = dialog(VAULT_ONLY);
    expect(html).toContain('data-receive-print="draft"');
    expect(html).toContain(ar('operations.secured.receive.print'));
    expect(DIALOG).toContain("data-receive-print={locked ? 'final' : 'draft'}");
    expect(DIALOG).toContain('printFleetReport(report);');
  });

  // Round 13 — «والخزنه تستلم عادي»: opened from a WHITE row it is the same form, asking nothing
  // about a pickup — the vault receives what nobody handed over exactly as the rest.
  it('is the same form opened from a white row — nothing asks for a pickup first', () => {
    const white = dialog(VAULT_ONLY, AWAITING);
    const yellow = dialog(VAULT_ONLY, WITH_CAPTAIN);
    expect(white).toContain('role="dialog"');
    expect(white).not.toMatch(/data-receive-save="true"[^>]*disabled=""/);
    // The very same form, field for field: the dialog never reads who collected it.
    expect(white).toBe(yellow);
    expect(DIALOG).not.toMatch(/pickedUp|securedStage|NOT_PICKED_UP/);
  });

  // «Extract shared pieces from the shipment form rather than copy»: the receive form holds the
  // shipment's data in the shipment form's own draft, and draws it with its boxes.
  it('edits the shipment’s data with the shipment form’s own draft and boxes — no copy of its rules', () => {
    expect(DIALOG).toContain("from './ShipmentDraftFields';");
    expect(DIALOG).toMatch(
      /const draft = useShipmentDraft\(\{\s+open,\s+shipment,\s+createType: 'secured',/,
    );
    for (const box of [
      '<MainBankField',
      '<DraftBranchSide',
      '<AreaBox',
      '<MoneyLines',
      '<CollectionDateField',
      '<DeliveryDateField',
      '<NotesField',
      '<DraftBranchCreate',
    ]) {
      expect(DIALOG, box).toContain(box);
    }
    for (const rule of [
      'followMainBank(',
      'areaOfDestination(',
      'deliveryDateProblem(',
      'shipmentDateProblem(',
    ]) {
      expect(DIALOG, rule).not.toContain(rule);
    }
  });

  it('sends ONE request: the receipt, with only the shipment fields the vault changed', () => {
    expect(DIALOG).toContain(
      'const body = receiveRequest(receipt, shipmentPatch(shipment, values()), shipment.version);',
    );
    expect(DIALOG).toContain('await receive.mutateAsync({ id: shipment.id, body });');
    expect(DIALOG.match(/mutateAsync\(/g)).toHaveLength(1);
    // The dates' floors are said before anything is sent, as the shipment form says them.
    const submit = DIALOG.slice(DIALOG.indexOf('const submit = async'));
    expect(submit.indexOf('draft.dateProblems(cairoToday())')).toBeLessThan(
      submit.indexOf('receive.mutateAsync'),
    );
  });

  it('moves a scanner on to the next seal box on Enter — and never submits on it', () => {
    expect(DIALOG).toMatch(
      /if \(e\.key !== 'Enter'\) return;\s+e\.preventDefault\(\);\s+toNextSeal\(e\.currentTarget\);/,
    );
    expect(DIALOG).toContain('next.select();');
    // No <form>: an Enter anywhere in it can never press «استلام».
    expect(DIALOG).not.toContain('<form');
  });

  it('stays open after the receipt, locked, so «إيصال» prints it at once', () => {
    expect(DIALOG).toContain('setTaken(result.receipt);');
    expect(DIALOG).toContain('<fieldset disabled={locked}');
    // It closes on its own only for a refusal that says this row can no longer be received here.
    expect(DIALOG).toContain('if (refusal.closes) onClose();');
    expect(DIALOG).toContain(
      'if (refusal.field !== null) setRefused({ field: refusal.field, text });',
    );
  });

  it('owns its refusal’s words, and re-reads the boards either way', () => {
    const hook = QUERIES.slice(QUERIES.indexOf('export const useReceiveIntoVault'));
    expect(hook.slice(0, hook.indexOf('};'))).toContain('onSettled: invalidate,');
    expect(hook.slice(0, hook.indexOf('};'))).toContain('onError: formOwnsTheError,');
  });
});

describe('what the page hands the board — the lines a refactor could quietly undo', () => {
  it('is drawn by the shared board, not a table of its own', () => {
    expect(PAGE).toContain('<ShipmentsBoard');
    expect(PAGE).not.toContain('<DataTable');
    expect(PAGE).not.toContain('<PageHeader');
  });

  it('offers no desk ✓, no edit or delete — the treasury receives here', () => {
    expect(PAGE).toContain('canToggleReceived={false}');
    expect(PAGE).toContain('canEditRows={false}');
  });

  it('Round 12 — books a محصنة as the secured screen does, through the board’s own button', () => {
    // «يقدر يعمل اضافة ل محصنة زى شاشة الشحنات المحصنة بالظبط»: the same two props the secured
    // screen hands the board — the board gates the button on `operationsShipment.create`.
    expect(PAGE).toMatch(/^\s+canCreate$/m);
    expect(PAGE).toContain('createType="secured"');
    expect(PAGE).not.toContain('canCreate={false}');
  });

  // Round 13 — the VAULT's board: the secured board's columns with «الحالة» in two, each column
  // with its own filter (so no stage list to hand in), and its own colours.
  it('is the vault’s board, with its own colours — two status columns, no stage box', () => {
    expect(PAGE).toContain('kind="vault"');
    expect(PAGE).not.toContain('kind="secured"');
    expect(PAGE).not.toContain('stages=');
    expect(PAGE).not.toContain('statusNote');
    expect(PAGE).toContain('tintOf={vaultRowTint}');
    // The Round 10 view-only line is gone, with its key.
    expect(PAGE).not.toContain('viewOnly');
    expect(ar('operations.vault.queue.viewOnly')).toBe('operations.vault.queue.viewOnly');
  });

  it('draws the legend’s three colours whatever «الكل» says — white, yellow, green', () => {
    expect(PAGE).toContain('VAULT_LEGEND.map((state) => (');
    expect(PAGE).not.toMatch(/all\s*\?\s*\['pickedUp'/);
  });

  it('offers the vault’s ✓ only to whoever may receive, and only on a row still outside the vault', () => {
    expect(PAGE).toContain("const canReceive = can('operationsVault.receive');");
    // `mayReceive` — every draft, white or yellow (Round 13; lib/vault-queue.spec pins it).
    expect(PAGE).toContain('rowAction={canReceive ? receiveAction : undefined}');
    expect(PAGE).toMatch(
      /mayReceive\(row\) \? \(\s*<button[\s\S]*?onClick=\{\(\) => setReceiving\(row\)\}/,
    );
    expect(PAGE).toContain("className={actionTone('status')}");
    expect(PAGE).toContain('<ReceiveIntoVaultDialog shipment={receiving}');
  });

  it('turns on the board’s «إلغاء استلام الخزينة» — the board gates it on its own grant', () => {
    expect(PAGE).toMatch(/^\s+canCancelReceipt$/m);
    expect(BOARD).toContain(
      "const canCancel = canCancelReceipt && can('operationsVault.cancelReceipt');",
    );
  });

  it('says a refusal in the table’s place, and feeds the board nothing beside it', () => {
    expect(PAGE).toContain('const tooLarge = isHistoryTooLarge(queue.error);');
    expect(PAGE).toContain('shipments={tooLarge ? [] : (queue.data?.shipments ?? [])}');
    expect(PAGE).toContain('const loaded = !tooLarge && queue.data !== undefined;');
    expect(PAGE).toContain('refusal={refusal}');
  });

  // Realtime: the queue lives under the day board's key, so every shipment signal refreshes it; a
  // reader who hears none of them (no shipment grant) has it re-read once a minute instead.
  it('keeps up for a treasurer who hears no shipment signal', () => {
    expect(PAGE).toContain("useOperationsVaultQueue(all, true, !can('operationsShipment.view'))");
    expect(QUERIES).toContain('refetchInterval: poll ? VAULT_QUEUE_POLL_MS : false,');
    expect(QUERIES).toContain('refetchIntervalInBackground: false,');
    expect(QUERIES).toContain("...featureKey(MODULE, 'dayBoard'),\n  'vaultQueue',");
  });
});

// The server REFUSES a queue holding more than one screen may show (never cuts it short). The
// generic wording of that refusal is the history's — «يُرجى تضييق التاريخ» — and this screen has no
// dates to narrow, so it says it in the secured screen's words, in the table's place.
describe('a queue too large to show', () => {
  const refused = (qc: QueryClient, kept?: OperationsVaultQueueDto): void => {
    // A failed read is shown as failed, rather than as a retry starting.
    qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
    const query = qc.getQueryCache().build(qc, { queryKey: [...__vaultQueueKey(false)] });
    query.setState({
      ...query.state,
      ...(kept === undefined ? {} : { data: kept, dataUpdatedAt: 1 }),
      status: 'error',
      error: new ApiError(HISTORY_TOO_LARGE, 'too many', 422),
      errorUpdatedAt: 2,
      fetchStatus: 'idle',
    });
  };

  it('says so in the secured screen’s words, not as a range to narrow', () => {
    const html = render({ seed: (qc) => refused(qc) });
    expect(html).toContain(
      ar('operations.secured.backlog.tooLarge', {
        max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, 'ar'),
      }),
    );
    expect(html).not.toContain(
      errorMessage(new ApiError(HISTORY_TOO_LARGE, 'too many', 422), 'ar'),
    );
    expect(html).not.toContain(ar('operations.secured.receive.empty'));
  });

  it('shows neither the rows, the figures nor the legend of an earlier answer beside the refusal', () => {
    const html = render({ seed: (qc) => refused(qc, queue(false, [WITH_CAPTAIN, RECEIVED])) });
    expect(html).not.toContain('data-vault-pickup=');
    expect(html).not.toContain('data-vault-hold=');
    expect(html).not.toContain('data-vault-legend=');
    expect(html).not.toContain('data-shipment-figures');
  });

  // A choice of view, not part of the answer, so it stays (the server's cap counts the list it would
  // read — with «الكل», the white ones booked ahead as well).
  it('still offers «الكل» beside a refusal — the screen’s view, not part of the answer', () => {
    const html = render({ seed: (qc) => refused(qc) });
    expect(html).toContain('data-vault-all-toggle="true"');
  });
});

// Round 12 — «وعاوز فى استلام الخزينة انه يقدر يعمل اضافة ل محصنة زى شاشة الشحنات المحصنة بالظبط».
describe('«إضافة محصنة» on the vault’s receive screen', () => {
  const seed = (qc: QueryClient): void => {
    qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN]));
  };

  it('is offered to whoever may book — the secured screen’s words, after the legend and «الكل»', () => {
    const html = render({ permissions: DESK_TREASURER, seed });
    const toolbar = html.slice(
      html.indexOf('data-shipments-toolbar'),
      html.indexOf('data-shipment-filters'),
    );
    expect(toolbar).toContain('data-shipment-new="true"');
    expect(toolbar).toContain(ar('operations.secured.backlog.add'));
    expect(toolbar.indexOf('data-vault-all-toggle')).toBeLessThan(
      toolbar.indexOf('data-shipment-new="true"'),
    );
  });

  it('is offered to nobody without the booking grant — a treasurer who receives only', () => {
    const html = render({ permissions: ['operationsVault.view', 'operationsVault.receive'], seed });
    expect(html).not.toContain('data-shipment-new');
  });

  it('adds nothing else a desk does: still no edit, no delete, no desk ✓ on a row', () => {
    const html = render({ permissions: DESK_TREASURER, seed });
    expect(html).not.toContain(`aria-label="${ar('common.edit')}"`);
    expect(html).not.toContain(`aria-label="${ar('common.remove')}"`);
    expect(html).not.toContain(`aria-label="${ar('operations.shipment.receive')}"`);
  });
});
