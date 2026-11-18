// «لوحة تحكم الحركة» — «الوقود والمصروفات», the owner-approved sample (approved/fuel-dark.png and
// fuel-branch-dark.png; harness zz-fuel.tsx; DECISIONS §8, every recommendation, the critic's 24
// corrections and the look L2, then «تمام»; plan build-vf §6), a NEW tab of «الآن» and a period both.
//
// What this file pins: the words and the order the owner approved; every figure reads its server
// field (`fuelCharging.*`, `fuelCards.*`, `fuelCardList.total`, `fuelSheets.*`, `opex.*`,
// `opexSeries`, `dealership.*`, `dealershipList.more` — never a list's length) and opens the list
// that shows it, or nothing when no list does (the sheet's figures, the litres, the receipts' and
// rows' counts on the chips, the pending amount); the figures follow the card's CURRENT car's
// branch, so «الآن»'s links carry it (a row's «فتح» never does); the tones (neutral balance cards
// with the company's register colour, amber requests / low / expiry, emerald «شُحن اليوم», sky
// receipts, violet dealership, brand bars and columns); the cards on no car in the company view
// only; the sheet card's plain figures and edge texts; the cards table's order, words and «فتح»
// (critic C6); the bars' fixed order and links; the chart's empty slots, today and Fridays, and its
// month variant; the dealership table's order and pending phrase; the two never summed; the dual
// counts («كارت واحد»، «كارتان»، «طلبان»، «صفّان»); each band its own read's face; each part its
// own gate; the words the tab never says.
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_DEALERSHIP_ROWS,
  FLEET_DASHBOARD_FUEL_CARD_ROWS,
  type FleetDashboardNowDto,
  type FleetDashboardNowFuelCardRowDto,
  type FleetDashboardOpexBucketDto,
  type FleetDashboardPeriodDealershipRowDto,
  type FleetDashboardPeriodDto,
  type LocalizedString,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import { dualForm } from './components/fleet-dashboard/tab-fuel-words';
import {
  ALL_KEYS,
  B1,
  NOW_DTO,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { FROM_30, PERIOD_FULL, PERIOD_YEAR } from './fleet-dashboard-period-fixtures';

// ── The figures ───────────────────────────────────────────────────────────────────────────────

const named = (arName: string, en: string): LocalizedString => ({ ar: arName, en });
const SPRINTER = named('مرسيدس اسبرانتر 515', 'Mercedes Sprinter 515');
const ATEGO = named('مرسيدس اسيليو 915', 'Mercedes Atego 915');
const LAND = named('تويوتا لاند كروزر', 'Toyota Land Cruiser');
const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };

type CardRow = FleetDashboardNowFuelCardRowDto;
const cardRow = (
  over: Partial<CardRow> & Pick<CardRow, 'cardId' | 'number' | 'states'>,
): CardRow => ({
  company: 'wataniya',
  vehicleId: null,
  code: null,
  typeName: null,
  vehicleDeleted: false,
  label: null,
  balance: 1_240,
  requestedAmount: null,
  expiresAt: '2027-06-15',
  ...over,
});
const onCar = (code: string, typeName: LocalizedString = SPRINTER) => ({
  vehicleId: `v${code}`,
  code,
  typeName,
});

/** «كروت تحتاج متابعة» — eight of fourteen, in the server's urgency order. */
const ROWS: CardRow[] = [
  cardRow({
    cardId: 'k1',
    number: '7045112000984417',
    ...onCar('290'),
    expiresAt: '2026-10-28',
    states: ['expired'],
  }),
  // A card on no car: named by its label, opened by its number.
  cardRow({
    cardId: 'k2',
    number: '6011000000000736',
    company: 'chillout',
    label: 'اسبير 2',
    balance: 860,
    expiresAt: '2026-10-20',
    states: ['expired'],
  }),
  cardRow({
    cardId: 'k3',
    number: '7045112000982583',
    ...onCar('214'),
    balance: 65,
    requestedAmount: 8_000,
    expiresAt: '2027-02-18',
    states: ['critical', 'requested'],
  }),
  cardRow({
    cardId: 'k4',
    number: '7045112000986390',
    ...onCar('122', ATEGO),
    balance: 1_480,
    requestedAmount: 7_500,
    expiresAt: '2027-05-09',
    states: ['requested'],
  }),
  cardRow({
    cardId: 'k5',
    number: '7045112000981724',
    ...onCar('167', ATEGO),
    balance: 180,
    requestedAmount: 10_000,
    states: ['requested', 'low'],
  }),
  // A car deleted from the registry since: no record link, «فتح» by the number.
  cardRow({
    cardId: 'k6',
    number: '6011000000005068',
    company: 'chillout',
    ...onCar('305', ATEGO),
    vehicleDeleted: true,
    balance: 920,
    requestedAmount: 5_000,
    expiresAt: null,
    states: ['requested'],
  }),
  cardRow({
    cardId: 'k7',
    number: '6011000000003851',
    company: 'chillout',
    ...onCar('318'),
    balance: 240,
    requestedAmount: 7_000,
    states: ['requested', 'low'],
  }),
  cardRow({
    cardId: 'k8',
    number: '6011000000009472',
    company: 'chillout',
    ...onCar('156'),
    balance: 275,
    states: ['low'],
  }),
];

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  fuelCards: { warnDays: 30, expired: 2, expiring: 3, nearest: '2026-11-08' },
  fuelCharging: {
    wataniya: 296_480,
    chillout: 189_770,
    requested: { count: 5, amount: 37_500 },
    low: { belowYellow: 7, belowRed: 1, yellowAt: 300, redAt: 100 },
    charged24h: 15_000,
    cards: 142,
    companyCards: { wataniya: 86, chillout: 56 },
    unassigned: { count: 6, balance: 9_870 },
  },
  fuelCardList: { rows: ROWS, total: 14 },
  fuelSheets: {
    wataniya: {
      sheetDate: '2026-10-28',
      readDay: '2026-10-28',
      differing: 9,
      undecided: 3,
      undecidedNet: -1_365,
    },
    chillout: {
      sheetDate: '2026-10-25',
      readDay: '2026-10-25',
      differing: 4,
      undecided: 0,
      undecidedNet: 0,
    },
  },
  unavailable: [],
};

/** The switcher on «المهندسين»: both reads echo it; the server leaves the no-car cards out. */
const NOW_BRANCH: FleetDashboardNowDto = {
  ...NOW,
  branchId: B1,
  scopeBranches: [CAIRO],
  fuelCards: { warnDays: 30, expired: 0, expiring: 1, nearest: '2026-11-19' },
  fuelCharging: {
    wataniya: 71_320,
    chillout: 44_180,
    requested: { count: 2, amount: 15_000 },
    low: { belowYellow: 3, belowRed: 1, yellowAt: 300, redAt: 100 },
    charged24h: 5_000,
    cards: 34,
    companyCards: { wataniya: 21, chillout: 13 },
    unassigned: null,
  },
  fuelCardList: { rows: [ROWS[2] as CardRow, ROWS[6] as CardRow], total: 2 },
  fuelSheets: {
    // A session stored before the sheet's day was recorded; its one undecided line nets to 0.
    wataniya: {
      sheetDate: null,
      readDay: '2026-10-29',
      differing: 3,
      undecided: 1,
      undecidedNet: 0,
    },
    // No sheet of this company was ever read.
    chillout: null,
  },
};

type Opex = NonNullable<FleetDashboardPeriodDto['opex']>;
type DealerRow = FleetDashboardPeriodDealershipRowDto;

/** card + fuelCustody + tyres + wash + maintenance = total; card + fuelCustody = fuel. */
const OPEX: Opex = {
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
  // The custody-paid receipts of the 574 («العهدة»'s; the fuel tab reads none).
  custodyCount: 236,
};

/** EVERY day of the last 30 days; 10/10 had no receipt (an empty slot), today is the last. */
const day = (i: number): string => {
  const at = new Date(`${FROM_30}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + i);
  return at.toISOString().slice(0, 10);
};
const EMPTY = '2026-10-10';
const BUCKETS: FleetDashboardOpexBucketDto[] = Array.from({ length: 30 }, (_, i) => {
  const key = day(i);
  return key === EMPTY
    ? { key, hasRows: false, amount: 0, count: 0 }
    : { key, hasRows: true, amount: 4_000 + (i % 5) * 1_500, count: 10 + i };
});

const dealerRow = (
  over: Partial<DealerRow> & Pick<DealerRow, 'id' | 'code' | 'date'>,
): DealerRow => ({
  vehicleId: `v${over.code}`,
  typeName: SPRINTER,
  vehicleDeleted: false,
  workKind: 'repair',
  workTypeLabel: 'إصلاح',
  invoiceNumber: null,
  invoiceAmount: null,
  ...over,
});

/** The dealership screen's first page: exit day newest first, then the newest recorded. */
const DEALER_ROWS: DealerRow[] = [
  dealerRow({ id: 'd1', code: '263', date: '2026-10-31' }),
  dealerRow({
    id: 'd2',
    code: '142',
    typeName: ATEGO,
    date: '2026-10-30',
    workTypeLabel: 'إصلاح (سمكرة)',
    invoiceNumber: '60417',
    invoiceAmount: 3_850,
  }),
  // The «صيانة + إصلاح» pair of one visit: two rows, «إصلاح» above as the register orders them.
  dealerRow({
    id: 'd3',
    code: '221',
    typeName: LAND,
    date: '2026-10-29',
    invoiceNumber: '60389',
    invoiceAmount: 1_960,
  }),
  dealerRow({
    id: 'd4',
    code: '221',
    typeName: LAND,
    date: '2026-10-29',
    workKind: 'maintenance',
    workTypeLabel: 'صيانة',
    invoiceNumber: '60388',
    invoiceAmount: 2_780,
  }),
  // A car deleted since: no record link.
  dealerRow({
    id: 'd5',
    code: '231',
    date: '2026-10-29',
    vehicleDeleted: true,
    workKind: 'maintenance',
    workTypeLabel: 'صيانة',
  }),
  // An old-book row on a car the registry never had: its code alone.
  dealerRow({
    id: 'd6',
    code: '318 ق',
    vehicleId: null,
    typeName: null,
    date: '2026-10-28',
    workTypeLabel: 'إصلاح (تغيير زجاج)',
    invoiceNumber: '60352',
    invoiceAmount: 1_640,
  }),
];

const COMPANY_SCOPE: FleetDashboardPeriodDto['vehicleScope'] = {
  count: null,
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
  branchId: null,
  scopeBranches: null,
};

const PAGE: FleetDashboardPeriodDto = {
  ...PERIOD_FULL,
  vehicleScope: COMPANY_SCOPE,
  opex: OPEX,
  opexSeries: { buckets: BUCKETS },
  dealership: { amount: 96_750, rows: 42, pending: 3, dataFrom: '2026-01-01' },
  dealershipList: { rows: DEALER_ROWS, more: 36 },
  unavailable: [],
};
const PAGE_BRANCH: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] },
};

/** «هذه السنة»: the receipts by the month; February had none. */
const MONTHS = PERIOD_YEAR.range;
const PAGE_YEAR: FleetDashboardPeriodDto = {
  ...PAGE,
  range: MONTHS,
  opexSeries: {
    buckets: [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ].map((key) =>
      key === '2026-02'
        ? { key, hasRows: false, amount: 0, count: 0 }
        : { key, hasRows: true, amount: 180_000, count: 520 },
    ),
  },
};

const URL_30 = '/fleet?tab=fuel&period=last30';
const URL_YEAR = '/fleet?tab=fuel&period=thisYear';
const DAYS = { from: FROM_30, to: TODAY };

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────

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

const client = ({
  now = NOW,
  page = PAGE,
  url = URL_30,
  nowFails = false,
  pageFails = false,
}: {
  /** `null`: R1 not answered yet. */
  now?: FleetDashboardNowDto | null;
  /** `null`: R2 not answered yet. */
  page?: FleetDashboardPeriodDto | null;
  url?: string;
  nowFails?: boolean;
  pageFails?: boolean;
} = {}): QueryClient => {
  const qc = dashboardClient({ now: nowFails ? null : now, period: null });
  if (nowFails) failed(qc, fleetDashboardKeys.now);
  if (pageFails) failed(qc, pageKey(url));
  else if (page !== null) qc.setQueryData(pageKey(url), page);
  return qc;
};

const tab = (
  seed: Parameters<typeof client>[0] = {},
  permissions: readonly string[] = ALL_KEYS,
): string => {
  const html = renderDashboard({ url: seed.url ?? URL_30, client: client(seed), permissions });
  const at = html.indexOf('data-dash-tab-body="fuel"');
  if (at === -1) throw new Error('no fuel tab body');
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
    .replace(/ ([).،:])/gu, '$1');
/** Every link of the markup, with its figure name. */
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
/** The markup from an element that carries `attr="value"` up to the next `next` (or the end). */
const slice = (html: string, attr: string, value: string, next = `${attr}=`): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const end = html.indexOf(next, start + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : end);
};
/** The tab's parts, in their order: a card or a block runs to the next one of them. */
const PARTS = [
  'data-fuel-kpi=',
  'data-fuel-block=',
  'data-fuel-band=',
  'data-fuel-opex=',
  'data-fuel-dealer=',
  'data-fuel-nocar=',
  'data-fuel-not-summed=',
];
const part = (html: string, attr: string, value: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const from = start + attr.length + value.length + 3;
  const ends = PARTS.map((marker) => html.indexOf(marker, from)).filter((at) => at !== -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
const kpi = (html: string, id: string): string => part(html, 'data-fuel-kpi', id);
const block = (html: string, id: string): string => part(html, 'data-fuel-block', id);
const opexCard = (html: string): string => part(html, 'data-fuel-opex', 'card');
const dealerCard = (html: string): string => part(html, 'data-fuel-dealer', 'card');
const cardRowOf = (html: string, id: string): string => slice(html, 'data-fuel-card', id, '</tr>');
const dealerRowOf = (html: string, id: string): string =>
  slice(html, 'data-fuel-dealer-row', id, '</tr>');
const barOf = (html: string, key: string): string => slice(html, 'data-fuel-bar', key, '</li>');
const sheetOf = (html: string, company: string): string =>
  slice(html, 'data-fuel-sheet', company, 'data-fuel-sheet=');
/** The «الآن» band: from its head to the period band. */
const nowBand = (html: string): string =>
  html.slice(html.indexOf('data-fuel-band="now"'), html.indexOf('data-fuel-band="period"'));
/** The counted noun as the dashboard writes it (custodyCountForm). */
const noun = (key: string, n: number): string => {
  const tail = n % 100;
  const form = n === 1 ? 'one' : n === 0 || (tail >= 2 && tail <= 10) ? 'few' : 'other';
  return ar(`fleet.dash.common.noun.${key}.${form}`);
};
/** The tab's own counted words, one and two in words. */
const dual = (key: string, n: number): string =>
  ar(`fleet.dash.fuel.count.${key}.${dualForm('ar', n)}`, { count: n.toLocaleString('en-US') });
const w = (key: string, params?: Record<string, string | number>): string =>
  ar(`fleet.dash.fuel.${key}`, params);

const DEFAULT = tab();
const BRANCH = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
const PERIOD_ONLY = (html: string): string => html.slice(html.indexOf('data-fuel-band="period"'));

// ── 1 · The heading, the bands and the order ─────────────────────────────────────────────────

describe('«الوقود والمصروفات» — the heading, the two bands and the approved order', () => {
  it('heads the tab with the approved title and line, no live chip (it is a period tab too)', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-fuel-band="now"'));
    expect(text(head)).toContain(w('heading'));
    expect(text(head)).toContain(w('headingSub'));
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('draws «الآن» first with its live chip, «خلال الفترة» with its range, line and the bar', () => {
    const now = slice(DEFAULT, 'data-dash-band', 'now', 'data-read-band');
    expect(text(now)).toContain(w('now'));
    expect(now).toContain('data-live-chip="true"');
    const period = slice(DEFAULT, 'data-dash-band', 'period', 'data-period-filters');
    expect(text(period)).toContain(w('period'));
    expect(period).toContain('data-dash-range="last30"');
    expect(text(period)).toContain(w('periodSub'));
    expect(DEFAULT.match(/data-period-filters="true"/gu)).toHaveLength(1);
    const bar = DEFAULT.indexOf('data-period-filters="true"');
    expect(bar).toBeGreaterThan(DEFAULT.indexOf('data-dash-band="period"'));
    expect(bar).toBeLessThan(DEFAULT.indexOf('data-fuel-opex="card"'));
  });

  it('draws the six cards, the note, the sheet, the table, then the period in the approved order', () => {
    const order = [
      'data-dash-band="now"',
      'data-fuel-kpi="wataniya"',
      'data-fuel-kpi="chillout"',
      'data-fuel-kpi="requests"',
      'data-fuel-kpi="low"',
      'data-fuel-kpi="charged"',
      'data-fuel-kpi="expiring"',
      'data-fuel-nocar=',
      'data-fuel-block="sheets"',
      'data-fuel-block="cards"',
      'data-dash-band="period"',
      'data-period-filters="true"',
      'data-fuel-opex="card"',
      'data-fuel-dealer="card"',
      'data-fuel-not-summed="true"',
      'data-fuel-block="bars"',
      'data-fuel-block="chart"',
      'data-fuel-block="dealer-table"',
      'data-fuel-note="asOfNow"',
    ].map((marker) => DEFAULT.indexOf(marker));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lays the six cards one row from 1800 px, 3 + 3 below, 2 from sm, 1 on a phone', () => {
    const grid = slice(DEFAULT, 'data-fuel-kpis', 'now', '>');
    for (const cls of [
      'grid-cols-1',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      'min-[1800px]:grid-cols-6',
    ]) {
      expect(grid, cls).toContain(cls);
    }
  });

  it('never says what the owner dropped (Phase 2, budgets, per-km) nor draws a sample', () => {
    const words = text(DEFAULT);
    for (const word of [
      'تكلفة الكيلو',
      'أغلى',
      'ميزانية',
      'المستهدف',
      'متوقع',
      'ج.م/كم',
      'لتر لكل 100',
      'L / 100',
      'تصدير',
      'CSV',
      'مراجعة مالية',
      'شحن عاجل',
      'إصدار أمر فحص',
      'توزيع التكاليف',
    ]) {
      expect(words, word).not.toContain(word);
    }
    expect(DEFAULT).not.toMatch(/data-zz-/u);
  });

  it('calls a dealership row with no amount «بانتظار الفاتورة», the dealership screen’s word (D39)', () => {
    // The audit (D39) moved the dashboard to the register's word; the build's «بانتظار تسجيل القيمة»
    // is gone from the card line and the table tag alike.
    const words = text(DEFAULT);
    expect(ar('fleet.dash.fuel.dealerTable.pendingTag')).toBe(ar('fleet.dealership.pending'));
    expect(words).toContain(ar('fleet.dash.fuel.dealer.pending', { rows: '3 صفوف' }));
    expect(words).toContain('بانتظار الفاتورة');
    expect(words).not.toContain('بانتظار تسجيل القيمة');
  });

  it('counts nothing in the browser and never reaches for a sample file', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'components/fleet-dashboard');
    const files = readdirSync(dir).filter((name) => name.startsWith('tab-fuel'));
    expect(files.sort()).toEqual([
      'tab-fuel-chart.tsx',
      'tab-fuel-now.tsx',
      'tab-fuel-period.tsx',
      'tab-fuel-words.tsx',
      'tab-fuel.tsx',
    ]);
    for (const name of files) {
      const src = readFileSync(join(dir, name), 'utf8');
      expect(src, name).not.toMatch(/\.reduce\(/u);
      expect(src, name).not.toMatch(/\.filter\([^)]*\)\.length/u);
      expect(src, name).not.toMatch(/count\([\w.?]+\.length\)/u);
      expect(src, name).not.toMatch(/\{[\w.?]+\.length\}/u);
      expect(src, name).not.toMatch(/from '[^']*zz-/u);
      expect(src, name).not.toContain('data-zz-');
    }
  });
});

// ── 2 · «الآن»: the six cards ────────────────────────────────────────────────────────────────

describe('«الآن» — the six cards, each its own field and its own list', () => {
  it('the two balances: a NEUTRAL card, the company’s dot and word in its register colour (C1)', () => {
    for (const [company, tone, amount, cards] of [
      ['wataniya', 'emerald', '296,480.00', 86],
      ['chillout', 'amber', '189,770.00', 56],
    ] as const) {
      const card = kpi(DEFAULT, company);
      expect(card, company).toContain('data-fuel-tone="slate"');
      expect(card).toContain('border-l-slate-600');
      expect(card).toContain(`data-fuel-dot="${tone}"`);
      expect(slice(card, 'data-fuel-company', company, '</span>')).toContain(
        tone === 'emerald' ? 'text-emerald-700' : 'text-amber-700',
      );
      const words = text(card);
      expect(words).toContain(ar(`fleet.fuelCards.company.${company}`));
      expect(words).toContain(amount);
      expect(words).toContain(dual('card', cards));
      expect(target(hrefOf(card, `fuelCharging.${company}`))).toEqual({
        path: '/fleet/fuel-cards/charging',
        params: { company },
      });
    }
  });

  it('«طلبات بانتظار الاعتماد»: amber, the amount opens the waiting requests, the count plain', () => {
    const card = kpi(DEFAULT, 'requests');
    expect(card).toContain('border-l-amber-500');
    const words = text(card);
    expect(words).toContain(ar('fleet.fuelCards.totals.requested'));
    expect(words).toContain('37,500.00');
    expect(words).toContain(dual('request', 5));
    expect(words).toContain(w('kpi.requests.foot'));
    expect(target(hrefOf(card, 'fuelCharging.requested'))).toEqual({
      path: '/fleet/fuel-cards/charging',
      params: { state: 'requested' },
    });
    expect(slice(card, 'data-fuel-sub', 'requests', '</div>')).not.toContain('<a ');
  });

  it('«رصيد منخفض»: amber, the cards below yellow open the low list, the red ones said in red', () => {
    const card = kpi(DEFAULT, 'low');
    expect(card).toContain('border-l-amber-500');
    const words = text(card);
    expect(words).toContain(`7 ${noun('card', 7)}`);
    expect(words).toContain('300.00');
    expect(words).toContain(dual('card', 1));
    expect(words).toContain('100.00');
    expect(words).toContain(w('kpi.low.foot'));
    expect(card).toContain('data-fuel-below-red="1"');
    expect(target(hrefOf(card, 'fuelCharging.low'))).toEqual({
      path: '/fleet/fuel-cards/charging',
      params: { state: 'low' },
    });
    const calm = tab({
      now: {
        ...NOW,
        fuelCharging: {
          ...(NOW.fuelCharging as NonNullable<FleetDashboardNowDto['fuelCharging']>),
          low: { belowYellow: 4, belowRed: 0, yellowAt: 300, redAt: 100 },
        },
      },
    });
    expect(kpi(calm, 'low'), 'no red line at 0').not.toContain('data-fuel-red=');
  });

  it('«شُحن اليوم»: emerald, the register’s own line, funding not spending (C2)', () => {
    const card = kpi(DEFAULT, 'charged');
    expect(card).toContain('border-l-emerald-500');
    const words = text(card);
    expect(words).toContain(ar('fleet.fuelCards.totals.chargedOnCairoDay'));
    expect(words).toContain('15,000.00');
    expect(words).toContain(ar('fleet.fuelCards.board.charge.chargedTodayNote'));
    expect(words).toContain(w('kpi.charged.foot'));
    expect(target(hrefOf(card, 'fuelCharging.charged'))).toEqual({
      path: '/fleet/fuel-cards/charging',
      params: { state: 'charged' },
    });
  });

  it('«تنتهي خلال 30 يومًا»: amber, its nearest day, the expired as a red link (dual words)', () => {
    const card = kpi(DEFAULT, 'expiring');
    expect(card).toContain('border-l-amber-500');
    const words = text(card);
    expect(words).toContain(w('kpi.expiring.title', { count: '30', noun: noun('day', 30) }));
    expect(words).toContain(`3 ${noun('card', 3)}`);
    expect(card).toContain('data-fuel-nearest="2026-11-08"');
    expect(words).toContain('2026/11/08');
    expect(words).toContain(dual('card', 2));
    expect(target(hrefOf(card, 'fuelCards.expiring'))).toEqual({
      path: '/fleet/fuel-cards',
      params: { expiresFrom: '2026-11-02', expiresBefore: '2026-12-01' },
    });
    expect(target(hrefOf(card, 'fuelCards.expired'))).toEqual({
      path: '/fleet/fuel-cards',
      params: { expiresBefore: TODAY },
    });
    const none = tab({
      now: { ...NOW, fuelCards: { warnDays: 30, expired: 0, expiring: 0, nearest: null } },
    });
    expect(kpi(none, 'expiring')).not.toContain('data-fuel-expired=');
    expect(kpi(none, 'expiring')).not.toContain('data-fuel-nearest=');
  });

  it('writes one and two in words — «كارت واحد»، «كارتان»، «طلبان» — and keeps the figure after', () => {
    expect(dualForm('ar', 1)).toBe('one');
    expect(dualForm('ar', 2)).toBe('two');
    expect(dualForm('ar', 3)).toBe('few');
    expect(dualForm('ar', 11)).toBe('other');
    expect(dualForm('ar', 0)).toBe('few');
    expect(dual('card', 1)).toBe('كارت واحد');
    expect(dual('card', 2)).toBe('كارتان');
    expect(dual('request', 2)).toBe('طلبان');
    expect(dual('row', 2)).toBe('صفّان');
    expect(dual('card', 86)).toBe('86 كارتًا');
    expect(text(kpi(BRANCH, 'requests'))).toContain('طلبان');
    expect(text(kpi(DEFAULT, 'expiring'))).toContain('كارتان');
    expect(text(kpi(DEFAULT, 'low'))).toContain('كارت واحد');
  });

  it('names the cards on no car in the company view only, and only when there are some', () => {
    const note = part(DEFAULT, 'data-fuel-nocar', '6');
    expect(text(note)).toContain('9,870.00');
    expect(text(note)).toContain(dual('card', 6));
    expect(note).not.toContain('<a ');
    expect(BRANCH).not.toContain('data-fuel-nocar=');
    const none = tab({
      now: {
        ...NOW,
        fuelCharging: {
          ...(NOW.fuelCharging as NonNullable<FleetDashboardNowDto['fuelCharging']>),
          unassigned: { count: 0, balance: 0 },
        },
      },
    });
    expect(none).not.toContain('data-fuel-nocar=');
  });

  it('under a branch: the branch’s figures, and every «الآن» link of a figure carries it', () => {
    expect(text(kpi(BRANCH, 'wataniya'))).toContain('71,320.00');
    expect(text(kpi(BRANCH, 'wataniya'))).toContain(dual('card', 21));
    for (const [metric, params] of [
      ['fuelCharging.wataniya', { company: 'wataniya' }],
      ['fuelCharging.chillout', { company: 'chillout' }],
      ['fuelCharging.requested', { state: 'requested' }],
      ['fuelCharging.low', { state: 'low' }],
      ['fuelCharging.charged', { state: 'charged' }],
      ['fuelCards.expiring', { expiresFrom: '2026-11-02', expiresBefore: '2026-12-01' }],
      ['fuelCardList.chargingStates', { state: 'requested,low' }],
      ['fuelCardList.expiry', { expiresBefore: '2026-12-01' }],
    ] as const) {
      expect(target(hrefOf(BRANCH, metric)).params, metric).toEqual({ ...params, branch: B1 });
    }
  });
});

// ── 3 · «مطابقة شيت شركة الوقود» ──────────────────────────────────────────────────────────────

describe('«مطابقة شيت شركة الوقود» — each company’s last READ sheet, plain figures', () => {
  it('draws both companies with the sheet’s day, the differing and undecided cards and their net', () => {
    const card = block(DEFAULT, 'sheets');
    expect(text(card)).toContain(w('sheets.title'));
    expect(text(card)).toContain(w('sheets.note'));
    const wataniya = text(sheetOf(card, 'wataniya'));
    expect(wataniya).toContain(w('sheets.last'));
    expect(wataniya).toContain('2026/10/28');
    expect(wataniya).toContain(w('sheets.differing'));
    expect(wataniya).toContain(dual('card', 9));
    expect(wataniya).toContain(w('sheets.undecided'));
    // The undecided lines' net, as at the read: the sheet below the system by 1,365.00.
    expect(wataniya).toContain(w('sheets.less').replace('{{amount}}', '1,365.00'));
    expect(sheetOf(card, 'wataniya')).toContain('data-fuel-net="-1365"');
    // Settled: «بُتّ فيها كلها», no undecided cell.
    const chillout = sheetOf(card, 'chillout');
    expect(text(chillout)).toContain('2026/10/25');
    expect(text(chillout)).toContain(w('sheets.allDecided'));
    expect(chillout).not.toContain('data-fuel-sheet-cell="undecided"');
  });

  it('opens nothing but its foot: «مطابقة أرصدة الكروت», the screen with no filter (PATH_ONLY)', () => {
    const card = block(DEFAULT, 'sheets');
    expect(links(card).map((l) => l.metric)).toEqual(['fuelSheets.reconcile']);
    expect(hrefOf(card, 'fuelSheets.reconcile')).toBe('/fleet/fuel-cards/reconcile');
    expect(text(card)).toContain(ar('fleet.fuelCards.reconcile.title'));
  });

  it('says what it cannot know: never read, the read day for an old session, a net of 0.00', () => {
    const card = block(BRANCH, 'sheets');
    const chillout = sheetOf(card, 'chillout');
    expect(chillout).toContain('data-fuel-read="never"');
    expect(text(chillout)).toContain(w('sheets.none'));
    const wataniya = sheetOf(card, 'wataniya');
    expect(wataniya).toContain('data-fuel-read-day="2026-10-29"');
    expect(text(wataniya)).toContain('2026/10/29');
    const net = slice(wataniya, 'data-fuel-sheet-cell', 'net', 'data-fuel-sheet-cell=');
    expect(text(net)).toContain('0.00');
    expect(net).not.toContain('data-fuel-net=');
  });

  it('says so when no card’s balance differed at the reading', () => {
    const html = tab({
      now: {
        ...NOW,
        fuelSheets: {
          wataniya: {
            sheetDate: '2026-10-28',
            readDay: '2026-10-28',
            differing: 0,
            undecided: 0,
            undecidedNet: 0,
          },
          chillout: null,
        },
      },
    });
    expect(text(sheetOf(block(html, 'sheets'), 'wataniya'))).toContain(w('sheets.noneDiffering'));
  });
});

// ── 4 · «كروت تحتاج متابعة» ───────────────────────────────────────────────────────────────────

describe('«كروت تحتاج متابعة» — the cards with a state now, the most urgent first', () => {
  it('draws the rows the server sent, in its order, at most FLEET_DASHBOARD_FUEL_CARD_ROWS', () => {
    const table = block(DEFAULT, 'cards');
    const ids = [...table.matchAll(/data-fuel-card="([^"]+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual(ROWS.map((r) => r.cardId));
    expect(ids.length).toBeLessThanOrEqual(FLEET_DASHBOARD_FUEL_CARD_ROWS);
    expect(text(table)).toContain(w('cards.title'));
    expect(text(table)).toContain(w('cards.note', { count: '30', noun: noun('day', 30) }));
    expect(slice(table, 'data-fuel-chip', 'cards', '</span></span>')).toContain(
      'data-fuel-total="14"',
    );
  });

  it('writes the card’s tail, the company, the car (or the card’s name «بدون سيارة»)', () => {
    const table = block(DEFAULT, 'cards');
    const first = cardRowOf(table, 'k1');
    expect(text(first)).toContain('…4417');
    expect(text(first)).not.toContain('7045112000984417');
    expect(first).toContain('data-fuel-company="wataniya"');
    expect(first).toContain('data-fuel-car="290"');
    expect(text(first)).toContain('2026/10/28');
    const spare = cardRowOf(table, 'k2');
    expect(spare).toContain('data-fuel-car="none"');
    expect(text(spare)).toContain('اسبير 2');
    expect(text(spare)).toContain(ar('fleet.fuelCards.noCar'));
    expect(text(cardRowOf(table, 'k6'))).toContain(ar('fleet.dash.common.vehicleDeleted'));
  });

  it('uses the register’s state words and colours (C3) and «—» for what is not known', () => {
    const table = block(DEFAULT, 'cards');
    const tag = (row: string, state: string): string =>
      slice(cardRowOf(table, row), 'data-fuel-state', state, '</span></span>');
    expect(text(tag('k1', 'expired'))).toContain(ar('fleet.fuelCards.expiry.expired'));
    expect(tag('k1', 'expired')).toContain('bg-red-50');
    expect(text(tag('k3', 'critical'))).toContain(ar('fleet.fuelCards.board.charge.critical'));
    expect(tag('k3', 'critical')).toContain('bg-red-50');
    expect(text(tag('k3', 'requested'))).toContain(ar('fleet.fuelCards.fields.request'));
    expect(tag('k3', 'requested')).toContain('bg-amber-50');
    expect(text(tag('k8', 'low'))).toContain(ar('fleet.fuelCards.filters.low'));
    expect(tag('k8', 'low')).toContain('bg-amber-50');
    expect(text(cardRowOf(table, 'k1'))).toContain('—');
    expect(text(cardRowOf(table, 'k6'))).toContain('—');
  });

  it('«فتح» per row (C6): expiry → the cards screen, balance or request → charging, no car or a deleted car → by number', () => {
    const table = block(DEFAULT, 'cards');
    const open = (id: string) => target(hrefOf(cardRowOf(table, id), 'fuelCardList.row'));
    expect(open('k1')).toEqual({
      path: '/fleet/fuel-cards',
      params: { vehicleCodes: '290', company: 'wataniya' },
    });
    expect(open('k2')).toEqual({
      path: '/fleet/fuel-cards',
      params: { number: '6011000000000736' },
    });
    expect(open('k3')).toEqual({
      path: '/fleet/fuel-cards/charging',
      params: { vehicleCodes: '214', company: 'wataniya' },
    });
    expect(open('k6')).toEqual({
      path: '/fleet/fuel-cards',
      params: { number: '6011000000005068' },
    });
    // A row's «فتح» never carries a branch (a card on no car is in no branch).
    for (const href of hrefs(block(BRANCH, 'cards'), 'fuelCardList.row')) {
      expect(target(href).params).not.toHaveProperty('branch');
    }
  });

  it('opens a car’s record only for a reader of the registry, and only while the car is in it', () => {
    const table = block(DEFAULT, 'cards');
    expect(hrefOf(cardRowOf(table, 'k1'), 'fuelCardList.vehicle')).toBe('/fleet/vehicles/v290');
    expect(hrefs(cardRowOf(table, 'k6'), 'fuelCardList.vehicle')).toEqual([]);
    expect(hrefs(cardRowOf(table, 'k2'), 'fuelCardList.vehicle')).toEqual([]);
    const noRegistry = tab(
      {},
      ALL_KEYS.filter((key) => key !== 'fleetVehicle.view'),
    );
    expect(hrefs(noRegistry, 'fuelCardList.vehicle')).toEqual([]);
  });

  it('says «أول 8» only when the server flagged more, then the two figure-free links (C5)', () => {
    const foot = slice(block(DEFAULT, 'cards'), 'data-dash-block-foot', 'true', '</div>');
    expect(foot).toContain('data-fuel-first="14"');
    expect(text(foot)).toContain(w('cards.first', { count: '8', noun: noun('card', 8) }));
    expect(text(foot)).toContain(w('cards.toCharging'));
    expect(text(foot)).toContain(w('cards.toExpiry', { count: '30', noun: noun('day', 30) }));
    expect(target(hrefOf(foot, 'fuelCardList.chargingStates'))).toEqual({
      path: '/fleet/fuel-cards/charging',
      params: { state: 'requested,low' },
    });
    expect(target(hrefOf(foot, 'fuelCardList.expiry'))).toEqual({
      path: '/fleet/fuel-cards',
      params: { expiresBefore: '2026-12-01' },
    });
    // Figure-free: the two links' words name the window only.
    const linkWords = links(foot)
      .map((l) => l.metric)
      .filter((metric) => metric.startsWith('fuelCardList.'))
      .map((metric) => {
        const at = foot.indexOf(`data-metric="${metric}"`);
        return text(foot.slice(foot.indexOf('>', at) + 1, foot.indexOf('</a>', at)));
      });
    expect(linkWords.join(' ').replace(/\D/gu, '')).toBe('30');
    expect(block(BRANCH, 'cards')).not.toContain('data-fuel-first=');
  });

  it('says so when no card needs follow-up', () => {
    const html = tab({ now: { ...NOW, fuelCardList: { rows: [], total: 0 } } });
    expect(text(block(html, 'cards'))).toContain(w('cards.empty'));
    expect(block(html, 'cards')).not.toContain('<table');
  });

  it('folds into blocks under 1024 px: no sideways scroll on a phone or a tablet', () => {
    // Both full-width tables are tables from lg only — 900 px of columns would scroll at 768–1023.
    for (const name of ['cards', 'dealer-table']) {
      const table = block(DEFAULT, name);
      expect(table, name).toContain('max-lg:block');
      expect(table, name).toContain('lg:overflow-x-auto');
      expect(table, name).toContain('lg:min-w-[900px] lg:table-fixed');
      expect(table, name).not.toMatch(/(?:^|[\s"])(?:max-)?md:/u);
    }
  });
});

// ── 5 · «خلال الفترة»: the receipts | the dealership ─────────────────────────────────────────

describe('«خلال الفترة» — the receipts beside the dealership, never summed', () => {
  it('«مصروف التشغيل»: sky, the receipts alone, the total and the fuel opening their lists', () => {
    const card = opexCard(DEFAULT);
    expect(card).toContain('border-l-sky-500');
    const words = text(card);
    expect(words).toContain(w('opex.title'));
    expect(words).toContain(w('opex.tag'));
    expect(words).toContain('198,300.00');
    expect(words).toContain(dual('receipt', 574));
    expect(words).toContain(w('opex.fuelAll'));
    expect(words).toContain('142,500.00');
    expect(words).toContain(dual('litre', 8_890));
    expect(words).toContain(w('opex.litresNote'));
    expect(target(hrefOf(card, 'opex.total'))).toEqual({ path: '/fleet/receipts', params: DAYS });
    expect(target(hrefOf(card, 'opex.fuel'))).toEqual({
      path: '/fleet/receipts',
      params: { ...DAYS, kind: 'fuel' },
    });
    expect(target(hrefOf(card, 'opex.count'))).toEqual({ path: '/fleet/receipts', params: DAYS });
    // The receipts' count and the litres are plain.
    expect(slice(card, 'data-fuel-chip', 'receipts', '</span></span>')).not.toContain('<a ');
    expect(card).toContain('data-fuel-litres="8890"');
    expect(card).not.toContain('data-fuel-unpriced');
  });

  it('says how many fuel receipts have no litre price, only when there are some (C9)', () => {
    const html = tab({ page: { ...PAGE, opex: { ...OPEX, unpricedFuel: 4 } } });
    const line = slice(opexCard(html), 'data-fuel-unpriced', '4', '</p>');
    expect(text(line)).toContain(dual('receipt', 4));
    // It names the FUEL receipts — only they carry a litre price — never «منها» after the
    // period's receipts count, which would read as 4 of all of them.
    expect(text(line)).toContain('إيصالات الوقود');
    expect(text(line)).not.toMatch(/^\s*منها/u);
    expect(line).not.toContain('<a ');
  });

  it('says the data starts later when the range begins before the first receipt', () => {
    const html = tab({ page: { ...PAGE, opex: { ...OPEX, dataFrom: '2026-10-10' } } });
    expect(opexCard(html)).toContain('data-fuel-data-from="2026-10-10"');
    expect(opexCard(DEFAULT)).not.toContain('data-fuel-data-from');
  });

  it('«فواتير التوكيل»: violet, the amount opens the screen, the pending rows open the pending', () => {
    const card = dealerCard(DEFAULT);
    expect(card).toContain('border-l-violet-500');
    const words = text(card);
    expect(words).toContain(w('dealer.title'));
    expect(words).toContain(w('dealer.tag'));
    expect(words).toContain('96,750.00');
    expect(words).toContain(dual('row', 42));
    expect(words).toContain(w('dealer.note'));
    expect(target(hrefOf(card, 'dealership.amount'))).toEqual({
      path: '/fleet/dealership',
      params: DAYS,
    });
    expect(target(hrefOf(card, 'dealership.pending'))).toEqual({
      path: '/fleet/dealership',
      params: { ...DAYS, state: 'pending' },
    });
    expect(target(hrefOf(card, 'dealershipList.screen'))).toEqual({
      path: '/fleet/dealership',
      params: DAYS,
    });
    // No priced meter (approved L2).
    expect(card).not.toContain('rounded-full bg-slate-100 dark:bg-[#162135]');
    const none = tab({
      page: {
        ...PAGE,
        dealership: { amount: 96_750, rows: 42, pending: 0, dataFrom: '2026-01-01' },
      },
    });
    expect(dealerCard(none)).not.toContain('data-fuel-pending=');
  });

  it('says the two are never summed, and writes their sum nowhere', () => {
    expect(text(part(DEFAULT, 'data-fuel-not-summed', 'true'))).toContain(
      ar('fleet.dash.period.notSummed'),
    );
    expect(text(DEFAULT)).not.toContain('295,050');
  });

  it('under a branch: the period links carry its branch', () => {
    const period = PERIOD_ONLY(BRANCH);
    for (const metric of ['opex.total', 'opex.fuel', 'dealership.amount', 'opex.card']) {
      expect(target(hrefOf(period, metric)).params.branch, metric).toBe(B1);
    }
  });
});

// ── 6 · «مصروف التشغيل حسب النوع» ─────────────────────────────────────────────────────────────

describe('«مصروف التشغيل حسب النوع» — five brand bars in the fixed order', () => {
  it('draws the five parts in the system’s order, each its amount, its link and its share', () => {
    const bars = block(DEFAULT, 'bars');
    expect(text(bars)).toContain(w('bars.title'));
    expect(text(bars)).toContain(w('bars.note'));
    expect(text(bars)).toContain(w('bars.noReceipt'));
    const keys = [...bars.matchAll(/data-fuel-bar="([^"]+)"/gu)].map((m) => m[1]);
    expect(keys).toEqual(['card', 'fuelCustody', 'tyres', 'wash', 'maintenance']);
    const expectations = [
      ['card', w('bars.card'), '116,350.00', '58.7%', { kind: 'fuel', source: 'card' }],
      [
        'fuelCustody',
        ar('fleet.custody.totals.fuel'),
        '26,150.00',
        '13.2%',
        { kind: 'fuel', source: 'custody' },
      ],
      ['tyres', ar('fleet.receipts.kind.tyres'), '28,450.00', '14.3%', { kind: 'tyres' }],
      ['wash', ar('fleet.receipts.kind.wash'), '9,650.00', '4.9%', { kind: 'wash' }],
      [
        'maintenance',
        ar('fleet.receipts.kind.maintenance'),
        '17,700.00',
        '8.9%',
        { kind: 'maintenance' },
      ],
    ] as const;
    for (const [key, name, amount, share, params] of expectations) {
      const row = barOf(bars, key);
      expect(text(row), key).toContain(name);
      expect(text(row), key).toContain(amount);
      expect(text(row), key).toContain(share);
      expect(target(hrefOf(row, `opex.${key}`)), key).toEqual({
        path: '/fleet/receipts',
        params: { ...DAYS, ...params },
      });
    }
  });

  it('draws every bar in the brand’s shade (DECISIONS §5), its length its share', () => {
    const bars = block(DEFAULT, 'bars');
    for (const key of ['card', 'fuelCustody', 'tyres', 'wash', 'maintenance']) {
      const fill = slice(bars, 'data-fuel-bar-fill', key, '>');
      expect(fill, key).toContain('bg-brand-600');
      expect(fill, key).not.toMatch(/bg-(sky|emerald|amber|violet|red|slate)-/u);
    }
    expect(slice(bars, 'data-fuel-bar-fill', 'card', '>')).toMatch(/width:\s?58\.67/u);
  });
});

// ── 7 · «مصروف التشغيل يومًا بيوم» ───────────────────────────────────────────────────────────

describe('«مصروف التشغيل يومًا بيوم» — every day of the range, brand columns', () => {
  it('draws one slot per bucket, in the server’s order, and a day with no receipt EMPTY', () => {
    const chart = block(DEFAULT, 'chart');
    expect(chart).toContain('data-fuel-chart="day"');
    expect(text(chart)).toContain(w('chart.titleDaily'));
    expect(text(chart)).toContain(w('chart.noteDaily'));
    expect(text(chart)).toContain(w('chart.late'));
    const days = [...chart.matchAll(/data-fuel-day="([^"]+)"/gu)].map((m) => m[1]);
    expect(days).toEqual(BUCKETS.map((b) => b.key));
    const empty = slice(chart, 'data-fuel-day', EMPTY, 'data-fuel-day=');
    expect(empty).toContain('data-fuel-empty="true"');
    expect(empty).not.toContain('data-fuel-col=');
    expect(chart.match(/data-fuel-empty=/gu)).toHaveLength(1);
  });

  it('draws today one shade stronger and opens its readout on it («اليوم حتى الآن»)', () => {
    const chart = block(DEFAULT, 'chart');
    expect(slice(chart, 'data-fuel-day', TODAY, '>')).toContain('data-fuel-today="true"');
    expect(slice(chart, 'data-fuel-col', TODAY, '>')).toContain('bg-brand-800');
    expect(chart).toContain(`data-fuel-readout="${TODAY}"`);
    const readout = slice(chart, 'data-fuel-readout', TODAY, 'role="group"');
    expect(text(readout)).toContain(w('chart.today'));
    expect(text(readout)).toContain('2026/11/01');
    const other = slice(chart, 'data-fuel-col', '2026-10-20', '>');
    expect(other).toContain('bg-brand-600');
    expect(other).not.toContain('bg-brand-800');
  });

  it('dims the Fridays by the calendar alone, and names today «اليوم» on the axis', () => {
    const chart = block(DEFAULT, 'chart');
    const fridays = [...chart.matchAll(/data-fuel-day="([^"]+)" data-fuel-friday="true"/gu)].map(
      (m) => m[1],
    );
    expect(fridays).toEqual(['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
    expect(slice(chart, 'data-fuel-day', '2026-10-09', 'data-fuel-day=')).toContain('opacity-55');
    expect(text(chart)).toContain(w('chart.legendDay'));
    expect(text(chart)).toContain(w('chart.legendFriday'));
  });

  it('opens nothing from a column (the approved chart has no column links)', () => {
    expect(links(block(DEFAULT, 'chart'))).toEqual([]);
  });

  it('comes as months over a long range: «مصروف التشغيل شهرًا بشهر», no Friday, no weekday', () => {
    const html = tab({ url: URL_YEAR, page: PAGE_YEAR });
    const chart = block(html, 'chart');
    expect(chart).toContain('data-fuel-chart="month"');
    expect(text(chart)).toContain(w('chart.titleMonthly'));
    expect(text(chart)).toContain(w('chart.noteMonthly'));
    expect(chart).not.toContain('data-fuel-friday=');
    expect(text(chart)).not.toContain(w('chart.legendFriday'));
    expect(slice(chart, 'data-fuel-day', '2026-02', 'data-fuel-day=')).toContain(
      'data-fuel-empty="true"',
    );
    expect(slice(chart, 'data-fuel-day', '2026-11', 'data-fuel-day=')).toContain(
      'data-fuel-today="true"',
    );
    expect(text(chart)).toContain('2026/10');
  });

  it('says the period holds no receipts when no slot has one', () => {
    const html = tab({
      page: {
        ...PAGE,
        opexSeries: {
          buckets: BUCKETS.map((b) => ({ ...b, hasRows: false, amount: 0, count: 0 })),
        },
      },
    });
    expect(text(block(html, 'chart'))).toContain(w('chart.empty'));
    expect(block(html, 'chart')).not.toContain('data-fuel-day=');
  });
});

// ── 8 · «فواتير التوكيل في الفترة» ────────────────────────────────────────────────────────────

describe('«فواتير التوكيل في الفترة» — the dealership screen’s first page', () => {
  it('draws the rows the server sent, never re-sorted, at most FLEET_DASHBOARD_DEALERSHIP_ROWS', () => {
    const table = block(DEFAULT, 'dealer-table');
    const ids = [...table.matchAll(/data-fuel-dealer-row="([^"]+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual(DEALER_ROWS.map((r) => r.id));
    expect(ids.length).toBeLessThanOrEqual(FLEET_DASHBOARD_DEALERSHIP_ROWS);
    expect(text(table)).toContain(w('dealerTable.title'));
    expect(text(table)).toContain(w('dealerTable.note'));
    expect(text(table)).toContain(dual('row', 42));
    for (const col of ['vehicle', 'date', 'work', 'invoice', 'amount']) {
      expect(text(table), col).toContain(w(`dealerTable.col.${col}`));
    }
  });

  it('writes the exit day, the work, the invoice («—»), the amount or «بانتظار الفاتورة» (D39)', () => {
    const table = block(DEFAULT, 'dealer-table');
    const pending = dealerRowOf(table, 'd1');
    expect(text(pending)).toContain('2026/10/31');
    expect(text(pending)).toContain(w('dealerTable.pendingTag'));
    expect(pending).toContain('bg-amber-50');
    expect(text(pending)).toContain('—');
    const priced = dealerRowOf(table, 'd2');
    expect(text(priced)).toContain('إصلاح (سمكرة)');
    expect(text(priced)).toContain('60417');
    expect(text(priced)).toContain('3,850.00');
  });

  it('«فتح» per row: its car, its exit day and its kind of work', () => {
    const table = block(DEFAULT, 'dealer-table');
    expect(target(hrefOf(dealerRowOf(table, 'd3'), 'dealershipList.row'))).toEqual({
      path: '/fleet/dealership',
      params: { vehicleCodes: '221', from: '2026-10-29', to: '2026-10-29', work: 'repair' },
    });
    expect(target(hrefOf(dealerRowOf(table, 'd4'), 'dealershipList.row'))).toEqual({
      path: '/fleet/dealership',
      params: { vehicleCodes: '221', from: '2026-10-29', to: '2026-10-29', work: 'maintenance' },
    });
  });

  it('opens a car’s record only while the car is in the registry', () => {
    const table = block(DEFAULT, 'dealer-table');
    expect(hrefOf(dealerRowOf(table, 'd2'), 'dealershipList.vehicle')).toBe('/fleet/vehicles/v142');
    expect(hrefs(dealerRowOf(table, 'd5'), 'dealershipList.vehicle')).toEqual([]);
    expect(hrefs(dealerRowOf(table, 'd6'), 'dealershipList.vehicle')).toEqual([]);
    expect(text(dealerRowOf(table, 'd6'))).toContain('318 ق');
  });

  it('tags a car deleted since «محذوفة» beside its chip; a live car and an old-book code are not', () => {
    const table = block(DEFAULT, 'dealer-table');
    const deleted = dealerRowOf(table, 'd5');
    expect(deleted).toContain('data-fuel-dealer-car-deleted="true"');
    expect(text(deleted)).toContain(ar('fleet.dash.common.vehicleDeleted'));
    for (const id of ['d2', 'd6']) {
      expect(dealerRowOf(table, id)).not.toContain('data-fuel-dealer-car-deleted');
      expect(text(dealerRowOf(table, id))).not.toContain(ar('fleet.dash.common.vehicleDeleted'));
    }
  });

  it('a row no code names: a «—» chip, and «فتح» opens that exit day’s rows of the work under the set', () => {
    const nameless = dealerRow({
      id: 'd9',
      code: null,
      vehicleId: null,
      typeName: null,
      date: '2026-10-27',
      workKind: 'maintenance',
      workTypeLabel: 'صيانة',
    });
    const html = tab({
      now: NOW_BRANCH,
      page: { ...PAGE_BRANCH, dealershipList: { rows: [nameless], more: 0 } },
    });
    const row = dealerRowOf(block(html, 'dealer-table'), 'd9');
    expect(row).toContain('data-fuel-dealer-car=""');
    expect(text(row)).toContain('—');
    const open = target(hrefOf(row, 'dealershipList.row'));
    expect(open.path).toBe('/fleet/dealership');
    expect(open.params).not.toHaveProperty('vehicleCodes');
    expect(open.params).toMatchObject({
      from: '2026-10-27',
      to: '2026-10-27',
      work: 'maintenance',
    });
    expect(open.params.branch).toBeDefined();
  });

  it('offers the rest on the dealership screen only when the server left some out', () => {
    const table = block(DEFAULT, 'dealer-table');
    expect(table).toContain('data-fuel-more="36"');
    expect(text(table)).toContain(w('dealerTable.more', { count: '36' }));
    expect(target(hrefOf(table, 'dealershipList.more'))).toEqual({
      path: '/fleet/dealership',
      params: DAYS,
    });
    const all = tab({ page: { ...PAGE, dealershipList: { rows: DEALER_ROWS, more: 0 } } });
    expect(block(all, 'dealer-table')).not.toContain('data-fuel-more=');
  });

  it('closes on «القيمة حتى الآن.» and says so when the period holds no row', () => {
    expect(text(part(DEFAULT, 'data-fuel-note', 'asOfNow'))).toContain(w('dealerTable.asOfNow'));
    const none = tab({ page: { ...PAGE, dealershipList: { rows: [], more: 0 } } });
    expect(text(block(none, 'dealer-table'))).toContain(w('dealerTable.empty'));
  });
});

// ── 9 · Each band its own read’s face; who sees what ──────────────────────────────────────────

describe('each band wears its own read’s face, and each part its own gate', () => {
  it('R2 failed: «الآن» stands, the period band shows the read’s error', () => {
    const html = tab({ pageFails: true });
    expect(html).toContain('data-fuel-kpi="wataniya"');
    expect(html).not.toContain('data-fuel-opex="card"');
    expect(slice(html, 'data-fuel-band', 'period', '</section>')).toContain(
      'data-dash-read-error="true"',
    );
  });

  it('R1 failed: the period band stands, «الآن» shows the read’s error', () => {
    const html = tab({ nowFails: true });
    expect(html).toContain('data-fuel-opex="card"');
    expect(html).not.toContain('data-fuel-kpi="wataniya"');
    expect(nowBand(html)).toContain('data-dash-read-error="true"');
  });

  it('R1 on its way: «الآن» in grey, never zeroes; the period band drawn', () => {
    const html = tab({ now: null });
    expect(nowBand(html)).toContain('data-dash-loading="true"');
    expect(nowBand(html)).not.toContain('0.00');
    expect(html).toContain('data-fuel-opex="card"');
  });

  it('a section the server could not compute shows its error in its place', () => {
    const html = tab({
      now: { ...NOW, fuelSheets: null, unavailable: ['fuelSheets'] },
      page: { ...PAGE, opexSeries: null, unavailable: ['opexSeries'] },
    });
    expect(html).toContain('data-section-error="fuelSheets"');
    expect(html).toContain('data-section-error="opexSeries"');
    expect(html).toContain('data-fuel-block="cards"');
    expect(html).toContain('data-fuel-block="bars"');
  });

  it('a reader of the fuel cards alone sees the expiry card only', () => {
    const html = tab({}, ['fleetFuelCard.view']);
    expect(html).toContain('data-fuel-kpi="expiring"');
    for (const id of ['wataniya', 'requests', 'charged']) {
      expect(html, id).not.toContain(`data-fuel-kpi="${id}"`);
    }
    expect(html).not.toContain('data-fuel-block="sheets"');
    expect(html).not.toContain('data-fuel-block="cards"');
    expect(html).not.toContain('data-fuel-band="period"');
    expect(text(html)).toContain(w('headingSubNow'));
  });

  it('a reader of the receipts alone sees the receipts part only', () => {
    const html = tab({}, ['fleetReceipt.view']);
    expect(html).not.toContain('data-fuel-band="now"');
    expect(html).toContain('data-fuel-opex="card"');
    expect(html).toContain('data-fuel-block="bars"');
    expect(html).toContain('data-fuel-block="chart"');
    expect(html).not.toContain('data-fuel-dealer="card"');
    expect(html).not.toContain('data-fuel-block="dealer-table"');
    expect(html).not.toContain('data-fuel-not-summed');
    expect(text(html)).toContain(w('headingSubPeriod'));
  });

  it('a reader of the dealership alone sees the dealership part only', () => {
    const html = tab({}, ['fleetDealership.view']);
    expect(html).not.toContain('data-fuel-band="now"');
    expect(html).toContain('data-fuel-dealer="card"');
    expect(html).toContain('data-fuel-block="dealer-table"');
    expect(html).not.toContain('data-fuel-opex="card"');
    expect(html).not.toContain('data-fuel-block="chart"');
    expect(html).not.toContain('data-fuel-not-summed');
    // No registry key: no record link.
    expect(hrefs(html, 'dealershipList.vehicle')).toEqual([]);
  });
});
