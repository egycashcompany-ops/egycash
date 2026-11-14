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
import { ReceiveIntoVaultDialog } from '../components/ReceiveIntoVaultDialog';
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

// The receive form names its two treasurers from the operations roster, read on the crew grant.
// A treasurer without it is not sent to ask for the roster (a request that could only be refused,
// and audited as one): the form says why it cannot be completed instead.
describe('the receive form opened from the ✓', () => {
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

  it('says why it cannot be completed to a treasurer who may not read the roster', () => {
    const html = dialog(['operationsVault.view', 'operationsVault.receive']);
    expect(html).toContain('data-receive-no-roster="true"');
    expect(html).toContain(ar('operations.secured.receive.noRoster'));
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it('asks for the roster only with the crew grant', () => {
    expect(DIALOG).toContain("const mayReadRoster = can('operationsCrew.view');");
    expect(DIALOG).toContain(
      'useOperationsCrewDirectory(null, shipment !== null && mayReadRoster);',
    );
    const html = dialog(['operationsVault.view', 'operationsVault.receive', 'operationsCrew.view']);
    expect(html).not.toContain('data-receive-no-roster');
    expect(html).toContain(ar('operations.secured.receive.primary'));
  });

  // Round 13 — «والخزنه تستلم عادي»: opened from a WHITE row it is the same form, asking nothing
  // about a pickup — the vault receives what nobody handed over exactly as the rest.
  it('is the same form opened from a white row — nothing asks for a pickup first', () => {
    const perms = ['operationsVault.view', 'operationsVault.receive', 'operationsCrew.view'];
    const white = dialog(perms, AWAITING);
    const yellow = dialog(perms, WITH_CAPTAIN);
    expect(white).toContain('role="dialog"');
    expect(white).toContain(ar('operations.secured.receive.primary'));
    expect(white).toMatch(/<button type="submit"/);
    expect(white).not.toMatch(/<button type="submit"[^>]*disabled=""/);
    // The very same form, field for field: the dialog never reads who collected it.
    expect(white).toBe(yellow);
    expect(DIALOG).not.toMatch(/pickedUp|securedStage|NOT_PICKED_UP/);
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
