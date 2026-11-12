// «سجل الخزينة» (Round 12, `/operations/vault` — was «جرد الخزينة»), rendered against the real Arabic
// catalog, a real store and query client: «شاشة جرد الخزينة تكون سجل الخزينه المحصنات زى شاشة سجل
// الشحنات بالظبط واعمل فوق تقرير الخزينة يكون نفس الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه
// بس مفيش فتر من الى هيكون لحظى على ف الخزينة», and then «سجل الخزينه لما اوس على تقرير يفتح ززى موديل
// زى لوحة التحكم اللى عملنها فى العهدة».
//
//   · the screen is «سجل الشحنات» for the محصنات alone: the history read with `type=secured`, on the
//     secured board's columns, its range opening on this month to date, its deleted محصنات — the
//     board taking the whole page, no report band over it;
//   · «تقرير الخزينة» is a button beside «إخفاء الإحصائيات», in its look, opening a modal over the
//     whole screen built as Fleet's custody dashboard: its figure tiles off the grand total, the very
//     table of «بيان الشحنات لكل بنك», the panel over the same total, Excel and PDF, with no dates —
//     and read only while it is open;
//   · a treasurer holding only the vault's grants gets the report itself on the page, the modal's
//     own body at the screen's height, and a line about the history.
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
import { VaultHeldReportDialog } from '../components/VaultHeldReportDialog';
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
const DIALOG = read('../components/VaultHeldReportDialog.tsx');

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
    [line('egp', 'مصري', 99_000_000), line('usd', 'دولار', 5_000), line('eur', 'يورو', 112_000)],
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

/** The last client a render used — what it holds after the render is what the screen asked for. */
let client: QueryClient;

const render = ({
  permissions = DESK,
  path = '/operations/vault',
  seed,
  element = <VaultInventoryPage />,
  retryOnMount = true,
}: {
  permissions?: string[];
  path?: string;
  seed: (qc: QueryClient) => void;
  element?: JSX.Element;
  /** False to keep a seeded failure a failure on mount, rather than a fresh load. */
  retryOnMount?: boolean;
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
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, retryOnMount },
    },
  });
  client = qc;
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
            <Route path="/operations/vault" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** «تقرير الخزينة» open, as the button opens it (the portal drawn in place — see the mock above). */
const renderDialog = (seed: (qc: QueryClient) => void, retryOnMount = true): string =>
  render({
    seed,
    retryOnMount,
    element: <VaultHeldReportDialog open onClose={() => undefined} />,
  });

/** Was the live report so much as asked for — is there an entry for it in the cache? */
const heldAsked = (): boolean =>
  client.getQueryCache().find({ queryKey: __vaultHeldReportKey(), exact: true }) !== undefined;

const seedAll = (qc: QueryClient): void => {
  qc.setQueryData(__vaultHeldReportKey(), HELD);
  qc.setQueryData(__shipmentHistoryKey(RANGE, 'secured'), HISTORY);
  qc.setQueryData(__deletedShipmentsKey(RANGE, 'secured'), {
    from: HISTORY.from,
    to: HISTORY.to,
    shipments: [],
  });
};

/** The history's toolbar — the stats toggle and what the page adds beside it. */
const toolbar = (html: string): string => {
  const at = html.indexOf('data-shipments-toolbar');
  return html.slice(at, html.indexOf('data-shipment-filters', at));
};
/** A button, from its opening tag to its close, found by an attribute it carries. */
const buttonWith = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  return at === -1
    ? ''
    : html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at));
};
/** A tile's figure, by its name — the digits as the screen prints them. */
const tile = (html: string, name: string): string => {
  const at = html.indexOf(`data-vault-held-tile="${name}"`);
  if (at === -1) return '';
  const next = html.indexOf('data-vault-held-tile=', at + 1);
  const own = html.slice(at, next === -1 ? html.indexOf('</section>', at) : next);
  return [...own.matchAll(/dir="ltr"[^>]*>([^<]*)</g)].map((m) => m[1]).join('');
};
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

describe('«تقرير الخزينة» — a button beside «إخفاء الإحصائيات», no band over the history', () => {
  it('leaves the page to the history, as «سجل الشحنات»: no report drawn on it, no fold', () => {
    const html = render({ seed: seedAll });
    expect(html).not.toContain('data-vault-held="true"');
    expect(html).not.toContain('data-report-table');
    expect(html).not.toContain(ar('operations.vaultHistory.held'));
    expect(html).not.toContain('data-vault-held-toggle');
    // The board straight in the page's frame, as `ShipmentsHistoryPage` puts it.
    expect(PAGE).toContain('<PageContainer fullHeight>\n      <ShipmentsBoard');
    for (const gone of ['HELD_BAND', 'localStorage', 'vault-history-band', 'heldHide', 'heldShow'])
      expect(PAGE).not.toContain(gone);
  });

  it('sits right after «إخفاء الإحصائيات», in its look, saying it opens a dialog', () => {
    const bar = toolbar(render({ seed: seedAll }));
    const stats = bar.indexOf('data-shipment-stats-toggle="true"');
    const open = bar.indexOf('data-vault-held-open="true"');
    expect(stats).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(stats);
    // Nothing between the two buttons but the stats toggle's own end.
    expect(bar.slice(stats, open).match(/<button/g)).toHaveLength(1);
    const button = buttonWith(bar, 'data-vault-held-open="true"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain(ar('operations.vaultHistory.open'));
    expect(ar('operations.vaultHistory.open')).toBe('تقرير الخزينة');
    // The stats toggle's own classes — one look for the two, as on the custody board.
    const statsButton = bar.slice(bar.lastIndexOf('<button', stats), bar.indexOf('>', stats));
    const statsClass = /class="([^"]+)"/.exec(statsButton)?.[1];
    expect(statsClass).toBeTruthy();
    expect(button).toContain(`class="${statsClass}"`);
  });

  it('stays while the history’s range is refused — what the vault holds is not the history’s', () => {
    const html = render({ path: '/operations/vault?from=2026-11-20&to=2026-11-05', seed: seedAll });
    expect(html).toContain(ar('operations.history.rangeOrder'));
    expect(toolbar(html)).toContain('data-vault-held-open="true"');
  });

  it('does not read the report while it is closed — closed on the way in', () => {
    render({
      seed: (qc) => {
        qc.setQueryData(__shipmentHistoryKey(RANGE, 'secured'), HISTORY);
      },
    });
    expect(heldAsked()).toBe(false);
    expect(PAGE).toContain('const [reportOpen, setReportOpen] = useState(false);');
    expect(PAGE).toContain(
      '<VaultHeldReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />',
    );
    // The page never reads the report itself: the dialog (or, for a vault-only reader, the inline
    // report) does, mounted only while it is drawn.
    expect(PAGE).not.toContain('useVaultHeldReport');
  });

  it('is offered only beside the history — a vault-only reader has no toolbar to hold it', () => {
    const html = render({ permissions: ['operationsVault.view'], seed: seedAll });
    expect(html).not.toContain('data-vault-held-open');
    expect(html).not.toContain('data-shipments-toolbar');
  });
});

describe('the modal — over the whole screen, as the custody dashboard', () => {
  it('is a dialog over the whole screen, named by its header', () => {
    const html = renderDialog(seedAll);
    expect(html).toMatch(/^<div data-dialog-root="" class="fixed inset-0 z-\[90\]"/);
    const dialog = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain('aria-modal="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1];
    expect(labelledBy).toBeTruthy();
    const heading = new RegExp(`<h2 id="${labelledBy ?? '-'}"[^>]*>([\\s\\S]*?)</h2>`).exec(html);
    expect(heading?.[1]).toContain(ar('operations.vaultHistory.held'));
    expect(ar('operations.vaultHistory.held')).toBe('تقرير الخزينة — الموجود الآن');
  });

  it('says when it was read — the Cairo clock, Latin figures kept in their order', () => {
    const html = renderDialog(seedAll);
    // 12:09 UTC is 14:09 in Cairo.
    expect(html).toContain('data-vault-held-as-of="true"');
    expect(html).toContain(ar('operations.vaultHistory.heldAsOf', { at: '⁦2026-11-12 14:09⁩' }));
  });

  it('closes on ×, on Escape, keeps Tab inside, holds the page still and gives the focus back', () => {
    const close = buttonWith(renderDialog(seedAll), 'data-vault-held-close="true"');
    expect(close).toContain(`aria-label="${ar('common.close')}"`);
    expect(DIALOG).toContain('onClick={() => close.current()}');
    expect(DIALOG).toContain("if (e.key === 'Escape' && !e.defaultPrevented)");
    expect(DIALOG).toContain("document.addEventListener('keydown', onKey)");
    expect(DIALOG).toContain("document.removeEventListener('keydown', onKey)");
    expect(DIALOG).toContain('custodyTrapFocus<Element>({ back, active, first, last, inside })');
    expect(DIALOG).toContain("document.body.style.overflow = 'hidden'");
    expect(DIALOG).toContain('document.body.style.overflow = previous;');
    expect(DIALOG).toContain('opener?.focus();');
    expect(DIALOG).toContain('closeButton.current?.focus();');
  });

  it('lets the «عملات أخرى» breakdown over it take Escape, and keeps Tab inside the two', () => {
    // Escape is answered only while this modal is the top of the page's dialog stack
    // (`isTopDialog`): over it, the breakdown closes alone.
    expect(DIALOG.match(/if \(!onTop\(\)\) return;/g)).toHaveLength(1);
    expect(DIALOG).toContain(
      "if (e.key === 'Escape' && !e.defaultPrevented) {\n        if (!onTop()) return;",
    );
    expect(DIALOG).toContain('const onTop = (): boolean => isTopDialog(roots(), rootRef.current);');
    expect(DIALOG).toContain(
      "const roots = (): Element[] => Array.from(document.querySelectorAll('[data-dialog-root]'));",
    );
    // Tab is never let go: the trap goes round the breakdown while it is up (`focusScope`) — the
    // breakdown keeps no focus of its own — and round the report otherwise.
    expect(DIALOG).toContain('const root = focusScope(roots(), rootRef.current);');
    expect(DIALOG).toContain('const inside = active !== null && box?.contains(active) === true;');
    expect(DIALOG).toContain('scope()?.contains(e.target) === false');
    expect(DIALOG).not.toContain('panelRef.current?.contains(e.target)');
    // Closed, the breakdown hands the focus back to the tile that opened it.
    expect(DIALOG).toContain(
      'if (othersWasOpen.current && !othersOpen) othersTile.current?.focus();',
    );
    expect(buttonWith(renderDialog(seedAll), 'data-vault-held-tile="others"')).toContain(
      'aria-haspopup="dialog"',
    );
  });

  it('is read only while open: closed, nothing is drawn and nothing is asked', () => {
    const closed = render({
      seed: () => undefined,
      element: <VaultHeldReportDialog open={false} onClose={() => undefined} />,
    });
    expect(closed).toBe('');
    expect(heldAsked()).toBe(false);
    renderDialog(() => undefined);
    expect(heldAsked()).toBe(true);
    expect(DIALOG).toContain(
      'open ? createPortal(<HeldReportModal onClose={onClose} />, document.body) : null',
    );
    expect(DIALOG).toContain('const { held, rows, face } = useHeldReport(true);');
  });

  it('has NO dates — it is now («بس مفيش فتر من الى هيكون لحظى»)', () => {
    expect(renderDialog(seedAll)).not.toContain('type="date"');
    // Its one argument is whether it is read at all — never a period.
    expect(DIALOG).toContain('const held = useVaultHeldReport(enabled);');
  });

  it('wears the custody dashboard’s two surfaces — light and dark', () => {
    expect(DIALOG).toContain('bg-[#f8fafc]');
    expect(DIALOG).toContain('dark:bg-[#0b0f19]');
    expect(DIALOG).toContain('dark:bg-[#0c111e]/95');
    // Its scroll is its own, in the dashboard's thin bars on the dark theme.
    expect(DIALOG).toContain(
      "'min-h-0 flex-1 overflow-y-auto overscroll-contain',\n            SCROLLBAR,",
    );
  });
});

describe('the figure tiles — off the grand total, in the custody dashboard’s tile', () => {
  it('draws the seven, in the owner’s order', () => {
    const html = renderDialog(seedAll);
    const order = [...html.matchAll(/data-vault-held-tile="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['count', 'egp', 'usd', 'others', 'bags', 'cartons', 'boxes']);
    for (const label of [
      ar('operations.vaultReport.securedCount'),
      ar('operations.reportBoard.pound'),
      ar('operations.reportBoard.dollar'),
      ar('operations.board.figures.otherCurrencies'),
      ar('operations.reportBoard.bags'),
      ar('operations.vaultHistory.tiles.cartons'),
      ar('operations.vaultHistory.tiles.boxes'),
    ])
      expect(html).toContain(label);
    expect(ar('operations.vaultHistory.tiles.cartons')).toBe('الكراتين');
    expect(ar('operations.vaultHistory.tiles.boxes')).toBe('الصناديق');
  });

  it('reads the server’s grand total — never the rows added up', () => {
    const html = renderDialog(seedAll);
    // The rows hold 10 محصنات and 27 bags; the grand total says 77 and 111.
    expect(tile(html, 'count')).toBe('77');
    expect(tile(html, 'bags')).toBe('111');
    expect(tile(html, 'cartons')).toBe('22');
    expect(tile(html, 'boxes')).toBe('33');
  });

  it('splits the money by the boards’ classifier — the pound coded «1» is the pound', () => {
    const html = renderDialog(seedAll);
    expect(tile(html, 'egp')).toBe('99,000,000');
    expect(tile(html, 'usd')).toBe('5,000');
    expect(tile(html, 'others')).toBe('112,000');
  });

  it('opens the boards’ «عملات أخرى» breakdown from its tile', () => {
    const others = buttonWith(renderDialog(seedAll), 'data-vault-held-tile="others"');
    expect(others).toContain('aria-haspopup="dialog"');
    expect(others).toContain(`title="${ar('operations.board.figures.otherCurrenciesHint')}"`);
    expect(DIALOG).toContain('<OtherCurrenciesDialog');
    expect(DIALOG).toContain('cards={reportOtherCards(tiles.money)}');
    expect(DIALOG).toContain('const tiles = heldReportTiles(data.grandTotal, catalog);');
  });

  it('keeps its frames at zero for an empty vault, and shimmers while the answer is on its way', () => {
    const empty = renderDialog((qc) =>
      qc.setQueryData(__vaultHeldReportKey(), {
        ...HELD,
        rows: [],
        grandTotal: totals(0, [0, 0, 0], []),
      }),
    );
    for (const name of ['count', 'egp', 'usd', 'others', 'bags', 'cartons', 'boxes'])
      expect(tile(empty, name)).toBe('0');
    expect(empty).toContain(ar('operations.vaultHistory.heldEmpty'));
    expect(empty).not.toContain('data-report-total="true"');

    const loading = renderDialog(() => undefined);
    expect(loading).toContain('data-vault-held-loading="true"');
    expect(loading).not.toContain('data-vault-held-tile=');
    expect(loading).not.toContain('data-vault-held-error');
  });

  it('says a report that never answered failed, with its retry, in one card', () => {
    const html = renderDialog((qc) => {
      qc.getQueryCache()
        .build(qc, { queryKey: __vaultHeldReportKey() })
        .setState({
          status: 'error',
          error: new Error('the vault did not answer'),
          fetchStatus: 'idle',
        });
    }, false);
    expect(html).toContain('data-vault-held-error="true"');
    expect(html).toContain('the vault did not answer');
    expect(html).not.toContain('data-vault-held-tile=');
    expect(html).not.toContain('data-report-table');
  });
});

describe('«بيان الشحنات لكل بنك» in the modal — the very table, the panel beside it, the files', () => {
  it('draws the bank table’s columns under its own strip', () => {
    const html = renderDialog(seedAll);
    expect(html).toContain(ar('operations.vaultReport.table'));
    expect(heads(html)).toEqual([
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
  });

  it('lists the banks in the reference order, «الإجمالي» the server’s own', () => {
    const rows = bodyRows(renderDialog(seedAll)).map(cells);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ['1', 'الأهلي', '5'],
      ['2', 'مصر', '5'],
      ['', 'الإجمالي', '77'],
    ]);
    expect(rows.at(-1)?.slice(3, 6)).toEqual(['99,000,000', '5,000', '112,000']);
  });

  it('pins its head and «الإجمالي» while the banks scroll — the reports’ own `ReportTable`', () => {
    expect(DIALOG).toContain("import { ReportExportPair, ReportTable } from './ReportBoard';");
    expect(DIALOG).toContain('<ReportTable');
    expect(renderDialog(seedAll)).toContain('data-report-total="true"');
  });

  it('keeps «إجمالي قيمة الشحنات» beside it over the same total, stacking on a narrow screen', () => {
    const html = renderDialog(seedAll);
    const egp = html.slice(html.indexOf('data-vault-value-total="egp"'));
    expect(egp.slice(0, egp.indexOf('</div></div>'))).toContain('99,000,000');
    expect(html.indexOf('data-report-table')).toBeLessThan(html.indexOf('data-vault-value="true"'));
    expect(DIALOG).toContain(
      '"flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch"',
    );
    expect(DIALOG).toContain('grandTotal={data?.grandTotal}');
    expect(DIALOG).toContain('className="max-lg:max-h-[70vh] lg:min-h-0 lg:flex-1"');
  });

  it('offers Excel and PDF of what it shows — the period report’s files, its panel included', () => {
    const html = renderDialog(seedAll);
    expect(html).toMatch(/<button type="button" data-report-export-excel="true" class=/);
    expect(html).toMatch(/<button type="button" data-report-export-pdf="true" class=/);
    expect(buttonWith(html, 'data-report-export-excel="true"')).not.toContain('disabled=""');
    expect(DIALOG).toContain('withValuePanel: true,');
    expect(DIALOG).toContain('lines={reportTableLines(rows, data?.grandTotal)}');
    // Nothing to carry for an empty vault.
    const empty = renderDialog((qc) =>
      qc.setQueryData(__vaultHeldReportKey(), {
        ...HELD,
        rows: [],
        grandTotal: totals(0, [0, 0, 0], []),
      }),
    );
    expect(buttonWith(empty, 'data-report-export-excel="true"')).toContain('disabled=""');
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
    expect(html).toContain('data-shipments-refusal="true"');
  });
});

describe('a treasurer holding only the vault’s grants', () => {
  const vaultOnly = (seed: (qc: QueryClient) => void = seedAll): string =>
    render({ permissions: ['operationsVault.view'], seed });
  /** The inline report — from its section to the notice under it. */
  const inline = (html: string): string =>
    html.slice(html.indexOf('data-vault-held="true"'), html.indexOf('data-shipments-refusal'));

  it('gets the report itself, and a line saying what the history needs — no request refused under his eyes', () => {
    const html = vaultOnly();
    expect(html).toContain('data-vault-held="true"');
    expect(html).toContain(ar('operations.vaultHistory.needsShipmentView'));
    expect(html).not.toContain('data-shipment-filters');
    // The report first, the line under it.
    expect(html.indexOf('data-vault-held="true"')).toBeLessThan(
      html.indexOf('data-shipments-refusal'),
    );
  });

  it('is the modal’s own body — its header without ×, its tiles, its table, its panel, its files', () => {
    const own = inline(vaultOnly());
    expect(own).toContain(ar('operations.vaultHistory.held'));
    expect(own).toContain('data-vault-held-as-of="true"');
    expect(own).toContain('data-report-export-excel="true"');
    expect(tile(own, 'count')).toBe('77');
    expect(tile(own, 'egp')).toBe('99,000,000');
    expect(own).toContain('data-report-table="true"');
    expect(own).toContain('data-vault-value="true"');
    expect(bodyRows(own).map(cells).at(-1)?.slice(1, 3)).toEqual(['الإجمالي', '77']);
    // Not a dialog: nothing over the screen, nothing to close.
    expect(own).not.toContain('role="dialog"');
    expect(own).not.toContain('data-dialog-root');
    expect(own).not.toContain('data-vault-held-close');
    expect(DIALOG).toMatch(
      /export const VaultHeldReportInline = [\s\S]*?useHeldReport\(true\)[\s\S]*?<VaultHeldReportBody/,
    );
    expect(DIALOG.match(/<VaultHeldReportBody/g)).toHaveLength(2);
  });

  it('gives him the report at the screen’s height — its table taking what the tiles leave', () => {
    const html = vaultOnly();
    const at = html.indexOf('data-vault-held="true"');
    expect(html.slice(html.lastIndexOf('<section', at), html.indexOf('>', at))).toContain(
      'lg:flex-1',
    );
    expect(PAGE).toMatch(
      /if \(!canSeeHistory\) \{[\s\S]*?<VaultHeldReportInline \/>\s*<BoardRefusal>\{t\('operations\.vaultHistory\.needsShipmentView'\)\}<\/BoardRefusal>/,
    );
  });

  it('says the vault holds nothing, in words, when it is empty', () => {
    const html = vaultOnly((qc) =>
      qc.setQueryData(__vaultHeldReportKey(), {
        ...HELD,
        rows: [],
        grandTotal: totals(0, [0, 0, 0], []),
      }),
    );
    expect(inline(html)).toContain(ar('operations.vaultHistory.heldEmpty'));
    expect(inline(html)).not.toContain('data-report-total="true"');
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
