// «سجل الخزينة» (Round 12, `/operations/vault` — was «جرد الخزينة»), rendered against the real Arabic
// catalog, a real store and query client: «شاشة جرد الخزينة تكون سجل الخزينه المحصنات زى شاشة سجل
// الشحنات بالظبط واعمل فوق تقرير الخزينة يكون نفس الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه
// بس مفيش فتر من الى هيكون لحظى على ف الخزينة».
//
//   · on top, «تقرير الخزينة»: the vault's contents NOW, per bank — the very table of «بيان الشحنات لكل
//     بنك» (its columns, the reference order, «الإجمالي» the server's), with no dates, and beside it
//     the panel over the same total;
//   · under it, «سجل الشحنات» for the محصنات alone: the history read with `type=secured`, on the
//     secured board's columns, its range opening on this month to date, its deleted محصنات;
//   · a treasurer holding only the vault's grants gets the report and a line about the history.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SECURED_STAGES,
  type Locale,
  type MeDto,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
  type OperationsShipmentHistoryDto,
  type OperationsVaultHeldReportDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { featureKey, listKey } from '../../../shared/lib/query-keys';
import {
  __deletedShipmentsKey,
  __shipmentHistoryKey,
  __vaultHeldReportKey,
} from '../api/operations-queries';
import { boardFilterParams } from '../lib/day-board';
import { VaultInventoryPage } from './VaultInventoryPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('./VaultInventoryPage.tsx');

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

const T = '2026-01-01T00:00:00.000Z';
const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number,
): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  sortOrder,
  isActive: true,
  version: 0,
  createdAt: T,
  updatedAt: T,
});
const CURRENCIES = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
];
const bank = (id: string, code: number, opsName: string, sortOrder: number) => ({
  id,
  code,
  opsName,
  sortOrder,
  name: { ar: opsName, en: opsName },
});
const BANKS = [bank('bm', 2, 'مصر', 1), bank('ba', 1, 'الأهلي', 0)];

const line = (
  currencyId: string,
  currencyName: string,
  amount: number,
): OperationsReportCurrencyTotalDto => ({ currencyId, currencyName, amount });
const totals = (
  shipmentCount: number,
  [bagCount, cartonCount, boxCount]: [number, number, number],
  currencies: OperationsReportCurrencyTotalDto[],
): OperationsReportTotalsDto => ({ shipmentCount, bagCount, cartonCount, boxCount, currencies });

/** What the vault holds now — in the server's order (by name); its grand total its own. */
const HELD: OperationsVaultHeldReportDto = {
  asOf: '2026-11-12T12:09:00.000Z',
  rows: [
    {
      bankId: 'ba',
      bankName: 'الأهلي',
      totals: totals(
        5,
        [10, 0, 0],
        [line('egp', 'مصري', 16_975_000), line('eur', 'يورو', 112_000)],
      ),
    },
    {
      bankId: 'bm',
      bankName: 'مصر',
      totals: totals(
        5,
        [17, 1, 1],
        [line('egp', 'مصري', 16_362_500), line('usd', 'دولار', 423_500)],
      ),
    },
  ],
  grandTotal: totals(
    77,
    [111, 22, 33],
    [line('egp', 'مصري', 99_000_000), line('usd', 'دولار', 5_000)],
  ),
};

const row = (
  id: string,
  over: Partial<OperationsDayBoardShipmentDto> = {},
): OperationsDayBoardShipmentDto =>
  ({
    id,
    shipmentType: 'secured',
    status: 'inVault',
    mainBankId: 'ba',
    secondaryBankId: null,
    originBranchId: 'o',
    destinationBranchId: 'd',
    areaName: 'الجيزة',
    lines: [{ currencyId: 'egp', amount: 1_000_000 }],
    collectionDate: '2026-11-08T00:00:00.000Z',
    deliveryDate: '2026-11-09T00:00:00.000Z',
    receiptNumber: 'R-1',
    vaultReceiptNumber: null,
    receiptImage: null,
    serialTracked: false,
    notes: null,
    receivedById: null,
    receivedAt: null,
    version: 3,
    createdAt: '2026-11-08T08:00:00.000Z',
    updatedAt: '2026-11-09T08:00:00.000Z',
    origin: { id: 'o', name: 'المهندسين', code: 'O1', bankId: 'ba', bankName: 'الأهلي' },
    destination: { id: 'd', name: 'الدقي', code: 'D1', bankId: 'ba', bankName: 'الأهلي' },
    crew: null,
    captainDeliveredAt: null,
    securedStage: 'inVault',
    pickedUpBy: 'captain',
    pickedUpAt: '2026-11-08T07:30:00.000Z',
    ...over,
  }) as OperationsDayBoardShipmentDto;

// A fixed "now": 12 November 2026, noon in Cairo — the history opens on 1–12 November.
const NOW = '2026-11-12T10:00:00.000Z';
const RANGE = { from: '2026-11-01', to: '2026-11-12' };
const HISTORY: OperationsShipmentHistoryDto = {
  from: `${RANGE.from}T00:00:00.000Z`,
  to: `${RANGE.to}T00:00:00.000Z`,
  shipments: [
    row('s-held'),
    row('s-done', { status: 'completed', securedStage: 'completed' }),
    row('s-draft', {
      status: 'draft',
      securedStage: 'awaitingPickup',
      pickedUpBy: null,
      pickedUpAt: null,
    }),
  ],
  crews: [],
};

const DESK = [
  'operationsVault.view',
  'operationsShipment.view',
  'operationsShipment.edit',
  'operationsShipment.delete',
  'operationsShipment.create',
  'operationsShipment.complete',
];

const page = <R,>(items: R[]) => ({
  items,
  meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: items.length, totalPages: 1 },
});

const render = ({
  permissions = DESK,
  path = '/operations/vault',
  seed,
}: {
  permissions?: string[];
  path?: string;
  seed: (qc: QueryClient) => void;
}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  qc.setQueryData(
    listKey('operations', 'banks', {
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    }),
    page(BANKS),
  );
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/vault" element={<VaultInventoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const seedAll = (qc: QueryClient): void => {
  qc.setQueryData(__vaultHeldReportKey(), HELD);
  qc.setQueryData(__shipmentHistoryKey(RANGE, 'secured'), HISTORY);
  qc.setQueryData(__deletedShipmentsKey(RANGE, 'secured'), {
    from: HISTORY.from,
    to: HISTORY.to,
    shipments: [],
  });
};

/** The «تقرير الخزينة» band — everything before the history's toolbar. */
const heldBand = (html: string): string =>
  html.slice(html.indexOf('data-vault-held="true"'), html.indexOf('data-shipments-toolbar'));
const cells = (tr: string): string[] =>
  [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    (m[1] ?? '')
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
const bodyRows = (section: string): string[] => {
  const body = section.slice(section.indexOf('<tbody'), section.indexOf('</tbody>'));
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
};
const heads = (section: string): string[] => {
  const head = section.slice(section.indexOf('<thead'), section.indexOf('</thead>'));
  return [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1] ?? '');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('«تقرير الخزينة» — on top, live, the very table of «بيان الشحنات لكل بنك»', () => {
  it('draws the bank table’s columns, titled for what it is, with when it was read', () => {
    const band = heldBand(render({ seed: seedAll }));
    expect(band).toContain(ar('operations.vaultHistory.held'));
    expect(heads(band)).toEqual([
      'م',
      'البنك',
      'عدد المحصنات',
      'المصري',
      'الدولار',
      'عملات أخرى',
      'الحقائب',
      'كرتونة',
      'صندوق',
    ]);
    // 12:09 UTC is 14:09 in Cairo.
    expect(band).toContain('data-vault-held-as-of="true"');
    expect(band).toContain(ar('operations.vaultHistory.heldAsOf', { at: '⁦2026-11-12 14:09⁩' }));
  });

  it('lists the banks in the reference order, «الإجمالي» the server’s own', () => {
    const rows = bodyRows(heldBand(render({ seed: seedAll }))).map(cells);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ['1', 'الأهلي', '5'],
      ['2', 'مصر', '5'],
      ['', 'الإجمالي', '77'],
    ]);
    expect(rows.at(-1)?.slice(3, 5)).toEqual(['99,000,000', '5,000']);
  });

  it('has NO dates — it is now («بس مفيش فتر من الى هيكون لحظى»)', () => {
    const band = heldBand(render({ seed: seedAll }));
    expect(band).not.toContain('type="date"');
    expect(PAGE).toContain('const held = useVaultHeldReport();');
  });

  it('keeps the panel beside it, over the same total', () => {
    const band = heldBand(render({ seed: seedAll }));
    const egp = band.slice(band.indexOf('data-vault-value-total="egp"'));
    expect(egp.slice(0, egp.indexOf('</div></div>'))).toContain('99,000,000');
    expect(PAGE).toContain('grandTotal={held.data?.grandTotal}');
  });

  it('says the vault holds nothing, in words, when it is empty', () => {
    const html = render({
      seed: (qc) => {
        seedAll(qc);
        qc.setQueryData(__vaultHeldReportKey(), {
          ...HELD,
          rows: [],
          grandTotal: totals(0, [0, 0, 0], []),
        });
      },
    });
    expect(heldBand(html)).toContain(ar('operations.vaultHistory.heldEmpty'));
    expect(heldBand(html)).not.toContain('data-report-total="true"');
  });

  it('takes a fixed band on a computer, so the history keeps the rest of the screen', () => {
    expect(PAGE).toContain(
      "const HELD_BAND = 'mb-4 flex shrink-0 flex-col gap-4 lg:h-[min(19rem,36vh)] lg:flex-row';",
    );
  });
});

describe('the secured history under it — «سجل الشحنات» for the محصنات', () => {
  it('is the shared board: its figures, its filter bar, the secured screen’s two dates and its stages', () => {
    const html = render({ seed: seedAll });
    expect(html).toContain('data-shipment-figures="true"');
    expect(html).toContain('data-shipment-filters="true"');
    const history = html.slice(html.indexOf('data-shipment-filters'));
    expect(heads(history)).toContain(ar('operations.board.collectedOn'));
    expect(heads(history)).toContain(ar('operations.shipment.deliveryDate'));
    expect(heads(history)).not.toContain(ar('operations.shipment.type'));
    for (const id of ['s-held', 's-done', 's-draft'])
      expect(html).toContain(`data-shipment-log="${id}"`);
  });

  it('reads the history for the محصنات alone — an answer for both types is not this screen’s', () => {
    const html = render({
      seed: (qc) => {
        qc.setQueryData(__vaultHeldReportKey(), HELD);
        // Filed under the whole history's key (no type): the page must not show it.
        qc.setQueryData(__shipmentHistoryKey(RANGE), HISTORY);
      },
    });
    expect(html).not.toContain('data-shipment-log="s-held"');
    expect(PAGE).toContain(
      "useOperationsShipmentHistory(range, canSeeHistory && problem === null, 'secured')",
    );
  });

  it('opens on this month to date, in «من» / «إلى», at the date column’s place', () => {
    const html = render({ seed: seedAll });
    expect(html).toContain(`value="${RANGE.from}"`);
    expect(html).toContain(`value="${RANGE.to}"`);
    expect(html).toContain('data-date-label="from"');
    expect(html).toContain('data-date-label="to"');
  });

  it('offers no add and no ✓ — the history’s rule — and keeps the deleted محصنات of its range', () => {
    const html = render({ seed: seedAll });
    expect(html).not.toContain('data-shipment-new');
    expect(html).not.toContain(`aria-label="${ar('operations.shipment.receive')}"`);
    expect(PAGE).toContain('canCreate={false}');
    expect(PAGE).toContain('canToggleReceived={false}');
    expect(PAGE).toContain(
      "deletedShipments={{ range, enabled: problem === null, type: 'secured' }}",
    );
  });

  it('locks the row the vault holds, and edits the one it does not, as every board', () => {
    const html = render({ seed: seedAll });
    expect(html).toContain('data-row-locked="s-held"');
    expect(html).not.toContain('data-row-locked="s-draft"');
  });

  it('filters by any of the six stages — a history holds every stage a محصنة passes', () => {
    expect(PAGE).toContain('const HISTORY_STAGES = OPERATIONS_SECURED_STAGES;');
    expect(PAGE).toContain('stages={HISTORY_STAGES}');
    expect(OPERATIONS_SECURED_STAGES).toHaveLength(6);
  });

  it('remembers the secured board’s filters, and NOT the range', () => {
    const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(PAGE)?.[1] ?? '';
    const kept = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(kept).toEqual([...boardFilterParams('secured')]);
    expect(kept).not.toContain('from');
  });

  it('says a range in words when it is refused, as «سجل الشحنات»', () => {
    const html = render({ path: '/operations/vault?from=2026-11-20&to=2026-11-05', seed: seedAll });
    expect(html).toContain(ar('operations.history.rangeOrder'));
    // The live report stays: it has no range to refuse.
    expect(heldBand(html)).toContain('data-report-total="true"');
  });
});

describe('a treasurer holding only the vault’s grants', () => {
  it('gets the live report, and a line saying what the history needs — no request refused under his eyes', () => {
    const html = render({ permissions: ['operationsVault.view'], seed: seedAll });
    expect(html).toContain('data-vault-held="true"');
    expect(html).toContain(ar('operations.vaultHistory.needsShipmentView'));
    expect(html).not.toContain('data-shipment-filters');
  });
});

describe('the caches — one type, one entry; the live report rides the roll-up', () => {
  it('keys the history and its deleted list per type, the whole history’s key unchanged', () => {
    expect(__shipmentHistoryKey(RANGE)).toEqual(['operations', 'dayBoard', 'history', RANGE]);
    expect(__shipmentHistoryKey(RANGE, 'secured')).toEqual([
      'operations',
      'dayBoard',
      'history',
      { ...RANGE, type: 'secured' },
    ]);
    expect(__deletedShipmentsKey(RANGE)).toEqual(['operations', 'dayBoard', 'deleted', RANGE]);
    expect(__deletedShipmentsKey(RANGE, 'secured')).not.toEqual(__deletedShipmentsKey(RANGE));
  });

  it('files «تقرير الخزينة» under the vault roll-up, which every secured act stales', async () => {
    expect(__vaultHeldReportKey().slice(0, 2)).toEqual(featureKey('operations', 'vaultReport'));
    const qc = new QueryClient();
    qc.setQueryData(__vaultHeldReportKey(), HELD);
    await qc.invalidateQueries({ queryKey: featureKey('operations', 'vaultReport') });
    expect(qc.getQueryState(__vaultHeldReportKey())?.isInvalidated).toBe(true);
  });
});

describe('the two vault screens, named as the owner named them', () => {
  it('«محصنات الخزينة» for the old «صرف الخزينة», «سجل الخزينة» for the old «جرد الخزينة»', () => {
    expect(ar('operations.nav.vaultDispatch')).toBe('محصنات الخزينة');
    expect(ar('operations.nav.vault')).toBe('سجل الخزينة');
    expect(translate('en', 'operations.nav.vaultDispatch')).toBe('Vault shipments');
    expect(translate('en', 'operations.nav.vault')).toBe('Vault history');
    expect(ar('operations.vaultHistory.title')).toBe('سجل الخزينة');
  });
});
