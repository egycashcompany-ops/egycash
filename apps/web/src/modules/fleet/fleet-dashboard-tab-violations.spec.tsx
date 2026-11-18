// «لوحة تحكم الحركة» — «المخالفات المرورية والتسويات», the owner-approved sample (approved/viol-dark.png
// and viol-branch-dark.png; harness zz-violations.tsx; DECISIONS §7, every recommendation, then
// «اعتمد»; plan build-vf §5), a NEW tab of «الآن» and a period both.
//
// What this file pins: the words and the order the owner approved; «كل السنوات» said ONCE; the
// period bar BETWEEN the two bands; every figure reads its server field (`violationsOpen.*`,
// `violations.*`, `violationList.more` — never a list's length) and opens the list that shows it, or
// nothing when no list does (every COUNT of «الآن», «سائقون معروفون», «اسم غير مربوط», the period's
// amount — owed AND collected, which no screen sums (audit D23) — the collected amount, a type's
// amount), the owed amount opening the unpaid fines whose footer shows it; the tones (violet company, amber drivers, neutral total, sky
// period, brand bars, «قائمة» amber, «محصَّلة» emerald — no red); the period links name the FINE's
// days on the drivers' half (`dfrom` / `dto` / `dcodes`), never the page's `from` / `to` /
// `vehicleCodes`; the rows on cars the registry never had in the company view only; the table's
// rules (date only, a row's «فتح» = its car, day and type, «عرض الباقي» only when more are left, a
// driver who has LEFT named as the register names him — audit D24);
// R1 and R2 each with their own face; the violations-only reader; the words the tab never says.
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_VIOLATION_ROWS,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodViolationRowDto,
  type FleetPersonDto,
  type LocalizedString,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import {
  ALL_KEYS,
  B1,
  DRIVER,
  NOW_DTO,
  T1,
  OP_CASH,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { DRIVER_2, FROM_30, PERIOD_FULL } from './fleet-dashboard-period-fixtures';

// ── The figures ───────────────────────────────────────────────────────────────────────────────

const named = (arName: string, en: string): LocalizedString => ({ ar: arName, en });
const SPRINTER = named('مرسيدس اسبرانتر 515', 'Mercedes Sprinter 515');
const ATEGO = named('مرسيدس اسيليو 915', 'Mercedes Atego 915');
const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };

const SPEED = '650000000000000000000701';
const BELT = '650000000000000000000702';
const PHONE = '650000000000000000000703';
const UNSPECIFIED = '650000000000000000000709';

type Open = NonNullable<FleetDashboardNowDto['violationsOpen']>;
type Violations = NonNullable<FleetDashboardPeriodDto['violations']>;
type ViolationList = NonNullable<FleetDashboardPeriodDto['violationList']>;

/** Every year's owed fines: the drivers' parts tie to their total (amount AND fines). */
const OPEN: Open = {
  company: { amount: 14_650, count: 30 },
  drivers: {
    total: { amount: 9_850, count: 18 },
    attributed: { amount: 7_600, count: 14, drivers: 9 },
    unknown: { amount: 1_350, count: 3 },
    unlinked: { amount: 900, count: 1 },
  },
  total: { amount: 24_500, count: 48 },
  bookOnly: { company: { amount: 1_150, count: 2 }, drivers: { amount: 300, count: 1 } },
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  violationsOpen: OPEN,
  unavailable: [],
};

/** The period's eight drivers' fines; the types tie to them, «غير محدد» last though not the fewest. */
const VIOLATIONS: Violations = {
  count: 8,
  amount: 3_450,
  owed: { count: 6, amount: 2_550 },
  collected: { count: 2, amount: 900 },
  byType: [
    {
      violationTypeId: SPEED,
      name: named('سرعة', 'Speeding'),
      unspecified: false,
      count: 3,
      amount: 1_200,
    },
    {
      violationTypeId: BELT,
      name: named('حزام', 'Seatbelt'),
      unspecified: false,
      count: 2,
      amount: 600,
    },
    {
      violationTypeId: PHONE,
      name: named('تليفون', 'Phone'),
      unspecified: false,
      count: 1,
      amount: 750,
    },
    {
      violationTypeId: UNSPECIFIED,
      name: named('غير محدد (مخالفات السائقين)', 'Unspecified (drivers)'),
      unspecified: true,
      count: 2,
      amount: 900,
    },
  ],
};

const row = (
  over: Partial<FleetDashboardPeriodViolationRowDto> &
    Pick<FleetDashboardPeriodViolationRowDto, 'violationId' | 'code' | 'date'>,
): FleetDashboardPeriodViolationRowDto => ({
  vehicleId: `v${over.code}`,
  typeName: SPRINTER,
  vehicleDeleted: false,
  driverEmployeeId: null,
  driverName: null,
  violationTypeId: SPEED,
  violationType: named('سرعة', 'Speeding'),
  unspecified: false,
  amount: 450,
  collected: false,
  ...over,
});

const LIST: ViolationList = {
  rows: [
    row({ violationId: 'f1', code: '214', date: '2026-10-31', driverEmployeeId: DRIVER }),
    row({
      violationId: 'f2',
      code: '305',
      typeName: ATEGO,
      date: '2026-10-30',
      driverName: 'مجهول',
      violationTypeId: PHONE,
      violationType: named('تليفون', 'Phone'),
      amount: 750,
    }),
    // A car deleted since: its fine stays, with no record to open.
    row({
      violationId: 'f3',
      code: '144',
      date: '2026-10-28',
      vehicleDeleted: true,
      driverEmployeeId: DRIVER_2,
      violationTypeId: BELT,
      violationType: named('حزام', 'Seatbelt'),
      amount: 300,
    }),
    // A name the old book wrote, linked to no HR record.
    row({
      violationId: 'f4',
      code: '167',
      typeName: ATEGO,
      date: '2026-10-20',
      driverName: 'حسام الدين فاروق',
    }),
    // An old-book code on a car the registry never had; the catalog's «unspecified» type.
    row({
      violationId: 'f5',
      code: '295',
      vehicleId: null,
      typeName: null,
      date: '2026-10-11',
      violationTypeId: UNSPECIFIED,
      violationType: named('غير محدد (مخالفات السائقين)', 'Unspecified (drivers)'),
      unspecified: true,
      amount: 600,
      collected: true,
    }),
    row({
      violationId: 'f6',
      code: '136',
      date: '2026-10-04',
      driverEmployeeId: DRIVER,
      violationTypeId: BELT,
      violationType: named('حزام', 'Seatbelt'),
      amount: 300,
      collected: true,
    }),
  ],
  more: 2,
};

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
  violations: VIOLATIONS,
  violationList: LIST,
  unavailable: [],
};

/** The switcher on «المهندسين»: both reads echo it; the server leaves `bookOnly` out. */
const NOW_BRANCH: FleetDashboardNowDto = {
  ...NOW,
  branchId: B1,
  scopeBranches: [CAIRO],
  violationsOpen: {
    company: { amount: 5_050, count: 15 },
    drivers: {
      total: { amount: 5_100, count: 10 },
      attributed: { amount: 3_900, count: 8, drivers: 5 },
      unknown: { amount: 300, count: 1 },
      unlinked: { amount: 900, count: 1 },
    },
    total: { amount: 10_150, count: 25 },
    bookOnly: null,
  },
};
const PAGE_BRANCH: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] },
};

const URL_30 = '/fleet?tab=violations&period=last30';
/** A driver who has LEFT: on the roster with the exited drivers only. */
const EXITED = '64b1f0dddddddddddddddd09';
const DAYS = { dfrom: FROM_30, dto: TODAY };

const PERSON = (
  employeeId: string,
  fullNameAr: string,
  status: FleetPersonDto['status'] = 'active',
): FleetPersonDto => ({
  employeeId,
  code: employeeId.slice(-4),
  fullNameAr,
  status,
  branchId: B1,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});

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
  // Fleet's people: the roster of today, and — under its own key, as `useFleetPeople` keeps it —
  // the roster WITH the drivers who have left, the one the register (and the fines' table) reads.
  const today = [PERSON(DRIVER, 'كريم السيد منصور'), PERSON(DRIVER_2, 'محمد عادل الشاذلي')];
  qc.setQueryData(['fleet', 'people'], today);
  qc.setQueryData(
    ['fleet', 'people', 'withExited'],
    [...today, PERSON(EXITED, 'سامح عبد الحميد', 'exited')],
  );
  return qc;
};

const tab = (
  seed: Parameters<typeof client>[0] = {},
  permissions: readonly string[] = ALL_KEYS,
): string => {
  const html = renderDashboard({ url: seed.url ?? URL_30, client: client(seed), permissions });
  const at = html.indexOf('data-dash-tab-body="violations"');
  if (at === -1) throw new Error('no violations tab body');
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
const PARTS = ['data-viol-kpi=', 'data-viol-block=', 'data-viol-band=', 'data-viol-notes='];
const part = (html: string, attr: string, value: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const from = start + attr.length + value.length + 3;
  const ends = PARTS.map((marker) => html.indexOf(marker, from)).filter((at) => at !== -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
const kpi = (html: string, id: string): string => part(html, 'data-viol-kpi', id);
const block = (html: string, id: string): string => part(html, 'data-viol-block', id);
const fineRow = (html: string, id: string): string => slice(html, 'data-viol-row', id, '</tr>');
const typeRow = (html: string, id: string): string => slice(html, 'data-viol-type', id, '</li>');
/** The «الآن» band: from its head to the period band. */
const nowBand = (html: string): string =>
  html.slice(html.indexOf('data-viol-band="now"'), html.indexOf('data-viol-band="period"'));
/** What the period band draws under its filter bar. */
const periodBody = (html: string): string =>
  html.slice(html.indexOf('data-read-band', html.indexOf('data-period-filters="true"')));
/** The counted noun as the dashboard writes it (custodyCountForm). */
const noun = (key: string, n: number): string => {
  const tail = n % 100;
  const form = n === 1 ? 'one' : n === 0 || (tail >= 2 && tail <= 10) ? 'few' : 'other';
  return ar(`fleet.dash.common.noun.${key}.${form}`);
};
const w = (key: string, params?: Record<string, string | number>): string =>
  ar(`fleet.dash.violations.${key}`, params);

const DEFAULT = tab();

// ── 1 · The heading, the bands and the order ─────────────────────────────────────────────────

describe('«المخالفات المرورية والتسويات» — the heading, the two bands and the approved order', () => {
  it('heads the tab with the approved title and line, no live chip (it is a period tab too)', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-viol-band="now"'));
    expect(text(head)).toContain(w('heading'));
    expect(text(head)).toContain(w('headingSub'));
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('draws «الآن» first with its live chip and «كل السنوات» — said ONCE in the whole tab', () => {
    const now = slice(DEFAULT, 'data-dash-band', 'now', 'data-read-band');
    expect(text(now)).toContain(w('now'));
    expect(now).toContain('data-live-chip="true"');
    expect(text(now)).toContain(w('allYears'));
    expect(DEFAULT.match(/data-viol-chip="allYears"/gu)).toHaveLength(1);
    expect(text(DEFAULT).split(w('allYears'))).toHaveLength(2);
  });

  it('draws «خلال الفترة» with its range and its line, the page’s period bar right under it', () => {
    const period = slice(DEFAULT, 'data-dash-band', 'period', 'data-period-filters');
    expect(text(period)).toContain(w('period'));
    expect(period).toContain('data-dash-range="last30"');
    expect(text(period)).toContain(w('period.sub'));
    expect(DEFAULT.match(/data-period-filters="true"/gu)).toHaveLength(1);
    const bar = DEFAULT.indexOf('data-period-filters="true"');
    expect(bar).toBeGreaterThan(DEFAULT.indexOf('data-dash-band="period"'));
    expect(bar).toBeLessThan(DEFAULT.indexOf('data-viol-kpi="period"'));
  });

  it('draws the cards, the bars, the table and the notes in the approved order', () => {
    const order = [
      'data-dash-band="now"',
      'data-viol-kpi="company"',
      'data-viol-kpi="drivers"',
      'data-viol-kpi="total"',
      'data-viol-book="company"',
      'data-dash-band="period"',
      'data-period-filters="true"',
      'data-viol-kpi="period"',
      'data-viol-block="types"',
      'data-viol-block="list"',
      'data-viol-notes="true"',
    ].map((marker) => DEFAULT.indexOf(marker));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('never says what the owner dropped (Phase 2, payroll, the authority) nor draws a sample', () => {
    const words = text(DEFAULT);
    for (const word of [
      'ترتيب السائقين',
      'جدولة الخصم',
      'خصم من المرتب',
      'سداد مجمع',
      'مطابقة النيابة',
      'وفر محتمل',
      'طوارئ',
      'حراسة',
      'الرادار',
    ]) {
      expect(words, word).not.toContain(word);
    }
    expect(DEFAULT).not.toMatch(/data-zz-/u);
  });

  it('counts nothing in the browser and never reaches for a sample file', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'components/fleet-dashboard/tab-violations.tsx',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/\.reduce\(/u);
    expect(src).not.toMatch(/\.filter\([^)]*\)\.length/u);
    expect(src).not.toMatch(/count\([\w.?]+\.length\)/u);
    expect(src).not.toMatch(/\{[\w.?]+\.length\}/u);
    expect(src).not.toMatch(/from '[^']*zz-/u);
    expect(src).not.toContain('data-zz-');
  });
});

// ── 2 · «الآن»: three cards, every year ────────────────────────────────────────────────────────

describe('«الآن» — the company, the drivers and both, every year, owed', () => {
  it('«قائمة على الشركة»: violet, its amount opens the company’s unpaid statements of every year', () => {
    const card = kpi(DEFAULT, 'company');
    expect(card).toContain('border-l-violet-500');
    const words = text(card);
    expect(words).toContain(w('company.title'));
    expect(words).toContain('14,650.00');
    expect(words).toContain(`30 ${noun('violation', 30)}`);
    expect(words).toContain(w('company.note'));
    expect(target(hrefOf(card, 'violationsOpen.company'))).toEqual({
      path: '/fleet/violations',
      params: { cset: 'false' },
    });
  });

  it('«قائمة على السائقين»: amber, its amount and its foot open the drivers’ unpaid fines', () => {
    const card = kpi(DEFAULT, 'drivers');
    expect(card).toContain('border-l-amber-500');
    const words = text(card);
    expect(words).toContain(w('drivers.title'));
    expect(words).toContain('9,850.00');
    expect(words).toContain(`18 ${noun('violation', 18)}`);
    const drivers = { path: '/fleet/violations', params: { dset: 'false' } };
    expect(target(hrefOf(card, 'violationsOpen.drivers'))).toEqual(drivers);
    expect(target(hrefOf(card, 'violationsOpen.driversAll'))).toEqual(drivers);
    expect(words).toContain(w('drivers.all'));
  });

  it('«إجمالي المخالفات القائمة»: neutral, its amount and its figure-free foot open both ledgers', () => {
    const card = kpi(DEFAULT, 'total');
    expect(card).toContain('border-l-slate-600');
    const words = text(card);
    expect(words).toContain(w('total.title'));
    expect(words).toContain('24,500.00');
    expect(words).toContain(`48 ${noun('violation', 48)}`);
    const both = { path: '/fleet/violations', params: { cset: 'false', dset: 'false' } };
    expect(target(hrefOf(card, 'violationsOpen.total'))).toEqual(both);
    expect(target(hrefOf(card, 'violationsOpen.totalAll'))).toEqual(both);
    // The foot names no figure.
    const foot = slice(card, 'data-viol-foot', 'total', '</a>');
    const footWords = text(foot.slice(foot.indexOf('>') + 1));
    expect(footWords).toContain(w('total.all'));
    expect(footWords.replace(/\D/gu, '')).toBe('');
  });

  it('writes every COUNT plain — the register sums amounts, so no screen shows those counts', () => {
    for (const id of ['company', 'drivers', 'total']) {
      const fines = slice(kpi(DEFAULT, id), 'data-viol-fines', id, '</div>');
      expect(fines, id).not.toContain('<a ');
    }
  });

  it('no link of «الآن» carries a year (every year) — and none carries a period', () => {
    for (const { href } of links(nowBand(DEFAULT))) {
      const { params } = target(href);
      for (const name of ['year', 'dyear', 'dfrom', 'dto', 'from', 'to']) {
        expect(params, `${href} ${name}`).not.toHaveProperty(name);
      }
    }
  });

  it('splits the drivers: the known drivers COUNTED first (plain), «مجهول» opening its list, the book’s names plain', () => {
    const parts = slice(kpi(DEFAULT, 'drivers'), 'data-viol-parts', 'drivers', 'data-viol-foot');
    const known = slice(parts, 'data-viol-part', 'known', 'data-viol-part=');
    expect(text(known)).toContain(w('drivers.known'));
    expect(text(known)).toContain(`9 ${noun('driver', 9)}`);
    expect(text(known)).toContain('7,600.00');
    expect(known).not.toContain('<a ');
    const unknown = slice(parts, 'data-viol-part', 'unknown', 'data-viol-part=');
    expect(text(unknown)).toContain(`3 ${noun('violation', 3)}`);
    expect(text(unknown)).toContain('1,350.00');
    expect(links(unknown)).toHaveLength(1);
    expect(text(unknown.slice(0, unknown.indexOf('</a>')))).toContain(w('drivers.unknown'));
    expect(target(hrefOf(unknown, 'violationsOpen.unknown'))).toEqual({
      path: '/fleet/violations',
      params: { dunknown: 'true', dset: 'false' },
    });
    const unlinked = slice(parts, 'data-viol-part', 'unlinked', '</ul>');
    expect(text(unlinked)).toContain(w('drivers.unlinked'));
    expect(text(unlinked)).toContain(`1 ${noun('violation', 1)}`);
    expect(text(unlinked)).toContain('900.00');
    expect(unlinked).not.toContain('<a ');
    // The parts order: known, unknown, unlinked.
    expect(parts.indexOf('"known"')).toBeLessThan(parts.indexOf('"unknown"'));
    expect(parts.indexOf('"unknown"')).toBeLessThan(parts.indexOf('"unlinked"'));
  });

  it('never draws a red, and the cards carry no tag (the band says «كل السنوات» for them)', () => {
    const now = nowBand(DEFAULT);
    expect(now).not.toMatch(/\b(?:text|bg|border)-red-/u);
    for (const id of ['company', 'drivers', 'total']) {
      expect(kpi(DEFAULT, id), id).not.toContain('data-viol-chip');
    }
  });

  it('names the rows on cars the registry never had — the company view, and only when there are any', () => {
    const company = slice(DEFAULT, 'data-viol-book', 'company', '</p>');
    expect(text(company)).toContain(
      w('bookOnly.company', { count: 2, noun: noun('violation', 2) }),
    );
    expect(company).not.toContain('<a ');
    const drivers = slice(DEFAULT, 'data-viol-book', 'drivers', '</p>');
    expect(text(drivers)).toContain(
      w('bookOnly.drivers', { count: 1, noun: noun('violation', 1) }),
    );
    // Only the side that has a row.
    const companyOnly = tab({
      now: {
        ...NOW,
        violationsOpen: {
          ...OPEN,
          bookOnly: { company: { amount: 1_150, count: 2 }, drivers: { amount: 0, count: 0 } },
        },
      },
    });
    expect(companyOnly).toContain('data-viol-book="company"');
    expect(companyOnly).not.toContain('data-viol-book="drivers"');
    const none = tab({
      now: {
        ...NOW,
        violationsOpen: {
          ...OPEN,
          bookOnly: { company: { amount: 0, count: 0 }, drivers: { amount: 0, count: 0 } },
        },
      },
    });
    expect(none).not.toContain('data-viol-book');
  });

  it('under a branch: the branch’s figures, the links carry it, and no carless sentence', () => {
    const html = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
    expect(text(kpi(html, 'company'))).toContain('5,050.00');
    expect(text(kpi(html, 'drivers'))).toContain('5,100.00');
    expect(text(kpi(html, 'total'))).toContain('10,150.00');
    expect(text(kpi(html, 'drivers'))).toContain(`5 ${noun('driver', 5)}`);
    expect(html).not.toContain('data-viol-book');
    expect(target(hrefOf(html, 'violationsOpen.company')).params).toEqual({
      cset: 'false',
      branch: B1,
    });
    expect(target(hrefOf(html, 'violationsOpen.unknown')).params).toEqual({
      dunknown: 'true',
      dset: 'false',
      branch: B1,
    });
  });

  it('says so when nothing is owed, the three cards still standing at 0.00', () => {
    const zero = { amount: 0, count: 0 };
    const html = tab({
      now: {
        ...NOW,
        violationsOpen: {
          company: zero,
          drivers: {
            total: zero,
            attributed: { ...zero, drivers: 0 },
            unknown: zero,
            unlinked: zero,
          },
          total: zero,
          bookOnly: { company: zero, drivers: zero },
        },
      },
    });
    expect(text(slice(html, 'data-viol-empty', 'now', '</p>'))).toContain(w('empty.now'));
    expect(html).toContain('data-viol-kpi="total"');
    expect(DEFAULT).not.toContain('data-viol-empty');
  });
});

// ── 3 · «خلال الفترة»: the drivers’ fines by the fine’s day ─────────────────────────────────────

describe('the bands at a tablet’s width — never one card to a full row', () => {
  it('«الآن»: three in a row from 1280 px, two on a tablet with the total across under them', () => {
    const cards = slice(DEFAULT, 'data-viol-cards', 'now', '>');
    expect(cards).toContain('md:grid-cols-2');
    expect(cards).toContain('xl:grid-cols-3');
    expect(kpi(DEFAULT, 'total')).toContain('md:col-span-2 xl:col-span-1');
    for (const id of ['company', 'drivers']) expect(kpi(DEFAULT, id), id).not.toContain('col-span');
  });

  it('«خلال الفترة»: the period card beside the types from 1024 px — halves until 1280 px (its one-line title needs them), one to two from there', () => {
    const row = slice(DEFAULT, 'data-viol-period-row', 'true', '>');
    expect(row).toContain('lg:grid-cols-2');
    expect(row).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]');
    expect(row).not.toContain('lg:grid-cols-[');
  });

  it('a long driver name wraps below 1280 px and keeps one line above it — never cut with «…» on a tablet', () => {
    const cell = fineRow(block(DEFAULT, 'list'), 'f3');
    const open = cell.lastIndexOf('<td', cell.indexOf('data-viol-driver'));
    const driverTd = cell.slice(open, cell.indexOf('>', open) + 1);
    expect(driverTd).toContain('xl:truncate xl:whitespace-nowrap');
    expect(driverTd).not.toMatch(/(?:^|[\s"])truncate(?:[\s"]|$)/u);
  });
});

describe('«خلال الفترة» — the drivers’ fines of the period, by the fine’s day', () => {
  it('«مخالفات السائقين في الفترة»: sky, its count opens the period’s fines, its amount plain (D23)', () => {
    const card = kpi(DEFAULT, 'period');
    expect(card).toContain('border-l-sky-500');
    const words = text(card);
    expect(words).toContain(w('period.title'));
    expect(words).toContain(w('period.tag'));
    expect(words).toContain(`8 ${noun('violation', 8)}`);
    expect(words).toContain('3,450.00');
    const period = { path: '/fleet/violations', params: DAYS };
    expect(target(hrefOf(card, 'violations.count'))).toEqual(period);
    expect(target(hrefOf(card, 'violations.period'))).toEqual(period);
    expect(words).toContain(w('period.all'));
    // Owed AND collected: the register's drivers' footer sums the unpaid fines only (2,550.00), so
    // no screen shows 3,450.00 — the figure stands plain (audit D23: 259 vs 207).
    const amount = slice(card, 'data-viol-period-amount', '3450', 'data-viol-owed');
    expect(text(amount)).toContain('3,450.00');
    expect(links(amount)).toEqual([]);
    expect(hrefs(card, 'violations.amount')).toEqual([]);
  });

  it('«منها N قائمة حتى الآن»: the count AND the amount open the period’s unpaid fines (D23)', () => {
    const owed = slice(kpi(DEFAULT, 'period'), 'data-viol-owed', '6', 'data-viol-collected');
    expect(text(owed)).toContain('2,550.00');
    expect(links(owed)).toHaveLength(2);
    const unpaid = { path: '/fleet/violations', params: { ...DAYS, dset: 'false' } };
    expect(target(hrefOf(owed, 'violations.owed'))).toEqual(unpaid);
    // The amount is the one the register's drivers' footer shows over that list.
    const amount = slice(owed, 'data-metric', 'violations.owed.amount', '</a>');
    expect(text(amount)).toContain('2,550.00');
    expect(target(hrefOf(owed, 'violations.owed.amount'))).toEqual(unpaid);
  });

  it('the owed amount narrows as its count does: the branch the period carries, unpaid only', () => {
    const narrowed = kpi(tab({ now: NOW_BRANCH, page: PAGE_BRANCH }), 'period');
    const unpaid = { path: '/fleet/violations', params: { ...DAYS, branch: B1, dset: 'false' } };
    expect(target(hrefOf(narrowed, 'violations.owed'))).toEqual(unpaid);
    expect(target(hrefOf(narrowed, 'violations.owed.amount'))).toEqual(unpaid);
  });

  it('«والمحصَّل منها حتى الآن»: the amount and its whole share, plain; «—» when the period is empty', () => {
    const collected = slice(kpi(DEFAULT, 'period'), 'data-viol-collected', '900', 'data-dash-foot');
    expect(text(collected)).toContain(w('period.collected'));
    expect(text(collected)).toContain('900.00');
    expect(collected).toContain('data-viol-share="26%"');
    expect(text(collected)).toContain('26%');
    expect(collected).not.toContain('<a ');
    const empty = tab({
      page: {
        ...PAGE,
        violations: {
          count: 0,
          amount: 0,
          owed: { count: 0, amount: 0 },
          collected: { count: 0, amount: 0 },
          byType: [],
        },
        violationList: { rows: [], more: 0 },
      },
    });
    expect(slice(kpi(empty, 'period'), 'data-viol-collected', '0', 'data-dash-foot')).toContain(
      '—',
    );
  });

  it('names the FINE’s days and the drivers’ half’s cars — never the page’s from / to / vehicleCodes', () => {
    const url = `/fleet?tab=violations&period=last30&type=${T1}&operation=${OP_CASH}&vehicleCodes=214,305`;
    const narrowed = tab({
      url,
      now: NOW_BRANCH,
      page: {
        ...PAGE_BRANCH,
        vehicleScope: {
          ...PAGE_BRANCH.vehicleScope,
          typeIds: [T1],
          operationIds: [OP_CASH],
          vehicleCodes: ['214', '305'],
        },
      },
    });
    expect(target(hrefOf(narrowed, 'violations.count')).params).toEqual({
      ...DAYS,
      dcodes: '214,305',
      type: T1,
      operation: OP_CASH,
      branch: B1,
    });
    for (const { href } of links(periodBody(DEFAULT))) {
      if (!href.startsWith('/fleet/violations')) continue;
      const { params } = target(href);
      for (const name of ['from', 'to', 'vehicleCodes', 'year', 'dyear']) {
        expect(params, `${href} ${name}`).not.toHaveProperty(name);
      }
    }
  });

  it('«مخالفات الفترة حسب النوع»: the server’s order, «غير محدد» last, each count opening its type', () => {
    const types = block(DEFAULT, 'types');
    const words = text(types);
    expect(words).toContain(w('types.title'));
    expect(words).toContain(w('types.note'));
    expect(text(slice(types, 'data-viol-chip', 'types', '</span></span>'))).toContain(
      `8 ${noun('violation', 8)}`,
    );
    const order = [SPEED, BELT, PHONE, UNSPECIFIED].map((id) =>
      types.indexOf(`data-viol-type="${id}"`),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const unspecified = typeRow(types, UNSPECIFIED);
    expect(text(unspecified)).toContain(w('types.unspecified'));
    expect(text(unspecified)).not.toContain('مخالفات السائقين');
    expect(target(hrefOf(typeRow(types, SPEED), 'violations.byType'))).toEqual({
      path: '/fleet/violations',
      params: { ...DAYS, dtype: SPEED },
    });
    expect(target(hrefOf(unspecified, 'violations.byType')).params.dtype).toBe(UNSPECIFIED);
    // A type's amount is plain: one link per row (its count).
    for (const id of [SPEED, BELT, PHONE, UNSPECIFIED]) {
      expect(links(typeRow(types, id)), id).toHaveLength(1);
    }
    expect(words).toContain(w('types.foot'));
  });

  it('draws the bars in the brand’s shade, each against the most numerous type', () => {
    const types = block(DEFAULT, 'types');
    const fill = (id: string): string => {
      const at = types.indexOf(`data-viol-bar="${id}"`);
      return types.slice(at, types.indexOf('>', at));
    };
    for (const id of [SPEED, BELT, PHONE, UNSPECIFIED]) {
      expect(fill(id), id).toContain('bg-brand-600 dark:bg-brand-500');
    }
    expect(fill(SPEED)).toContain('width:100%');
    expect(fill(PHONE)).toMatch(/width:33\.33/u);
    expect(types).not.toMatch(/\b(?:bg|text)-(?:red|amber|emerald|teal)-/u);
  });

  it('says the period holds no drivers’ fines when it holds none', () => {
    const html = tab({
      page: {
        ...PAGE,
        violations: {
          count: 0,
          amount: 0,
          owed: { count: 0, amount: 0 },
          collected: { count: 0, amount: 0 },
          byType: [],
        },
        violationList: { rows: [], more: 0 },
      },
    });
    expect(text(slice(html, 'data-viol-end', 'types', '</div>'))).toContain(w('empty.period'));
    expect(text(slice(html, 'data-viol-end', 'list', '</div>'))).toContain(w('empty.period'));
    expect(html).not.toContain('data-viol-more');
  });
});

// ── 4 · The table ─────────────────────────────────────────────────────────────────────────────

describe('«مخالفات السائقين في الفترة» — the table, the newest first', () => {
  const list = block(DEFAULT, 'list');

  it('draws the rows the server sent, in its order, under the approved columns', () => {
    expect(text(list)).toContain(w('list.title'));
    expect(text(list)).toContain(w('list.note'));
    const order = LIST.rows.map((r) => list.indexOf(`data-viol-row="${r.violationId}"`));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(LIST.rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_VIOLATION_ROWS);
    const head = list.slice(list.indexOf('<thead'), list.indexOf('</thead>'));
    const columns = ['vehicle', 'date', 'driver', 'type', 'amount', 'status'].map((c) =>
      text(head).indexOf(w(`col.${c}`)),
    );
    expect(columns.every((at) => at !== -1)).toBe(true);
    expect([...columns].sort((a, b) => a - b)).toEqual(columns);
  });

  it('writes the date ONLY, as the dashboard writes a day', () => {
    const cell = slice(fineRow(list, 'f1'), 'data-viol-date', 'true', '</td>');
    expect(text(cell)).toContain('2026/10/31');
    expect(text(cell)).not.toMatch(/\d{1,2}:\d{2}/u);
  });

  it('opens each row’s car, day and type — that fine and any sharing the three', () => {
    expect(target(hrefOf(fineRow(list, 'f1'), 'violationList.row'))).toEqual({
      path: '/fleet/violations',
      params: { dcodes: '214', dfrom: '2026-10-31', dto: '2026-10-31', dtype: SPEED },
    });
    // An old-book code opens by its code, as the register matches it.
    expect(target(hrefOf(fineRow(list, 'f5'), 'violationList.row')).params).toEqual({
      dcodes: '295',
      dfrom: '2026-10-11',
      dto: '2026-10-11',
      dtype: UNSPECIFIED,
    });
    expect(text(fineRow(list, 'f1'))).toContain(w('openRow'));
  });

  it('opens a car’s record only for a reader of the registry, and only while the car is in it', () => {
    expect(hrefOf(fineRow(list, 'f1'), 'violationList.vehicle')).toBe('/fleet/vehicles/v214');
    expect(hrefs(fineRow(list, 'f3'), 'violationList.vehicle'), 'deleted since').toEqual([]);
    expect(hrefs(fineRow(list, 'f5'), 'violationList.vehicle'), 'never registered').toEqual([]);
    const noRegistry = block(
      tab(
        {},
        ALL_KEYS.filter((key) => key !== 'fleetVehicle.view'),
      ),
      'list',
    );
    expect(hrefs(noRegistry, 'violationList.vehicle')).toEqual([]);
    expect(text(fineRow(list, 'f1'))).toContain(SPRINTER.ar);
  });

  it('tags a car deleted since «محذوفة» beside its chip, as «كروت تحتاج متابعة» does', () => {
    const deleted = fineRow(list, 'f3');
    expect(deleted).toContain('data-viol-car-deleted="true"');
    expect(text(deleted)).toContain(ar('fleet.dash.common.vehicleDeleted'));
    for (const id of ['f1', 'f5']) {
      expect(fineRow(list, id)).not.toContain('data-viol-car-deleted');
      expect(text(fineRow(list, id))).not.toContain(ar('fleet.dash.common.vehicleDeleted'));
    }
  });

  it('a fine no code names: a «—» chip, and «فتح» opens that day’s fines of the type under the set', () => {
    const nameless = row({
      violationId: 'f9',
      code: null,
      vehicleId: null,
      typeName: null,
      date: '2026-10-15',
    });
    const page: FleetDashboardPeriodDto = {
      ...PAGE_BRANCH,
      violationList: { rows: [nameless], more: 0 },
    };
    const html = block(tab({ now: NOW_BRANCH, page }), 'list');
    const cell = fineRow(html, 'f9');
    expect(cell).toContain('data-viol-car=""');
    expect(text(cell)).toContain('—');
    const open = target(hrefOf(cell, 'violationList.row'));
    expect(open.path).toBe('/fleet/violations');
    expect(open.params).not.toHaveProperty('dcodes');
    expect(open.params).toMatchObject({ dfrom: '2026-10-15', dto: '2026-10-15', dtype: SPEED });
    // The period's branch, as every other link of the table carries it.
    expect(open.params.branch).toBe(target(hrefOf(html, 'violationList.all')).params.branch);
    expect(open.params.branch).toBeDefined();
  });

  it('names a driver who has LEFT as the register does — never an id fragment (D24)', () => {
    const page: FleetDashboardPeriodDto = {
      ...PAGE,
      violationList: {
        rows: [
          row({ violationId: 'fx', code: '214', date: '2026-10-29', driverEmployeeId: EXITED }),
        ],
        more: 0,
      },
    };
    const exited = fineRow(block(tab({ page }), 'list'), 'fx');
    expect(exited).toContain('data-viol-driver="hr"');
    expect(text(exited)).toContain('سامح عبد الحميد');
    expect(text(exited)).not.toContain(EXITED.slice(-8));
    // He is on the roster WITH the exited drivers only: the table reads that one, as the register.
    expect(exited).toContain('decoration-dotted');
  });

  it('names the driver as the register does: HR underlined, «مجهول» muted, the book’s name plain', () => {
    const hr = fineRow(list, 'f1');
    expect(hr).toContain('data-viol-driver="hr"');
    expect(text(hr)).toContain('كريم السيد منصور');
    expect(hr).toContain('decoration-dotted');
    const unknown = fineRow(list, 'f2');
    expect(unknown).toContain('data-viol-driver="unknown"');
    expect(text(unknown)).toContain(ar('fleet.violations.unknownDriver'));
    const book = fineRow(list, 'f4');
    expect(book).toContain('data-viol-driver="book"');
    expect(text(book)).toContain('حسام الدين فاروق');
    expect(slice(book, 'data-viol-driver', 'book', '</span>')).not.toContain('decoration-dotted');
    // No name at all is «مجهول» too.
    expect(fineRow(list, 'f5')).toContain('data-viol-driver="unknown"');
  });

  it('writes the type by its name, «غير محدد» for the catalog’s unspecified one', () => {
    expect(text(fineRow(list, 'f2'))).toContain('تليفون');
    const f5 = fineRow(list, 'f5');
    expect(text(f5)).toContain(w('types.unspecified'));
    expect(text(f5)).not.toContain('مخالفات السائقين');
  });

  it('writes the state as the register does: «قائمة» amber, «محصَّلة» emerald — never red', () => {
    const owed = slice(fineRow(list, 'f1'), 'data-viol-state', 'owed', '</span></span>');
    expect(text(owed)).toContain(ar('fleet.violations.outstanding'));
    expect(owed).toContain('bg-amber-50');
    const collected = slice(fineRow(list, 'f6'), 'data-viol-state', 'collected', '</span></span>');
    expect(text(collected)).toContain(ar('fleet.violations.settled'));
    expect(collected).toContain('bg-emerald-50');
    expect(list).not.toMatch(/\b(?:text|bg|border)-red-/u);
  });

  it('offers the rest in the register only when the server left some out, and the register always', () => {
    const more = slice(list, 'data-viol-more', '2', '</a>');
    expect(text(more)).toContain(w('more', { count: 2 }));
    expect(target(hrefOf(list, 'violationList.more'))).toEqual({
      path: '/fleet/violations',
      params: DAYS,
    });
    expect(target(hrefOf(list, 'violationList.all'))).toEqual({
      path: '/fleet/violations',
      params: DAYS,
    });
    expect(text(list)).toContain(w('register'));
    const all = block(tab({ page: { ...PAGE, violationList: { ...LIST, more: 0 } } }), 'list');
    expect(all).not.toContain('data-viol-more');
    expect(hrefs(all, 'violationList.all')).toHaveLength(1);
  });

  it('folds into blocks under 1024 px: no sideways scroll on a phone or a tablet', () => {
    // A table from lg only — its 900 px of columns would scroll inside the card at 768–1023.
    expect(list).toContain('max-lg:block');
    expect(list).toContain('lg:overflow-x-auto');
    expect(list).toContain('lg:min-w-[900px] lg:table-fixed');
    expect(list).not.toMatch(/(?:^|[\s"])(?:max-)?md:/u);
  });

  it('closes the period with the approved notes, the company sentence among them', () => {
    const notes = slice(DEFAULT, 'data-viol-notes', 'true', '</section>');
    expect(text(notes)).toContain(w('note'));
    expect(text(notes)).toContain(ar('fleet.dash.summaries.annualNote'));
  });
});

// ── 5 · Each band its own read’s face; who sees what ──────────────────────────────────────────

describe('each band wears its own read’s face', () => {
  it('R2 failed: «الآن» stands, the period band shows the read’s error', () => {
    const html = tab({ pageFails: true });
    expect(html).toContain('data-viol-kpi="company"');
    expect(html).not.toContain('data-viol-kpi="period"');
    expect(slice(html, 'data-viol-band', 'period', '</section>')).toContain(
      'data-dash-read-error="true"',
    );
  });

  it('R1 failed: the period band stands, «الآن» shows the read’s error', () => {
    const html = tab({ nowFails: true });
    expect(html).toContain('data-viol-kpi="period"');
    expect(html).not.toContain('data-viol-kpi="company"');
    expect(nowBand(html)).toContain('data-dash-read-error="true"');
  });

  it('R1 on its way: «الآن» in grey, never zeroes; the period band drawn', () => {
    const html = tab({ now: null });
    expect(nowBand(html)).toContain('data-dash-loading="true"');
    expect(nowBand(html)).not.toContain('0.00');
    expect(html).toContain('data-viol-kpi="period"');
  });

  it('a section the server could not compute shows its error in its place', () => {
    const html = tab({
      now: { ...NOW, violationsOpen: null, unavailable: ['violationsOpen'] },
      page: { ...PAGE, violationList: null, unavailable: ['violationList'] },
    });
    expect(html).toContain('data-section-error="violationsOpen"');
    expect(html).toContain('data-section-error="violationList"');
    expect(html).toContain('data-viol-kpi="period"');
  });

  it('a reader of the violations alone sees the tab, both bands, every figure', () => {
    const html = tab({}, ['fleetViolation.view']);
    expect(html).toContain('data-viol-kpi="company"');
    expect(html).toContain('data-viol-kpi="period"');
    expect(html).toContain('data-viol-block="list"');
    // No registry key: no record link; no roster key: the driver by the register's own fallback.
    expect(hrefs(html, 'violationList.vehicle')).toEqual([]);
    expect(fineRow(html, 'f1')).toContain('data-viol-driver="hr"');
  });
});
