// «سجل العهدة» — the fund's own history, on his scenario: two charges, September's receipts, the
// 29/09 replenishment, the 05/10 settlement, October's receipts. The page is rendered to markup
// against a seeded query cache (the suite has no DOM); the drawer opens from the address
// (`?open=<id>`, `&letter=1`), exactly as a line's eye or printer opens it.
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
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyKindSpendDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationDto,
  type FleetCustodySource,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { formatMoneyParts } from '../../../shared/lib/format';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const { custodyQueryKeys } = await import('../api/fleet-queries');
const { CustodyLedgerPage } = await import('./CustodyLedgerPage');
const { readSorts, sortQuery } = await import('../lib/table-sort');
const { custodyPlural } = await import('../lib/custody-words');
const words = await import('../lib/custody-ledger-words');

const HERE = dirname(fileURLToPath(import.meta.url));
const STAMP = '2026-10-18T10:00:00.000Z';

// ── His scenario ─────────────────────────────────────────────────────────────────────────────

const spent = (
  counts: Partial<Record<FleetCustodySource, [number, number, number]>>,
): Record<FleetCustodySource, FleetCustodyKindSpendDto> =>
  Object.fromEntries(
    (['maintenance', 'fuel', 'tyres', 'wash'] as const).map((kind) => {
      const [count, amount, outside] = counts[kind] ?? [0, 0, 0];
      return [kind, { count, amount, outside }];
    }),
  ) as Record<FleetCustodySource, FleetCustodyKindSpendDto>;

const row = (over: Partial<FleetCustodyLedgerRowDto>): FleetCustodyLedgerRowDto => ({
  id: 'x',
  op: 'charge',
  date: '2026-09-01',
  dateTo: null,
  amount: 0,
  before: 0,
  after: 0,
  latest: false,
  reason: null,
  from: null,
  to: null,
  memos: null,
  licence: null,
  receipts: null,
  byKind: null,
  memoNos: null,
  ...over,
});

/** Newest first — the log as it opens. */
const ROWS: FleetCustodyLedgerRowDto[] = [
  row({
    id: 'spend:2026-10-06:2026-10-18',
    op: 'spend',
    date: '2026-10-06',
    dateTo: '2026-10-18',
    amount: -15286,
    before: 175260.54,
    after: 159974.54,
    latest: true,
    receipts: 29,
    byKind: spent({ tyres: [18, 1690, 18], fuel: [8, 7876, 8], maintenance: [3, 5720, 3] }),
    memoNos: [],
  }),
  row({
    id: 'op-s1',
    op: 'settle',
    date: '2026-10-05',
    amount: -124139.46,
    before: 299400,
    after: 175260.54,
    from: '2026-09-01',
    to: '2026-09-30',
    licence: { renewal: { count: 3, cars: 15 }, extension: { count: 0, cars: 0 } },
  }),
  row({
    id: 'op-c2',
    op: 'charge',
    date: '2026-10-05',
    amount: 200000,
    before: 99400,
    after: 299400,
    reason: '24 سياره تجديد + 23 سياره مد مده',
  }),
  row({
    id: 'op-r1',
    op: 'replenish',
    date: '2026-09-29',
    amount: 81908,
    before: 17492,
    after: 99400,
    from: '2026-09-01',
    to: '2026-09-30',
    memos: { count: 5, kinds: ['maintenance', 'fuel', 'tyres'] },
  }),
  row({
    id: 'spend:2026-09-01:2026-09-28',
    op: 'spend',
    date: '2026-09-01',
    dateTo: '2026-09-28',
    amount: -82508,
    before: 100000,
    after: 17492,
    receipts: 97,
    byKind: spent({
      maintenance: [14, 29414, 0],
      fuel: [55, 49844, 0],
      tyres: [24, 2650, 0],
      wash: [4, 600, 4],
    }),
    memoNos: [1, 2, 3, 4, 5],
  }),
  row({
    id: 'op-c1',
    op: 'charge',
    date: '2026-09-01',
    amount: 100000,
    before: 0,
    after: 100000,
    reason: 'تشغيل السيارات لشهر سبتمبر',
  }),
];

const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 159974.54,
  charged: { count: 2, amount: 300000 },
  spent: { count: 126, amount: 97794 },
  replenished: { count: 1, amount: 81908, memos: 5 },
  settled: { count: 1, amount: 124139.46, parts: 3 },
  operations: 4,
  memos: { count: 5, pending: 0, pendingTotal: 0 },
  outside: [
    {
      kind: 'maintenance',
      count: 3,
      total: 5720,
      oldest: '2026-10-06',
      stale: { count: 0, total: 0 },
    },
    { kind: 'fuel', count: 8, total: 7876, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
    { kind: 'tyres', count: 18, total: 1690, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
    { kind: 'wash', count: 4, total: 600, oldest: '2026-10-06', stale: { count: 0, total: 0 } },
  ],
};

const MEMO_SNAPSHOTS: FleetCustodyOperationDto['memos'] = [
  {
    memoId: 'm1',
    no: 1,
    kind: 'tyres',
    name: 'كاوتش النصف الأول من سبتمبر',
    from: '2026-09-01',
    to: '2026-09-15',
    receipts: 18,
    amount: 1690,
  },
  {
    memoId: 'm2',
    no: 2,
    kind: 'tyres',
    name: '',
    from: '2026-09-16',
    to: '2026-09-27',
    receipts: 6,
    amount: 960,
  },
  {
    memoId: 'm3',
    no: 3,
    kind: 'fuel',
    name: 'وقود سبتمبر',
    from: '2026-09-01',
    to: '2026-09-28',
    receipts: 55,
    amount: 49844,
  },
  {
    memoId: 'm4',
    no: 4,
    kind: 'maintenance',
    name: 'صيانة أول سبتمبر',
    from: '2026-09-04',
    to: '2026-09-13',
    receipts: 3,
    amount: 5720,
  },
  {
    memoId: 'm5',
    no: 5,
    kind: 'maintenance',
    name: 'صيانة آخر سبتمبر',
    from: '2026-09-15',
    to: '2026-09-27',
    receipts: 11,
    amount: 23694,
  },
];
const settledPart = (
  expenseId: string,
  date: string,
  visaTotal: number,
  cashTotal: number,
): FleetCustodyOperationDto['parts'][number] => ({
  expenseId,
  part: 'renewal',
  date,
  cars: 5,
  codes: ['150', '151', '153', '156', '160'],
  visaTotal,
  cashTotal,
  amount: Math.round((visaTotal + cashTotal) * 100) / 100,
});
const base = {
  reason: '',
  memos: [],
  parts: [],
  chargedTotal: 100000,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const OPERATIONS: Record<string, FleetCustodyOperationDto> = {
  'op-r1': {
    ...base,
    id: 'op-r1',
    kind: 'replenish',
    date: '2026-09-29',
    from: '2026-09-01',
    to: '2026-09-30',
    amount: 81908,
    memos: MEMO_SNAPSHOTS,
    fundBefore: 17492,
    letterFigure: 100000,
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.replenish,
    ledger: { before: 17492, after: 99400 },
  },
  'op-s1': {
    ...base,
    id: 'op-s1',
    kind: 'settle',
    date: '2026-10-05',
    from: '2026-09-01',
    to: '2026-09-30',
    amount: 124139.46,
    parts: [
      settledPart('lx1', '2026-09-08', 33450, 6282.19),
      settledPart('lx2', '2026-09-17', 30900, 5868.85),
      settledPart('lx3', '2026-09-28', 40125, 7513.42),
    ],
    fundBefore: 299400,
    chargedTotal: 300000,
    letterFigure: 299400,
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.settle,
    ledger: { before: 299400, after: 175260.54 },
  },
  'op-c2': {
    ...base,
    id: 'op-c2',
    kind: 'charge',
    date: '2026-10-05',
    from: null,
    to: null,
    amount: 200000,
    reason: '24 سياره تجديد + 23 سياره مد مده',
    fundBefore: 99400,
    letterFigure: null,
    signatures: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.charge,
    ledger: { before: 99400, after: 299400 },
  },
};

// ── Rendering ────────────────────────────────────────────────────────────────────────────────

const LIST = { page: 1, pageSize: 25, ...sortQuery(readSorts(null, 'date:desc')) };
const paged = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const client = (
  seed: {
    fund?: FleetCustodyFundSummaryDto;
    rows?: FleetCustodyLedgerRowDto[];
    filters?: Record<string, string | readonly string[]>;
    operations?: boolean;
  } = {},
): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  const filters = seed.filters ?? {};
  qc.setQueryData(custodyQueryKeys.fund(), seed.fund ?? FUND);
  qc.setQueryData(custodyQueryKeys.ledger({ ...filters, ...LIST }), paged(seed.rows ?? ROWS));
  qc.setQueryData(custodyQueryKeys.ledgerTotals(filters), { operations: 4, spendLines: 2 });
  qc.setQueryData(custodyQueryKeys.memosOutside(), FUND.outside);
  if (seed.operations !== false) {
    for (const [id, op] of Object.entries(OPERATIONS)) {
      qc.setQueryData(custodyQueryKeys.operation(id), op);
    }
  }
  return qc;
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

const page = (
  path = '/fleet/custody/log',
  qc: QueryClient = client(),
  permissions: readonly string[] = ['fleetCustody.view', 'fleetReceipt.create'],
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: { me: me(permissions), status: 'signedIn' as const },
          ui: { theme: 'light' as const, sidebarOpen: false },
        },
      })}
    >
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fleet/custody/log" element={<CustodyLedgerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
/** The element that carries `attr` — its opening tag to its matching close. */
const element = (html: string, attr: string): string => {
  const at = html.indexOf(attr);
  expect(at, attr).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/u.exec(html.slice(open))?.[1] ?? 'div';
  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'gu');
  re.lastIndex = open;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  return html.slice(open);
};
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const LATIN = new Intl.NumberFormat('en-US');
const count = (noun: string, n: number): string =>
  ar(`fleet.custody.count.${noun}.${custodyPlural('ar', n)}`, { count: LATIN.format(n) });
const figure = (value: number): string => formatMoneyParts(value, 'EGP', 'ar').figure;
const piastres = (value: number): number => Math.round(value * 100);

// ── The formula ──────────────────────────────────────────────────────────────────────────────

describe('«سجل العهدة» — the fund’s formula, as tiles', () => {
  it('charged − spent + replenished − settled IS the fund now', () => {
    const tiles = element(page(), 'data-ledger-figures="true"');
    const term = (name: string): number =>
      Number(
        new RegExp(
          `data-ledger-term="${name}"[\\s\\S]*?data-ledger-term-value="([^"]+)"`,
          'u',
        ).exec(tiles)?.[1],
      );
    expect(term('charged')).toBe(300000);
    expect(term('spent')).toBe(97794);
    expect(term('replenished')).toBe(81908);
    expect(term('settled')).toBe(124139.46);
    const now = Number(/data-ledger-fund-now="([^"]+)"/u.exec(tiles)?.[1]);
    expect(now).toBe(159974.54);
    expect(
      piastres(term('charged')) -
        piastres(term('spent')) +
        piastres(term('replenished')) -
        piastres(term('settled')),
    ).toBe(piastres(now));
    // Terms in their order, each with its sign.
    expect([...tiles.matchAll(/data-ledger-term="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'charged',
      'spent',
      'replenished',
      'settled',
    ]);
    expect(text(tiles)).toContain(`+${figure(300000)}`);
    expect(text(tiles)).toContain(`−${figure(97794)}`);
    expect(text(tiles)).toContain(ar('fleet.custody.ledger.tiles.formula'));
  });

  it('the tiles are the WHOLE history’s — the filters choose the lines, never the fund', () => {
    const filters = { from: '2026-10-01', op: ['settle'] };
    const html = page(
      '/fleet/custody/log?from=2026-10-01&op=settle',
      client({ filters, rows: [ROWS[1] as FleetCustodyLedgerRowDto] }),
    );
    expect(element(html, 'data-ledger-figures="true"')).toContain(
      'data-ledger-fund-now="159974.54"',
    );
    expect(html.match(/data-ledger-row="/gu)).toHaveLength(1);
    // The line keeps its place in the whole history: «بعدها» is still 175,260.54.
    expect(text(element(html, 'data-ledger-after="op-s1"'))).toContain(figure(175260.54));
  });

  it('a fund below zero is said in red, «−» before it', () => {
    const html = page('/fleet/custody/log', client({ fund: { ...FUND, fundTotal: -15286 } }));
    const now = element(html, 'data-ledger-fund-now="-15286"');
    expect(now).toContain('data-ledger-fund-negative="true"');
    expect(now).toContain('text-red-600');
    expect(text(now)).toContain(`−${figure(15286)}`);
  });
});

// ── The lines ────────────────────────────────────────────────────────────────────────────────

describe('«سجل العهدة» — the lines', () => {
  const html = page();
  const rowOf = (id: string): string => element(html, `data-ledger-row="${id}"`);

  it('every line, newest first, in the tabs’ frame with the fund’s actions', () => {
    expect(html).toContain('data-custody-tabs');
    expect(html).toContain('data-custody-ledger="true"');
    expect([...html.matchAll(/data-ledger-row="([^"]+)"/gu)].map((m) => m[1])).toEqual(
      ROWS.map((r) => r.id),
    );
    expect(html).toContain('data-custody-fund-actions="true"');
    expect(html).toContain('data-export="custody-ledger"');
    expect(html).toContain('data-print="custody-ledger"');
  });

  it('a receipts line is muted, its date two lines «… إلى …»', () => {
    const spend = rowOf('spend:2026-10-06:2026-10-18');
    expect(spend).toContain('bg-slate-50/80');
    expect(spend).toContain('data-ledger-date="span"');
    expect(text(spend)).toContain('2026/10/06');
    expect(text(spend)).toContain(`${ar('fleet.custody.parts.to')} 2026/10/18`);
    expect(rowOf('op-s1')).not.toContain('bg-slate-50/80');
    expect(rowOf('op-s1')).toContain('data-ledger-date="day"');
  });

  it('signs every amount: in emerald, out red', () => {
    expect(ROWS.map((r) => /data-ledger-amount="(in|out)"/u.exec(rowOf(r.id))?.[1])).toEqual([
      'out',
      'out',
      'in',
      'in',
      'out',
      'in',
    ]);
    expect(text(rowOf('op-s1'))).toContain(`−${figure(124139.46)}`);
    expect(text(rowOf('op-c2'))).toContain(`+${figure(200000)}`);
  });

  it('«الآن» on the last line of the whole history only — in the table and on its phone card', () => {
    const table = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(table.match(/data-ledger-now="true"/gu)).toHaveLength(1);
    expect(rowOf('spend:2026-10-06:2026-10-18')).toContain('data-ledger-now="true"');
    const cards = element(html, 'data-ledger-cards="true"');
    expect(cards.match(/data-ledger-now="true"/gu)).toHaveLength(1);
    expect(element(cards, 'data-ledger-card="spend:2026-10-06:2026-10-18"')).toContain(
      'data-ledger-now="true"',
    );
  });

  it('counts what the filters match — the operations and the receipts lines', () => {
    const expected = ar('fleet.custody.ledger.countBoth', {
      operations: count('operation', 4),
      spendLines: count('spendLine', 2),
    });
    expect(text(element(html, 'data-filtered-count'))).toBe(expected);
    expect(text(element(html, 'data-ledger-count="true"'))).toBe(expected);
  });

  it('an operation opens its drawer (eye) or its letter (printer); a receipts line opens «العهدة» over its days', () => {
    for (const id of ['op-s1', 'op-c2', 'op-r1', 'op-c1']) {
      expect(rowOf(id)).toContain(`data-ledger-view="${id}"`);
      expect(rowOf(id)).toContain(`data-ledger-print="${id}"`);
    }
    const spend = rowOf('spend:2026-10-06:2026-10-18');
    expect(spend).not.toContain('data-ledger-view=');
    expect(spend).toContain('href="/fleet/custody?from=2026-10-06&amp;to=2026-10-18"');
  });

  it('says what each line is, from its own facts', () => {
    const sep = '، ';
    expect(text(rowOf('op-c1'))).toContain(
      ar('fleet.custody.ledger.detail.chargeFor', { reason: 'تشغيل السيارات لشهر سبتمبر' }),
    );
    expect(text(rowOf('op-c1'))).toContain(ar('fleet.custody.ledger.detail.chargeNote'));
    // The kinds in his letter's order — the API sends the board's.
    expect(text(rowOf('op-r1'))).toContain(
      ar('fleet.custody.ledger.detail.replenish', {
        memos: count('memo', 5),
        kinds: ['tyres', 'fuel', 'maintenance']
          .map((k) => ar(`fleet.custody.source.${k}`))
          .join(sep),
      }),
    );
    expect(text(rowOf('op-r1'))).toContain(
      ar('fleet.custody.ledger.detail.period', { from: '2026/09/01', to: '2026/09/30' }),
    );
    expect(text(rowOf('op-s1'))).toContain(
      ar(`fleet.custody.ledger.parts.${custodyPlural('ar', 3)}`, { count: '3' }),
    );
    expect(text(rowOf('spend:2026-09-01:2026-09-28'))).toContain(
      ar(`fleet.custody.ledger.detail.spend.${custodyPlural('ar', 97)}`, { count: '97' }),
    );
  });

  it('a phone draws each line as a card', () => {
    const cards = element(html, 'data-ledger-cards="true"');
    expect([...cards.matchAll(/data-ledger-card="([^"]+)"/gu)].map((m) => m[1])).toEqual(
      ROWS.map((r) => r.id),
    );
  });

  it('asks the server for the filters the address holds', () => {
    const filters = { to: '2026-09-30', op: ['charge', 'replenish'] };
    const html2 = page(
      '/fleet/custody/log?to=2026-09-30&op=charge,replenish,refund',
      client({ filters, rows: [ROWS[3] as FleetCustodyLedgerRowDto] }),
    );
    expect([...html2.matchAll(/data-ledger-row="([^"]+)"/gu)].map((m) => m[1])).toEqual(['op-r1']);
  });

  it('the fund’s actions only for a reader who may write custody money', () => {
    expect(page('/fleet/custody/log', client(), ['fleetCustody.view'])).not.toContain(
      'data-custody-fund-actions',
    );
  });

  it('remembers its filters, size and order — never `page`, never a drawer', () => {
    const src = readFileSync(join(HERE, 'CustodyLedgerPage.tsx'), 'utf8');
    expect(src).toContain(
      "const REMEMBERED_FILTERS = ['from', 'to', 'op', 'size', 'sort'] as const;",
    );
    expect(src).toContain("const DEFAULT_SORT = 'date:desc';");
  });
});

// ── The drawer ───────────────────────────────────────────────────────────────────────────────

describe('«سجل العهدة» — an operation’s drawer', () => {
  it('a replenishment: the sum, its kinds in his letter’s order, its memos, its letter', () => {
    const html = page('/fleet/custody/log?open=op-r1');
    const drawer = element(html, 'data-ledger-details="op-r1"');
    const sum = element(drawer, 'data-ledger-sum="true"');
    expect(text(element(sum, 'data-ledger-sum-cell="before"'))).toContain(figure(17492));
    expect(text(element(sum, 'data-ledger-sum-cell="after"'))).toContain(figure(99400));
    const kinds = element(drawer, 'data-ledger-replenish-kinds="true"');
    expect([...kinds.matchAll(/data-ledger-replenish-kind="(\w+)"/gu)].map((m) => m[1])).toEqual([
      'tyres',
      'fuel',
      'maintenance',
      'wash',
    ]);
    // Washing carried no memo: «—», and today's washing receipts outside any memo.
    expect(text(element(kinds, 'data-ledger-replenish-kind="wash"'))).toContain('—');
    expect(text(element(kinds, 'data-ledger-replenish-kind-note="wash"'))).toBe(
      ar('fleet.custody.ledger.drawer.outsideNow', {
        receipts: count('receipt', 4),
        amount: figure(600),
      }),
    );
    const memos = element(drawer, 'data-ledger-replenish-memos="true"');
    expect(memos).toContain('href="/fleet/custody/memos"');
    expect(memos.match(/data-memo-name="(typed|fallback)"/gu)?.length).toBeGreaterThanOrEqual(5);
    const letter = element(drawer, 'data-ledger-letter-section="replenish"');
    expect(letter.match(/data-paper-sheet="true"/gu)).toHaveLength(1);
    expect(text(drawer)).toContain(
      ar('fleet.custody.ledger.drawer.printLetter', {
        letter: ar('fleet.custody.ledger.drawer.letter.replenish'),
      }),
    );
    expect(drawer).not.toContain('data-ledger-to-letter');
  });

  it('a settlement: its licensing memos, their total, its letter', () => {
    const drawer = element(page('/fleet/custody/log?open=op-s1'), 'data-ledger-details="op-s1"');
    const parts = element(drawer, 'data-ledger-settle-parts="true"');
    // Settling needs no licence grant: without one, the count is words, not a way to a screen
    // that would refuse its reader.
    expect(parts).not.toContain('href="/fleet/license-expenses"');
    expect(text(parts)).toContain('3 مذكرات — في «مصروفات التراخيص»');
    const licensed = element(
      page('/fleet/custody/log?open=op-s1', client(), [
        'fleetCustody.view',
        'fleetReceipt.create',
        'fleetLicenseExpense.view',
      ]),
      'data-ledger-settle-parts="true"',
    );
    expect(licensed).toContain('href="/fleet/license-expenses"');
    expect(parts.match(/data-licence-kind="renewal"/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(text(parts)).toContain(figure(124139.46));
    expect(text(element(drawer, 'data-ledger-sum-cell="after"'))).toContain(figure(175260.54));
    expect(element(drawer, 'data-ledger-letter-section="settle"')).toContain(
      'data-paper-sheet="true"',
    );
    expect(drawer).not.toContain('data-ledger-replenish-memos');
  });

  it('the printer opens a charge at its letter (`letter=1`), «نظير» written back once', () => {
    const drawer = element(
      page('/fleet/custody/log?open=op-c2&letter=1'),
      'data-ledger-details="op-c2"',
    );
    expect(drawer).toContain('data-ledger-to-letter="true"');
    expect(drawer).toContain('data-ledger-letter-section="charge"');
    expect(drawer).not.toContain('data-ledger-replenish-memos');
    expect(drawer).not.toContain('data-ledger-settle-parts');
    const money = formatMoneyParts(200000, 'EGP', 'ar');
    expect(text(element(drawer, 'data-ledger-intro="true"'))).toBe(
      ar('fleet.custody.ledger.drawer.intro.chargeFor', {
        amount: `${money.figure} ${money.currency}`,
        reason: ar('fleet.custody.ledger.detail.chargeFor', {
          reason: '24 سياره تجديد + 23 سياره مد مده',
        }),
      }).replace(/\s+/gu, ' '),
    );
  });

  it('reads the operation by its id — loading until it is known', () => {
    const drawer = element(
      page('/fleet/custody/log?open=op-unknown', client({ operations: false })),
      'data-ledger-details="op-unknown"',
    );
    expect(drawer).toContain('data-ledger-details-loading="true"');
  });
});

// ── The words ────────────────────────────────────────────────────────────────────────────────

describe('the ledger’s words, from the facts', () => {
  const kit = {
    t: (key: string, params?: Record<string, string | number>) =>
      params === undefined ? key : `${key}${JSON.stringify(params)}`,
    count: (noun: string, n: number) => `${n} ${noun}`,
    form: (n: number) => custodyPlural('ar', n),
    cars: (n: number) => `${n} cars`,
    separator: '، ',
    day: (iso: string) => iso.replace(/-/gu, '/'),
  };

  it('a receipts line names its kinds, its memos and what is in none', () => {
    const october = words.ledgerWords(ROWS[0] as FleetCustodyLedgerRowDto, kit);
    expect(october.note).toBe(
      'fleet.custody.source.tyres، fleet.custody.source.fuel، fleet.custody.source.maintenance — fleet.custody.ledger.detail.allOutside',
    );
    const september = words.ledgerWords(ROWS[4] as FleetCustodyLedgerRowDto, kit);
    expect(september.note).toBe(
      'fleet.custody.source.tyres، fleet.custody.source.fuel، fleet.custody.source.maintenance، fleet.custody.source.wash — fleet.custody.ledger.detail.inMemos{"memos":"5 memo"}، fleet.custody.ledger.detail.outside{"count":"4 receipt"}',
    );
  });

  it('a charge with no reason is the action’s own name', () => {
    expect(words.chargeTitle('', kit)).toBe('fleet.custody.actions.charge');
    expect(words.chargeTitle(' x ', kit)).toBe(
      'fleet.custody.ledger.detail.chargeFor{"reason":"x"}',
    );
  });

  it('counts the lines as the pager does', () => {
    expect(words.ledgerCount({ operations: 4, spendLines: 0 }, kit)).toBe('4 operation');
    expect(words.ledgerCount({ operations: 0, spendLines: 2 }, kit)).toBe('2 spendLine');
    expect(words.ledgerCount({ operations: 4, spendLines: 2 }, kit)).toBe(
      'fleet.custody.ledger.countBoth{"operations":"4 operation","spendLines":"2 spendLine"}',
    );
  });

  it('a settlement’s parts per kind, renewal first', () => {
    expect(
      words.licencePhrase(
        { renewal: { count: 3, cars: 15 }, extension: { count: 1, cars: 23 } },
        kit,
      ),
    ).toBe(
      'fleet.custody.ledger.detail.licence{"kind":"fleet.licenseExpenses.kinds.renewal","cars":"15 cars"}، fleet.custody.ledger.detail.licence{"kind":"fleet.licenseExpenses.kinds.extension","cars":"23 cars"}',
    );
  });
});

// ── In his words, once the dictionary holds them ─────────────────────────────────────────────

const merged =
  ar('fleet.custody.ledger.title') !== 'fleet.custody.ledger.title' &&
  ar('fleet.custody.count.memo.two') !== 'fleet.custody.count.memo.two';

describe.skipIf(!merged)('«سجل العهدة» reads as the approved sample does', () => {
  it('the lines and the count', () => {
    const html = page();
    expect(text(element(html, 'data-filtered-count'))).toBe('4 عمليات + سطرا مصروفات');
    expect(text(element(html, 'data-ledger-detail="op-c1"'))).toContain(
      'نظير تشغيل السيارات لشهر سبتمبر',
    );
    expect(text(element(html, 'data-ledger-detail="op-r1"'))).toContain(
      '5 مذكرات: كاوتش، وقود، صيانة',
    );
    expect(text(element(html, 'data-ledger-detail="op-s1"'))).toContain('3 مصروفات تراخيص');
    expect(text(element(html, 'data-ledger-detail="spend:2026-09-01:2026-09-28"'))).toContain(
      '97 إيصالًا صُرفت من العهدة',
    );
  });
});
