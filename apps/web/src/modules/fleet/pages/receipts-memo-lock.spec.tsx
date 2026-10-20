// A receipt the custody fund paid, once it is a line of a custody memo («المذكرات»), proven on the
// receipts screen: the row names its memo under «العهدة», its bin is locked with the reason, and the
// form opens on a note naming the memo with what the memo holds locked — the kind and what paid
// for it while the memo waits for its «استعاضة», the amount, date and car too once it is
// replenished. A save or a delete the server still refuses says which rule refused it and reads
// the receipt again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetReceiptDto,
  type FleetReceiptTotalsDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { ReceiptsPage } from './ReceiptsPage';
import { ReceiptDialog } from '../components/ReceiptDialog';
import { actionTone } from '../components/row-actions-look';
import { memoDay, receiptMemoLocks, receiptMemoState } from '../lib/receipt-memo-lock';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
/** A source, comments stripped — they explain the rule and must not be able to satisfy it. */
const code = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
/** As the markup writes an attribute's value. */
const attr = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');

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

/** A tyres receipt the fund paid, in no memo unless a test says otherwise. */
const receipt = (over: Partial<FleetReceiptDto> = {}): FleetReceiptDto => ({
  id: 'r-1',
  date: '2026-09-14T00:00:00.000Z',
  vehicleId: 'v-204',
  vehicleCode: '204',
  driverEmployeeId: null,
  driverName: 'أيمن حسن مصطفى',
  kind: 'tyres',
  source: 'custody',
  cardId: null,
  cardCompany: null,
  cardNumber: null,
  cardVehicleId: null,
  cardVehicleCode: null,
  cardLabel: null,
  fuelType: null,
  pricePerLitre: null,
  litres: null,
  amount: 1400,
  odometer: null,
  company: null,
  image: null,
  memo: null,
  version: 0,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...over,
});
const PENDING = { id: 'm-7', no: 7, replenishedAt: null };
const REPLENISHED = { id: 'm-7', no: 7, replenishedAt: '2026-09-29' };

const TOTALS: FleetReceiptTotalsDto = {
  count: 3,
  custodyTotal: 4200,
  cardTotal: 0,
  fuelTotal: 0,
  fuelLitres: 0,
  tyresTotal: 4200,
  washTotal: 0,
  maintenanceTotal: 0,
};
const FILTERS = {
  from: undefined,
  to: undefined,
  vehicleCodes: undefined,
  kind: undefined,
  source: undefined,
  driver: undefined,
};
const RECEIPT_GRANTS = [
  'fleetReceipt.view',
  'fleetReceipt.create',
  'fleetReceipt.edit',
  'fleetReceipt.delete',
];

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
const mount = (qc: QueryClient, permissions: string[], page: JSX.Element): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/fleet/receipts']}>
          <Routes>
            <Route path="/fleet/receipts" element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const board = (rows: FleetReceiptDto[], permissions = RECEIPT_GRANTS): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'receipts', {
      ...FILTERS,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  qc.setQueryData(listKey('fleet', 'receipts', { summary: true, ...FILTERS }), TOTALS);
  return mount(qc, permissions, <ReceiptsPage />);
};
const form = (row: FleetReceiptDto): string =>
  mount(client(), RECEIPT_GRANTS, <ReceiptDialog open onClose={() => undefined} row={row} />);

/** The table row holding `marker`. */
const rowOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker, html.indexOf('<tbody'));
  expect(at, `a row holding ${marker}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
};
/** The opening tag `marker` sits on. */
const tagOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  expect(at, `${marker} is on screen`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('what a custody memo holds of its receipt', () => {
  it('reads a receipt in no memo — an older row with no field at all too — as free', () => {
    expect(receiptMemoState(receipt())).toBe('none');
    expect(receiptMemoState(null)).toBe('none');
    const older = { ...receipt() } as Partial<FleetReceiptDto>;
    delete older.memo;
    expect(receiptMemoState(older as FleetReceiptDto)).toBe('none');
    expect(Object.values(receiptMemoLocks(older as FleetReceiptDto)).every((v) => !v)).toBe(true);
  });

  it('holds the kind, what paid and the bin while the memo waits — the money facts move freely', () => {
    expect(receiptMemoState(receipt({ memo: PENDING }))).toBe('pending');
    expect(receiptMemoLocks(receipt({ memo: PENDING }))).toEqual({
      kind: true,
      source: true,
      remove: true,
      amount: false,
      date: false,
      vehicle: false,
    });
  });

  it('holds the amount, the date and the car too once the memo is replenished', () => {
    expect(receiptMemoState(receipt({ memo: REPLENISHED }))).toBe('replenished');
    expect(receiptMemoLocks(receipt({ memo: REPLENISHED }))).toEqual({
      kind: true,
      source: true,
      remove: true,
      amount: true,
      date: true,
      vehicle: true,
    });
    expect(memoDay('2026-09-29')).toBe('2026/09/29');
    expect(memoDay('2026-09-29T00:00:00.000Z')).toBe('2026/09/29');
  });
});

describe('the receipts table names the memo and locks the bin', () => {
  const rows = [
    receipt({ id: 'free', amount: 101 }),
    receipt({ id: 'waits', amount: 102, memo: PENDING }),
    receipt({ id: 'done', amount: 103, memo: { ...REPLENISHED, id: 'm-8', no: 8 } }),
  ];

  it('writes «مذكرة رقم N» under «العهدة» — amber while it waits, emerald once replenished', () => {
    const html = board(rows);
    const free = rowOf(html, '101.00');
    expect(free).not.toContain('data-receipt-memo=');
    expect(free).toContain(ar('fleet.receipts.source.custody'));
    const waits = rowOf(html, '102.00');
    const pending = tagOf(waits, 'data-receipt-memo="7"');
    expect(pending).toContain('data-receipt-memo-state="pending"');
    expect(pending).toContain('border-amber-300');
    expect(pending).toContain(`title="${attr(ar('fleet.receipts.memo.pendingTitle', { no: 7 }))}"`);
    expect(waits).toContain(ar('fleet.receipts.memo.chip', { no: 7 }));
    // Under «العهدة», in the same cell.
    expect(waits.indexOf(ar('fleet.receipts.source.custody'))).toBeLessThan(
      waits.indexOf('data-receipt-memo="7"'),
    );
    const done = tagOf(rowOf(html, '103.00'), 'data-receipt-memo="8"');
    expect(done).toContain('data-receipt-memo-state="replenished"');
    expect(done).toContain('border-emerald-300');
    expect(done).toContain(
      `title="${attr(ar('fleet.receipts.memo.replenishedTitle', { no: 8, date: '2026/09/29' }))}"`,
    );
  });

  it('opens the memo from its chip only for whoever may open the memo page', () => {
    const editor = board(rows, [...RECEIPT_GRANTS, 'fleetCustody.view']);
    expect(tagOf(rowOf(editor, '102.00'), 'data-receipt-memo="7"')).toMatch(
      /^<a [^>]*href="\/fleet\/custody\/memos\/m-7"/u,
    );
    // Without «العهدة», or without the receipts' edit grant the memo page asks for: a plain chip.
    for (const grants of [RECEIPT_GRANTS, ['fleetReceipt.view', 'fleetCustody.view']]) {
      expect(tagOf(rowOf(board(rows, grants), '102.00'), 'data-receipt-memo="7"')).toMatch(
        /^<span /u,
      );
    }
  });

  it('keeps the pen, and fades the bin of a receipt on a memo — saying why, in the owner’s box', () => {
    const html = board(rows);
    expect(rowOf(html, '101.00')).toContain('data-receipt-delete="free"');
    for (const [amount, id, reason] of [
      ['102.00', 'waits', ar('fleet.receipts.memo.lockedDelete', { no: 7 })],
      ['103.00', 'done', ar('fleet.receipts.memo.lockedDeleteReplenished', { no: 8 })],
    ] as const) {
      const row = rowOf(html, amount);
      expect(row, id).toContain(`data-receipt-edit="${id}"`);
      expect(row, id).not.toContain(`data-receipt-delete="${id}"`);
      expect(row, id).toContain(
        `<span title="${attr(reason)}" data-locked-action="receipt-delete" class="inline-flex"><button type="button" disabled="" aria-label="${attr(reason)}" class="${attr(actionTone('delete'))}">`,
      );
    }
  });

  it('shows no bin at all without the delete grant, locked or not', () => {
    const html = board(rows, ['fleetReceipt.view', 'fleetReceipt.edit']);
    expect(html).not.toContain('data-locked-action=');
    expect(html).not.toContain('data-receipt-delete=');
  });

  it('keeps the table’s ten columns — the memo lives in «الخصم من», not a column of its own', () => {
    const row = rowOf(board(rows), '102.00');
    expect(row.match(/<td[^>]*>/gu)?.length).toBe(10);
  });
});

describe('the receipt form on a memo', () => {
  it('opens a free receipt as before: no note, nothing locked', () => {
    const html = form(receipt());
    expect(html).not.toContain('data-receipt-memo-lock');
    expect(html).not.toContain('<fieldset disabled');
    expect(tagOf(html, 'data-receipt-date="true"')).not.toMatch(/\sdisabled=""/u);
    expect(tagOf(html, 'data-receipt-amount="true"')).not.toMatch(/\sdisabled=""/u);
  });

  it('on a memo that waits: names it, and locks the kind and what paid — never the money facts', () => {
    const html = form(receipt({ memo: PENDING }));
    expect(html).toContain('data-receipt-memo-lock="pending"');
    expect(html).toContain(ar('fleet.receipts.memo.pendingNotice', { no: 7 }));
    const reason = attr(ar('fleet.receipts.memo.lockedPending', { no: 7 }));
    expect(tagOf(html, 'data-receipt-kind-locked="true"')).toContain(
      `<fieldset disabled="" title="${reason}"`,
    );
    expect(tagOf(html, 'data-receipt-source-locked="true"')).toContain(
      `<fieldset disabled="" title="${reason}"`,
    );
    // The picked kind stays lit; the others fade and take no pointer, so the reason shows on hover.
    expect(tagOf(html, 'data-receipt-kind-locked="true"')).toContain(
      '[&amp;_[aria-checked=false]]:opacity-40',
    );
    expect(html).toMatch(/aria-checked="true" data-receipt-kind="tyres"/u);
    expect(html).not.toContain('data-receipt-vehicle-locked');
    expect(tagOf(html, 'data-receipt-date="true"')).not.toMatch(/\sdisabled=""/u);
    expect(tagOf(html, 'data-receipt-amount="true"')).not.toMatch(/\sdisabled=""/u);
    // The note sits before the form it explains.
    expect(html.indexOf('data-receipt-memo-lock')).toBeLessThan(html.indexOf('data-receipt-kind='));
  });

  it('on a replenished memo: locks the amount, the date and the car too — the driver stays', () => {
    const html = form(receipt({ memo: REPLENISHED }));
    expect(html).toContain('data-receipt-memo-lock="replenished"');
    expect(html).toContain(
      ar('fleet.receipts.memo.replenishedNotice', { no: 7, date: '2026/09/29' }),
    );
    const reason = attr(ar('fleet.receipts.memo.lockedReplenished', { no: 7 }));
    for (const marker of [
      'data-receipt-kind-locked="true"',
      'data-receipt-source-locked="true"',
      'data-receipt-vehicle-locked="true"',
    ]) {
      expect(tagOf(html, marker), marker).toContain(`<fieldset disabled="" title="${reason}"`);
    }
    for (const marker of ['data-receipt-date="true"', 'data-receipt-amount="true"']) {
      const box = tagOf(html, marker);
      expect(box, marker).toContain('disabled=""');
      expect(box, marker).toContain(`title="${reason}"`);
    }
    // The date's calendar cannot open a box that cannot change.
    const field = html.slice(
      html.lastIndexOf('<div class="space-y-2"', html.indexOf('data-receipt-date="true"')),
    );
    expect(field.slice(0, field.indexOf('</div></div>'))).toMatch(
      /<button[^>]*data-date-picker-button="true"[^>]*disabled=""|<button[^>]*disabled=""[^>]*data-date-picker-button="true"/u,
    );
    expect(tagOf(html, 'data-receipt-driver="true"')).not.toMatch(/\sdisabled=""/u);
  });
});

describe('a refused save or delete says which rule refused it and reads the receipt again', () => {
  const FORM = code('../components/ReceiptDialog.tsx');
  const PAGE = code('ReceiptsPage.tsx');

  it('the form names a lock (422) or a newer copy (409), stays open and asks for a fresh read', () => {
    const submit = FORM.slice(FORM.indexOf('const submit = async'));
    const body = submit.slice(0, submit.indexOf('\n  };'));
    expect(body).toContain('writeRefusalOf(failure)');
    expect(body).toContain("'fleet.receipts.memo.refusedEdit'");
    expect(body).toContain("'fleet.receipts.memo.refusedStale'");
    expect(body).toContain('onRefused?.();');
    // Anything else keeps the usual message, and a new receipt has no memo to be refused by.
    expect(body).toContain('if (refusal === null) throw failure;');
    expect(body).toContain('const refusal = row === null ? null : writeRefusalOf(failure);');
    // The refusal closes nothing: the fresh row comes back into the open form.
    const handler = body.slice(body.indexOf('catch (failure)'));
    expect(handler).not.toContain('onClose()');
  });

  it('the page reads the receipt again for the open form, and the list again after a refused delete', () => {
    expect(PAGE).toContain('onRefused={() => void reloadEditing()}');
    const reload = PAGE.slice(PAGE.indexOf('const reloadEditing = async'));
    const reloadBody = reload.slice(0, reload.indexOf('\n  };'));
    expect(reloadBody).toContain('const fresh = await refetch();');
    expect(reloadBody).toContain(
      'setEditing(fresh.data?.items.find((row) => row.id === id) ?? null);',
    );
    const confirm = PAGE.slice(PAGE.indexOf('const confirmDelete = async'));
    const confirmBody = confirm.slice(0, confirm.indexOf('\n  };'));
    expect(confirmBody).toContain("if (writeRefusalOf(failure) !== 'locked') throw failure;");
    expect(confirmBody).toContain("toast.error(t('fleet.receipts.memo.refusedDelete'));");
    expect(confirmBody).toContain('void refetch();');
  });
});
