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
  notes: null,
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
const AWAITING = queueRow('s-white', 'draft', 'awaitingPickup');
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

/** The `<tr>` holding a row whose status cell says `state`. */
const rowOf = (html: string, state: string, nth = 0): string => {
  let at = -1;
  for (let i = 0; i <= nth; i += 1) at = html.indexOf(`data-vault-row="${state}"`, at + 1);
  expect(at, `a ${state} row`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
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

describe('the vault’s receive queue — by default, with the captain and in the vault today', () => {
  const html = render({
    seed: (qc) =>
      qc.setQueryData(
        __vaultQueueKey(false),
        queue(false, [WITH_CAPTAIN, RECEIVED, RECEIVED_THEN_OUT]),
      ),
  });

  it('paints the shipment with the captain YELLOW and offers the vault’s ✓ on it', () => {
    const yellow = rowOf(html, 'pickedUp');
    expect(yellow).toContain('!bg-amber-50');
    expect(yellow).toContain(`data-vault-receive="s-yellow"`);
    expect(yellow).toContain(RECEIVE_LABEL);
    expect(yellow).toContain('data-secured-stage="withCaptain"');
    expect(yellow).toContain(ar('operations.vault.queue.pickedUpAt', { at: '' }).trim());
  });

  it('paints today’s receipt GREEN, with no ✓ — it stays, it is not removed', () => {
    const green = rowOf(html, 'received');
    expect(green).toContain('!bg-emerald-50');
    expect(green).not.toContain(RECEIVE_LABEL);
    expect(green).toContain('data-secured-stage="inVault"');
    expect(green).toContain(ar('operations.vault.queue.receivedAt', { at: '' }).trim());
  });

  it('keeps a receipt GREEN once it has gone out — the boards’ blue is not the vault’s colour', () => {
    const out = rowOf(html, 'received', 1);
    expect(out).toContain('data-secured-stage="dispatched"');
    expect(out).toContain('!bg-emerald-50');
    expect(out).not.toContain('bg-sky-50');
    expect(out).not.toContain(RECEIVE_LABEL);
  });

  it('says how many rows wear each colour, and lists no white ones', () => {
    expect(html).toContain('data-vault-legend="pickedUp"');
    expect(html).toContain('data-vault-legend="received"');
    expect(html).not.toContain('data-vault-legend="awaiting"');
    expect(html).toContain(ar('operations.vault.queue.pickedUp'));
    expect(html).toContain(ar('operations.vault.queue.receivedToday'));
    const received = html.slice(html.indexOf('data-vault-legend="received"'));
    expect(received.slice(0, received.indexOf('</span></span>'))).toMatch(
      new RegExp(`>${formatNumber(2, 'ar')}$`),
    );
  });

  it('offers «الكل» as a toggle, off', () => {
    const toggle = html.slice(html.indexOf('data-vault-all-toggle'));
    expect(toggle).toMatch(/^data-vault-all-toggle="true" aria-pressed="false"/);
    expect(toggle).toContain(`${ar('operations.vault.queue.all')}</button>`);
  });

  it('prints the money in the catalog’s order — the dollar dragged above the pound', () => {
    const yellow = rowOf(html, 'pickedUp');
    expect(yellow.indexOf('دولار')).toBeGreaterThan(-1);
    expect(yellow.indexOf('دولار')).toBeLessThan(yellow.indexOf('مصري'));
  });

  it('names the bank, the branches, the captain and his van', () => {
    const yellow = rowOf(html, 'pickedUp');
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
        queue(false, [WITH_CAPTAIN, RECEIVED, RECEIVED_THEN_OUT]),
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
    expect(toolbar).toContain('data-vault-legend="pickedUp"');
    expect(toolbar).toContain('data-vault-all-toggle');
  });

  it('wears the board’s dark filter bar, with no date to pick', () => {
    expect(html).toContain('data-shipment-filters="true"');
    expect(html).toContain(`aria-label="${ar('operations.board.vehicleCode')}"`);
    expect(html).not.toContain('type="date"');
  });

  it('draws the secured screen’s columns — «تاريخ الاستلام» and «تاريخ التسليم», no «النوع»', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(ar('operations.board.collectedOn'));
    expect(head).toContain(ar('operations.shipment.deliveryDate'));
    expect(head).toContain(ar('operations.board.receiptImage'));
    expect(head).not.toContain(`>${ar('operations.shipment.type')}<`);
  });

  it('offers no «إضافة», no edit or delete and no desk ✓ — only the vault’s ✓ and «السجل»', () => {
    expect(html).not.toContain('data-shipment-new');
    expect(html).not.toContain(`aria-label="${ar('common.edit')}"`);
    expect(html).not.toContain(`aria-label="${ar('common.remove')}"`);
    expect(html).not.toContain(`aria-label="${ar('operations.shipment.receive')}"`);
    const yellow = rowOf(html, 'pickedUp');
    // The ✓ at the desk ✓'s place, before the log, in the same group.
    expect(yellow).toContain('data-row-actions="shipment"');
    expect(yellow.indexOf(RECEIVE_LABEL)).toBeLessThan(
      yellow.indexOf('data-shipment-log="s-yellow"'),
    );
    // A green row keeps the ✓'s square, empty, so the log stands where it stands on every row.
    const green = rowOf(html, 'received');
    expect(green).toContain('data-shipment-log="s-green"');
    expect(green).toMatch(
      /<span aria-hidden="true" class="[^"]*invisible[^"]*"><\/span><button[^>]*data-shipment-log="s-green"/,
    );
  });

  it('shows the receipt photo’s eye, never its replace or delete', () => {
    const out = rowOf(html, 'received', 1);
    expect(out).toContain('data-shipment-receipt-view="s-out"');
    expect(out).not.toContain('data-shipment-receipt-replace');
    expect(out).not.toContain('data-shipment-receipt-delete');
    expect(html).not.toContain('data-shipment-receipt-upload');
  });
});

describe('«الكل» — the shipments nobody has collected yet, too — to be SEEN', () => {
  const html = render({
    path: '/operations/vault/receive?all=1',
    seed: (qc) =>
      qc.setQueryData(__vaultQueueKey(true), queue(true, [WITH_CAPTAIN, RECEIVED, AWAITING])),
  });

  it('is pressed, and lists the white rows with their colour in the legend', () => {
    expect(html).toContain('data-vault-all-toggle="true" aria-pressed="true"');
    expect(html).toContain('data-vault-legend="awaiting"');
    expect(html).toContain(ar('operations.vault.queue.awaiting'));
  });

  // Round 10 — «وهتكون ظاهره ل شاشة استلام الخزينة بس مش هيقدر يعمل صح الا لما القائد او العمليات
  // تبقى عامله صح»: the white row is listed, with no ✓ — and the line under its badge says why.
  it('leaves the uncollected row white, with NO vault ✓ — for viewing, and says so', () => {
    const white = rowOf(html, 'awaiting');
    expect(white).not.toContain('!bg-amber-50');
    expect(white).not.toContain('!bg-emerald-50');
    expect(white).not.toContain(RECEIVE_LABEL);
    expect(white).not.toContain('data-vault-receive=');
    expect(white).toContain('data-secured-stage="awaitingPickup"');
    expect(white).toContain(ar('operations.vault.queue.viewOnly'));
    // The same reader still receives the yellow row beside it.
    expect(rowOf(html, 'pickedUp')).toContain(RECEIVE_LABEL);
  });

  it('tells the reader of the toggle that what it adds is for viewing only', () => {
    expect(ar('operations.vault.queue.allHint')).toContain('للعرض فقط');
    expect(html).toContain(`title="${ar('operations.vault.queue.allHint')}"`);
  });
});

// Round 10 — «لو العمليات تم الاستلام من العمليات وهتبقى صفر بس»: the desk's ✓ on the secured
// screen makes a row the vault's work exactly as the captain's does.
describe('the desk’s pickup ✓ — yellow and receivable, as the captain’s', () => {
  const html = render({
    seed: (qc) =>
      qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN, WITH_OPERATIONS])),
  });

  it('paints it yellow, offers the vault’s ✓, and says the desk collected it — and when', () => {
    const desk = rowOf(html, 'pickedUp', 1);
    expect(desk).toContain('data-secured-stage="withOperations"');
    expect(desk).toContain('!bg-amber-50');
    expect(desk).toContain('data-vault-receive="s-desk"');
    expect(desk).toContain(ar('operations.vault.queue.operationsPickedUpAt', { at: '' }).trim());
    expect(desk).not.toContain(ar('operations.vault.queue.pickedUpAt', { at: '' }).trim());
    // The captain's row still says it was his.
    expect(rowOf(html, 'pickedUp')).toContain(
      ar('operations.vault.queue.pickedUpAt', { at: '' }).trim(),
    );
  });

  // One yellow chip for both — «مع القائد أو العمليات» — counting both rows.
  it('counts both yellows under ONE chip', () => {
    expect(html.match(/data-vault-legend="/g)).toHaveLength(2);
    const chip = html.slice(html.indexOf('data-vault-legend="pickedUp"'));
    expect(chip.slice(0, chip.indexOf('</span></span>'))).toMatch(
      new RegExp(`>${formatNumber(2, 'ar')}$`),
    );
    expect(ar('operations.vault.queue.pickedUp')).toBe('مع القائد أو العمليات');
  });
});

// Round 10 — «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: a special grant, on a green row in the vault.
describe('«إلغاء استلام الخزينة» — on a green row still in the vault, for its grant alone', () => {
  const CANCEL = `aria-label="${ar('operations.secured.cancelReceipt.action')}"`;
  const rows = [WITH_CAPTAIN, RECEIVED, RECEIVED_THEN_OUT];

  it('is offered on the row in the vault — not on one gone out, nor on a yellow one', () => {
    const html = render({
      permissions: [
        'operationsVault.view',
        'operationsVault.receive',
        'operationsVault.cancelReceipt',
      ],
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, rows)),
    });
    const green = rowOf(html, 'received');
    expect(green).toContain('data-cancel-receipt-open="s-green"');
    expect(green).toContain(CANCEL);
    expect(green).toContain('aria-haspopup="dialog"');
    expect(rowOf(html, 'received', 1)).not.toContain('data-cancel-receipt-open');
    expect(rowOf(html, 'pickedUp')).not.toContain('data-cancel-receipt-open');
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

describe('the legend counts the rows SHOWN, as the figures do', () => {
  it('follows the filters — a stage chosen leaves the other colour at nought', () => {
    const html = render({
      path: '/operations/vault/receive?stage=withCaptain',
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN, RECEIVED])),
    });
    expect(html).toContain('data-vault-row="pickedUp"');
    expect(html).not.toContain('data-vault-row="received"');
    const chip = (state: string): string => {
      const at = html.slice(html.indexOf(`data-vault-legend="${state}"`));
      return at.slice(0, at.indexOf('</span></span>'));
    };
    expect(chip('pickedUp')).toMatch(new RegExp(`>${formatNumber(1, 'ar')}$`));
    expect(chip('received')).toMatch(new RegExp(`>${formatNumber(0, 'ar')}$`));
  });

  it('reads a stage the box does not offer as no stage — «لم يتم التسليم» needs «الكل»', () => {
    const html = render({
      path: '/operations/vault/receive?stage=awaitingPickup',
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN, RECEIVED])),
    });
    expect(html).toContain('data-vault-row="pickedUp"');
    expect(html).toContain('data-vault-row="received"');
  });
});

describe('who may receive, and who may read what', () => {
  it('shows the rows and their colours, but no ✓, to a reader without the grant', () => {
    const html = render({
      permissions: ['operationsVault.view'],
      seed: (qc) => qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN])),
    });
    expect(rowOf(html, 'pickedUp')).toContain('!bg-amber-50');
    expect(html).not.toContain(RECEIVE_LABEL);
    // Nothing to do on a row, and no log to read: no column of empty boxes.
    expect(html).not.toContain('data-row-actions="shipment"');
    expect(html).not.toContain(`>${ar('operations.board.actions')}<`);
  });

  // A treasurer holding the vault's grants alone: the screen offers nothing the server would
  // refuse him — no «السجل» (the shipment grant's), no eye on the receipt photo (its bytes are the
  // shipment grant's too) — and still names the bank and the currencies (their lists answer the
  // vault grant).
  it('offers a vault-only treasurer the ✓, never «السجل» or the receipt’s eye — and names everything', () => {
    const html = render({
      seed: (qc) =>
        qc.setQueryData(__vaultQueueKey(false), queue(false, [WITH_CAPTAIN, RECEIVED_THEN_OUT])),
    });
    expect(rowOf(html, 'pickedUp')).toContain(RECEIVE_LABEL);
    expect(html).not.toContain('data-shipment-log=');
    expect(html).not.toContain('data-shipment-receipt-view');
    // A green row has nothing left for him to do: a dash in the actions' place, not an empty box.
    expect(rowOf(html, 'received')).not.toContain('data-row-actions="shipment"');
    expect(rowOf(html, 'pickedUp')).toContain('بنك الأهلي');
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
  const dialog = (permissions: string[]): string => {
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
          <ReceiveIntoVaultDialog shipment={WITH_CAPTAIN} onClose={() => undefined} />
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
});

describe('what the page hands the board — the lines a refactor could quietly undo', () => {
  it('is drawn by the shared board, not a table of its own', () => {
    expect(PAGE).toContain('<ShipmentsBoard');
    expect(PAGE).not.toContain('<DataTable');
    expect(PAGE).not.toContain('<PageHeader');
  });

  it('offers no «إضافة», no desk ✓, no edit or delete — the treasury receives here', () => {
    expect(PAGE).toContain('canCreate={false}');
    expect(PAGE).toContain('canToggleReceived={false}');
    expect(PAGE).toContain('canEditRows={false}');
  });

  it('is the secured board, with the stages its list can hold and its own colours', () => {
    expect(PAGE).toContain('kind="secured"');
    expect(PAGE).toContain('stages={vaultQueueStages(all)}');
    expect(PAGE).toContain('tintOf={vaultRowTint}');
  });

  it('offers the vault’s ✓ only to whoever may receive, and only on a row still outside the vault', () => {
    expect(PAGE).toContain("const canReceive = can('operationsVault.receive');");
    // `mayReceive` — a yellow row: outside the vault, and somebody collected it (Round 10).
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
    expect(html).not.toContain('data-vault-row=');
    expect(html).not.toContain('data-vault-legend=');
    expect(html).not.toContain('data-shipment-figures');
  });

  // A choice of view, not part of the answer, so it stays. It does not lift the refusal: the
  // server's cap counts every open محصنة whether «الكل» is on or off.
  it('still offers «الكل» beside a refusal — the screen’s view, not part of the answer', () => {
    const html = render({ seed: (qc) => refused(qc) });
    expect(html).toContain('data-vault-all-toggle="true"');
  });
});
