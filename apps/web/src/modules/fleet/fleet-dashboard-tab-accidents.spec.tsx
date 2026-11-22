// «لوحة تحكم الحركة» — «الحوادث ومطالبات التأمين», the owner-approved sample (approved/acc-dark.png
// and acc-branch-dark.png; harness zz-accidents.tsx; DECISIONS §6, every recommendation; plan build-ka
// §6), a tab of «الآن» and a period both, in place of the old «الحوادث» body.
//
// What this file pins: the words and the order the owner approved; the period bar BETWEEN the two
// bands; every figure reads its server field (`accidentsOpen`, `notices.open` / `missingAny` / the
// parts, `accidents.count` / `open` / `totals` — never a list's length) and opens the list that shows
// it, or nothing when no list does (the «ينقصها مرفق» tag, «صور الرخص», the transfers line, «و N
// أخرى»); the notices in amber, never red; a notice row opens what the notice carries, or nothing;
// the money in the register's order and words, a negative remaining red with «−»; the period table's
// date ONLY in its date cell (a statement may hold «10:30» — critic F1); R1 and R2 each with their own
// face; the notices-only and accidents-only readers; the words the tab must never say. It also
// carries the pins of the old tab 10 that still hold (the culprit's card, a row opening its car and
// day, the rest of the list in the log).
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_NOTICE_ROWS,
  type FleetDashboardNoticeRowDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type LocalizedString,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import { NOTICE_INSURER } from './lib/notice-insurers';
import { noticeTemplate } from './lib/notice-templates';
import {
  ALL_KEYS,
  B1,
  DRIVER,
  NOW_DTO,
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

type Notices = NonNullable<FleetDashboardNowDto['notices']>;
type Accidents = NonNullable<FleetDashboardPeriodDto['accidents']>;
type AccidentList = NonNullable<FleetDashboardPeriodDto['accidentList']>;

const notice = (
  over: Partial<FleetDashboardNoticeRowDto> & Pick<FleetDashboardNoticeRowDto, 'noticeId'>,
): FleetDashboardNoticeRowDto => ({
  template: 'misrInsurance',
  vehicleId: null,
  code: null,
  typeName: null,
  noticeNumber: null,
  noticeDate: null,
  missing: { vehicleLicense: false, driverLicense: false, checkImage: false },
  ...over,
});

/** Five open notices missing an attachment (the oldest first, no date last); a sixth open notice
 *  has all three in. Licences: n3, n4 (2); cheque: n1, n2, n3, n5 (4). */
const NOTICE_ROWS: FleetDashboardNoticeRowDto[] = [
  notice({
    noticeId: 'n1',
    vehicleId: 'v247',
    code: '247',
    typeName: SPRINTER,
    noticeNumber: '24117',
    noticeDate: '2026-10-21',
    missing: { vehicleLicense: false, driverLicense: false, checkImage: true },
  }),
  notice({
    noticeId: 'n2',
    vehicleId: 'v305',
    code: '305',
    typeName: ATEGO,
    noticeNumber: '24139',
    noticeDate: '2026-10-27',
    missing: { vehicleLicense: false, driverLicense: false, checkImage: true },
  }),
  notice({
    noticeId: 'n3',
    template: 'deltaInsurance',
    vehicleId: 'v112',
    code: '112',
    typeName: SPRINTER,
    noticeNumber: '8093',
    noticeDate: '2026-10-30',
    missing: { vehicleLicense: false, driverLicense: true, checkImage: true },
  }),
  // No car, but a number and a day: «بلا سيارة», still opened by what it carries.
  notice({
    noticeId: 'n4',
    template: 'deltaInsurance',
    noticeNumber: '7001',
    noticeDate: '2026-10-31',
    missing: { vehicleLicense: true, driverLicense: false, checkImage: false },
  }),
  // Nothing to find it by: no «فتح».
  notice({
    noticeId: 'n5',
    missing: { vehicleLicense: false, driverLicense: false, checkImage: true },
  }),
];

const NOTICES: Notices = {
  open: 6,
  missingAny: 5,
  missingLicences: 2,
  missingCheckImage: 4,
  rows: NOTICE_ROWS,
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  notices: NOTICES,
  accidentsOpen: { count: 5, remaining: 4300 },
  vehicleScope: null,
  unavailable: [],
};

/** The period's eight files: six rows, two more; the money ties the register's formula. */
const ACCIDENTS: Accidents = {
  count: 8,
  open: 3,
  undated: 25,
  totals: {
    amountCollected: 16_700,
    companyCost: 2_500,
    paidAmount: 28_900,
    transferredIn: 3_400,
    transferredOut: 2_400,
    remaining: -8_700,
  },
};

const LIST: AccidentList = {
  rows: [
    {
      accidentId: 'a1',
      vehicleId: 'v207',
      code: '207',
      typeName: SPRINTER,
      date: '2026-10-27',
      // A time inside the statement — the row's DATE cell must still be a day only.
      statement: 'اصطدام بعمود إنارة الساعة 10:30 عند مدخل الفرع، وتلف بالصدام الأمامي.',
      culprit: 'محمود عبد العزيز سالم',
      culpritEmployeeIds: [DRIVER],
      status: 'open',
      remaining: -12_200,
    },
    {
      accidentId: 'a2',
      vehicleId: 'v154',
      code: '154',
      typeName: ATEGO,
      date: '2026-10-27',
      statement: 'احتكاك بسيارة ملاكي في إشارة مرور، وخدوش بالباب الأيمن.',
      culprit: 'طرف ثالث — ميكروباص أجرة',
      culpritEmployeeIds: [],
      status: 'open',
      remaining: 3_300,
    },
    {
      accidentId: 'a3',
      vehicleId: 'v182',
      code: '182',
      typeName: SPRINTER,
      date: '2026-10-14',
      statement: 'كسر المرآة الجانبية اليسرى أثناء الوقوف أمام فرع العميل.',
      culprit: 'كريم السيد إبراهيم',
      culpritEmployeeIds: [DRIVER_2],
      status: 'closed',
      remaining: 0,
    },
    {
      accidentId: 'a4',
      vehicleId: null,
      code: '295',
      typeName: null,
      date: '2026-10-06',
      statement: '',
      culprit: null,
      culpritEmployeeIds: [],
      status: 'closed',
      remaining: 0,
    },
    {
      accidentId: 'a5',
      vehicleId: 'v118',
      code: '118',
      typeName: ATEGO,
      date: '2026-10-05',
      statement: 'خدش بجانب السيارة أثناء الانتظار.',
      culprit: 'حسام الدين فاروق',
      culpritEmployeeIds: [],
      status: 'open',
      remaining: 2_000,
    },
    {
      accidentId: 'a6',
      vehicleId: 'v131',
      code: '131',
      typeName: SPRINTER,
      date: '2026-10-04',
      statement: 'اصطدام خلفي على الطريق الزراعي.',
      culprit: 'عادل رمضان حسين',
      culpritEmployeeIds: [],
      status: 'closed',
      remaining: 0,
    },
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
  accidents: ACCIDENTS,
  accidentList: LIST,
  unavailable: [],
};

/** The switcher on «المهندسين»: both reads echo it; the server leaves `undated` out. */
const NOW_BRANCH: FleetDashboardNowDto = { ...NOW, branchId: B1, scopeBranches: [CAIRO] };
const PAGE_BRANCH: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] },
  accidents: { ...ACCIDENTS, undated: null },
};

const URL_30 = '/fleet?tab=accidents&period=last30';
const DATES = `from=${FROM_30}&to=${TODAY}`;

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
  const at = html.indexOf('data-dash-tab-body="accidents"');
  if (at === -1) throw new Error('no accidents tab body');
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
/** The words with no space at all — for a figure glued to a letter («و3»). */
const squeeze = (s: string): string => s.replace(/\s+/gu, '');
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
/** The markup of one element, by an attribute it alone carries, up to the next one of its kind. */
const slice = (html: string, attr: string, value: string, next = `${attr}=`): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const end = html.indexOf(next, start + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : end);
};
/** The tab's parts, in their order: a card or a block runs to the next one of them. */
const PARTS = ['data-acc-kpi=', 'data-acc-block=', 'data-dash-band=', 'data-acc-note='];
const part = (html: string, attr: string, value: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const from = start + attr.length + value.length + 3;
  const ends = PARTS.map((marker) => html.indexOf(marker, from)).filter((at) => at !== -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
const kpi = (html: string, id: string): string => part(html, 'data-acc-kpi', id);
const block = (html: string, id: string): string => part(html, 'data-acc-block', id);
/** One money tile, up to the next tile (the last one up to the transfers line). */
const tile = (money: string, field: string): string => {
  const one = slice(money, 'data-acc-money', field);
  const cut = one.indexOf('data-acc-transfers');
  return cut === -1 ? one : one.slice(0, cut);
};
const noticeRow = (html: string, id: string): string => slice(html, 'data-notice-row', id, '</tr>');
const accidentRow = (html: string, id: string): string =>
  slice(html, 'data-accident-row', id, '</tr>');
/** The cell that carries `attr` inside a row: its markup to the cell's end. */
const cell = (row: string, attr: string): string => {
  const start = row.indexOf(attr);
  if (start === -1) throw new Error(`no cell ${attr}`);
  return row.slice(start, row.indexOf('</td>', start));
};
/** The class list of the opening tag that carries `marker`. */
const classOf = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  if (at === -1) throw new Error(`no ${marker}`);
  const open = html.lastIndexOf('<', at);
  const tag = html.slice(open, html.indexOf('>', at) + 1);
  return /class="([^"]*)"/u.exec(tag)?.[1] ?? '';
};

const DEFAULT = tab();

// ── 1 · The heading, the bands and the order ─────────────────────────────────────────────────

describe('«الحوادث ومطالبات التأمين» — the heading, the two bands and the approved order', () => {
  it('heads the tab with the approved title and line, no live chip (it is a period tab too)', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-dash-band="now"'));
    expect(text(head)).toContain(ar('fleet.dash.accidents.heading'));
    expect(text(head)).toContain(
      'ملفات الحوادث المفتوحة وإخطارات التأمين الآن، وحوادث الفترة ومبالغ ملفاتها.',
    );
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('draws «الآن» first (its live chip), then «خلال الفترة» with its range and line', () => {
    const now = slice(DEFAULT, 'data-dash-band', 'now', 'data-read-band');
    expect(text(now)).toContain(ar('fleet.dash.accidents.now'));
    expect(now).toContain('data-live-chip="true"');
    const period = slice(DEFAULT, 'data-dash-band', 'period', 'data-period-filters');
    expect(text(period)).toContain(ar('fleet.dash.accidents.period'));
    expect(period).toContain('data-dash-range="last30"');
    expect(text(period)).toContain(ar('fleet.dash.accidents.periodSub'));
  });

  it('stands the page’s period bar BETWEEN the two bands, right under the period band’s head', () => {
    const bar = DEFAULT.indexOf('data-period-filters="true"');
    expect(DEFAULT.match(/data-period-filters="true"/gu)).toHaveLength(1);
    expect(bar).toBeGreaterThan(DEFAULT.indexOf('data-acc-block="notices"'));
    expect(bar).toBeGreaterThan(DEFAULT.indexOf('data-dash-band="period"'));
    expect(bar).toBeLessThan(DEFAULT.indexOf('data-acc-kpi="period"'));
  });

  it('draws the cards, the tables, the money and the note in the approved order', () => {
    const order = [
      'data-dash-band="now"',
      'data-acc-kpi="files"',
      'data-acc-kpi="notices"',
      'data-acc-block="notices"',
      'data-dash-band="period"',
      'data-period-filters="true"',
      'data-acc-kpi="period"',
      'data-acc-block="money"',
      'data-acc-block="list"',
      'data-acc-note="true"',
    ].map((marker) => DEFAULT.indexOf(marker));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('never says what the owner dropped: no claims, no expert, no report, no causes, no settlements', () => {
    const words = text(DEFAULT);
    for (const word of ['التسويات', 'مطالبة', 'مطالبات', 'الخبير', 'تقرير', 'أسباب']) {
      expect(words, word).not.toContain(word);
    }
    expect(DEFAULT).not.toMatch(/data-zz-/u);
  });

  it('counts nothing in the browser and never reaches for a sample file', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'components/fleet-dashboard/tab-accidents.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/\.reduce\(/u);
    expect(src).not.toMatch(/\.filter\([^)]*\)\.length/u);
    expect(src).not.toMatch(/count\([\w.?]+\.length\)/u);
    expect(src).not.toMatch(/\{[\w.?]+\.length\}/u);
    expect(src).not.toMatch(/from '[^']*zz-/u);
    expect(src).not.toContain('data-zz-');
    // The insurer's name comes from the one source, not from the forms' printed geometry.
    expect(src).toContain("from '../../lib/notice-insurers'");
    expect(src).not.toContain('notice-templates');
  });
});

// ── 2 · «الآن»: the two cards ─────────────────────────────────────────────────────────────────

describe('«الآن» — the open files and the open notices, every figure a server field', () => {
  it('«ملفات حوادث مفتوحة»: every date, the files and what remains on them, both opening the list', () => {
    const card = kpi(DEFAULT, 'files');
    const words = text(card);
    expect(words).toContain(ar('fleet.dash.accidents.files.title'));
    expect(words).toContain(ar('fleet.dash.accidents.files.tag'));
    expect(words).toContain(`5 ${ar('fleet.dash.common.noun.file.few')}`);
    expect(words).toContain(`${ar('fleet.dash.accidents.files.remaining')} 4,300.00`);
    expect(target(hrefOf(card, 'accidentsOpen.count'))).toEqual({
      path: '/fleet/accidents',
      params: { status: 'open' },
    });
    expect(target(hrefOf(card, 'accidentsOpen.all'))).toEqual({
      path: '/fleet/accidents',
      params: { status: 'open' },
    });
    expect(words).toContain(ar('fleet.dash.accidents.files.all'));
    expect(card).toContain('border-l-rose-500');
  });

  it('writes a negative remaining on the open files in red, with «−»', () => {
    const card = kpi(
      tab({ now: { ...NOW, accidentsOpen: { count: 2, remaining: -10_200 } } }),
      'files',
    );
    const remaining = slice(card, 'data-acc-files-remaining', '-10200', 'data-dash-foot');
    expect(text(remaining)).toContain('−10,200.00');
    expect(remaining).toContain('text-red-600');
  });

  it('«إخطارات تأمين مفتوحة» is amber, never red, and opens the open notices', () => {
    const card = kpi(DEFAULT, 'notices');
    expect(card).toContain('border-l-amber-500');
    expect(card).not.toMatch(/\b(?:text|bg|border)-red-/u);
    const words = text(card);
    expect(words).toContain(ar('fleet.dash.accidents.notices.title'));
    expect(words).toContain(`6 ${ar('fleet.dash.common.noun.notice.few')}`);
    expect(target(hrefOf(card, 'notices.open'))).toEqual({
      path: '/fleet/notices',
      params: { status: 'open' },
    });
  });

  it('tags the notices missing an attachment with `missingAny`, plain (no screen lists exactly them)', () => {
    const tag = slice(kpi(DEFAULT, 'notices'), 'data-acc-missing-tag', '5', '</span></span>');
    expect(text(tag)).toContain(ar('fleet.dash.accidents.notices.missingTag', { count: 5 }));
    expect(tag).not.toContain('<a ');
  });

  it('splits them: «صور الرخص» plain, «صورة الشيك» opening the notices without the cheque', () => {
    const parts = slice(kpi(DEFAULT, 'notices'), 'data-acc-notice-parts', 'true', 'data-dash-foot');
    const words = text(parts);
    expect(words).toContain(`${ar('fleet.dash.accidents.notices.licences')} 2`);
    expect(words).toContain(`${ar('fleet.dash.accidents.notices.cheque')} 4`);
    expect(links(parts)).toHaveLength(1);
    expect(target(hrefOf(parts, 'notices.missingCheckImage'))).toEqual({
      path: '/fleet/notices',
      params: { status: 'open', checkImage: 'missing' },
    });
  });

  it('writes the two rules once, in the card’s foot', () => {
    const words = text(kpi(DEFAULT, 'notices'));
    expect(words).toContain(ar('fleet.dash.accidents.notices.once'));
    expect(words).toContain(ar('fleet.dash.accidents.notices.rule'));
    expect(text(DEFAULT).split(ar('fleet.dash.accidents.notices.rule'))).toHaveLength(2);
  });

  it('under a branch, every notices link carries it and nothing says «الشركة كلها»', () => {
    const html = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
    for (const metric of [
      'notices.open',
      'notices.missingCheckImage',
      'notices.all',
      'notices.row',
    ]) {
      expect(target(hrefOf(html, metric)).params.branch, metric).toBe(B1);
    }
    expect(target(hrefOf(html, 'accidentsOpen.count')).params.branch).toBe(B1);
    expect(target(hrefOf(html, 'accidentsOpen.all')).params.branch).toBe(B1);
    expect(html).not.toContain('data-company-wide');
  });
});

// ── 3 · «إخطارات ينقصها مرفق» ─────────────────────────────────────────────────────────────────

describe('«إخطارات ينقصها مرفق» — the server’s rows, the oldest first', () => {
  const table = block(DEFAULT, 'notices');

  it('heads the table with `missingAny` and its note, and draws the rows in the server’s order', () => {
    expect(text(table)).toContain(ar('fleet.dash.accidents.missing.title'));
    expect(text(table)).toContain(ar('fleet.dash.accidents.missing.note'));
    const chip = slice(table, 'data-acc-chip', 'notices', '</div>');
    expect(text(chip)).toContain(`5 ${ar('fleet.dash.common.noun.notice.few')}`);
    const at = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => table.indexOf(`data-notice-row="${id}"`));
    expect(at.every((i) => i !== -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('names the car and its make, or «بلا سيارة»; the insurer by the notice’s form', () => {
    const n1 = text(noticeRow(table, 'n1'));
    expect(n1).toContain('247');
    expect(n1).toContain(SPRINTER.ar);
    expect(n1).toContain(NOTICE_INSURER.misrInsurance);
    expect(n1).toContain('24117');
    expect(n1).toContain('2026/10/21');
    const n3 = text(noticeRow(table, 'n3'));
    expect(n3).toContain(NOTICE_INSURER.deltaInsurance);
    const n4 = text(noticeRow(table, 'n4'));
    expect(n4).toContain(ar('fleet.dash.accidents.missing.noVehicle'));
    // One source of the names: the forms the notices screen fills read the same words.
    expect(noticeTemplate('misrInsurance')?.insurer).toBe(NOTICE_INSURER.misrInsurance);
    expect(noticeTemplate('deltaInsurance')?.insurer).toBe(NOTICE_INSURER.deltaInsurance);
  });

  it('writes a notice with no day as «—», never a made-up date', () => {
    expect(text(cell(noticeRow(table, 'n5'), 'data-acc-date'))).toContain('—');
  });

  it('tags what each notice still owes, in amber: «صور الرخص» for either licence, «صورة الشيك»', () => {
    const n1 = noticeRow(table, 'n1');
    expect(n1).toContain('data-acc-missing="cheque"');
    expect(n1).not.toContain('data-acc-missing="licences"');
    const n3 = noticeRow(table, 'n3');
    expect(n3).toContain('data-acc-missing="licences"');
    expect(n3).toContain('data-acc-missing="cheque"');
    const n4 = noticeRow(table, 'n4');
    expect(n4).toContain('data-acc-missing="licences"');
    expect(n4).not.toContain('data-acc-missing="cheque"');
    expect(table).not.toMatch(/\b(?:text|bg|border)-red-/u);
  });

  it('opens each notice by what it carries — its car, number and day — and a bare one not at all', () => {
    expect(target(hrefOf(noticeRow(table, 'n1'), 'notices.row'))).toEqual({
      path: '/fleet/notices',
      params: {
        status: 'open',
        vehicleCodes: '247',
        number: '24117',
        from: '2026-10-21',
        to: '2026-10-21',
      },
    });
    expect(target(hrefOf(noticeRow(table, 'n4'), 'notices.row'))).toEqual({
      path: '/fleet/notices',
      params: { status: 'open', number: '7001', from: '2026-10-31', to: '2026-10-31' },
    });
    expect(links(noticeRow(table, 'n5'))).toEqual([]);
  });

  it('opens the open notices and those without the cheque from its foot, with their counts', () => {
    const words = text(table);
    expect(words).toContain(ar('fleet.dash.accidents.missing.allOpen', { count: 6 }));
    expect(words).toContain(ar('fleet.dash.accidents.missing.noCheque', { count: 4 }));
    expect(target(hrefOf(table, 'notices.all'))).toEqual({
      path: '/fleet/notices',
      params: { status: 'open' },
    });
    expect(target(hrefOf(table, 'notices.missingCheckImage.all'))).toEqual({
      path: '/fleet/notices',
      params: { status: 'open', checkImage: 'missing' },
    });
  });

  it('names the rows past the cap as «و N أخرى», plain, and only past it', () => {
    expect(table).not.toContain('data-acc-more="notices"');
    const rows = [0, 1, 2, 3, 4, 5].map((i) =>
      notice({ noticeId: `m${i}`, noticeNumber: String(9000 + i), noticeDate: '2026-10-20' }),
    );
    const many = block(
      tab({
        now: { ...NOW, notices: { ...NOTICES, open: 11, missingAny: 9, rows } },
      }),
      'notices',
    );
    expect(FLEET_DASHBOARD_NOTICE_ROWS).toBe(6);
    const more = slice(many, 'data-acc-more', 'notices', '</div>');
    // The figure sits in its own face, glued to «و»: compared without the gap the tags leave.
    expect(squeeze(text(more))).toContain(
      squeeze(ar('fleet.dash.accidents.missing.more', { count: 3 })),
    );
    expect(more).not.toContain('<a ');
  });

  it('says so when no open notice is missing an attachment', () => {
    const none = block(
      tab({
        now: {
          ...NOW,
          notices: { open: 1, missingAny: 0, missingLicences: 0, missingCheckImage: 0, rows: [] },
        },
      }),
      'notices',
    );
    expect(text(none)).toContain(ar('fleet.dash.accidents.missing.empty'));
    expect(none).not.toContain('<table');
  });

  it('is a table from 1024 px and a block a row below it (no sideways scroll on a phone)', () => {
    expect(classOf(table, '<table')).toContain('max-lg:block');
    expect(classOf(table, '<thead')).toContain('max-lg:hidden');
    expect(classOf(table, 'data-notice-row="n1"')).toContain('max-lg:grid');
  });
});

// ── 4 · «خلال الفترة» ─────────────────────────────────────────────────────────────────────────

describe('«خلال الفترة» — the period’s files by accident day, their money, their list', () => {
  it('«حوادث الفترة»: the count and the still-open, each opening the register over the same days', () => {
    const card = kpi(DEFAULT, 'period');
    const words = text(card);
    expect(words).toContain(ar('fleet.dash.accidents.title'));
    expect(words).toContain(ar('fleet.dash.accidents.period.tag'));
    expect(words).toContain(`8 ${ar('fleet.dash.common.noun.accident.few')}`);
    expect(words).toContain(ar('fleet.dash.accidents.period.open', { count: 3 }));
    expect(hrefOf(card, 'accidents.count')).toBe(`/fleet/accidents?${DATES}`);
    expect(hrefOf(card, 'accidents.open')).toBe(`/fleet/accidents?${DATES}&status=open`);
    expect(hrefOf(card, 'accidents.period')).toBe(`/fleet/accidents?${DATES}`);
  });

  it('never draws the open files’ remaining of the period: every «المتبقي» names its basis', () => {
    // The server sends no open-files-only remaining any more (it went with the period-figures
    // tab, 22 November); nothing on this tab ever drew one.
    expect(text(DEFAULT)).not.toContain('9,800.00');
    expect(hrefs(DEFAULT, 'accidents.openRemaining')).toEqual([]);
  });

  it('draws the money in the register’s order and words, each opening the register', () => {
    const money = block(DEFAULT, 'money');
    expect(text(money)).toContain(ar('fleet.dash.accidents.money.title'));
    expect(text(money)).toContain(ar('fleet.dash.accidents.money.note'));
    expect(text(money)).toContain(ar('fleet.dash.accidents.money.asNow'));
    const fields = ['amountCollected', 'companyCost', 'paidAmount', 'remaining'] as const;
    const at = fields.map((f) => money.indexOf(`data-acc-money="${f}"`));
    expect(at.every((i) => i !== -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const field of fields) {
      const one = tile(money, field);
      expect(text(one)).toContain(ar(`fleet.accidents.totals.${field}`));
      expect(hrefOf(one, `accidents.${field}`)).toBe(`/fleet/accidents?${DATES}`);
    }
    expect(text(tile(money, 'amountCollected'))).toContain('16,700.00');
    expect(text(tile(money, 'companyCost'))).toContain('2,500.00');
    expect(text(tile(money, 'paidAmount'))).toContain('28,900.00');
  });

  it('writes a negative remaining in red with «−», and a positive one plain', () => {
    const red = tile(block(DEFAULT, 'money'), 'remaining');
    expect(text(red)).toContain('−8,700.00');
    expect(red).toContain('text-red-600');
    const plus = tile(
      block(
        tab({
          page: {
            ...PAGE,
            accidents: {
              ...ACCIDENTS,
              totals: { ...ACCIDENTS.totals, paidAmount: 12_000, remaining: 8_200 },
            },
          },
        }),
        'money',
      ),
      'remaining',
    );
    expect(text(plus)).toContain('8,200.00');
    expect(text(plus)).not.toContain('−');
    expect(plus).not.toContain('text-red-600');
  });

  it('writes the transfers between cars as one plain line, and the formula they add up by', () => {
    const money = block(DEFAULT, 'money');
    const line = slice(money, 'data-acc-transfers', 'true', 'data-acc-formula');
    const words = text(line);
    expect(words).toContain(`${ar('fleet.accidents.transferLine.in')} 3,400.00`);
    expect(words).toContain(`${ar('fleet.accidents.transferLine.out')} 2,400.00`);
    expect(line).not.toContain('<a ');
    expect(text(money)).toContain(ar('fleet.dash.accidents.money.formula'));
  });
});

describe('«حوادث الفترة» — the table (the old tab 10, re-homed)', () => {
  const list = block(DEFAULT, 'list');

  it('heads it with the period’s count and «الأحدث أولًا», and draws the server’s rows', () => {
    expect(text(list)).toContain(ar('fleet.dash.accidents.list.note'));
    expect(text(slice(list, 'data-acc-chip', 'list', '</div>'))).toContain(
      `8 ${ar('fleet.dash.common.noun.accident.few')}`,
    );
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      expect(list).toContain(`data-accident-row="${id}"`);
    }
    for (const key of ['col.date', 'col.statement', 'col.remaining']) {
      expect(text(list)).toContain(ar(`fleet.dash.accidents.${key}`));
    }
  });

  it('shows each accident’s date only in its date cell — never a time — and opens it on its car and day', () => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      const date = text(cell(accidentRow(list, id), 'data-acc-date'));
      expect(date, id).toMatch(/\d{4}\/\d{2}\/\d{2}/u);
      expect(date, id).not.toMatch(/\d{1,2}:\d{2}/u);
    }
    expect(text(cell(accidentRow(list, 'a4'), 'data-acc-date'))).toContain('2026/10/06');
    expect(hrefs(list, 'accidentList.row')[0]).toBe(
      '/fleet/accidents?vehicleCodes=207&from=2026-10-27&to=2026-10-27',
    );
  });

  it('writes the statement on one line with its whole text in the title, and «—» for none', () => {
    const a1 = accidentRow(list, 'a1');
    const statement = slice(a1, 'data-acc-statement', 'a1', '</p>');
    expect(unescape(statement)).toContain(`title="${LIST.rows[0]?.statement ?? ''}"`);
    const classes = classOf(a1, 'data-acc-statement').split(/\s+/u);
    // One line from 1536 px (the approved table) …
    expect(classes).toContain('truncate');
    // … and below it a wrapped statement a touch screen can read without hovering: up to three
    // lines in the phone / tablet block, two in the narrower 1280–1535 table.
    expect(classes).toEqual(
      expect.arrayContaining([
        'max-2xl:whitespace-normal',
        'max-xl:line-clamp-3',
        'xl:max-2xl:line-clamp-2',
      ]),
    );
    expect(accidentRow(list, 'a4')).not.toContain('data-acc-statement');
  });

  it('names the car’s make under its chip, and nothing for a file with no make', () => {
    expect(text(accidentRow(list, 'a1'))).toContain(SPRINTER.ar);
    expect(text(accidentRow(list, 'a2'))).toContain(ATEGO.ar);
    expect(text(accidentRow(list, 'a4'))).not.toContain(SPRINTER.ar);
  });

  it('puts the driver card only on a culprit who is one of ours; the text as written otherwise', () => {
    expect(accidentRow(list, 'a1')).toContain('data-culprit="driver"');
    expect(accidentRow(list, 'a2')).toContain('data-culprit="text"');
    expect(text(accidentRow(list, 'a4'))).toContain(ar('fleet.dash.accidents.noCulprit'));
  });

  it('writes the state and the remaining as of now, a negative one red with «−»', () => {
    const a1 = accidentRow(list, 'a1');
    expect(a1).toContain('data-acc-status="open"');
    expect(text(a1)).toContain(ar('fleet.accidents.status.open'));
    expect(text(a1)).toContain('−12,200.00');
    expect(text(accidentRow(list, 'a3'))).toContain(ar('fleet.accidents.status.closed'));
    expect(text(accidentRow(list, 'a2'))).toContain('3,300.00');
  });

  it('opens the rest of the list in the log only when there is a rest, and the log from its foot', () => {
    expect(text(list)).toContain(ar('fleet.dash.accidents.more', { count: 2 }));
    expect(hrefOf(list, 'accidentList.more')).toBe(`/fleet/accidents?${DATES}`);
    expect(hrefOf(list, 'accidentList.all')).toBe(`/fleet/accidents?${DATES}`);
    expect(text(list)).toContain(ar('fleet.dash.accidents.register'));
    const all = block(tab({ page: { ...PAGE, accidentList: { ...LIST, more: 0 } } }), 'list');
    expect(hrefs(all, 'accidentList.more')).toEqual([]);
    expect(hrefOf(all, 'accidentList.all')).toBe(`/fleet/accidents?${DATES}`);
  });

  it('notes the undated files in the company view, and not when the server leaves them out', () => {
    const note = slice(DEFAULT, 'data-acc-note', 'true', '</p>');
    expect(text(note)).toContain(ar('fleet.dash.accidents.note'));
    expect(note).toContain('data-undated="true"');
    expect(text(note)).toContain(ar('fleet.dash.accidents.undated', { count: 25 }));
    const branch = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
    expect(branch).toContain('data-acc-note="true"');
    expect(branch).not.toContain('data-undated="true"');
  });

  it('says so when the period has no accident', () => {
    const none = block(
      tab({
        page: {
          ...PAGE,
          accidents: { ...ACCIDENTS, count: 0, open: 0 },
          accidentList: { rows: [], more: 0 },
        },
      }),
      'list',
    );
    expect(text(none)).toContain(ar('fleet.dash.accidents.empty'));
    expect(none).not.toContain('<table');
  });

  it('is a table from 1280 px and a block a row below it (the statement keeps its line; no sideways scroll)', () => {
    expect(classOf(list, '<table')).toContain('max-xl:block');
    expect(classOf(list, '<thead')).toContain('max-xl:hidden');
    expect(classOf(list, 'data-accident-row="a1"')).toContain('max-xl:grid');
  });
});

// ── 5 · Each read its own face; each reader their own parts ──────────────────────────────────

describe('each read has its own face', () => {
  it('R2 failed: «الآن» stands whole, the period band keeps its bar and shows the read’s error', () => {
    const html = tab({ pageFails: true });
    expect(html).toContain('data-acc-kpi="files"');
    expect(html).toContain('data-acc-block="notices"');
    const period = html.slice(html.indexOf('data-acc-band="period"'));
    expect(period).toContain('data-period-filters="true"');
    expect(period).toContain('data-dash-read-error="true"');
    expect(period).not.toContain('data-acc-kpi="period"');
  });

  it('R2 on its way: its skeleton, never zeroes; «الآن» stands whole', () => {
    const html = tab({ page: null });
    expect(html).toContain('data-acc-kpi="notices"');
    const period = html.slice(html.indexOf('data-acc-band="period"'));
    expect(period).toContain('data-read-band="loading"');
    expect(period).not.toContain('data-acc-block="money"');
  });

  it('R1 failed: the period band stands whole, «الآن» shows the read’s error', () => {
    const html = tab({ nowFails: true });
    const now = html.slice(0, html.indexOf('data-acc-band="period"'));
    expect(now).toContain('data-dash-read-error="true"');
    expect(now).not.toContain('data-acc-kpi="files"');
    expect(html).toContain('data-acc-kpi="period"');
    expect(html).toContain('data-acc-block="money"');
    expect(html).toContain('data-acc-block="list"');
  });

  it('R1 on its way: its cards and table in grey', () => {
    const html = tab({ now: null });
    const now = html.slice(0, html.indexOf('data-acc-band="period"'));
    expect(now).toContain('data-read-band="loading"');
    expect(now).not.toContain('data-acc-kpi="notices"');
    expect(html).toContain('data-acc-kpi="period"');
  });

  it('a section that failed shows its error in its place, the rest drawn', () => {
    const html = tab({
      now: { ...NOW, unavailable: ['notices'] },
      page: { ...PAGE, unavailable: ['accidentList'] },
    });
    expect(html).toContain('data-section-error="notices"');
    expect(html).toContain('data-acc-kpi="files"');
    expect(html).not.toContain('data-acc-block="notices"');
    expect(html).toContain('data-section-error="accidentList"');
    expect(html).toContain('data-acc-block="money"');
    expect(html).not.toContain('data-acc-block="list"');
  });
});

describe('each reader sees their own parts', () => {
  it('a reader of the notices alone: «الآن» with the notices only, full width, and no period band', () => {
    const html = tab({ page: null }, ['fleetNotice.view']);
    expect(html).toContain('data-acc-kpi="notices"');
    expect(html).toContain('data-acc-block="notices"');
    expect(html).not.toContain('data-acc-kpi="files"');
    expect(html).not.toContain('data-acc-band="period"');
    expect(html).not.toContain('data-period-filters');
    expect(classOf(html, 'data-acc-kpis="now"')).not.toContain('md:grid-cols-2');
    expect(text(html.slice(0, html.indexOf('data-dash-band="now"')))).toContain(
      ar('fleet.dash.accidents.headingSub.one', {
        part: ar('fleet.dash.accidents.headingSub.notices'),
      }),
    );
  });

  it('a reader of the accidents alone: the files and the period, no notices anywhere', () => {
    const html = tab({}, ['fleetAccident.view']);
    expect(html).toContain('data-acc-kpi="files"');
    expect(html).not.toContain('data-acc-kpi="notices"');
    expect(html).not.toContain('data-acc-block="notices"');
    expect(hrefs(html, 'notices.open')).toEqual([]);
    expect(classOf(html, 'data-acc-kpis="now"')).not.toContain('md:grid-cols-2');
    expect(html).toContain('data-acc-kpi="period"');
    expect(html).toContain('data-acc-block="list"');
    expect(text(html.slice(0, html.indexOf('data-dash-band="now"')))).toContain(
      ar('fleet.dash.accidents.headingSub.line', {
        now: ar('fleet.dash.accidents.headingSub.files'),
        period: ar('fleet.dash.accidents.headingSub.period'),
      }),
    );
  });

  it('a reader of both: the two «الآن» cards side by side from 768 px', () => {
    expect(classOf(DEFAULT, 'data-acc-kpis="now"')).toContain('md:grid-cols-2');
  });
});
