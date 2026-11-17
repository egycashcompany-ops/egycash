// «لوحة تحكم الحركة» — «نظرة عامة», layout B (plan build-ot §6, the owner's «دى اعتمدها»).
//
// What this file pins: every KPI reads its own field and opens the list that shows the same number;
// the action centre has one row per alert line that fired, red above amber, each with ONE «فتح» (the
// line's first list, none when there is no exact list); the hub's lines open the tab that shows the
// same figure — keeping the page's own filters, never a period of their own (the month figures open
// theirs on the month read's own slice); the month card is «هذا الشهر» whatever the page's filters
// say, and links over its own read's echo; the company-wide figures (the custody fund) wear «الشركة
// كلها» only while the rest are narrowed (the notices and the fuel cards follow the car's branch, so
// their lines never do, and their links carry the branch); nothing the owner ruled
// out is drawn. It also carries the pins of the retired «التنبيهات» tab that still hold.
//
// Rendered through the real page over seeded caches (`renderDashboard`), the fleet-dashboard way; the
// month card's states the cache cannot hold (failed, not asked) through the tab itself.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  FLEET_DASHBOARD_PERIOD_KEYS,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import { alertLines } from './lib/fleet-dashboard-tabs';
import { OverviewTab } from './components/fleet-dashboard/tab-overview';
import { type MonthRead } from './components/fleet-dashboard/dash-shell';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  PERIOD_DTO,
  PERIOD_KEY,
  T1,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

const need = <T,>(value: T | null): T => {
  if (value === null) throw new Error('fixture section is null');
  return value;
};

/** R1 with every section the overview reads, its own figures where it asserts them. */
const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  fuelCharging: { ...need(NOW_DTO.fuelCharging), cards: 142 },
  distributionVehicles: { ...need(NOW_DTO.distributionVehicles), branchCount: 2 },
  violationsOpen: {
    company: { amount: 14650, count: 30 },
    // The drivers' parts tie to their total (the overview reads `total.count` alone).
    drivers: {
      total: { amount: 9850, count: 18 },
      attributed: { amount: 7600, count: 14, drivers: 9 },
      unknown: { amount: 1350, count: 3 },
      unlinked: { amount: 900, count: 1 },
    },
    total: { amount: 24500, count: 48 },
    bookOnly: { company: { amount: 1150, count: 2 }, drivers: { amount: 300, count: 1 } },
  },
  unavailable: [],
};

/** R2 «هذا الشهر» with no page filter — the month card's own read. */
const MONTH: FleetDashboardPeriodDto = {
  ...PERIOD_DTO,
  range: { preset: 'thisMonth', from: TODAY, to: TODAY, days: 1, granularity: 'day' },
  vehicleScope: {
    count: null,
    typeIds: [],
    operationIds: [],
    vehicleCodes: [],
    branchId: null,
    scopeBranches: null,
  },
  km: { ...need(PERIOD_DTO.km), total: 4896 },
  // The month's exits (by exit day): the overview draws their count; the rest is the tab's.
  exits: { ...need(PERIOD_DTO.exits), count: 21 },
  // The month's accidents: the overview draws their count alone.
  accidents: { ...need(PERIOD_DTO.accidents), count: 4 },
  // The month's receipts: fuel = card + fuelCustody (card receipts are fuel only), total = card +
  // custody = card + fuelCustody + tyres + wash + maintenance. The overview draws `fuel` / `total`.
  opex: {
    card: 6000,
    custody: 6500,
    fuel: 8200,
    total: 12500,
    count: 40,
    dataFrom: null,
    fuelCustody: 2200,
    tyres: 1800,
    wash: 700,
    maintenance: 1800,
    litres: 470,
    unpricedFuel: 0,
  },
  unavailable: [],
};

const CAIRO_BRANCH = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };

/** Alarm rows for a literal's own codes (the table is the tab's; the overview draws counts). */
const alarmRows = (
  ...cars: [code: string, level: 'red' | 'yellow'][]
): NonNullable<FleetDashboardNowDto['maintenanceAlarm']>['rows'] =>
  cars.map(([code, level], i) => ({
    vehicleId: `v${code}`,
    code,
    typeName: null,
    level,
    remainingKm: level === 'red' ? 100 + i : 500 + i,
    sinceServiceKm: 10_000 - (level === 'red' ? 100 + i : 500 + i),
    intervalKm: 10_000,
    lastServiceAt: null,
    inWorkshop: null,
  }));
const GIZA_BRANCH = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

const page = (
  url = '/fleet?tab=overview',
  seed: Parameters<typeof dashboardClient>[0] = {},
  permissions: readonly string[] = ALL_KEYS,
): string =>
  renderDashboard({
    url,
    client: dashboardClient({ now: NOW, period: MONTH, ...seed }),
    permissions,
  });

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, ' ');
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
/** The markup from the tag holding `marker` to the tag holding the next match of `next` — whole
 *  tags at both ends, so no attribute is ever read as text. */
const part = (html: string, marker: string, next: RegExp): string => {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const end = html.slice(at + marker.length).search(next);
  return end < 0
    ? html.slice(start)
    : html.slice(start, html.lastIndexOf('<', at + marker.length + end));
};
const kpi = (html: string, id: string): string =>
  part(html, `data-dash-kpi="${id}"`, /data-dash-kpi="|data-section-error="|data-dash-columns=/u);
const row = (html: string, id: string): string =>
  part(html, `data-dash-action="${id}"`, /data-dash-action="|data-dash-action-group=/u);
const hubCard = (html: string, id: string): string =>
  part(html, `data-dash-hub="${id}"`, /data-dash-hub="|data-dash-block=/u);
const hubLine = (html: string, id: string): string =>
  part(
    html,
    `data-dash-hub-line="${id}"`,
    /data-dash-hub-line="|data-dash-hub-foot=|data-dash-hub="/u,
  );
const monthStat = (html: string, id: string): string =>
  part(html, `data-dash-month-stat="${id}"`, /data-dash-month-stat="/u);
const parse = (href: string): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = href.split('?');
  return { pathname, params: new URLSearchParams(search) };
};

// ── The tab itself, for the month card's states a seeded cache cannot hold ─────────────────────

const CUSTODY = {
  lines: 1,
  fundTotal: 159974.54,
  waiting: 0,
  settle: 0,
  loading: false,
  error: false,
  updatedAt: 1,
  refetch: () => undefined,
};
const MONTH_READ: MonthRead = {
  data: MONTH,
  loading: false,
  failed: false,
  enabled: true,
  onRetry: () => undefined,
};

const tab = (over: Partial<Parameters<typeof OverviewTab>[0]> = {}): string => {
  const now = over.now === undefined ? NOW : over.now;
  const custody = over.custody === undefined ? CUSTODY : over.custody;
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      auth: { me: { id: 'u1', permissions: {} } as unknown as MeDto, status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    createElement(Provider, {
      store,
      children: createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          {},
          createElement(OverviewTab, {
            now,
            custody,
            lines: alertLines(now?.alerts ?? [], custody?.lines ?? null),
            can: (key) => ALL_KEYS.includes(key),
            updatedAt: 0,
            refreshing: false,
            onRefresh: () => undefined,
            onRetry: () => undefined,
            month: MONTH_READ,
            tabLink: (to, metric) => ({ to: `/fleet?tab=${to}`, metric }),
            ...over,
          }),
        ),
      ),
    }),
  );
};

// ── (a) The heading and the six KPI cards ──────────────────────────────────────────────────────

describe('«نظرة عامة» — the heading and the six KPI cards', () => {
  const html = page();

  it('is the tab the page opens on, with the approved heading and the overview’s live chip', () => {
    expect(renderDashboard({ client: dashboardClient({ now: NOW, period: MONTH }) })).toContain(
      'data-dash-tab-body="overview"',
    );
    expect(html).toContain(ar('fleet.dash.overview.title'));
    expect(html).toContain('data-live-variant="overview"');
    expect(text(html)).toContain(ar('fleet.dash.overview.sub'));
  });

  it('says «N سيارة نشطة» from the registry beside the title, and opens the active cars', () => {
    const chip = part(html, 'data-dash-active-chip="true"', /data-live-chip=/u);
    expect(text(chip)).toContain('40 سيارة نشطة');
    expect(hrefOf(chip, 'vehicles.active')).toEqual(['/fleet/vehicles?status=active']);
  });

  it('draws the six cards in the approved order, each with its grey foot band', () => {
    const order = ['readiness', 'unmanned', 'workshop', 'urgent', 'fuel', 'custody'];
    expect([...html.matchAll(/data-dash-kpi="(\w+)"/gu)].map((m) => m[1])).toEqual(order);
    expect([...html.matchAll(/data-dash-foot="(\w+)"/gu)].map((m) => m[1])).toEqual(order);
  });

  it('K1 «جاهزية الأسطول»: ready of the board’s rows, its share, and what is out of readiness', () => {
    const body = kpi(html, 'readiness');
    expect(text(body)).toContain('82.5% جاهز');
    expect(text(body)).toContain('33 من 40 سيارة');
    expect(text(body)).toContain('7 سيارات خارج الجاهزية');
    expect(hrefOf(body, 'roster.ready')).toEqual([`/fleet/roster?date=${TODAY}&view=ready`]);
  });

  it('K2 «بلا سائق اليوم»: amber «تحتاج تعيين» — never red «حرج» — and «كلها لها سائق» at zero', () => {
    const body = kpi(html, 'unmanned');
    expect(text(body)).toContain(ar('fleet.dash.overview.kpi.unmanned.tag'));
    expect(text(body)).toContain('5 سيارات جاهزة بلا سائق');
    expect(text(body)).toContain('من 33 سيارة جاهزة اليوم');
    expect(body).toContain('border-l-amber-500');
    expect(text(body)).not.toContain('حرج');
    expect(hrefOf(body, 'roster.unmanned')).toEqual([`/fleet/roster?date=${TODAY}&view=unmanned`]);
    // Its grey foot band (as all six approved cards draw one): «الحركة اليوم», no figure of its own.
    expect(body).toContain('data-dash-foot="unmanned"');
    expect(text(body)).toContain(ar('fleet.dash.overview.kpi.unmanned.open'));
    expect(hrefOf(body, 'roster.tab')).toEqual(['/fleet?tab=today']);
    const roster = need(NOW.roster);
    const clear = kpi(
      page('/fleet?tab=overview', { now: { ...NOW, roster: { ...roster, unmanned: 0 } } }),
      'unmanned',
    );
    expect(text(clear)).toContain(ar('fleet.dash.overview.kpi.unmanned.clear'));
  });

  it('K3 «في الورشة الآن»: the open visits, the oldest car, and the plain split by status', () => {
    const body = kpi(html, 'workshop');
    expect(text(body)).toContain('6 سيارات في الورشة');
    expect(text(body)).toContain('منذ 9 أيام');
    expect(text(body)).toContain('نشطة 5 · خارج الخدمة 1');
    expect(hrefOf(body, 'workshop.open')).toEqual(['/fleet/maintenance?state=open']);
    expect(hrefOf(body, 'workshop.oldest')).toEqual(['/fleet/vehicles/v141']);
    // The car's file has its own guard; a car that came in today is «منذ اليوم», never «منذ 0».
    const blind = kpi(
      page(
        '/fleet?tab=overview',
        {},
        ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
      ),
      'workshop',
    );
    expect(hrefOf(blind, 'workshop.oldest')).toEqual([]);
    const workshop = need(NOW.workshop);
    const today = kpi(
      page('/fleet?tab=overview', {
        now: { ...NOW, workshop: { ...workshop, oldest: { ...need(workshop.oldest), days: 0 } } },
      }),
      'workshop',
    );
    expect(text(today)).toContain(ar('fleet.dash.common.sinceToday'));
    expect(text(today)).not.toContain('منذ 0');
  });

  it('K4 «تنبيهات عاجلة» counts the red LINES, of all the lines that fired — a plain figure', () => {
    const body = kpi(html, 'urgent');
    expect(text(body)).toContain('4 تنبيهات');
    // «من N تنبيهًا الآن» in its grey foot band, as every card has one.
    expect(text(part(body, 'data-dash-foot="urgent"', /<\/div>/u))).toContain('من 11 تنبيهًا الآن');
    expect(links(body)).toEqual([]);
  });

  it('K5 «أرصدة كروت الوقود»: the two companies’ balances, each opening its own, and the card count', () => {
    const body = kpi(html, 'fuel');
    expect(text(body)).toContain('115,950.00');
    expect(hrefOf(body, 'fuelCharging.wataniya')).toEqual([
      '/fleet/fuel-cards/charging?company=wataniya',
    ]);
    expect(hrefOf(body, 'fuelCharging.chillout')).toEqual([
      '/fleet/fuel-cards/charging?company=chillout',
    ]);
    expect(text(body)).toContain('موزعة على 142 كارتًا');
    expect(links(body)).toHaveLength(2);
  });

  it('K6 «رصيد العهدة النقدية»: the fund from the custody screen’s own read, and «فتح لوحة العهدة»', () => {
    const body = kpi(html, 'custody');
    expect(text(body)).toContain('159,974.54');
    expect(hrefOf(body, 'custodyFund.total')).toEqual(['/fleet/custody/dashboard']);
    expect(hrefOf(body, 'custodyFund.dashboard')).toEqual(['/fleet/custody/dashboard']);
    expect(text(body)).toContain(ar('fleet.dash.overview.kpi.custody.open'));
  });

  it('a card whose section failed shows its error and the retry in its place', () => {
    const failed = page('/fleet?tab=overview', {
      now: { ...NOW, roster: null, fuelCharging: null, unavailable: ['roster', 'fuelCharging'] },
    });
    expect(failed).toContain('data-section-error="roster"');
    expect(failed).toContain('data-section-error="fuelCharging"');
    expect(failed).not.toContain('data-dash-kpi="readiness"');
  });
});

// ── (b) The action centre ──────────────────────────────────────────────────────────────────────

describe('«نظرة عامة» — the action centre', () => {
  const html = page();

  it('has one row per line that fired: red first, then amber, custody after the notices', () => {
    expect([...html.matchAll(/data-dash-action="([a-zA-Z]+)"/gu)].map((m) => m[1])).toEqual([
      'maintenanceRed',
      'vehicleLicenceExpired',
      'driverLicenceExpired',
      'fuelCardExpired',
      'crewAbsent',
      'fuelRequests',
      'fuelLow',
      'dealershipPending',
      'noticesMissing',
      'custody',
      'noReading',
    ]);
    expect(html.indexOf('data-dash-action-group="red"')).toBeLessThan(
      html.indexOf('data-dash-action-group="amber"'),
    );
  });

  it('tallies LINES — «عاجل 4 · للمتابعة 7» — never a sum of counts', () => {
    const tally = (tone: string): string =>
      text(part(html, `data-dash-tally="${tone}"`, /data-dash-tally=|<\/div>/u)).trim();
    expect(tally('red')).toBe(`${ar('fleet.dash.overview.actions.urgent')} 4`);
    expect(tally('amber')).toBe(`${ar('fleet.dash.overview.actions.follow')} 7`);
  });

  it('every row’s ONE button is «فتح», opening the line’s first list', () => {
    const open: Record<string, string> = {
      maintenanceRed: '/fleet/maintenance-alarms?level=red',
      vehicleLicenceExpired: `/fleet/vehicles?status=active&licExpBefore=${TODAY}`,
      driverLicenceExpired: `/fleet/drivers?licExpBefore=${TODAY}`,
      fuelCardExpired: `/fleet/fuel-cards?expiresBefore=${TODAY}`,
      crewAbsent: `/fleet/roster?date=${TODAY}&view=crewGap`,
      fuelRequests: '/fleet/fuel-cards/charging?state=requested',
      fuelLow: '/fleet/fuel-cards/charging?state=low',
      dealershipPending: '/fleet/dealership?state=pending',
      noticesMissing: '/fleet/notices?status=open',
      custody: '/fleet/custody/dashboard',
      noReading: '/fleet/odometer?vehicleCodes=304,112&period=all',
    };
    for (const [id, href] of Object.entries(open)) {
      const buttons = [...row(html, id).matchAll(/<a\b[^>]*data-dash-action-open="[^"]*"[^>]*>/gu)];
      expect(buttons, id).toHaveLength(1);
      const button = buttons[0]?.[0] ?? '';
      expect((/href="([^"]*)"/u.exec(button)?.[1] ?? '').replace(/&amp;/gu, '&'), id).toBe(href);
      expect(text(part(row(html, id), 'data-dash-action-open=', /<\/a>/u)), id).toContain(
        ar('fleet.dash.overview.actions.open'),
      );
    }
  });

  it('says each line with a short title and its count in the chip — «صفوف», «منذ 3 أيام»', () => {
    expect(text(row(html, 'maintenanceRed'))).toContain(
      ar('fleet.dash.overview.actions.line.maintenanceRed.title'),
    );
    expect(text(row(html, 'maintenanceRed'))).toContain('3 سيارات');
    expect(text(row(html, 'dealershipPending'))).toContain('3 صفوف');
    expect(text(row(html, 'noReading'))).toContain('سيارات نشطة بلا قراءة عداد منذ 3 أيام');
    expect(text(row(html, 'vehicleLicenceExpired'))).toContain('منذ 18 يومًا');
    expect(text(row(html, 'fuelRequests'))).toContain('6,500.00');
    expect(row(html, 'noticesMissing')).toContain('data-dash-action-count="3"');
  });

  it('keeps the figures the retired «التنبيهات» said on the alarm and crew lines — nobody loses one', () => {
    // The cars approaching the limit (yellow), opening their own board; under a branch, their codes.
    const alarm = row(html, 'maintenanceRed');
    expect(text(alarm)).toContain('منها 1 تجاوزته');
    expect(text(alarm)).toContain('6 تقترب منه');
    expect(hrefOf(alarm, 'maintenanceAlarm.yellow')).toEqual([
      '/fleet/maintenance-alarms?level=yellow',
    ]);
    const branched = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        branchId: B1,
        scopeBranches: [CAIRO_BRANCH],
        maintenanceAlarm: {
          red: 3,
          overdue: 1,
          yellow: 2,
          codes: { red: ['101'], yellow: ['207', '208'] },
          redKm: 300,
          yellowKm: 1000,
          rows: alarmRows(['101', 'red'], ['207', 'yellow'], ['208', 'yellow']),
        },
      },
    });
    expect(hrefOf(row(branched, 'maintenanceRed'), 'maintenanceAlarm.yellow')).toEqual([
      '/fleet/maintenance-alarms?level=yellow&vehicleCodes=207,208',
    ]);
    const none = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        maintenanceAlarm: {
          red: 3,
          overdue: 1,
          yellow: 0,
          codes: null,
          redKm: 300,
          yellowKm: 1000,
          rows: alarmRows(['141', 'red'], ['127', 'red'], ['166', 'red']),
        },
      },
    });
    expect(text(row(none, 'maintenanceRed'))).not.toContain('تقترب منه');
    // The crew line: what was covered, the stale plans, the other reasons — each only when > 0.
    const crew = text(row(html, 'crewAbsent'));
    expect(crew).toContain(ar('fleet.dash.overview.actions.line.crewAbsent.sub'));
    expect(crew).toContain('تمت تغطية 3 سيارات بسائق متاح');
    expect(crew).toContain('مخطَّط لها سائق غير متاح اليوم: 1');
    expect(crew).not.toContain('لأسباب أخرى');
    const other = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        roster: {
          ...need(NOW.roster),
          crewGap: { vehicles: 2, otherReasons: 4, covered: 0, stalePlan: 0 },
        },
      },
    });
    expect(text(row(other, 'crewAbsent'))).toContain('طاقمها غير متاح لأسباب أخرى: 4');
    expect(text(row(other, 'crewAbsent'))).not.toContain('تمت تغطية');
  });

  it('has no button where no exact list exists: the red codes over 50 under a branch', () => {
    const codes = Array.from({ length: 51 }, (_, i) => String(400 + i));
    const branched = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        branchId: B1,
        scopeBranches: [CAIRO_BRANCH],
        maintenanceAlarm: { ...need(NOW.maintenanceAlarm), codes: { red: codes, yellow: [] } },
      },
    });
    expect(branched).toContain('data-dash-action="maintenanceRed"');
    expect(branched).not.toContain('data-dash-action-open="maintenanceRed"');
    expect(hrefOf(branched, 'maintenanceAlarm.red')).toEqual([]);
  });

  it('counts EXACTLY the custody dashboard’s banner lines, from the one hook (D3)', () => {
    expect(row(html, 'custody')).toContain('data-dash-action-count="1"');
    expect(text(row(html, 'custody'))).toContain('1 تنبيه');
    expect(hrefOf(row(html, 'custody'), 'custodyFund.lines')).toEqual(['/fleet/custody/dashboard']);
  });

  it('names the never-read cars, linking them only with the vehicles screen’s own guard', () => {
    expect(hrefOf(row(html, 'noReading'), 'noReading.neverRead')).toEqual([
      '/fleet/vehicles?vehicleCodes=318',
    ]);
    const blind = row(
      page(
        '/fleet?tab=overview',
        {},
        ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
      ),
      'noReading',
    );
    expect(hrefOf(blind, 'noReading.neverRead')).toEqual([]);
    expect(text(blind)).toContain('318');
  });

  it('says «منتهٍ اليوم» for a licence that expires today, never «منذ 0»', () => {
    const lic = need(NOW.licenceVehicles);
    const today = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        licenceVehicles: {
          ...lic,
          list: [{ vehicleId: 'v500', code: '500', expiresAt: `${TODAY}T00:00:00.000Z`, days: 0 }],
        },
      },
    });
    expect(text(row(today, 'vehicleLicenceExpired'))).toContain(
      ar('fleet.dash.overview.actions.expiredToday'),
    );
    expect(text(row(today, 'vehicleLicenceExpired'))).not.toContain('منذ 0');
  });

  it('says which source failed, with its retry — never «لا توجد تنبيهات الآن» over it', () => {
    const silent: FleetDashboardNowDto = {
      ...NOW,
      maintenanceAlarm: null,
      licenceVehicles: null,
      licenceDrivers: null,
      fuelCards: null,
      fuelCharging: null,
      dealershipPending: null,
      notices: null,
      noReading: null,
      roster: null,
      alerts: [],
    };
    const keys = ALL_KEYS.filter((k) => k !== 'fleetCustody.view');
    const failed = page(
      '/fleet?tab=overview',
      { now: { ...silent, unavailable: ['maintenanceAlarm', 'licenceVehicles'] }, custody: false },
      keys,
    );
    const centre = part(
      failed,
      'data-dash-block="actions"',
      /data-dash-side=|data-dash-block="hub"/u,
    );
    expect(centre).toContain('data-section-error="maintenanceAlarm"');
    expect(centre).toContain('data-section-error="licenceVehicles"');
    expect(failed).not.toContain('data-dash-actions-none="true"');
    const clear = page(
      '/fleet?tab=overview',
      { now: { ...NOW, alerts: [] }, custody: false },
      keys,
    );
    expect(clear).toContain('data-dash-actions-none="true"');
    expect(clear).not.toContain('data-dash-action="');
  });
});

// ── (d, e, k) The hub ──────────────────────────────────────────────────────────────────────────

describe('«نظرة عامة» — «مؤشرات الأقسام والأبواب التشغيلية»', () => {
  const html = page();

  it('opens the tab that shows each figure — with no period of its own at the default filters', () => {
    const tabOf: Record<string, string> = {
      'vehicles.tab': 'today',
      'roster.tab': 'today',
      'distributionVehicles.tab': 'distribution',
      'workshop.tab': 'maintenance',
      'maintenanceAlarm.tab': 'maintenance',
      'accidents.tab': 'accidents',
      'violationsOpen.tab': 'violations',
      'opex.tab': 'fuel',
      'licenceVehicles.tab': 'licences',
    };
    for (const [metric, target] of Object.entries(tabOf)) {
      const hrefs = hrefOf(html, metric);
      expect(hrefs.length, metric).toBeGreaterThan(0);
      for (const href of hrefs) {
        const { pathname, params } = parse(href);
        expect(pathname, metric).toBe('/fleet');
        expect(params.get('tab'), metric).toBe(target);
        for (const name of ['period', 'from', 'to'])
          expect(params.has(name), `${metric} ${name}`).toBe(false);
      }
    }
  });

  it('keeps the page’s own filters on a tab link — the ones the reader chose, nothing added', () => {
    const filtered = page(`/fleet?tab=overview&period=last30&type=${T1}`);
    const hrefs = links(filtered).filter((l) => l.metric.endsWith('.tab'));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const { href, metric } of hrefs) {
      const { params } = parse(href);
      expect(params.get('period'), metric).toBe('last30');
      expect(params.get('type'), metric).toBe(T1);
      expect(params.has('from'), metric).toBe(false);
    }
  });

  it('draws no foot for a tab the reader cannot see', () => {
    // «الحوادث ومطالبات التأمين» is not in the bar (none of its four parts: the open files, the
    // notices, the period's accidents and their list): its card keeps the fines line, no foot.
    const noAccidents = page('/fleet?tab=overview', {
      now: { ...NOW, accidentsOpen: null, notices: null },
      period: { ...MONTH, accidents: null, accidentList: null },
    });
    expect(noAccidents).not.toContain('data-dash-hub-foot="incidents"');
    expect(hubCard(noAccidents, 'incidents')).toContain('data-dash-hub-line="violations"');
    expect(hrefOf(noAccidents, 'accidents.tab')).toEqual([]);
    // «الصيانة والورش» shows through any of its four parts — the period's visits are not one of
    // them any more: without them its card keeps its lines AND its foot…
    const noVisits = page('/fleet?tab=overview', { period: { ...MONTH, visits: null } });
    expect(noVisits).toContain('data-dash-hub-foot="maintenance"');
    expect(hrefOf(noVisits, 'workshop.tab')).toHaveLength(2);
    // …and with none of the four it is not in the bar, and nothing on the overview opens it.
    const none = page('/fleet?tab=overview', {
      now: { ...NOW, workshop: null, maintenanceAlarm: null, dealershipPending: null },
      period: { ...MONTH, exits: null },
    });
    expect(none).not.toContain('data-dash-hub="maintenance"');
    expect(links(none).filter((l) => parse(l.href).params.get('tab') === 'maintenance')).toEqual(
      [],
    );
  });

  it('«حوادث الشهر» opens the accidents tab; «مخالفات قائمة N مخالفة» the violations tab', () => {
    expect(text(hubLine(html, 'accidents'))).toContain('4 حوادث');
    // The figure is the month read's (no page filter): its tab opens on that slice — «هذا الشهر»,
    // no type, operation or codes — so the accidents tab shows the same number.
    expect(hrefOf(hubLine(html, 'accidents'), 'accidents.month')).toEqual([
      '/fleet?tab=accidents&period=thisMonth',
    ]);
    const violations = hubLine(html, 'violations');
    expect(text(violations)).toContain(ar('fleet.dash.overview.hub.incidents.violations'));
    expect(text(violations)).toContain('48 مخالفة');
    // Every year's fines still owed: the tab «المخالفات المرورية والتسويات», whose «إجمالي المخالفات
    // القائمة» is this number (no period of its own: the «الآن» band reads none).
    expect(hrefOf(violations, 'violationsOpen.tab')).toEqual(['/fleet?tab=violations']);
    expect(hrefOf(violations, 'violationsOpen.total')).toEqual([]);
  });

  it('«مصروف الوقود» is the month’s fuel receipts, opening the fuel tab on the month; no km average', () => {
    const fuel = hubLine(html, 'fuelSpend');
    expect(text(fuel)).toContain('8,200.00');
    // The figure is the month read's (no page filter): the fuel tab opens on that slice, where
    // «الوقود كله» is the same number; the card's foot opens the tab with the page's filters.
    expect(hrefOf(fuel, 'opex.fuel.month')).toEqual(['/fleet?tab=fuel&period=thisMonth']);
    expect(hrefOf(fuel, 'opex.fuel')).toEqual([]);
    expect(hubCard(html, 'fuel').match(/data-dash-hub-line=/gu)).toHaveLength(1);
    const filtered = page(`/fleet?tab=overview&period=last30&type=${T1}`);
    expect(hrefOf(hubLine(filtered, 'fuelSpend'), 'opex.fuel.month')).toEqual([
      '/fleet?tab=fuel&period=thisMonth',
    ]);
    expect(hrefOf(filtered, 'opex.tab')).toEqual([`/fleet?tab=fuel&period=last30&type=${T1}`]);
  });

  it('the company (and «كل فروعي») sees the branches and the largest; one branch its cars and largest type', () => {
    expect(text(hubLine(html, 'branches'))).toContain('2 فروع');
    expect(text(hubLine(html, 'biggestBranch'))).toContain('القاهرة');
    expect(text(hubLine(html, 'biggestBranch'))).toContain('25 سيارة');
    const several = page('/fleet?tab=overview', {
      now: { ...NOW, scopeBranches: [CAIRO_BRANCH, GIZA_BRANCH] },
    });
    expect(several).toContain('data-dash-hub-line="branches"');
    const one = page('/fleet?tab=overview', {
      now: { ...NOW, branchId: B1, scopeBranches: [CAIRO_BRANCH] },
    });
    expect(one).not.toContain('data-dash-hub-line="branches"');
    expect(text(hubLine(one, 'branchActive'))).toContain('40');
    expect(text(hubLine(one, 'biggestType'))).toContain('أكبر نوع: مصفحة');
    expect(text(hubLine(one, 'biggestType'))).toContain('24 سيارة');
  });

  it('the in-workshop and red-alarm figures open «الصيانة والورش», whose «الآن» band shows both', () => {
    expect(hrefOf(hubLine(html, 'workshop'), 'workshop.tab')).toEqual(['/fleet?tab=maintenance']);
    expect(hrefOf(hubLine(html, 'alarm'), 'maintenanceAlarm.tab')).toEqual([
      '/fleet?tab=maintenance',
    ]);
    expect(hrefOf(hubLine(html, 'alarm'), 'maintenanceAlarm.red')).toEqual([]);
    const [foot = ''] = hrefOf(
      part(html, 'data-dash-hub-foot="maintenance"', /<\/div>/u),
      'workshop.tab',
    );
    expect(foot).toBe('/fleet?tab=maintenance');
    // Under a branch whose red cars are over the screens' cap the line still opens the tab (the
    // alarms board needed the codes; the tab is narrowed by the server).
    const branched = page('/fleet?tab=overview', {
      now: {
        ...NOW,
        branchId: B1,
        scopeBranches: [CAIRO_BRANCH],
        maintenanceAlarm: {
          ...need(NOW.maintenanceAlarm),
          red: 60,
          codes: { red: [], yellow: [] },
        },
      },
    });
    expect(hrefOf(hubLine(branched, 'alarm'), 'maintenanceAlarm.tab')).toEqual([
      '/fleet?tab=maintenance',
    ]);
    // The action centre's «فتح» stays on the lists (owner: «خلي الزراير كلها فتح»).
    expect(hrefOf(row(html, 'maintenanceRed'), 'maintenanceAlarm.red')).toEqual([
      '/fleet/maintenance-alarms?level=red',
    ]);
  });
});

// ── (c, j) The month card ──────────────────────────────────────────────────────────────────────

describe('«نظرة عامة» — «ملخص إحصائيات هذا الشهر»', () => {
  const html = page();

  it('names the month, Arabic month and Latin year', () => {
    expect(html).toContain('data-dash-month="2026-11"');
    expect(text(part(html, 'data-dash-month="2026-11"', /<\/span>/u))).toContain('نوفمبر');
    expect(text(html)).toContain('2026');
  });

  it('opens each figure’s register over the month read’s own range — visits by EXIT day', () => {
    expect(hrefOf(monthStat(html, 'km'), 'km.total')).toEqual([
      `/fleet/odometer?from=${TODAY}&to=${TODAY}`,
    ]);
    expect(text(monthStat(html, 'km'))).toContain('4,896');
    expect(hrefOf(monthStat(html, 'opex'), 'opex.total')).toEqual([
      `/fleet/receipts?from=${TODAY}&to=${TODAY}`,
    ]);
    const [exits = ''] = hrefOf(monthStat(html, 'visits'), 'exits.count');
    expect(parse(exits).pathname).toBe('/fleet/maintenance');
    expect(parse(exits).params.get('outFrom')).toBe(TODAY);
    expect(parse(exits).params.get('outTo')).toBe(TODAY);
    expect(parse(exits).params.has('from')).toBe(false);
    expect(text(monthStat(html, 'visits'))).toContain('21 زيارة');
    expect(text(monthStat(html, 'visits'))).toContain(ar('fleet.dash.overview.month.visitsBasis'));
    expect(hrefOf(monthStat(html, 'accidents'), 'accidents.count')).toEqual([
      `/fleet/accidents?from=${TODAY}&to=${TODAY}`,
    ]);
    expect(text(monthStat(html, 'accidents'))).toContain('4 حوادث');
  });

  it('says when the spend data starts later than the month', () => {
    const late = page('/fleet?tab=overview', {
      period: { ...MONTH, opex: { ...need(MONTH.opex), dataFrom: '2026-11-05' } },
    });
    expect(monthStat(late, 'opex')).toContain('data-data-from="2026-11-05"');
    expect(monthStat(html, 'opex')).not.toContain('data-data-from');
  });

  it('is «هذا الشهر» whatever period, type or codes the page holds', () => {
    const url = `/fleet?tab=overview&period=lastMonth&type=${T1}`;
    const query = toPeriodQuery(readPeriodFilters(new URLSearchParams(url.split('?')[1])));
    const pageKey = fleetDashboardKeys.period(periodLiveness(query, TODAY), query);
    expect(pageKey).not.toEqual(PERIOD_KEY);
    const client = dashboardClient({ now: NOW, period: MONTH });
    client.setQueryData(pageKey, {
      ...MONTH,
      km: { ...need(MONTH.km), total: 9999 },
      accidents: { count: 77, open: 0, openRemaining: 0, undated: 0 },
      exits: { ...need(MONTH.exits), count: 55 },
    });
    const filtered = renderDashboard({ url, client });
    expect(text(monthStat(filtered, 'km'))).toContain('4,896');
    expect(text(monthStat(filtered, 'km'))).not.toContain('9,999');
    expect(text(monthStat(filtered, 'visits'))).toContain('21');
    expect(text(hubLine(filtered, 'accidents'))).toContain('4 حوادث');
    for (const href of hrefOf(filtered, 'km.total'))
      expect(parse(href).params.has('type')).toBe(false);
    // …and the tab its hub line opens is that month too: never the page's last month, never T1.
    expect(hrefOf(hubLine(filtered, 'accidents'), 'accidents.month')).toEqual([
      '/fleet?tab=accidents&period=thisMonth',
    ]);
    // The card foot carries no figure: it keeps the page's filters, as every tab link does.
    const [foot = ''] = hrefOf(
      part(filtered, 'data-dash-hub-foot="incidents"', /<\/div>/u),
      'accidents.tab',
    );
    expect(parse(foot).params.get('period')).toBe('lastMonth');
    expect(parse(foot).params.get('type')).toBe(T1);
  });

  it('is never asked by a reader without a period key; on its way it is its own skeleton', () => {
    const keys = ALL_KEYS.filter((k) => !FLEET_DASHBOARD_PERIOD_KEYS.includes(k));
    const noPeriod = page('/fleet?tab=overview', { period: null }, keys);
    expect(noPeriod).not.toContain('data-dash-block="month"');
    expect(noPeriod).not.toContain('data-dash-month-loading');
    const waiting = page('/fleet?tab=overview', { period: null });
    expect(waiting).toContain('data-dash-month-loading="true"');
    expect(waiting).toContain('data-dash-block="actions"');
  });

  it('the month’s hub lines keep their place as «—» while the month read is on its way or failed', () => {
    for (const month of [
      { ...MONTH_READ, data: undefined, loading: true },
      { ...MONTH_READ, data: undefined, failed: true },
    ]) {
      const html = tab({ month });
      expect(hubLine(html, 'accidents')).toContain('data-dash-hub-pending="true"');
      expect(hubLine(html, 'fuelSpend')).toContain('data-dash-hub-pending="true"');
      // The fuel card, whose only line is the month's, is still drawn: the hub keeps 2 × 3.
      expect(html.match(/data-dash-hub="/gu)).toHaveLength(6);
    }
    const one = tab({
      month: { ...MONTH_READ, data: { ...MONTH, unavailable: ['opex'], opex: null } },
    });
    expect(hubLine(one, 'fuelSpend')).toContain('data-dash-hub-pending="true"');
    expect(hubLine(one, 'accidents')).not.toContain('data-dash-hub-pending');
    // Not asked (no period key): no line at all, and no fuel card.
    const off = tab({ month: { ...MONTH_READ, data: undefined, enabled: false } });
    expect(off).not.toContain('data-dash-hub-line="accidents"');
    expect(off).not.toContain('data-dash-hub="fuel"');
  });

  it('a failed month read says so with its retry; a read not asked draws nothing', () => {
    const failed = tab({ month: { ...MONTH_READ, data: undefined, failed: true } });
    expect(failed).toContain('data-section-error="month"');
    expect(failed).toContain(ar('fleet.dash.common.retry'));
    const off = tab({ month: { ...MONTH_READ, data: undefined, enabled: false } });
    expect(off).not.toContain('data-dash-block="month"');
    expect(off).not.toContain('data-section-error="month"');
    const one = tab({
      month: { ...MONTH_READ, data: { ...MONTH, unavailable: ['km'], km: null } },
    });
    expect(one).toContain('data-section-error="km"');
    expect(one).toContain('data-dash-month-stat="opex"');
  });
});

// ── R1 on its way or failed: only R1's parts wait (the page gates the other R1 tabs on R1) ─────

describe('«نظرة عامة» — R1 on its way or failed costs only R1’s parts', () => {
  /** R1 FAILED — the cache as a rejected request leaves it — beside a month read that answered. */
  const r1Failed = (): QueryClient => {
    const client = dashboardClient({ now: null, period: MONTH });
    client.setQueryDefaults(fleetDashboardKeys.now, { retryOnMount: false });
    const query = client.getQueryCache().build(client, { queryKey: fleetDashboardKeys.now });
    query.setState({
      ...query.state,
      status: 'error',
      error: new Error('R1 down'),
      errorUpdatedAt: 1,
      fetchStatus: 'idle',
    });
    return client;
  };
  const ids = (html: string, attr: string): string[] =>
    [...html.matchAll(new RegExp(`${attr}="(\\w+)"`, 'gu'))].map((m) => m[1] ?? '');

  it('R1 failed: its error and retry in its place; the month card, its hub lines and custody stay', () => {
    const html = renderDashboard({ url: '/fleet?tab=overview', client: r1Failed() });
    expect(html).toContain('data-dash-read-error="true"');
    expect(html).toContain('data-dash-block="month"');
    expect(ids(html, 'data-dash-month-stat')).toEqual(['km', 'opex', 'visits', 'accidents']);
    expect(text(monthStat(html, 'km'))).toContain('4,896');
    // The hub's month lines are the month read's: still there, still linked.
    expect(text(hubLine(html, 'accidents'))).toContain('4 حوادث');
    expect(text(hubLine(html, 'fuelSpend'))).toContain('8,200.00');
    // The custody card and line are the custody screen's reads.
    expect(ids(html, 'data-dash-kpi')).toEqual(['custody']);
    expect(ids(html, 'data-dash-action')).toEqual(['custody']);
    // Never the all-clear over the R1 lines nobody could read.
    expect(html).not.toContain('data-dash-actions-none');
  });

  it('R1 on its way: its cards in grey beside the custody card, and the month card answers', () => {
    const html = renderDashboard({
      url: '/fleet?tab=overview',
      client: dashboardClient({ now: null, period: MONTH }),
    });
    expect(html).not.toContain('data-dash-read-error');
    expect(ids(html, 'data-dash-kpi-loading')).toEqual([
      'readiness',
      'unmanned',
      'workshop',
      'urgent',
      'fuel',
    ]);
    expect(ids(html, 'data-dash-kpi')).toEqual(['custody']);
    expect(html).toContain('data-dash-actions-loading="true"');
    expect(html).not.toContain('data-dash-actions-none');
    expect(ids(html, 'data-dash-month-stat')).toEqual(['km', 'opex', 'visits', 'accidents']);
  });

  it('every other R1 tab is still the one error (or skeleton) of its read', () => {
    const html = renderDashboard({ url: '/fleet?tab=today', client: r1Failed() });
    expect(html).toContain('data-dash-read-error="true"');
    expect(html).not.toContain('data-today-card=');
  });
});

// ── (f, g, h, i) Who sees what, and what is never drawn ───────────────────────────────────────

describe('«نظرة عامة» — scope, readers and the ruled-out words', () => {
  it('opens the notices of the figures’ branch: the line and its cheque figure carry it', () => {
    const one = row(
      page('/fleet?tab=overview', { now: { ...NOW, branchId: B1 } }),
      'noticesMissing',
    );
    expect(one).not.toContain('data-company-wide');
    expect(hrefOf(one, 'notices.missingAny')).toEqual([`/fleet/notices?status=open&branch=${B1}`]);
    expect(hrefOf(one, 'notices.missingCheckImage')).toEqual([
      `/fleet/notices?status=open&checkImage=missing&branch=${B1}`,
    ]);
    const several = row(
      page('/fleet?tab=overview', { now: { ...NOW, scopeBranches: [CAIRO_BRANCH, GIZA_BRANCH] } }),
      'noticesMissing',
    );
    expect(hrefOf(several, 'notices.missingAny')).toEqual([
      `/fleet/notices?status=open&branch=${B1},${GIZA_BRANCH.id}`,
    ]);
  });

  it('has no count on its own pill', () => {
    expect(page()).not.toContain('data-dash-badge="overview"');
  });

  it('wears «الشركة كلها» on the company-wide figures only while the rest are narrowed', () => {
    expect(page()).not.toContain('data-company-wide');
    const several = page('/fleet?tab=overview', {
      now: { ...NOW, scopeBranches: [CAIRO_BRANCH, GIZA_BRANCH] },
    });
    expect(row(several, 'custody')).toContain('data-company-wide="true"');
    // The notices and the fuel cards follow the car's branch (the server narrows them): no tag on
    // their lines, and their «فتح» carries the figures' branches.
    for (const id of [
      'fuelCardExpired',
      'fuelRequests',
      'fuelLow',
      'maintenanceRed',
      'vehicleLicenceExpired',
      'driverLicenceExpired',
      'crewAbsent',
      'dealershipPending',
      'noticesMissing',
      'noReading',
    ]) {
      expect(row(several, id), id).not.toContain('data-company-wide');
    }
    expect(kpi(several, 'custody')).toContain('data-company-wide="true"');
    for (const id of ['fuel', 'readiness', 'unmanned', 'workshop', 'urgent']) {
      expect(kpi(several, id), id).not.toContain('data-company-wide');
    }
  });

  it('opens the fuel cards and top-ups of the figures’ branches: the lines and the balances carry them', () => {
    const several = page('/fleet?tab=overview', {
      now: { ...NOW, scopeBranches: [CAIRO_BRANCH, GIZA_BRANCH] },
    });
    const branches = `${B1},${GIZA_BRANCH.id}`;
    expect(hrefOf(row(several, 'fuelCardExpired'), 'fuelCards.expired')).toEqual([
      `/fleet/fuel-cards?expiresBefore=${TODAY}&branch=${branches}`,
    ]);
    expect(hrefOf(row(several, 'fuelRequests'), 'fuelCharging.requested')).toEqual([
      `/fleet/fuel-cards/charging?state=requested&branch=${branches}`,
    ]);
    expect(hrefOf(row(several, 'fuelLow'), 'fuelCharging.low')).toEqual([
      `/fleet/fuel-cards/charging?state=low&branch=${branches}`,
    ]);
    expect(hrefOf(kpi(several, 'fuel'), 'fuelCharging.wataniya')).toEqual([
      `/fleet/fuel-cards/charging?company=wataniya&branch=${branches}`,
    ]);
    // The company view: no branch at all.
    expect(hrefOf(row(page(), 'fuelLow'), 'fuelCharging.low')).toEqual([
      '/fleet/fuel-cards/charging?state=low',
    ]);
  });

  it('shows the custody-only reader the custody card and line alone, and asks neither read', () => {
    const html = renderDashboard({
      url: '/fleet?tab=overview',
      permissions: ['fleetCustody.view'],
      client: dashboardClient({ now: null, period: null }),
    });
    expect(html).toContain('data-dash-tab-body="overview"');
    expect([...html.matchAll(/data-dash-kpi="(\w+)"/gu)].map((m) => m[1])).toEqual(['custody']);
    expect([...html.matchAll(/data-dash-action="(\w+)"/gu)].map((m) => m[1])).toEqual(['custody']);
    expect(html).not.toContain('data-dash-block="hub"');
    expect(html).not.toContain('data-dash-block="month"');
    expect(html).not.toContain('data-dash-loading');
    expect(html).not.toContain('data-dash-month-loading');
  });

  it('draws none of the words the owner ruled out (no data in the system)', () => {
    const body = text(page());
    for (const word of [
      'أمر حركة',
      'محظور',
      'إصابات',
      'ج.م/كم',
      'وفر',
      'الموازنة',
      'مصفحة',
      'ساعة',
      'عهدة عينية',
      'المتوسط',
    ]) {
      expect(body, word).not.toContain(word);
    }
  });
});
