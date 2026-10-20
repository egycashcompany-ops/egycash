// «العهدة الآن» on «لوحة تحكم العهدة» — the owner's approved samples, on his scenario at 19/10/2026:
// two charges (300,000.00), 126 receipts (97,794.00), the 29/09 replenishment of five memos
// (81,908.00), the 05/10 settlement (124,139.46) — the fund 159,974.54 — with 33 receipts in no memo
// (15,886.00; washing's two oldest past 30 days) and two licensing memos waiting (69,660.75). And
// «مصروفات العهدة حسب الفلاتر» under it: five spend cards, each split by its memos' state. Rendered
// to markup against a seeded query cache (the suite has no DOM), as the ledger's suite does.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FLEET_CUSTODY_STALE_DAYS,
  type FleetCustodyDashboardDto,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyKindSpendDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySettleCandidateDto,
  type FleetCustodySource,
  type FleetLicenseExpenseDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { custodyQueryKeys } from '../api/fleet-queries';
import { CustodyAlerts, CustodyDashboardBody, CustodyKpis } from '../components/CustodyDashboard';
import {
  CUSTODY_LEDGER_PARAMS,
  CustodyFundNow,
  CustodyFundSteps,
  CustodyRecentOps,
  CustodySettleCard,
  custodyStepScale,
  CustodyWaitingCard,
} from '../components/CustodyDashboardFund';
import { LedgerFigures, STRIP_FIGURE } from '../components/CustodyLedgerFigures';
import { CAIRO } from '../components/custody-dashboard-parts';
import {
  custodyAgeDays,
  custodyFundAlerts,
  custodyIsLate,
  custodyLedgerTarget,
  custodyMemoStateParts,
  custodyNotReplenished,
  custodyPeriodLink,
  custodySettleWaiting,
  custodyWaiting,
} from '../lib/custody-dashboard-fund';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);
const D = 'fleet.custody.dashboard';

/** The board's day: 19 October 2026, mid-morning UTC. */
const NOW = Date.UTC(2026, 9, 19, 10);
const STAMP = '2026-10-19T08:00:00.000Z';

// ── His scenario ─────────────────────────────────────────────────────────────────────────────

const outsideLine = (
  kind: FleetCustodySource,
  count: number,
  total: number,
  oldest: string | null,
  stale: [number, number] = [0, 0],
): FleetCustodyOutsideKindDto => ({
  kind,
  count,
  total,
  oldest,
  stale: { count: stale[0], total: stale[1] },
});
/** At `now`: 33 receipts in no memo — washing's two oldest (300.00) past 30 days. */
const OUTSIDE: FleetCustodyOutsideKindDto[] = [
  outsideLine('maintenance', 3, 5720, '2026-10-08'),
  outsideLine('fuel', 8, 7876, '2026-10-06'),
  outsideLine('tyres', 18, 1690, '2026-10-06'),
  outsideLine('wash', 4, 600, '2026-09-07', [2, 300]),
];
const FUND: FleetCustodyFundSummaryDto = {
  fundTotal: 159974.54,
  charged: { count: 2, amount: 300000 },
  spent: { count: 126, amount: 97794 },
  replenished: { count: 1, amount: 81908, memos: 5 },
  settled: { count: 1, amount: 124139.46, parts: 3 },
  operations: 4,
  memos: { count: 5, pending: 0, pendingTotal: 0 },
  outside: OUTSIDE,
};

/** Memo 6 — washing, saved today («now6»): its four receipts leave «في أي مذكرة». */
const MEMO6: FleetCustodyMemoRowDto = {
  id: 'm6',
  no: 6,
  kind: 'wash',
  name: '',
  date: '2026-10-19',
  from: '2026-09-07',
  to: '2026-10-18',
  receipts: 4,
  total: 600,
  replenishment: null,
  version: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const OUTSIDE6 = [...OUTSIDE.slice(0, 3), outsideLine('wash', 0, 0, null)];
const FUND6: FleetCustodyFundSummaryDto = {
  ...FUND,
  memos: { count: 6, pending: 1, pendingTotal: 600 },
  outside: OUTSIDE6,
};

const vehicles = (n: number, start: number) =>
  Array.from({ length: n }, (_, i) => ({
    vehicleId: `v${start + i}`,
    code: String(start + i),
    plate: `ص ${start + i}`,
  }));
const record = (id: string, date: string): FleetLicenseExpenseDto =>
  ({
    id,
    date,
    renewal: null,
    extension: null,
    signatures: { agent: 'أ', director: 'ب', generalManager: 'ج' },
    version: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  }) as unknown as FleetLicenseExpenseDto;
const candidate = (
  id: string,
  part: 'renewal' | 'extension',
  date: string,
  start: number,
  cars: number,
  visa: number,
  cash: number,
): FleetCustodySettleCandidateDto => ({
  expenseId: id,
  part,
  date,
  cars,
  codes: vehicles(cars, start).map((v) => v.code),
  visaTotal: visa,
  cashTotal: cash,
  total: Math.round((visa + cash) * 100) / 100,
  expense: record(id, date),
});
/** «مد مدة» of 23 cars on 01/10 and «تجديد» of 4 on 03/10 — 69,660.75, oldest day first. */
const PARTS: FleetCustodySettleCandidateDto[] = [
  candidate('lx1', 'extension', '2026-10-01', 150, 23, 34500, 6750),
  candidate('lx2', 'renewal', '2026-10-03', 207, 4, 24000, 4410.75),
];

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
/** «سجل العهدة», newest first. */
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

const byKind = (
  maintenance: [number, number],
  fuel: [number, number],
  tyres: [number, number],
  wash: [number, number],
) => {
  const pair = ([count, amount]: [number, number]) => ({ count, amount });
  return {
    maintenance: pair(maintenance),
    fuel: pair(fuel),
    tyres: pair(tyres),
    wash: pair(wash),
  };
};
/** The board's dashboard over no filter — the spend, and its memos' state (A2). */
const DASHBOARD: FleetCustodyDashboardDto = {
  count: 126,
  total: 97794,
  maintenance: 35134,
  fuel: 57720,
  tyres: 4340,
  wash: 600,
  fundTotal: 159974.54,
  fundCharged: 300000,
  fundSpent: 97794,
  vehicles: [],
  vehicleCount: 39,
  counts: { maintenance: 17, fuel: 63, tyres: 42, wash: 4 },
  bySource: [{ ref: 'receipt', count: 126, amount: 97794 }],
  timeline: { granularity: 'month', buckets: [] },
  drivers: [],
  noDriver: { count: 0, amount: 0 },
  fuelTypes: [],
  litres: 0,
  litresMissing: 0,
  periodDays: 48,
  fuelByCompany: {
    companies: [
      { company: 'wataniya', amount: 0, count: 0, litres: 0, types: [] },
      { company: 'chillout', amount: 0, count: 0, litres: 0, types: [] },
    ],
    none: { amount: 0, count: 0, litres: 0, types: [] },
  },
  alerts: { doubleFuel: [], receiptsWithoutPhoto: 0, duplicateReceipts: 0 },
  memoStates: {
    replenished: {
      count: 93,
      amount: 81908,
      byKind: byKind([14, 29414], [55, 49844], [24, 2650], [0, 0]),
    },
    pending: { count: 0, amount: 0, byKind: byKind([0, 0], [0, 0], [0, 0], [0, 0]) },
    outside: {
      count: 33,
      amount: 15886,
      byKind: byKind([3, 5720], [8, 7876], [18, 1690], [4, 600]),
    },
  },
};

// ── Rendering ────────────────────────────────────────────────────────────────────────────────

const ALL = ['fleetCustody.view', 'fleetReceipt.create', 'fleetLicenseExpense.view'] as const;
const VIEWER = ['fleetCustody.view'] as const;

const paged = <T,>(items: T[], totalItems = items.length) => ({
  items,
  meta: { page: 1, pageSize: 100, totalItems, totalPages: 1 },
});

interface Seed {
  fund?: FleetCustodyFundSummaryDto | null;
  memos?: FleetCustodyMemoRowDto[];
  outside?: FleetCustodyOutsideKindDto[];
  parts?: FleetCustodySettleCandidateDto[] | null;
  rows?: FleetCustodyLedgerRowDto[] | null;
  totalRows?: number;
}
const client = (seed: Seed = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryOnMount: false, staleTime: Infinity, refetchOnMount: false },
    },
  });
  if (seed.fund !== null) qc.setQueryData(custodyQueryKeys.fund(), seed.fund ?? FUND);
  qc.setQueryData(custodyQueryKeys.candidates('replenish'), {
    memos: seed.memos ?? [],
    outside: seed.outside ?? OUTSIDE,
    fundTotal: FUND.fundTotal,
    chargedTotal: 300000,
  });
  if (seed.parts !== null) {
    qc.setQueryData(custodyQueryKeys.candidates('settle'), {
      parts: seed.parts ?? PARTS,
      fundTotal: FUND.fundTotal,
    });
  }
  if (seed.rows !== null) {
    const rows = seed.rows ?? ROWS;
    qc.setQueryData(
      custodyQueryKeys.ledger(CUSTODY_LEDGER_PARAMS),
      paged(rows, seed.totalRows ?? rows.length),
    );
  }
  return qc;
};
/** A read that failed: its error in the cache, nothing to show. */
const failed = (qc: QueryClient, key: readonly unknown[]): QueryClient => {
  qc.getQueryCache()
    .build(qc, { queryKey: key })
    .setState({ status: 'error', error: new Error('boom'), fetchStatus: 'idle' });
  return qc;
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

const draw = (
  node: JSX.Element,
  qc: QueryClient = client(),
  permissions: readonly string[] = ALL,
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
        <MemoryRouter initialEntries={['/fleet/custody']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/\s+/gu, ' ')
    .replace(/\(\s+/gu, '(')
    .replace(/\s+\)/gu, ')')
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
const all = (html: string, attr: string): string[] =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'gu'))].map((m) => m[1] ?? '');
const hrefs = (html: string): string[] => all(html, 'href').map((h) => h.replace(/&amp;/gu, '&'));

// ── The arithmetic ───────────────────────────────────────────────────────────────────────────

describe('the fund’s arithmetic — ages, waiting money, where a line leads', () => {
  it('counts a day’s age in whole UTC days from the board’s day — 30 is not late, 31 is', () => {
    expect(custodyAgeDays('2026-10-19', NOW)).toBe(0);
    expect(custodyAgeDays('2026-10-18', NOW)).toBe(1);
    expect(custodyAgeDays('2026-10-08', NOW)).toBe(11);
    expect(custodyAgeDays('2026-09-07', NOW)).toBe(42);
    // Late in the UTC day or early, the same day.
    expect(custodyAgeDays('2026-10-01', Date.UTC(2026, 9, 19, 0, 0, 1))).toBe(18);
    expect(custodyAgeDays('2026-10-01', Date.UTC(2026, 9, 19, 23, 59, 59))).toBe(18);
    // Across a year and a leap day.
    expect(custodyAgeDays('2027-12-31', Date.UTC(2028, 2, 1))).toBe(61);
    // A day ahead, and what is not a day, read as today.
    expect(custodyAgeDays('2026-10-20', NOW)).toBe(0);
    expect(custodyAgeDays('not a day', NOW)).toBe(0);
    expect(FLEET_CUSTODY_STALE_DAYS).toBe(30);
    expect(custodyIsLate(custodyAgeDays('2026-09-19', NOW))).toBe(false);
    expect(custodyIsLate(custodyAgeDays('2026-09-18', NOW))).toBe(true);
  });

  it('waits what was spent and not replenished — always the fund’s spent less its replenished', () => {
    const now = custodyWaiting([], OUTSIDE, FUND.memos.pendingTotal);
    expect(now).toEqual({ inMemos: 0, outside: 15886, total: 15886, receipts: 33 });
    expect(now.total).toBe(FUND.spent.amount - FUND.replenished.amount);
    const now6 = custodyWaiting([MEMO6], OUTSIDE6, FUND6.memos.pendingTotal);
    expect(now6).toEqual({ inMemos: 600, outside: 15286, total: 15886, receipts: 33 });
    // To the piastre.
    expect(custodyWaiting([], [outsideLine('fuel', 2, 0.1, null)], 0.2).total).toBe(0.3);
    expect(custodySettleWaiting(PARTS)).toBe(69660.75);
    expect(custodySettleWaiting([])).toBe(0);
  });

  it('sends an operation to its drawer and a receipts line to the board over its days', () => {
    expect(custodyLedgerTarget(ROWS[1] as FleetCustodyLedgerRowDto)).toEqual({
      kind: 'operation',
      to: '/fleet/custody/log?open=op-s1',
    });
    expect(custodyLedgerTarget(ROWS[0] as FleetCustodyLedgerRowDto)).toEqual({
      kind: 'period',
      from: '2026-10-06',
      to: '2026-10-18',
    });
    expect(custodyLedgerTarget(row({ op: 'spend', date: '2026-10-06', dateTo: null }))).toEqual({
      kind: 'period',
      from: '2026-10-06',
      to: '2026-10-06',
    });
    expect(custodyPeriodLink('2026-10-06', '2026-10-18')).toBe(
      '/fleet/custody?from=2026-10-06&to=2026-10-18',
    );
    // The ledger's own eye goes the same way.
    expect(read('CustodyLedgerPage.tsx')).toContain(
      'custodyPeriodLink(row.date, row.dateTo ?? row.date)',
    );
  });

  it('draws the step line’s axis over the history — down to a fund below zero', () => {
    const scale = custodyStepScale(ROWS);
    expect(scale.top).toBeGreaterThanOrEqual(299400);
    expect(scale.bottom).toBe(0);
    expect(scale.negative).toBe(false);
    const below = custodyStepScale([row({ before: 1000, after: -15286 })]);
    expect(below.bottom).toBe(-15286);
    expect(below.negative).toBe(true);
    expect(custodyStepScale([]).ticks).toEqual([0]);
  });

  it('splits the spend by its memos’ state — the whole card or one kind', () => {
    expect(custodyMemoStateParts(DASHBOARD.memoStates)).toEqual({
      replenished: 81908,
      pending: 0,
      outside: 15886,
    });
    expect(custodyMemoStateParts(DASHBOARD.memoStates, 'fuel')).toEqual({
      replenished: 49844,
      pending: 0,
      outside: 7876,
    });
    // An older server that sends none: no bar at all.
    expect(custodyMemoStateParts(undefined)).toBeNull();
    expect(custodyNotReplenished({ replenished: 1, pending: 0.1, outside: 0.2 })).toBe(0.3);
  });
});

describe('the fund’s alert lines (a–e)', () => {
  it('raises only washing’s two late receipts at `now` — and nothing once memo 6 holds them', () => {
    const now = custodyFundAlerts({
      fundTotal: FUND.fundTotal,
      outside: OUTSIDE,
      memos: [],
      parts: PARTS,
      now: NOW,
    });
    expect(now).toEqual([
      {
        type: 'stale',
        key: 'stale-wash',
        kind: 'wash',
        count: 2,
        total: 300,
        oldest: '2026-09-07',
      },
    ]);
    expect(
      custodyFundAlerts({
        fundTotal: FUND.fundTotal,
        outside: OUTSIDE6,
        memos: [MEMO6],
        parts: PARTS,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('raises the fund below zero, a late memo, a late licence memo and settlements past the fund', () => {
    const late = custodyFundAlerts({
      fundTotal: -1000,
      outside: OUTSIDE6,
      memos: [
        { ...MEMO6, date: '2026-09-18' },
        { ...MEMO6, id: 'm7', date: '2026-09-19' },
      ],
      parts: [{ ...(PARTS[0] as FleetCustodySettleCandidateDto), date: '2026-09-10' }],
      now: NOW,
    });
    expect(late.map((line) => line.key)).toEqual([
      'negative',
      'memo-m6',
      'licence-lx1-extension',
      'settleOver',
    ]);
    expect(late[0]).toEqual({ type: 'negative', key: 'negative', amount: -1000 });
    expect(late[1]).toMatchObject({ type: 'memo', days: 31 });
    expect(late[2]).toMatchObject({ type: 'licence', days: 39 });
    expect(late[3]).toEqual({ type: 'settleOver', key: 'settleOver', total: 41250, fund: -1000 });
    // Reads on their way raise nothing but what the dashboard itself holds.
    expect(custodyFundAlerts({ fundTotal: 5, now: NOW })).toEqual([]);
    expect(custodyFundAlerts({ fundTotal: -5, now: NOW }).map((line) => line.type)).toEqual([
      'negative',
    ]);
    // No licence waiting is no «تسوية» past the fund, whatever the fund.
    expect(custodyFundAlerts({ fundTotal: -5, parts: [], now: NOW })).toHaveLength(1);
  });

  it('writes washing’s line in the approved words, with «+ مذكرة غسيل» for a writer only', () => {
    const lines = custodyFundAlerts({ fundTotal: FUND.fundTotal, outside: OUTSIDE, now: NOW });
    const html = draw(<CustodyAlerts alerts={DASHBOARD.alerts} fundLines={lines} />);
    // The banner is drawn for the fund's line alone — no audit line under it.
    expect(html).toContain('data-custody-dashboard-section="alerts"');
    expect(html).not.toContain('data-custody-alert="audit"');
    const line = element(html, 'data-custody-alert="fund-stale"');
    expect(text(line)).toContain(
      'إيصالا غسيل (300.00 ج.م.) لم يدخلا أي مذكرة منذ أكثر من 30 يومًا — أقدمهما بتاريخ 2026/09/07',
    );
    expect(hrefs(line)).toEqual(['/fleet/custody/memos/new/wash']);
    expect(text(line)).toContain('مذكرة غسيل');
    const viewer = draw(
      <CustodyAlerts alerts={DASHBOARD.alerts} fundLines={lines} />,
      client(),
      VIEWER,
    );
    expect(hrefs(element(viewer, 'data-custody-alert="fund-stale"'))).toEqual([]);
    // Under the banner's own lines, ruled off from them.
    const both = draw(
      <CustodyAlerts alerts={{ ...DASHBOARD.alerts, receiptsWithoutPhoto: 1 }} fundLines={lines} />,
    );
    expect(both).toContain('data-custody-alert="audit"');
    expect(element(both, 'data-custody-fund-alerts="true"')).toContain('border-t');
    // Nothing to say at all: no banner.
    expect(draw(<CustodyAlerts alerts={DASHBOARD.alerts} fundLines={[]} />)).toBe('');
  });

  it('writes each other line with its way to deal with it', () => {
    const lines = custodyFundAlerts({
      fundTotal: -1000,
      memos: [{ ...MEMO6, date: '2026-09-18' }],
      parts: [{ ...(PARTS[0] as FleetCustodySettleCandidateDto), date: '2026-09-10' }],
      now: NOW,
    });
    const html = draw(<CustodyAlerts alerts={DASHBOARD.alerts} fundLines={lines} />);
    const negative = element(html, 'data-custody-alert="fund-negative"');
    expect(text(negative)).toContain(
      'إجمالي العهدة بالسالب: −1,000.00 ج.م. — صُرف من العهدة أكثر مما شُحن فيها.',
    );
    expect(negative).toContain('text-red-600');
    expect(hrefs(negative)).toEqual(['/fleet/custody/log']);
    const memo = element(html, 'data-custody-alert="fund-memo"');
    expect(text(memo)).toContain('مذكرة غسيل رقم 6 لم تُستعَض منذ 31 يومًا');
    expect(hrefs(memo)).toEqual(['/fleet/custody/memos?status=pending']);
    const licence = element(html, 'data-custody-alert="fund-licence"');
    expect(text(licence)).toContain('مذكرة مد مدة بتاريخ 2026/09/10 لم تُسوَّ منذ 39 يومًا');
    expect(hrefs(licence)).toEqual(['/fleet/license-expenses?kind=extension&status=waiting']);
    const over = element(html, 'data-custody-alert="fund-settleOver"');
    expect(text(over)).toContain(
      'التسويات المنتظرة (41,250.00 ج.م.) تتجاوز إجمالي العهدة الآن (−1,000.00 ج.م.)',
    );
    // Without a board to open it on, «تسوية العهدة» is the board's own address.
    expect(hrefs(over)).toEqual(['/fleet/custody?fund=settle']);
    // A viewer reads every line, and is offered nothing he may not open.
    const viewer = draw(
      <CustodyAlerts alerts={DASHBOARD.alerts} fundLines={lines} />,
      client(),
      VIEWER,
    );
    expect(hrefs(element(viewer, 'data-custody-alert="fund-licence"'))).toEqual([]);
    expect(hrefs(element(viewer, 'data-custody-alert="fund-settleOver"'))).toEqual([]);
    expect(viewer).not.toContain('data-custody-fund-open');
  });
});

// ── N1 «العهدة الآن» ──────────────────────────────────────────────────────────────────────────

describe('N1 «العهدة الآن» — the formula as five tiles, whatever the filters', () => {
  it('heads the section with its scope chip and lays the formula out — each term into «سجل العهدة»', () => {
    const html = draw(<CustodyFundNow data={DASHBOARD} />);
    const heading = element(html, 'data-custody-dashboard-heading="fund"');
    expect(text(heading)).toBe('العهدة الآن من بداية العهدة، ولا تتأثر بالفلاتر');
    expect(heading).toContain('data-custody-scope="true"');
    expect(all(html, 'data-ledger-term')).toEqual(['charged', 'spent', 'replenished', 'settled']);
    const term = (name: string): string => element(html, `data-ledger-term="${name}"`);
    expect(text(term('charged'))).toBe('إجمالي الشحن 300,000.00 ج.م. عمليتا شحن');
    // Each after its sign: «−», «+», «−».
    expect(text(term('spent'))).toBe('− مصروفات الإيصالات 97,794.00 ج.م. 126 إيصالًا');
    expect(text(term('replenished'))).toBe('+ إجمالي الاستعاضة 81,908.00 ج.م. 5 مذكرات');
    expect(text(term('settled'))).toBe('− إجمالي التسوية 124,139.46 ج.م. 3 مصروفات تراخيص');
    expect(hrefs(element(html, 'data-ledger-figures="true"'))).toEqual([
      '/fleet/custody/log?op=charge',
      '/fleet/custody/log?op=spend',
      '/fleet/custody/log?op=replenish',
      '/fleet/custody/log?op=settle',
      '/fleet/custody/log',
    ]);
    // The signs between them, and the fund last: the board's own card, in the dashboard's figure.
    expect(text(element(html, 'data-ledger-term-fund="true"'))).toMatch(/^= إجمالي العهدة/u);
    const fund = element(html, 'data-custody-fund-now="true"');
    expect(text(fund)).toBe('إجمالي العهدة 159,974.54 ج.م. صُرف من إجمالي الشحن 33%');
    expect(fund).toContain(`class="${STRIP_FIGURE.replace(/'/gu, '&#x27;')}"`);
    // The four terms in the same figure — Cairo, unsigned, never the ledger's colours.
    expect(term('charged')).toContain(STRIP_FIGURE.replace(/'/gu, '&#x27;'));
    expect(term('spent')).not.toContain('text-red-600');
    expect(CAIRO).toContain('Cairo');
  });

  it('shows the fund below zero «−X» in red, as the board’s card does', () => {
    const html = draw(
      <CustodyFundNow data={{ ...DASHBOARD, fundTotal: -15286, fundSpent: 315286 }} />,
    );
    const fund = element(html, 'data-custody-fund-now="true"');
    expect(fund).toContain('data-custody-fund-negative="true"');
    expect(text(fund)).toContain('−15,286.00 ج.م.');
  });

  it('shimmers its four terms while the summary is on its way — the fund’s card already there', () => {
    const html = draw(<CustodyFundNow data={DASHBOARD} />, client({ fund: null }));
    expect(all(html, 'data-custody-card-loading')).toEqual([
      'formula',
      'formula',
      'formula',
      'formula',
    ]);
    expect(html).toContain('data-custody-fund-now="true"');
    expect(html).not.toContain('data-ledger-term=');
  });

  it('says its own error with a retry, and leaves the fund’s card in place', () => {
    const qc = failed(client({ fund: null }), custodyQueryKeys.fund());
    const html = draw(<CustodyFundNow data={DASHBOARD} />, qc);
    expect(html).toContain('data-custody-card-error="formula"');
    expect(text(element(html, 'data-custody-card-error="formula"'))).toContain(ar('common.retry'));
    expect(html).toContain('data-custody-fund-now="true"');
  });

  it('is the ledger’s own tiles, lifted — «سجل العهدة» keeps its signed, coloured look', () => {
    const ledger = draw(<LedgerFigures fund={FUND} />);
    expect(ledger).toContain('data-ledger-figures-look="ledger"');
    expect(ledger).toContain('data-ledger-fund-now="159974.54"');
    expect(text(ledger)).toContain('+300,000.00');
    expect(text(ledger)).toContain('−97,794.00');
    expect(ledger).not.toContain('href=');
    expect(read('CustodyLedgerPage.tsx')).toContain(
      "import { LedgerFigures } from '../components/CustodyLedgerFigures';",
    );
    expect(read('CustodyLedgerPage.tsx')).not.toMatch(/const (LedgerFigures|Term|OpChip) =/u);
    expect(read('../components/CustodyDashboardFund.tsx')).toMatch(
      /<CustodyFundCard\s+fundTotal=\{data\.fundTotal\}\s+charged=\{data\.fundCharged\}\s+spent=\{data\.fundSpent\}\s+figure=\{STRIP_FIGURE\}\s+\/>/u,
    );
  });
});

// ── N2 «مبالغ صُرفت ولم تُستعَض بعد» ─────────────────────────────────────────────────────────

describe('N2 «مبالغ صُرفت ولم تُستعَض بعد»', () => {
  it('heads with 15,886.00 from 33 receipts, split in one bar: none in memos, all in no memo', () => {
    const html = draw(<CustodyWaitingCard now={NOW} />);
    const head = element(html, 'data-custody-card-headline="waiting"');
    expect(head).toContain('data-custody-headline-value="15886"');
    expect(text(head)).toBe('15,886.00 ج.م. 33 إيصالًا');
    expect(text(element(html, 'data-custody-dashboard-section="waiting"'))).toContain(
      'مبالغ صُرفت ولم تُستعَض بعد',
    );
    expect(all(html, 'data-custody-waiting-part')).toEqual(['outside']);
    expect(text(element(html, 'data-custody-waiting-legend="inMemos"'))).toBe(
      'في مذكرات لم تُستعَض بعد 0.00 ج.م.',
    );
    expect(text(element(html, 'data-custody-waiting-legend="outside"'))).toBe(
      'إيصالات لم تدخل أي مذكرة بعد 15,886.00 ج.م.',
    );
    expect(text(element(html, 'data-custody-no-pending="true"'))).toBe(
      'لا توجد مذكرات لم تُستعَض بعد.',
    );
  });

  it('lists each kind in no memo with the age of its oldest — washing late, in amber', () => {
    const html = draw(<CustodyWaitingCard now={NOW} />);
    expect(all(html, 'data-custody-outside-kind')).toEqual([
      'maintenance',
      'fuel',
      'tyres',
      'wash',
    ]);
    const kind = (name: string): string => element(html, `data-custody-outside-kind="${name}"`);
    expect(text(kind('maintenance'))).toBe(
      'صيانة 3 إيصالات 5,720.00 ج.م. أقدمها منذ 11 يومًا مذكرة صيانة',
    );
    expect(text(kind('fuel'))).toContain('أقدمها منذ 13 يومًا');
    expect(text(kind('tyres'))).toContain('18 إيصالًا');
    expect(text(kind('wash'))).toContain('أقدمها منذ 42 يومًا');
    expect(kind('wash')).toContain('data-custody-late="true"');
    expect(kind('fuel')).not.toContain('data-custody-late');
    expect(hrefs(kind('wash'))).toEqual(['/fleet/custody/memos/new/wash']);
  });

  it('lists the memos waiting at `now6` — «مذكرة غسيل رقم 6», today — and dims washing’s empty kind', () => {
    const html = draw(
      <CustodyWaitingCard now={NOW} />,
      client({ fund: FUND6, memos: [MEMO6], outside: OUTSIDE6 }),
    );
    expect(element(html, 'data-custody-headline-value="15886"')).toBeTruthy();
    expect(all(html, 'data-custody-waiting-part')).toEqual(['inMemos', 'outside']);
    const memo = element(html, 'data-custody-pending-memo="6"');
    expect(text(memo)).toBe('مذكرة غسيل رقم 6 غسيل 2026/10/19 · 4 إيصالات اليوم 600.00 ج.م.');
    expect(hrefs(memo)).toEqual(['/fleet/custody/memos?status=pending']);
    const wash = element(html, 'data-custody-outside-kind="wash"');
    expect(wash).toContain('opacity-50');
    expect(text(wash)).toBe('غسيل لا توجد إيصالات 0.00 ج.م.');
  });

  it('names five memos, then «+N»', () => {
    const memos = Array.from({ length: 7 }, (_, i) => ({ ...MEMO6, id: `m${i}`, no: i + 1 }));
    const html = draw(<CustodyWaitingCard now={NOW} />, client({ fund: FUND6, memos }));
    expect(all(html, 'data-custody-pending-memo')).toHaveLength(5);
    expect(text(element(html, 'data-custody-more-memos="true"'))).toBe('+2');
  });

  it('offers «استعاضة العهدة» and «+ مذكرة» to a writer only — «عرض المذكرات» to all', () => {
    const writer = draw(<CustodyWaitingCard now={NOW} />);
    expect(text(element(writer, 'data-custody-fund-open="replenish"'))).toBe('استعاضة العهدة');
    // With no board behind it, the board's own address opens the dialog.
    expect(hrefs(element(writer, 'data-custody-fund-open="replenish"'))).toEqual([
      '/fleet/custody?fund=replenish',
    ]);
    const onBoard = draw(<CustodyWaitingCard now={NOW} onFundAction={() => undefined} />);
    expect(element(onBoard, 'data-custody-fund-open="replenish"')).toMatch(/^<button/u);
    const viewer = draw(<CustodyWaitingCard now={NOW} />, client(), VIEWER);
    expect(viewer).not.toContain('data-custody-fund-open');
    expect(viewer).not.toContain('data-custody-make-memo');
    expect(hrefs(viewer)).toContain('/fleet/custody/memos');
  });

  it('shimmers while its reads are on their way, and says its own error with a retry', () => {
    expect(draw(<CustodyWaitingCard now={NOW} />, client({ fund: null }))).toContain(
      'data-custody-card-loading="waiting"',
    );
    const qc = failed(new QueryClient(), custodyQueryKeys.candidates('replenish'));
    qc.setDefaultOptions({ queries: { retry: false, retryOnMount: false } });
    expect(draw(<CustodyWaitingCard now={NOW} />, qc)).toContain(
      'data-custody-card-error="waiting"',
    );
  });
});

// ── N3 «مصروفات تراخيص لم تُسوَّ بعد» ─────────────────────────────────────────────────────────

describe('N3 «مصروفات تراخيص لم تُسوَّ بعد»', () => {
  it('heads with 69,660.75 of two licensing memos, oldest day first, each with its age', () => {
    const html = draw(<CustodySettleCard now={NOW} />);
    const head = element(html, 'data-custody-card-headline="settle"');
    expect(text(head)).toBe('69,660.75 ج.م. مصروفا تراخيص');
    expect(all(html, 'data-custody-settle-row')).toEqual(['extension', 'renewal']);
    const extension = element(html, 'data-custody-settle-row="extension"');
    expect(text(extension)).toContain('مد مدة 23 سيارة');
    expect(text(extension)).toContain('2026/10/01');
    expect(text(extension)).toContain('41,250.00 ج.م.');
    expect(text(extension)).toContain('منذ 18 يومًا');
    expect(text(extension)).toContain('و19 سيارة أخرى');
    expect(extension).toContain('title="فيزا 34,500.00 • نقدي 6,750.00"');
    const renewal = element(html, 'data-custody-settle-row="renewal"');
    expect(text(renewal)).toContain('تجديد 4 سيارات');
    expect(text(renewal)).toContain('28,410.75 ج.م.');
    expect(text(renewal)).toContain('منذ 16 يومًا');
  });

  it('leads a row to «مصروفات التراخيص» only for a reader of them; «تسوية العهدة» for a writer', () => {
    const html = draw(<CustodySettleCard now={NOW} />);
    const extension = element(html, 'data-custody-settle-row="extension"');
    expect(extension).toMatch(/^<a /u);
    expect(extension.slice(0, extension.indexOf('>'))).toContain(
      'href="/fleet/license-expenses?kind=extension&amp;status=waiting"',
    );
    expect(text(element(html, 'data-custody-fund-open="settle"'))).toBe('تسوية العهدة');
    expect(html).toContain('href="/fleet/license-expenses?status=waiting"');
    const viewer = draw(<CustodySettleCard now={NOW} />, client(), VIEWER);
    expect(element(viewer, 'data-custody-settle-row="extension"')).toMatch(/^<div/u);
    expect(viewer).not.toContain('/fleet/license-expenses');
    expect(viewer).not.toContain('data-custody-fund-open');
  });

  it('says so when nothing waits', () => {
    const html = draw(<CustodySettleCard now={NOW} />, client({ parts: [] }));
    expect(text(element(html, 'data-custody-no-settle="true"'))).toBe(
      'لا توجد مذكرات مصروفات تراخيص لم تُسوَّ بعد.',
    );
    expect(text(element(html, 'data-custody-card-headline="settle"'))).toBe(
      '0.00 ج.م. 0 مصروفات تراخيص',
    );
  });
});

// ── N4 and N5 — the fund after each operation, and the newest of them ─────────────────────────

describe('N4 «إجمالي العهدة بعد كل عملية»', () => {
  it('steps through the history oldest first — the last point «الآن 159,974.54»', () => {
    const html = draw(<CustodyFundSteps />);
    expect(all(html, 'data-custody-step-op')).toEqual([
      'charge',
      'spend',
      'replenish',
      'charge',
      'settle',
      'spend',
    ]);
    expect(text(element(html, 'data-custody-now-label="true"'))).toBe('الآن 159,974.54');
    // Each step its amount, two decimals each.
    for (const amount of [
      '+100,000.00',
      '−82,508.00',
      '+81,908.00',
      '+200,000.00',
      '−124,139.46',
      '−15,286.00',
    ]) {
      expect(text(html), amount).toContain(amount);
    }
    // The readout opens on the latest line.
    const readout = element(html, 'data-custody-step-readout=');
    expect(text(readout)).toBe(
      'مصروفات الإيصالات 2026/10/06 إلى 2026/10/18 −15,286.00 ج.م. بعدها 159,974.54 ج.م. الآن',
    );
    expect(text(html)).toContain('4 عمليات + سطرا مصروفات');
    expect(html).not.toContain('data-custody-steps-capped');
    expect(html).not.toContain('data-custody-steps-negative');
  });

  it('says «آخر 100 عملية» past one page, and bands the fund below zero in red', () => {
    const capped = draw(<CustodyFundSteps />, client({ totalRows: 140 }));
    expect(text(element(capped, 'data-custody-steps-capped="true"'))).toBe('آخر 100 عملية');
    const below = draw(
      <CustodyFundSteps />,
      client({
        rows: [
          row({ id: 's', op: 'spend', amount: -20000, before: 5000, after: -15000, latest: true }),
          row({ id: 'c', amount: 5000, before: 0, after: 5000 }),
        ],
      }),
    );
    expect(below).toContain('data-custody-steps-negative="true"');
    expect(text(element(below, 'data-custody-now-label="true"'))).toBe('الآن −15,000.00');
  });

  it('says so when the fund has no history yet, and shimmers on its way', () => {
    expect(
      text(
        element(
          draw(<CustodyFundSteps />, client({ rows: [] })),
          'data-custody-steps-empty="true"',
        ),
      ),
    ).toBe('لا توجد عمليات على العهدة بعد.');
    expect(draw(<CustodyFundSteps />, client({ rows: null }))).toContain(
      'data-custody-card-loading="steps"',
    );
  });
});

describe('N5 «آخر عمليات العهدة»', () => {
  it('lists the six newest lines in the log’s own words — the newest «الآن»', () => {
    const html = draw(<CustodyRecentOps />);
    const lines = all(html, 'data-custody-recent-row');
    expect(lines).toEqual(['spend', 'settle', 'charge', 'replenish', 'spend', 'charge']);
    const first = element(html, 'data-custody-recent-row="spend"');
    expect(text(first)).toContain('29 إيصالًا صُرفت من العهدة');
    expect(text(first)).toContain('2026/10/06 إلى 2026/10/18');
    expect(text(first)).toContain('−15,286.00 ج.م.');
    expect(text(first)).toContain('بعدها 159,974.54 الآن');
    expect(text(element(html, 'data-custody-recent-row="charge"'))).toContain(
      'نظير 24 سياره تجديد + 23 سياره مد مده',
    );
    expect(text(element(html, 'data-custody-recent-row="settle"'))).toContain('بعدها 175,260.54');
    expect(html).toContain('href="/fleet/custody/log"');
  });

  it('opens an operation’s drawer, and the board over a receipts line’s days', () => {
    const html = draw(<CustodyRecentOps />);
    expect(hrefs(html)).toEqual([
      '/fleet/custody?from=2026-10-06&to=2026-10-18',
      '/fleet/custody/log?open=op-s1',
      '/fleet/custody/log?open=op-c2',
      '/fleet/custody/log?open=op-r1',
      '/fleet/custody?from=2026-09-01&to=2026-09-28',
      '/fleet/custody/log?open=op-c1',
      '/fleet/custody/log',
    ]);
    // On the board, a receipts line sets its «من» / «إلى» and the dashboard stays open.
    const onBoard = draw(<CustodyRecentOps onShowPeriod={() => undefined} />);
    expect(element(onBoard, 'data-custody-recent-row="spend"')).toMatch(/^<button/u);
    expect(element(onBoard, 'data-custody-recent-row="settle"')).toMatch(/^<a /u);
  });

  it('writes «بعدها» below zero in red', () => {
    const html = draw(
      <CustodyRecentOps />,
      client({ rows: [row({ id: 'c', amount: -500, before: 100, after: -400, latest: true })] }),
    );
    const after = element(html, 'data-custody-recent-after="-400"');
    expect(text(after)).toContain('−400.00');
    expect(after).toContain('text-red-600');
  });
});

// ── N7 and the layout ────────────────────────────────────────────────────────────────────────

describe('«مصروفات العهدة حسب الفلاتر» — five spend cards, each with its memos’ state (N7)', () => {
  it('splits the total — 81,908.00 replenished, 0.00 in memos, 15,886.00 in no memo', () => {
    const html = draw(<CustodyKpis data={DASHBOARD} />);
    expect(all(html, 'data-custody-kpi')).toEqual([
      'total',
      'maintenance',
      'fuel',
      'tyres',
      'wash',
    ]);
    const total = element(html, 'data-custody-memo-states="total"');
    expect(text(total)).toBe(
      'تمت الاستعاضة 81,908.00 في مذكرات لم تُستعَض 0.00 خارج المذكرات 15,886.00',
    );
    expect(all(total, 'data-custody-memo-state')).toEqual(['replenished', 'outside']);
    expect(hrefs(total)).toEqual([
      '/fleet/custody/memos',
      '/fleet/custody/memos?status=pending',
      '/fleet/custody/memos',
    ]);
  });

  it('adds «لم تُستعَض: X» to a kind only when some of it waits', () => {
    const html = draw(<CustodyKpis data={DASHBOARD} />);
    for (const [kind, waiting] of [
      ['maintenance', '5,720.00'],
      ['fuel', '7,876.00'],
      ['tyres', '1,690.00'],
      ['wash', '600.00'],
    ] as const) {
      const line = element(html, `data-custody-memo-waiting="${kind}"`);
      expect(text(line), kind).toBe(`لم تُستعَض: ${waiting}`);
      expect(hrefs(line), kind).toEqual(['/fleet/custody/memos']);
    }
    // At `now6` washing waits in memo 6: to the memos waiting.
    const now6 = draw(
      <CustodyKpis
        data={{
          ...DASHBOARD,
          memoStates: {
            ...DASHBOARD.memoStates,
            pending: {
              count: 4,
              amount: 600,
              byKind: byKind([0, 0], [0, 0], [0, 0], [4, 600]),
            },
            outside: {
              count: 29,
              amount: 15286,
              byKind: byKind([3, 5720], [8, 7876], [18, 1690], [0, 0]),
            },
          },
        }}
      />,
    );
    expect(hrefs(element(now6, 'data-custody-memo-waiting="wash"'))).toEqual([
      '/fleet/custody/memos?status=pending',
    ]);
    // Nothing waiting: no line.
    const settled = draw(
      <CustodyKpis
        data={{
          ...DASHBOARD,
          memoStates: {
            ...DASHBOARD.memoStates,
            outside: { count: 0, amount: 0, byKind: byKind([0, 0], [0, 0], [0, 0], [0, 0]) },
          },
        }}
      />,
    );
    expect(settled).not.toContain('data-custody-memo-waiting');
  });

  it('draws no bar for an older server that sends no state', () => {
    const older: Partial<FleetCustodyDashboardDto> = { ...DASHBOARD };
    delete older.memoStates;
    const html = draw(<CustodyKpis data={older as FleetCustodyDashboardDto} />);
    expect(html).not.toContain('data-custody-memo-states');
    expect(all(html, 'data-custody-kpi')).toHaveLength(5);
  });
});

describe('the dashboard’s two scopes, in the approved order', () => {
  it('puts «العهدة الآن» and its four cards first, then «مصروفات العهدة حسب الفلاتر»', () => {
    const html = draw(<CustodyDashboardBody data={DASHBOARD} now={NOW} />);
    expect(all(html, 'data-custody-dashboard-section')).toEqual([
      'alerts',
      'fund',
      'waiting',
      'settle',
      'steps',
      'recent',
      'kpis',
      'timeline',
      'byKindSource',
      'topCars',
      'topDrivers',
      'fuel',
    ]);
    expect(all(html, 'data-custody-dashboard-heading')).toEqual(['fund', 'spend']);
    const spend = element(html, 'data-custody-dashboard-heading="spend"');
    expect(text(spend)).toBe('مصروفات العهدة حسب الفلاتر');
    expect(spend).not.toContain('data-custody-scope');
    // The banner carries washing's line, read from the same candidates as the card.
    expect(html).toContain('data-custody-alert="fund-stale"');
  });

  it('keeps the body drawn while every fund card is still on its way', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = draw(<CustodyDashboardBody data={DASHBOARD} now={NOW} />, qc);
    expect(all(html, 'data-custody-card-loading')).toEqual([
      'formula',
      'formula',
      'formula',
      'formula',
      'waiting',
      'settle',
      'steps',
      'recent',
    ]);
    expect(all(html, 'data-custody-dashboard-section')).toEqual([
      'fund',
      'kpis',
      'timeline',
      'byKindSource',
      'topCars',
      'topDrivers',
      'fuel',
    ]);
  });

  it('wires the board: «استعاضة / تسوية العهدة» close the dashboard and open its dialog; a receipts line sets «من» / «إلى»', () => {
    const page = read('CustodyPage.tsx');
    expect(page).toContain('const [, setFund] = useFundParam();');
    expect(page).toMatch(
      /onFundAction=\{\(op\) => \{\s*setDashOpen\(false\);\s*setFund\(op\);\s*\}\}/u,
    );
    expect(page).toContain(
      'onShowPeriod={(periodFrom, periodTo) => patch({ from: periodFrom, to: periodTo })}',
    );
    const modal = read('../components/CustodyDashboard.tsx');
    expect(modal).toContain('onFundAction={onFundAction}');
    expect(modal).toContain('onShowPeriod={onShowPeriod}');
  });

  it('speaks formal Arabic in the approved words — and English beside it', () => {
    for (const [key, words] of [
      ['fund.heading', 'العهدة الآن'],
      ['fund.scope', 'من بداية العهدة، ولا تتأثر بالفلاتر'],
      ['spend.heading', 'مصروفات العهدة حسب الفلاتر'],
      ['waiting.title', 'مبالغ صُرفت ولم تُستعَض بعد'],
      ['waiting.inMemos', 'في مذكرات لم تُستعَض بعد'],
      ['settle.title', 'مصروفات تراخيص لم تُسوَّ بعد'],
      ['steps.title', 'إجمالي العهدة بعد كل عملية'],
      ['recent.title', 'آخر عمليات العهدة'],
      ['recent.showLog', 'عرض سجل العهدة'],
      ['waiting.showMemos', 'عرض المذكرات'],
      ['age.today', 'اليوم'],
    ] as const) {
      expect(ar(`${D}.${key}`), key).toBe(words);
      expect(translate('en', `${D}.${key}`), key).not.toBe(`${D}.${key}`);
    }
    expect(ar(`${D}.age.few`, { count: '5' })).toBe('منذ 5 أيام');
    expect(ar(`${D}.age.many`, { count: '42' })).toBe('منذ 42 يومًا');
  });
});
