// «لوحة تحكم الحركة» — «الصيانة والورش», the owner-approved sample (approved/maint-dark.png and
// maint-branch-dark.png; plan build-dm §7), the dashboard's first tab of «الآن» and a period both.
//
// What this file pins: the words and the order the owner approved; every figure reads its field and
// opens the list that shows the same number (or nothing, when no list shows exactly it: «نشطة · خارج
// الخدمة», the average stay); the alarm counts are the server's `red` / `yellow`, never the rows drawn;
// every period figure is by EXIT day — its links carry `outFrom` / `outTo` and never `from` / `to`, with
// the page's own set; each card shows under its own gate; the page's filter bar stands between the
// two bands; R1 and R2 each have their own face, so one failing never blanks the other. It also carries
// the pins of the old tab 9 that still hold (each work type, workshop and car opens the maintenance
// screen over the period; «غير محدد» for a nameless bar; no money anywhere, and where the cost is).
//
// Rendered through the real page over seeded caches (`renderDashboard`), the fleet-dashboard way: R1
// under its key, R2 under the key the address bar's filters make.
import { describe, expect, it } from 'vitest';
import { type QueryClient } from '@tanstack/react-query';
import {
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
  OP_CASH,
  PERIOD_DTO,
  T1,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

// ── The figures: the approved sample's, one consistent set ───────────────────────────────────

const named = (arName: string, en: string): LocalizedString => ({ ar: arName, en });
const SPRINTER = named('مرسيدس اسبرانتر 515', 'Mercedes Sprinter 515');
const ATEGO = named('مرسيدس اسيليو 915', 'Mercedes Atego 915');
const SPRINTER_516 = named('مرسيدس اسبرانتر 516', 'Mercedes Sprinter 516');
const KADER = named('مصنع قادر', 'Kader factory');
const TECHNO = named('تكنو وان', 'Techno One');
const LOCAL = named('سوق محلى', 'Local market');
const TOYOTA = named('تويوتا', 'Toyota');
const SERVICE = named('صيانة', 'Service');
const REPAIR = named('إصلاح', 'Repair');
const BODY = named('سمكرة', 'Bodywork');
const BRAKES = named('ضبط الفرامل', 'Brakes');
const CAIRO = { id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

const id = (n: number): string => `65000000000000000000${String(700 + n).padStart(4, '0')}`;
const WT_SERVICE = id(1);
const WT_REPAIR = id(2);
const WT_NAMELESS = id(9);
const WS_KADER = id(11);
const WS_LOCAL = id(12);

type Alarm = NonNullable<FleetDashboardNowDto['maintenanceAlarm']>;
type Workshop = NonNullable<FleetDashboardNowDto['workshop']>;
type Exits = NonNullable<FleetDashboardPeriodDto['exits']>;

const alarmRow = (
  code: string,
  level: 'red' | 'yellow',
  sinceServiceKm: number,
  lastServiceAt: string | null,
  typeName: LocalizedString | null,
  workshop?: LocalizedString | null,
): Alarm['rows'][number] => ({
  vehicleId: `v${code}`,
  code,
  typeName,
  level,
  remainingKm: 10_000 - sinceServiceKm,
  sinceServiceKm,
  intervalKm: 10_000,
  lastServiceAt,
  inWorkshop: workshop === undefined ? null : { workshop },
});

/** Two red (both past the 10,000 km, both in the workshop), six yellow; the settings' defaults. */
const ALARM: Alarm = {
  red: 2,
  overdue: 2,
  yellow: 6,
  codes: null,
  redKm: 300,
  yellowKm: 1_000,
  rows: [
    alarmRow('247', 'red', 11_800, '2026-07-21', SPRINTER, KADER),
    alarmRow('188', 'red', 10_450, '2026-08-02', ATEGO, TECHNO),
    alarmRow('305', 'yellow', 9_660, '2026-08-10', ATEGO),
    alarmRow('214', 'yellow', 9_590, '2026-08-14', SPRINTER),
    alarmRow('122', 'yellow', 9_440, '2026-08-19', SPRINTER_516),
    alarmRow('318', 'yellow', 9_310, '2026-08-23', SPRINTER_516),
    alarmRow('167', 'yellow', 9_180, '2026-08-28', null, null),
    alarmRow('290', 'yellow', 9_050, null, SPRINTER),
  ],
};

const stay = (
  code: string,
  days: number,
  workshop: LocalizedString | null,
  workType: LocalizedString | null,
  typeName: LocalizedString | null = SPRINTER,
): Workshop['longest'][number] => ({
  visitId: `visit-${code}`,
  vehicleId: `v${code}`,
  code,
  typeName,
  inDate: '2026-10-20',
  days,
  workshop,
  workType,
});

/** Nine cars in the workshop (one out of service), the oldest 247 for 12 days. */
const WORKSHOP: Workshop = {
  open: 9,
  openActive: 8,
  openOutOfService: 1,
  oldest: { vehicleId: 'v247', code: '247', inDate: '2026-10-20', days: 12 },
  longest: [
    stay('247', 12, KADER, named('صيانة + إصلاح', 'Service + repair')),
    stay('188', 7, TECHNO, SERVICE, ATEGO),
    stay('104', 6, LOCAL, BODY),
    stay('215', 5, KADER, REPAIR, ATEGO),
    stay('310', 4, TOYOTA, BRAKES, null),
  ],
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  maintenanceAlarm: ALARM,
  workshop: WORKSHOP,
  dealershipPending: { rows: 4 },
  vehicleScope: null,
  unavailable: [],
};

const bar = (barId: string, name: LocalizedString | null, count: number) => ({
  id: barId,
  name,
  count,
});
/** 37 exits this month: each bar list adds up to them; the old book left none. */
const EXITS: Exits = {
  count: 37,
  avgStayDays: 3.4,
  byWorkType: [
    bar(WT_SERVICE, SERVICE, 14),
    bar(WT_REPAIR, REPAIR, 8),
    bar(id(3), named('صيانة + إصلاح', 'Service + repair'), 5),
    bar(id(4), BODY, 4),
    bar(id(5), BRAKES, 2),
    bar(id(6), named('تغيير زجاج', 'Glass'), 2),
    bar(WT_NAMELESS, null, 2),
  ],
  byWorkshop: [
    bar(WS_KADER, KADER, 12),
    bar(WS_LOCAL, LOCAL, 8),
    bar(id(13), TECHNO, 6),
    bar(id(14), TOYOTA, 4),
    bar(id(15), named('توكيل + مصنع', 'Dealer + factory'), 3),
    bar(id(16), named('بيجو', 'Peugeot'), 2),
    bar(id(17), named('سوزوكى', 'Suzuki'), 2),
  ],
  topVehicles: [
    {
      vehicleId: 'v263',
      code: '263',
      typeName: SPRINTER,
      visits: 3,
      lastInDate: '2026-10-30',
      lastWorkType: REPAIR,
    },
    {
      vehicleId: 'v142',
      code: '142',
      typeName: ATEGO,
      visits: 2,
      lastInDate: '2026-10-28',
      lastWorkType: BODY,
    },
    {
      vehicleId: 'v318',
      code: '318',
      typeName: SPRINTER_516,
      visits: 2,
      lastInDate: '2026-10-26',
      lastWorkType: SERVICE,
    },
    {
      vehicleId: 'v156',
      code: '156',
      typeName: SPRINTER_516,
      visits: 2,
      lastInDate: '2026-10-25',
      lastWorkType: BRAKES,
    },
    {
      vehicleId: 'v231',
      code: '231',
      typeName: null,
      visits: 2,
      lastInDate: '2026-10-23',
      lastWorkType: null,
    },
  ],
  unregistered: 0,
};

const COMPANY_SCOPE: FleetDashboardPeriodDto['vehicleScope'] = {
  count: null,
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
  branchId: null,
  scopeBranches: null,
};

/** The page's R2 at its default filters: «هذا الشهر», no set. */
const PAGE: FleetDashboardPeriodDto = {
  ...PERIOD_DTO,
  range: { preset: 'thisMonth', from: TODAY, to: TODAY, days: 1, granularity: 'day' },
  vehicleScope: COMPANY_SCOPE,
  exits: EXITS,
  unavailable: [],
};

/** «آخر 30 يومًا» with a type, an operation and two cars chosen on the page. */
const SET_URL = `/fleet?tab=maintenance&period=last30&type=${T1}&operation=${OP_CASH}&vehicleCodes=101,102`;
const SET_PAGE: FleetDashboardPeriodDto = {
  ...PAGE,
  range: { preset: 'last30', from: '2026-10-03', to: TODAY, days: 30, granularity: 'day' },
  vehicleScope: {
    count: 2,
    typeIds: [T1],
    operationIds: [OP_CASH],
    vehicleCodes: ['101', '102'],
    branchId: null,
    scopeBranches: null,
  },
  exits: { ...EXITS, unregistered: null },
};

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────

const TAB_URL = '/fleet?tab=maintenance';

/** R2's key for the address bar's filters — the page's own read. */
const pageKey = (url: string) => {
  const query = toPeriodQuery(readPeriodFilters(new URL(url, 'http://x').searchParams));
  return fleetDashboardKeys.period(periodLiveness(query, TODAY), query);
};

/** A read the cache holds as a rejected request leaves it. */
const failed = (client: QueryClient, queryKey: readonly unknown[]): void => {
  client.setQueryDefaults(queryKey, { retryOnMount: false });
  const query = client.getQueryCache().build(client, { queryKey });
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
): string => renderDashboard({ url: seed.url ?? TAB_URL, client: client(seed), permissions });

// ── Reading the markup ────────────────────────────────────────────────────────────────────────

/** The words a reader sees: tags dropped, entities read, and no gap a tag left inside «(N)» or
 *  before a sentence's full stop. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .replace(/\( /gu, '(')
    .replace(/ ([).])/gu, '$1');
/** Every link the markup holds: its target and the figure it carries. */
const links = (html: string): { href: string; metric: string }[] =>
  [...html.matchAll(/<a\b[^>]*>/gu)].map((m) => ({
    href: (/href="([^"]*)"/u.exec(m[0])?.[1] ?? '').replace(/&amp;/gu, '&'),
    metric: /data-metric="([^"]*)"/u.exec(m[0])?.[1] ?? '',
  }));
const hrefOf = (html: string, metric: string): string[] =>
  links(html)
    .filter((l) => l.metric === metric)
    .map((l) => l.href);
const parse = (href: string): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = href.split('?');
  return { pathname, params: new URLSearchParams(search) };
};
/** The markup from the tag holding `marker` to the tag holding the next match of `next`. */
const part = (html: string, marker: string, next: RegExp): string => {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const end = html.slice(at + marker.length).search(next);
  return end < 0
    ? html.slice(start)
    : html.slice(start, html.lastIndexOf('<', at + marker.length + end));
};
const head = (html: string): string => part(html, 'data-tab-head="true"', /data-maint-band="/u);
const nowBand = (html: string): string =>
  part(html, 'data-maint-band="now"', /data-maint-band="period"/u);
/** The markup from the tag holding `marker` to the end. */
const rest = (html: string, marker: string): string => {
  const found = html.indexOf(marker);
  return found < 0 ? '' : html.slice(html.lastIndexOf('<', found));
};
const periodBand = (html: string): string => rest(html, 'data-maint-band="period"');
const kpi = (html: string, key: string): string =>
  part(html, `data-maint-kpi="${key}"`, /data-maint-kpi="|data-maint-block="|data-maint-band="/u);
const block = (html: string, key: string): string =>
  part(html, `data-maint-block="${key}"`, /data-maint-block="|data-maint-band="|data-no-money=/u);
const alarmRowOf = (html: string, code: string): string =>
  part(html, `data-alarm-row="${code}"`, /data-alarm-row="|data-dash-block-foot=/u);
const ids = (html: string, attr: string): string[] =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'gu'))].map((m) => m[1] ?? '');
const at = (html: string, marker: string): number => {
  const found = html.indexOf(marker);
  if (found < 0) throw new Error(`no ${marker}`);
  return found;
};
/** The period-band link as the maintenance screen reads it: exit days, never check-in days. */
const exitParams = (href: string): URLSearchParams => {
  const { pathname, params } = parse(href);
  expect(pathname).toBe('/fleet/maintenance');
  expect(params.has('from')).toBe(false);
  expect(params.has('to')).toBe(false);
  return params;
};

const MAINTENANCE_ONLY = ['fleetMaintenance.view'];
const ODOMETER_ONLY = ['fleetOdometer.view'];
const DEALERSHIP_ONLY = ['fleetDealership.view'];

// ── The heading and the two bands ─────────────────────────────────────────────────────────────

describe('«الصيانة والورش» — the heading and its two bands', () => {
  const html = tab();

  it('names the tab as approved, its line saying only what this reader is shown', () => {
    expect(html).toContain('data-dash-tab-body="maintenance"');
    expect(text(head(html))).toContain('الصيانة والورش والتوكيلات');
    expect(text(head(html))).toContain(
      'إنذارات الصيانة بالكيلومتر، والسيارات في الورشة الآن، وزيارات الورش خلال الفترة، وصفوف التوكيل بانتظار القيمة.',
    );
    // The heading holds «الآن» and the period both: no live chip of its own.
    expect(head(html)).not.toContain('data-live-chip');
    expect(text(head(tab({}, MAINTENANCE_ONLY)))).toContain(
      'السيارات في الورشة الآن، وزيارات الورش خلال الفترة.',
    );
    expect(text(head(tab({}, ODOMETER_ONLY)))).toContain('إنذارات الصيانة بالكيلومتر.');
  });

  it('draws «الآن» first, then «خلال الفترة», the page’s period bar between its head and its figures', () => {
    const order = [
      'data-dash-band="now"',
      'data-maint-kpi="red"',
      'data-maint-kpi="yellow"',
      'data-maint-kpi="workshop"',
      'data-maint-kpi="dealer"',
      'data-maint-block="alarms"',
      'data-dash-band="period"',
      'data-period-filters="true"',
      'data-maint-kpi="exits"',
      'data-maint-kpi="stay"',
      'data-maint-block="byWorkType"',
      'data-maint-block="byWorkshop"',
      'data-maint-block="top"',
      'data-maint-block="longest"',
      'data-no-money="true"',
    ].map((marker) => at(html, marker));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // «الآن» wears the long live chip; the period band its range, from the read's echo.
    expect(nowBand(html)).toContain('data-live-chip="true"');
    expect(text(nowBand(html))).toContain('لقطة الآن، ولا تتأثر بالفلاتر');
    const period = periodBand(html);
    expect(period).toContain('data-dash-range="thisMonth"');
    expect(text(period)).toContain('خلال الفترة');
    expect(text(period)).toContain('نوفمبر');
    expect(text(period)).toContain(
      'زيارات الورش التي خرجت خلال الفترة المختارة، كل زيارة في يوم خروجها.',
    );
  });

  it('the bar is the page’s own: it shows the address bar’s filters and the echoed range', () => {
    const set = tab({ url: SET_URL, page: SET_PAGE });
    const bar = part(set, 'data-period-filters="true"', /data-read-band=/u);
    expect(bar).toMatch(/<option value="last30" selected="">/u);
    expect(text(bar)).toContain('2026/10/03');
    expect(set).toContain('data-dash-range="last30"');
  });

  it('draws no sample marker and nothing the owner ruled out', () => {
    expect(html).not.toContain('data-zz-');
    expect(text(html)).not.toContain('ج.م.');
    expect(links(html).filter((l) => l.href.startsWith('/fleet/vehicle-contracts'))).toEqual([]);
  });
});

// ── «الآن»: the four cards ────────────────────────────────────────────────────────────────────

describe('«الآن» — the four cards, each under its own gate', () => {
  const html = tab();

  it('«بلغت حد الصيانة»: the red count, its list, how many passed it, the red threshold', () => {
    const card = kpi(html, 'red');
    expect(text(card)).toContain('بلغت حد الصيانة');
    expect(text(card)).toContain('منها 2 تجاوزته');
    expect(text(card)).toContain('2 سيارات');
    expect(text(card)).toContain('متبقٍ 300 كم أو أقل حتى الصيانة');
    expect(text(card)).toContain('حد الإنذار الأحمر من الإعدادات');
    expect(hrefOf(card, 'maintenanceAlarm.red')).toEqual(['/fleet/maintenance-alarms?level=red']);
    // No car past its limit: no «منها … تجاوزته».
    const none = tab({ now: { ...NOW, maintenanceAlarm: { ...ALARM, overdue: 0 } } });
    expect(text(kpi(none, 'red'))).not.toContain('تجاوزته');
  });

  it('«تقترب من حد الصيانة»: the yellow count, its list, the yellow threshold', () => {
    const card = kpi(html, 'yellow');
    expect(text(card)).toContain('تقترب من حد الصيانة');
    expect(text(card)).toContain('لم تبلغ الحد الأحمر');
    expect(text(card)).toContain('6 سيارات');
    expect(text(card)).toContain('متبقٍ 1,000 كم أو أقل حتى الصيانة');
    expect(text(card)).toContain('حد الإنذار الأصفر من الإعدادات');
    expect(hrefOf(card, 'maintenanceAlarm.yellow')).toEqual([
      '/fleet/maintenance-alarms?level=yellow',
    ]);
  });

  it('reads the two thresholds from the settings the server echoes, never the defaults', () => {
    const other = tab({
      now: { ...NOW, maintenanceAlarm: { ...ALARM, redKm: 500, yellowKm: 1_500 } },
    });
    expect(text(kpi(other, 'red'))).toContain('متبقٍ 500 كم أو أقل');
    expect(text(kpi(other, 'yellow'))).toContain('متبقٍ 1,500 كم أو أقل');
    const legend = part(other, 'data-maint-legend="alarms"', /<table|data-maint-end=/u);
    expect(text(legend)).toContain('أحمر: متبقٍ 500 كم أو أقل، أو تجاوز الحد');
    expect(text(legend)).toContain('أصفر: متبقٍ 1,500 كم أو أقل');
    expect(text(legend)).toContain('الحدان من الإعدادات');
  });

  it('«في الورشة الآن»: the open visits, the oldest car, active / out of service unlinked', () => {
    const card = kpi(html, 'workshop');
    expect(text(card)).toContain('في الورشة الآن');
    expect(text(card)).toContain('دخلت ولم تخرج بعد');
    expect(text(card)).toContain('9 سيارات');
    expect(hrefOf(card, 'workshop.open')).toEqual(['/fleet/maintenance?state=open']);
    expect(text(card)).toContain('أقدمها 247 منذ 12 يومًا');
    expect(hrefOf(card, 'workshop.oldest')).toEqual(['/fleet/vehicles/v247']);
    // The car's file only for a reader of the vehicles screen.
    const noRegistry = tab(
      {},
      ALL_KEYS.filter((key) => key !== 'fleetVehicle.view'),
    );
    expect(hrefOf(kpi(noRegistry, 'workshop'), 'workshop.oldest')).toEqual([]);
    // No screen lists the open visits by the car's status: the two figures are plain.
    const status = part(card, 'data-maint-status="true"', /data-maint-kpi=/u);
    expect(text(status)).toContain('نشطة 8 · خارج الخدمة 1');
    expect(links(status)).toEqual([]);
  });

  it('«صفوف توكيل بلا قيمة»: the dealership rows waiting for an amount, and their list', () => {
    const card = kpi(html, 'dealer');
    expect(text(card)).toContain('صفوف توكيل بلا قيمة');
    expect(text(card)).toContain('بانتظار تسجيل القيمة');
    expect(text(card)).toContain('4 صفوف');
    expect(text(card)).toContain('فواتير توكيل لم تُسجَّل قيمتها بعد');
    expect(text(card)).toContain('زيارة الصيانة والإصلاح معًا تُسجَّل صفين');
    expect(hrefOf(card, 'dealershipPending.rows')).toEqual(['/fleet/dealership?state=pending']);
  });

  it('draws each card only for a reader of its own section', () => {
    expect(ids(html, 'data-maint-kpi')).toEqual([
      'red',
      'yellow',
      'workshop',
      'dealer',
      'exits',
      'stay',
    ]);
    // The maintenance screen alone: the workshop and the period, no alarm, no dealership.
    const maintenance = tab({}, MAINTENANCE_ONLY);
    expect(ids(maintenance, 'data-maint-kpi')).toEqual(['workshop', 'exits', 'stay']);
    expect(maintenance).not.toContain('data-maint-block="alarms"');
    expect(maintenance).toContain('data-maint-block="longest"');
    // No dealership grant: no violet card, the rest as it is.
    const noDealer = tab(
      {},
      ALL_KEYS.filter((key) => key !== 'fleetDealership.view'),
    );
    expect(ids(noDealer, 'data-maint-kpi')).toEqual(['red', 'yellow', 'workshop', 'exits', 'stay']);
    // The odometer alone: the two alarm cards and the table — no period band, no period bar, no
    // longest-stay card, no exit link.
    const odometer = tab({}, ODOMETER_ONLY);
    expect(ids(odometer, 'data-maint-kpi')).toEqual(['red', 'yellow']);
    expect(odometer).toContain('data-maint-block="alarms"');
    expect(odometer).not.toContain('data-maint-band="period"');
    expect(odometer).not.toContain('data-period-filters');
    expect(odometer).not.toContain('data-maint-block="longest"');
    expect(links(odometer).filter((l) => l.metric.startsWith('exits.'))).toEqual([]);
    // The dealership alone: its one card.
    const dealer = tab({}, DEALERSHIP_ONLY);
    expect(ids(dealer, 'data-maint-kpi')).toEqual(['dealer']);
    expect(dealer).not.toContain('data-maint-band="period"');
  });

  it('a section the server could not compute shows its error and retry in its place', () => {
    const out = tab({ now: { ...NOW, workshop: null, unavailable: ['workshop'] } });
    expect(nowBand(out)).toContain('data-section-error="workshop"');
    expect(ids(out, 'data-maint-kpi')).toEqual(['red', 'yellow', 'dealer', 'exits', 'stay']);
    const alarm = tab({
      now: { ...NOW, maintenanceAlarm: null, unavailable: ['maintenanceAlarm'] },
    });
    expect(nowBand(alarm)).toContain('data-section-error="maintenanceAlarm"');
    expect(alarm).not.toContain('data-maint-block="alarms"');
  });
});

// ── «إنذارات الصيانة بالكيلومتر» ──────────────────────────────────────────────────────────────

describe('«إنذارات الصيانة بالكيلومتر» — the page’s full width, the rows as the server sends them', () => {
  const html = tab();
  const table = block(html, 'alarms');

  it('heads the table with its levels and the two thresholds', () => {
    expect(text(table)).toContain('إنذارات الصيانة بالكيلومتر');
    expect(text(table)).toContain('الأحمر أولًا، ثم الأقل في المسافة المتبقية حتى الصيانة.');
    const chip = part(table, 'data-maint-chip="alarms"', /data-maint-legend=/u);
    expect(text(chip)).toContain('2 أحمر · 6 أصفر');
    expect(text(table)).toContain('أحمر: متبقٍ 300 كم أو أقل، أو تجاوز الحد');
    expect(text(table)).toContain('أصفر: متبقٍ 1,000 كم أو أقل');
  });

  it('keeps the server’s order: red first, then the least distance left', () => {
    expect(ids(table, 'data-alarm-row')).toEqual([
      '247',
      '188',
      '305',
      '214',
      '122',
      '318',
      '167',
      '290',
    ]);
    expect(ids(table, 'data-alarm-level')).toEqual([
      'red',
      'red',
      'yellow',
      'yellow',
      'yellow',
      'yellow',
      'yellow',
      'yellow',
    ]);
  });

  it('writes each row as approved: past the limit or left, the open visit, the interval, the day', () => {
    const over = text(alarmRowOf(table, '247'));
    expect(over).toContain('تجاوز الحد بـ 1,800 كم');
    expect(over).toContain('في الورشة: مصنع قادر');
    expect(over).toContain('مرسيدس اسبرانتر 515');
    expect(over).toContain('11,800 كم من كل 10,000 كم');
    expect(over).toContain('2026/07/21');
    const left = text(alarmRowOf(table, '305'));
    expect(left).toContain('متبقٍ 340 كم');
    expect(left).not.toContain('تجاوز');
    expect(left).not.toContain('في الورشة');
    // An open visit with no workshop named; a make the registry no longer names.
    const unnamed = alarmRowOf(table, '167');
    expect(text(unnamed)).toContain('في الورشة');
    expect(text(unnamed)).not.toContain('في الورشة:');
    // No counted service recorded: a dash, never a date of nothing.
    expect(text(alarmRowOf(table, '290'))).toContain('—');
  });

  it('opens each row on the alarms board, that car at its level', () => {
    const rows = hrefOf(table, 'maintenanceAlarm.row').map(parse);
    expect(rows).toHaveLength(8);
    expect(rows[0]?.pathname).toBe('/fleet/maintenance-alarms');
    expect(rows[0]?.params.get('level')).toBe('red');
    expect(rows[0]?.params.get('vehicleCodes')).toBe('247');
    expect(rows[2]?.params.get('level')).toBe('yellow');
    expect(rows[2]?.params.get('vehicleCodes')).toBe('305');
    expect(text(alarmRowOf(table, '247'))).toContain('فتح');
  });

  it('ends on every alarm of the two levels, and says the alarms cover the active cars', () => {
    const [all] = hrefOf(table, 'maintenanceAlarm.all').map(parse);
    expect(all?.pathname).toBe('/fleet/maintenance-alarms');
    expect(all?.params.get('level')).toBe('red,yellow');
    expect(all?.params.has('vehicleCodes')).toBe(false);
    expect(text(table)).toContain('كل إنذارات الصيانة (8)');
    expect(text(table)).toContain('الإنذارات للسيارات النشطة وحدها.');
  });

  it('counts the levels from the server’s counts, never from the rows it drew', () => {
    const many = tab({
      now: { ...NOW, maintenanceAlarm: { ...ALARM, red: 12, overdue: 4, yellow: 40 } },
    });
    const t = block(many, 'alarms');
    expect(ids(t, 'data-alarm-row')).toHaveLength(8);
    expect(text(part(t, 'data-maint-chip="alarms"', /data-maint-legend=/u))).toContain(
      '12 أحمر · 40 أصفر',
    );
    expect(text(t)).toContain('كل إنذارات الصيانة (52)');
    expect(text(kpi(many, 'red'))).toContain('12 سيارة');
    expect(text(kpi(many, 'yellow'))).toContain('40 سيارة');
  });

  it('under a branch: the links carry the branch’s cars; over the screens’ 50 codes, none', () => {
    const codes = { red: ['247', '188'], yellow: ['305', '214', '122', '318', '167', '290'] };
    const branch = tab({
      now: {
        ...NOW,
        branchId: B1,
        scopeBranches: [CAIRO],
        maintenanceAlarm: { ...ALARM, codes },
      },
    });
    const [red] = hrefOf(kpi(branch, 'red'), 'maintenanceAlarm.red').map(parse);
    expect(red?.params.get('vehicleCodes')).toBe('247,188');
    const [all] = hrefOf(block(branch, 'alarms'), 'maintenanceAlarm.all').map(parse);
    expect(all?.params.get('level')).toBe('red,yellow');
    expect((all?.params.get('vehicleCodes') ?? '').split(',').sort()).toEqual(
      [...codes.red, ...codes.yellow].sort(),
    );
    // 51 yellow cars: that level's list is over the cap (the server sends none), so neither its
    // figure nor the foot opens a list — the counts stand, unlinked.
    const over = tab({
      now: {
        ...NOW,
        branchId: B1,
        scopeBranches: [CAIRO],
        maintenanceAlarm: { ...ALARM, yellow: 51, codes: { red: codes.red, yellow: [] } },
      },
    });
    expect(hrefOf(kpi(over, 'yellow'), 'maintenanceAlarm.yellow')).toEqual([]);
    expect(hrefOf(block(over, 'alarms'), 'maintenanceAlarm.all')).toEqual([]);
    expect(block(over, 'alarms')).toContain('data-maint-alarms-all="plain"');
    expect(text(block(over, 'alarms'))).toContain('كل إنذارات الصيانة (53)');
  });

  it('says so when no car is in alarm', () => {
    const none = tab({
      now: { ...NOW, maintenanceAlarm: { ...ALARM, red: 0, overdue: 0, yellow: 0, rows: [] } },
    });
    const t = block(none, 'alarms');
    expect(text(t)).toContain('لا توجد إنذارات صيانة الآن.');
    expect(ids(t, 'data-alarm-row')).toEqual([]);
    expect(hrefOf(t, 'maintenanceAlarm.all')).toEqual([]);
    expect(text(kpi(none, 'red'))).toContain('0 سيارات');
  });
});

// ── «خلال الفترة»: by exit day ────────────────────────────────────────────────────────────────

describe('«خلال الفترة» — every figure by exit day, each opening the maintenance screen', () => {
  const html = tab();

  it('«خرجت من الورشة»: the exits, by exit day, and the visits that left', () => {
    const card = kpi(html, 'exits');
    expect(text(card)).toContain('خرجت من الورشة');
    expect(text(card)).toContain('حسب يوم الخروج');
    expect(text(card)).toContain('37 زيارة');
    expect(text(card)).toContain('زيارات خرجت خلال الفترة');
    expect(text(card)).toContain('عرض الزيارات التي خرجت');
    const hrefs = hrefOf(card, 'exits.count');
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      const params = exitParams(href);
      expect(params.get('outFrom')).toBe(TODAY);
      expect(params.get('outTo')).toBe(TODAY);
    }
  });

  it('«متوسط أيام البقاء في الورشة»: one decimal, in whole days, unlinked; «—» with no exit', () => {
    const card = kpi(html, 'stay');
    expect(text(card)).toContain('متوسط أيام البقاء في الورشة');
    expect(text(card)).toContain('بالأيام الكاملة');
    expect(text(card)).toContain('3.4 يوم');
    expect(text(card)).toContain('من الدخول إلى الخروج، على 37 زيارة');
    expect(text(card)).toContain('الخروج في يوم الدخول يُحسب صفرًا');
    expect(links(card)).toEqual([]);
    const whole = tab({ page: { ...PAGE, exits: { ...EXITS, avgStayDays: 3 } } });
    expect(text(kpi(whole, 'stay'))).toContain('3.0 يوم');
    const none = tab({ page: { ...PAGE, exits: { ...EXITS, avgStayDays: null } } });
    expect(text(kpi(none, 'stay'))).toContain('—');
    expect(text(kpi(none, 'stay'))).not.toContain('— يوم');
  });

  it('opens each work type and each workshop over the period, by exit day', () => {
    const types = block(html, 'byWorkType');
    expect(text(types)).toContain('الصيانة حسب نوع العمل');
    expect(text(types)).toContain('زيارات الفترة حسب نوع العمل المسجّل في كل زيارة.');
    expect(ids(types, 'data-bar')).toEqual(EXITS.byWorkType.map((row) => row.id));
    const service = hrefOf(types, 'exits.byWorkType').map(exitParams);
    expect(service).toHaveLength(7);
    expect(service[0]?.get('workTypes')).toBe(WT_SERVICE);
    expect(service[0]?.get('outFrom')).toBe(TODAY);
    expect(text(types)).toContain('14 زيارة');
    expect(text(types)).toContain('37.8%');
    expect(text(types)).toContain(ar('fleet.dash.maintenance.unnamed'));
    const shops = block(html, 'byWorkshop');
    expect(text(shops)).toContain('الصيانة حسب الورشة');
    expect(text(shops)).toContain('زيارات الفترة حسب الورشة التي دخلتها السيارة.');
    expect(hrefOf(shops, 'exits.byWorkshop').map(exitParams)[0]?.get('workshops')).toBe(WS_KADER);
    // Each list's head: the period's exits, opening them.
    for (const list of [types, shops]) {
      expect(text(part(list, 'data-dash-block-head', /data-bar=/u))).toContain('37 زيارة');
      expect(hrefOf(list, 'exits.count').map(exitParams)).toHaveLength(1);
    }
  });

  it('draws every bar in the brand, each against the longest', () => {
    const types = block(html, 'byWorkType');
    const fills = [
      ...types.matchAll(/data-bar-fill="[^"]*" class="([^"]*)" style="width:([\d.]+)%/gu),
    ];
    expect(fills).toHaveLength(7);
    for (const fill of fills) expect(fill[1]).toContain('bg-brand-600');
    expect(fills[0]?.[2]).toBe('100');
  });

  it('«أكثر السيارات دخولًا للورشة»: the server’s ranking, each car opening its exits', () => {
    const top = block(html, 'top');
    expect(text(top)).toContain('أكثر السيارات دخولًا للورشة');
    expect(text(top)).toContain('السيارات الأكثر زيارات للورشة خلال الفترة، حسب يوم الخروج.');
    expect(ids(top, 'data-top-vehicle')).toEqual(['263', '142', '318', '156', '231']);
    const first = part(top, 'data-top-vehicle="263"', /data-top-vehicle="/u);
    expect(text(first)).toContain('3 زيارات');
    expect(text(first)).toContain('مرسيدس اسبرانتر 515');
    expect(text(first)).toContain('2026/10/30');
    expect(text(first)).toContain('إصلاح');
    expect(text(first)).toContain('فتح');
    const car = hrefOf(first, 'exits.topVehicle').map(exitParams);
    expect(car).toHaveLength(2);
    expect(car[0]?.get('vehicleCodes')).toBe('263');
    expect(car[0]?.get('outFrom')).toBe(TODAY);
    // The car's file, for a reader of the vehicles screen.
    expect(hrefOf(first, 'exits.vehicle')).toEqual(['/fleet/vehicles/v263']);
    // A last work type the catalog no longer names.
    expect(text(part(top, 'data-top-vehicle="231"', /data-dash-block-foot=/u))).toContain(
      ar('fleet.dash.maintenance.unnamed'),
    );
    // The rank is a place, not an alarm: no red.
    expect(first).not.toMatch(/bg-red-|text-red-/u);
    expect(text(top)).toContain('كل زيارات الفترة (37)');
    expect(hrefOf(rest(top, 'data-dash-block-foot'), 'exits.count')).toHaveLength(1);
  });

  it('carries the page’s whole set and never the check-in days; a car’s row names that car', () => {
    const set = tab({ url: SET_URL, page: SET_PAGE });
    const exits = links(periodBand(set)).filter(
      (l) => l.metric.startsWith('exits.') && l.metric !== 'exits.vehicle',
    );
    expect(exits.map((l) => l.metric).sort()).toEqual(
      [
        ...Array<string>(5).fill('exits.count'),
        ...Array<string>(7).fill('exits.byWorkType'),
        ...Array<string>(7).fill('exits.byWorkshop'),
        ...Array<string>(10).fill('exits.topVehicle'),
      ].sort(),
    );
    for (const link of exits) {
      const params = exitParams(link.href);
      expect(params.get('outFrom'), link.metric).toBe('2026-10-03');
      expect(params.get('outTo'), link.metric).toBe(TODAY);
      expect(params.get('type'), link.metric).toBe(T1);
      expect(params.get('operation'), link.metric).toBe(OP_CASH);
      if (link.metric !== 'exits.topVehicle') {
        expect(params.get('vehicleCodes'), link.metric).toBe('101,102');
      }
    }
    // A ranked car's row: that car's code in place of the set's codes; the rest of the set stays.
    const [car] = hrefOf(block(set, 'top'), 'exits.topVehicle').map(exitParams);
    expect(car?.get('vehicleCodes')).toBe('263');
    expect(car?.get('type')).toBe(T1);
    expect(car?.get('outFrom')).toBe('2026-10-03');
    // A set narrows by car: the old book's line is not drawn (the server sends no count).
    expect(set).not.toContain('data-maint-unregistered');
  });

  it('says how many exits were of the old book (no registered car), only when there are some', () => {
    expect(html).not.toContain('data-maint-unregistered');
    const old = tab({ page: { ...PAGE, exits: { ...EXITS, unregistered: 3 } } });
    expect(text(part(old, 'data-maint-unregistered', /data-no-money=/u))).toContain(
      'زيارات خرجت بلا سيارة مسجّلة: 3.',
    );
  });

  it('says so when no visit left in the period', () => {
    const none = tab({
      page: {
        ...PAGE,
        exits: {
          count: 0,
          avgStayDays: null,
          byWorkType: [],
          byWorkshop: [],
          topVehicles: [],
          unregistered: 0,
        },
      },
    });
    for (const key of ['byWorkType', 'byWorkshop', 'top']) {
      expect(text(block(none, key)), key).toContain('لا توجد زيارات خرجت في الفترة.');
    }
    expect(text(kpi(none, 'exits'))).toContain('0 زيارات');
  });

  it('names the branch in the ranking’s note when the figures are a branch’s, or the reader’s branches', () => {
    const one = tab({
      page: { ...PAGE, vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] } },
    });
    expect(text(block(one, 'top'))).toContain(
      'سيارات الفرع الأكثر زيارات للورشة خلال الفترة، حسب يوم الخروج.',
    );
    const mine = tab({
      page: { ...PAGE, vehicleScope: { ...COMPANY_SCOPE, scopeBranches: [GIZA, CAIRO] } },
    });
    expect(text(block(mine, 'top'))).toContain(
      'سيارات فروعك الأكثر زيارات للورشة خلال الفترة، حسب يوم الخروج.',
    );
  });

  it('carries no money anywhere, and says where the maintenance cost is', () => {
    expect(text(html)).not.toContain('ج.م.');
    expect(html).toContain('data-no-money="true"');
    expect(text(html)).toContain(ar('fleet.dash.maintenance.noMoney'));
  });
});

// ── «أطول بقاء في الورشة الآن»: R1 in the period band ─────────────────────────────────────────

describe('«أطول بقاء في الورشة الآن» — R1’s, the period moves nothing', () => {
  const html = tab();
  const card = block(html, 'longest');

  it('lists the open visits the oldest first, each opening that car’s open visit', () => {
    expect(text(card)).toContain('أطول بقاء في الورشة الآن');
    expect(text(card)).toContain('ما زالت في الورشة، الأقدم دخولًا أولًا؛ لا تتأثر بالفترة.');
    expect(card).toContain('data-now-chip="true"');
    expect(text(card)).toContain('9 سيارات في الورشة');
    expect(ids(card, 'data-longest-row')).toEqual(['247', '188', '104', '215', '310']);
    const first = part(card, 'data-longest-row="247"', /data-longest-row="/u);
    expect(text(first)).toContain('مصنع قادر');
    expect(text(first)).toContain('صيانة + إصلاح');
    expect(text(first)).toContain('منذ 12 يومًا');
    const [open] = hrefOf(first, 'workshop.longest').map(parse);
    expect(open?.pathname).toBe('/fleet/maintenance');
    expect(open?.params.get('state')).toBe('open');
    expect(open?.params.get('vehicleCodes')).toBe('247');
    expect(open?.params.has('outFrom')).toBe(false);
    expect(text(card)).toContain('كل السيارات في الورشة (9)');
    expect(hrefOf(card, 'workshop.all')).toEqual(['/fleet/maintenance?state=open']);
    // Nine in, five listed: no end row.
    expect(card).not.toContain('data-maint-end="longest"');
  });

  it('a stay that began today reads «منذ اليوم»; a list that holds every open visit ends in words', () => {
    const branchWorkshop: Workshop = {
      open: 2,
      openActive: 2,
      openOutOfService: 0,
      oldest: { vehicleId: 'v188', code: '188', inDate: '2026-10-25', days: 7 },
      longest: [stay('188', 7, TECHNO, SERVICE, ATEGO), stay('129', 0, null, null, null)],
    };
    const branch = tab({
      now: { ...NOW, branchId: B1, scopeBranches: [CAIRO], workshop: branchWorkshop },
    });
    const c = block(branch, 'longest');
    const today = part(c, 'data-longest-row="129"', /data-maint-end=/u);
    expect(text(today)).toContain('منذ اليوم');
    expect(text(today)).toContain(ar('fleet.dash.maintenance.unnamed'));
    expect(text(c)).toContain('لا توجد سيارات أخرى من الفرع في الورشة الآن.');
    const mine = tab({
      now: { ...NOW, scopeBranches: [GIZA, CAIRO], workshop: branchWorkshop },
    });
    expect(text(block(mine, 'longest'))).toContain('لا توجد سيارات أخرى من فروعك في الورشة الآن.');
    const company = tab({ now: { ...NOW, workshop: branchWorkshop } });
    expect(text(block(company, 'longest'))).toContain('لا توجد سيارات أخرى في الورشة الآن.');
  });

  it('says so when no car is in the workshop', () => {
    const empty: Workshop = {
      open: 0,
      openActive: 0,
      openOutOfService: 0,
      oldest: null,
      longest: [],
    };
    const none = tab({ now: { ...NOW, workshop: empty } });
    expect(text(block(none, 'longest'))).toContain('لا توجد سيارات في الورشة الآن.');
    expect(hrefOf(block(none, 'longest'), 'workshop.all')).toEqual([]);
    expect(text(kpi(none, 'workshop'))).toContain('لا توجد سيارات في الورشة الآن.');
  });
});

// ── Each read its own face ────────────────────────────────────────────────────────────────────

describe('«الصيانة والورش» — each read its own face', () => {
  it('R1 failed: «الآن» shows its error and retry; the period figures stand', () => {
    const html = tab({ nowFails: true });
    expect(nowBand(html)).toContain('data-dash-read-error="true"');
    expect(nowBand(html)).not.toContain('data-maint-kpi=');
    expect(ids(periodBand(html), 'data-maint-kpi')).toEqual(['exits', 'stay']);
    expect(text(kpi(html, 'exits'))).toContain('37 زيارة');
    expect(periodBand(html)).toContain('data-maint-block="byWorkType"');
    // The longest stays are R1's: their own error in their place.
    expect(periodBand(html)).toContain('data-section-error="workshop"');
  });

  it('R2 failed: the period shows its error and retry; «الآن» and the longest stays stand', () => {
    const html = tab({ pageFails: true });
    expect(periodBand(html)).toContain('data-dash-read-error="true"');
    expect(periodBand(html)).toContain('data-period-filters="true"');
    expect(periodBand(html)).not.toContain('data-maint-kpi=');
    expect(nowBand(html)).not.toContain('data-dash-read-error');
    expect(ids(nowBand(html), 'data-maint-kpi')).toEqual(['red', 'yellow', 'workshop', 'dealer']);
    expect(ids(block(html, 'alarms'), 'data-alarm-row')).toHaveLength(8);
    expect(ids(block(html, 'longest'), 'data-longest-row')).toHaveLength(5);
  });

  it('R1 on its way: «الآن» and the longest stays in grey; the period answers', () => {
    const html = tab({ now: null });
    expect(nowBand(html)).toContain('data-read-band="loading"');
    expect(nowBand(html)).not.toContain('data-maint-kpi=');
    expect(periodBand(html)).toContain('data-maint-loading="longest"');
    expect(ids(periodBand(html), 'data-maint-kpi')).toEqual(['exits', 'stay']);
  });

  it('R2 on its way: the period in grey; «الآن» answers', () => {
    const html = tab({ page: null });
    expect(periodBand(html)).toContain('data-read-band="loading"');
    expect(periodBand(html)).not.toContain('data-maint-kpi=');
    expect(ids(nowBand(html), 'data-maint-kpi')).toEqual(['red', 'yellow', 'workshop', 'dealer']);
  });

  it('the period’s exits section failed alone: its error, the rest of the page stands', () => {
    const html = tab({ page: { ...PAGE, exits: null, unavailable: ['exits'] } });
    expect(periodBand(html)).toContain('data-section-error="exits"');
    expect(periodBand(html)).not.toContain('data-maint-block="top"');
    expect(ids(nowBand(html), 'data-maint-kpi')).toEqual(['red', 'yellow', 'workshop', 'dealer']);
    expect(periodBand(html)).toContain('data-maint-block="longest"');
  });
});
