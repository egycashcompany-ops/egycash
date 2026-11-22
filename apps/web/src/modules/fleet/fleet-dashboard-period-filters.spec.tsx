// «لوحة تحكم الحركة» — the ONE filter state of the period parts, on the real page: the seven mixed
// panels («الصيانة والورش», «العدادات والكيلومترات», «الحوادث ومطالبات التأمين», «المخالفات
// المرورية والتسويات», «الوقود والمصروفات», «العهدة», «التراخيص والتجديدات») each draw the same
// filter bar over the same read (R2) inside their own bodies. Their own figures are pinned in
// fleet-dashboard-tab-*.spec.tsx; this spec holds the bar itself — the cases that used to stand
// beside the removed period-figures tab (22 November), re-pointed to the panels that keep the bar.
import { describe, expect, it } from 'vitest';
import { periodFiltersPatch, readPeriodFilters } from './lib/fleet-dashboard-url';
import { CLEARED, isCleared, withPreset } from './components/fleet-dashboard/period-filter-bar';
import { EVERY_KEY, T1, TODAY, ar } from './fleet-dashboard-fixtures';
import { FROM_30, PERIOD_FULL, renderPeriod } from './fleet-dashboard-period-fixtures';

const URL_30 = (tab: string, extra = ''): string => `/fleet?tab=${tab}&period=last30${extra}`;
const DATES = `from=${FROM_30}&to=${TODAY}`;

/** The seven panels that draw the page's filter bar over R2. */
const MIXED = ['maintenance', 'km', 'accidents', 'violations', 'fuel', 'custody', 'licences'];

const unescape = (s: string): string =>
  s
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");

/** The first link of the markup with this figure name. */
const hrefOf = (html: string, metric: string): string => {
  for (const m of html.matchAll(/<a\b([^>]*)>/gu)) {
    const attrs = m[1] ?? '';
    if (/data-metric="([^"]*)"/u.exec(attrs)?.[1] === metric) {
      return unescape(/href="([^"]*)"/u.exec(attrs)?.[1] ?? '');
    }
  }
  throw new Error(`no link ${metric}`);
};
/** The words a reader sees (tags dropped, entities read). */
const text = (html: string): string =>
  unescape(html.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ');
/** The markup of one element, by an attribute it alone carries, up to the next one of its kind. */
const slice = (html: string, attr: string, value: string, next: string): string => {
  const start = html.indexOf(`${attr}="${value}"`);
  if (start === -1) throw new Error(`no ${attr}=${value}`);
  const end = html.indexOf(next, start + attr.length + value.length + 3);
  return html.slice(start, end === -1 ? undefined : end);
};
const tabBody = (html: string, tab: string): string =>
  html.slice(html.indexOf(`data-dash-tab-body="${tab}"`));

describe('the filter bar — one state for the seven mixed panels', () => {
  it('stands once in each of the seven, with the address bar’s period and the echoed range', () => {
    for (const tab of MIXED) {
      const body = tabBody(renderPeriod({ url: URL_30(tab), permissions: EVERY_KEY }), tab);
      expect(body.match(/data-period-filters="true"/gu), tab).toHaveLength(1);
      expect(body, tab).toMatch(/<option value="last30" selected="">/u);
      const range = text(slice(body, 'data-period-chip', 'range', 'data-period-chip'));
      expect(range, tab).toContain('2026/10/03');
      expect(range, tab).toContain('2026/11/01');
      // A mixed panel is no period-only tab: it draws no hand-over of its own.
      expect(body, tab).not.toContain('data-period-tab');
    }
  });

  it('is the same bar inside «الصيانة والورش», between its «الآن» band and its period figures', () => {
    const html = renderPeriod({ url: URL_30('maintenance') });
    const body = tabBody(html, 'maintenance');
    expect(html).not.toContain('data-period-tab=');
    expect(body.match(/data-period-filters="true"/gu)).toHaveLength(1);
    expect(body).toMatch(/<option value="last30" selected="">/u);
    const range = text(slice(body, 'data-period-chip', 'range', 'data-period-chip'));
    expect(range).toContain('2026/10/03');
    expect(range).toContain('2026/11/01');
    const bar = body.indexOf('data-period-filters="true"');
    expect(body.indexOf('data-maint-band="now"')).toBeLessThan(bar);
    expect(body.indexOf('data-maint-band="period"')).toBeLessThan(bar);
    expect(bar).toBeLessThan(body.indexOf('data-maint-kpi="exits"'));
    // Its own head names the range as the server echoed it.
    expect(text(slice(body, 'data-dash-range', 'last30', '</span>'))).toContain('2026/10/03');
  });

  it('is the same bar at the top of «العدادات والكيلومترات», before its figures', () => {
    const html = renderPeriod({ url: URL_30('km') });
    const body = tabBody(html, 'km');
    expect(html).not.toContain('data-period-tab=');
    expect(body.match(/data-period-filters="true"/gu)).toHaveLength(1);
    expect(body).toMatch(/<option value="last30" selected="">/u);
    const range = text(slice(body, 'data-period-chip', 'range', 'data-period-chip'));
    expect(range).toContain('2026/10/03');
    expect(range).toContain('2026/11/01');
    const bar = body.indexOf('data-period-filters="true"');
    expect(bar).toBeLessThan(body.indexOf('data-km-kpi="total"'));
    expect(bar).toBeLessThan(body.indexOf('data-km-kpi="stale"'));
    expect(bar).toBeLessThan(body.indexOf('data-km-block="chart"'));
  });

  it('is the same bar inside «الحوادث ومطالبات التأمين», between its «الآن» band and its period figures', () => {
    const html = renderPeriod({ url: URL_30('accidents') });
    const body = tabBody(html, 'accidents');
    expect(html).not.toContain('data-period-tab=');
    expect(body.match(/data-period-filters="true"/gu)).toHaveLength(1);
    expect(body).toMatch(/<option value="last30" selected="">/u);
    const range = text(slice(body, 'data-period-chip', 'range', 'data-period-chip'));
    expect(range).toContain('2026/10/03');
    expect(range).toContain('2026/11/01');
    const bar = body.indexOf('data-period-filters="true"');
    expect(body.indexOf('data-acc-band="now"')).toBeLessThan(bar);
    expect(body.indexOf('data-acc-band="period"')).toBeLessThan(bar);
    expect(bar).toBeLessThan(body.indexOf('data-acc-kpi="period"'));
  });

  it('writes a new state without touching the tab', () => {
    const filters = readPeriodFilters(new URLSearchParams(`tab=km&period=last30&type=${T1}`));
    const patch = periodFiltersPatch(withPreset(filters, 'lastMonth', null));
    expect(Object.keys(patch)).not.toContain('tab');
    expect(patch).toMatchObject({ period: 'lastMonth', from: null, to: null, type: T1 });
  });

  it('starts «مخصص» from the range on show, and clears back to the default', () => {
    const custom = withPreset(CLEARED, 'custom', { from: FROM_30, to: TODAY });
    expect(custom).toMatchObject({ preset: 'custom', from: FROM_30, to: TODAY });
    expect(isCleared(CLEARED)).toBe(true);
    expect(isCleared({ ...CLEARED, vehicleCodes: ['182'] })).toBe(false);
    const html = renderPeriod({ url: '/fleet?tab=km' });
    expect(tabBody(html, 'km')).toMatch(/data-period-clear="true" disabled=""/u);
  });

  it('shows the dates of a custom period, and warns of one the server would refuse', () => {
    const bad = renderPeriod({
      url: '/fleet?tab=km&period=custom&from=2026-10-20&to=2026-10-01',
    });
    expect(bad).toContain('data-period-date="from"');
    expect(bad).toContain('data-period-invalid="true"');
    const good = renderPeriod({
      url: '/fleet?tab=km&period=custom&from=2026-10-01&to=2026-10-20',
      dto: {
        ...PERIOD_FULL,
        range: {
          preset: 'custom',
          from: '2026-10-01',
          to: '2026-10-20',
          days: 20,
          granularity: 'day',
        },
      },
    });
    expect(good).not.toContain('data-period-invalid');
    expect(text(slice(good, 'data-period-chip', 'range', 'data-period-chip'))).toContain(
      '2026/10/20',
    );
  });

  it('names the set the server echoed in its chips, and the figures’ links carry it', () => {
    const html = renderPeriod({
      url: URL_30('km', '&vehicleCodes=182,207'),
      dto: {
        ...PERIOD_FULL,
        vehicleScope: {
          count: 2,
          typeIds: [],
          operationIds: [],
          vehicleCodes: ['182', '207'],
          branchId: null,
          scopeBranches: null,
        },
      },
    });
    expect(text(slice(html, 'data-period-chip', 'codes', 'data-period-chip'))).toContain(
      '182, 207',
    );
    expect(text(slice(html, 'data-period-chip', 'count', '</span></span>'))).toContain('2');
    expect(hrefOf(html, 'km.total')).toBe(`/fleet/odometer?${DATES}&vehicleCodes=182,207`);
  });

  it('draws only the controls whose lists the reader may read (no 403 on the dashboard)', () => {
    /** The bar's controls, before its chips: a list control is a button that opens a list. */
    const controls = (html: string): string =>
      slice(html, 'data-period-controls', 'true', 'data-period-chip');
    const lists = (html: string): number => controls(html).match(/ aria-haspopup="/gu)?.length ?? 0;
    const accidentsOnly = renderPeriod({
      url: URL_30('accidents'),
      permissions: ['fleetAccident.view'],
    });
    expect(lists(accidentsOnly)).toBe(0);
    expect(controls(accidentsOnly)).toContain('data-period-preset="true"');
    expect(controls(accidentsOnly)).not.toContain(ar('fleet.dash.filters.type'));
    const all = renderPeriod({ url: URL_30('accidents') });
    // «نوع السيارة», «التشغيل», «أكواد السيارات».
    expect(lists(all)).toBe(3);
    expect(controls(all)).toContain(ar('fleet.dash.filters.type'));
    expect(controls(all)).toContain(ar('fleet.dash.filters.codes'));
  });
});
