// «الشحنات المحصنة» in Round 10, rendered against the real Arabic catalog, a real store and query
// client — what reaches the screen; the rules themselves are pinned in lib/secured-stage.spec.ts.
//
//   · «فى شاشة المحصنات ممكن القائد اللى يعمل صح انه استلم او العمليات ف لو قائد تم الاستلام من القائد
//     و لو العمليات تم الاستلام من العمليات وهتبقى صفر»: the desk's pickup ✓ on a white row, pressed
//     on a yellow one — the captain's or the desk's — to take it back («لو القائد عمل صح ممكن العمليات
//     تشيلها»), and on no row the vault has received;
//   · «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد … يعدل عليها»: a green or blue row offers no
//     edit, no delete and no receipt-photo change — a lock says why, the photo's eye stays;
//   · «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: «إلغاء استلام الخزينة» on a row in the vault, for
//     whoever holds that grant, and its dialog;
//   · and the board a page like «صرف الخزينة» builds on: one date, its own acts and toolbar, ticks.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_RECEIPT_CANCEL_REASON_MAX,
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsSecuredBoardDto,
  type OperationsSecuredPickedUpBy,
  type OperationsSecuredStage,
  type OperationsShipmentStatus,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { listKey } from '../../../shared/lib/query-keys';
import { formatNumber } from '../../../shared/lib/format';
import { __securedBoardKey } from '../api/operations-queries';
import { CancelVaultReceiptDialog, noPickup } from '../components/CancelVaultReceiptDialog';
import { ShipmentsBoard } from '../components/ShipmentsBoard';
import { SecuredBacklogPage } from './SecuredBacklogPage';

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

const CURRENCIES: OperationsCurrencyDto[] = [
  {
    id: 'egp',
    code: '1',
    name: 'مصري',
    legacyAliases: [],
    sortOrder: 0,
    isActive: true,
    version: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const PHOTO = {
  fileId: 'f-1',
  fileName: 'receipt.jpg',
  mime: 'image/jpeg',
  size: 1,
  uploadedAt: '2026-11-11T08:00:00.000Z',
};

const secured = (
  id: string,
  status: OperationsShipmentStatus,
  securedStage: OperationsSecuredStage,
  pickedUpBy: OperationsSecuredPickedUpBy | null,
  over: Partial<OperationsDayBoardShipmentDto> = {},
): OperationsDayBoardShipmentDto => ({
  id,
  shipmentType: 'secured',
  status,
  mainBankId: 'b-ahly',
  secondaryBankId: null,
  originBranchId: 'o',
  destinationBranchId: 'd',
  areaName: 'الجيزة',
  lines: [{ currencyId: 'egp', amount: 2_500_000 }],
  collectionDate: '2026-11-11T00:00:00.000Z',
  deliveryDate: '2026-11-12T00:00:00.000Z',
  receiptNumber: status === 'draft' ? null : 'R-2026-1111',
  vaultReceiptNumber: null,
  receiptImage: PHOTO,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 4,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-11T08:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-ahly', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع الدقي', code: 'D1', bankId: 'b-ahly', bankName: 'الأهلي' },
  crew: null,
  captainDeliveredAt: null,
  securedStage,
  pickedUpBy,
  pickedUpAt: pickedUpBy === null ? null : '2026-11-11T07:30:00.000Z',
  ...over,
});

const WHITE = secured('s-white', 'draft', 'awaitingPickup', null, { receiptImage: null });
const CAPTAIN = secured('s-captain', 'draft', 'withCaptain', 'captain');
const DESK = secured('s-desk', 'draft', 'withOperations', 'operations');
const GREEN = secured('s-green', 'inVault', 'inVault', 'operations');
const BLUE = secured('s-blue', 'dispatched', 'dispatched', 'captain');
const ROWS = [WHITE, CAPTAIN, DESK, GREEN, BLUE];

/** The desk: reads, books, edits, deletes, and holds the desk's ✓. */
const DESK_GRANTS = [
  'operationsShipment.view',
  'operationsShipment.create',
  'operationsShipment.edit',
  'operationsShipment.delete',
  'operationsShipment.complete',
];
const CANCEL_GRANT = 'operationsVault.cancelReceipt';

const storeFor = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
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

const render = (permissions: string[], rows = ROWS): string => {
  const qc = clientWithCatalogs();
  const board: OperationsSecuredBoardDto = { shipments: rows, crews: [] };
  qc.setQueryData(__securedBoardKey(), board);
  return renderToStaticMarkup(
    <Provider store={storeFor(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/secured']}>
          <Routes>
            <Route path="/operations/secured" element={<SecuredBacklogPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The `<tr>` of a row, found by its «السجل» button. */
const rowOf = (html: string, id: string): string => {
  const at = html.indexOf(`data-shipment-log="${id}"`);
  expect(at, `the row ${id}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};

/** The pickup ✓'s own tag on a row. */
const pickupOf = (row: string): string => {
  const at = row.indexOf('data-secured-pickup=');
  expect(at, 'the pickup ✓').toBeGreaterThan(-1);
  return row.slice(row.lastIndexOf('<button', at), row.indexOf('>', at));
};

const EDIT = `aria-label="${ar('common.edit')}"`;
const REMOVE = `aria-label="${ar('common.remove')}"`;
const CANCEL = `aria-label="${ar('operations.secured.cancelReceipt.action')}"`;

describe('«ممكن القائد اللى يعمل صح انه استلم او العمليات» — the desk’s pickup ✓', () => {
  const html = render(DESK_GRANTS);

  it('is offered on a white row, not pressed — a click confirms it as Operations', () => {
    const tick = pickupOf(rowOf(html, 's-white'));
    expect(tick).toContain('aria-pressed="false"');
    expect(tick).toContain(`aria-label="${ar('operations.secured.pickup.toggle')}"`);
    expect(tick).toContain(`title="${ar('operations.secured.pickup.confirm')}"`);
    expect(tick).toContain('data-picked-up-by="none"');
  });

  // «لو القائد عمل صح ممكن العمليات تشيلها»: pressed on the captain's yellow too — the desk may take
  // his ✓ back, and the tooltip says whose it is.
  it('is pressed on the captain’s yellow row — a click takes HIS ✓ back', () => {
    const row = rowOf(html, 's-captain');
    expect(row).toContain('!bg-amber-50');
    expect(row).toContain('data-secured-stage="withCaptain"');
    const tick = pickupOf(row);
    expect(tick).toContain('aria-pressed="true"');
    expect(tick).toContain('data-picked-up-by="captain"');
    expect(tick).toContain(`title="${ar('operations.secured.pickup.undoCaptain')}"`);
  });

  it('is pressed on the desk’s own yellow row — «تم الاستلام من العمليات» — to undo it', () => {
    const row = rowOf(html, 's-desk');
    expect(row).toContain('!bg-amber-50');
    expect(row).toContain('data-secured-stage="withOperations"');
    expect(row).toContain(ar('operations.board.stage.withOperations'));
    const tick = pickupOf(row);
    expect(tick).toContain('aria-pressed="true"');
    expect(tick).toContain(`title="${ar('operations.secured.pickup.undo')}"`);
  });

  it('is offered on no row the vault has received — it can be undone only until then', () => {
    expect(rowOf(html, 's-green')).not.toContain('data-secured-pickup=');
    expect(rowOf(html, 's-blue')).not.toContain('data-secured-pickup=');
  });

  it('stands at the ✓’s place — before «السجل», in the same box', () => {
    const row = rowOf(html, 's-white');
    expect(row.indexOf('data-secured-pickup=')).toBeLessThan(row.indexOf('data-shipment-log='));
    // A green row keeps the square, empty, so «السجل» stands where it does on the yellow rows.
    expect(rowOf(html, 's-green')).toMatch(
      /<span aria-hidden="true" class="[^"]*invisible[^"]*"><\/span><button[^>]*data-shipment-log="s-green"/,
    );
  });

  it('is offered to nobody without the desk’s ✓ grant', () => {
    const reader = render(DESK_GRANTS.filter((key) => key !== 'operationsShipment.complete'));
    expect(reader).not.toContain('data-secured-pickup=');
  });

  it('offers the status filter both yellows, apart', () => {
    expect(html).toContain(ar('operations.board.stage.withCaptain'));
    expect(html).toContain(ar('operations.board.stage.withOperations'));
  });
});

describe('«ميقدر حد … يعدل عليها» — a row the vault has received is locked', () => {
  const html = render(DESK_GRANTS);

  it('offers edit and delete on the rows before the vault', () => {
    for (const id of ['s-white', 's-captain', 's-desk']) {
      expect(rowOf(html, id)).toContain(EDIT);
      expect(rowOf(html, id)).toContain(REMOVE);
    }
  });

  it('offers neither on a green or a blue row — a lock in the pen’s place says why', () => {
    for (const id of ['s-green', 's-blue']) {
      const row = rowOf(html, id);
      expect(row, id).not.toContain(EDIT);
      expect(row, id).not.toContain(REMOVE);
      expect(row, id).toContain(`data-row-locked="${id}"`);
      expect(row, id).toContain(`title="${ar('operations.board.locked')}"`);
      // The reason is read out, not only shown on hover.
      expect(row, id).toContain(`<span class="sr-only">${ar('operations.board.locked')}</span>`);
    }
  });

  it('shows the receipt photo’s eye on a locked row — never its replace or delete', () => {
    const green = rowOf(html, 's-green');
    expect(green).toContain('data-shipment-receipt-view="s-green"');
    expect(green).not.toContain('data-shipment-receipt-replace');
    expect(green).not.toContain('data-shipment-receipt-delete');
    // Before the vault, the photo is managed as before.
    expect(rowOf(html, 's-desk')).toContain('data-shipment-receipt-replace="s-desk"');
    expect(rowOf(html, 's-white')).toContain('data-shipment-receipt-upload="s-white"');
  });
});

describe('«بس صلاحية خاصة تقدر تلغى استلام الخزينة» — on a green row, for its grant alone', () => {
  it('is offered on the row in the vault, at the ✓’s place, to whoever holds the grant', () => {
    const html = render([...DESK_GRANTS, CANCEL_GRANT]);
    const green = rowOf(html, 's-green');
    expect(green).toContain('data-cancel-receipt-open="s-green"');
    expect(green).toContain(CANCEL);
    expect(green.indexOf('data-cancel-receipt-open=')).toBeLessThan(
      green.indexOf('data-shipment-log='),
    );
    // Not once it has left the vault, and not before the vault.
    expect(rowOf(html, 's-blue')).not.toContain('data-cancel-receipt-open');
    expect(rowOf(html, 's-desk')).not.toContain('data-cancel-receipt-open');
  });

  it('is offered to nobody without it — the desk’s grants are not enough', () => {
    expect(render(DESK_GRANTS)).not.toContain('data-cancel-receipt-open');
  });
});

describe('«إلغاء استلام الخزينة» — the dialog', () => {
  const dialog = (row: OperationsDayBoardShipmentDto = GREEN): string =>
    renderToStaticMarkup(
      <Provider store={storeFor([...DESK_GRANTS, CANCEL_GRANT])}>
        <QueryClientProvider client={new QueryClient()}>
          <CancelVaultReceiptDialog
            target={{ row, caption: 'بنك الأهلي · فرع المهندسين ← فرع الدقي · 2026-11-12' }}
            onClose={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );

  it('says what the act does before it is done — and names the shipment and its receipt', () => {
    const html = dialog();
    expect(html).toContain('data-cancel-receipt="s-green"');
    expect(html).toContain(ar('operations.secured.cancelReceipt.action'));
    expect(html).toContain('بنك الأهلي · فرع المهندسين ← فرع الدقي · 2026-11-12');
    expect(html).toContain(ar('operations.secured.cancelReceipt.body'));
    expect(html).toContain('data-cancel-receipt-returns="yellow"');
    expect(html).toContain('data-cancel-receipt-number="R-2026-1111"');
  });

  // Round 13 — «والخزنه تستلم عادي»: a receipt nobody handed over goes back WHITE when cancelled
  // (the server restores the pickup record as it stood — nobody — and invents none). Promising
  // «تعود صفراء» there would tell the treasurer something the board will not show.
  it('says WHITE again, not yellow, when the vault had received it with nobody’s pickup ✓', () => {
    const direct = secured('s-direct', 'inVault', 'inVault', null);
    const html = dialog(direct);
    expect(html).toContain('data-cancel-receipt-returns="white"');
    expect(html).toContain(ar('operations.secured.cancelReceipt.bodyNoPickup'));
    expect(html).not.toContain(ar('operations.secured.cancelReceipt.body'));
    expect(ar('operations.secured.cancelReceipt.bodyNoPickup')).toContain('الأبيض');
    expect(ar('operations.secured.cancelReceipt.bodyNoPickup')).not.toContain('صفراء');
    expect(ar('operations.secured.cancelReceipt.doneNoPickup')).toContain('الأبيض');
    expect(ar('operations.secured.cancelReceipt.doneNoPickup')).not.toContain('صفراء');
    // Whoever had collected it — the desk (GREEN) or the captain — it goes back yellow.
    expect(dialog(secured('s-cap', 'inVault', 'inVault', 'captain'))).toContain(
      'data-cancel-receipt-returns="yellow"',
    );
    expect(noPickup(direct)).toBe(true);
    expect(noPickup(GREEN)).toBe(false);
  });

  it('requires the reason — the red button is off until it is written', () => {
    const html = dialog();
    expect(html).toContain('data-cancel-receipt-reason="true"');
    expect(html).toMatch(new RegExp(`maxlength="${OPERATIONS_RECEIPT_CANCEL_REASON_MAX}"`, 'i'));
    expect(html).toMatch(
      /<button type="button"[^>]*data-cancel-receipt-save="true"[^>]*disabled=""/,
    );
    expect(html).toContain(
      `${formatNumber(0, 'ar')} / ${formatNumber(OPERATIONS_RECEIPT_CANCEL_REASON_MAX, 'ar')}`,
    );
  });

  it('goes back with «رجوع», never a second «إلغاء» that reads as the act', () => {
    const html = dialog();
    expect(html).toContain(`>${ar('operations.secured.cancelReceipt.back')}</button>`);
    expect(ar('operations.secured.cancelReceipt.back')).toBe('رجوع');
  });

  it('renders nothing while closed', () => {
    const html = renderToStaticMarkup(
      <Provider store={storeFor(DESK_GRANTS)}>
        <QueryClientProvider client={new QueryClient()}>
          <CancelVaultReceiptDialog target={null} onClose={() => undefined} />
        </QueryClientProvider>
      </Provider>,
    );
    expect(html).toBe('');
  });
});

// «صرف الخزينة» is rebuilt on this board after Round 10's screens: a page hands it one delivery day,
// its own act on a row and in the toolbar, and its ticks for a release of several at once.
describe('the board a page like «صرف الخزينة» builds on', () => {
  const Host = ({ selected }: { selected: ReadonlySet<string> }): JSX.Element => {
    const search = useSearchParams();
    return (
      <ShipmentsBoard
        search={search}
        shipments={[GREEN, { ...GREEN, id: 's-other', crew: null }]}
        crews={[]}
        loaded
        loading={false}
        error={null}
        onRetry={() => undefined}
        datePickers={[
          {
            param: 'date',
            label: ar('operations.shipment.deliveryDate'),
            showLabel: true,
            value: '2026-11-12',
            onChange: () => undefined,
          },
        ]}
        periodActive
        periodParams={['date']}
        canCreate={false}
        canToggleReceived={false}
        canEditRows={false}
        kind="secured"
        empty="—"
        rowAction={(row) => <button type="button" data-host-act={row.id} />}
        toolbarExtras={(shown) => <span data-host-toolbar={shown.length} />}
        selection={{
          selected,
          onToggle: () => undefined,
          selectable: (row) => row.id !== 's-other',
          label: (row) => `تحديد ${row.id}`,
        }}
      />
    );
  };
  const html = renderToStaticMarkup(
    <Provider store={storeFor(['operationsShipment.view', 'operationsVault.view'])}>
      <QueryClientProvider client={clientWithCatalogs()}>
        <MemoryRouter initialEntries={['/operations/vault/dispatch?date=2026-11-12']}>
          <Host selected={new Set(['s-green'])} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

  it('takes ONE delivery-day picker, named, in the filter bar', () => {
    expect(html.match(/type="date"/g)).toHaveLength(1);
    expect(html).toContain('data-date-label="date"');
    expect(html).toContain('value="2026-11-12"');
  });

  it('draws a tick box first in each selectable row — ticked as the page holds it', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect(head).toContain(`>${ar('operations.board.select')}<`);
    expect(head.indexOf(ar('operations.board.select'))).toBeLessThan(
      head.indexOf(ar('operations.board.vehicle')),
    );
    expect(html).toMatch(/<input type="checkbox" data-board-select="s-green"[^>]*checked=""/);
    expect(html).toContain('aria-label="تحديد s-green"');
    // A row the page says may not be ticked has no box.
    expect(html).not.toContain('data-board-select="s-other"');
  });

  it('hands the page its act on every row and its controls the rows shown', () => {
    expect(html).toContain('data-host-act="s-green"');
    expect(html).toContain('data-host-act="s-other"');
    expect(html).toContain('data-host-toolbar="2"');
  });

  it('still locks a row in the vault — the page’s act is not an edit', () => {
    expect(html).not.toContain(EDIT);
    expect(html).not.toContain('data-shipment-receipt-replace');
  });
});
