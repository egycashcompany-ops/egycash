// «لوحة تحكم الحركة» — the LINK CENSUS (plan R-28, §8.11; unified.md HUB).
//
// A figure on the dashboard opens the screen that shows the same number. The server half of that
// promise is A-DASH's parity spec (every figure = its screen's endpoint called with the link's
// parameters). This is the browser half: render all ten tabs from the fixtures — the company, a
// chosen branch, and period filters that narrow by type, operation, codes and branch — collect
// EVERY figure link the page draws, and hold each to the screen it opens:
//   · its path is a route of the fleet module, and the page that route mounts is known;
//   · every query parameter it carries is one that page READS from its URL — a parameter the
//     target ignores would open a wider list than the figure counts, silently;
//   · it is never a bare list link (a bare URL restores the reader's remembered filters, CR-11);
//   · it names its figure, `<section>.<field>`, after a gated section.
// It also keeps the pins of the retired old-page spec that no other spec carries (the whole page
// counts nothing in the browser; an empty matrix cell is a dash, never a zero; an empty «آخر ما
// سُجّل» says so in words).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_DASHBOARD_GATES, type FleetDashboardPeriodDto } from '@ecms/contracts';
import {
  ALL_KEYS,
  B1,
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
import { PATH_ONLY, nowLinks, periodLinks, type DashLink } from './lib/fleet-dashboard-links';

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

const NOW_TABS = ['alerts', 'now', 'distribution', 'licences', 'summaries'] as const;
const PERIOD_TABS = ['period', 'km', 'ranking', 'maintenance', 'accidents'] as const;

/** R1 with a branch chosen, and the alarm / no-reading codes the branch narrows to (D19). */
const NOW_BRANCH = {
  ...NOW_DTO,
  branchId: B1,
  maintenanceAlarm: {
    ...(NOW_DTO.maintenanceAlarm as NonNullable<typeof NOW_DTO.maintenanceAlarm>),
    codes: { red: ['133'], yellow: ['133', '141'] },
  },
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
  },
};

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
  }
  for (const tab of PERIOD_TABS) {
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=last30` }));
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=thisYear`, dto: PERIOD_YEAR }));
    pages.push(renderPeriod({ url: `/fleet?tab=${tab}&period=last30${SET}`, dto: NARROWED }));
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

/** Links the fixtures may not draw: the builder's other arguments, called directly. */
const built = (): Anchor[] => {
  const asAnchor = (link: DashLink | null): Anchor[] =>
    link === null ? [] : [{ href: link.to, metric: link.metric }];
  const all: (DashLink | null)[] = [];
  for (const L of [
    nowLinks({ today: TODAY, branchId: null }),
    nowLinks({ today: TODAY, branchId: B1 }),
  ]) {
    all.push(
      L.alarm('red', null),
      L.alarm('yellow', ['133', '141']),
      L.noReading(['133']),
      L.neverRead(['141']),
      L.visitDay('231', TODAY, true),
      L.visitDay('231', TODAY, false),
      L.driverLicencesNotRecorded(),
      L.fuelCardsExpiring(30),
      L.violationsUnknown(2026),
      L.rosterAbsent('hrLeave'),
      L.attendance(),
    );
  }
  for (const vehicleScope of [PERIOD_FULL.vehicleScope, NARROWED.vehicleScope]) {
    const P = periodLinks({ range: { from: '2026-10-03', to: TODAY }, vehicleScope });
    all.push(
      P.opexCustody(),
      P.opex('opex.custody', 'custody'),
      P.dealership('dealership.pending', 'pending'),
      P.visits('visits.workType', { workTypes: ['w1'], state: 'closed' }),
      P.visits('visits.workshop', { workshops: ['s1'], vehicleCodes: ['133'] }),
      P.accidents('accidents.open', 'open'),
      P.carKm('133', 'km.top'),
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
  it('collects the page’s links from all ten tabs (the census is not empty by accident)', () => {
    expect(LINKS.length).toBeGreaterThan(150);
    const metrics = new Set(LINKS.map((l) => l.metric.split('.')[0]));
    for (const section of ['maintenanceAlarm', 'roster', 'distributionVehicles', 'km', 'visits']) {
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
        '/fleet/odometer?type',
        '/fleet/odometer?operation',
        '/fleet/odometer?branch',
        '/fleet/odometer?period',
        '/fleet/accidents?type',
        '/fleet/accidents?branch',
        '/fleet/dealership?operation',
        '/fleet/dealership?state',
        '/fleet/receipts?type',
        '/fleet/receipts?source',
        '/fleet/violations?dunknown',
        '/fleet/custody-expenses?from',
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
    // km.byType / km.byBranch put the row's own type / branch in place of the echo's (W-PERIOD).
    const narrowed = LINKS.filter(
      (l) =>
        period(l.metric) &&
        l.href.includes(`operation=${OP_CASH}`) &&
        !['km.byType', 'km.byBranch'].includes(l.metric),
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

describe('a figure no screen shows is not linked (named exceptions)', () => {
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
