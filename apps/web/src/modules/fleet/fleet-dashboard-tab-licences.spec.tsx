// «لوحة تحكم الحركة» — «التراخيص والتجديدات», the owner-approved sample (approved/lic-dark.png and
// lic-branch-dark.png; harness zz-licences-tab.tsx; DECISIONS §11 «اعتمد», Q2 (أ) «أ جدول بالسواقين»,
// the critic's 21 corrections; plan build-cl §7), a tab of «الآن» and a period both that replaces the
// old «التراخيص وآخر ما سُجّل» body under the same key.
//
// What this file pins (plan D14–D18): every figure reads its server field and opens the list that
// shows it — the six KPIs (cars row over drivers row, each under its own section, the windows from
// each section's own `warnDays` through the counted noun, «ومن … إلى 60 يومًا» hidden at 60), the
// papers opening the board on its OPEN papers, «رخصة غير مسجّلة» linked and «بلا ملف سائق» plain;
// the fuel-card pointer and the drivers' branch note; the 12-month chart (two brand series, never a
// month total, «هذا الشهر» by word and band, column links with `status=active` for the cars); the two
// tables (the papers column only for the board's reader, one spelling per state, «الملف موقوف», the
// records' «فتح», «عرض الباقي» only when the server left rows out); the period band (the licence
// spend by memo day, the register's plain counts, the plain split bars with one-decimal shares,
// «الشركة كلها» while narrowed, the period choices alone on the bar, the custody note and link); the
// red badge hidden at 0; each band its own read's face; a reader of the licensing board alone; and
// the words the tab never says.
//
// Rendered through the real page over seeded caches (`renderDashboard`): R1 under its key, R2 under
// the key the address bar's filters make, Fleet's people list under its own.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
  FLEET_DASHBOARD_LICENCE_MONTHS,
  addDaysYmd,
  type FleetDashboardLicenceMonthDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowLicenceDriverRowDto,
  type FleetDashboardNowLicenceVehicleRowDto,
  type FleetDashboardPeriodDto,
  type FleetPersonDto,
  type LocalizedString,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { CLEARED, clearedFor, isClearedFor } from './components/fleet-dashboard/period-filter-bar';
import { type PeriodFilters } from './lib/fleet-dashboard-url';
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
  pagePeriodKey,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { PERIOD_FULL } from './fleet-dashboard-period-fixtures';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── The figures ───────────────────────────────────────────────────────────────────────────────

const named = (arName: string, en: string): LocalizedString => ({ ar: arName, en });
const M915 = named('مرسيدس اسيليو 915', 'Mercedes Atego 915');
const M515 = named('مرسيدس اسبرانتر 515', 'Mercedes Sprinter 515');
const HIACE = named('تويوتا هاى اس', 'Toyota Hiace');
const BARQASH_M = named('برقاش م', 'Barqash M');
const BARQASH_T = named('برقاش ت', 'Barqash T');
const AGOUZA_T = named('العجوزة ت', 'Agouza T');
const FIRST = named('اولى', 'First');
const SECOND = named('تانيه', 'Second');
const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };
const GIZA = { id: B2, name: { ar: 'مدينة نصر', en: 'Nasr City' } };

type CarRow = FleetDashboardNowLicenceVehicleRowDto;
const carRow = (code: string, days: number, over: Partial<CarRow> = {}): CarRow => ({
  vehicleId: `v${code}`,
  code,
  expiresAt: addDaysYmd(TODAY, days),
  days,
  typeName: M915,
  licenceClass: BARQASH_M,
  papers: null,
  ...over,
});

/** «أقرب تراخيص السيارات»: 4 expired (the longest first), then 2 of the 8 within 30 days. */
const CAR_ROWS: CarRow[] = [
  carRow('150', -2),
  carRow('118', -1, {
    typeName: M515,
    licenceClass: BARQASH_T,
    papers: { insurance: 'open', tax: 'done' },
  }),
  carRow('152', 0, { licenceClass: AGOUZA_T, papers: { insurance: 'none', tax: 'open' } }),
  // No make and no licence class recorded.
  carRow('119', 0, { typeName: null, licenceClass: null }),
  carRow('211', 3, {
    typeName: HIACE,
    licenceClass: BARQASH_T,
    papers: { insurance: 'open', tax: 'open' },
  }),
  carRow('297', 13, { typeName: M515 }),
];

/** The twelve slots from this month, the server's order. */
const MONTH_KEYS = Array.from({ length: FLEET_DASHBOARD_LICENCE_MONTHS }, (_, i) => {
  const m = 10 + i;
  return `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
});
const months = (counts: readonly number[]): FleetDashboardLicenceMonthDto[] =>
  MONTH_KEYS.map((key, i) => ({ key, count: counts[i] ?? 0 }));
const CAR_MONTHS = [6, 7, 13, 16, 13, 3, 0, 13, 16, 21, 3, 16];
const DRIVER_MONTHS = [2, 3, 4, 3, 5, 2, 4, 3, 2, 4, 3, 2];

type DriverRow = FleetDashboardNowLicenceDriverRowDto;
const driverRow = (id: string, days: number, over: Partial<DriverRow> = {}): DriverRow => ({
  profileId: `p${id}`,
  employeeId: `e${id}`,
  expiresAt: addDaysYmd(TODAY, days),
  days,
  licenceType: FIRST,
  active: true,
  ...over,
});

/** «أقرب رخص السائقين»: 2 expired (one on a suspended file), 3 within 30 days, 1 after them. */
const DRIVER_ROWS: DriverRow[] = [
  driverRow('520', -4),
  driverRow('611', 0, { active: false }),
  driverRow('487', 4, { licenceType: SECOND }),
  driverRow('553', 11),
  driverRow('702', 22, { licenceType: null }),
  // Its person is not on Fleet's people list.
  driverRow('438', 36),
];

const person = (id: string, name: string): FleetPersonDto => ({
  employeeId: `e${id}`,
  code: id,
  fullNameAr: name,
  status: 'active',
  branchId: B1,
  address: null,
  governorate: null,
  phone: null,
  hiredAt: null,
});
const PEOPLE: FleetPersonDto[] = [
  person('520', 'كمال عبد الرحيم'),
  person('611', 'رامي فوزي عبد العزيز'),
  person('487', 'وليد السيد منصور'),
  person('553', 'عادل رمضان حسين'),
  person('702', 'ياسر عبد الفتاح سالم'),
];

type Vehicles = NonNullable<FleetDashboardNowDto['licenceVehicles']>;
type Drivers = NonNullable<FleetDashboardNowDto['licenceDrivers']>;

const VEHICLES: Vehicles = {
  warnDays: 30,
  expired: 4,
  expiring: 8,
  soon: 4,
  outOfServiceExpired: 1,
  list: CAR_ROWS,
  more: 10,
  papersFailed: false,
  months: months(CAR_MONTHS),
};
const DRIVERS: Drivers = {
  warnDays: 30,
  expired: 2,
  expiring: 3,
  soon: 3,
  notRecorded: 3,
  unregistered: 1,
  months: months(DRIVER_MONTHS),
  list: { rows: DRIVER_ROWS, more: 2 },
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  licenceVehicles: VEHICLES,
  licenceDrivers: DRIVERS,
  papers: { insurance: 4, tax: 2 },
  unavailable: [],
};
/** The switcher on «المهندسين»: both reads echo it. */
const NOW_BRANCH: FleetDashboardNowDto = { ...NOW, branchId: B1, scopeBranches: [CAIRO] };
/** «كل فروعي»: the reader's two branches, no switcher branch. */
const NOW_MINE: FleetDashboardNowDto = { ...NOW, branchId: null, scopeBranches: [CAIRO, GIZA] };

/** renewal + extension = visa + cash = total. */
const SPEND = {
  count: 2,
  cars: 4,
  visa: 7_710,
  cash: 3_740,
  renewal: 6_020,
  extension: 5_430,
  total: 11_450,
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
  ...PERIOD_DTO,
  range: { preset: 'thisMonth', from: TODAY, to: TODAY, days: 1, granularity: 'day' },
  vehicleScope: COMPANY_SCOPE,
  licenceSpend: SPEND,
  unavailable: [],
};
const PAGE_BRANCH: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] },
};
const PAGE_MINE: FleetDashboardPeriodDto = {
  ...PAGE,
  vehicleScope: { ...COMPANY_SCOPE, scopeBranches: [CAIRO, GIZA] },
};

const TAB_URL = '/fleet?tab=licences';
/** Every key of the page, and the licence expenses' (a PAGELESS key: it opens no page alone). */
const KEYS: readonly string[] = [...ALL_KEYS, 'fleetLicenseExpense.view'];
const DAY = (n: number): string => addDaysYmd(TODAY, n);

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────

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
  url = TAB_URL,
  nowFails = false,
  pageFails = false,
}: {
  now?: FleetDashboardNowDto;
  page?: FleetDashboardPeriodDto;
  url?: string;
  nowFails?: boolean;
  pageFails?: boolean;
} = {}): QueryClient => {
  const qc = dashboardClient({ now: nowFails ? null : now, period: null });
  if (nowFails) failed(qc, fleetDashboardKeys.now);
  if (pageFails) failed(qc, pagePeriodKey(url));
  else qc.setQueryData(pagePeriodKey(url), page);
  // Fleet's people list (`/fleet/people`), the names the drivers' rows read.
  qc.setQueryData(['fleet', 'people'], PEOPLE);
  return qc;
};

/** The whole page (the bar too). */
const page = (
  seed: Parameters<typeof client>[0] = {},
  permissions: readonly string[] = KEYS,
): string => renderDashboard({ url: seed.url ?? TAB_URL, client: client(seed), permissions });

/** The tab's body. */
const tab = (seed: Parameters<typeof client>[0] = {}, permissions?: readonly string[]): string => {
  const html = page(seed, permissions);
  const at = html.indexOf('data-dash-tab-body="licences"');
  if (at === -1) throw new Error('no licences tab body');
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
/** The markup from an element that carries `attr="value"` up to `end` (or the next same attr). */
const slice = (html: string, attr: string, value: string, end = `${attr}=`): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const stop = html.indexOf(end, start + attr.length + value.length + 3);
  return html.slice(start, stop === -1 ? undefined : stop);
};
/** The tab's parts in their order: a card or a block runs to the next one of them. */
const PARTS = [
  'data-lic-kpi=',
  'data-lic-block=',
  'data-lic-band=',
  'data-lic-notes=',
  'data-lic-spend=',
  'data-lic-custody-note=',
];
const part = (html: string, attr: string, value: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const from = start + attr.length + value.length + 3;
  const ends = PARTS.map((marker) => html.indexOf(marker, from)).filter((at) => at !== -1);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};
const kpi = (html: string, id: string): string => part(html, 'data-lic-kpi', id);
const block = (html: string, id: string): string => part(html, 'data-lic-block', id);
const carRowOf = (html: string, vehicleId: string): string =>
  slice(html, 'data-lic-car', vehicleId, '</tr>');
const driverRowOf = (html: string, profileId: string): string =>
  slice(html, 'data-lic-driver', profileId, '</tr>');
const slotOf = (html: string, key: string): string =>
  slice(html, 'data-lic-slot', key, 'data-lic-slot=');
/** The «الآن» band: from its head to the period band. */
const nowBand = (html: string): string => {
  const end = html.indexOf('data-lic-band="period"');
  return html.slice(html.indexOf('data-lic-band="now"'), end === -1 ? undefined : end);
};
const periodBand = (html: string): string => html.slice(html.indexOf('data-lic-band="period"'));
/** A part's markup without the rest of the opening tag it was cut from. */
const inner = (html: string): string => html.slice(html.indexOf('>') + 1);
/** The words with no gaps: a figure in its own span sits close to the word before it. */
const solid = (html: string): string => text(html).replace(/\s+/gu, '');
/** How many times an attribute-value pair stands in the markup. */
const times = (html: string, needle: string): number => html.split(needle).length - 1;
const w = (key: string, params?: Record<string, string | number>): string =>
  ar(`fleet.dash.licences.${key}`, params);
/** The kit's counted noun (the KPIs' «8 سيارات»). */
const noun = (key: string, n: number): string => {
  const tail = n % 100;
  const form = n === 1 ? 'one' : n === 0 || (tail >= 2 && tail <= 10) ? 'few' : 'other';
  return ar(`fleet.dash.common.noun.${key}.${form}`);
};

const DEFAULT = tab();
const BRANCH = tab({ now: NOW_BRANCH, page: PAGE_BRANCH });
const MINE = tab({ now: NOW_MINE, page: PAGE_MINE });

// ── 1 · The heading, the bands and the order ─────────────────────────────────────────────────

describe('«التراخيص والتجديدات» — the heading, the two bands and the approved order', () => {
  it('heads the tab with the pill’s full name and the approved line, «تحديث», no live chip', () => {
    const head = DEFAULT.slice(0, DEFAULT.indexOf('data-lic-band="now"'));
    expect(text(head)).toContain(ar('fleet.dash.shell.tab.licences'));
    expect(text(head)).toContain(w('sub'));
    expect(head).toContain('data-dash-refresh="true"');
    expect(head).not.toContain('data-live-chip');
  });

  it('draws «الآن» first with its live chip only, then «خلال الفترة» with its range and line', () => {
    const now = slice(DEFAULT, 'data-dash-band', 'now', 'data-read-band');
    expect(text(now)).toContain(w('now'));
    expect(now).toContain('data-live-chip="true"');
    expect(now).not.toContain('data-company-wide');
    const period = slice(DEFAULT, 'data-dash-band', 'period', 'data-period-filters');
    expect(text(period)).toContain(w('period'));
    expect(period).toContain('data-dash-range="thisMonth"');
    expect(text(period)).toContain(w('periodSub'));
  });

  it('lays out the approved order: six cards, notes, chart, the two tables, then the period', () => {
    const order = [
      'data-dash-band="now"',
      'data-lic-kpi="carsExpired"',
      'data-lic-kpi="carsExpiring"',
      'data-lic-kpi="papers"',
      'data-lic-kpi="driversExpired"',
      'data-lic-kpi="driversExpiring"',
      'data-lic-kpi="missing"',
      'data-lic-note="fuel"',
      'data-lic-block="months"',
      'data-lic-block="cars"',
      'data-lic-block="drivers"',
      'data-dash-band="period"',
      'data-period-filters="true"',
      'data-lic-spend="card"',
      'data-lic-block="split"',
      'data-lic-custody-note="true"',
    ];
    const at = order.map((marker) => DEFAULT.indexOf(marker));
    expect(
      at.every((i) => i > -1),
      JSON.stringify(at),
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('puts the cards in two rows — cars over drivers, three a row from 1024 px, six in a line from 1800 px', () => {
    const grid = slice(DEFAULT, 'data-lic-kpis', 'now', '>');
    expect(grid).toContain('min-[1800px]:grid-cols-2');
    const rowIds = (html: string, row: string): string[] => {
      const start = html.indexOf(`data-lic-kpi-row="${row}"`);
      if (start === -1) return [];
      const next = html.indexOf('data-lic-kpi-row=', start + 20);
      const stop = next === -1 ? html.indexOf('data-lic-notes=', start) : next;
      return [...html.slice(start, stop).matchAll(/data-lic-kpi="([A-Za-z]+)"/gu)].map(
        (m) => m[1] ?? '',
      );
    };
    expect(rowIds(DEFAULT, 'cars')).toEqual(['carsExpired', 'carsExpiring', 'papers']);
    expect(rowIds(DEFAULT, 'drivers')).toEqual(['driversExpired', 'driversExpiring', 'missing']);
    for (const row of ['cars', 'drivers']) {
      const box = slice(DEFAULT, 'data-lic-kpi-row', row, '>');
      expect(box).toContain('lg:grid-cols-3');
      // Two a row on a tablet, the row's odd last card the full width.
      expect(box).toContain('sm:[&amp;&gt;*:last-child:nth-child(odd)]:col-span-2');
    }
    // A reader without the board's papers: a driver card never moves up beside the cars.
    const noPapers = tab({}, ['fleetVehicle.view', 'fleetDriver.view']);
    expect(rowIds(noPapers, 'cars')).toEqual(['carsExpired', 'carsExpiring']);
    expect(rowIds(noPapers, 'drivers')).toEqual(['driversExpired', 'driversExpiring', 'missing']);
    // Without the cars' registry: the papers alone on the cars' row.
    const noCars = tab({}, ['fleetDriver.view', 'fleetLicensing.view']);
    expect(rowIds(noCars, 'cars')).toEqual(['papers']);
    expect(rowIds(noCars, 'drivers')).toEqual(['driversExpired', 'driversExpiring', 'missing']);
  });

  it('wears the approved tones: red · amber · violet · red · amber · amber', () => {
    for (const [id, tone] of [
      ['carsExpired', 'red'],
      ['carsExpiring', 'amber'],
      ['papers', 'violet'],
      ['driversExpired', 'red'],
      ['driversExpiring', 'amber'],
      ['missing', 'amber'],
    ] as const) {
      expect(kpi(DEFAULT, id), id).toContain(`data-lic-tone="${tone}"`);
    }
  });
});

// ── 2 · The cars ──────────────────────────────────────────────────────────────────────────────

describe('the cars’ two cards — `licenceVehicles`, active cars by the car’s branch', () => {
  it('«تراخيص سيارات منتهية»: the expired count opens the expired window', () => {
    const card = kpi(DEFAULT, 'carsExpired');
    expect(text(card)).toContain(w('kpi.carsExpired.title'));
    expect(text(card)).toContain(`4 ${noun('car', 4)}`);
    expect(target(hrefOf(card, 'licenceVehicles.expired'))).toEqual({
      path: '/fleet/vehicles',
      params: { status: 'active', licExpBefore: TODAY },
    });
  });

  it('names at most three expired cars, then «و N أخرى» from the server’s count', () => {
    const sub = slice(kpi(DEFAULT, 'carsExpired'), 'data-lic-sub', 'carsExpired', 'data-lic-foot');
    expect([...sub.matchAll(/data-lic-expired-car="([^"]+)"/gu)].map((m) => m[1])).toEqual([
      '150',
      '118',
      '152',
    ]);
    expect(hrefs(sub, 'licenceVehicles.expiredCar')).toEqual([
      '/fleet/vehicles/v150',
      '/fleet/vehicles/v118',
      '/fleet/vehicles/v152',
    ]);
    expect(sub).toContain('data-lic-and-more="1"');
    expect(solid(sub)).toContain(solid(w('andMore', { count: 1 })));
    // Several cars: no day phrase beside them.
    expect(sub).not.toContain('data-lic-days');
  });

  it('with one expired car: its chip and «منتهٍ منذ يومين» in red', () => {
    const one: Vehicles = {
      ...VEHICLES,
      expired: 1,
      list: [CAR_ROWS[0], CAR_ROWS[4], CAR_ROWS[5]].filter((row) => row !== undefined),
    };
    const html = tab({ now: { ...NOW, licenceVehicles: one } });
    const sub = slice(kpi(html, 'carsExpired'), 'data-lic-sub', 'carsExpired', 'data-lic-foot');
    expect(sub).toContain('data-lic-expired-car="150"');
    expect(sub).not.toContain('data-lic-and-more');
    expect(text(sub)).toContain(`${w('state.expiredSince', { days: 'يومين' })}`);
    expect(sub).toContain('text-red-600');
  });

  it('says the expired are not ready to run, and «· وخارج الخدمة N» only when there are some', () => {
    const foot = slice(kpi(DEFAULT, 'carsExpired'), 'data-lic-foot', 'carsExpired', '</div>');
    expect(text(foot)).toContain(w('kpi.carsExpired.foot'));
    expect(foot).toContain('data-lic-out-of-service="1"');
    const none = tab({
      now: { ...NOW, licenceVehicles: { ...VEHICLES, outOfServiceExpired: 0 } },
    });
    expect(kpi(none, 'carsExpired')).not.toContain('data-lic-out-of-service');
  });

  it('«تراخيص تنتهي خلال 30 يومًا»: the window from the section’s own setting', () => {
    const card = kpi(DEFAULT, 'carsExpiring');
    expect(text(card)).toContain(w('kpi.carsExpiring.first'));
    expect(text(card)).toContain(w('kpi.within', { days: '30 يومًا' }));
    expect(text(card)).toContain(`8 ${noun('car', 8)}`);
    expect(target(hrefOf(card, 'licenceVehicles.expiring'))).toEqual({
      path: '/fleet/vehicles',
      params: { status: 'active', licExpFrom: DAY(1), licExpBefore: DAY(30) },
    });
  });

  it('«ومن 31 إلى 60 يومًا: 4 ←» opens its exact days (critic B4)', () => {
    const soon = slice(DEFAULT, 'data-lic-soon', 'cars', '</a>');
    expect(soon).toContain('data-lic-n="4"');
    expect(text(soon)).toContain(w('kpi.soon', { from: 31, to: 60 }));
    expect(target(hrefOf(kpi(DEFAULT, 'carsExpiring'), 'licenceVehicles.soon'))).toEqual({
      path: '/fleet/vehicles',
      params: { status: 'active', licExpFrom: DAY(31), licExpBefore: DAY(60) },
    });
  });

  it('counts a setting of 10 days in words («خلال 10 أيام») and starts the grey window at 11', () => {
    const html = tab({ now: { ...NOW, licenceVehicles: { ...VEHICLES, warnDays: 10 } } });
    const card = kpi(html, 'carsExpiring');
    expect(text(card)).toContain(w('kpi.within', { days: '10 أيام' }));
    expect(text(slice(html, 'data-lic-soon', 'cars', '</a>'))).toContain(
      w('kpi.soon', { from: 11, to: 60 }),
    );
  });

  it('draws no «ومن … إلى 60 يومًا» line once the setting reaches 60', () => {
    const html = tab({ now: { ...NOW, licenceVehicles: { ...VEHICLES, warnDays: 60, soon: 0 } } });
    expect(html).not.toContain('data-lic-soon="cars"');
    expect(text(kpi(html, 'carsExpiring'))).toContain(w('kpi.within', { days: '60 يومًا' }));
  });

  it('says where the window comes from, and that 60 is fixed', () => {
    const foot = slice(kpi(DEFAULT, 'carsExpiring'), 'data-lic-foot', 'carsExpiring', '</div>');
    expect(text(foot)).toContain(
      text(w('kpi.warnFoot', { limit: w('kpi.warnLimit', { days: 60 }) })),
    );
  });
});

// ── 3 · The papers ────────────────────────────────────────────────────────────────────────────

describe('«أوراق لم تُستلم بعد» — the board’s two papers, no total', () => {
  it('opens the board on each paper’s OPEN papers (`paper=`), never the bare board', () => {
    const card = kpi(DEFAULT, 'papers');
    expect(text(card)).toContain(w('kpi.papers.title'));
    expect(card).toContain('data-lic-pair="insurance" data-lic-n="4"');
    expect(card).toContain('data-lic-pair="tax" data-lic-n="2"');
    expect(hrefOf(card, 'papers.insurance')).toBe('/fleet/licensing?paper=insurance');
    expect(hrefOf(card, 'papers.tax')).toBe('/fleet/licensing?paper=tax');
    expect(text(card)).toContain(ar('fleet.licensing.columns.insurance'));
    expect(text(card)).toContain(ar('fleet.licensing.columns.tax'));
    // No total: 4 + 2 is written nowhere.
    expect(text(inner(card))).not.toMatch(/(^|\s)6(\s|$)/u);
    expect(text(card)).toContain(w('kpi.papers.sub'));
    expect(text(card)).toContain(w('kpi.papers.note'));
  });

  it('greys a paper with none open', () => {
    const html = tab({ now: { ...NOW, papers: { insurance: 4, tax: 0 } } });
    const tax = slice(kpi(html, 'papers'), 'data-lic-pair', 'tax', '</span></span>');
    expect(tax).toContain('data-lic-n="0"');
    expect(tax).toContain('!text-slate-400');
    expect(slice(kpi(DEFAULT, 'papers'), 'data-lic-pair', 'tax', '</span></span>')).not.toContain(
      '!text-slate-400',
    );
  });
});

// ── 4 · The drivers ───────────────────────────────────────────────────────────────────────────

describe('the drivers’ three cards — `licenceDrivers`, the Fleet driver files by the HR branch', () => {
  it('«رخص سائقين منتهية»: the count opens the expired files; the names open each file', () => {
    const card = kpi(DEFAULT, 'driversExpired');
    expect(text(card)).toContain(w('kpi.driversExpired.title'));
    expect(text(card)).toContain(`2 ${noun('driver', 2)}`);
    expect(target(hrefOf(card, 'licenceDrivers.expired'))).toEqual({
      path: '/fleet/drivers',
      params: { licExpBefore: TODAY },
    });
    expect(hrefs(card, 'licenceDrivers.expiredDriver')).toEqual([
      '/fleet/drivers/p520',
      '/fleet/drivers/p611',
    ]);
    expect(text(card)).toContain('كمال عبد الرحيم');
    expect(text(card)).toContain('رامي فوزي عبد العزيز');
    expect(text(card)).toContain(w('kpi.driversExpired.foot'));
  });

  it('names at most three expired files, then «و N أخرى»; the names give way first', () => {
    const rows = [
      driverRow('520', -9),
      driverRow('611', -6, { active: false }),
      driverRow('487', -3),
      driverRow('553', 0),
      driverRow('702', 5),
    ];
    const html = tab({
      now: { ...NOW, licenceDrivers: { ...DRIVERS, expired: 4, list: { rows, more: 0 } } },
    });
    const sub = slice(
      kpi(html, 'driversExpired'),
      'data-lic-sub',
      'driversExpired',
      'data-lic-foot',
    );
    expect([...sub.matchAll(/data-lic-expired-driver="([^"]+)"/gu)].map((m) => m[1])).toEqual([
      'p520',
      'p611',
      'p487',
    ]);
    expect(sub).toContain('data-lic-and-more="1"');
    // The names truncate inside the one-line sub; «و N أخرى» never shrinks.
    expect(slice(sub, 'data-lic-expired-names', 'true', '>')).toContain('truncate');
    expect(slice(sub, 'data-lic-and-more', '1', '>')).toContain('shrink-0');
    // Several files: no day phrase beside them.
    expect(sub).not.toContain('data-lic-days');
  });

  it('with one expired driver: the name and «منتهٍ منذ 4 أيام»; with more than three, «و N أخرى»', () => {
    const one = tab({
      now: {
        ...NOW,
        licenceDrivers: {
          ...DRIVERS,
          expired: 1,
          list: { rows: DRIVER_ROWS.filter((row) => row.profileId !== 'p611'), more: 2 },
        },
      },
    });
    const sub = slice(
      kpi(one, 'driversExpired'),
      'data-lic-sub',
      'driversExpired',
      'data-lic-foot',
    );
    expect(text(sub)).toContain('كمال عبد الرحيم');
    expect(text(sub)).not.toContain('رامي فوزي عبد العزيز');
    expect(text(sub)).toContain(w('state.expiredSince', { days: '4 أيام' }));
    const five = tab({ now: { ...NOW, licenceDrivers: { ...DRIVERS, expired: 5 } } });
    expect(kpi(five, 'driversExpired')).toContain('data-lic-and-more="3"');
  });

  it('«رخص تنتهي خلال 30 يومًا» and «ومن 31 إلى 60 يومًا: 3 ←», by their own window', () => {
    const card = kpi(DEFAULT, 'driversExpiring');
    expect(text(card)).toContain(w('kpi.driversExpiring.first'));
    expect(text(card)).toContain(`3 ${noun('driver', 3)}`);
    expect(target(hrefOf(card, 'licenceDrivers.expiring'))).toEqual({
      path: '/fleet/drivers',
      params: { licExpFrom: DAY(1), licExpBefore: DAY(30) },
    });
    expect(target(hrefOf(card, 'licenceDrivers.soon'))).toEqual({
      path: '/fleet/drivers',
      params: { licExpFrom: DAY(31), licExpBefore: DAY(60) },
    });
    expect(slice(card, 'data-lic-soon', 'drivers', '</a>')).toContain('data-lic-n="3"');
  });

  it('«بيانات رخص ناقصة»: «رخصة غير مسجّلة» linked as «الحركة اليوم» writes it, «بلا ملف سائق» plain', () => {
    const card = kpi(DEFAULT, 'missing');
    expect(text(card)).toContain(w('kpi.missing.title'));
    expect(text(card)).toContain(ar('fleet.dash.now.licenceNotRecorded'));
    expect(card).toContain('data-lic-pair="notRecorded" data-lic-n="3"');
    expect(target(hrefOf(card, 'licenceDrivers.notRecorded'))).toEqual({
      path: '/fleet/drivers',
      params: { licExp: 'none' },
    });
    const noFile = slice(card, 'data-lic-unregistered', '1', '</span></span>');
    expect(text(noFile)).toContain(text(w('kpi.missing.noFile', { count: 1 })));
    expect(links(noFile)).toEqual([]);
    expect(text(card)).toContain(w('kpi.missing.foot'));
  });

  it('carries the figures’ branch on every driver link while narrowed', () => {
    for (const [html, branch] of [
      [BRANCH, B1],
      [MINE, `${B1},${B2}`],
    ] as const) {
      for (const metric of [
        'licenceDrivers.expired',
        'licenceDrivers.expiring',
        'licenceDrivers.soon',
        'licenceDrivers.notRecorded',
        'licenceDrivers.month',
        'licenceDrivers.more',
      ]) {
        expect(target(hrefOf(html, metric)).params.branch, metric).toBe(branch);
      }
    }
  });
});

// ── 5 · The notes under the cards ─────────────────────────────────────────────────────────────

describe('the notes — the fuel cards’ expiry and the drivers’ branch', () => {
  it('points to «الوقود والمصروفات» for the cards’ expiry, keeping the page’s filters', () => {
    const note = slice(DEFAULT, 'data-lic-note', 'fuel', 'data-lic-note=');
    expect(text(note)).toContain(w('fuelLine'));
    expect(text(note)).toContain(ar('fleet.dash.shell.tab.fuel'));
    expect(hrefOf(note, 'fuelCards.tab')).toBe('/fleet?tab=fuel');
  });

  it('draws no pointer for a reader who has no fuel tab', () => {
    const html = tab({}, ['fleetVehicle.view', 'fleetDriver.view', 'fleetLicensing.view']);
    expect(html).not.toContain('data-lic-note="fuel"');
  });

  it('draws no pointer for a fuel tab without the cards’ expiry (receipts only) — critic C6', () => {
    const permissions = ['fleetVehicle.view', 'fleetReceipt.view'];
    const seed = { page: { ...PAGE, opex: PERIOD_FULL.opex } };
    expect(page(seed, permissions)).toContain('data-dash-tab="fuel"');
    expect(tab(seed, permissions)).not.toContain('data-lic-note="fuel"');
    // The cards' reader keeps it.
    expect(tab({}, ['fleetVehicle.view', 'fleetFuelCard.view'])).toContain('data-lic-note="fuel"');
  });

  it('says the drivers follow their HR branch only while the figures are narrowed', () => {
    expect(DEFAULT).not.toContain('data-lic-note="hr-branch"');
    for (const html of [BRANCH, MINE]) {
      expect(text(slice(html, 'data-lic-note', 'hr-branch', '</p>'))).toContain(w('hrBranchNote'));
    }
  });
});

// ── 6 · The chart ─────────────────────────────────────────────────────────────────────────────

describe('«التراخيص المستحقة للتجديد — 12 شهرًا» — two brand columns a month, never added', () => {
  const chart = block(DEFAULT, 'months');

  it('heads the chart with the approved title, its line and the cars and drivers legend', () => {
    expect(text(chart)).toContain(w('chart.title'));
    expect(text(chart)).toContain(w('chart.span', { count: 12 }));
    expect(text(chart)).toContain(w('chart.note'));
    const legend = slice(chart, 'data-lic-legend', 'months', '</div>');
    expect(text(legend)).toContain(w('chart.cars'));
    expect(text(legend)).toContain(w('chart.drivers'));
  });

  it('draws the server’s twelve slots in its order, each with its two server counts', () => {
    expect([...chart.matchAll(/data-lic-slot="([^"]+)"/gu)].map((m) => m[1])).toEqual(MONTH_KEYS);
    MONTH_KEYS.forEach((key, i) => {
      const slot = slotOf(chart, key);
      expect(times(slot, 'data-lic-value='), key).toBe(2);
      expect(slot).toContain(`data-lic-series="cars" data-lic-n="${CAR_MONTHS[i]}"`);
      expect(slot).toContain(`data-lic-series="drivers" data-lic-n="${DRIVER_MONTHS[i]}"`);
    });
  });

  it('never writes a month total', () => {
    const slot = slotOf(chart, '2027-01');
    // 13 cars + 4 drivers: no «17» anywhere in the slot.
    expect(text(slot)).toMatch(/\b13\b/u);
    expect(text(slot)).not.toMatch(/\b17\b/u);
  });

  it('colours the cars the kit’s brand bar and the drivers two steps lighter', () => {
    const slot = slotOf(chart, '2026-11');
    expect(slice(slot, 'data-lic-bar', 'cars', '/>')).toContain('bg-brand-600 dark:bg-brand-500');
    expect(slice(slot, 'data-lic-bar', 'drivers', '/>')).toContain(
      'bg-brand-400 dark:bg-brand-300',
    );
  });

  it('marks «هذا الشهر» by a word and a band on its own slot, not by a shade', () => {
    expect(times(chart, 'data-lic-this-month="true"')).toBe(1);
    expect(slotOf(chart, MONTH_KEYS[0] ?? '')).toContain('data-lic-this-month="true"');
    expect(times(chart, 'data-lic-this-word="true"')).toBe(1);
    const label = slice(chart, 'data-lic-xlabel', MONTH_KEYS[0] ?? '', 'data-lic-xlabel=');
    expect(text(label)).toContain(w('chart.thisMonth'));
    expect(text(slice(chart, 'data-lic-xlabel', '2027-01', 'data-lic-xlabel='))).toContain('2027');
  });

  it('opens on this month in the readout: «نوفمبر 2026 · هذا الشهر · 6 سيارات · سائقان»', () => {
    const readout = slice(chart, 'data-lic-readout', '2026-11', 'data-lic-scroller');
    expect(text(readout)).toContain('2026');
    expect(readout).toContain('data-lic-readout-this="true"');
    expect(text(readout)).toContain(w('count.car.few', { count: 6 }));
    expect(text(readout)).toContain(w('count.driver.two'));
  });

  it('opens each column’s month: active cars by `licenseMonths`, drivers by their days', () => {
    expect(hrefs(chart, 'licenceVehicles.month')).toContain(
      '/fleet/vehicles?status=active&licenseMonths=2026-11',
    );
    const cars = target(hrefs(chart, 'licenceVehicles.month')[0] ?? '');
    expect(cars).toEqual({
      path: '/fleet/vehicles',
      params: { status: 'active', licenseMonths: '2026-11' },
    });
    expect(target(hrefs(chart, 'licenceDrivers.month')[1] ?? '')).toEqual({
      path: '/fleet/drivers',
      params: { licExpFrom: '2026-12-01', licExpBefore: '2026-12-31' },
    });
    expect(hrefs(chart, 'licenceVehicles.month')).toHaveLength(12);
    expect(hrefs(chart, 'licenceDrivers.month')).toHaveLength(12);
  });

  it('says the two are not added, and where the older and the unrecorded licences are', () => {
    const note = slice(chart, 'data-lic-note', 'months', '</span>');
    expect(text(note)).toContain(w('chart.notSummed'));
    expect(text(note)).toContain(w('chart.foot'));
  });

  it('draws a series only with its section', () => {
    const cars = tab({}, ['fleetVehicle.view']);
    const months = block(cars, 'months');
    expect(months).toContain('data-lic-series="cars"');
    expect(months).not.toContain('data-lic-series="drivers"');
    expect(months).not.toContain('data-lic-swatch="drivers"');
    expect(text(months)).not.toContain(w('chart.notSummed'));
  });

  it('scrolls inside its card on a phone, never the page', () => {
    expect(chart).toContain('max-md:overflow-x-auto');
    expect(chart).toContain('max-md:min-w-[640px]');
  });
});

// ── 7 · The tables ────────────────────────────────────────────────────────────────────────────

describe('«أقرب تراخيص السيارات» — the server’s nearest rows, the papers for the board’s reader', () => {
  const cars = block(DEFAULT, 'cars');

  it('heads with the approved title, its line and the cars listed (rows + the rest)', () => {
    expect(text(cars)).toContain(w('cars.title'));
    expect(text(cars)).toContain(w('cars.note', { days: 60 }));
    expect(text(slice(cars, 'data-lic-chip', 'cars', '</div>'))).toContain(
      w('count.car.many', { count: 16 }),
    );
  });

  it('lists the server’s rows in its order, each car with its make and licence class', () => {
    expect([...cars.matchAll(/data-lic-car="([^"]+)"/gu)].map((m) => m[1])).toEqual(
      CAR_ROWS.map((row) => row.vehicleId),
    );
    expect(text(carRowOf(cars, 'v150'))).toContain('مرسيدس اسيليو 915');
    expect(text(carRowOf(cars, 'v150'))).toContain('برقاش م');
    expect(text(carRowOf(cars, 'v211'))).toContain('تويوتا هاى اس');
    expect(text(carRowOf(cars, 'v119'))).toContain('—');
  });

  it('colours the day and the state by the section’s window, one spelling per state (B8)', () => {
    expect(carRowOf(cars, 'v150')).toContain('data-lic-date-tone="red"');
    expect(carRowOf(cars, 'v211')).toContain('data-lic-date-tone="amber"');
    expect(text(carRowOf(cars, 'v150'))).toContain(w('state.expiredSince', { days: 'يومين' }));
    expect(text(carRowOf(cars, 'v118'))).toContain(w('state.expiredSince', { days: 'يوم واحد' }));
    expect(text(carRowOf(cars, 'v152'))).toContain(ar('fleet.dash.licences.expiredToday'));
    expect(text(carRowOf(cars, 'v211'))).toContain(w('state.expiresIn', { days: '3 أيام' }));
    expect(text(carRowOf(cars, 'v297'))).toContain(w('state.expiresIn', { days: '13 يومًا' }));
    // After the window: neutral.
    const late = tab({ now: { ...NOW, licenceVehicles: { ...VEHICLES, warnDays: 10 } } });
    expect(carRowOf(block(late, 'cars'), 'v297')).toContain('data-lic-state="slate"');
    expect(carRowOf(block(late, 'cars'), 'v297')).toContain('data-lic-date-tone="slate"');
    // The day wears its tone's colour ALONE: the kit's `cn` merges nothing, so a neutral colour
    // left beside the red would win in the stylesheet and the day would read white.
    const dayClass = (row: string): string =>
      /data-lic-date-tone="[^"]+"><span[^>]*class="([^"]*)"/u.exec(row)?.[1] ?? '';
    expect(dayClass(carRowOf(cars, 'v150'))).toContain('dark:text-red-400');
    expect(dayClass(carRowOf(cars, 'v150'))).not.toContain('text-slate');
    expect(dayClass(carRowOf(cars, 'v211'))).toContain('dark:text-amber-400');
    expect(dayClass(carRowOf(cars, 'v211'))).not.toContain('text-slate');
    expect(dayClass(carRowOf(block(late, 'cars'), 'v297'))).toContain('dark:text-slate-200');
  });

  it('tags only the OPEN papers in the board’s violet, «—» for the rest', () => {
    expect(carRowOf(cars, 'v150')).toContain('data-lic-papers="none"');
    expect(carRowOf(cars, 'v118')).toContain('data-lic-papers="insurance"');
    expect(text(carRowOf(cars, 'v118'))).toContain(ar('fleet.licensing.stats.insuranceOut'));
    expect(text(carRowOf(cars, 'v118'))).not.toContain(ar('fleet.licensing.stats.taxOut'));
    expect(carRowOf(cars, 'v152')).toContain('data-lic-papers="tax"');
    expect(carRowOf(cars, 'v211')).toContain('data-lic-papers="insurance,tax"');
    expect(text(cars)).toContain(w('cars.col.papers'));
  });

  it('says the board could not be read — never a «—» that reads as «no open paper»', () => {
    const rows = CAR_ROWS.map((row) => ({ ...row, papers: null }));
    const html = block(
      tab({ now: { ...NOW, licenceVehicles: { ...VEHICLES, list: rows, papersFailed: true } } }),
      'cars',
    );
    expect(text(html)).toContain(w('cars.col.papers'));
    for (const row of CAR_ROWS) {
      expect(carRowOf(html, row.vehicleId)).toContain('data-lic-papers="failed"');
      expect(text(carRowOf(html, row.vehicleId))).toContain(w('cars.papersFailed'));
    }
    expect(html).not.toContain('data-lic-papers="none"');
    // The rows, the days and the counts still answer.
    expect(text(carRowOf(html, 'v150'))).toContain('مرسيدس اسيليو 915');
    expect(text(slice(html, 'data-lic-chip', 'cars', '</div>'))).toContain(
      w('count.car.many', { count: 16 }),
    );
  });

  it('draws no papers column for a reader who cannot open the board', () => {
    const html = block(tab({}, ['fleetVehicle.view', 'fleetDriver.view']), 'cars');
    expect(text(html)).not.toContain(w('cars.col.papers'));
    expect(html).not.toContain('data-lic-papers');
  });

  it('opens each car’s record with «فتح», and the rest of the 60 days with «عرض الباقي (10)»', () => {
    expect(hrefs(carRowOf(cars, 'v150'), 'licenceVehicles.row')).toContain('/fleet/vehicles/v150');
    expect(text(carRowOf(cars, 'v150'))).toContain(w('open'));
    expect(cars).toContain('data-lic-more="10"');
    expect(text(cars)).toContain(w('showRest', { count: 10 }));
    // D37: the rest opens nearest-expiring first, as the table is ordered.
    expect(target(hrefOf(cars, 'licenceVehicles.more'))).toEqual({
      path: '/fleet/vehicles',
      params: { status: 'active', licExpBefore: DAY(60), sort: 'licenseExpiresAt:asc' },
    });
  });

  it('draws «عرض الباقي» only when the server left rows out', () => {
    const all = tab({ now: { ...NOW, licenceVehicles: { ...VEHICLES, more: 0 } } });
    expect(block(all, 'cars')).not.toContain('data-lic-more');
  });

  it('folds each row into a block below 1024 px — both tables, so a tablet never cuts a name short', () => {
    for (const html of [cars, block(DEFAULT, 'drivers')]) {
      expect(html).toContain('hidden overflow-x-auto lg:block');
      expect(html).toMatch(/<ul class="[^"]*\blg:hidden\b/u);
      expect(html).not.toContain('md:block');
    }
    expect(times(cars, 'data-lic-car-block=')).toBe(CAR_ROWS.length);
    expect(times(block(DEFAULT, 'drivers'), 'data-lic-driver-block=')).toBe(DRIVER_ROWS.length);
  });
});

describe('«أقرب رخص السائقين» — the files with names (Q2 أ)', () => {
  const drivers = block(DEFAULT, 'drivers');

  it('heads with the approved title, its line and the drivers listed', () => {
    expect(text(drivers)).toContain(w('drivers.title'));
    expect(text(drivers)).toContain(w('drivers.note', { days: 60 }));
    expect(text(slice(drivers, 'data-lic-chip', 'drivers', '</div>'))).toContain(
      w('count.driver.few', { count: 8 }),
    );
  });

  it('names each file from Fleet’s people list, its code and licence type; a dash when unknown', () => {
    expect([...drivers.matchAll(/data-lic-driver="([^"]+)"/gu)].map((m) => m[1])).toEqual(
      DRIVER_ROWS.map((row) => row.profileId),
    );
    expect(text(driverRowOf(drivers, 'p520'))).toContain('كمال عبد الرحيم');
    expect(text(driverRowOf(drivers, 'p520'))).toContain('520');
    expect(text(driverRowOf(drivers, 'p520'))).toContain('اولى');
    expect(text(driverRowOf(drivers, 'p487'))).toContain('تانيه');
    expect(text(driverRowOf(drivers, 'p438'))).toContain('—');
    expect(text(driverRowOf(drivers, 'p438'))).toContain(
      w('state.expiresIn', { days: '36 يومًا' }),
    );
    expect(driverRowOf(drivers, 'p438')).toContain('data-lic-state="slate"');
  });

  it('marks a suspended file «الملف موقوف» (still listed, as it is counted)', () => {
    const row = driverRowOf(drivers, 'p611');
    expect(row).toContain('data-lic-active="false"');
    expect(row).toContain('data-lic-suspended="true"');
    expect(text(row)).toContain(ar('fleet.roster.reason.profileInactive'));
    expect(driverRowOf(drivers, 'p520')).not.toContain('data-lic-suspended');
  });

  it('opens each driver’s file, and the rest of the 60 days with «عرض الباقي (2)»', () => {
    expect(hrefs(driverRowOf(drivers, 'p520'), 'licenceDrivers.row')).toContain(
      '/fleet/drivers/p520',
    );
    expect(drivers).toContain('data-lic-more="2"');
    // D37: the rest opens nearest-expiring first, as the table is ordered.
    expect(target(hrefOf(drivers, 'licenceDrivers.more'))).toEqual({
      path: '/fleet/drivers',
      params: { licExpBefore: DAY(60), sort: 'licenseExpiresAt:asc' },
    });
  });
});

// ── 8 · The period ────────────────────────────────────────────────────────────────────────────

describe('«خلال الفترة» — the licence memos by the memo day, for the whole company', () => {
  const period = periodBand(DEFAULT);

  it('puts the dashboard’s bar under the head with the period choices ONLY (critic A3)', () => {
    expect(times(period, 'data-period-filters="true"')).toBe(1);
    expect(period).toContain('data-period-only="true"');
    expect(period).toContain('data-period-preset="true"');
    expect(period).toContain('data-period-chip="range"');
    for (const chip of ['type', 'operation', 'codes', 'count']) {
      expect(period, chip).not.toContain(`data-period-chip="${chip}"`);
    }
    expect(text(period)).not.toContain(ar('fleet.dash.filters.type'));
    expect(text(period)).not.toContain(ar('fleet.dash.filters.operation'));
  });

  it('clears the period alone there — the set the other tabs hold stays in the address bar', () => {
    const held: PeriodFilters = {
      ...CLEARED,
      preset: 'lastMonth',
      typeIds: [T1],
      vehicleCodes: ['150'],
    };
    expect(clearedFor(held, true)).toEqual({ ...held, preset: CLEARED.preset, from: '', to: '' });
    expect(clearedFor(held, false)).toEqual(CLEARED);
    expect(isClearedFor({ ...CLEARED, typeIds: [T1] }, true)).toBe(true);
    expect(isClearedFor({ ...CLEARED, typeIds: [T1] }, false)).toBe(false);
    expect(isClearedFor({ ...CLEARED, preset: 'lastMonth' }, true)).toBe(false);
    // On the tab: «مسح الفلاتر» rests at the default period, though a type rides in the address…
    const clear = (html: string): string =>
      slice(periodBand(html), 'data-period-clear', 'true', '>');
    const typed = `${TAB_URL}&type=${T1}`;
    expect(clear(tab({ url: typed }))).toMatch(/\sdisabled=""/u);
    // …and wakes for another period.
    expect(clear(tab({ url: `${TAB_URL}&period=lastMonth` }))).not.toMatch(/\sdisabled=""/u);
  });

  it('«مصروفات التراخيص في الفترة»: the total opens the register on the range', () => {
    const card = part(DEFAULT, 'data-lic-spend', 'card');
    expect(card).toContain('data-lic-tone="sky"');
    expect(text(card)).toContain(w('spend.title'));
    expect(text(card)).toContain(w('spend.tag'));
    expect(text(card)).toContain('11,450.00');
    expect(target(hrefOf(card, 'licenceSpend.total'))).toEqual({
      path: '/fleet/license-expenses',
      params: { from: TODAY, to: TODAY },
    });
    expect(target(hrefOf(card, 'licenceSpend.screen'))).toEqual({
      path: '/fleet/license-expenses',
      params: { from: TODAY, to: TODAY },
    });
  });

  it('writes the register’s own counts plain: «عدد المذكرات» and «السيارات» (B9)', () => {
    const card = part(DEFAULT, 'data-lic-spend', 'card');
    const memos = slice(card, 'data-lic-stat', 'count', 'data-lic-stat=');
    expect(memos).toContain('data-lic-n="2"');
    expect(text(memos)).toContain(ar('fleet.licenseExpenses.stats.memos'));
    expect(links(memos)).toEqual([]);
    const cars = slice(card, 'data-lic-stat', 'cars', '</dl>');
    expect(cars).toContain('data-lic-n="4"');
    expect(text(cars)).toContain(ar('fleet.licenseExpenses.stats.cars'));
    expect(links(cars)).toEqual([]);
  });

  it('splits the total twice — by memo kind, by payment — plain brand bars, one-decimal shares', () => {
    const split = block(DEFAULT, 'split');
    expect(text(split)).toContain(w('split.title'));
    expect(text(split)).toContain(w('split.note'));
    expect(text(split)).toContain(w('split.byKind'));
    expect(text(split)).toContain(w('split.byPay'));
    for (const [key, amount, share] of [
      ['renewal', '6,020.00', '52.6%'],
      ['extension', '5,430.00', '47.4%'],
      ['visa', '7,710.00', '67.3%'],
      ['cash', '3,740.00', '32.7%'],
    ] as const) {
      const row = slice(split, 'data-lic-split', key, '</li>');
      expect(text(row), key).toContain(amount);
      expect(text(row), key).toContain(share);
      expect(row, key).toContain('bg-brand-600 dark:bg-brand-500');
    }
    expect(text(split)).toContain(ar('fleet.licenseExpenses.kinds.renewal'));
    expect(text(split)).toContain(ar('fleet.licenseExpenses.paidBy.cash'));
    // No register filter matches a bar exactly (B3): no link in the card.
    expect(links(split)).toEqual([]);
  });

  it('says «الشركة كلها» while narrowed — a branch and «كل فروعي» alike — never in the company view', () => {
    expect(period).not.toContain('data-company-wide');
    for (const html of [BRANCH, MINE]) {
      const head = slice(periodBand(html), 'data-dash-band', 'period', 'data-period-filters');
      expect(head).toContain('data-company-wide="true"');
      expect(nowBand(html)).not.toContain('data-company-wide');
    }
  });

  it('keeps the same memos whatever type or branch the page holds — a memo carries none', () => {
    const url = `${TAB_URL}&type=${T1}`;
    const narrowed = tab({
      url,
      page: { ...PAGE, vehicleScope: { ...COMPANY_SCOPE, typeIds: [T1] } },
    });
    expect(text(part(narrowed, 'data-lic-spend', 'card'))).toContain('11,450.00');
    expect(target(hrefOf(narrowed, 'licenceSpend.total')).params).toEqual({
      from: TODAY,
      to: TODAY,
    });
    expect(target(hrefOf(BRANCH, 'licenceSpend.total')).params).toEqual({
      from: TODAY,
      to: TODAY,
    });
  });

  it('says the memos are settled from the custody and not added to it — and opens «العهدة»', () => {
    const note = part(DEFAULT, 'data-lic-custody-note', 'true');
    expect(text(note)).toContain(w('custodyNote'));
    expect(hrefOf(note, 'licenceSpend.custody.tab')).toBe('/fleet?tab=custody');
    // Without the custody tab: the note alone.
    const keys = KEYS.filter((key) => key !== 'fleetCustody.view');
    const plain = part(tab({}, keys), 'data-lic-custody-note', 'true');
    expect(text(plain)).toContain(w('custodyNote'));
    expect(links(plain)).toEqual([]);
  });
});

// ── 9 · The badge, the faces, the readers ─────────────────────────────────────────────────────

describe('the red badge — expired car licences + expired driver licences, hidden at 0', () => {
  it('= the two red cards (4 cars + 2 drivers), red on the pill', () => {
    const html = page();
    const badge = /data-dash-badge="licences"([^>]*)>([^<]*)</u.exec(html);
    expect(badge?.[2]).toBe('6');
    expect(badge?.[1]).toContain('bg-red');
  });

  it('is not drawn at all when nothing has expired', () => {
    const html = page({
      now: {
        ...NOW,
        licenceVehicles: { ...VEHICLES, expired: 0 },
        licenceDrivers: { ...DRIVERS, expired: 0 },
      },
    });
    expect(html).not.toContain('data-dash-badge="licences"');
  });
});

describe('each band its own read’s face; each card its own section', () => {
  it('keeps the period band when R1 failed, and «الآن» when R2 failed', () => {
    const nowDown = tab({ nowFails: true });
    expect(nowBand(nowDown)).toContain('data-read-band="error"');
    expect(nowDown).not.toContain('data-lic-kpi=');
    expect(nowDown).toContain('data-lic-spend="card"');
    const periodDown = tab({ pageFails: true });
    expect(periodBand(periodDown)).toContain('data-read-band="error"');
    expect(periodDown).not.toContain('data-lic-spend=');
    expect(periodDown).toContain('data-lic-kpi="carsExpired"');
  });

  it('puts a section the server could not compute in its place, with its retry', () => {
    const html = tab({ now: { ...NOW, licenceVehicles: null, unavailable: ['licenceVehicles'] } });
    expect(html).toContain('data-section-error="licenceVehicles"');
    expect(html).not.toContain('data-lic-kpi="carsExpired"');
    expect(html).not.toContain('data-lic-block="cars"');
    expect(html).toContain('data-lic-kpi="driversExpired"');
    expect(html).toContain('data-lic-kpi="papers"');
  });

  it('shows a reader of the licensing board alone the papers card alone — and no period', () => {
    const html = tab({}, ['fleetLicensing.view']);
    expect([...html.matchAll(/data-lic-kpi="([^"]+)"/gu)].map((m) => m[1])).toEqual(['papers']);
    expect(html).not.toContain('data-lic-block=');
    expect(html).not.toContain('data-lic-band="period"');
    expect(html).not.toContain('data-period-filters');
    expect(text(html.slice(0, html.indexOf('data-lic-band="now"')))).toContain(w('subNow'));
  });

  it('draws the period band only for a reader of the licence expenses', () => {
    const without = tab({}, ALL_KEYS);
    expect(without).not.toContain('data-lic-band="period"');
    expect(DEFAULT).toContain('data-lic-band="period"');
  });

  it('draws the cars without the papers and the drivers for a reader of the registry alone', () => {
    const html = tab({}, ['fleetVehicle.view']);
    expect([...html.matchAll(/data-lic-kpi="([^"]+)"/gu)].map((m) => m[1])).toEqual([
      'carsExpired',
      'carsExpiring',
    ]);
    expect(html).not.toContain('data-lic-block="drivers"');
  });
});

describe('what the tab never draws', () => {
  it('says none of the words the owner ruled out, and none of the old body', () => {
    // The bar's preset list names «مخصص» (a custom range); the ban is the budget's word.
    const words = text(DEFAULT.replace(/<select[\s\S]*?<\/select>/gu, ''));
    for (const word of [
      'وثيقة التأمين',
      'قسط',
      'فحص فني',
      'الفيش الجنائي',
      'كشف طبي',
      'مخصص',
      'خزينة',
      'متوسط تكلفة',
      'مكتمل',
      'ذروة',
      'مجدول',
      'تسجيل معاملة تجديد',
      'آخر ما سُجّل',
      'تصدير',
    ]) {
      expect(words, word).not.toContain(word);
    }
    expect(DEFAULT).not.toContain('data-licences-card');
  });

  it('carries no sample marker and no bare list link', () => {
    expect(DEFAULT).not.toMatch(/data-zz-/u);
    for (const link of links(DEFAULT)) {
      const { path, params } = target(link.href);
      const record = /^\/fleet\/(vehicles|drivers)\/[^/]+$/u.test(path);
      expect(record || path === '/fleet' || Object.keys(params).length > 0, link.href).toBe(true);
    }
  });

  it('counts nothing in its own files', () => {
    const dir = join(HERE, 'components', 'fleet-dashboard');
    for (const name of readdirSync(dir).filter((f) => f.startsWith('tab-licences'))) {
      const src = readFileSync(join(dir, name), 'utf8').replace(/^\s*\/\/.*$/gmu, '');
      expect(src, name).not.toMatch(/\.reduce\(/u);
      expect(src, name).not.toMatch(/\.filter\([^)]*\)\.length/u);
      expect(src, name).not.toMatch(/\{[\w.?]+\.length\}/u);
      expect(src, name).not.toMatch(/from '[^']*zz-/u);
    }
  });
});
