// «لوحة تحكم الحركة» — «العدادات والكيلومترات», the owner-approved sample (approved/odo-dark.png and
// odo-branch-dark.png; harness zz-odometer.tsx `?bars=brand`; plan build-ka §5), a tab of «الآن» and a
// period both, in place of the old «الكيلومترات» AND «ترتيب السيارات» bodies.
//
// What this file pins: the words and the order the owner approved; the period bar at the top; every
// figure reads its server field (`staleCount`, `neverReadCount`, `noDistance.cars`, `invalidRows`,
// the coverage parts — never a list's length) and opens the list that shows it, or nothing when no
// list does (the per-car average, the coverage, the active foot); the brand family on every bar and
// column (DECISIONS §5) with the status colours kept; the Fridays dimmed; the exceptions at most
// FLEET_DASHBOARD_EXCEPTION_ROWS rows a group, the rest named; «الكيلومترات حسب النوع» under ONE branch
// only; R1 and R2 each with their own face. It also carries the pins of the old tabs 7 and 8 that
// still hold (the R-15 drawing; the ranking's links, the workshop days, the reasons a car is not
// ranked, no record link without the registry) — the km-by-branch card is gone (it lives on «توزيع
// السيارات»).
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_EXCEPTION_ROWS,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type LocalizedString,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  T1,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import {
  EMPTY_DAY,
  FROM_30,
  KM_TOTAL,
  PENDING_DAY,
  PERIOD_FULL,
  PERIOD_YEAR,
  SPAN_DAY,
  STALE_DAY,
  UNREGISTERED_KM,
} from './fleet-dashboard-period-fixtures';

// ── The figures ───────────────────────────────────────────────────────────────────────────────

const named = (arName: string, en: string): LocalizedString => ({ ar: arName, en });
const SPRINTER = named('مرسيدس اسبرانتر 515', 'Mercedes Sprinter 515');
const ATEGO = named('مرسيدس اسيليو 915', 'Mercedes Atego 915');
const LAND = named('تويوتا لاند كروزر', 'Toyota Land Cruiser');
const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

type Km = NonNullable<FleetDashboardPeriodDto['km']>;
type NoReading = NonNullable<FleetDashboardNowDto['noReading']>;

/** Five stale cars (the whole list, code order), three of them in the rows; two never read. */
const NO_READING: NoReading = {
  days: 3,
  stale: [
    { vehicleId: 'v112', code: '112', lastDate: '2026-10-22' },
    { vehicleId: 'v150', code: '150', lastDate: '2026-10-26' },
    { vehicleId: 'v161', code: '161', lastDate: '2026-10-20' },
    { vehicleId: 'v283', code: '283', lastDate: '2026-10-25' },
    { vehicleId: 'v304', code: '304', lastDate: '2026-10-28' },
  ],
  neverRead: [
    { vehicleId: 'v318', code: '318' },
    { vehicleId: 'v336', code: '336' },
  ],
  staleCount: 5,
  neverReadCount: 2,
  staleRows: [
    { vehicleId: 'v161', code: '161', typeName: SPRINTER, lastDate: '2026-10-20', days: 12 },
    { vehicleId: 'v112', code: '112', typeName: ATEGO, lastDate: '2026-10-22', days: 10 },
    { vehicleId: 'v283', code: '283', typeName: null, lastDate: '2026-10-25', days: 7 },
  ],
  neverReadRows: [
    { vehicleId: 'v318', code: '318', typeName: LAND },
    { vehicleId: 'v336', code: '336', typeName: null },
  ],
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  noReading: NO_READING,
  vehicleScope: null,
  unavailable: [],
};

const BASE_KM = PERIOD_FULL.km as Km;
/** Over «آخر 30 يومًا»: 43 active, 2 in the workshop for the whole period, 1 joined after it. */
const KM: Km = {
  ...BASE_KM,
  invalidRows: 4,
  perVehicleAvg: KM_TOTAL / 38,
  coverage: { withReadings: 38, of: 40, active: 43, inWorkshop: 2, joinedAfter: 1 },
  noDistance: { cars: 2, neverRead: 1, codes: ['305', '318'], neverReadCodes: ['318'] },
  invalidList: [
    {
      vehicleId: 'v305',
      code: '305',
      deleted: false,
      typeName: ATEGO,
      date: '2026-10-11',
      from: 143_905,
      to: 134_950,
      km: -8_955,
    },
    {
      vehicleId: 'v214',
      code: '214',
      deleted: false,
      typeName: SPRINTER,
      date: '2026-10-20',
      from: 186_420,
      to: 186_240,
      km: -180,
    },
    {
      vehicleId: null,
      code: 'B-77',
      deleted: false,
      typeName: null,
      date: '2026-10-25',
      from: 201_330,
      to: 201_290,
      km: -40,
    },
  ],
  top5: BASE_KM.top5.map((row, i) => ({ ...row, typeName: i === 1 ? ATEGO : SPRINTER })),
  bottom5: BASE_KM.bottom5.map((row, i) => ({ ...row, typeName: i === 3 ? null : ATEGO })),
  byType: null,
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
  km: KM,
  unavailable: [],
};

const URL_30 = '/fleet?tab=km&period=last30';
const DATES = `from=${FROM_30}&to=${TODAY}`;
const KMF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

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
  const at = html.indexOf('data-dash-tab-body="km"');
  if (at === -1) throw new Error('no km tab body');
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
/** The markup of one element, by an attribute it alone carries, up to the next one of its kind. */
const slice = (html: string, attr: string, value: string, next = `${attr}=`): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const end = html.indexOf(next, start + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : end);
};
const kpi = (html: string, id: string): string => slice(html, 'data-km-kpi', id);
const block = (html: string, id: string): string => slice(html, 'data-km-block', id);
const group = (html: string, id: string): string =>
  slice(html, 'data-km-exception', id, 'data-km-');
const exception = (html: string, id: string): string => {
  const start = html.indexOf(`data-km-exception="${id}"`);
  if (start === -1) throw new Error(`no group ${id}`);
  const next = html.indexOf('data-km-exception=', start + 20);
  const end = next === -1 ? html.indexOf('data-km-page-note', start) : next;
  return html.slice(start, end === -1 ? undefined : end);
};
const column = (html: string, key: string): string => slice(html, 'data-km-column', key);
/** The class list of every element carrying `attr` (any value). */
const classesOf = (html: string, attr: string): string[] =>
  [...html.matchAll(new RegExp(`<[^>]*\\b${attr}="[^"]*"[^>]*>`, 'gu'))].map(
    (m) => /class="([^"]*)"/u.exec(m[0])?.[1] ?? '',
  );

const DEFAULT = tab();

// ── 1 · The heading, the bar and the order ───────────────────────────────────────────────────

describe('«العدادات والكيلومترات» — the heading, the period bar and the approved order', () => {
  it('heads the tab with the approved title and line, no live chip (it is a period tab too)', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-period-filters'));
    expect(text(head)).toContain(ar('fleet.dash.km.title'));
    expect(text(head)).toContain(ar('fleet.dash.km.sub'));
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('stands the dashboard’s period bar at the TOP, above every figure it moves (as _1)', () => {
    const bar = DEFAULT.indexOf('data-period-filters="true"');
    expect(bar).toBeGreaterThan(DEFAULT.indexOf('data-tab-head="true"'));
    expect(bar).toBeLessThan(DEFAULT.indexOf('data-km-kpis="true"'));
    expect(DEFAULT.match(/data-period-filters="true"/gu)).toHaveLength(1);
  });

  it('draws the five cards, the chart, the pair, the exceptions and the note in that order', () => {
    const order = [
      'data-km-kpi="total"',
      'data-km-kpi="perCar"',
      'data-km-kpi="noDistance"',
      'data-km-kpi="review"',
      'data-km-kpi="stale"',
      'data-km-block="chart"',
      'data-km-rank="top"',
      'data-km-rank="bottom"',
      'data-km-block="exceptions"',
      'data-km-page-note="true"',
    ].map((marker) => DEFAULT.indexOf(marker));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(DEFAULT)).toContain(ar('fleet.dash.km.pageNote'));
  });

  it('opens on an old «ترتيب السيارات» link: `?tab=ranking` lands on this tab', () => {
    const html = renderDashboard({
      url: '/fleet?tab=ranking&period=last30',
      client: client(),
    });
    expect(html).toContain('data-dash-tab-body="km"');
    expect(html).not.toContain('data-dash-tab-body="ranking"');
  });

  it('draws no sample marker and nothing of the old km-by-branch card', () => {
    expect(DEFAULT).not.toMatch(/data-zz-/u);
    expect(DEFAULT).not.toContain('km.byBranch');
    // The old card's words (their keys are retired with it).
    expect(text(DEFAULT)).not.toContain('الكيلومترات بالفروع');
    expect(text(DEFAULT)).not.toContain('الإجمالي = مجموع الفروع');
  });
});

// ── 2 · The five cards ────────────────────────────────────────────────────────────────────────

describe('the five cards — every figure a server field', () => {
  it('lays the five out two to a row under 1280 px with the fifth (R1) taking its row whole', () => {
    const grid = classesOf(DEFAULT, 'data-km-kpis')[0] ?? '';
    expect(grid.split(/\s+/u)).toEqual(
      expect.arrayContaining(['md:grid-cols-2', 'xl:grid-cols-6', 'min-[1800px]:grid-cols-5']),
    );
    const span = (id: string): string[] =>
      (
        /class="([^"]*)"/u.exec(
          DEFAULT.slice(DEFAULT.lastIndexOf('<', DEFAULT.indexOf(`data-km-kpi="${id}"`))),
        )?.[1] ?? ''
      ).split(/\s+/u);
    expect(span('stale')).toContain('md:max-xl:col-span-2');
    for (const id of ['total', 'perCar', 'noDistance', 'review']) {
      expect(span(id), id).not.toContain('md:max-xl:col-span-2');
    }
  });

  it('«إجمالي الكيلومترات»: the total over the period, confirmed through, the average a day', () => {
    const card = kpi(DEFAULT, 'total');
    expect(text(card)).toContain(ar('fleet.dash.km.total.title'));
    expect(text(card)).toContain(KMF.format(KM_TOTAL));
    expect(hrefOf(card, 'km.total')).toBe(`/fleet/odometer?${DATES}`);
    expect(text(card)).toContain('2026/10/30');
    expect(text(card)).toContain(`${KMF.format(KM.average ?? 0)} كم/يوم على 28 يومًا مغلقًا`);
    expect(text(card)).toContain(ar('fleet.dash.km.total.foot'));
  });

  it('«متوسط لكل سيارة»: plain figures (no list shows them), the coverage of the counted cars', () => {
    const card = kpi(DEFAULT, 'perCar');
    expect(text(card)).toContain(KMF.format(KM_TOTAL / 38));
    // «لـ» joins the figure that follows it (a tag of its own in the markup).
    expect(text(card)).toMatch(/قراءات لـ ?38 من 40 سيارة/u);
    expect(links(card)).toEqual([]);
    // 43 active, of them 2 in the workshop for the whole period and 1 that joined after it.
    expect(text(card)).toMatch(/43 نشطة، منها 2 في الورشة طوال الفترة، و ?1 انضمت بعد الفترة/u);
  });

  it('writes the in-workshop and joined-after clauses only when there is such a car', () => {
    const plain = kpi(
      tab({
        page: {
          ...PAGE,
          km: {
            ...KM,
            coverage: { withReadings: 38, of: 40, active: 40, inWorkshop: 0, joinedAfter: 0 },
          },
        },
      }),
      'perCar',
    );
    expect(plain).not.toContain('data-km-throughout');
    expect(plain).not.toContain('data-km-joined-after');
    expect(text(plain)).toContain('40 نشطة');
    const workshopOnly = kpi(
      tab({
        page: {
          ...PAGE,
          km: {
            ...KM,
            coverage: { withReadings: 38, of: 40, active: 42, inWorkshop: 2, joinedAfter: 0 },
          },
        },
      }),
      'perCar',
    );
    expect(workshopOnly).toContain('data-km-throughout="2"');
    expect(workshopOnly).not.toContain('data-km-joined-after');
  });

  it('«سيارات بلا مسافة في الفترة»: the server’s count, its cars on the vehicles list', () => {
    const card = kpi(DEFAULT, 'noDistance');
    expect(text(card)).toContain(ar('fleet.dash.km.noDistance.title'));
    expect(text(card)).toContain('من 40 سيارة تُحسب في الفترة');
    expect(hrefOf(card, 'km.noDistance')).toBe('/fleet/vehicles?vehicleCodes=305,318');
    expect(text(card)).toContain('منها 1 لم تُقرأ أبدًا');
    expect(hrefOf(card, 'km.noDistance.neverRead')).toBe('/fleet/vehicles?vehicleCodes=318');
  });

  it('draws the no-distance count plain over the codes’ cap, and for a reader without the registry', () => {
    const over = kpi(
      tab({
        page: {
          ...PAGE,
          km: { ...KM, noDistance: { cars: 61, neverRead: 4, codes: [], neverReadCodes: [] } },
        },
      }),
      'noDistance',
    );
    expect(text(over)).toContain('61');
    expect(hrefs(over, 'km.noDistance')).toEqual([]);
    expect(hrefs(over, 'km.noDistance.neverRead')).toEqual([]);
    const blind = kpi(
      tab(
        {},
        ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
      ),
      'noDistance',
    );
    expect(links(blind)).toEqual([]);
  });

  it('«قراءات تحتاج مراجعة»: `invalidRows` (never the rows listed), the period register to review', () => {
    const card = kpi(DEFAULT, 'review');
    expect(text(card)).toContain(ar('fleet.dash.km.review.title'));
    expect(text(card)).toContain(ar('fleet.dash.km.review.tag'));
    expect(text(card)).toMatch(/\b4 قراءات/u);
    expect(hrefOf(card, 'km.invalidRows')).toBe(`/fleet/odometer?${DATES}`);
    expect(hrefOf(card, 'km.invalidRows.list')).toBe(`/fleet/odometer?${DATES}`);
    expect(text(card)).toContain(ar('fleet.dash.km.review.link'));
  });

  it('«بلا قراءة عداد منذ 3 أيام»: R1’s `staleCount`, «لقطة الآن», the longest gap', () => {
    const card = kpi(DEFAULT, 'stale');
    expect(text(card)).toContain('بلا قراءة عداد منذ 3 أيام');
    expect(card).toContain('data-now-chip="true"');
    // Five stale cars, though the rows hold three.
    expect(text(card)).toMatch(/\b5 سيارات/u);
    expect(hrefOf(card, 'noReading.stale')).toBe(
      '/fleet/odometer?vehicleCodes=112,150,161,283,304&period=all',
    );
    expect(card).toContain('data-km-longest="161"');
    expect(text(card)).toContain('أطول انقطاع منذ 2026/10/20');
    expect(hrefOf(card, 'noReading.longest')).toBe('/fleet/vehicles/v161');
    expect(text(card)).toContain(ar('fleet.dash.km.stale.foot'));
    expect(text(card)).toContain(ar('fleet.dash.overview.actions.line.noReading.sub'));
  });

  it('says every active car was read recently when none is stale', () => {
    const card = kpi(
      tab({
        now: {
          ...NOW,
          noReading: { ...NO_READING, stale: [], staleCount: 0, staleRows: [] },
        },
      }),
      'stale',
    );
    expect(text(card)).toContain(ar('fleet.dash.km.stale.allRead'));
    expect(card).not.toContain('data-km-longest');
    expect(hrefs(card, 'noReading.stale')).toEqual([]);
  });

  it('counts nothing in the browser: the cards follow the fields, not the lists they come with', () => {
    // The server's counts are 9 stale and 7 review readings; the rows stay three each.
    const html = tab({
      now: { ...NOW, noReading: { ...NO_READING, staleCount: 9 } },
      page: { ...PAGE, km: { ...KM, invalidRows: 7 } },
    });
    expect(text(kpi(html, 'stale'))).toMatch(/\b9 سيارات/u);
    expect(text(kpi(html, 'review'))).toMatch(/\b7 قراءات/u);
  });
});

// ── 3 · The day chart (the old tab 7's R-15 pins, re-homed) ──────────────────────────────────

describe('«الكيلومترات يومًا بيوم» — the R-15 drawing, in the brand', () => {
  const chart = block(DEFAULT, 'chart');

  it('heads the chart with its title, the range and the total that opens the register', () => {
    expect(text(chart)).toContain(ar('fleet.dash.km.chart.titleDaily'));
    expect(text(chart)).toContain(ar('fleet.dash.km.chart.note'));
    expect(chart).toContain('data-dash-range="last30"');
    expect(hrefs(chart, 'km.total')).toEqual([`/fleet/odometer?${DATES}`]);
  });

  it('draws a day without any reading as an empty slot, never a bar', () => {
    const empty = column(chart, EMPTY_DAY);
    expect(empty).toContain('data-km-part="empty"');
    expect(empty).not.toContain('data-km-part="solid"');
    expect(empty).not.toContain('data-metric');
  });

  it('never draws today solid: it is hatched, waiting for its readings', () => {
    const today = column(chart, TODAY);
    expect(today).toContain('data-km-part="open"');
    expect(today).not.toContain('data-km-part="solid"');
  });

  it('keeps a stale day solid, with its amber marker', () => {
    const stale = column(chart, STALE_DAY);
    expect(stale).toContain('data-km-part="solid"');
    expect(stale).toContain('data-km-part="stale"');
    expect(stale).not.toContain('data-km-part="open"');
    expect(classesOf(stale, 'data-km-part').join(' ')).toContain('bg-amber-500');
  });

  it('hatches an unfinished day above its confirmed part', () => {
    const pending = column(chart, PENDING_DAY);
    expect(pending).toContain('data-km-part="solid"');
    expect(pending).toContain('data-km-part="open"');
  });

  it('stacks the span on its start day, outlined, never in the confirmed fill', () => {
    const start = column(chart, SPAN_DAY);
    const span = /<span data-km-part="span" class="([^"]*)"/u.exec(start)?.[1] ?? '';
    expect(span).toContain('border-dashed');
    expect(span).toContain('border-brand-700');
    expect(span).not.toContain('bg-brand-600');
  });

  it('draws every column in the brand: the kit’s bar shade, the latest day one shade stronger', () => {
    const solids = [...chart.matchAll(/data-km-part="solid" class="([^"]*)"/gu)].map(
      (m) => m[1] ?? '',
    );
    const on = solids.filter((c) => c.includes('bg-brand-800 dark:bg-brand-300'));
    expect(on).toHaveLength(1);
    for (const c of solids) expect(c).toMatch(/bg-brand-(600|800)/u);
    // The latest confirmed day (10/30) wears the stronger shade.
    expect(column(chart, '2026-10-30')).toContain('bg-brand-800');
    // No old palette on any part: not emerald, not violet.
    for (const c of classesOf(chart, 'data-km-part')) {
      expect(c).not.toMatch(/emerald|violet/u);
    }
    const open = [...chart.matchAll(/data-km-part="open" class="([^"]*)"/gu)].map((m) => m[1]);
    expect(open.length).toBeGreaterThan(0);
    for (const c of open) expect(c).toMatch(/rgb\(var\(--brand-500\)/u);
  });

  it('dims the Fridays by the calendar alone — a reading on a Friday does not change it', () => {
    for (const day of ['2026-10-16', '2026-10-23', '2026-10-30', EMPTY_DAY]) {
      expect(column(chart, day)).toContain('data-km-friday="true"');
    }
    for (const day of ['2026-10-17', '2026-10-29', TODAY]) {
      expect(column(chart, day)).not.toContain('data-km-friday');
    }
    expect(column(chart, '2026-10-23')).toContain('opacity-55');
    expect(column(chart, '2026-10-22')).not.toContain('opacity-55');
    expect(text(chart)).toContain(ar('fleet.dash.km.legend.friday'));
  });

  it('opens each day on the odometer screen over that day and the filters', () => {
    expect(column(chart, SPAN_DAY)).toContain(
      `href="/fleet/odometer?from=${SPAN_DAY}&amp;to=${SPAN_DAY}"`,
    );
    // 30 days, one without any reading: 29 columns open a day (the readout's figure is the 30th).
    expect(chart.match(/<a\b[^>]*data-km-column=/gu)).toHaveLength(29);
    expect(hrefs(chart, 'km.day')).toHaveLength(30);
  });

  it('draws the average line with its own label at the line’s end, and the closed days', () => {
    expect(chart).toContain('data-km-average="true"');
    const label = slice(chart, 'data-km-average-label', 'true', '</span></span>');
    expect(text(label)).toContain(`المتوسط ${KMF.format(KM.average ?? 0)} كم/يوم`);
    expect(text(chart)).toContain('28 يومًا مغلقًا');
  });

  it('notes the unfinished days, the empty day, the spans and the stale cars in its foot', () => {
    const notes = text(slice(chart, 'data-km-notes', 'true', 'data-km-rank'));
    expect(notes).toContain('2026/10/30');
    expect(notes).toContain('2026/10/31');
    expect(notes).toContain('2026/10/09');
    expect(notes).toContain(ar('fleet.dash.km.notes.openToday').replace(' {{day}}', ''));
    expect(chart).toContain('data-km-spans="true"');
    expect(chart).toContain('data-km-stale="true"');
  });

  it('writes the old book’s km under the chart only when there is some', () => {
    expect(chart).toContain('data-km-unregistered="true"');
    expect(text(chart)).toContain(KMF.format(UNREGISTERED_KM));
    const none = block(tab({ page: { ...PAGE, km: { ...KM, unregistered: null } } }), 'chart');
    expect(none).not.toContain('data-km-unregistered');
    const zero = block(tab({ page: { ...PAGE, km: { ...KM, unregistered: 0 } } }), 'chart');
    expect(zero).not.toContain('data-km-unregistered');
  });

  it('names every day and its weekday on a short period, «اليوم» under today', () => {
    const url = `/fleet?tab=km&period=custom&from=2026-10-22&to=${TODAY}`;
    const short = block(
      tab({
        url,
        page: {
          ...PAGE,
          range: { preset: 'custom', from: '2026-10-22', to: TODAY, days: 11, granularity: 'day' },
          km: { ...KM, buckets: BASE_KM.buckets.filter((b) => b.key >= '2026-10-22') },
        },
      }),
      'chart',
    );
    const labels = [...short.matchAll(/data-km-label="([^"]+)"/gu)].map((m) => m[1]);
    expect(labels).toHaveLength(11);
    const today = slice(short, 'data-km-label', TODAY, 'data-km-legend');
    expect(text(today)).toContain(ar('fleet.dash.km.axis.today'));
    expect(text(slice(short, 'data-km-label', '2026-10-23'))).toContain('الجمعة');
  });

  it('goes by the month above 31 days: no per-day average line, no Friday, every month named', () => {
    const year = block(
      tab({
        url: '/fleet?tab=km&period=thisYear',
        page: { ...PERIOD_YEAR, km: { ...KM, buckets: (PERIOD_YEAR.km as Km).buckets } },
      }),
      'chart',
    );
    expect(year).toContain('data-km-chart="month"');
    expect(year).not.toContain('data-km-average=');
    expect(year).not.toContain('data-km-friday');
    expect(year).not.toContain('data-km-swatch="friday"');
    expect(text(year)).toContain('2026/01');
    expect(text(year)).toContain(ar('fleet.dash.km.chart.titleMonthly'));
    expect(text(year)).toContain(ar('fleet.dash.km.chart.noteMonthly'));
    expect(column(year, '2026-01')).toContain(
      'href="/fleet/odometer?from=2026-01-01&amp;to=2026-01-31',
    );
    expect(column(year, '2026-02')).toContain('data-km-part="empty"');
    expect(column(year, '2026-11')).toContain('data-km-part="open"');
  });

  it('opens a phone’s scrolled plot on its latest days (the ltr group’s right end), not its oldest', () => {
    const scroller = slice(chart, 'data-km-scroller', 'true', 'data-km-column=');
    expect(scroller).toMatch(/class="[^"]*max-sm:overflow-x-auto/u);
    // The days run left to right inside a dir=ltr group: the end is the newest day.
    expect(chart.slice(0, chart.indexOf('data-km-scroller'))).toMatch(/dir="ltr"/u);
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'components/fleet-dashboard/km-chart.tsx'),
      'utf8',
    );
    expect(src).toContain('ref={scrollRef}');
    expect(src).toContain('if (el !== null) el.scrollLeft = el.scrollWidth;');
  });
});

// ── 4 · The ranking pair (the old tab 8's pins, re-homed) ────────────────────────────────────

describe('«أعلى 5» | «أقل 5» — one brand bar against the top car', () => {
  const pair = block(DEFAULT, 'ranking');

  it('ranks the five top and five bottom cars, each figure opening its readings over the period', () => {
    expect(pair).toContain('data-km-place="top-1"');
    expect(pair).toContain('data-km-place="bottom-5"');
    expect(hrefs(pair, 'km.top5')[0]).toBe(`/fleet/odometer?vehicleCodes=182&${DATES}`);
    expect(hrefs(pair, 'km.bottom5')[0]).toBe(`/fleet/odometer?vehicleCodes=141&${DATES}`);
    expect(hrefs(pair, 'km.top5')).toHaveLength(5);
    expect(hrefOf(pair, 'km.topVehicle')).toBe('/fleet/vehicles/v182');
    expect(hrefOf(pair, 'km.bottomVehicle')).toBe('/fleet/vehicles/v141');
  });

  it('writes the make under the car, and nothing when the server has none', () => {
    const top = slice(pair, 'data-km-place', 'top-2', 'data-km-place');
    expect(text(top)).toContain(ATEGO.ar);
    const nameless = slice(pair, 'data-km-place', 'bottom-4', 'data-km-place');
    expect(text(nameless)).not.toContain('مرسيدس');
  });

  it('says how long a bottom car has been in the workshop, «منذ N أيام» only', () => {
    expect(pair).toContain('data-km-in-workshop="2026-10-23"');
    expect(text(pair)).toContain('في الورشة منذ 9 أيام');
  });

  it('draws both lists in ONE brand colour, each bar against the top car', () => {
    const bars = classesOf(pair, 'data-km-bar');
    expect(bars).toHaveLength(10);
    for (const c of bars) {
      expect(c).toContain('bg-brand-600 dark:bg-brand-500');
      expect(c).not.toMatch(/emerald|amber|violet/u);
    }
    expect(pair).toMatch(/data-km-bar="182"[^>]*style="width:100%"/u);
    const bottom = (980 / 5140) * 100;
    expect(pair).toContain(
      `data-km-bar="141" class="h-2 rounded-full bg-brand-600 dark:bg-brand-500" style="width:${bottom}%"`,
    );
    // The rank badges are the brand's soft tone, not a warning.
    expect(pair).not.toMatch(/bg-amber-500\/80|bg-emerald-500\/80/u);
  });

  it('opens the period register under the top list — no screen ranks the cars by km', () => {
    const top = slice(pair, 'data-km-rank', 'top', 'data-km-rank="bottom"');
    expect(hrefOf(top, 'km.ranking.all')).toBe(`/fleet/odometer?${DATES}`);
    expect(text(top)).toContain(ar('fleet.dash.km.ranking.all'));
    expect(text(top)).toContain(ar('fleet.dash.km.ranking.barNote'));
    expect(text(top)).toContain(ar('fleet.dash.ranking.note'));
    const bottom = pair.slice(pair.indexOf('data-km-rank="bottom"'));
    expect(text(bottom)).toContain(ar('fleet.dash.km.ranking.bottomNote'));
  });

  it('lists every car without a valid reading by its reason, and never ranks it', () => {
    const out = slice(pair, 'data-km-out', 'true', 'data-km-block');
    for (const reason of ['noRow', 'onlyOpen', 'notActive'] as const) {
      expect(out).toContain(`data-km-reason="${reason}"`);
      expect(text(out)).toContain(ar(`fleet.dash.ranking.reason.${reason}`));
    }
    expect(text(out)).toContain(ar('fleet.dash.ranking.outTitle'));
    expect(pair).not.toContain('data-km-place="top-6"');
    expect(hrefs(out, 'km.withoutReadings')).toEqual([
      '/fleet/vehicles/v318',
      '/fleet/vehicles/v305',
      '/fleet/vehicles/v260',
    ]);
  });

  it('names a car whose only readings need review right after the days without a counter', () => {
    const out = slice(
      block(
        tab({
          page: {
            ...PAGE,
            km: {
              ...KM,
              withoutReadings: [
                ...KM.withoutReadings,
                { vehicleId: 'v209', code: '209', reason: 'onlyInvalid' },
              ],
            },
          },
        }),
        'ranking',
      ),
      'data-km-out',
      'true',
      'data-km-block',
    );
    expect(out).toContain('data-km-reason="onlyInvalid"');
    expect(out.indexOf('data-km-reason="onlyOpen"')).toBeLessThan(
      out.indexOf('data-km-reason="onlyInvalid"'),
    );
    expect(out.indexOf('data-km-reason="onlyInvalid"')).toBeLessThan(
      out.indexOf('data-km-reason="notActive"'),
    );
  });

  it('links no car record for a reader without the registry', () => {
    const blind = tab(
      {},
      ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
    );
    expect(links(blind).filter((l) => l.href.startsWith('/fleet/vehicles'))).toEqual([]);
    expect(hrefs(block(blind, 'ranking'), 'km.top5')).toHaveLength(5);
  });
});

// ── 5 · «استثناءات قراءات العدادات» ──────────────────────────────────────────────────────────

describe('«استثناءات قراءات العدادات» — three groups, the rest named', () => {
  const card = block(DEFAULT, 'exceptions');

  it('draws «بلا قراءة حديثة» · «لم تُقرأ أبدًا» · «قراءات تحتاج مراجعة», each at most three rows', () => {
    expect(FLEET_DASHBOARD_EXCEPTION_ROWS).toBe(3);
    expect(text(card)).toContain(ar('fleet.dash.km.exceptions.title'));
    expect(text(card)).toContain(ar('fleet.dash.km.exceptions.note'));
    const ids = [...card.matchAll(/data-km-exception="(\w+)"/gu)].map((m) => m[1]);
    expect(ids).toEqual(['stale', 'never', 'review']);
    for (const id of ['stale', 'never', 'review']) {
      const rows = exception(card, id).match(/<li\b[^>]*data-km-row=/gu) ?? [];
      expect(rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_EXCEPTION_ROWS);
    }
  });

  it('marks the two R1 groups «لقطة الآن» and not the period’s review group', () => {
    expect(group(card, 'stale')).toContain('data-now-chip="true"');
    expect(group(card, 'never')).toContain('data-now-chip="true"');
    expect(exception(card, 'review')).not.toContain('data-now-chip');
  });

  it('«بلا قراءة حديثة»: the longest gaps first, the server’s days, «فتح» on that car', () => {
    const stale = exception(card, 'stale');
    const rows = [...stale.matchAll(/<li\b[^>]*data-km-row="([^"]+)"/gu)].map((m) => m[1]);
    expect(rows).toEqual(['161', '112', '283']);
    expect(text(stale)).toContain('آخر قراءة 2026/10/20');
    expect(stale).toContain('data-since="12"');
    expect(hrefs(stale, 'noReading.row')).toEqual([
      '/fleet/odometer?vehicleCodes=161&period=all',
      '/fleet/odometer?vehicleCodes=112&period=all',
      '/fleet/odometer?vehicleCodes=283&period=all',
    ]);
    // The count is `staleCount` (5): two more than the rows, named and opened in full.
    expect(stale).toContain('data-km-chip="stale"');
    expect(text(stale)).toMatch(/و ?2 سيارات أخرى في القائمة الكاملة/u);
    expect(stale).toContain('data-km-group-end="more"');
    expect(hrefOf(stale, 'noReading.all')).toBe(
      '/fleet/odometer?vehicleCodes=112,150,161,283,304&period=all',
    );
    expect(text(stale)).toContain('عرض الكل (5)');
  });

  it('«لم تُقرأ أبدًا»: its record behind «فتح», the end line when the rows are all of it', () => {
    const never = exception(card, 'never');
    expect(hrefs(never, 'noReading.neverRow')).toEqual([
      '/fleet/vehicles/v318',
      '/fleet/vehicles/v336',
    ]);
    expect(text(never)).toContain(ar('fleet.dash.km.exceptions.end.never'));
    expect(hrefOf(never, 'noReading.neverRead')).toBe('/fleet/vehicles?vehicleCodes=318,336');
    expect(text(never)).toContain(LAND.ar);
  });

  it('opens no record and no list of never-read cars for a reader without the registry', () => {
    const never = exception(
      block(
        tab(
          {},
          ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
        ),
        'exceptions',
      ),
      'never',
    );
    expect(links(never)).toEqual([]);
  });

  it('names the rest without «في القائمة الكاملة» when no «عرض الكل» opens a list', () => {
    // Over 50 stale cars: no link carries them all (the codes cap), so no «عرض الكل».
    const stale = Array.from({ length: 51 }, (_, i) => ({
      vehicleId: `v${400 + i}`,
      code: String(400 + i),
      lastDate: '2026-10-20',
    }));
    const many = exception(
      block(
        tab({ now: { ...NOW, noReading: { ...NO_READING, stale, staleCount: 51 } } }),
        'exceptions',
      ),
      'stale',
    );
    expect(many).toContain('data-km-group-end="more"');
    expect(text(many)).toMatch(/و ?48 \S+ أخرى/u);
    expect(text(many)).not.toContain('في القائمة الكاملة');
    expect(hrefs(many, 'noReading.all')).toEqual([]);
    // A reader without the registry: «لم تُقرأ أبدًا» has no list to open either.
    const never = exception(
      block(
        tab(
          {
            now: {
              ...NOW,
              noReading: {
                ...NO_READING,
                neverRead: [
                  ...NO_READING.neverRead,
                  { vehicleId: 'v340', code: '340' },
                  { vehicleId: 'v341', code: '341' },
                  { vehicleId: 'v342', code: '342' },
                ],
                neverReadCount: 5,
              },
            },
          },
          ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
        ),
        'exceptions',
      ),
      'never',
    );
    expect(text(never)).toMatch(/و ?2 سيارات أخرى/u);
    expect(text(never)).not.toContain('في القائمة الكاملة');
    expect(never).not.toContain('data-metric="noReading.neverRead"');
    // With the registry, the same five keep the full-list wording and «عرض الكل».
    const listed = exception(
      block(
        tab({
          now: {
            ...NOW,
            noReading: {
              ...NO_READING,
              neverRead: [
                ...NO_READING.neverRead,
                { vehicleId: 'v340', code: '340' },
                { vehicleId: 'v341', code: '341' },
                { vehicleId: 'v342', code: '342' },
              ],
              neverReadCount: 5,
            },
          },
        }),
        'exceptions',
      ),
      'never',
    );
    expect(text(listed)).toMatch(/و ?2 سيارات أخرى في القائمة الكاملة/u);
    expect(text(listed)).toContain('عرض الكل (5)');
  });

  it('«قراءات تحتاج مراجعة»: from → to, the day, the negative km in rose, «فتح» on that ONE day', () => {
    const review = exception(card, 'review');
    expect(text(review)).toContain('من 143,905 إلى 134,950');
    expect(text(review)).toContain('2026/10/11');
    expect(text(review)).toContain('−8,955 كم');
    expect(review).toMatch(/data-km-negative="-8955" class="[^"]*text-rose-700/u);
    expect(hrefs(review, 'km.invalidList.row')).toEqual([
      '/fleet/odometer?vehicleCodes=305&from=2026-10-11&to=2026-10-11',
      '/fleet/odometer?vehicleCodes=214&from=2026-10-20&to=2026-10-20',
      '/fleet/odometer?vehicleCodes=B-77&from=2026-10-25&to=2026-10-25',
    ]);
    // An old-book code has no record to open.
    expect(hrefs(review, 'km.invalidList.vehicle')).toEqual([
      '/fleet/vehicles/v305',
      '/fleet/vehicles/v214',
    ]);
    // `invalidRows` (4) less the three rows: one more reading.
    expect(text(review)).toMatch(/و ?1 قراءة أخرى في القائمة الكاملة/u);
    expect(hrefOf(review, 'km.invalidList.all')).toBe(`/fleet/odometer?${DATES}`);
  });

  it('a car deleted since keeps its review row, with no link to its file; «فتح» opens that day', () => {
    const [first, ...rest] = KM.invalidList;
    if (first === undefined) throw new Error('no review row');
    const html = tab({
      page: { ...PAGE, km: { ...KM, invalidList: [{ ...first, deleted: true }, ...rest] } },
    });
    const review = exception(block(html, 'exceptions'), 'review');
    expect(review).toContain('data-km-row="305"');
    expect(hrefs(review, 'km.invalidList.vehicle')).toEqual(['/fleet/vehicles/v214']);
    expect(review).not.toContain('/fleet/vehicles/v305');
    // The register's code filter finds live cars only: that ONE day without the code.
    expect(hrefs(review, 'km.invalidList.row')).toEqual([
      '/fleet/odometer?from=2026-10-11&to=2026-10-11',
      '/fleet/odometer?vehicleCodes=214&from=2026-10-20&to=2026-10-20',
      '/fleet/odometer?vehicleCodes=B-77&from=2026-10-25&to=2026-10-25',
    ]);
  });

  it('ends a short group on its statement, and an empty one on its own line', () => {
    const html = tab({
      now: {
        ...NOW,
        noReading: {
          ...NO_READING,
          stale: NO_READING.stale.slice(0, 2),
          staleCount: 2,
          staleRows: NO_READING.staleRows.slice(0, 2),
          neverRead: [],
          neverReadCount: 0,
          neverReadRows: [],
        },
      },
      page: { ...PAGE, km: { ...KM, invalidRows: 0, invalidList: [] } },
    });
    const card0 = block(html, 'exceptions');
    expect(text(exception(card0, 'stale'))).toContain(ar('fleet.dash.km.exceptions.end.stale'));
    expect(text(exception(card0, 'never'))).toContain(ar('fleet.dash.km.exceptions.none.never'));
    expect(text(exception(card0, 'review'))).toContain(ar('fleet.dash.km.exceptions.none.review'));
    expect(exception(card0, 'never')).not.toContain('data-metric="noReading.neverRead"');
    expect(exception(card0, 'review')).not.toContain('km.invalidList.all');
  });

  it('speaks of the branch when the figures are one branch’s', () => {
    const html = tab({
      now: { ...NOW, branchId: B1, scopeBranches: [CAIRO] },
      page: {
        ...PAGE,
        vehicleScope: { ...COMPANY_SCOPE, count: 20, branchId: B1, scopeBranches: [CAIRO] },
        km: { ...KM, unregistered: null, invalidRows: 1, invalidList: KM.invalidList.slice(0, 1) },
      },
    });
    const card1 = block(html, 'exceptions');
    expect(text(card1)).toContain(ar('fleet.dash.km.exceptions.noteBranch'));
    expect(text(exception(card1, 'never'))).toContain(
      ar('fleet.dash.km.exceptions.end.neverBranch'),
    );
    expect(text(exception(card1, 'review'))).toContain(
      ar('fleet.dash.km.exceptions.end.reviewBranch'),
    );
    expect(text(block(html, 'chart'))).toContain(ar('fleet.dash.km.chart.noteBranch'));
  });
});

// ── 6 · Under one branch: «الكيلومترات حسب النوع» ───────────────────────────────────────────

describe('«الكيلومترات حسب النوع» — under ONE branch only', () => {
  const BRANCH_URL = '/fleet?tab=km&period=last30';
  const branchPage: FleetDashboardPeriodDto = {
    ...PAGE,
    vehicleScope: { ...COMPANY_SCOPE, count: 20, branchId: B1, scopeBranches: [CAIRO] },
    km: {
      ...KM,
      unregistered: null,
      byType: [
        { typeId: T1, name: SPRINTER, km: 9000 },
        { typeId: '650000000000000000000202', name: ATEGO, km: 3000 },
      ],
    },
  };

  it('is not drawn in the company view, nor under «كل فروعي»', () => {
    expect(DEFAULT).not.toContain('data-km-block="byType"');
    const mine = tab({
      now: { ...NOW, scopeBranches: [CAIRO, GIZA] },
      page: {
        ...PAGE,
        vehicleScope: { ...COMPANY_SCOPE, count: 30, scopeBranches: [CAIRO, GIZA] },
        km: { ...KM, unregistered: null, byType: null },
      },
    });
    expect(mine).not.toContain('data-km-block="byType"');
  });

  it('draws the branch’s km by type in brand columns, each opening its type in the branch', () => {
    const html = tab({
      url: BRANCH_URL,
      now: { ...NOW, branchId: B1, scopeBranches: [CAIRO] },
      page: branchPage,
    });
    const byType = block(html, 'byType');
    expect(text(byType)).toContain(ar('fleet.dash.km.byType'));
    expect(text(byType)).toContain(ar('fleet.dash.km.byTypeNote'));
    expect(hrefOf(byType, 'km.byType')).toBe(`/fleet/odometer?${DATES}&type=${T1}&branch=${B1}`);
    expect(text(byType)).toContain(SPRINTER.ar);
    expect(text(byType)).toContain('9,000');
    // The averages' line is «توزيع السيارات»'s own words.
    expect(text(byType)).toContain(
      ar('fleet.dash.distribution.averageLine', {
        day: '2026/10/30',
        km: KMF.format(KM.average ?? 0),
      }),
    );
    for (const c of classesOf(byType, 'data-dash-col-bar')) expect(c).not.toMatch(/teal|emerald/u);
  });
});

// ── 7 · Each read its own face ────────────────────────────────────────────────────────────────

describe('R1 and R2 — one failing never blanks the other', () => {
  it('R1 failed: the «بلا قراءة» card and the two R1 groups show their error; R2 stands', () => {
    const html = tab({ nowFails: true });
    expect(html).toContain('data-section-error="noReading"');
    expect(html).not.toContain('data-km-kpi="stale"');
    expect(html).toContain('data-km-kpi="total"');
    expect(html).toContain('data-km-block="chart"');
    expect(html).toContain('data-km-block="ranking"');
    const card = block(html, 'exceptions');
    expect(exception(card, 'stale')).toContain('data-section-error="noReading"');
    expect(exception(card, 'review')).toContain('data-km-row="305"');
  });

  it('R1 on its way: the «بلا قراءة» card and the R1 groups in grey, never zeroes', () => {
    const html = tab({ now: null });
    expect(html).toContain('data-km-loading="stale"');
    expect(exception(block(html, 'exceptions'), 'never')).toContain('data-dash-loading="true"');
    expect(html).toContain('data-km-kpi="review"');
  });

  it('R2 failed: its error in the cards’ place, no chart; R1’s card and groups stand', () => {
    const html = tab({ pageFails: true });
    expect(html).toContain('data-dash-read-error="true"');
    expect(html).not.toContain('data-km-kpi="total"');
    expect(html).not.toContain('data-km-block="chart"');
    expect(html).not.toContain('data-km-block="ranking"');
    expect(html).toContain('data-km-kpi="stale"');
    const card = block(html, 'exceptions');
    expect(exception(card, 'stale')).toContain('data-km-row="161"');
    expect(exception(card, 'review')).toContain('data-section-error="km"');
  });

  it('R2 on its way: the period parts in grey, R1 answered', () => {
    const html = tab({ page: null });
    expect(html).toContain('data-km-loading="period"');
    expect(html).not.toContain('data-km-block="chart"');
    expect(html).toContain('data-km-kpi="stale"');
  });

  it('the km section failed on the server: its error in the cards’ place', () => {
    const html = tab({ page: { ...PAGE, km: null, unavailable: ['km'] } });
    expect(html).toContain('data-section-error="km"');
    expect(html).not.toContain('data-km-kpi="total"');
    expect(html).toContain('data-km-kpi="stale"');
  });
});
