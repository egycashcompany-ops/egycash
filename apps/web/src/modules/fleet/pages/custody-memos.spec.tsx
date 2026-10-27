// «المذكرات» — the custody screen's memos tab, and a memo's paper seen from its row («معاينة
// المذكرة»). Rendered to markup against a seeded cache, as every Fleet screen spec: the rows (number,
// typed or muted name, kind, period, count, total, status), the row's four actions and the lock a
// replenishment puts on two of them, the filters the request carries, the strip's figures (the
// server's, never the rows'), the banner of receipts no memo holds yet, the toolbar per grant, the
// phone's cards — and the view dialog's header, facts and paper.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyMemoDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyMemoTotalsDto,
  type FleetCustodyOutsideKindDto,
  type Locale,
  type MeDto,
  type Paginated,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { type FleetListParams } from '../api/fleet-api';
import { custodyFundKey, custodyQueryKeys } from '../api/fleet-queries';
import { CustodyMemosPage } from './CustodyMemosPage';
import { CustodyMemoPaperView } from '../components/CustodyMemoPaperView';

// `Dialog` portals into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
/** Markup to words, the way a reader sees them. */
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();

const ALL_GRANTS = [
  'fleetCustody.view',
  'fleetReceipt.create',
  'fleetReceipt.edit',
  'fleetReceipt.delete',
];

const me = (grants: readonly string[]): MeDto =>
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
    permissions: Object.fromEntries(grants.map((grant) => [grant, 'organization'])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const memo = (over: Partial<FleetCustodyMemoRowDto> = {}): FleetCustodyMemoRowDto => ({
  id: '650000000000000000000006',
  no: 6,
  kind: 'wash',
  name: '',
  date: '2026-09-30',
  from: '2026-09-07',
  to: '2026-09-28',
  receipts: 4,
  total: 600,
  replenishment: null,
  version: 0,
  createdAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:00:00.000Z',
  ...over,
});
/** Memo 6 unnamed and waiting; memo 2 named and replenished on 29/09. */
const ROWS: FleetCustodyMemoRowDto[] = [
  memo(),
  memo({
    id: '650000000000000000000002',
    no: 2,
    kind: 'tyres',
    name: 'كاوتش النصف الثاني من سبتمبر',
    from: '2026-09-16',
    to: '2026-09-27',
    receipts: 6,
    total: 960,
    replenishment: { id: '660000000000000000000001', date: '2026-09-29' },
  }),
];
const paged = (items: FleetCustodyMemoRowDto[]): Paginated<FleetCustodyMemoRowDto> => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});
/** Twelve memos the filters match — more than the two rows on this page. */
const TOTALS: FleetCustodyMemoTotalsDto = { count: 12, receipts: 140, total: 98_765.5 };
const OUTSIDE: FleetCustodyOutsideKindDto[] = [
  {
    kind: 'maintenance',
    count: 3,
    total: 5720,
    oldest: '2026-10-06',
    stale: { count: 0, total: 0 },
  },
  { kind: 'fuel', count: 8, total: 7876, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
  { kind: 'tyres', count: 0, total: 0, oldest: null, stale: { count: 0, total: 0 } },
  { kind: 'wash', count: 4, total: 600, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
];
const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 1000,
  charged: { count: 1, amount: 100_000 },
  spent: { count: 10, amount: 99_000 },
  replenished: { count: 0, amount: 0, memos: 0 },
  settled: { count: 0, amount: 0, parts: 0 },
  operations: 1,
  memos: { count: 6, pending: 1, pendingTotal: 600 },
  outside: OUTSIDE,
};

/** What the page asks for at its default address — `no:desc`, page 1 of 25. */
const DEFAULT_PARAMS: FleetListParams = {
  page: 1,
  pageSize: 25,
  sortBy: 'no',
  sortDir: 'desc',
  sort: 'no:desc',
};

const store = (grants: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(grants), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const draw = ({
  path = '/fleet/custody/memos',
  grants = ALL_GRANTS,
  rows = ROWS,
  params = DEFAULT_PARAMS,
  filters = {},
  totals = TOTALS,
  outside = OUTSIDE,
}: {
  path?: string;
  grants?: readonly string[];
  rows?: FleetCustodyMemoRowDto[];
  params?: FleetListParams;
  filters?: FleetListParams;
  totals?: FleetCustodyMemoTotalsDto;
  outside?: FleetCustodyOutsideKindDto[];
} = {}): string => {
  const qc = client();
  qc.setQueryData(custodyFundKey, FUND);
  qc.setQueryData(custodyQueryKeys.memos({ ...params, ...filters }), paged(rows));
  qc.setQueryData(custodyQueryKeys.memoTotals(filters), totals);
  qc.setQueryData(custodyQueryKeys.memosOutside(), outside);
  return renderToStaticMarkup(
    <Provider store={store(grants)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <CustodyMemosPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** One table row's markup, by memo number. */
const row = (html: string, no: number): string => {
  const at = html.indexOf(`data-memo-row="${no}"`);
  expect(at, `row ${no}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', at);
  return html.slice(start, html.indexOf('</tr>', at));
};
/** The row-actions box inside a piece of markup. */
const actionsBox = (part: string): string => {
  const at = part.indexOf('data-row-actions="custody-memo"');
  expect(at).toBeGreaterThan(-1);
  return part.slice(part.lastIndexOf('<span', at));
};
/** The four actions, in order, as their marks say. */
const actionOrder = (box: string): string[] =>
  [
    ...box.matchAll(
      /data-(memo-view-open|memo-edit|memo-print|memo-delete|locked-action)="([^"]+)"/gu,
    ),
  ].map((m) => (m[1] === 'locked-action' ? `locked:${m[2] ?? ''}` : (m[1] ?? '')));

describe('«المذكرات» — the rows', () => {
  const html = draw();

  it('opens on the tabs, then the board', () => {
    expect(html).toContain('data-custody-tabs="true"');
    expect(html).toContain('data-custody-memos="true"');
    expect(html.indexOf('data-custody-tabs')).toBeLessThan(html.indexOf('data-custody-memos'));
  });

  it('draws each memo: its number chip, its name, its kind, its period, its count and total, its status', () => {
    const six = row(html, 6);
    expect(text(six)).toContain('6');
    expect(six).toContain('data-custody-kind="wash"');
    expect(six).toContain('data-dates="stack"');
    expect(six).toContain('2026/09/07');
    expect(six).toContain('2026/09/28');
    expect(six).toContain('600.00');
    expect(six).toContain('data-status="memo-pending"');
    const two = row(html, 2);
    expect(two).toContain('data-custody-kind="tyres"');
    expect(two).toContain('data-status="memo-replenished"');
    expect(two).toContain('href="/fleet/custody/log?open=660000000000000000000001"');
    expect(two).toContain('2026/09/29');
  });

  it('names a memo by what he typed — and an unnamed one «مذكرة <النوع> رقم N», muted', () => {
    const six = row(html, 6);
    expect(six).toContain('data-memo-name="fallback"');
    expect(text(six)).toContain(
      ar('fleet.custody.parts.memoFallback', { kind: ar('fleet.custody.source.wash'), no: 6 }),
    );
    const two = row(html, 2);
    expect(two).toContain('data-memo-name="typed"');
    expect(text(two)).toContain('كاوتش النصف الثاني من سبتمبر');
  });

  it('offers the eye, the pen, the printer and the bin, in that order', () => {
    expect(actionOrder(actionsBox(row(html, 6)))).toEqual([
      'memo-view-open',
      'memo-edit',
      'memo-print',
      'memo-delete',
    ]);
    expect(row(html, 6)).toContain('href="/fleet/custody/memos/650000000000000000000006"');
  });

  it('locks a replenished memo’s pen and bin in place, each saying why on a span that shows it', () => {
    const box = actionsBox(row(html, 2));
    expect(actionOrder(box)).toEqual([
      'memo-view-open',
      'locked:custody-memo-edit',
      'memo-print',
      'locked:custody-memo-delete',
    ]);
    expect(box).toContain(`title="${ar('fleet.custody.memos.lockedEdit')}"`);
    expect(box).toContain(`title="${ar('fleet.custody.memos.lockedDelete')}"`);
    expect(box).not.toContain('href="/fleet/custody/memos/650000000000000000000002"');
    expect(box.match(/disabled=""/gu)).toHaveLength(2);
  });

  it('shows the pen and the bin only to whoever may edit and delete custody receipts', () => {
    const viewer = draw({ grants: ['fleetCustody.view'] });
    expect(actionOrder(actionsBox(row(viewer, 6)))).toEqual(['memo-view-open', 'memo-print']);
    expect(actionOrder(actionsBox(row(viewer, 2)))).toEqual(['memo-view-open', 'memo-print']);
  });

  it('centres every column and orders by the number only', () => {
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    for (const key of ['no', 'name', 'kind', 'period', 'receipts', 'total', 'status']) {
      expect(text(head)).toContain(ar(`fleet.custody.memos.columns.${key}`));
    }
    expect(source('CustodyMemosPage.tsx')).toContain("const DEFAULT_SORT = 'no:desc';");
  });

  it('draws one card per memo on a phone', () => {
    const cards = html.slice(html.indexOf('data-memo-cards="true"'));
    expect(cards).toContain('data-memo-card="6"');
    expect(cards).toContain('data-memo-card="2"');
  });

  it('says so when no memo matches', () => {
    const empty = draw({ rows: [], totals: { count: 0, receipts: 0, total: 0 } });
    expect(text(empty)).toContain(ar('fleet.custody.memos.empty'));
    expect(empty).not.toContain('data-memo-row=');
  });
});

describe('«المذكرات» — the filters and the figures', () => {
  it('asks the server for the period, the kinds (only real ones), the status and the order in the address', () => {
    const filters = {
      from: '2026-09-01',
      to: '2026-09-30',
      kind: ['tyres', 'fuel'],
      status: 'pending',
    };
    const html = draw({
      path: '/fleet/custody/memos?from=2026-09-01&to=2026-09-30&kind=tyres,bogus,fuel&status=pending&sort=no:asc',
      params: { page: 1, pageSize: 25, sortBy: 'no', sortDir: 'asc', sort: 'no:asc' },
      filters,
    });
    // Seeded under exactly that question: the rows are there only if the page asked it.
    expect(html).toContain('data-memo-row="6"');
    expect(html).toContain('data-memos-count="true"');
  });

  it('drops a status that is neither of the two', () => {
    const html = draw({ path: '/fleet/custody/memos?status=whatever' });
    expect(html).toContain('data-memo-row="6"');
  });

  it('counts the toolbar and the strip over every memo the filters match — the server’s, not the rows’', () => {
    const html = draw();
    const strip = html.slice(html.indexOf('data-memos-figures="true"'));
    expect(text(strip.slice(0, strip.indexOf('</span></span>') + 14))).toContain('98,765.50');
    expect(html).toMatch(/data-memos-count="true"[^>]*>[^<]*/u);
    // Two rows on the page, twelve in the set: the strip says twelve.
    const page = source('CustodyMemosPage.tsx');
    expect(page).not.toMatch(/rows\.reduce/u);
    expect(page).toContain('useCustodyMemoTotals(filters)');
  });

  it('keeps its filters, its page size and its order — never the page', () => {
    expect(source('CustodyMemosPage.tsx')).toContain(
      "const REMEMBERED_FILTERS = ['from', 'to', 'kind', 'status', 'size', 'sort'] as const;",
    );
  });

  it('draws the period with the custody board’s own date boxes, the kinds and the status as clearable multi-selects', () => {
    const page = source('CustodyMemosPage.tsx');
    const bar = page.slice(page.indexOf('<FilterBar'), page.indexOf('</FilterBar>'));
    expect(bar).not.toContain('<DateBound');
    expect(bar).toContain("dateBound('fleet.receipts.filters.from', from, 'from')");
    expect(bar.match(/<MultiSelect\s+clearable/gu)).toHaveLength(2);
    expect(bar).toContain('FLEET_CUSTODY_MEMO_STATUSES.map(');
    expect(bar).toContain('pickOne(');
  });
});

describe('«إيصالات لم تدخل أي مذكرة بعد»', () => {
  it('shows each kind with receipts waiting, its count, its sum and its way into a new memo', () => {
    const html = draw();
    const banner = html.slice(html.indexOf('data-memos-outside="true"'));
    expect(banner).toContain('data-memos-outside-kind="maintenance"');
    expect(banner).toContain('data-memos-outside-kind="fuel"');
    expect(banner).toContain('data-memos-outside-kind="wash"');
    expect(banner).not.toContain('data-memos-outside-kind="tyres"');
    expect(banner).toContain('href="/fleet/custody/memos/new/fuel"');
    expect(banner).toContain('href="/fleet/custody/memos/new/wash"');
    expect(text(banner)).toContain('5,720.00');
    // 3 + 8 + 4 receipts, 14,196.00 in all.
    expect(text(banner)).toContain('14,196.00');
  });

  it('offers no way into a new memo without the grant to make one', () => {
    const html = draw({ grants: ['fleetCustody.view'] });
    expect(html).toContain('data-memos-outside="true"');
    expect(html).not.toContain('data-memos-outside-new=');
  });

  it('says nothing when every receipt is on a memo', () => {
    const html = draw({
      outside: OUTSIDE.map((line) => ({ ...line, count: 0, total: 0 })),
    });
    expect(html).not.toContain('data-memos-outside=');
  });
});

describe('«المذكرات» — the toolbar', () => {
  it('offers Excel and PDF, the set-up and a new memo to whoever may', () => {
    const html = draw();
    expect(html).toContain('data-export="custody-memos"');
    expect(html).toContain('data-print="custody-memos"');
    expect(html).toContain('href="/fleet/custody/memos/setup"');
    expect(html).toContain('data-custody-papers-setup="true"');
    expect(html).toContain('href="/fleet/custody/memos/new"');
  });

  it('keeps the set-up behind the edit grant and the new memo behind the create grant', () => {
    const viewer = draw({ grants: ['fleetCustody.view'] });
    expect(viewer).toContain('data-export="custody-memos"');
    expect(viewer).not.toContain('data-custody-papers-setup');
    expect(viewer).not.toContain('data-memo-new');
    const maker = draw({ grants: ['fleetCustody.view', 'fleetReceipt.create'] });
    expect(maker).toContain('data-memo-new="true"');
    expect(maker).not.toContain('data-custody-papers-setup');
  });

  it('prints a row through the one door, the tab first, then the memo read', () => {
    const page = source('CustodyMemosPage.tsx');
    const at = page.indexOf('const printMemo = ');
    const body = page.slice(at, page.indexOf('};', at));
    expect(body).toContain('printPaperAfter(');
    expect(body.indexOf('printPaperAfter(')).toBeLessThan(body.indexOf('fetchQuery('));
    expect(page).toContain("t('fleet.custody.papers.printing')");
  });

  it('sends a memo’s receipts back on delete, and names a refusal instead of the generic words', () => {
    const page = source('CustodyMemosPage.tsx');
    expect(page).toContain("t('fleet.custody.memos.deleteBody')");
    expect(page).toContain('memoRefusalOf(failure)');
    expect(page).toContain("'fleet.custody.memos.refusedDelete'");
  });
});

// ── «معاينة المذكرة» ─────────────────────────────────────────────────────────────────────────

const detail = (over: Partial<FleetCustodyMemoDto> = {}): FleetCustodyMemoDto => ({
  ...ROWS[1]!,
  lines: [
    {
      receiptId: '670000000000000000000001',
      date: '2026-09-16',
      vehicleId: '680000000000000000000001',
      vehicleCode: '248',
      driverEmployeeId: null,
      driverName: null,
      amount: 150,
      fuelType: null,
      litres: null,
      mission: '',
      statement: '',
      note: '',
    },
    {
      receiptId: '670000000000000000000002',
      date: '2026-09-27',
      vehicleId: '680000000000000000000002',
      vehicleCode: '177',
      driverEmployeeId: null,
      driverName: null,
      amount: 810,
      fuelType: null,
      litres: null,
      mission: '',
      statement: '',
      note: '',
    },
  ],
  signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.tyres,
  ...over,
});

const view = (memoDetail: FleetCustodyMemoDto): string => {
  const qc = client();
  qc.setQueryData(custodyQueryKeys.memo(memoDetail.id), memoDetail);
  return renderToStaticMarkup(
    <Provider store={store(ALL_GRANTS)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CustodyMemoPaperView memoId={memoDetail.id} onClose={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};
const heading = (html: string): { title: string; description: string } => {
  const head = html.slice(html.indexOf('<h2'), html.indexOf('data-memo-view='));
  const title = /<h2[^>]*>([\s\S]*?)<\/h2>/u.exec(head)?.[1] ?? '';
  const description = /<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/u.exec(head)?.[1] ?? '';
  return { title: text(title), description: text(description) };
};

describe('«معاينة المذكرة»', () => {
  it('is headed by the typed name, and says which memo it is', () => {
    const html = view(detail());
    expect(heading(html)).toEqual({
      title: 'كاوتش النصف الثاني من سبتمبر',
      description: `${ar('fleet.custody.papers.viewMemo')} — ${ar(
        'fleet.custody.parts.memoFallback',
        {
          kind: ar('fleet.custody.source.tyres'),
          no: 2,
        },
      )}`,
    });
  });

  it('heads an unnamed memo by its kind and number, and says it was saved without a name', () => {
    const html = view(detail({ name: '   ' }));
    expect(heading(html)).toEqual({
      title: ar('fleet.custody.parts.memoFallback', {
        kind: ar('fleet.custody.source.tyres'),
        no: 2,
      }),
      description: `${ar('fleet.custody.papers.viewMemo')} — ${ar('fleet.custody.parts.unnamed')}`,
    });
  });

  it('lays out its facts over the paper: kind, number, receipts, period, total, status', () => {
    const html = view(detail());
    const facts = html.slice(
      html.indexOf('data-memo-view-facts="true"'),
      html.indexOf('data-paper-tray'),
    );
    expect(facts).toContain('data-custody-kind="tyres"');
    expect(text(facts)).toContain(ar('fleet.custody.parts.memoNo', { no: 2 }));
    expect(facts).toContain('2026/09/16');
    expect(facts).toContain('960.00');
    expect(facts).toContain('data-status="memo-replenished"');
  });

  it('shows his paper, one tray page per sheet, with its lines — never the memo’s name', () => {
    const html = view(detail());
    const tray = html.slice(html.indexOf('data-paper-tray="memo-2"'));
    expect(tray).toContain('data-paper-page="memo-2:1"');
    expect(tray).toContain('data-paper-sheet="true"');
    expect(tray).toContain('248');
    expect(tray).toContain('177');
    expect(tray).not.toContain('كاوتش النصف الثاني من سبتمبر');
    expect(html).toContain(ar('fleet.custody.papers.printMemo'));
  });
});

const merged = translate('ar', 'fleet.custody.memos.title') !== 'fleet.custody.memos.title';

describe.skipIf(!merged)('every word «المذكرات» shows is in the dictionary', () => {
  it('has an Arabic and an English entry for each key it asks for', () => {
    const keys = [
      ...new Set(
        ['CustodyMemosPage.tsx', '../components/CustodyMemoPaperView.tsx'].flatMap((file) =>
          [...source(file).matchAll(/'(fleet\.[a-zA-Z.]+)'/gu)].map((m) => m[1] ?? ''),
        ),
      ),
    ].filter((key) => !key.endsWith('.'));
    expect(keys.length).toBeGreaterThan(30);
    const missing = keys.flatMap((key) =>
      (['ar', 'en'] as const)
        .filter((lang) => translate(lang, key) === key)
        .map((lang) => `${lang}:${key}`),
    );
    expect(missing).toEqual([]);
  });
});
