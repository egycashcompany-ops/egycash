// «لوحة تحكم الحركة» — the LINK CENSUS (plan R-28, §8.11; unified.md HUB).
//
// A figure on the dashboard opens the screen that shows the same number. The server half of that
// promise is A-DASH's parity spec (every figure = its screen's endpoint called with the link's
// parameters). This is the browser half: render all eleven tabs from the fixtures — the company, a
// chosen branch, a reader of several branches («كل فروعي»), and period filters that narrow by type,
// operation, codes and branch («أرقام الفترة» and the period parts of the five mixed panels) — collect
// EVERY figure link the page draws (the overview's links to other tabs of the page included), and
// hold each to the screen it opens:
//   · its path is a route of the fleet module, and the page that route mounts is known;
//   · every query parameter it carries is one that page READS from its URL — a parameter the
//     target ignores would open a wider list than the figure counts, silently;
//   · it is never a bare list link (a bare URL restores the reader's remembered filters, CR-11);
//   · it names its figure, `<section>.<field>`, after a gated section.
// It also keeps the pins of the retired old-page spec that no other spec carries (the whole page
// counts nothing in the browser; an empty matrix cell is a dash, never a zero; an empty «آخر ما
// سُجّل» says so in words).
//
// Named exceptions of the two new tabs (a figure no list shows exactly is plain, plan D16): on
// «المخالفات المرورية والتسويات» every COUNT of the «الآن» cards (the register sums amounts),
// «سائقون معروفون», «اسم غير مربوط», the sentences on cars the registry never had, the owed AMOUNT,
// the collected amount and share, a type's amount; on «الوقود والمصروفات» every figure of the sheet
// card, the «أول 8» sentence, the litres and the unpriced line, the dealership's pending AMOUNT and
// the day columns. «شُحن اليوم» opens `state=charged` (the screen's own «شُحن اليوم»), and the
// drivers' period fines travel as `dfrom` / `dto` / `dcodes` (the register's drivers' half).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_PERIOD_TABS,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_READS,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardPeriodDto,
} from '@ecms/contracts';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  OP_CASH,
  T1,
  T2,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { PERIOD_FULL, PERIOD_YEAR, renderPeriod } from './fleet-dashboard-period-fixtures';
import {
  PATH_ONLY,
  nowLinks,
  periodLinks,
  tabLink,
  type DashLink,
} from './lib/fleet-dashboard-links';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

// ── The routes and the page each mounts ─────────────────────────────────────────────────────────

const ROUTES = read('routes.tsx');

/** `ComponentName` → its file under this module, from the route file's own imports. */
const IMPORTS = new Map(
  [...ROUTES.matchAll(/import \{ (\w+) \} from '\.\/((?:pages|components)\/\w+)';/gu)].map((m) => [
    m[1] as string,
    `${m[2] as string}.tsx`,
  ]),
);

/** Every routed path (`/fleet/<path>`, `:param` as a wildcard) with the page it mounts. */
const ROUTED: { pattern: RegExp; path: string; page: string }[] = ROUTES.split('<Route')
  .slice(1)
  .flatMap((chunk) => {
    const element = /<(\w+(?:Page|Entry))\b/u.exec(chunk)?.[1];
    if (element === undefined) return [];
    const file = IMPORTS.get(element);
    if (file === undefined) return [];
    const path = /\bpath="([^"]+)"/u.exec(chunk)?.[1];
    if (path === '*') return [];
    if (path === undefined) {
      // The index route: `/fleet` itself (the dashboard).
      return /\bindex\b/u.test(chunk) ? [{ pattern: /^\/fleet$/u, path: '', page: file }] : [];
    }
    const re = path.replace(/:[a-zA-Z]+\??/gu, '[^/?]+');
    return [{ pattern: new RegExp(`^/fleet/${re}$`, 'u'), path, page: file }];
  });

const pageOf = (pathname: string): string | undefined =>
  ROUTED.find((route) => route.pattern.test(pathname))?.page;

/**
 * The params a page reads from its URL: in its own source, and in the module's own helpers it
 * imports (`../lib/*`, `../components/*`) — some pages read their range or their vehicle set
 * through one. Only the forms that READ count: `X.get('p')`, `readList(sp, 'p')`.
 */
const paramsReadBy = (pageFile: string): Set<string> => {
  const own = read(pageFile);
  const helpers = [...own.matchAll(/from '\.\.\/((?:lib|components)\/[\w-]+)'/gu)].flatMap((m) => {
    for (const ext of ['.ts', '.tsx']) {
      try {
        return [read(`${m[1] as string}${ext}`)];
      } catch {
        /* the other extension */
      }
    }
    return [];
  });
  const found = new Set<string>();
  for (const src of [own, ...helpers]) {
    for (const m of src.matchAll(/\.get\('([^']+)'\)/gu)) found.add(m[1] as string);
    for (const m of src.matchAll(/readList\(\s*\w+\s*,\s*'([^']+)'/gu)) found.add(m[1] as string);
  }
  return found;
};

// ── Every link the page draws ───────────────────────────────────────────────────────────────────

interface Anchor {
  href: string;
  metric: string;
}

const unescape = (s: string): string =>
  s
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");

const anchors = (html: string): Anchor[] =>
  [...html.matchAll(/<a\b([^>]*)>/gu)].map((m) => {
    const attrs = m[1] ?? '';
    return {
      href: unescape(/href="([^"]*)"/u.exec(attrs)?.[1] ?? ''),
      metric: /data-metric="([^"]*)"/u.exec(attrs)?.[1] ?? '',
    };
  });

/**
 * The tabs drawn over R1 — «توزيع السيارات» and «الصيانة والورش» among them (the month read of the
 * overview and of «توزيع السيارات» is R2 «هذا الشهر», seeded under its own key).
 */
const NOW_TABS = FLEET_DASHBOARD_TABS.filter((tab) =>
  FLEET_DASHBOARD_TAB_READS[tab].includes('now'),
);
/**
 * The tabs drawn over the PAGE's R2: «أرقام الفترة» under the filter bar, and the five mixed
 * panels («الصيانة والورش», «العدادات والكيلومترات», «الحوادث ومطالبات التأمين», «المخالفات المرورية
 * والتسويات», «الوقود والمصروفات»).
 */
const PAGE_PERIOD_TABS = FLEET_DASHBOARD_TABS.filter((tab) =>
  FLEET_DASHBOARD_TAB_READS[tab].includes('period'),
);

const CAIRO = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

const NOTICES = NOW_DTO.notices as NonNullable<typeof NOW_DTO.notices>;
/** The notices of the branch's cars: a notice with no car is the whole company's alone. */
const NOTICES_NARROWED: typeof NOTICES = {
  open: 3,
  missingAny: 2,
  missingLicences: 1,
  missingCheckImage: 2,
  rows: NOTICES.rows.filter((row) => row.code !== null),
};

const FUEL_CHARGING = NOW_DTO.fuelCharging as NonNullable<typeof NOW_DTO.fuelCharging>;
const FUEL_CARDS = NOW_DTO.fuelCardList as NonNullable<typeof NOW_DTO.fuelCardList>;
const VIOLATIONS_OPEN = NOW_DTO.violationsOpen as NonNullable<typeof NOW_DTO.violationsOpen>;
/**
 * The parts a narrowed R1 leaves out (plan D7, D10): no card on no car (it is in no branch), and no
 * line about the cars the registry never had — the company view's alone.
 */
const NARROWED_PARTS = {
  fuelCharging: { ...FUEL_CHARGING, unassigned: null },
  fuelCardList: {
    rows: FUEL_CARDS.rows.filter((row) => row.vehicleId !== null),
    total: FUEL_CARDS.total - 1,
  },
  violationsOpen: { ...VIOLATIONS_OPEN, bookOnly: null },
};

/** R1 with a branch chosen, and the alarm / no-reading codes the branch narrows to (D19). */
const NOW_BRANCH = {
  ...NOW_DTO,
  branchId: B1,
  scopeBranches: [CAIRO],
  maintenanceAlarm: {
    ...(NOW_DTO.maintenanceAlarm as NonNullable<typeof NOW_DTO.maintenanceAlarm>),
    codes: { red: ['133'], yellow: ['133', '141'] },
  },
  notices: NOTICES_NARROWED,
  ...NARROWED_PARTS,
};

/** R2 narrowed by every filter the bar offers, and by the branch. */
const SET = `&type=${T1},${T2}&operation=${OP_CASH}&vehicleCodes=133,141`;
const NARROWED: FleetDashboardPeriodDto = {
  ...PERIOD_FULL,
  vehicleScope: {
    count: 2,
    typeIds: [T1, T2],
    operationIds: [OP_CASH],
    vehicleCodes: ['133', '141'],
    branchId: B1,
    scopeBranches: [CAIRO],
  },
};

/** «كل فروعي»: a reader of two branches, no switcher — the figures cover B1 and B2 (plan D9/D12). */
const NOW_MINE = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: [CAIRO, GIZA],
  maintenanceAlarm: {
    ...(NOW_DTO.maintenanceAlarm as NonNullable<typeof NOW_DTO.maintenanceAlarm>),
    codes: { red: ['133'], yellow: ['133', '141'] },
  },
  notices: NOTICES_NARROWED,
  ...NARROWED_PARTS,
};
const PERIOD_MINE: FleetDashboardPeriodDto = {
  ...PERIOD_FULL,
  vehicleScope: { ...PERIOD_FULL.vehicleScope, count: 39, scopeBranches: [CAIRO, GIZA] },
};
/** The overview opened under page filters: its links to other tabs carry them as they stand. */
const PAGE_FILTERS = `&period=last30&type=${T1}&operation=${OP_CASH}&vehicleCodes=133`;

const rendered = (): Anchor[] => {
  const pages: string[] = [];
  for (const tab of NOW_TABS) {
    pages.push(renderDashboard({ url: `/fleet?tab=${tab}` }));
    pages.push(
      renderDashboard({
        url: `/fleet?tab=${tab}`,
        client: dashboardClient({ now: NOW_BRANCH }),
      }),
    );
    pages.push(
      renderDashboard({
        url: `/fleet?tab=${tab}`,
        client: dashboardClient({ now: NOW_MINE }),
      }),
    );
  }
  pages.push(renderDashboard({ url: `/fleet?tab=overview${PAGE_FILTERS}` }));
  // «توزيع السيارات» for a reader of the supply contracts (a part of the tab, not a page key).
  pages.push(
    renderDashboard({
      url: '/fleet?tab=distribution',
      permissions: [...ALL_KEYS, 'fleetVehicleContract.view'],
    }),
  );
  // The five mixed panels under a narrowed page R2, with the switcher's branch on R1 too.
  for (const tab of ['maintenance', 'km', 'accidents', 'violations', 'fuel']) {
    const narrowedUrl = `/fleet?tab=${tab}&period=last30${SET}`;
    pages.push(
      renderDashboard({
        url: narrowedUrl,
        client: dashboardClient({ now: NOW_BRANCH, page: { url: narrowedUrl, dto: NARROWED } }),
      }),
    );
  }
  for (const tab of PAGE_PERIOD_TABS) {
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=last30` }));
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=thisYear`, dto: PERIOD_YEAR }));
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=last30${SET}`, dto: NARROWED }));
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=last30`, dto: PERIOD_MINE }));
    // A reader without the custody screen: D20's fallback for the custody part.
    pages.push(
      renderPeriod({
        url: `/fleet?tab=${tab}&period=last30`,
        permissions: ALL_KEYS.filter((k) => k !== 'fleetCustody.view'),
      }),
    );
  }
  return pages.flatMap(anchors).filter((a) => a.metric !== '');
};

const ALARM: FleetDashboardNowAlarmDto = NOW_DTO.maintenanceAlarm as FleetDashboardNowAlarmDto;
const ALARM_COMPANY = ALARM;
const ALARM_NARROWED = { ...ALARM, codes: { red: ['133'], yellow: ['141'] } };
/** A branch whose red cars are over the screens' cap: that level comes back `[]`. */
const ALARM_OVER_CAP = { ...ALARM, red: 60, codes: { red: [], yellow: ['141'] } };

/** Links the fixtures may not draw: the builder's other arguments, called directly. */
const built = (): Anchor[] => {
  const asAnchor = (link: DashLink | null): Anchor[] =>
    link === null ? [] : [{ href: link.to, metric: link.metric }];
  const all: (DashLink | null)[] = [];
  for (const L of [
    nowLinks({ today: TODAY, branchId: null, scopeBranches: null }),
    nowLinks({ today: TODAY, branchId: B1, scopeBranches: [CAIRO] }),
    nowLinks({ today: TODAY, branchId: null, scopeBranches: [CAIRO, GIZA] }),
  ]) {
    all.push(
      L.rosterCar('133'),
      L.rosterAbsentAll(),
      L.rosterUnavailableAll(),
      L.violationsOpen(),
      L.alarm('red', null),
      L.alarm('yellow', ['133', '141']),
      L.alarmRow('red', '133'),
      L.alarmRow('yellow', '141'),
      L.alarmsAll(ALARM_COMPANY),
      L.alarmsAll(ALARM_NARROWED),
      L.alarmsAll(ALARM_OVER_CAP),
      L.workshopCar('141'),
      L.supplyContracts('supplyContracts.open'),
      L.supplyContracts('supplyContracts.red', 'red'),
      L.supplyContracts('supplyContracts.yellow', 'yellow'),
      L.noReading(['133']),
      L.neverRead(['141']),
      L.visitDay('231', TODAY, true),
      L.visitDay('231', TODAY, false),
      L.driverLicencesNotRecorded(),
      L.fuelCardsExpiring(30),
      L.violationsUnknown(2026),
      L.rosterAbsent('hrLeave'),
      L.attendance(),
      L.noticesOpenAll(),
      L.noticesOpenAll('notices.all'),
      L.noticeRow({ code: '133', number: '24117', date: '2026-10-21' }),
      L.noticeRow({ code: null, number: '7001', date: null }),
      L.noticeRow({ code: null, number: null, date: '2026-10-31' }),
      L.accidentsOpenAll(),
      L.noReadingCar('133'),
      L.violationsOpenCompany(),
      L.violationsOpenDrivers('violationsOpen.driversAll'),
      L.violationsOpenUnknown(),
      L.violationsOpen('violationsOpen.totalAll'),
      L.chargingStates(['requested', 'low']),
      L.fuelCardsDue(30),
      L.fuelCardsExpired(),
      L.charging('charged'),
      L.reconcile('fuelSheets.reconcile'),
      // «فتح» on a card: led by an expiry, by a balance, on no car, on a deleted car (D17).
      ...FUEL_CARDS.rows.map((row) => L.fuelCardRow(row)),
      L.fuelCardRow({
        ...(FUEL_CARDS.rows[0] as (typeof FUEL_CARDS.rows)[number]),
        vehicleDeleted: true,
      }),
    );
  }
  const sp = new URLSearchParams(`tab=overview${PAGE_FILTERS}`);
  for (const tab of FLEET_DASHBOARD_TABS) all.push(tabLink(tab, 'vehicles.tab', sp, [tab]));
  for (const vehicleScope of [
    PERIOD_FULL.vehicleScope,
    NARROWED.vehicleScope,
    PERIOD_MINE.vehicleScope,
  ]) {
    const P = periodLinks({ range: { from: '2026-10-03', to: TODAY }, vehicleScope });
    all.push(
      P.exits(),
      P.opexFuel(),
      P.opexCustody(),
      P.opex('opex.custody', 'custody'),
      P.dealership('dealership.pending', 'pending'),
      P.visits('visits.closed', { state: 'closed' }),
      P.exits('exits.byWorkType', { workTypes: ['w1'] }),
      P.exits('exits.byWorkshop', { workshops: ['s1'] }),
      P.exits('exits.topVehicle', { vehicleCodes: ['133'] }),
      P.accidents('accidents.open', 'open'),
      P.carKm('133', 'km.top'),
      P.carKmDay('133', '2026-10-11', 'km.invalidList.row'),
      P.kmDay('2026-10-11', 'km.invalidList.row'),
      P.vehiclesByCodes(['133', '141'], 'km.noDistance'),
      P.violations('violations.count'),
      P.violations('violations.owed', { dset: 'false' }),
      P.violations('violations.byType', { dtype: 'vt1' }),
      P.violationRow({ code: '133', date: '2026-10-12', violationTypeId: 'vt1' }),
      P.violationRow({ code: null, date: '2026-10-12', violationTypeId: 'vt1' }),
      P.opexKind('opex.card', 'fuel', 'card'),
      P.opexKind('opex.fuelCustody', 'fuel', 'custody'),
      P.opexKind('opex.tyres', 'tyres'),
      P.opexKind('opex.wash', 'wash'),
      P.opexKind('opex.maintenance', 'maintenance'),
      P.dealershipRow({ code: '221', date: '2026-10-29', workKind: 'maintenance' }),
      P.dealershipRow({ code: '263', date: '2026-10-31', workKind: 'repair' }),
      P.dealershipRow({ code: null, date: '2026-10-31', workKind: 'repair' }),
    );
  }
  return all.flatMap(asAnchor);
};

const LINKS = [...rendered(), ...built()];
const parse = (href: string): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = href.split('?');
  return { pathname, params: new URLSearchParams(search) };
};

describe('the link census — every figure link against the screen it opens', () => {
  it('collects the page’s links from all eleven tabs (the census is not empty by accident)', () => {
    expect(FLEET_DASHBOARD_TABS).toHaveLength(11);
    expect([...PAGE_PERIOD_TABS].sort()).toEqual(
      [
        ...FLEET_DASHBOARD_PERIOD_TABS,
        'maintenance',
        'km',
        'accidents',
        'violations',
        'fuel',
      ].sort(),
    );
    expect(LINKS.length).toBeGreaterThan(150);
    const metrics = new Set(LINKS.map((l) => l.metric.split('.')[0]));
    for (const section of [
      'maintenanceAlarm',
      'roster',
      'distributionVehicles',
      'km',
      'noReading',
      'visits',
      'exits',
      'workshop',
      'supplyContracts',
      'notices',
      'accidentsOpen',
      'accidents',
      'accidentList',
      'violationsOpen',
      'violations',
      'violationList',
      'fuelCards',
      'fuelCharging',
      'fuelCardList',
      'fuelSheets',
      'opex',
      'dealership',
      'dealershipList',
    ]) {
      expect(metrics.has(section), section).toBe(true);
    }
  });

  it('opens only routes of the fleet module, each mounting a known page', () => {
    const unrouted = LINKS.filter((l) => pageOf(parse(l.href).pathname) === undefined).map(
      (l) => l.href,
    );
    expect([...new Set(unrouted)]).toEqual([]);
  });

  it('carries only parameters the target page reads from its URL — none it would ignore', () => {
    const cache = new Map<string, Set<string>>();
    const ignored = new Set<string>();
    const checked = new Set<string>();
    for (const link of LINKS) {
      const { pathname, params } = parse(link.href);
      const page = pageOf(pathname);
      if (page === undefined) continue;
      const reads = cache.get(page) ?? paramsReadBy(page);
      cache.set(page, reads);
      for (const name of params.keys()) {
        checked.add(`${pathname}?${name}`);
        if (!reads.has(name)) ignored.add(`${pathname} ?${name} (${page}, ${link.metric})`);
      }
    }
    expect([...ignored].sort()).toEqual([]);
    // Not vacuous: the parameters the P1 packages taught their screens are among those checked.
    expect([...checked]).toEqual(
      expect.arrayContaining([
        '/fleet/vehicles?licExpFrom',
        '/fleet/vehicles?licExpBefore',
        '/fleet/drivers?licExp',
        '/fleet/drivers?licExpFrom',
        '/fleet/fuel-cards?expiresFrom',
        '/fleet/roster?view',
        '/fleet/roster?unavailable',
        '/fleet/maintenance?to',
        '/fleet/maintenance?type',
        '/fleet/maintenance?outFrom',
        '/fleet/maintenance?outTo',
        '/fleet/maintenance?workTypes',
        '/fleet/maintenance?workshops',
        '/fleet/maintenance?state',
        '/fleet/maintenance-alarms?level',
        '/fleet/maintenance-alarms?vehicleCodes',
        '/fleet/vehicle-contracts?from',
        '/fleet/vehicle-contracts?to',
        '/fleet/vehicle-contracts?alarm',
        '/fleet/odometer?type',
        '/fleet/odometer?operation',
        '/fleet/odometer?branch',
        '/fleet/odometer?period',
        '/fleet/odometer?vehicleCodes',
        '/fleet/odometer?from',
        '/fleet/notices?status',
        '/fleet/notices?branch',
        '/fleet/notices?checkImage',
        '/fleet/notices?vehicleCodes',
        '/fleet/notices?number',
        '/fleet/notices?from',
        '/fleet/notices?to',
        '/fleet/vehicles?vehicleCodes',
        '/fleet/accidents?type',
        '/fleet/accidents?branch',
        '/fleet/dealership?operation',
        '/fleet/dealership?state',
        '/fleet/receipts?type',
        '/fleet/receipts?source',
        '/fleet/violations?dunknown',
        '/fleet/violations?cset',
        '/fleet/violations?dset',
        '/fleet/custody-expenses?from',
        '/fleet/roster?q',
        '/fleet/receipts?kind',
        '/fleet/drivers?branch',
        '/fleet/violations?dfrom',
        '/fleet/violations?dto',
        '/fleet/violations?dcodes',
        '/fleet/violations?dtype',
        '/fleet/fuel-cards?branch',
        '/fleet/fuel-cards?number',
        '/fleet/fuel-cards?company',
        '/fleet/fuel-cards?vehicleCodes',
        '/fleet/fuel-cards/charging?branch',
        '/fleet/fuel-cards/charging?vehicleCodes',
        '/fleet/fuel-cards/charging?company',
        '/fleet/dealership?work',
        '/fleet/dealership?vehicleCodes',
        '/fleet?tab',
        '/fleet?period',
        '/fleet?type',
      ]),
    );
  });

  it('is never a bare list link — only a record or a screen that keeps no filter goes without one', () => {
    const bare = LINKS.filter((l) => !l.href.includes('?'))
      .map((l) => l.href)
      .filter((to) => !PATH_ONLY.includes(to) && !/^\/fleet\/vehicles\/[^/?]+$/u.test(to));
    expect([...new Set(bare)]).toEqual([]);
  });

  it('names every figure `<section>.<field>` after a gated section', () => {
    const sections = new Set<string>(Object.keys(FLEET_DASHBOARD_GATES));
    const strays = LINKS.filter((l) => {
      const [section, field] = l.metric.split('.');
      return field === undefined || field === '' || !sections.has(section ?? '');
    }).map((l) => l.metric);
    expect([...new Set(strays)]).toEqual([]);
  });

  it('carries the whole period filter set on a narrowed period link: type, operation, branch, codes', () => {
    const period = (metric: string): boolean =>
      FLEET_DASHBOARD_GATES[metric.split('.')[0] as keyof typeof FLEET_DASHBOARD_GATES]?.read ===
      'period';
    // km.byType / km.byBranch put the row's own type / branch in place of the echo's (W-PERIOD); a
    // link to another tab (`*.tab`) carries the page's own params, not the echo (plan D15).
    const narrowed = LINKS.filter(
      (l) =>
        period(l.metric) &&
        l.href.includes(`operation=${OP_CASH}`) &&
        !['km.byType', 'km.byBranch'].includes(l.metric) &&
        !l.metric.endsWith('.tab'),
    );
    expect(narrowed.length).toBeGreaterThan(10);
    for (const link of narrowed) {
      const { params } = parse(link.href);
      expect(params.get('type'), link.href).toBe(`${T1},${T2}`);
      expect(params.get('operation'), link.href).toBe(OP_CASH);
      expect(params.get('branch'), link.href).toBe(B1);
    }
  });
});

describe('the two rebuilt tabs’ own reads (plan D3, D4, D7)', () => {
  it('«توزيع السيارات»: its km links read «هذا الشهر» alone — never a page filter', () => {
    const url = `/fleet?tab=distribution${PAGE_FILTERS}`;
    const html = renderDashboard({
      url,
      client: dashboardClient({ page: { url, dto: NARROWED } }),
    });
    const km = anchors(html).filter((a) => a.metric.startsWith('km.'));
    expect(km.length).toBeGreaterThan(0);
    for (const link of km) {
      const { pathname, params } = parse(link.href);
      expect(pathname, link.metric).toBe('/fleet/odometer');
      expect(params.get('from'), link.metric).toBe(TODAY);
      expect(params.get('to'), link.metric).toBe(TODAY);
      for (const name of ['type', 'operation', 'vehicleCodes', 'period'])
        expect(params.has(name), `${link.metric} ${name}`).toBe(false);
    }
  });

  it('«الصيانة والورش»: every period link is by EXIT day and carries the page’s whole set', () => {
    const exits = LINKS.filter(
      (l) => l.metric.startsWith('exits.') && l.href.includes(`operation=${OP_CASH}`),
    );
    expect(new Set(exits.map((l) => l.metric))).toEqual(
      new Set(['exits.count', 'exits.byWorkType', 'exits.byWorkshop', 'exits.topVehicle']),
    );
    for (const link of exits) {
      const { params } = parse(link.href);
      expect(params.has('from'), link.href).toBe(false);
      expect(params.has('to'), link.href).toBe(false);
      expect(params.get('outFrom'), link.href).toBe('2026-10-03');
      expect(params.get('outTo'), link.href).toBe(TODAY);
      // A ranked car's code replaces the set's codes; every other link keeps the set's.
      if (link.metric !== 'exits.topVehicle') {
        expect(params.get('vehicleCodes'), link.href).toBe('133,141');
      }
    }
  });

  it('«الصيانة والورش»: the «الآن» rows open the alarms board on their car, the workshop on its visit', () => {
    const rows = LINKS.filter((l) => l.metric === 'maintenanceAlarm.row');
    expect(rows.length).toBeGreaterThan(0);
    for (const link of rows) {
      const { pathname, params } = parse(link.href);
      expect(pathname).toBe('/fleet/maintenance-alarms');
      expect(['red', 'yellow']).toContain(params.get('level'));
      expect(params.get('vehicleCodes')?.split(',')).toHaveLength(1);
    }
    const stays = LINKS.filter((l) => l.metric === 'workshop.longest');
    expect(stays.length).toBeGreaterThan(0);
    for (const link of stays) {
      const { pathname, params } = parse(link.href);
      expect(pathname).toBe('/fleet/maintenance');
      expect(params.get('state')).toBe('open');
      expect(params.get('vehicleCodes')?.split(',')).toHaveLength(1);
    }
  });
});

describe('«كل فروعي» and the links to other tabs (plan D12, D15)', () => {
  it('narrows every company+set figure of a reader of several branches to those branches', () => {
    const pages = NOW_TABS.map((tab) =>
      renderDashboard({ url: `/fleet?tab=${tab}`, client: dashboardClient({ now: NOW_MINE }) }),
    );
    // The matrix's cells and columns name their own branch (a column = one branch): not the echo.
    const branchLinks = pages
      .flatMap(anchors)
      .filter(
        (a) => parse(a.href).params.has('branch') && !a.metric.startsWith('distributionVehicles.'),
      );
    expect(branchLinks.length).toBeGreaterThan(5);
    for (const link of branchLinks) {
      expect(parse(link.href).params.get('branch'), link.metric).toBe(`${B1},${B2}`);
    }
    const metrics = new Set(branchLinks.map((l) => l.metric));
    // The notices follow the car's branch: they carry the reader's two branches too.
    for (const metric of [
      'workshop.open',
      'violationsOpen.total',
      'violationsOpen.company',
      'violationsOpen.unknown',
      'fuelCharging.wataniya',
      'fuelCharging.requested',
      'fuelCards.expired',
      'fuelCardList.chargingStates',
      'dealershipPending.rows',
      'notices.missingAny',
      'notices.missingCheckImage',
      'notices.open',
      'notices.all',
      'notices.row',
      'accidentsOpen.count',
      'accidentsOpen.all',
    ]) {
      expect(metrics.has(metric), metric).toBe(true);
    }
    // The same reader's period figures: the set's branch is the reader's two branches.
    const km = anchors(renderPeriod({ url: '/fleet?tab=km&period=last30', dto: PERIOD_MINE }));
    const total = km.find((a) => a.metric === 'km.total');
    expect(parse(total?.href ?? '').params.get('branch')).toBe(`${B1},${B2}`);
  });

  it('keeps the switcher’s one branch exact, and the whole company with no branch at all', () => {
    const one = anchors(
      renderDashboard({ url: '/fleet?tab=today', client: dashboardClient({ now: NOW_BRANCH }) }),
    );
    expect(
      parse(one.find((a) => a.metric === 'workshop.open')?.href ?? '').params.get('branch'),
    ).toBe(B1);
    const company = anchors(renderDashboard({ url: '/fleet?tab=today' }));
    expect(company.filter((a) => parse(a.href).params.has('branch'))).toEqual([]);
  });

  it('opens another tab of the page with the page’s own filters — never a period of its own', () => {
    const html = renderDashboard({ url: `/fleet?tab=overview${PAGE_FILTERS}` });
    const tabs = anchors(html).filter((a) => a.metric.endsWith('.tab'));
    expect(tabs.length).toBeGreaterThan(5);
    for (const link of tabs) {
      const { pathname, params } = parse(link.href);
      expect(pathname, link.metric).toBe('/fleet');
      expect(params.get('period'), link.metric).toBe('last30');
      expect(params.get('type'), link.metric).toBe(T1);
      expect(params.get('operation'), link.metric).toBe(OP_CASH);
      expect(params.get('vehicleCodes'), link.metric).toBe('133');
      expect(FLEET_DASHBOARD_TABS as readonly string[]).toContain(params.get('tab'));
    }
    // At default filters a tab link names its tab alone.
    const plain = anchors(renderDashboard({ url: '/fleet?tab=overview' })).filter((a) =>
      a.metric.endsWith('.tab'),
    );
    for (const link of plain) expect(link.href).toMatch(/^\/fleet\?tab=[a-z]+$/u);
  });
});

describe('a figure no screen shows is not linked (named exceptions)', () => {
  it('«قراءات تحتاج مراجعة» and «قراءات الفترة في سجل العدادات» open the period’s whole register', () => {
    // No screen lists the negative readings alone, nor ranks the cars by km: the closest list is
    // the odometer register over the same days and set — exactly the total's link. Each review
    // row's «فتح» is exact: that car on that ONE day.
    const pages = [
      renderPeriod({ url: '/fleet?tab=km&period=last30' }),
      renderPeriod({ url: `/fleet?tab=km&period=last30${SET}`, dto: NARROWED }),
    ];
    for (const html of pages) {
      const links = anchors(html);
      const total = links.find((a) => a.metric === 'km.total')?.href;
      expect(total).toBeDefined();
      for (const metric of [
        'km.invalidRows',
        'km.invalidRows.list',
        'km.invalidList.all',
        'km.ranking.all',
      ]) {
        const found = links.filter((a) => a.metric === metric);
        expect(found.length, metric).toBeGreaterThan(0);
        for (const link of found) expect(link.href, metric).toBe(total);
      }
      const rows = links.filter((a) => a.metric === 'km.invalidList.row');
      expect(rows.length).toBeGreaterThan(0);
      for (const link of rows) {
        const { pathname, params } = parse(link.href);
        expect(pathname).toBe('/fleet/odometer');
        expect(params.get('from')).toBe(params.get('to'));
        expect(params.get('vehicleCodes')?.split(',')).toHaveLength(1);
      }
    }
  });

  it('a notice row opens the notices by what it carries, and a bare one not at all', () => {
    const L = nowLinks({ today: TODAY, branchId: null, scopeBranches: null });
    expect(L.noticeRow({ code: null, number: null, date: null })).toBeNull();
    const rows = LINKS.filter((l) => l.metric === 'notices.row');
    expect(rows.length).toBeGreaterThan(0);
    for (const link of rows) {
      const { pathname, params } = parse(link.href);
      expect(pathname).toBe('/fleet/notices');
      expect(params.get('status')).toBe('open');
      expect(
        ['vehicleCodes', 'number', 'from'].some((name) => params.has(name)),
        link.href,
      ).toBe(true);
      expect(params.get('from'), link.href).toBe(params.get('to'));
    }
  });

  it('«سيارات بلا مسافة في الفترة» opens its cars by code, and nothing past the screens’ cap', () => {
    const P = periodLinks({
      range: { from: '2026-10-03', to: TODAY },
      vehicleScope: NARROWED.vehicleScope,
    });
    expect(P.vehiclesByCodes([], 'km.noDistance')).toBeNull();
    const many = Array.from({ length: 51 }, (_, i) => String(100 + i));
    expect(P.vehiclesByCodes(many, 'km.noDistance')).toBeNull();
    expect(P.vehiclesByCodes(many.slice(0, 50), 'km.noDistance')?.to).toBe(
      `/fleet/vehicles?vehicleCodes=${many.slice(0, 50).join(',')}`,
    );
  });

  it('«المتاحون» has no link — it counts the seated drivers too; «بلا سيارة» opens the roster', () => {
    // The roster's available panel lists, and counts in its heading, only the licensed drivers
    // the day's board seats on no car: the dashboard's «بلا سيارة», not its headline.
    const metrics = new Set(LINKS.map((l) => l.metric));
    expect(metrics.has('roster.available')).toBe(false);
    expect(metrics.has('roster.available.balance')).toBe(false);
    const free = LINKS.filter((l) => l.metric.startsWith('roster.availableWithoutVehicle'));
    expect(new Set(free.map((l) => l.metric))).toEqual(
      new Set(['roster.availableWithoutVehicle', 'roster.availableWithoutVehicle.balance']),
    );
    for (const link of free) expect(link.href).toBe(`/fleet/roster?date=${TODAY}`);
  });
});

// ── The retired old-page spec's pins that no other spec carries ────────────────────────────────

describe('what the retired page spec pinned, kept', () => {
  it('the page and its link/URL helpers count nothing in the browser', () => {
    // W-SHELL's spec scans the tab files; the page and the libraries behind it are scanned here.
    const files = [
      'pages/FleetDashboardPage.tsx',
      'lib/fleet-dashboard-links.ts',
      'lib/fleet-dashboard-url.ts',
      'lib/fleet-dashboard-tabs.ts',
      'lib/fleet-dashboard-refresh.ts',
      'api/fleet-dashboard-api.ts',
      'api/fleet-dashboard-queries.ts',
    ];
    for (const file of files) {
      const src = read(file).replace(/^\s*\/\/.*$/gmu, '');
      expect(src, file).not.toMatch(/\.filter\([^)]*\)\.length/u);
      expect(src, file).not.toMatch(/\.reduce\(/u);
    }
    // And it reads the server's two answers — the old single read is gone.
    const page = read('pages/FleetDashboardPage.tsx');
    expect(page).toContain('useFleetDashboardNow(');
    expect(page).toContain('useFleetDashboardPeriod(');
    expect(page).not.toMatch(/useFleetDashboard\(/u);
  });

  it('prints a dash where a branch holds none of a type — never a zero, and never a link', () => {
    const dv = NOW_DTO.distributionVehicles as NonNullable<typeof NOW_DTO.distributionVehicles>;
    const row = dv.rows[0] as (typeof dv.rows)[number];
    const html = renderDashboard({
      url: '/fleet?tab=distribution',
      client: dashboardClient({
        now: {
          ...NOW_DTO,
          distributionVehicles: {
            ...dv,
            rows: [
              {
                ...row,
                counts: {
                  [B1]: 0,
                  ...Object.fromEntries(Object.entries(row.counts).filter(([id]) => id !== B1)),
                },
              },
              ...dv.rows.slice(1),
            ],
          },
        },
      }),
    });
    const matrix = html.slice(html.indexOf('data-fleet-matrix="true"'));
    const firstRow = matrix.slice(
      matrix.indexOf('<tbody'),
      matrix.indexOf('</tr>', matrix.indexOf('<tbody')),
    );
    expect(firstRow).toContain('—');
    expect(
      anchors(firstRow).filter((a) => a.href.includes(`type=${row.typeId}&branch=${B1}`)),
    ).toEqual([]);
  });

  it('says plainly that nothing was recorded lately, rather than drawing an empty list', () => {
    const html = renderDashboard({
      url: '/fleet?tab=licences',
      client: dashboardClient({ now: { ...NOW_DTO, recentWorkshop: [], recentAccidents: [] } }),
    });
    expect(html).toContain(ar('fleet.dash.licences.latestNone'));
    expect(html).not.toContain('data-recent-visit=');
    expect(html).not.toContain('data-recent-accident=');
  });
});
