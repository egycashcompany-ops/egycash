// «أرقام الفترة» — the last «حسب الفلاتر» tab — on the real page (plan §8.6, unified.md W-PERIOD):
// what it shows from R2's answer and where every figure leads; then the ONE filter state it shares
// with the period parts of the three mixed panels («الصيانة والورش», «العدادات والكيلومترات»,
// «الحوادث ومطالبات التأمين» — each draws the same bar inside its body; their own figures are pinned
// in fleet-dashboard-tab-{maintenance,km,accidents}.spec.tsx), and what a period tab must never draw.
import { describe, expect, it } from 'vitest';
import { FLEET_DASHBOARD_PERIOD_TABS } from '@ecms/contracts';
import { periodFiltersPatch, readPeriodFilters } from './lib/fleet-dashboard-url';
import { CLEARED, isCleared, withPreset } from './components/fleet-dashboard/period-filter-bar';
import { ALL_KEYS, T1, TODAY, ar } from './fleet-dashboard-fixtures';
import {
  FROM_30,
  KM_TOTAL,
  PERIOD_FULL,
  renderPeriod,
  renderPeriodTab,
} from './fleet-dashboard-period-fixtures';

const URL_30 = (tab: string, extra = ''): string => `/fleet?tab=${tab}&period=last30${extra}`;
const KM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

interface Anchor {
  href: string;
  metric: string;
}

const unescape = (s: string): string =>
  s
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");

/** Every link of the markup, with its figure name. */
const links = (html: string): Anchor[] =>
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

const DATES = `from=${FROM_30}&to=${TODAY}`;

// ── Tab 6 ─────────────────────────────────────────────────────────────────────────────────────

describe('tab 6 «أرقام الفترة»', () => {
  const html = renderPeriod({ url: URL_30('period') });
  const body = tabBody(html, 'period');

  it('shows the five cards, each figure opening its screen over the same days', () => {
    expect(text(body)).toContain(KM.format(KM_TOTAL));
    expect(hrefOf(body, 'km.total')).toBe(`/fleet/odometer?${DATES}`);
    expect(hrefOf(body, 'km.invalidRows')).toBe(`/fleet/odometer?${DATES}`);
    expect(hrefOf(body, 'visits.count')).toBe(`/fleet/maintenance?${DATES}`);
    expect(hrefOf(body, 'visits.closed')).toBe(`/fleet/maintenance?${DATES}&state=closed`);
    expect(hrefOf(body, 'visits.open')).toBe(`/fleet/maintenance?${DATES}&state=open`);
    expect(hrefOf(body, 'accidents.count')).toBe(`/fleet/accidents?${DATES}`);
    expect(hrefOf(body, 'accidents.open')).toBe(`/fleet/accidents?${DATES}&status=open`);
    expect(hrefOf(body, 'opex.total')).toBe(`/fleet/receipts?${DATES}`);
    expect(hrefOf(body, 'opex.card')).toBe(`/fleet/receipts?${DATES}&source=card`);
    // D20: nothing but the dates narrows — the custody part opens «مصروفات العهدة».
    expect(hrefOf(body, 'opex.custody')).toBe(`/fleet/custody-expenses?${DATES}`);
    expect(hrefOf(body, 'dealership.amount')).toBe(`/fleet/dealership?${DATES}`);
    expect(hrefOf(body, 'dealership.pending')).toBe(`/fleet/dealership?${DATES}&state=pending`);
    expect(text(body)).toContain('112,450.00');
    expect(text(body)).toContain('38,900.00');
  });

  it('writes the rules into the cards: confirmed through, still open, coverage, now-states', () => {
    const words = text(body);
    expect(words).toContain(ar('fleet.dash.period.km.confirmedThrough').replace(' {{day}}', ''));
    expect(words).toContain('2026/10/30');
    expect(words).toContain('2026/10/31');
    expect(words).toContain(ar('fleet.dash.period.today'));
    expect(words).toContain('38');
    expect(words).toContain(ar('fleet.dash.period.visits.note'));
    expect(words).toContain(ar('fleet.dash.period.dealership.note'));
    expect(words).toContain('(حتى الآن)');
    expect(words).toContain(ar('fleet.dash.period.opex.note'));
  });

  it('notes the undated accidents in the company view, and not when the server leaves them out', () => {
    expect(body).toContain('data-undated="true"');
    const branch = tabBody(
      renderPeriod({
        url: URL_30('period'),
        dto: {
          ...PERIOD_FULL,
          // The branch view: the server names no undated file (they belong to no branch).
          accidents:
            PERIOD_FULL.accidents === null ? null : { ...PERIOD_FULL.accidents, undated: null },
        },
      }),
      'period',
    );
    expect(branch).not.toContain('data-undated="true"');
  });

  it('never adds the dealership to the operating expenses, and says so', () => {
    expect(body).toContain('data-not-summed="true"');
    expect(text(body)).toContain(ar('fleet.dash.period.notSummed'));
    // 112,450.00 + 38,900.00 is written nowhere.
    expect(text(html)).not.toContain('151,350');
  });

  it('says «البيانات متاحة من …» only when the period starts before the source', () => {
    expect(body).not.toContain('data-data-from=');
    const early = tabBody(
      renderPeriod({
        url: URL_30('period'),
        dto: {
          ...PERIOD_FULL,
          opex: { card: 1, custody: 1, fuel: 0, total: 2, count: 2, dataFrom: '2026-10-10' },
          dealership: { amount: 5, rows: 1, pending: 0, dataFrom: '2026-10-05' },
        },
      }),
      'period',
    );
    expect(early).toContain('data-data-from="2026-10-10"');
    expect(early).toContain('data-data-from="2026-10-05"');
    expect(text(early)).toContain('2026/10/10');
  });

  it('opens the custody part on the receipts screen when the filters narrow by type (D20)', () => {
    const typed = tabBody(
      renderPeriod({
        url: URL_30('period', `&type=${T1}`),
        dto: {
          ...PERIOD_FULL,
          vehicleScope: {
            count: 12,
            typeIds: [T1],
            operationIds: [],
            vehicleCodes: [],
            branchId: null,
            scopeBranches: null,
          },
        },
      }),
      'period',
    );
    expect(hrefOf(typed, 'opex.custody')).toBe(
      `/fleet/receipts?${DATES}&type=${T1}&source=custody`,
    );
    expect(hrefOf(typed, 'km.total')).toBe(`/fleet/odometer?${DATES}&type=${T1}`);
  });

  it('opens the custody part on the receipts screen for a reader without the custody screen', () => {
    const noCustody = tabBody(
      renderPeriod({
        url: URL_30('period'),
        permissions: ALL_KEYS.filter((k) => k !== 'fleetCustody.view'),
      }),
      'period',
    );
    // D20 would send this reader to «مصروفات العهدة», a screen they cannot open: the same custody
    // receipts on the receipts screen instead (the section's own gate holds fleetReceipt.view).
    expect(hrefOf(noCustody, 'opex.custody')).toBe(`/fleet/receipts?${DATES}&source=custody`);
    expect(text(noCustody)).toContain('47,850.00');
  });

  it('renders nothing for a section the reader may not see, and the error for one that failed', () => {
    const partial = tabBody(
      renderPeriod({
        url: URL_30('period'),
        dto: { ...PERIOD_FULL, opex: null, dealership: null, km: null, unavailable: ['km'] },
      }),
      'period',
    );
    expect(partial).not.toContain('data-period-card="opex"');
    expect(partial).not.toContain('data-period-card="dealership"');
    expect(partial).not.toContain('data-not-summed');
    expect(partial).toContain('data-section-error="km"');
    expect(text(partial)).toContain(ar('fleet.dash.common.retry'));
  });
});

// ── The filter bar and the one filter state ───────────────────────────────────────────────────

describe('the filter bar — one state for «أرقام الفترة» and the three mixed panels', () => {
  it('stands at the top of «أرقام الفترة», with the same filters and the echoed range', () => {
    expect(FLEET_DASHBOARD_PERIOD_TABS).toEqual(['period']);
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      const html = renderPeriod({ url: URL_30(tab) });
      expect(html, tab).toContain('data-period-filters="true"');
      expect(html, tab).toMatch(/<option value="last30" selected="">/u);
      const range = text(slice(html, 'data-period-chip', 'range', 'data-period-chip'));
      expect(range, tab).toContain('2026/10/03');
      expect(range, tab).toContain('2026/11/01');
      expect(text(slice(html, 'data-period-range', 'true', '</span></span>')), tab).toContain(
        '2026/10/03',
      );
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
    const html = renderPeriod({ url: '/fleet?tab=period' });
    expect(html).toMatch(/data-period-clear="true" disabled=""/u);
  });

  it('shows the dates of a custom period, and warns of one the server would refuse', () => {
    const bad = renderPeriod({
      url: '/fleet?tab=period&period=custom&from=2026-10-20&to=2026-10-01',
    });
    expect(bad).toContain('data-period-date="from"');
    expect(bad).toContain('data-period-invalid="true"');
    const good = renderPeriod({
      url: '/fleet?tab=period&period=custom&from=2026-10-01&to=2026-10-20',
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

  it('names the set the server echoed in its chips', () => {
    const html = renderPeriod({
      url: URL_30('period', '&vehicleCodes=182,207'),
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

// ── The read's states, and what is never drawn ────────────────────────────────────────────────

describe('the period read', () => {
  it('shows the skeleton while it loads, and the error with its retry when it failed', () => {
    expect(renderPeriodTab({ tab: 'period', loading: true })).toContain('data-dash-loading="true"');
    const failed = renderPeriodTab({ tab: 'period', error: true });
    expect(failed).toContain('data-dash-read-error="true"');
    expect(failed).toContain('data-period-filters="true"');
  });

  it('keeps the shell’s hand-over: the tab’s heading and its range', () => {
    const html = renderPeriodTab({ tab: 'period', data: PERIOD_FULL });
    expect(html).toContain('data-period-tab="period"');
    expect(html).toContain(ar('fleet.dash.shell.tab.period'));
    expect(html).toContain('data-period-range="true"');
  });

  it('draws no Phase-2 piece and names every figure after a period section', () => {
    const sections = new Set(['km', 'visits', 'accidents', 'accidentList', 'opex', 'dealership']);
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      const html = renderPeriod({ url: URL_30(tab) });
      const body = tabBody(html, tab);
      for (const word of ['ترتيب السائقين', 'تكلفة التشغيل', 'عقود التوريد', 'تدقيق الإيصالات']) {
        expect(text(body), `${tab}: ${word}`).not.toContain(word);
      }
      for (const link of links(body)) {
        expect(sections.has(link.metric.split('.')[0] ?? ''), `${tab}: ${link.metric}`).toBe(true);
        const bare = !link.href.includes('?') && !/^\/fleet\/vehicles\/[^/?]+$/u.test(link.href);
        expect(bare, `${tab}: ${link.href}`).toBe(false);
      }
    }
  });
});
