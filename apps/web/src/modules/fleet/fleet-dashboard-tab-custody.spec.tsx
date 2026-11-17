// «لوحة تحكم الحركة» — «العهدة», the owner-approved sample (approved/cust-dark.png and
// cust-branch-dark.png; harness zz-custody-tab.tsx; DECISIONS §9 «اعتمد سامبل العهدة», the critic's
// 17 corrections, Q1 (أ) «اعمل اللى بتفضلوا»; plan build-cl §6), a NEW tab after «الوقود والمصروفات»
// of «الآن» (the custody screen's own reads) and a period (R2) both.
//
// What this file pins (plan D9–D13): every figure of «الآن» is the custody screen's own field — the
// strip the fund's summary, «تنتظر الاستعاضة» and «تنتظر التسوية» the very CFL figures «ملخصات»
// shows, held money INSIDE the waiting figure, the held card's letters and their age from the
// oldest, the lists cut at FLEET_DASHBOARD_CUSTODY_WAIT_ROWS with «و N أخرى», the alerts the
// banner's own lines (amber, red only for (a) and (e)), the chart over the done lines only in the
// brand, the latest six lines of the log; «الشركة كلها» on «الآن» whenever the page is narrowed (a
// branch AND «كل فروعي»), never on the period band; the period's custody spend and its states (plain)
// and brand bars in the custody order with one-decimal shares, links by the D20 rule; the sentence
// that they are the fuel tab's columns, never added to them; each band its own read's face; the
// licensing links only for a reader of «مصروفات التراخيص»; never `?fund=`, `letter=1` or a bare
// list; the words the tab never says.
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make, the custody screen's reads under theirs, the clock pinned
// to the approved sample's day (12/11/2026) so every age reads as approved.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_CUSTODY_RECENT_ROWS,
  FLEET_DASHBOARD_CUSTODY_WAIT_ROWS,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyHeldLetterDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySettleCandidateDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetLicenseExpenseDto,
  type Paginated,
} from '@ecms/contracts';
import { custodyQueryKeys } from './api/fleet-queries';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import { custodyWaiting } from './lib/custody-dashboard-fund';
import { CUSTODY_LEDGER_PARAMS } from './components/CustodyDashboardFund';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  PERIOD_DTO,
  T1,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The approved sample's day: Thursday 12 November 2026, mid-morning in Cairo. */
const CLOCK = Date.UTC(2026, 10, 12, 8, 42);
// Pinned before any render: the module renders its default tab while it is collected.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(CLOCK);
afterAll(() => {
  vi.useRealTimers();
});

// ── The approved figure set (gap map §8a, the harness's ONE consistent set) ───────────────────

const STAMP = '2026-11-12T08:00:00.000Z';

const memoRow = (
  id: string,
  no: number,
  kind: FleetCustodyMemoRowDto['kind'],
  date: string,
  receipts: number,
  total: number,
  name = '',
): FleetCustodyMemoRowDto => ({
  id,
  no,
  kind,
  name,
  date,
  from: date,
  to: date,
  receipts,
  total,
  replenishment: null,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
});

/** «في مذكرات لم تُستعَض بعد»: memo 34 (35 days — late) and memo 37 (4 days). */
const PENDING: FleetCustodyMemoRowDto[] = [
  memoRow('m34', 34, 'fuel', '2026-10-08', 27, 7_930),
  memoRow('m37', 37, 'maintenance', '2026-11-08', 29, 16_580),
];

/** The one letter waiting for its transfer since 08/11 — its three memos make it. */
const LETTER: FleetCustodyHeldLetterDto = {
  id: 'op-held',
  date: '2026-11-08',
  from: '2026-10-26',
  to: '2026-11-04',
  amount: 52_750,
  receipts: 158,
  memos: [
    { id: 'm35', no: 35, kind: 'fuel', name: '', date: '2026-11-04', receipts: 64, total: 24_860 },
    { id: 'm36', no: 36, kind: 'tyres', name: '', date: '2026-11-04', receipts: 21, total: 19_340 },
    { id: 'm38', no: 38, kind: 'wash', name: '', date: '2026-11-04', receipts: 73, total: 8_550 },
  ],
};

const outside = (
  kind: FleetCustodyOutsideKindDto['kind'],
  count: number,
  total: number,
  oldest: string,
  stale: [number, number] = [0, 0],
): FleetCustodyOutsideKindDto => ({
  kind,
  count,
  total,
  oldest,
  stale: { count: stale[0], total: stale[1] },
});
/** 147 receipts in no memo (51,400.00) — fuel's oldest 37 days old (4 of them past 30 days). */
const OUTSIDE: FleetCustodyOutsideKindDto[] = [
  outside('maintenance', 16, 9_240, '2026-11-07'),
  outside('fuel', 61, 17_860, '2026-10-06', [4, 1_180]),
  outside('tyres', 14, 18_150, '2026-11-05'),
  outside('wash', 56, 6_150, '2026-11-05'),
];

/** 300,000 − 693,480 + 564,820 − 96,440 = 74,900. */
const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 74_900,
  charged: { count: 3, amount: 300_000 },
  spent: { count: 1_964, amount: 693_480 },
  replenished: { count: 9, amount: 564_820, memos: 31 },
  held: { count: 1, amount: 52_750, memos: 3, receipts: 158, letters: [LETTER] },
  cancelled: { count: 1, amount: 4_000 },
  settled: { count: 4, amount: 96_440, parts: 12 },
  operations: 18,
  memos: { count: 36, pending: 2, pendingTotal: 24_510 },
  outside: OUTSIDE,
  deleted: { count: 0 },
};

const part = (
  expenseId: string,
  kind: FleetCustodySettleCandidateDto['part'],
  date: string,
  codes: string[],
  visa: number,
  cash: number,
): FleetCustodySettleCandidateDto => ({
  expenseId,
  part: kind,
  date,
  cars: codes.length,
  codes,
  visaTotal: visa,
  cashTotal: cash,
  total: visa + cash,
  expense: { id: expenseId, date } as unknown as FleetLicenseExpenseDto,
});
/** «تنتظر التسوية» 13,620.00: a renewal 38 days old (late), one 14 days old, an extension. */
const PARTS: FleetCustodySettleCandidateDto[] = [
  part('lx1', 'renewal', '2026-10-05', ['290', '167', '122'], 4_560, 2_280),
  part('lx2', 'renewal', '2026-10-29', ['231', '305'], 2_850, 1_420),
  part('lx3', 'extension', '2026-11-06', ['214'], 1_680, 830),
];

const line = (over: Partial<FleetCustodyLedgerRowDto>): FleetCustodyLedgerRowDto => ({
  id: 'x',
  op: 'charge',
  status: 'done',
  date: '2026-10-01',
  dateTo: null,
  letterDate: null,
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
  transfer: null,
  cancellation: null,
  ...over,
});
const spend = (id: string, from: string, to: string, amount: number, after: number) =>
  line({
    id,
    op: 'spend',
    date: from,
    dateTo: to,
    amount: -amount,
    before: after + amount,
    after,
    receipts: 20,
    byKind: {
      maintenance: { count: 5, amount: amount / 4, outside: 5 },
      fuel: { count: 5, amount: amount / 4, outside: 0 },
      tyres: { count: 5, amount: amount / 4, outside: 0 },
      wash: { count: 5, amount: amount / 4, outside: 0 },
    },
    memoNos: [],
  });
/** «سجل العهدة» newest first: a held replenishment, a transferred one, a cancelled one. */
const LINES: FleetCustodyLedgerRowDto[] = [
  {
    ...spend('spend:2026-11-08:2026-11-12', '2026-11-08', '2026-11-12', 38_720, 74_900),
    latest: true,
  },
  line({
    id: 'op-held',
    op: 'replenish',
    status: 'held',
    date: '2026-11-08',
    amount: 52_750,
    before: 113_620,
    after: 113_620,
    from: '2026-10-26',
    to: '2026-11-04',
    memos: { count: 3, kinds: ['tyres', 'fuel', 'wash'] },
  }),
  spend('spend:2026-11-03:2026-11-07', '2026-11-03', '2026-11-07', 29_010, 113_620),
  line({
    id: 'op-settle',
    op: 'settle',
    date: '2026-11-03',
    amount: -8_940,
    before: 151_570,
    after: 142_630,
    licence: { renewal: { count: 1, cars: 2 }, extension: { count: 1, cars: 1 } },
  }),
  spend('spend:2026-11-02:2026-11-02', '2026-11-02', '2026-11-02', 7_980, 151_570),
  line({
    id: 'op-r9',
    op: 'replenish',
    date: '2026-11-02',
    letterDate: '2026-10-29',
    amount: 61_840,
    before: 97_710,
    after: 159_550,
    from: '2026-10-09',
    to: '2026-10-25',
    memos: { count: 4, kinds: ['tyres', 'fuel', 'maintenance', 'wash'] },
    transfer: { date: '2026-11-02', reference: '58203', note: '', byName: null, at: STAMP },
  }),
  line({
    id: 'op-c1',
    op: 'replenish',
    status: 'cancelled',
    date: '2026-10-20',
    amount: 4_000,
    before: 97_710,
    after: 97_710,
    memos: { count: 1, kinds: ['wash'] },
    cancellation: { reason: '', byName: null, at: STAMP },
  }),
  line({ id: 'op-charge', op: 'charge', date: '2026-10-01', amount: 97_710, after: 97_710 }),
];
const LEDGER: Paginated<FleetCustodyLedgerRowDto> = {
  items: LINES,
  meta: { page: 1, pageSize: 100, totalItems: LINES.length, totalPages: 1 },
};

/** The period: 81,950.00 of custody receipts (236), where it stands now (Q1 أ). */
const OPEX: NonNullable<FleetDashboardPeriodDto['opex']> = {
  card: 116_350,
  custody: 81_950,
  fuel: 142_500,
  total: 198_300,
  count: 574,
  dataFrom: '2026-01-01',
  fuelCustody: 26_150,
  tyres: 28_450,
  wash: 9_650,
  maintenance: 17_700,
  litres: 8_890,
  unpricedFuel: 0,
  custodyCount: 236,
};
const STATES: NonNullable<FleetDashboardPeriodDto['custodyStates']> = {
  replenished: 0,
  pending: 31_730,
  outside: 50_220,
};
const PAGE: FleetDashboardPeriodDto = { ...PERIOD_DTO, opex: OPEX, custodyStates: STATES };

const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };
const NOW_BRANCH: FleetDashboardNowDto = { ...NOW_DTO, branchId: B1, scopeBranches: [CAIRO] };
const NOW_MINE: FleetDashboardNowDto = { ...NOW_DTO, branchId: null, scopeBranches: [CAIRO, GIZA] };
const PAGE_BRANCH: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...PAGE.vehicleScope, branchId: B1, scopeBranches: [CAIRO] },
};

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────

const TAB_URL = '/fleet?tab=custody';

/** R2's key for the address bar's filters — the page's own read. */
const pageKey = (url: string) => {
  const query = toPeriodQuery(readPeriodFilters(new URL(url, 'http://x').searchParams));
  return fleetDashboardKeys.period(periodLiveness(query, TODAY), query);
};

/** A read the cache holds as a rejected request leaves it. */
const failed = (qc: QueryClient, queryKey: readonly unknown[]): void => {
  qc.setQueryDefaults(queryKey, { retryOnMount: false });
  const query = qc.getQueryCache().build(qc, { queryKey });
  query.setState({
    ...query.state,
    status: 'error',
    error: new Error('read down'),
    errorUpdatedAt: 1,
    fetchStatus: 'idle',
  });
};

interface Seed {
  now?: FleetDashboardNowDto;
  page?: FleetDashboardPeriodDto | null;
  url?: string;
  fund?: FleetCustodyFundSummaryDto;
  pending?: FleetCustodyMemoRowDto[];
  parts?: FleetCustodySettleCandidateDto[];
  ledger?: Paginated<FleetCustodyLedgerRowDto> | null;
  /** The custody reads not answered yet. */
  custodyPending?: boolean;
  custodyFails?: boolean;
  pageFails?: boolean;
}

const client = (seed: Seed = {}): QueryClient => {
  const url = seed.url ?? TAB_URL;
  const qc = dashboardClient({ now: seed.now ?? NOW_DTO, period: null, custody: false });
  const fund = seed.fund ?? FUND;
  if (seed.custodyFails === true) failed(qc, custodyQueryKeys.fund());
  else if (seed.custodyPending !== true) qc.setQueryData(custodyQueryKeys.fund(), fund);
  if (seed.custodyPending !== true) {
    qc.setQueryData(custodyQueryKeys.candidates('replenish'), {
      memos: seed.pending ?? PENDING,
      outside: fund.outside,
      fundTotal: fund.fundTotal,
      chargedTotal: fund.charged.amount,
    });
    qc.setQueryData(custodyQueryKeys.candidates('settle'), {
      parts: seed.parts ?? PARTS,
      fundTotal: fund.fundTotal,
    });
  }
  if (seed.ledger !== null) {
    qc.setQueryData(custodyQueryKeys.ledger(CUSTODY_LEDGER_PARAMS), seed.ledger ?? LEDGER);
  }
  if (seed.pageFails === true) failed(qc, pageKey(url));
  else if (seed.page !== null) qc.setQueryData(pageKey(url), seed.page ?? PAGE);
  return qc;
};

/** Every page key, and «مصروفات التراخيص»'s — never a page key itself (PAGELESS), read here. */
const KEYS: readonly string[] = [...ALL_KEYS, 'fleetLicenseExpense.view'];
const WITHOUT_LICENCES = KEYS.filter((key) => key !== 'fleetLicenseExpense.view');

const page = (seed: Seed = {}, permissions: readonly string[] = KEYS): string =>
  renderDashboard({ url: seed.url ?? TAB_URL, client: client(seed), permissions });

const tab = (seed: Seed = {}, permissions: readonly string[] = KEYS): string => {
  const html = page(seed, permissions);
  const at = html.indexOf('data-dash-tab-body="custody"');
  if (at === -1) throw new Error('no custody tab body');
  return html.slice(at);
};

// ── Reading the markup ────────────────────────────────────────────────────────────────────────

const unescape = (s: string): string =>
  s
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");
/** The words a reader sees: tags dropped, entities read, no gap a tag left before «.» or «)». */
const text = (html: string): string =>
  unescape(html.replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .replace(/\( /gu, '(')
    .replace(/ ([).،:])/gu, '$1')
    .trim();
const links = (html: string): { href: string; metric: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>/gu)].map((m) => {
    const attrs = m[1] ?? '';
    return {
      href: unescape(/href="([^"]*)"/u.exec(attrs)?.[1] ?? ''),
      metric: /data-metric="([^"]*)"/u.exec(attrs)?.[1] ?? '',
    };
  });
const hrefs = (html: string, metric: string): string[] =>
  links(html)
    .filter((l) => l.metric === metric)
    .map((l) => l.href);
const hrefOf = (html: string, metric: string): string => {
  const found = hrefs(html, metric);
  if (found.length === 0) throw new Error(`no link ${metric}`);
  return found[0] ?? '';
};
/** A link as its screen and its parameters, whatever order the builder wrote them in. */
const target = (href: string): { path: string; params: Record<string, string> } => {
  const url = new URL(href, 'http://x');
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
};
/** The markup from `attr="value"` up to the next element carrying `next` (or the end). */
const slice = (html: string, attr: string, value: string, next = `${attr}=`): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const end = html.indexOf(next, start + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : end);
};
/** The tab's parts: a card or a block runs to the next one of them. */
const PARTS_AT = [
  'data-cust-term=',
  'data-cust-wait=',
  'data-cust-block=',
  'data-cust-band=',
  'data-cust-period=',
  'data-cust-overlap=',
];
const partOf = (html: string, attr: string, value: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const from = start + attr.length + value.length + 3;
  const ends = PARTS_AT.map((marker) => html.indexOf(marker, from)).filter((at) => at !== -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
const term = (html: string, id: string): string => partOf(html, 'data-cust-term', id);
const wait = (html: string, id: string): string => partOf(html, 'data-cust-wait', id);
const block = (html: string, id: string): string => partOf(html, 'data-cust-block', id);
/** The «الآن» band: from its head to the period band (or the end). */
const nowBand = (html: string): string => {
  const end = html.indexOf('data-cust-band="period"');
  return html.slice(html.indexOf('data-cust-band="now"'), end === -1 ? undefined : end);
};
const periodBand = (html: string): string => html.slice(html.indexOf('data-cust-band="period"'));
const w = (key: string, params?: Record<string, string | number>): string =>
  ar(`fleet.dash.custody.${key}`, params);
/** Words with their spaces taken out — a figure set apart in its own tag reads «و 2» as text. */
const squash = (s: string): string => s.replace(/\s+/gu, '');
const money = (n: number): string =>
  `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const DEFAULT = tab();

// ── 1 · The heading and the bands ─────────────────────────────────────────────────────────────

describe('«العهدة» — the heading, the two bands and the approved order', () => {
  it('heads the tab «العهدة» with the approved line, «تحديث», no live chip', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-cust-band="now"'));
    expect(text(head)).toContain(ar('fleet.dash.shell.tab.custody'));
    expect(text(head)).toContain(w('sub'));
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('draws «الآن» with the live chip and «من بداية العهدة», then «خلال الفترة» with its range', () => {
    const now = slice(DEFAULT, 'data-dash-band', 'now', 'data-read-band');
    expect(text(now)).toContain(w('now'));
    expect(now).toContain('data-live-chip="true"');
    expect(text(now)).toContain(ar('fleet.custody.dashboard.fund.scopeSince'));
    expect(now).not.toContain('data-company-wide');
    const period = slice(DEFAULT, 'data-dash-band', 'period', 'data-period-filters');
    expect(text(period)).toContain(w('period'));
    expect(period).toContain('data-dash-range="thisMonth"');
    expect(text(period)).toContain(w('periodSub'));
    expect(DEFAULT.match(/data-period-filters="true"/gu)).toHaveLength(1);
  });

  it('lays out the approved order: strip, three waiting cards, alerts, chart, table, then the period', () => {
    const order = [
      'data-cust-band="now"',
      'data-cust-term="charged"',
      'data-cust-term="spent"',
      'data-cust-term="replenished"',
      'data-cust-term="settled"',
      'data-cust-term="fund"',
      'data-cust-wait="waiting"',
      'data-cust-wait="held"',
      'data-cust-wait="settle"',
      'data-cust-block="alerts"',
      'data-cust-block="steps"',
      'data-cust-block="recent"',
      'data-cust-band="period"',
      'data-period-filters="true"',
      'data-cust-period="spend"',
      'data-cust-block="kinds"',
      'data-cust-overlap="true"',
    ].map((marker) => DEFAULT.indexOf(marker));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// ── 2 · The formula ───────────────────────────────────────────────────────────────────────────

describe('the strip — «طلبات − مصروفات + استعاضة − تسوية = إجمالي العهدة الآن»', () => {
  it('writes the fund summary’s own five figures in the register colours, operators between them', () => {
    const terms: [string, number, string][] = [
      ['charged', FUND.charged.amount, 'teal'],
      ['spent', FUND.spent.amount, 'slate'],
      ['replenished', FUND.replenished.amount, 'sky'],
      ['settled', FUND.settled.amount, 'emerald'],
      ['fund', FUND.fundTotal, 'slate'],
    ];
    for (const [id, amount, tone] of terms) {
      const html = term(DEFAULT, id);
      expect(html).toContain(`data-cust-amount="${amount}"`);
      expect(html).toContain(`data-cust-tone="${tone}"`);
      expect(text(html)).toContain(money(amount));
    }
    // 300,000 − 693,480 + 564,820 − 96,440 = 74,900: the server's fund, never re-added here.
    expect(300_000 - 693_480 + 564_820 - 96_440).toBe(FUND.fundTotal);
    const strip = slice(DEFAULT, 'data-cust-block', 'strip', 'data-cust-wait=');
    const ops = [...strip.matchAll(/data-cust-operator="([^"]+)"/gu)].map((m) => m[1]);
    expect(ops).toEqual(['−', '+', '−', '=']);
    expect(text(term(DEFAULT, 'fund'))).toContain(ar('fleet.custody.ledger.tiles.formulaRequests'));
  });

  it('counts under each term as the ledger tiles do — the server’s counts', () => {
    expect(text(term(DEFAULT, 'charged'))).toContain('3 طلبات');
    expect(text(term(DEFAULT, 'spent'))).toContain('1,964 إيصالًا');
    expect(text(term(DEFAULT, 'replenished'))).toContain('31 مذكرة');
    expect(text(term(DEFAULT, 'settled'))).toContain('12 مصروف تراخيص');
  });

  it('opens «سجل العهدة» over each operation, the fund over its newest lines — never a bare list', () => {
    for (const [metric, op] of [
      ['custodyFund.charged', 'charge'],
      ['custodyFund.spent', 'spend'],
      ['custodyFund.replenished', 'replenish'],
      ['custodyFund.settled', 'settle'],
    ] as const) {
      expect(target(hrefOf(DEFAULT, metric))).toEqual({
        path: '/fleet/custody/log',
        params: { op },
      });
    }
    expect(target(hrefOf(DEFAULT, 'custodyFund.total'))).toEqual({
      path: '/fleet/custody/log',
      params: { sort: 'date:desc' },
    });
  });

  it('writes a fund below zero «−X» in red, and raises the banner’s red line (a) first', () => {
    const html = tab({ fund: { ...FUND, fundTotal: -4_335.5 } });
    const fund = term(html, 'fund');
    expect(fund).toContain('data-cust-negative="true"');
    expect(fund).toContain('text-red-600');
    expect(text(fund)).toContain('−4,335.50');
    const alerts = block(html, 'alerts');
    const first = /data-cust-alert="([^"]+)" data-cust-alert-tone="([^"]+)"/u.exec(alerts);
    expect(first?.slice(1)).toEqual(['negative', 'red']);
  });
});

// ── 3 · The three cards that wait ─────────────────────────────────────────────────────────────

describe('«تنتظر الاستعاضة» — what «استعاضة العهدة» would bring back, held money inside', () => {
  const card = wait(DEFAULT, 'waiting');

  it('heads with the CFL figure «ملخصات» shows, and the receipts behind it', () => {
    const parts = custodyWaiting(PENDING, OUTSIDE, FUND.memos.pendingTotal, FUND.held);
    expect(parts.total).toBe(128_660);
    expect(card).toContain('data-cust-amount="128660"');
    expect(text(card)).toContain('128,660.00');
    expect(text(card)).toContain('361 إيصالًا');
    expect(card).toContain('data-cust-tile="sky"');
    expect(card).toContain('border-l-amber-500');
    // «ملخصات» reads the same CFL field: the same figure on both tabs.
    expect(text(page({ url: '/fleet?tab=summaries' }))).toContain('128,660.00');
    expect(target(hrefOf(card, 'custodyFund.waiting')).path).toBe('/fleet/custody/dashboard');
  });

  it('shows its three parts: held, in memos, in no memo — each opening the list behind it', () => {
    const held = slice(card, 'data-cust-part', 'held');
    expect(held).toContain('data-cust-amount="52750"');
    expect(text(held)).toContain('3 مذكرات');
    expect(target(hrefOf(card, 'custodyFund.held'))).toEqual({
      path: '/fleet/custody/memos',
      params: { status: 'held' },
    });
    const memos = slice(card, 'data-cust-part', 'inMemos');
    expect(memos).toContain('data-cust-amount="24510"');
    expect(text(memos)).toContain('مذكرتان');
    expect(target(hrefOf(card, 'custodyFund.inMemos'))).toEqual({
      path: '/fleet/custody/memos',
      params: { status: 'pending' },
    });
    const out = slice(card, 'data-cust-part', 'outside');
    expect(out).toContain('data-cust-amount="51400"');
    expect(text(out)).toContain(ar('fleet.custody.memos.outside.title'));
    expect(text(out)).toContain('147 إيصالًا');
    expect(target(hrefOf(card, 'custodyFund.outside')).path).toBe('/fleet/custody/dashboard');
  });

  it('names each memo waiting as the custody pages do, its age amber past 30 days', () => {
    const m34 = slice(card, 'data-cust-memo', '34', '</li>');
    expect(text(m34)).toContain('مذكرة وقود رقم 34');
    expect(text(m34)).toContain('27 إيصالًا');
    expect(m34).toContain('data-cust-age="35"');
    expect(m34).toContain('data-cust-late="true"');
    expect(text(m34)).toContain('منذ 35 يومًا');
    const m37 = slice(card, 'data-cust-memo', '37', '</li>');
    expect(m37).toContain('data-cust-age="4"');
    expect(m37).not.toContain('data-cust-late');
    // A typed name is printed as typed (critic B6).
    const named = tab({
      pending: [memoRow('m40', 40, 'wash', '2026-11-10', 3, 450, 'غسيل الأسبوع')],
    });
    expect(text(slice(named, 'data-cust-memo', '40', '</li>'))).toContain('غسيل الأسبوع');
  });

  it('draws the four kinds in no memo in the custody order, the stale one amber', () => {
    const kinds = [...card.matchAll(/data-cust-outside="([^"]+)"/gu)].map((m) => m[1]);
    expect(kinds).toEqual(['maintenance', 'fuel', 'tyres', 'wash']);
    const fuel = slice(card, 'data-cust-outside', 'fuel');
    expect(fuel).toContain('data-cust-late="true"');
    expect(text(fuel)).toContain('أقدمها منذ 37 يومًا');
    expect(target(hrefOf(card, 'custodyFund.outside.fuel'))).toEqual({
      path: '/fleet/custody/memos',
      params: { kind: 'fuel' },
    });
    expect(slice(card, 'data-cust-outside', 'tyres')).not.toContain('data-cust-late');
    expect(text(card)).toContain(ar('fleet.custody.dashboard.waiting.note'));
  });

  it('lists at most FLEET_DASHBOARD_CUSTODY_WAIT_ROWS memos, then «و N أخرى» to the list', () => {
    expect(FLEET_DASHBOARD_CUSTODY_WAIT_ROWS).toBe(6);
    const eight = Array.from({ length: 8 }, (_, i) =>
      memoRow(`p${i}`, 50 + i, 'fuel', '2026-11-10', 1, 100),
    );
    const html = wait(tab({ pending: eight }), 'waiting');
    expect(html.match(/data-cust-memo="/gu)).toHaveLength(6);
    expect(html).toContain('data-cust-rest="2"');
    expect(squash(text(html))).toContain(squash(w('more', { count: 2 })));
    expect(target(hrefOf(html, 'custodyFund.inMemosMore'))).toEqual({
      path: '/fleet/custody/memos',
      params: { status: 'pending' },
    });
    // Two memos: no «أخرى».
    expect(card).not.toContain('data-cust-more');
  });
});

describe('«استعاضة معلّقة» — each letter waiting for its transfer, inside what waits', () => {
  const card = wait(DEFAULT, 'held');

  it('heads with the held amount, its receipts and the tag «ضمن ما ينتظر الاستعاضة»', () => {
    expect(card).toContain('data-cust-amount="52750"');
    expect(text(card)).toContain(w('held.title'));
    expect(text(card)).toContain(w('held.inside'));
    expect(text(card)).toContain('158 إيصالًا');
    expect(card).toContain('data-cust-tile="amber"');
    expect(text(card)).toContain(ar('fleet.custody.hold.heldTileNote'));
  });

  it('says how long the oldest letter waits, then each letter with its period and memos', () => {
    expect(card).toContain('data-cust-held-since="4"');
    expect(text(card)).toContain('في انتظار التحويل منذ 4 أيام');
    const letter = slice(card, 'data-cust-letter', 'op-held');
    expect(text(letter)).toContain('خطاب 2026/11/08');
    expect(text(letter)).toContain('3 مذكرات');
    expect(text(letter)).toContain('عن الفترة من 2026/10/26 إلى 2026/11/04');
    expect([...letter.matchAll(/data-cust-held-memo="(\d+)"/gu)].map((m) => m[1])).toEqual([
      '35',
      '36',
      '38',
    ]);
    expect(text(letter)).toContain('مذكرة كاوتش رقم 36');
    expect(target(hrefOf(letter, 'custodyFund.letter'))).toEqual({
      path: '/fleet/custody/log',
      params: { open: 'op-held' },
    });
    // One letter: the amount opens its own drawer.
    expect(target(hrefOf(card, 'custodyFund.heldTotal'))).toEqual({
      path: '/fleet/custody/log',
      params: { open: 'op-held' },
    });
  });

  it('with two letters: both listed, the age from the oldest, the amount to the held memos', () => {
    const older: FleetCustodyHeldLetterDto = {
      ...LETTER,
      id: 'op-older',
      date: '2026-10-28',
      amount: 1_000,
      receipts: 2,
      memos: [
        {
          id: 'm30',
          no: 30,
          kind: 'wash',
          name: '',
          date: '2026-10-27',
          receipts: 2,
          total: 1_000,
        },
      ],
    };
    const fund: FleetCustodyFundSummaryDto = {
      ...FUND,
      held: { count: 2, amount: 53_750, memos: 4, receipts: 160, letters: [older, LETTER] },
    };
    const html = wait(tab({ fund }), 'held');
    expect(html.match(/data-cust-letter="/gu)).toHaveLength(2);
    expect(html).toContain('data-cust-held-since="15"');
    expect(target(hrefOf(html, 'custodyFund.heldTotal'))).toEqual({
      path: '/fleet/custody/memos',
      params: { status: 'held' },
    });
  });

  it('says plainly when nothing is held, the figure then opening nothing', () => {
    const fund: FleetCustodyFundSummaryDto = {
      ...FUND,
      held: { count: 0, amount: 0, memos: 0, receipts: 0, letters: [] },
    };
    const html = wait(tab({ fund }), 'held');
    expect(html).toContain('data-cust-held-none="true"');
    expect(text(html)).toContain(w('held.none'));
    expect(hrefs(html, 'custodyFund.heldTotal')).toEqual([]);
  });
});

describe('«تنتظر التسوية» — the licensing memos waiting for «تسوية العهدة»', () => {
  const card = wait(DEFAULT, 'settle');

  it('heads with the CFL figure, its count, the emerald tile; each memo with its cars and age', () => {
    expect(card).toContain('data-cust-amount="13620"');
    expect(text(card)).toContain('13,620.00');
    expect(text(card)).toContain('3 مصروفات تراخيص');
    expect(card).toContain('data-cust-tile="emerald"');
    expect(text(card)).toContain(ar('fleet.custody.dashboard.settle.title'));
    const first = slice(card, 'data-cust-settle', 'lx1:renewal');
    expect(first).toContain('data-cust-licence-kind="renewal"');
    expect(text(first)).toContain('3 سيارات:');
    expect(text(first)).toContain('فيزا 4,560.00 • نقدي 2,280.00');
    expect(first).toContain('data-cust-age="38"');
    expect(first).toContain('data-cust-late="true"');
    expect(text(slice(card, 'data-cust-settle', 'lx2:renewal'))).toContain('سيارتان:');
    const ext = slice(card, 'data-cust-settle', 'lx3:extension');
    expect(ext).toContain('data-cust-licence-kind="extension"');
    expect(text(ext)).toContain('سيارة واحدة:');
    expect(text(card)).toContain(ar('fleet.custody.dashboard.settle.note'));
  });

  it('opens «مصروفات التراخيص» only for its reader', () => {
    expect(target(hrefOf(card, 'custodyFund.settle'))).toEqual({
      path: '/fleet/license-expenses',
      params: { status: 'waiting' },
    });
    expect(target(hrefOf(card, 'custodyFund.settlePart'))).toEqual({
      path: '/fleet/license-expenses',
      params: { kind: 'renewal', status: 'waiting' },
    });
    const without = tab({}, WITHOUT_LICENCES);
    expect(links(without).filter((l) => l.href.startsWith('/fleet/license-expenses'))).toEqual([]);
    // The figures stay, plain.
    expect(text(wait(without, 'settle'))).toContain('13,620.00');
  });

  it('lists at most six memos, then «و N أخرى»; none says the custody pages’ empty words', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      part(`l${i}`, 'renewal', '2026-11-10', ['101'], 100, 0),
    );
    const html = wait(tab({ parts: eight }), 'settle');
    expect(html.match(/data-cust-settle="/gu)).toHaveLength(6);
    expect(html).toContain('data-cust-rest="2"');
    const empty = wait(tab({ parts: [] }), 'settle');
    expect(empty).toContain('data-cust-settle-none="true"');
    expect(text(empty)).toContain(ar('fleet.custody.fundForm.settle.empty'));
  });
});

// ── 4 · «تنبيهات العهدة» ──────────────────────────────────────────────────────────────────────

describe('«تنبيهات العهدة» — the banner’s lines that fire, in its order and words', () => {
  const card = block(DEFAULT, 'alerts');

  it('draws only the firing lines, amber with a clock, the chip = the CFL count', () => {
    const lines = [...card.matchAll(/data-cust-alert="([^"]+)" data-cust-alert-tone="([^"]+)"/gu)];
    expect(lines.map((m) => [m[1], m[2]])).toEqual([
      ['stale', 'amber'],
      ['memo', 'amber'],
      ['licence', 'amber'],
    ]);
    expect(text(card)).toContain(w('alerts.title'));
    expect(text(card)).toContain('3 تنبيهات');
    expect(text(card)).toContain('مذكرة وقود رقم 34 لم تُستعَض منذ 35 يومًا');
    expect(text(card)).toContain('مذكرة تجديد تراخيص بتاريخ 2026/10/05 لم تُسوَّ منذ 38 يومًا');
    expect(text(card)).toContain('2026/10/06');
  });

  it('opens each line’s list (D13); the licensing ones only for that screen’s reader', () => {
    expect(target(hrefOf(card, 'custodyFund.alertStale'))).toEqual({
      path: '/fleet/custody/memos',
      params: { kind: 'fuel' },
    });
    expect(target(hrefOf(card, 'custodyFund.alertMemo'))).toEqual({
      path: '/fleet/custody/memos',
      params: { status: 'pending' },
    });
    expect(target(hrefOf(card, 'custodyFund.alertLicence'))).toEqual({
      path: '/fleet/license-expenses',
      params: { kind: 'renewal', status: 'waiting' },
    });
    const without = block(tab({}, WITHOUT_LICENCES), 'alerts');
    expect(hrefs(without, 'custodyFund.alertLicence')).toEqual([]);
  });

  it('is red only for a fund below zero (a) and settlements over the fund (e)', () => {
    const over = block(tab({ fund: { ...FUND, fundTotal: 10_000 } }), 'alerts');
    expect(over).toContain('data-cust-alert="settleOver" data-cust-alert-tone="red"');
    expect(target(hrefOf(over, 'custodyFund.alertSettleOver'))).toEqual({
      path: '/fleet/license-expenses',
      params: { status: 'waiting' },
    });
  });

  it('says «لا توجد تنبيهات الآن» when none fires, with no chip', () => {
    const calm = block(
      tab({
        fund: { ...FUND, outside: OUTSIDE.map((o) => ({ ...o, stale: { count: 0, total: 0 } })) },
        pending: [PENDING[1] as FleetCustodyMemoRowDto],
        parts: [PARTS[2] as FleetCustodySettleCandidateDto],
      }),
      'alerts',
    );
    expect(calm).toContain('data-cust-alerts-none="true"');
    expect(text(calm)).toContain(w('alerts.none'));
    expect(calm).not.toContain('data-cust-chip="alerts"');
  });
});

// ── 5 · The history ───────────────────────────────────────────────────────────────────────────

describe('«إجمالي العهدة بعد كل عملية» — the done lines, a brand step line', () => {
  const chart = block(DEFAULT, 'steps');

  it('steps over the done lines only: a held or cancelled replenishment moves nothing', () => {
    const steps = [...chart.matchAll(/data-cust-step="([^"]+)"/gu)].map((m) => m[1]);
    expect(steps).toEqual([
      'op-charge',
      'op-r9',
      'spend:2026-11-02:2026-11-02',
      'op-settle',
      'spend:2026-11-03:2026-11-07',
      'spend:2026-11-08:2026-11-12',
    ]);
    expect(chart).toContain('data-cust-line="brand"');
    expect(chart).toContain('stroke-brand-600');
    expect(chart).not.toContain('data-cust-line="below"');
    expect(chart).not.toContain('stroke-emerald');
    // The latest line read out, «الآن», and its label.
    expect(chart).toContain('data-cust-readout="spend:2026-11-08:2026-11-12"');
    expect(chart).toContain('data-cust-readout-now="true"');
    expect(text(chart)).toContain('الآن 74,900.00');
    expect(text(chart)).toContain(ar('fleet.custody.dashboard.steps.noteRequests'));
    expect(chart).not.toContain('data-cust-chip="capped"');
  });

  it('turns red below zero, and says «آخر 100 عملية» only when the history is longer', () => {
    const below: Paginated<FleetCustodyLedgerRowDto> = {
      items: [
        line({
          id: 'op-neg',
          op: 'settle',
          amount: -5_000,
          before: 1_000,
          after: -4_000,
          latest: true,
        }),
      ],
      meta: { page: 1, pageSize: 100, totalItems: 250, totalPages: 3 },
    };
    const html = block(tab({ ledger: below }), 'steps');
    expect(html).toContain('data-cust-line="below"');
    expect(html).toContain('data-cust-negative-band="true"');
    expect(html).toContain('data-cust-chip="capped"');
    expect(text(html)).toContain(ar('fleet.custody.dashboard.steps.capped', { count: '100' }));
  });
});

describe('«آخر عمليات العهدة» — the newest lines of any status, in the log’s words', () => {
  const table = block(DEFAULT, 'recent');
  const rows = [...table.matchAll(/data-cust-row="([^"]+)"/gu)].map((m) => m[1]);

  it('lists the newest FLEET_DASHBOARD_CUSTODY_RECENT_ROWS lines, newest first', () => {
    expect(FLEET_DASHBOARD_CUSTODY_RECENT_ROWS).toBe(6);
    expect(rows).toEqual(LINES.slice(0, 6).map((l) => l.id));
  });

  it('tints the held line «معلّقة» / «لم تتغيّر بعد»; a transferred one carries its letter and reference', () => {
    const held = slice(table, 'data-cust-row', 'op-held', '</tr>');
    expect(held).toContain('data-cust-status="held"');
    expect(held).toContain('bg-amber-50/70');
    expect(text(held)).toContain(ar('fleet.custody.hold.chip'));
    expect(text(held)).toContain(ar('fleet.custody.hold.unchanged'));
    expect(text(held)).toContain('في انتظار تحويل المبلغ منذ 2026/11/08');
    const done = slice(table, 'data-cust-row', 'op-r9', '</tr>');
    expect(text(done)).toContain('خطاب 2026/10/29');
    expect(text(done)).toContain('حُوِّل المبلغ في 2026/11/02');
    expect(text(done)).toContain('مرجع 58203');
  });

  it('puts «الآن» on the latest line only, and opens each line where the log does', () => {
    expect(table.match(/data-cust-now-chip="true"/gu)).toHaveLength(2); // the table + the phone block
    expect(slice(table, 'data-cust-row', 'spend:2026-11-08:2026-11-12', '</tr>')).toContain(
      'data-cust-now-chip="true"',
    );
    const opens = hrefs(table, 'custodyFund.recent').map(target);
    expect(opens).toContainEqual({
      path: '/fleet/custody-expenses',
      params: { from: '2026-11-08', to: '2026-11-12' },
    });
    expect(opens).toContainEqual({ path: '/fleet/custody/log', params: { open: 'op-settle' } });
    expect(target(hrefOf(table, 'custodyFund.log'))).toEqual({
      path: '/fleet/custody/log',
      params: { sort: 'date:desc' },
    });
  });
});

// ── 6 · The branch ────────────────────────────────────────────────────────────────────────────

describe('the department’s fund on a narrowed page — «الشركة كلها» on «الآن», never on the period', () => {
  it('under a chosen branch and under «كل فروعي» alike', () => {
    for (const now of [NOW_BRANCH, NOW_MINE]) {
      const html = tab({ now, page: now === NOW_BRANCH ? PAGE_BRANCH : PAGE });
      expect(slice(html, 'data-dash-band', 'now', 'data-read-band')).toContain(
        'data-company-wide="true"',
      );
      expect(periodBand(html)).not.toContain('data-company-wide');
      // The fund is the same whatever the branch.
      expect(term(html, 'fund')).toContain(`data-cust-amount="${FUND.fundTotal}"`);
    }
  });

  it('never moves «الآن» with the page’s period or filters', () => {
    const url = `/fleet?tab=custody&period=last30&type=${T1}`;
    const other = tab({ url, page: { ...PAGE, opex: { ...OPEX, custody: 1 } } });
    expect(nowBand(other)).toBe(nowBand(DEFAULT));
  });
});

// ── 7 · The period ────────────────────────────────────────────────────────────────────────────

describe('«خلال الفترة» — the period’s custody spend and where it stands now (Q1 أ)', () => {
  const kpi = partOf(DEFAULT, 'data-cust-period', 'spend');
  const kinds = block(DEFAULT, 'kinds');

  it('writes R2’s custody spend, its receipts, and the three states plain', () => {
    expect(kpi).toContain('border-l-sky-500');
    expect(kpi).toContain(`data-cust-amount="${OPEX.custody}"`);
    expect(text(kpi)).toContain(ar('fleet.nav.custodyExpenses'));
    expect(text(kpi)).toContain(w('period.tag'));
    expect(text(kpi)).toContain('236 إيصالًا');
    expect(text(kpi)).toContain(w('period.statesHead'));
    const states = [...kpi.matchAll(/data-cust-state="([^"]+)" data-cust-amount="([^"]+)"/gu)];
    expect(states.map((m) => [m[1], Number(m[2])])).toEqual([
      ['replenished', 0],
      ['pending', 31_730],
      ['outside', 50_220],
    ]);
    expect(STATES.replenished + STATES.pending + STATES.outside).toBe(OPEX.custody);
    const statesHtml = kpi.slice(kpi.indexOf('data-cust-states'));
    expect(links(statesHtml.slice(0, statesHtml.indexOf('data-cust-foot')))).toEqual([]);
    expect(text(kpi)).toContain(ar('fleet.custody.dashboard.waiting.showExpenses'));
  });

  it('draws the KPI without «منها» when the states are not sent', () => {
    const html = partOf(
      tab({ page: { ...PAGE, custodyStates: null } }),
      'data-cust-period',
      'spend',
    );
    expect(html).not.toContain('data-cust-states');
    expect(text(html)).toContain('81,950.00');
  });

  it('bars the four custody kinds in the custody order, brand, each its one-decimal share', () => {
    const bars = [...kinds.matchAll(/data-cust-bar="([^"]+)" data-cust-amount="([^"]+)"/gu)];
    expect(bars.map((m) => [m[1], Number(m[2])])).toEqual([
      ['maintenance', 17_700],
      ['fuel', 26_150],
      ['tyres', 28_450],
      ['wash', 9_650],
    ]);
    expect(
      kinds.match(/data-cust-bar-fill="[^"]+" class="h-2 rounded-full bg-brand-600/gu),
    ).toHaveLength(4);
    expect(
      [...kinds.matchAll(/data-cust-share="[^"]+"[^>]*><span[^>]*>([^<]+)</gu)].map((m) => m[1]),
    ).toEqual(['21.6%', '31.9%', '34.7%', '11.8%']);
    expect(text(kinds)).toContain(w('bars.title'));
    expect(text(kinds)).toContain(w('bars.note'));
    expect(text(kinds)).toContain(ar('fleet.custody.totals.fuel'));
  });

  it('opens «مصروفات العهدة» while nothing but codes narrows, else the receipts (D20)', () => {
    const { from, to } = PAGE.range;
    expect(target(hrefOf(kpi, 'opex.custody'))).toEqual({
      path: '/fleet/custody-expenses',
      params: { from, to },
    });
    expect(target(hrefOf(kinds, 'opex.custody.tyres'))).toEqual({
      path: '/fleet/custody-expenses',
      params: { source: 'tyres', from, to },
    });
    const branch = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
    expect(target(hrefOf(branch, 'opex.custody.tyres'))).toEqual({
      path: '/fleet/receipts',
      params: { kind: 'tyres', source: 'custody', from, to, branch: B1 },
    });
  });

  it('says these are the fuel tab’s very columns, never added to them — and opens that tab', () => {
    const note = partOf(DEFAULT, 'data-cust-overlap', 'true');
    expect(text(note)).toContain(w('overlap'));
    const fuel = target(hrefOf(note, 'opex.custody.tab'));
    expect(fuel.path).toBe('/fleet');
    expect(fuel.params.tab).toBe('fuel');
    // The receipts' whole and the card's fuel are the fuel tab's — never written here.
    expect(text(periodBand(DEFAULT))).not.toContain(money(OPEX.total));
    expect(text(periodBand(DEFAULT))).not.toContain(money(OPEX.card));
  });
});

// ── 8 · Faces and readers ─────────────────────────────────────────────────────────────────────

describe('each band its own read’s face; the tab for the custody reader alone', () => {
  it('keeps «الآن» when R2 failed, and the period band when the custody reads failed', () => {
    const r2 = tab({ pageFails: true });
    expect(nowBand(r2)).toContain('data-cust-term="fund"');
    expect(periodBand(r2)).toContain('data-read-band="error"');
    const custody = tab({ custodyFails: true });
    expect(nowBand(custody)).toContain('data-read-band="error"');
    expect(periodBand(custody)).toContain('data-cust-period="spend"');
    const waiting = tab({ custodyPending: true });
    expect(nowBand(waiting)).toContain('data-read-band="loading"');
    expect(periodBand(waiting)).toContain('data-cust-period="spend"');
  });

  it('keeps the strip and cards while «سجل العهدة» is on its way', () => {
    const html = tab({ ledger: null });
    expect(nowBand(html)).toContain('data-cust-wait="settle"');
    expect(html).not.toContain('data-cust-block="steps"');
  });

  it('shows for the custody fund’s reader alone — the period band only with the receipts', () => {
    const custodyOnly = tab({}, ['fleetCustody.view']);
    expect(custodyOnly).toContain('data-cust-band="now"');
    expect(custodyOnly).not.toContain('data-cust-band="period"');
    expect(text(custodyOnly.slice(0, custodyOnly.indexOf('data-cust-band="now"')))).toContain(
      w('subNow'),
    );
    const receiptsOnly = page(
      {},
      KEYS.filter((key) => key !== 'fleetCustody.view'),
    );
    expect(receiptsOnly).not.toContain('data-dash-tab-body="custody"');
    expect(receiptsOnly).not.toContain('data-dash-tab="custody"');
  });
});

describe('what the tab never draws', () => {
  it('never links `?fund=`, `letter=1` or a bare list', () => {
    for (const html of [DEFAULT, tab({ now: NOW_BRANCH, page: PAGE_BRANCH })]) {
      for (const { href } of links(html)) {
        expect(href).not.toContain('fund=');
        expect(href).not.toContain('letter=1');
        if (href.startsWith('/fleet/') && href !== '/fleet/custody/dashboard')
          expect(href, href).toContain('?');
      }
    }
  });

  it('says none of the words the owner ruled out, and no sample marker', () => {
    const words = text(DEFAULT);
    for (const banned of [
      'الحد الأدنى',
      'حد الأمان',
      'سقف',
      'معدل الدوران',
      'أعلى السيارات صرفًا',
      'أعلى السائقين صرفًا',
      'تصدير',
      'طوارئ',
      'ضيافة',
      'معتمد',
    ]) {
      expect(words, banned).not.toContain(banned);
    }
    expect(DEFAULT).not.toContain('data-zz-');
  });

  it('counts nothing in its own files: the lists’ counts are the custody lib’s', () => {
    const dir = join(HERE, 'components/fleet-dashboard');
    const files = readdirSync(dir).filter((name) => /^tab-custody/u.test(name));
    expect(files.sort()).toEqual([
      'tab-custody-history.tsx',
      'tab-custody-now.tsx',
      'tab-custody-period.tsx',
      'tab-custody-words.tsx',
      'tab-custody.tsx',
    ]);
    for (const name of files) {
      const src = readFileSync(join(dir, name), 'utf8');
      expect(src, name).not.toMatch(/\.reduce\(/u);
      expect(src, name).not.toMatch(/\{[\w.?]+\.length\}/u);
      expect(src, name).not.toContain('useCustodyFundAlerts(');
    }
  });
});
