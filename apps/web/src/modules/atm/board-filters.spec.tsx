// The bank and area filters on both live boards — «الفلتر بتاع البنك والمنطقة اتأكد إنه شغال».
//
// The cache layer, over a real QueryClient and the very query function the boards run:
//   · the board is read WHOLE — every row past the hundredth — in ONE request to the board read
//     (`GET …/board`, 2026-11), never the page walk it replaced, with the filters sent as the API
//     reads them (a bank name holding a comma arrives whole) and TanStack's signal on the request;
//   · a realtime signal for the kind refreshes that whole board — one request — and its dropdowns;
//   · a bank tick keeps the bank list on offer while the new banks' areas load, and never offers
//     the previous selection's areas for the new one.
// The screens, rendered:
//   · every row of a board past one page is on the screen, in its two groups;
//   · a board read cut at its cap says so;
//   · an area chosen with no bank, and a name holding a comma, reach the board they name;
//   · a filter matching nothing says so, instead of leaving an empty table that looks unfiltered.
// When a bank change prunes its orphaned areas is `lib/board-filters.spec.ts`.
//
// Every code, bank and area below is synthetic.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AtmMaintenanceDto,
  type AtmOpenBoardDto,
  type AtmOperationFacetsDto,
  type AtmReplenishmentDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { keysForTopic } from '../../platform/realtime/invalidation-registry';
import { ReplenishmentsPage } from './pages/ReplenishmentsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import {
  atmBoardFacetsQueries,
  atmBoardKeys,
  atmOpenBoardQueries,
  type AtmBoardFilters,
} from './api/atm-queries';
import { boardFilterLists, facetsState, withBoardFilter } from './lib/board-filters';
import type * as AtmApiModule from './api/atm-api';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

type Kind = 'replenishments' | 'maintenances';
type Row = AtmReplenishmentDto & AtmMaintenanceDto;

/** What the mocked endpoints hold, and every request they were sent. */
let served: Row[] = [];
const asked: {
  kind: Kind;
  endpoint: 'board' | 'page';
  params: Record<string, unknown>;
  signal: AbortSignal | undefined;
}[] = [];

/** The rows of `served` a filter matches, the way the API filters them. */
const matching = (params: Record<string, unknown>): Row[] => {
  const banks = typeof params.banks === 'string' ? params.banks : undefined;
  const areas = typeof params.areas === 'string' ? params.areas : undefined;
  return served.filter(
    (row) =>
      (banks === undefined || banks.replace(/\\,/g, ',') === row.bankName) &&
      (areas === undefined || areas === row.area),
  );
};

/** The board read over `served`: every matching row, in one answer. */
const boardAnswer = (
  kind: Kind,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<AtmOpenBoardDto<Row>> => {
  asked.push({ kind, endpoint: 'board', params, signal });
  const items = matching(params);
  return Promise.resolve({ items, truncated: false, totalItems: items.length });
};

/** The paged list over `served` — the boards must not walk it any more; a call is recorded. */
const pageAnswer = (kind: Kind, params: Record<string, unknown>): Promise<Paginated<Row>> => {
  asked.push({ kind, endpoint: 'page', params, signal: undefined });
  const rows = matching(params);
  const page = Number(params.page);
  const pageSize = Number(params.pageSize);
  return Promise.resolve({
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: {
      page,
      pageSize,
      totalItems: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
    },
  });
};

/** Facets answers wait on this — a test holds it to look at the screen mid-request. */
let facetsGate: Promise<void> = Promise.resolve();

/** The facets endpoint over `served`: every open bank, and the areas of the chosen banks (or all). */
const facetsAnswer = async (banks: readonly string[]): Promise<AtmOperationFacetsDto> => {
  await facetsGate;
  const distinct = (names: string[]): string[] => [...new Set(names)].sort();
  return {
    banks: distinct(served.map((r) => r.bankName)),
    areas: distinct(
      served.filter((r) => banks.length === 0 || banks.includes(r.bankName)).map((r) => r.area),
    ),
  };
};

vi.mock('./api/atm-api', async () => {
  const actual = await vi.importActual<typeof AtmApiModule>('./api/atm-api');
  return {
    ...actual,
    replenishmentBoard: (params: Record<string, unknown>, signal?: AbortSignal) =>
      boardAnswer('replenishments', params, signal),
    maintenanceBoard: (params: Record<string, unknown>, signal?: AbortSignal) =>
      boardAnswer('maintenances', params, signal),
    listOpenReplenishments: (params: Record<string, unknown>) =>
      pageAnswer('replenishments', params),
    listOpenMaintenances: (params: Record<string, unknown>) => pageAnswer('maintenances', params),
    replenishmentFacets: (banks: readonly string[]) => facetsAnswer(banks),
    maintenanceFacets: (banks: readonly string[]) => facetsAnswer(banks),
  };
});

afterEach(() => {
  served = [];
  asked.length = 0;
  facetsGate = Promise.resolve();
});

const t = (key: string): string => translate('ar', key);

const TODAY = new Date().toISOString();
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

const row = (n: number, bankName: string, area: string, openedAt = TODAY): Row => ({
  id: `6500000000000000000${String(n).padStart(5, '0')}`,
  branchId: '650000000000000000000104',
  machineId: `6500000000000000000b${String(n).padStart(4, '0')}`,
  machineCode: `9999${String(n).padStart(4, '0')}`,
  bankName,
  machineName: `SYN ${String(n)}`,
  zone: '',
  area,
  openedAt,
  closedAt: null,
  leaderName: null,
  openedByName: 'SYN OPERATOR',
  closedByName: null,
  version: 1,
  createdAt: openedAt,
  updatedAt: openedAt,
  scheduleTime: null,
  serviceType: null,
  notes: null,
  referenceNumber: null,
  source: 'manual',
  mailTicketId: null,
  leaderEmployeeId: null,
});

/** 130 open rows — more than one page — 120 of them today, ten carried over. */
const busyDay = (): Row[] =>
  Array.from({ length: 130 }, (_unused, i) =>
    row(
      i + 1,
      i < 110 ? 'SYN NBE' : 'SYN Bank, Ltd',
      i % 2 === 0 ? 'SYN Smouha' : 'SYN Miami',
      i >= 120 ? THREE_DAYS_AGO : TODAY,
    ),
  );

const NONE: AtmBoardFilters = { banks: [], areas: [] };

/** One kind's whole-board query, typed over both kinds' rows. */
const boardOf = (
  kind: Kind,
  filters: AtmBoardFilters,
): {
  queryKey: readonly unknown[];
  queryFn: (context: { signal?: AbortSignal }) => Promise<AtmOpenBoardDto<Row>>;
} =>
  atmOpenBoardQueries[kind](filters) as unknown as {
    queryKey: readonly unknown[];
    queryFn: (context: { signal?: AbortSignal }) => Promise<AtmOpenBoardDto<Row>>;
  };

describe.each(['replenishments', 'maintenances'] as const)('the %s board, in the cache', (kind) => {
  it('is read whole — past one page — in ONE request to the board read, never the walk', async () => {
    served = busyDay();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const board = await qc.fetchQuery(boardOf(kind, NONE));
    expect(board.items).toHaveLength(130);
    expect(new Set(board.items.map((r) => r.id)).size).toBe(130);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.endpoint).toBe('board');
    expect(asked[0]?.kind).toBe(kind);
    // No pages to ask for: the board read takes the filters and nothing else.
    expect(asked[0]?.params).toEqual({});
    // TanStack's signal rides the request, so a superseded refresh stops on the wire.
    expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends a bank name holding a comma as ONE name', async () => {
    served = busyDay();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const board = await qc.fetchQuery(boardOf(kind, { banks: ['SYN Bank, Ltd'], areas: [] }));
    expect(board.items).toHaveLength(20);
    expect(asked.map((call) => call.params.banks)).toEqual(['SYN Bank\\, Ltd']);
    expect(asked[0]?.params).not.toHaveProperty('areas');
  });

  it('an area chosen alone narrows across banks', async () => {
    served = busyDay();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const board = await qc.fetchQuery(boardOf(kind, { banks: [], areas: ['SYN Smouha'] }));
    expect(board.items).toHaveLength(65);
    expect(new Set(board.items.map((r) => r.bankName))).toEqual(
      new Set(['SYN NBE', 'SYN Bank, Ltd']),
    );
  });

  it('a realtime signal for the kind refreshes the whole board and its dropdowns', async () => {
    const topic = kind === 'replenishments' ? 'atm.replenishment' : 'atm.maintenance';
    const prefixes = keysForTopic(topic);
    const under = (key: readonly unknown[]): boolean =>
      prefixes.some((prefix) => prefix.every((part, i) => key[i] === part));
    expect(under(atmBoardKeys.open(kind, NONE))).toBe(true);
    expect(under(atmBoardKeys.facets(kind, []))).toBe(true);

    served = busyDay();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(qc, boardOf(kind, NONE));
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.items).toHaveLength(130));

    // Someone else closes the first row and opens another — on the far side of the page boundary.
    served = [...served.slice(1), row(500, 'SYN NBE', 'SYN Agami')];
    asked.length = 0;
    for (const queryKey of prefixes) await qc.invalidateQueries({ queryKey });
    const items = observer.getCurrentResult().data?.items ?? [];
    expect(items).toHaveLength(130);
    expect(items.some((r) => r.machineCode === '99990500')).toBe(true);
    expect(items.some((r) => r.machineCode === '99990001')).toBe(false);
    // One refresh, one request — the walk read every page again, a find and a count each.
    expect(asked.filter((call) => call.endpoint === 'board')).toHaveLength(1);
    expect(asked.filter((call) => call.endpoint === 'page')).toEqual([]);
    stop();
  });

  it('a bank tick keeps every bank on offer while its areas load, and never the old areas', async () => {
    // Agami is open only under the second bank: offered with no bank chosen, not under NBE.
    served = [...busyDay(), row(600, 'SYN Bank, Ltd', 'SYN Agami')];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver<AtmOperationFacetsDto>(qc, atmBoardFacetsQueries[kind]([]));
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(observer.getCurrentResult().data?.areas).toContain('SYN Agami');

    let release = (): void => undefined;
    facetsGate = new Promise((resolve) => {
      release = resolve;
    });
    const chosen = { banks: ['SYN NBE'], areas: [] };
    observer.setOptions(atmBoardFacetsQueries[kind](chosen.banks));
    const loading = observer.getCurrentResult();
    const whileLoading = boardFilterLists(loading, chosen);
    expect(whileLoading.bankOptions.map((o) => o.value)).toEqual(['SYN Bank, Ltd', 'SYN NBE']);
    expect(whileLoading.areaOptions).toEqual([]);
    expect(whileLoading.areasLoading).toBe(true);
    // And nothing is pruned against the previous selection's list.
    expect(facetsState(loading)).toEqual({ status: 'loading' });

    release();
    await vi.waitFor(() => expect(observer.getCurrentResult().isPlaceholderData).toBe(false));
    const settled = observer.getCurrentResult();
    expect(boardFilterLists(settled, chosen).areaOptions.map((o) => o.value)).toEqual([
      'SYN Miami',
      'SYN Smouha',
    ]);
    expect(facetsState(settled)).toEqual({
      status: 'ready',
      facets: { banks: ['SYN Bank, Ltd', 'SYN NBE'], areas: ['SYN Miami', 'SYN Smouha'] },
    });
    stop();
  });
});

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const KEYS: Record<Kind, string[]> = {
  replenishments: ['atmReplenishment.view', 'atmReplenishment.complete'],
  maintenances: ['atmMaintenance.view', 'atmMaintenance.complete'],
};

/** The board read's answer for `items` — cut at its cap when `totalItems` says more are open. */
const page = (items: Row[], totalItems = items.length): AtmOpenBoardDto<Row> => ({
  items,
  truncated: totalItems > items.length,
  totalItems,
});

/** One board, as the screen draws it from a cache already holding its answer. */
const renderBoard = (
  kind: Kind,
  {
    search = '',
    filters = NONE,
    rows,
    totalItems = rows.length,
    offered = { banks: [], areas: [] },
  }: {
    search?: string;
    filters?: AtmBoardFilters;
    rows: Row[];
    /** How many rows the board read says are open — more than `rows` is a read cut at its cap. */
    totalItems?: number;
    offered?: { banks: string[]; areas: string[] };
  },
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(atmBoardKeys.open(kind, filters), page(rows, totalItems));
  qc.setQueryData(atmBoardKeys.facets(kind, filters.banks), offered);
  const Board = kind === 'replenishments' ? ReplenishmentsPage : MaintenancePage;
  const path = kind === 'replenishments' ? '/atm/replenishments' : '/atm/maintenance';
  return renderToStaticMarkup(
    <Provider store={store(KEYS[kind])}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`${path}${search === '' ? '' : `?${search}`}`]}>
          <Board />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The trigger of one filter, from its button to the end of it. */
const trigger = (markup: string, label: string): string => {
  const at = markup.indexOf(`aria-label="${label}"`);
  expect(at, `the ${label} filter is rendered`).toBeGreaterThan(-1);
  return markup.slice(at, markup.indexOf('</button>', at));
};

describe.each(['replenishments', 'maintenances'] as const)('the %s screen', (kind) => {
  const emptyToday =
    kind === 'replenishments' ? 'atm.replenishments.empty.today' : 'atm.maintenance.empty.today';
  const today = (rows: Row[]): Row[] => rows.filter((r) => r.openedAt === TODAY);
  const earlier = (rows: Row[]): Row[] => rows.filter((r) => r.openedAt !== TODAY);

  it('shows every row of a board past one page — one day view at a time', () => {
    const rows = busyDay();
    const onToday = renderBoard(kind, { rows });
    for (const r of today(rows)) expect(onToday).toContain(`>${r.machineCode}<`);
    expect(onToday).not.toContain('>99990121<');
    const onEarlier = renderBoard(kind, { search: 'day=earlier', rows });
    for (const r of earlier(rows)) expect(onEarlier).toContain(`>${r.machineCode}<`);
    expect(onEarlier).not.toContain('>99990001<');
  });

  it('a board whole says nothing about a cap; a board cut at it says how far it runs', () => {
    const rows = busyDay();
    expect(renderBoard(kind, { rows })).not.toContain('data-board-cut-short');
    const cut = renderBoard(kind, { rows, totalItems: 5200 });
    expect(cut).toContain('data-board-cut-short="true"');
    expect(cut).toContain(t('atm.common.boardCutShort').split('{{')[0] ?? '');
    // Arabic-Indic digits in the Arabic screen: the board's total and what is shown of it.
    expect(cut).toContain('٥٬٢٠٠');
    expect(cut).toContain('١٣٠');
  });

  it('an area chosen with no bank reaches its board, and the trigger counts the choice', () => {
    const rows = busyDay().filter((r) => r.area === 'SYN Smouha');
    const markup = renderBoard(kind, {
      search: 'areas=SYN+Smouha',
      filters: { banks: [], areas: ['SYN Smouha'] },
      rows,
      offered: { banks: ['SYN Bank, Ltd', 'SYN NBE'], areas: ['SYN Miami', 'SYN Smouha'] },
    });
    for (const r of today(rows)) expect(markup).toContain(`>${r.machineCode}<`);
    expect(trigger(markup, t('atm.common.area'))).toContain('>1</span>');
    expect(trigger(markup, t('atm.common.bank'))).not.toContain('>1</span>');
  });

  it('reads a bank name holding a comma from the address bar as one bank', () => {
    const rows = busyDay().filter((r) => r.bankName === 'SYN Bank, Ltd');
    const search = withBoardFilter(new URLSearchParams(), 'banks', ['SYN Bank, Ltd']).toString();
    const markup = renderBoard(kind, {
      search,
      filters: { banks: ['SYN Bank, Ltd'], areas: [] },
      rows,
    });
    expect(rows).toHaveLength(20);
    for (const r of today(rows)) expect(markup).toContain(`>${r.machineCode}<`);
    expect(trigger(markup, t('atm.common.bank'))).toContain('>1</span>');
  });

  it('says so when the filters match nothing — never an empty table that looks unfiltered', () => {
    // A remembered area the chosen bank has no open row in: kept, counted, and explained.
    const markup = renderBoard(kind, {
      search: 'banks=SYN+CIB&areas=SYN+Sidi+Gaber',
      filters: { banks: ['SYN CIB'], areas: ['SYN Sidi Gaber'] },
      rows: [],
      offered: { banks: ['SYN CIB', 'SYN NBE'], areas: ['SYN Miami'] },
    });
    expect(markup).toContain(t('atm.common.emptyFiltered'));
    expect(markup).not.toContain(t(emptyToday));
    expect(trigger(markup, t('atm.common.area'))).toContain('>1</span>');
  });

  it('keeps its own empty message for an unfiltered board with nothing open', () => {
    const markup = renderBoard(kind, { rows: [] });
    expect(markup).toContain(t(emptyToday));
    expect(markup).not.toContain(t('atm.common.emptyFiltered'));
  });
});

describe('the filtered-empty message', () => {
  it('exists in both languages', () => {
    expect(translate('en', 'atm.common.emptyFiltered')).toBe(
      'No open operation matches the chosen bank or area.',
    );
    expect(translate('ar', 'atm.common.emptyFiltered')).toBe(
      'لا توجد عمليات مفتوحة تطابق البنك أو المنطقة المختارة.',
    );
  });
});
