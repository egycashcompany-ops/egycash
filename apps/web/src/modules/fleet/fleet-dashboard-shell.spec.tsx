// «لوحة تحكم الحركة» — the frame: no page head, the sticky pill bar with its ONE strip, its counts and
// «الفرع: …» at its end, the tabs a reader sees, the panel a link opens (old links to the retired
// tabs included), and the reads a reader is allowed to send.
//
// Rendered in the node environment over seeded caches (`renderToStaticMarkup`), the fleet-dashboard
// way: React Query's server snapshot reads a seeded answer, so each case seeds what the server would
// have answered for that reader.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_DASHBOARD_PERIOD_TABS } from '@ecms/contracts';
import { custodyQueryKeys } from './api/fleet-queries';
import {
  ALL_KEYS,
  B1,
  B2,
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
const SHELL = readFileSync(join(HERE, 'components/fleet-dashboard/dash-shell.tsx'), 'utf8');

/** The whole element whose opening tag holds `marker` (its own tag name counted for depth). */
const element = (html: string, marker: string): string => {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const name = /^<([a-z]+)/u.exec(html.slice(start))?.[1] ?? 'div';
  const tags = new RegExp(`<${name}\\b|</${name}>`, 'gu');
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
};
const B1_NAMED = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };
const B2_NAMED = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };

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

  it('draws the brand logo badge and ONE strip of tabs — no «الآن» | «حسب الفلاتر» groups', () => {
    expect(html).toContain('data-dash-nav="true"');
    const strip = element(html, 'data-dash-strip="true"');
    expect(strip).toContain('role="tablist"');
    expect(strip).toContain(`aria-label="${ar('fleet.dash.shell.navLabel')}"`);
    expect(barTabs(strip)).toEqual(barTabs(html));
    expect(html).not.toContain('data-dash-group');
    // One tab list on the page: the strip.
    expect(html.match(/role="tablist"/gu)).toHaveLength(1);
  });

  it('shows all nine tabs, in the bar’s order, to a reader with every key', () => {
    expect(barTabs(html)).toEqual([
      'overview',
      'today',
      'distribution',
      'maintenance',
      'km',
      'accidents',
      'period',
      'summaries',
      'licences',
    ]);
    expect(ar('fleet.dash.shell.tab.km')).toBe('العدادات والكيلومترات');
    expect(ar('fleet.dash.shell.tab.accidents')).toBe('الحوادث ومطالبات التأمين');
    expect(html).toContain(`>${ar('fleet.dash.shell.tab.km')}<`);
    expect(html).toContain(`>${ar('fleet.dash.shell.tab.accidents')}<`);
  });

  it('presses «نظرة عامة» on a clean address, in the system’s indigo', () => {
    expect(pressed(html)).toBe('overview');
    expect(html).toMatch(/aria-selected="true"[^>]*class="[^"]*bg-brand-600/u);
    expect(html).toContain('data-dash-panel="overview"');
    expect(html).toContain(`>${ar('fleet.dash.shell.tab.overview')}<`);
    expect(html).toContain(`>${ar('fleet.dash.shell.tab.today')}<`);
  });

  it('draws the scroll cue only once an overflow was measured — never at rest', () => {
    expect(html).not.toContain('data-dash-cue');
    // The cue exists in the frame, behind the measured overflow of the strip.
    expect(SHELL).toContain('data-dash-cue={side}');
    expect(SHELL).toContain('{cue.start && <StripCue side="start"');
    expect(SHELL).toContain('{cue.end && <StripCue side="end"');
  });

  it('opens the tab the link names, and keeps its words as the bar writes them', () => {
    const licences = renderDashboard({ url: '/fleet?tab=licences' });
    expect(pressed(licences)).toBe('licences');
    expect(licences).toContain(`title="${ar('fleet.dash.shell.tab.licences')}"`);
    expect(licences).toContain(`>${ar('fleet.dash.shell.tabShort.licences')}<`);
  });

  it('falls back to the first visible tab for a hidden or an unknown tab', () => {
    const unknown = renderDashboard({ url: '/fleet?tab=nonsense' });
    expect(pressed(unknown)).toBe('overview');
    // A reader of the vehicles alone has no summaries tab: the link lands on the first visible one.
    const hidden = renderDashboard({
      url: '/fleet?tab=summaries',
      permissions: ['fleetVehicle.view'],
    });
    expect(barTabs(hidden)).not.toContain('summaries');
    expect(pressed(hidden)).toBe('overview');
  });

  it('opens an old link to a retired tab on the tab that took its content', () => {
    // «التنبيهات» → «نظرة عامة», «الحركة الآن» → «الحركة اليوم» — no dead link.
    const alerts = renderDashboard({ url: '/fleet?tab=alerts' });
    expect(pressed(alerts)).toBe('overview');
    expect(alerts).toContain('data-dash-panel="overview"');
    const now = renderDashboard({ url: '/fleet?tab=now' });
    expect(pressed(now)).toBe('today');
    expect(now).toContain('data-dash-panel="today"');
    expect(barTabs(now)).not.toContain('now');
    expect(barTabs(alerts)).not.toContain('alerts');
    // «ترتيب السيارات» → «العدادات والكيلومترات» (its top 5 and bottom 5 live there now).
    const ranking = renderDashboard({ url: '/fleet?tab=ranking' });
    expect(pressed(ranking)).toBe('km');
    expect(ranking).toContain('data-dash-panel="km"');
    expect(ranking).toContain('data-dash-tab-body="km"');
    expect(ranking).toContain('data-km-kpi="total"');
    expect(barTabs(ranking)).not.toContain('ranking');
  });

  it('renders «أرقام الفترة» alone through the period hand-over (H1)', () => {
    expect(FLEET_DASHBOARD_PERIOD_TABS).toEqual(['period']);
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      const html = renderDashboard({ url: `/fleet?tab=${tab}` });
      expect(html, tab).toContain(`data-period-tab="${tab}"`);
      expect(html, tab).toContain(ar(`fleet.dash.shell.tab.${tab}`));
    }
  });

  it('draws «الصيانة والورش» as a panel of R1 and R2 both, the page’s filter bar between its bands', () => {
    const html = renderDashboard({ url: '/fleet?tab=maintenance' });
    expect(pressed(html)).toBe('maintenance');
    expect(ar('fleet.dash.shell.tab.maintenance')).toBe('الصيانة والورش');
    expect(html).toContain(`>${ar('fleet.dash.shell.tab.maintenance')}<`);
    expect(html).toContain(`aria-label="${ar('fleet.dash.shell.tab.maintenance')}"`);
    expect(html).not.toContain('data-period-tab=');
    const body = html.slice(html.indexOf('data-dash-tab-body="maintenance"'));
    const now = body.indexOf('data-dash-band="now"');
    const bar = body.indexOf('data-period-filters="true"');
    const period = body.indexOf('data-dash-band="period"');
    expect(now).toBeGreaterThan(-1);
    expect(period).toBeGreaterThan(now);
    expect(bar).toBeGreaterThan(period);
    expect(body.indexOf('data-maint-kpi="exits"')).toBeGreaterThan(bar);
  });

  it('draws «العدادات والكيلومترات» as a panel of R1 and R2 both, the page’s filter bar at its top', () => {
    const html = renderDashboard({ url: '/fleet?tab=km' });
    expect(pressed(html)).toBe('km');
    expect(html).toContain(`aria-label="${ar('fleet.dash.shell.tab.km')}"`);
    expect(html).not.toContain('data-period-tab=');
    const body = html.slice(html.indexOf('data-dash-tab-body="km"'));
    const bar = body.indexOf('data-period-filters="true"');
    expect(bar).toBeGreaterThan(-1);
    expect(body.indexOf('data-km-kpi="total"')).toBeGreaterThan(bar);
    // Its R1 card «بلا قراءة عداد منذ N أيام» stands among the period cards.
    expect(body.indexOf('data-km-kpi="stale"')).toBeGreaterThan(bar);
  });

  it('draws «الحوادث ومطالبات التأمين» as a panel of R1 and R2 both, the bar between its bands', () => {
    const html = renderDashboard({ url: '/fleet?tab=accidents' });
    expect(pressed(html)).toBe('accidents');
    expect(html).toContain(`aria-label="${ar('fleet.dash.shell.tab.accidents')}"`);
    expect(html).not.toContain('data-period-tab=');
    const body = html.slice(html.indexOf('data-dash-tab-body="accidents"'));
    const now = body.indexOf('data-acc-band="now"');
    const period = body.indexOf('data-acc-band="period"');
    const bar = body.indexOf('data-period-filters="true"');
    expect(now).toBeGreaterThan(-1);
    expect(period).toBeGreaterThan(now);
    expect(bar).toBeGreaterThan(period);
    expect(body.indexOf('data-acc-kpi="period"')).toBeGreaterThan(bar);
  });

  it('opens an old `?tab=distribution` / `?tab=maintenance` / `?tab=km` / `?tab=accidents` link on the rebuilt body (keys kept)', () => {
    const distribution = renderDashboard({ url: '/fleet?tab=distribution' });
    expect(pressed(distribution)).toBe('distribution');
    expect(distribution).toContain('data-dash-tab-body="distribution"');
    expect(distribution).toContain('data-dist-block="matrix"');
    const maintenance = renderDashboard({ url: '/fleet?tab=maintenance' });
    expect(maintenance).toContain('data-dash-tab-body="maintenance"');
    expect(maintenance).toContain('data-maint-band="now"');
    const km = renderDashboard({ url: '/fleet?tab=km' });
    expect(km).toContain('data-dash-tab-body="km"');
    expect(km).toContain('data-km-block="exceptions"');
    const accidents = renderDashboard({ url: '/fleet?tab=accidents' });
    expect(accidents).toContain('data-dash-tab-body="accidents"');
    expect(accidents).toContain('data-acc-block="notices"');
  });
});

describe('the tabs a reader sees (R-28: permission first, then the server’s nulls)', () => {
  it('shows only the tabs a key opens', () => {
    const html = renderDashboard({ permissions: ['fleetVehicle.view'] });
    expect(barTabs(html)).toEqual(['overview', 'today', 'distribution', 'licences']);
    expect(html).not.toContain('data-period-tab');
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
    const html = renderDashboard({ url: '/fleet?tab=today', client: dashboardClient({ now }) });
    expect(barTabs(html)).toContain('today');
    expect(html).toContain('data-section-error="roster"');
    expect(html).toContain(ar('fleet.dash.common.retry'));
  });

  it('shows the custody-only reader the two tabs custody feeds, and never asks R1 or R2', () => {
    const html = renderDashboard({
      permissions: ['fleetCustody.view'],
      client: dashboardClient({ now: null, period: null }),
    });
    expect(barTabs(html)).toEqual(['overview', 'summaries']);
    expect(html).toContain('data-dash-action="custody"');
    // Neither read was sent: the chip states the custody figures' own scope, the whole company.
    expect(html).toContain('data-dash-branch="company"');
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

  it('shows a dealership-only and an odometer-only reader «الصيانة والورش» with their own part', () => {
    const dealer = renderDashboard({ permissions: ['fleetDealership.view'] });
    expect(barTabs(dealer)).toContain('maintenance');
    const dealerTab = renderDashboard({
      url: '/fleet?tab=maintenance',
      permissions: ['fleetDealership.view'],
    });
    expect(dealerTab.match(/data-maint-kpi="([a-z]+)"/gu)).toEqual(['data-maint-kpi="dealer"']);
    const odometer = renderDashboard({ permissions: ['fleetOdometer.view'] });
    expect(barTabs(odometer)).toContain('maintenance');
    const odometerTab = renderDashboard({
      url: '/fleet?tab=maintenance',
      permissions: ['fleetOdometer.view'],
    });
    expect(odometerTab.match(/data-maint-kpi="([a-z]+)"/gu)).toEqual([
      'data-maint-kpi="red"',
      'data-maint-kpi="yellow"',
    ]);
    // The period band is the workshop's (by exit day): not drawn for either.
    expect(dealerTab).not.toContain('data-maint-band="period"');
    expect(odometerTab).not.toContain('data-maint-band="period"');
    // The odometer reader also sees «العدادات والكيلومترات», the whole of it.
    expect(barTabs(odometer)).toContain('km');
    expect(barTabs(odometer)).not.toContain('accidents');
  });

  it('shows a notices-only reader «الحوادث ومطالبات التأمين» with the notices alone — no R2 asked', () => {
    const client = dashboardClient({ period: null });
    const bar = renderDashboard({ permissions: ['fleetNotice.view'], client });
    expect(barTabs(bar)).toContain('accidents');
    const html = renderDashboard({
      url: '/fleet?tab=accidents',
      permissions: ['fleetNotice.view'],
      client,
    });
    expect(html).toContain('data-dash-tab-body="accidents"');
    expect(html).toContain('data-acc-kpi="notices"');
    expect(html).not.toContain('data-acc-kpi="files"');
    expect(html).not.toContain('data-acc-band="period"');
    expect(html).not.toContain('data-period-filters');
    // R2 is never sent for this reader: every period query the page holds is disabled.
    const period = client.getQueryCache().findAll({ queryKey: ['fleet', 'dashboard', 'period'] });
    expect(period.length).toBeGreaterThan(0);
    for (const query of period) expect(query.isDisabled(), String(query.queryKey)).toBe(true);
    // An accidents-only reader: the files and the period, no notices.
    const accidents = renderDashboard({
      url: '/fleet?tab=accidents',
      permissions: ['fleetAccident.view'],
    });
    expect(accidents).toContain('data-acc-kpi="files"');
    expect(accidents).toContain('data-acc-band="period"');
    expect(accidents).not.toContain('data-acc-kpi="notices"');
  });

  it('keeps each band of «الصيانة والورش» on its own read — R1 on its way never blanks the period', () => {
    const r1Pending = renderDashboard({
      url: '/fleet?tab=maintenance',
      client: dashboardClient({ now: null }),
    });
    expect(r1Pending).toContain('data-dash-tab-body="maintenance"');
    expect(r1Pending).toContain('data-read-band="loading"');
    expect(r1Pending).toContain('data-maint-kpi="exits"');
    const r2Pending = renderDashboard({
      url: '/fleet?tab=maintenance',
      client: dashboardClient({ period: null }),
    });
    expect(r2Pending).toContain('data-maint-kpi="red"');
    expect(r2Pending).not.toContain('data-maint-kpi="exits"');
    expect(r2Pending).toContain('data-period-filters="true"');
  });

  it('keeps each part of «العدادات والكيلومترات» on its own read — R1 on its way never blanks R2', () => {
    const r1Pending = renderDashboard({
      url: '/fleet?tab=km',
      client: dashboardClient({ now: null }),
    });
    expect(r1Pending).toContain('data-dash-tab-body="km"');
    expect(r1Pending).toContain('data-km-loading="stale"');
    expect(r1Pending).toContain('data-km-kpi="total"');
    expect(r1Pending).toContain('data-km-block="chart"');
    const r2Pending = renderDashboard({
      url: '/fleet?tab=km',
      client: dashboardClient({ period: null }),
    });
    expect(r2Pending).toContain('data-km-kpi="stale"');
    expect(r2Pending).not.toContain('data-km-kpi="total"');
    expect(r2Pending).toContain('data-period-filters="true"');
  });

  it('keeps each band of «الحوادث ومطالبات التأمين» on its own read — R1 on its way never blanks R2', () => {
    const r1Pending = renderDashboard({
      url: '/fleet?tab=accidents',
      client: dashboardClient({ now: null }),
    });
    expect(r1Pending).toContain('data-dash-tab-body="accidents"');
    expect(r1Pending).toContain('data-read-band="loading"');
    expect(r1Pending).not.toContain('data-acc-kpi="files"');
    expect(r1Pending).toContain('data-acc-kpi="period"');
    const r2Pending = renderDashboard({
      url: '/fleet?tab=accidents',
      client: dashboardClient({ period: null }),
    });
    expect(r2Pending).toContain('data-acc-kpi="files"');
    expect(r2Pending).toContain('data-acc-kpi="notices"');
    expect(r2Pending).not.toContain('data-acc-kpi="period"');
    expect(r2Pending).toContain('data-period-filters="true"');
  });

  it('shows the skeleton of a tab while R1 is on its way — never zeroes pretending to be data', () => {
    const html = renderDashboard({
      url: '/fleet?tab=today',
      client: dashboardClient({ now: null }),
    });
    expect(html).toContain('data-dash-loading="true"');
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('data-today-card=');
  });
});

describe('«الفرع: …» at the bar’s end (what the figures cover, as the server answered it)', () => {
  const chip = (html: string): string => element(html, 'data-dash-branch=');
  const withScope = (scopeBranches: typeof NOW_DTO.scopeBranches): string =>
    renderDashboard({ client: dashboardClient({ now: { ...NOW_DTO, scopeBranches } }) });

  it('says «الشركة كلها» for the whole company, outside the tab list', () => {
    const html = renderDashboard();
    expect(chip(html)).toContain('data-dash-branch="company"');
    expect(chip(html)).toContain(ar('fleet.dash.shell.branch'));
    expect(chip(html)).toContain(ar('nav.branchSwitcher.all'));
    expect(element(html, 'data-dash-strip="true"')).not.toContain('data-dash-branch');
    expect(element(html, 'data-dash-nav="true"')).toContain('data-dash-branch="company"');
    // A statement, not a picker: no link and no button.
    expect(chip(html)).not.toMatch(/<a\b|<button\b/u);
  });

  it('names the one branch, and says «كل فروعي» for several', () => {
    const one = chip(withScope([B1_NAMED]));
    expect(one).toContain('data-dash-branch="one"');
    expect(one).toContain('القاهرة');
    const several = chip(withScope([B1_NAMED, B2_NAMED]));
    expect(several).toContain('data-dash-branch="several"');
    expect(several).toContain(ar('nav.branchSwitcher.mine'));
    expect(several).not.toContain('القاهرة');
  });

  it('is not drawn while the reads are on their way, nor for a reach with no branch', () => {
    const loading = renderDashboard({ client: dashboardClient({ now: null, period: null }) });
    expect(loading).not.toContain('data-dash-branch');
    expect(withScope([])).not.toContain('data-dash-branch');
  });

  it('takes R2’s echo for a reader of the period figures alone', () => {
    const html = renderDashboard({
      url: '/fleet?tab=maintenance',
      permissions: ['fleetMaintenance.view'],
      client: dashboardClient({
        now: null,
        period: {
          ...PERIOD_DTO,
          vehicleScope: { ...PERIOD_DTO.vehicleScope, scopeBranches: [B2_NAMED] },
        },
      }),
    });
    expect(chip(html)).toContain('data-dash-branch="one"');
    expect(chip(html)).toContain('الجيزة');
  });

  it('stands above the bar on a phone, where the logo hides', () => {
    const html = renderDashboard();
    expect(html).toContain('data-dash-branch-phone="company"');
    expect(html.indexOf('data-dash-branch-phone')).toBeLessThan(html.indexOf('data-dash-nav'));
  });
});

describe('the counts on the bar (plan §5.10)', () => {
  const html = renderDashboard();

  it('puts no count on «نظرة عامة» — the retired «التنبيهات» count went with its tab', () => {
    expect(badge(html, 'overview')).toBeUndefined();
    expect(html).not.toContain('data-dash-badge="alerts"');
    expect(html).not.toContain('data-dash-badge="overview"');
  });

  it('equals the figure its tab shows', () => {
    expect(badge(html, 'today')).toBe(String(NOW_DTO.roster?.unmanned));
    expect(html).toMatch(/data-dash-badge="today"[^>]*class="[^"]*bg-amber-100/u);
    expect(html).toContain(
      `title="${ar('fleet.dash.shell.badge.today', { count: NOW_DTO.roster?.unmanned ?? 0 })}"`,
    );
    // «توزيع السيارات» carries no count (the approved bar draws none).
    expect(badge(html, 'distribution')).toBeUndefined();
    expect(badge(html, 'licences')).toBe('3'); // 2 vehicle licences + 1 driver licence
    // «الصيانة والورش»: the cars that reached the service limit (its red card), in red.
    expect(badge(html, 'maintenance')).toBe(String(NOW_DTO.maintenanceAlarm?.red));
    expect(html).toMatch(/data-dash-badge="maintenance"[^>]*class="[^"]*bg-red-600/u);
    expect(html).toContain(
      `title="${ar('fleet.dash.shell.badge.maintenance', { count: NOW_DTO.maintenanceAlarm?.red ?? 0 })}"`,
    );
    // «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين» carry none (the approved bar draws
    // none): the old count of the period's accidents went with the old body.
    expect(badge(html, 'km')).toBeUndefined();
    expect(badge(html, 'accidents')).toBeUndefined();
    expect(
      tabBadges({ can: () => true, now: NOW_DTO, period: PERIOD_DTO }).accidents,
    ).toBeUndefined();
    expect(badge(html, 'summaries')).toBeUndefined();
  });

  it('hides with its section', () => {
    const now = { ...NOW_DTO, roster: null };
    const html2 = renderDashboard({
      client: dashboardClient({ now }),
      permissions: ALL_KEYS.filter((k) => k !== 'fleetRoster.view'),
    });
    expect(badge(html2, 'today')).toBeUndefined();
    const answers = {
      can: () => true,
      now: { ...NOW_DTO, licenceVehicles: null, licenceDrivers: null },
      period: undefined,
    };
    expect(tabBadges(answers).licences).toBeUndefined();
    // The red-alarm count hides at 0, and with its section (no `fleetOdometer.view` → null).
    const alarm = NOW_DTO.maintenanceAlarm as NonNullable<typeof NOW_DTO.maintenanceAlarm>;
    const calm = { ...answers, now: { ...NOW_DTO, maintenanceAlarm: { ...alarm, red: 0 } } };
    expect(tabBadges(calm).maintenance).toBeUndefined();
    expect(tabBadges({ ...answers, now: NOW_DTO }).maintenance).toEqual({ n: 3, tone: 'red' });
    const blind = renderDashboard({
      client: dashboardClient({ now: { ...NOW_DTO, maintenanceAlarm: null } }),
      permissions: ALL_KEYS.filter((k) => k !== 'fleetOdometer.view'),
    });
    expect(barTabs(blind)).toContain('maintenance');
    expect(badge(blind, 'maintenance')).toBeUndefined();
    // The period's visits never feed it any more.
    expect(
      tabBadges({ can: () => true, now: undefined, period: PERIOD_DTO }).maintenance,
    ).toBeUndefined();
  });

  it('is amber for the cars without a driver, plain once there are none', () => {
    const answers = { can: () => true, now: NOW_DTO, period: undefined };
    expect(tabBadges(answers).today).toEqual({ n: 5, tone: 'amber' });
    expect(tabBadges(answers).overview).toBeUndefined();
    const none = {
      ...answers,
      now: {
        ...NOW_DTO,
        roster: { ...(NOW_DTO.roster as NonNullable<typeof NOW_DTO.roster>), unmanned: 0 },
      },
    };
    expect(tabBadges(none).today).toEqual({ n: 0, tone: 'plain' });
  });

  it('orders the overview’s action lines red first, the custody line after the notices', () => {
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
    expect(alertSummary(lines)).toEqual({ total: 11, red: 4, orange: 7 });
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
  it('remembers the type, the operation and the codes — never the period, never `tab` (§0c)', () => {
    expect(REMEMBERED_FILTERS).toEqual(['type', 'operation', 'vehicleCodes']);
    expect(PAGE).toContain('const REMEMBERED_FILTERS = [');
    expect(PAGE).toContain('useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);');
    expect(PAGE).toContain("sp.get('tab')");
    // The page still reads the period from the address bar: a chosen period stays between tabs.
    for (const param of [...REMEMBERED_FILTERS, 'period', 'from', 'to']) {
      expect(PAGE).toContain(`sp.get('${param}')`);
    }
  });

  it('keeps the page’s period on a tab switch, and reads «هذا الشهر» apart for the overview', () => {
    expect(PAGE).toContain('const pick = (tab: FleetDashboardTab): void => write({ tab });');
    expect(PAGE).toContain(
      "const MONTH_QUERY: FleetDashboardPeriodQuery = { preset: 'thisMonth' };",
    );
    // Whitespace aside: the month read is asked by a reader of R2 only on the overview, and on
    // «توزيع السيارات» for a reader of its km.
    const flat = PAGE.replace(/\s+/gu, ' ');
    expect(flat).toContain(
      "const monthEnabled = reads.period && (active === 'overview' || (active === 'distribution' && sectionPermitted('km', can)));",
    );
    expect(flat).toContain("useFleetDashboardPeriod(MONTH_QUERY, 'live', monthEnabled)");
  });

  it('decides the read’s face: a skeleton on its way, an error with no answer, the answer otherwise', () => {
    expect(dashboardView({ isPending: true, isError: false, data: undefined })).toBe('loading');
    expect(dashboardView({ isPending: false, isError: true, data: undefined })).toBe('error');
    expect(dashboardView({ isPending: false, isError: false, data: undefined })).toBe('error');
    expect(dashboardView({ isPending: false, isError: true, data: NOW_DTO })).toBe('ready');
  });
});
