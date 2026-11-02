// «لوحة تحكم الحركة» — the frame: no page head, the sticky pill bar with its two groups and its counts,
// the tabs a reader sees, the panel a link opens, and the reads a reader is allowed to send.
//
// Rendered in the node environment over seeded caches (`renderToStaticMarkup`), the fleet-dashboard
// way: React Query's server snapshot reads a seeded answer, so each case seeds what the server would
// have answered for that reader.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { custodyQueryKeys } from './api/fleet-queries';
import {
  ALL_KEYS,
  NOW_DTO,
  PERIOD_DTO,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';
import { REMEMBERED_FILTERS, dashboardView } from './pages/FleetDashboardPage';
import { alertLines, alertSummary, tabBadges, visibleTabs } from './lib/fleet-dashboard-tabs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, 'pages/FleetDashboardPage.tsx'), 'utf8');

/** The tabs the bar shows, in its order. */
const barTabs = (html: string): string[] =>
  [...html.matchAll(/data-dash-tab="([a-z]+)"/gu)].map((m) => m[1] as string);
/** The tab the bar shows pressed. */
const pressed = (html: string): string | undefined =>
  /aria-selected="true"[^>]*data-dash-tab="([a-z]+)"/u.exec(html)?.[1];
const badge = (html: string, tab: string): string | undefined =>
  new RegExp(`data-dash-badge="${tab}"[^>]*>([^<]+)<`, 'u').exec(html)?.[1];

describe('the frame', () => {
  const html = renderDashboard();

  it('has no page head: the sticky pill bar is the first thing in the content', () => {
    expect(html.startsWith('<div data-fleet-dashboard="true"')).toBe(true);
    expect(html.indexOf('data-dash-sticky="true"')).toBeLessThan(html.indexOf('data-dash-panel'));
    expect(html).not.toMatch(/<h1\b/u);
    expect(html).toContain('sticky top-0');
  });

  it('draws the brand logo badge and the two groups «الآن» | «حسب الفلاتر»', () => {
    expect(html).toContain('data-dash-nav="true"');
    expect(html).toContain(
      `aria-label="${ar('fleet.dash.shell.group.now')}" data-dash-group="now"`,
    );
    expect(html).toContain(
      `aria-label="${ar('fleet.dash.shell.group.filters')}" data-dash-group="filters"`,
    );
    expect(html.indexOf('data-dash-group="now"')).toBeLessThan(
      html.indexOf('data-dash-group="filters"'),
    );
  });

  it('shows all ten tabs, in the bar’s order, to a reader with every key', () => {
    expect(barTabs(html)).toEqual([
      'alerts',
      'now',
      'distribution',
      'licences',
      'summaries',
      'period',
      'km',
      'ranking',
      'maintenance',
      'accidents',
    ]);
  });

  it('presses the first visible tab on a clean address, in the system’s indigo', () => {
    expect(pressed(html)).toBe('alerts');
    expect(html).toMatch(/aria-selected="true"[^>]*class="[^"]*bg-brand-600/u);
    expect(html).toContain('data-dash-panel="alerts"');
  });

  it('opens the tab the link names, and keeps its words as the bar writes them', () => {
    const licences = renderDashboard({ url: '/fleet?tab=licences' });
    expect(pressed(licences)).toBe('licences');
    expect(licences).toContain(`title="${ar('fleet.dash.shell.tab.licences')}"`);
    expect(licences).toContain(`>${ar('fleet.dash.shell.tabShort.licences')}<`);
  });

  it('falls back to the first visible tab for a hidden or an unknown tab', () => {
    const unknown = renderDashboard({ url: '/fleet?tab=nonsense' });
    expect(pressed(unknown)).toBe('alerts');
    // A reader of the vehicles alone has no summaries tab: the link lands on the first visible one.
    const hidden = renderDashboard({
      url: '/fleet?tab=summaries',
      permissions: ['fleetVehicle.view'],
    });
    expect(barTabs(hidden)).not.toContain('summaries');
    expect(pressed(hidden)).toBe('alerts');
  });

  it('renders the period tabs through the period hand-over (H1)', () => {
    const period = renderDashboard({ url: '/fleet?tab=maintenance' });
    expect(period).toContain('data-period-tab="maintenance"');
    expect(period).toContain(ar('fleet.dash.shell.tab.maintenance'));
  });
});

describe('the tabs a reader sees (R-28: permission first, then the server’s nulls)', () => {
  it('shows only the tabs a key opens', () => {
    const html = renderDashboard({ permissions: ['fleetVehicle.view'] });
    expect(barTabs(html)).toEqual(['alerts', 'now', 'distribution', 'licences']);
    expect(html).not.toContain('data-dash-group="filters"');
  });

  it('hides a tab once the server answered every one of its sections with null', () => {
    const now = { ...NOW_DTO, distributionVehicles: null, distributionDrivers: null };
    expect(barTabs(renderDashboard({ client: dashboardClient({ now }) }))).not.toContain(
      'distribution',
    );
  });

  it('keeps a tab whose section failed, with the error and the retry in its place', () => {
    const now = {
      ...NOW_DTO,
      roster: null,
      vehicles: null,
      workshop: null,
      unavailable: ['roster' as const],
    };
    const html = renderDashboard({ url: '/fleet?tab=now', client: dashboardClient({ now }) });
    expect(barTabs(html)).toContain('now');
    expect(html).toContain('data-section-error="roster"');
    expect(html).toContain(ar('fleet.dash.common.retry'));
  });

  it('shows the custody-only reader the two tabs custody feeds, and never asks R1 or R2', () => {
    const html = renderDashboard({
      permissions: ['fleetCustody.view'],
      client: dashboardClient({ now: null, period: null }),
    });
    expect(barTabs(html)).toEqual(['alerts', 'summaries']);
    expect(html).toContain('data-alert="custody"');
  });

  it('shows one honest empty state when nothing is left to show', () => {
    const answers = { can: () => false, now: undefined, period: undefined };
    expect(visibleTabs(answers)).toEqual([]);
    // A reader of the vehicles whose every vehicle section came back null: no bar, one message.
    const now = { ...NOW_DTO, vehicles: null, distributionVehicles: null, licenceVehicles: null };
    const html = renderDashboard({
      permissions: ['fleetVehicle.view'],
      client: dashboardClient({ now }),
    });
    expect(html).not.toContain('data-dash-nav');
    expect(html).toContain(ar('fleet.dash.shell.nothingTitle'));
  });

  it('shows the skeleton of a tab while R1 is on its way — never zeroes pretending to be data', () => {
    const html = renderDashboard({ url: '/fleet?tab=now', client: dashboardClient({ now: null }) });
    expect(html).toContain('data-dash-loading="true"');
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('data-now-card=');
  });
});

describe('the counts on the bar (plan §5.10)', () => {
  const html = renderDashboard();

  it('counts the alert LINES that fired, the custody line included, red when one is red', () => {
    expect(badge(html, 'alerts')).toBe('11');
    expect(html).toMatch(/data-dash-badge="alerts"[^>]*class="[^"]*bg-red-500/u);
  });

  it('equals the figure its tab shows', () => {
    expect(badge(html, 'now')).toBe(String(NOW_DTO.roster?.unmanned));
    expect(badge(html, 'distribution')).toBe(String(NOW_DTO.distributionVehicles?.totals.total));
    expect(badge(html, 'licences')).toBe('3'); // 2 vehicle licences + 1 driver licence
    expect(badge(html, 'maintenance')).toBe(String(PERIOD_DTO.visits?.count));
    expect(badge(html, 'accidents')).toBe(String(PERIOD_DTO.accidents?.count));
    expect(badge(html, 'summaries')).toBeUndefined();
  });

  it('hides with its section', () => {
    const now = { ...NOW_DTO, roster: null };
    const html2 = renderDashboard({
      client: dashboardClient({ now }),
      permissions: ALL_KEYS.filter((k) => k !== 'fleetRoster.view'),
    });
    expect(badge(html2, 'now')).toBeUndefined();
    const answers = {
      can: () => true,
      now: { ...NOW_DTO, licenceVehicles: null, licenceDrivers: null },
      period: undefined,
    };
    expect(tabBadges(answers, null).licences).toBeUndefined();
  });

  it('is amber for the cars without a driver, plain once there are none', () => {
    const answers = { can: () => true, now: NOW_DTO, period: undefined };
    expect(tabBadges(answers, null).now).toEqual({ n: 5, tone: 'amber' });
    const none = {
      ...answers,
      now: {
        ...NOW_DTO,
        roster: { ...(NOW_DTO.roster as NonNullable<typeof NOW_DTO.roster>), unmanned: 0 },
      },
    };
    expect(tabBadges(none, null).now).toEqual({ n: 0, tone: 'plain' });
  });

  it('orders the lines red first, the custody line after the notices', () => {
    const lines = alertLines(NOW_DTO.alerts, 1);
    expect(lines.map((l) => l.id)).toEqual([
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
    expect(alertSummary(lines)).toEqual({
      total: 11,
      red: 4,
      orange: 7,
      byCategory: { cars: 4, drivers: 2, fuel: 5 },
    });
    expect(alertLines(NOW_DTO.alerts, 0)).toHaveLength(10);
    expect(alertLines(NOW_DTO.alerts, null)).toHaveLength(10);
  });
});

describe('the custody hooks are mounted only with `fleetCustody.view` (D3)', () => {
  it('builds no custody query for a reader without the grant — no request, no 403', () => {
    const client = dashboardClient({ custody: false });
    renderDashboard({ client, permissions: ALL_KEYS.filter((k) => k !== 'fleetCustody.view') });
    expect(client.getQueryCache().findAll({ queryKey: custodyQueryKeys.fund() })).toHaveLength(0);
    expect(
      client.getQueryCache().findAll({ queryKey: custodyQueryKeys.candidates('settle') }),
    ).toHaveLength(0);
  });

  it('reads the custody screen’s own queries for a reader who holds it', () => {
    const client = dashboardClient({ custody: false });
    renderDashboard({ client });
    expect(client.getQueryCache().findAll({ queryKey: custodyQueryKeys.fund() })).toHaveLength(1);
  });
});

describe('the address bar (D14)', () => {
  it('remembers the six filters for the page, never `tab`', () => {
    expect(REMEMBERED_FILTERS).toEqual([
      'period',
      'from',
      'to',
      'type',
      'operation',
      'vehicleCodes',
    ]);
    expect(PAGE).toContain('const REMEMBERED_FILTERS = [');
    expect(PAGE).toContain('useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);');
    expect(PAGE).toContain("sp.get('tab')");
    for (const param of REMEMBERED_FILTERS) expect(PAGE).toContain(`sp.get('${param}')`);
  });

  it('decides the read’s face: a skeleton on its way, an error with no answer, the answer otherwise', () => {
    expect(dashboardView({ isPending: true, isError: false, data: undefined })).toBe('loading');
    expect(dashboardView({ isPending: false, isError: true, data: undefined })).toBe('error');
    expect(dashboardView({ isPending: false, isError: false, data: undefined })).toBe('error');
    expect(dashboardView({ isPending: false, isError: true, data: NOW_DTO })).toBe('ready');
  });
});
