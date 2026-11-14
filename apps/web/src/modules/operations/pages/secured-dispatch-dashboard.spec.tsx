// «لوحة تحكم» on «محصنات الخزينة» (Round 16), rendered against the real Arabic catalog, a real store
// and query client — what reaches the screen. The owner: «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة
// تحكم اللي هي داشبورد جنب الإحصائيات». The numbers themselves are pinned in
// lib/secured-dispatch-dashboard.spec.ts; here:
//
//   · THE BUTTON — right beside «إخفاء الإحصائيات», in its look, as on Fleet's custody board and
//     «سجل الخزينة»; offered once the board's rows are in, never beside a refusal;
//   · THE WINDOW — the vault reports' one (`ReportModal.tsx`): a dialog over the whole screen, its
//     keyboard, focus and surfaces written once for it and «تقرير الخزينة»;
//   · THE SECTIONS — in the owner's order, every one drawn even with nothing in it;
//   · THE ALERTS → THE BOARD — «تسليمها اليوم» and «تسليمها غدًا» set the board's own «تاريخ
//     التسليم» and close the window; the three the board's filters cannot say are read, not clicked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import {
  MAX_PAGE_SIZE,
  type Locale,
  type MeDto,
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
import { EMPTY_DAY_BOARD_FILTERS } from '../lib/day-board';
import { HISTORY_TOO_LARGE } from '../lib/shipment-history';
import { __securedDispatchBoardKey } from '../api/operations-queries';
import { SecuredDispatchDashboard } from '../components/SecuredDispatchDashboard';
import { SecuredDispatchPage } from './SecuredDispatchPage';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('./SecuredDispatchPage.tsx');
const DASH = read('../components/SecuredDispatchDashboard.tsx');
const FRAME = read('../components/ReportModal.tsx');
const BOARD = read('../components/ShipmentsBoard.tsx');
const HELD = read('../components/VaultHeldReportDialog.tsx');

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
// The production catalog's legacy codes: the pound is «1».
const CURRENCIES = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
];
const BANKS = [
  { id: 'b-ahly', code: 1, sortOrder: 1, opsName: 'الأهلي' },
  { id: 'b-misr', code: 2, sortOrder: 2, opsName: 'مصر' },
];

const TODAY = '2026-11-14';
const crew = {
  crewAssignmentId: 'ca-1',
  vehicleId: 'v-150',
  vehicleCode: '150',
  captainEmployeeId: 'e-1',
  captainName: 'محمود حسن',
  captainCode: null,
  captainPhone: null,
  captainBranchId: null,
};

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
  lines: [{ currencyId: 'egp', amount: 1_000_000 }],
  collectionDate: '2026-11-12T00:00:00.000Z',
  deliveryDate: deliveryDay === null ? null : `${deliveryDay}T00:00:00.000Z`,
  receiptNumber: 'R-1',
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 6,
  createdAt: '2026-11-12T08:00:00.000Z',
  updatedAt: '2026-11-12T08:00:00.000Z',
  origin: { id: 'o', name: 'فرع المهندسين', code: 'O1', bankId: 'b-ahly', bankName: 'الأهلي' },
  destination: { id: 'd', name: 'فرع الدقي', code: 'D1', bankId: 'b-ahly', bankName: 'الأهلي' },
  crew: null,
  captainDeliveredAt: null,
  securedStage: 'inVault',
  pickedUpBy: 'captain',
  pickedUpAt: '2026-11-12T07:30:00.000Z',
  vaultReceivedAt: '2026-11-12T09:15:00.000Z',
  overdue: deliveryDay !== null && deliveryDay < TODAY,
  deliveryLegVersion: null,
  ...over,
});

const ROWS = [
  inVault('s-late', '2026-11-11', {
    mainBankId: 'b-misr',
    lines: [
      { currencyId: 'egp', amount: 3_000_000 },
      { currencyId: 'eur', amount: 20_000 },
    ],
  }),
  inVault('s-today-van', TODAY, { crew, deliveryLegVersion: 1 }),
  inVault('s-today', TODAY, {
    lines: [
      { currencyId: 'egp', amount: 500_000 },
      { currencyId: 'usd', amount: 75_000 },
    ],
    vaultReceivedAt: '2026-11-13T22:30:00.000Z',
  }),
  inVault('s-later', '2026-11-25'),
  inVault('s-undated', null, { mainBankId: 'b-misr' }),
];
const PACKAGING = new Map([
  ['s-late', { bags: 3, cartons: 1, boxes: 0 }],
  ['s-today-van', { bags: 2, cartons: 0, boxes: 1 }],
  ['s-today', { bags: 1, cartons: 0, boxes: 0 }],
  ['s-later', { bags: 4, cartons: 2, boxes: 0 }],
  ['s-undated', { bags: 1, cartons: 0, boxes: 0 }],
]);
const packagingKey = listKey('operations', 'vault', { packaging: true });

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

const PERMS = ['operationsVault.view', 'operationsShipment.view', 'operationsCrew.view'];

const client = (seed: (qc: QueryClient) => void = () => undefined): QueryClient => {
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
    page(BANKS),
  );
  qc.setQueryData(
    listKey('operations', 'currencies', { page: 1, pageSize: MAX_PAGE_SIZE }),
    page(CURRENCIES),
  );
  seed(qc);
  return qc;
};

const renderWith = (
  element: ReactElement,
  qc: QueryClient,
  path = '/operations/vault/dispatch',
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: { me: me(PERMS), status: 'signedIn' as const },
          ui: { theme: 'dark' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/operations/vault/dispatch" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The page, as the screen draws it. */
const renderPage = (
  seed: (qc: QueryClient) => void,
  path?: string,
): { html: string; qc: QueryClient } => {
  const qc = client(seed);
  return { html: renderWith(<SecuredDispatchPage />, qc, path), qc };
};

/** The dashboard open, as the button opens it (the portal drawn in place — see the mock above). */
const renderDash = ({
  rows = ROWS,
  packaging = PACKAGING as Map<string, { bags: number; cartons: number; boxes: number }> | null,
  filters = EMPTY_DAY_BOARD_FILTERS,
  date = null as string | null,
  // Null: the board hands no such handler (a default parameter would stand in for `undefined`).
  onShowDay = (() => undefined) as ((day: string) => void) | null,
  onClearFilters = (() => undefined) as (() => void) | null,
} = {}): string => {
  const qc = client((c) => {
    if (packaging !== null) c.setQueryData(packagingKey, packaging);
  });
  return renderWith(
    <SecuredDispatchDashboard
      open
      onClose={() => undefined}
      rows={rows}
      today={TODAY}
      filters={filters}
      date={date}
      onShowDay={onShowDay ?? undefined}
      onClearFilters={onClearFilters ?? undefined}
    />,
    qc,
  );
};

/** The board's toolbar — the stats toggle and what the page adds beside it. */
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
/** A tile's figure, by its name. */
const tile = (html: string, name: string): string => {
  const at = html.indexOf(`data-dispatch-dashboard-tile="${name}"`);
  if (at === -1) return '';
  const next = html.indexOf('data-dispatch-dashboard-tile=', at + 1);
  const own = html.slice(at, next === -1 ? html.indexOf('</section>', at) : next);
  return [...own.matchAll(/dir="ltr"[^>]*>([^<]*)</g)].map((m) => m[1]).join('');
};
/** The text an element carrying `mark` holds, up to its first closing tag. */
const textAt = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  return at === -1 ? '' : html.slice(html.indexOf('>', at) + 1, html.indexOf('<', at));
};
const cells = (tr: string): string[] =>
  [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    (m[1] ?? '')
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
const bodyRows = (html: string): string[] => {
  const table = html.slice(html.indexOf('data-report-table'));
  const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
};

describe('«لوحة تحكم» — a button right beside «إخفاء الإحصائيات»', () => {
  const loaded = (): string =>
    renderPage((qc) => qc.setQueryData(__securedDispatchBoardKey(null), answer(null, ROWS))).html;

  it('sits right after the stats toggle, in its look, saying it opens a dialog', () => {
    const bar = toolbar(loaded());
    const stats = bar.indexOf('data-shipment-stats-toggle="true"');
    const open = bar.indexOf('data-dispatch-dashboard-open="true"');
    expect(stats).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(stats);
    // Nothing between the two buttons but the stats toggle's own end.
    expect(bar.slice(stats, open).match(/<button/g)).toHaveLength(1);
    const button = buttonWith(bar, 'data-dispatch-dashboard-open="true"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain(ar('operations.secured.dashboard.open'));
    expect(ar('operations.secured.dashboard.open')).toBe('لوحة تحكم');
    expect(button).not.toContain('disabled=""');
    // The stats toggle's own classes — one look for the two, as on the custody board.
    const statsButton = bar.slice(bar.lastIndexOf('<button', stats), bar.indexOf('>', stats));
    const statsClass = /class="([^"]+)"/.exec(statsButton)?.[1];
    expect(statsClass).toBeTruthy();
    expect(button).toContain(`class="${statsClass ?? '-'} `);
    // Before the late / today counts, which stay where they were.
    expect(bar.indexOf('data-dispatch-legend="overdue"')).toBeGreaterThan(open);
  });

  it('waits for the rows it reads: disabled until the list is in', () => {
    const { html } = renderPage(() => undefined);
    expect(buttonWith(toolbar(html), 'data-dispatch-dashboard-open="true"')).toContain(
      'disabled=""',
    );
  });

  it('is never offered beside a refusal — there are no rows to read', () => {
    const { html } = renderPage((qc) => {
      qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retryOnMount: false } });
      const query = qc
        .getQueryCache()
        .build(qc, { queryKey: [...__securedDispatchBoardKey(null)] });
      query.setState({
        ...query.state,
        data: answer(null, ROWS),
        dataUpdatedAt: 1,
        status: 'error',
        error: new ApiError(HISTORY_TOO_LARGE, 'too many', 422),
        errorUpdatedAt: 2,
        fetchStatus: 'idle',
      });
    });
    expect(buttonWith(toolbar(html), 'data-dispatch-dashboard-open="true"')).toContain(
      'disabled=""',
    );
  });

  it('is closed on the way in, and reads nothing it would show until it opens', () => {
    const { html, qc } = renderPage((c) =>
      c.setQueryData(__securedDispatchBoardKey(null), answer(null, ROWS)),
    );
    expect(html).not.toContain('data-dispatch-dashboard-dialog');
    // The custody's packages are the dashboard's alone: not asked for while it is closed.
    expect(qc.getQueryCache().find({ queryKey: packagingKey, exact: true })).toBeUndefined();
    expect(PAGE).toContain('const [dashOpen, setDashOpen] = useState(false);');
    expect(PAGE).toContain('open={dashOpen}');
  });

  it('closes on a refusal and stays closed; stays up, dimmed over its last rows, while the board re-reads', () => {
    // A refused or failed list: closed, and not reopened by itself when a later answer lands.
    expect(PAGE).toContain('if (dashOpen && !loaded && !board.isLoading) setDashOpen(false);');
    // A list on its way (a reset that dropped the delivery day): the window is kept, never
    // unmounted and mounted again — that lost the focus to <body> and the way back on Escape.
    expect(PAGE).toContain('pending={!loaded}');
    expect(DASH).toContain('if (!pending) last.current = live;');
    expect(DASH).toContain('dimmed={pending}');
    const dimmed = (html: string): boolean =>
      /<div class="[^"]*opacity-60[^"]*" data-dispatch-dashboard-scroll="true"/.test(html);
    expect(dimmed(renderDash())).toBe(false);
    const qc = client((c) => c.setQueryData(packagingKey, PACKAGING));
    const pending = renderWith(
      <SecuredDispatchDashboard
        open
        pending
        onClose={() => undefined}
        rows={ROWS}
        today={TODAY}
        filters={EMPTY_DAY_BOARD_FILTERS}
        date={null}
      />,
      qc,
    );
    expect(dimmed(pending)).toBe(true);
    // The rows it was opened over are still drawn under the dim, not zeros.
    expect(tile(pending, 'count')).toBe('5');
  });

  it('hands the reset’s focus to the filters line, never to the page’s <body>', () => {
    expect(DASH).toContain('onClearFilters();\n            self.current?.focus();');
    const html = renderDash({ filters: { ...EMPTY_DAY_BOARD_FILTERS, bank: 'الأهلي' } });
    expect(html).toMatch(/<section tabindex="-1" data-dispatch-dashboard-section="filters"/);
  });

  it('reads the board’s rows SHOWN — every filter applied, every page of them', () => {
    // The board hands its toolbar the filtered rows, before the pages are cut…
    expect(BOARD).toContain('{toolbarExtras?.(rows)}');
    expect(BOARD).toContain('const shown = paged ? pageOfRows(rows, page, paging.size) : null;');
    // …and the page hands the dashboard exactly those.
    expect(PAGE).toContain('const toolbar = (shown: readonly OperationsSecuredDispatchRowDto[])');
    expect(PAGE).toContain('rows={shown}');
    expect(PAGE).toContain('toolbarExtras={toolbar}');
  });

  it('changes the board itself: the reset clears its filters and day, an alert sets its day and closes', () => {
    expect(PAGE).toContain(
      "for (const name of [...DAY_BOARD_FILTER_PARAMS, 'date']) next.delete(name);",
    );
    expect(PAGE).toContain('setSp(next, { replace: true });');
    expect(PAGE).toContain('onClearFilters={clearFilters}');
    expect(PAGE).toContain(
      'onShowDay={(day) => {\n          setDate(day);\n          setDashOpen(false);',
    );
    // The filters said at the top are the ones the board reads.
    expect(PAGE).toContain(
      "const filters = offeredFilters(readDayBoardFilters(sp), 'secured', DISPATCH_STAGES);",
    );
  });
});

describe('the window — the vault reports’ one, as «تقرير الخزينة»', () => {
  it('is a dialog over the whole screen, named by its header', () => {
    const html = renderDash();
    expect(html).toMatch(
      /^<div data-dialog-root="" class="fixed inset-0 z-\[90\]" data-dispatch-dashboard-dialog="true"/,
    );
    const dialog = /<div[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain('aria-modal="true"');
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(dialog)?.[1];
    expect(labelledBy).toBeTruthy();
    const heading = new RegExp(`<h2 id="${labelledBy ?? '-'}"[^>]*>([\\s\\S]*?)</h2>`).exec(html);
    expect(heading?.[1]).toContain(ar('operations.secured.dashboard.title'));
    expect(ar('operations.secured.dashboard.title')).toBe('لوحة تحكم محصنات الخزينة');
    expect(buttonWith(html, 'data-dispatch-dashboard-close="true"')).toContain(
      `aria-label="${ar('common.close')}"`,
    );
  });

  it('says the day it is judged on — the server’s, in Latin figures kept in their order', () => {
    expect(renderDash()).toContain(
      ar('operations.secured.dashboard.today', { day: '⁦2026-11-14⁩' }),
    );
  });

  it('is the vault reports’ ONE window: no second copy of its keyboard, focus or surfaces', () => {
    expect(DASH).toContain('<ReportModalFrame\n      mark="dispatch-dashboard"');
    expect(HELD).toContain('<ReportModalFrame\n      mark="vault-held"');
    for (const own of [
      "addEventListener('keydown'",
      'document.body.style.overflow',
      'bg-[#f8fafc]',
    ])
      expect(DASH).not.toContain(own);
    // The frame: Escape for the top dialog only (the breakdown over it closes alone), Tab kept
    // inside the two, the page held still, the focus handed back.
    expect(FRAME).toContain(
      "if (e.key === 'Escape' && !e.defaultPrevented) {\n        if (!onTop()) return;",
    );
    expect(FRAME).toContain('const root = focusScope(roots(), rootRef.current);');
    expect(FRAME).toContain("document.body.style.overflow = 'hidden'");
    expect(FRAME).toContain('opener?.focus();');
    expect(FRAME).toContain('closeButton.current?.focus();');
    // Closed, the «عملات أخرى» breakdown hands the focus back to the tile that opened it.
    expect(FRAME).toContain(
      'if (othersWasOpen.current && !othersOpen) othersTile.current?.focus();',
    );
  });

  it('is mounted only while open — closed, nothing is drawn', () => {
    expect(DASH).toContain(
      'open ? createPortal(<DispatchDashboardModal {...props} />, document.body) : null',
    );
    const qc = client();
    const closed = renderWith(
      <SecuredDispatchDashboard
        open={false}
        onClose={() => undefined}
        rows={ROWS}
        today={TODAY}
        filters={EMPTY_DAY_BOARD_FILTERS}
        date={null}
      />,
      qc,
    );
    expect(closed).toBe('');
    expect(qc.getQueryCache().find({ queryKey: packagingKey, exact: true })).toBeUndefined();
  });

  it('wears the custody dashboard’s two surfaces, its own scroll', () => {
    const html = renderDash();
    expect(html).toContain('bg-[#f8fafc]');
    expect(html).toContain('dark:bg-[#0b0f19]');
    expect(html).toContain('data-dispatch-dashboard-scroll="true"');
  });
});

describe('the sections — in the owner’s order, every one drawn', () => {
  it('reads: the filters, the tiles, the alerts, «جدول التسليم», «مدة البقاء», the banks', () => {
    const html = renderDash();
    const at = ['filters', 'alerts', 'schedule', 'aging', 'banks'].map((name) =>
      html.indexOf(`data-dispatch-dashboard-section="${name}"`),
    );
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const tiles = html.indexOf('data-dispatch-dashboard-tiles="true"');
    expect(tiles).toBeGreaterThan(at[0] ?? Infinity);
    expect(tiles).toBeLessThan(at[1] ?? -1);
  });

  it('draws the seven tiles off the rows shown, the pound coded «1» as the pound', () => {
    const html = renderDash();
    const order = [...html.matchAll(/data-dispatch-dashboard-tile="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['count', 'egp', 'usd', 'others', 'bags', 'cartons', 'boxes']);
    expect(tile(html, 'count')).toBe('5');
    expect(tile(html, 'egp')).toBe('6,500,000');
    expect(tile(html, 'usd')).toBe('75,000');
    expect(tile(html, 'others')).toBe('20,000');
    // The custody's packages, once per محصنة.
    expect(tile(html, 'bags')).toBe('11');
    expect(tile(html, 'cartons')).toBe('3');
    expect(tile(html, 'boxes')).toBe('1');
    expect(buttonWith(html, 'data-dispatch-dashboard-tile="others"')).toContain(
      'aria-haspopup="dialog"',
    );
  });

  it('waits for the custody’s packages rather than print a 0 it has not read', () => {
    const html = renderDash({ packaging: null });
    expect(tile(html, 'bags')).toBe('');
    expect(tile(html, 'count')).toBe('5');
    // The files carry the packages too: nothing whole to carry yet.
    expect(buttonWith(html, 'data-report-export-excel="true"')).toContain('disabled=""');
  });

  it('says the five alerts with their counts and pound, in the order they are read', () => {
    const html = renderDash();
    const order = [...html.matchAll(/data-dispatch-dashboard-alert="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['overdue', 'today', 'tomorrow', 'undated', 'unplaced']);
    const count = (alert: string): string => textAt(html, `data-dispatch-alert-count="${alert}"`);
    const egp = (alert: string): string => textAt(html, `data-dispatch-alert-egp="${alert}"`);
    expect([count('overdue'), count('today'), count('tomorrow'), count('undated')]).toEqual([
      '1',
      '2',
      '0',
      '1',
    ]);
    expect(egp('overdue')).toBe('3,000,000');
    expect(egp('today')).toBe('1,500,000');
    // The late one, and today's on no van — not the one on today's van.
    expect(count('unplaced')).toBe('2');
    for (const word of [
      'متأخرة',
      'تسليمها اليوم',
      'تسليمها غدًا',
      'بدون يوم تسليم',
      'لم تُوزَّع على سيارة',
    ])
      expect(html).toContain(word);
  });

  it('clicks through to the board only where its filter can say it — today; tomorrow had nothing', () => {
    const html = renderDash();
    const today = buttonWith(html, 'data-dispatch-dashboard-alert="today"');
    expect(today).toContain(`data-alert-day="${TODAY}"`);
    expect(today).toContain(ar('operations.secured.dashboard.alerts.show'));
    // Nothing due tomorrow: nothing to show — read, not clicked.
    for (const alert of ['tomorrow', 'overdue', 'undated', 'unplaced']) {
      expect(html).toMatch(new RegExp(`<div data-dispatch-dashboard-alert="${alert}"`));
      expect(html).not.toMatch(new RegExp(`<button[^>]*data-dispatch-dashboard-alert="${alert}"`));
    }
    const withTomorrow = renderDash({ rows: [...ROWS, inVault('s-tomorrow', '2026-11-15')] });
    expect(buttonWith(withTomorrow, 'data-dispatch-dashboard-alert="tomorrow"')).toContain(
      'data-alert-day="2026-11-15"',
    );
    // A board that cannot be told (no handler): every alert is read.
    expect(renderDash({ onShowDay: null })).not.toMatch(
      /<button[^>]*data-dispatch-dashboard-alert=/,
    );
    expect(DASH).toContain('onClick={() => onShowDay(day)}');
  });

  it('draws «جدول التسليم» — ten columns, a count on each one that has one, the pound in its title', () => {
    const html = renderDash();
    const columns = [...html.matchAll(/data-dispatch-schedule="([^"]+)" data-count="(\d+)"/g)].map(
      (m) => `${m[1]}=${m[2]}`,
    );
    expect(columns).toEqual([
      'overdue=1',
      'today=2',
      'day:2026-11-15=0',
      'day:2026-11-16=0',
      'day:2026-11-17=0',
      'day:2026-11-18=0',
      'day:2026-11-19=0',
      'day:2026-11-20=0',
      'day:2026-11-21=0',
      'later=1',
    ]);
    expect(html).toContain(
      `aria-label="${ar('operations.secured.dashboard.schedule.bar', {
        label: 'اليوم 11-14',
        count: '2',
        egp: '1,500,000',
      })}"`,
    );
    // The row with no delivery day has no column, and is said under them.
    expect(html).toContain('data-dispatch-schedule-undated="1"');
    // One hue — the brand's — for one measure.
    expect(DASH).toContain('bg-brand-600 dark:bg-brand-500');
  });

  it('draws «مدة البقاء في الخزينة» — four buckets, 00:30 Cairo today counted today', () => {
    const html = renderDash();
    const order = [...html.matchAll(/data-dispatch-aging="([a-z0-9]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['today', 'days1to2', 'days3to6', 'days7plus']);
    const count = (bucket: string): string => textAt(html, `data-dispatch-aging-count="${bucket}"`);
    expect([count('today'), count('days1to2'), count('days3to6'), count('days7plus')]).toEqual([
      '1',
      '4',
      '0',
      '0',
    ]);
  });

  it('draws «بيان الشحنات لكل بنك» over the rows shown, «إجمالي قيمة الشحنات» beside it', () => {
    const html = renderDash();
    const rows = bodyRows(html).map(cells);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ['1', 'الأهلي', '3'],
      ['2', 'مصر', '2'],
      ['', 'الإجمالي', '5'],
    ]);
    expect(rows.at(-1)?.slice(3, 9)).toEqual(['6,500,000', '75,000', '20,000', '11', '3', '1']);
    expect(html).toContain('data-report-total="true"');
    expect(html.indexOf('data-report-table')).toBeLessThan(html.indexOf('data-vault-value="true"'));
    expect(DASH).toContain("import { ReportExportPair, ReportTable } from './ReportBoard';");
  });

  it('offers Excel and PDF of the table and its panel', () => {
    const html = renderDash();
    expect(buttonWith(html, 'data-report-export-excel="true"')).not.toContain('disabled=""');
    expect(buttonWith(html, 'data-report-export-pdf="true"')).not.toContain('disabled=""');
    expect(DASH).toContain('withValuePanel: true,');
  });

  it('keeps every frame at zero when no row is shown — «على الاقل الاشكال موجودة»', () => {
    const html = renderDash({ rows: [] });
    for (const name of ['count', 'egp', 'usd', 'others', 'bags', 'cartons', 'boxes'])
      expect(tile(html, name)).toBe('0');
    for (const name of ['filters', 'alerts', 'schedule', 'aging', 'banks'])
      expect(html).toContain(`data-dispatch-dashboard-section="${name}"`);
    expect(html.match(/data-dispatch-schedule="/g)).toHaveLength(10);
    expect(html.match(/data-dispatch-aging="/g)).toHaveLength(4);
    expect(html).toContain(ar('operations.secured.dispatch.emptyAll'));
    expect(html).not.toMatch(/<button[^>]*data-dispatch-dashboard-alert=/);
    // Over a filter, an empty table says the filter may be why.
    expect(
      renderDash({ rows: [], filters: { ...EMPTY_DAY_BOARD_FILTERS, bank: 'مصر' } }),
    ).toContain(ar('operations.secured.dashboard.banksEmpty'));
  });
});

describe('the line at the top — the board’s filters in force', () => {
  it('says there is none, and offers no reset', () => {
    const html = renderDash();
    expect(html).toContain(ar('operations.secured.dashboard.filters.none'));
    expect(ar('operations.secured.dashboard.filters.none')).toBe('كل المحصنات بالخزينة — بلا فلتر');
    expect(html).not.toContain('data-dispatch-dashboard-reset');
  });

  it('names each filter as its box does, the day isolated, with the reset', () => {
    const html = renderDash({
      filters: { ...EMPTY_DAY_BOARD_FILTERS, bank: 'الأهلي', stage: 'inVault' },
      date: '2026-11-15',
    });
    const chips = [
      ...html.matchAll(/data-dispatch-dashboard-filter="([a-z]+)"[^>]*>([^<]*)</g),
    ].map((m) => `${m[1]}|${m[2]}`);
    expect(chips).toEqual([
      `bank|${ar('operations.board.bank')}: الأهلي`,
      `date|${ar('operations.shipment.deliveryDate')}: ⁦2026-11-15⁩`,
      `stage|${ar('operations.common.status')}: ${ar('operations.board.stage.inVault')}`,
    ]);
    expect(buttonWith(html, 'data-dispatch-dashboard-reset="true"')).toContain(
      ar('operations.secured.dashboard.filters.reset'),
    );
    // No way to reset the board from here: no reset drawn.
    expect(
      renderDash({
        filters: { ...EMPTY_DAY_BOARD_FILTERS, bank: 'الأهلي' },
        onClearFilters: null,
      }),
    ).not.toContain('data-dispatch-dashboard-reset');
  });
});
