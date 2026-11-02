// The five «حسب الفلاتر» tabs on the real page (plan §8.6–§8.10, unified.md W-PERIOD): what each
// tab shows from R2's answer, where every figure leads, the R-15 drawing in the markup, the one
// filter state shared by the five, and what the period tabs must never draw.
import { describe, expect, it } from 'vitest';
import { type FleetDashboardPeriodDto } from '@ecms/contracts';
import { periodFiltersPatch, readPeriodFilters } from './lib/fleet-dashboard-url';
import { CLEARED, isCleared, withPreset } from './components/fleet-dashboard/period-filter-bar';
import { ALL_KEYS, B1, T1, TODAY, ar } from './fleet-dashboard-fixtures';
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
  WS_COMPANY,
  WT_SERVICE,
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
const column = (html: string, key: string): string =>
  slice(html, 'data-km-column', key, 'data-km-column=');
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
          accidents: { count: 4, open: 2, openRemaining: 9800, undated: null },
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
          opex: { card: 1, custody: 1, total: 2, count: 2, dataFrom: '2026-10-10' },
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

// ── Tab 7 ─────────────────────────────────────────────────────────────────────────────────────

describe('tab 7 «الكيلومترات» — the R-15 drawing', () => {
  const html = renderPeriod({ url: URL_30('km') });
  const body = tabBody(html, 'km');

  it('draws a day without any reading as an empty slot, never a bar', () => {
    const empty = column(body, EMPTY_DAY);
    expect(empty).toContain('data-km-part="empty"');
    expect(empty).not.toContain('data-km-part="solid"');
    expect(empty).not.toContain('data-metric');
  });

  it('never draws today solid: it is hatched, waiting for its readings', () => {
    const today = column(body, TODAY);
    expect(today).toContain('data-km-part="open"');
    expect(today).not.toContain('data-km-part="solid"');
  });

  it('keeps a stale day solid, with its marker', () => {
    const stale = column(body, STALE_DAY);
    expect(stale).toContain('data-km-part="solid"');
    expect(stale).toContain('data-km-part="stale"');
    expect(stale).not.toContain('data-km-part="open"');
  });

  it('hatches an unfinished day above its confirmed part', () => {
    const pending = column(body, PENDING_DAY);
    expect(pending).toContain('data-km-part="solid"');
    expect(pending).toContain('data-km-part="open"');
  });

  it('stacks the span on its start day, outlined and never in the confirmed colour', () => {
    const start = column(body, SPAN_DAY);
    expect(start).toContain('data-km-part="span"');
    const span = /<span data-km-part="span" class="([^"]*)"/u.exec(start)?.[1] ?? '';
    expect(span).toContain('border-dashed');
    expect(span).not.toMatch(/emerald/u);
  });

  it('opens each day on the odometer screen over that day and the filters', () => {
    expect(column(body, SPAN_DAY)).toContain(
      `href="/fleet/odometer?from=${SPAN_DAY}&amp;to=${SPAN_DAY}"`,
    );
    // 30 days, one without any reading: 29 columns open a day (the readout's figure is the 30th link).
    expect(body.match(/<a\b[^>]*data-km-column=/gu)).toHaveLength(29);
    expect(hrefs(body, 'km.day')).toHaveLength(30);
  });

  it('draws the average line and names the closed days it is over', () => {
    expect(body).toContain('data-km-average="true"');
    expect(text(body)).toContain('28 يومًا مغلقًا');
    expect(text(body)).toContain('2026/10/30');
  });

  it('notes the unfinished days, the empty day, the spans and the stale cars', () => {
    const notes = text(slice(body, 'data-km-notes', 'true', 'data-period-card'));
    expect(notes).toContain('2026/10/31');
    expect(notes).toContain('2026/10/09');
    expect(notes).toContain(ar('fleet.dash.km.notes.openToday').replace(' {{day}}', ''));
    expect(body).toContain('data-km-spans="true"');
    expect(body).toContain('data-km-stale="true"');
  });

  it('splits the total by the current branch, with «غير مسجّلة», each branch opening its screen', () => {
    const branches = slice(body, 'data-period-card', 'km.byBranch', 'data-period-card');
    expect(hrefOf(branches, 'km.byBranch')).toBe(`/fleet/odometer?${DATES}&branch=${B1}`);
    expect(hrefs(branches, 'km.byBranch')).toHaveLength(2);
    expect(text(branches)).toContain(ar('fleet.dash.km.unregistered'));
    expect(text(branches)).toContain(KM.format(UNREGISTERED_KM));
    expect(text(branches)).toContain(ar('fleet.dash.km.noBranch'));
    expect(hrefOf(branches, 'km.total')).toBe(`/fleet/odometer?${DATES}`);
  });

  it('adds the by-type card only when the server gives it (a branch is chosen)', () => {
    expect(body).not.toContain('data-period-card="km.byType"');
    const typed = tabBody(
      renderPeriod({
        url: URL_30('km'),
        dto: {
          ...PERIOD_FULL,
          vehicleScope: {
            count: 20,
            typeIds: [],
            operationIds: [],
            vehicleCodes: [],
            branchId: B1,
          },
          km: {
            ...(PERIOD_FULL.km as NonNullable<FleetDashboardPeriodDto['km']>),
            byType: [{ typeId: T1, name: { ar: 'مصفحة', en: 'Armoured' }, km: 9000 }],
            unregistered: null,
          },
        },
      }),
      'km',
    );
    const byType = slice(typed, 'data-period-card', 'km.byType', 'data-period-card');
    expect(hrefOf(byType, 'km.byType')).toBe(`/fleet/odometer?${DATES}&type=${T1}&branch=${B1}`);
  });

  it('goes by the month above 31 days, with no per-day average line over month totals', () => {
    const year = tabBody(
      renderPeriod({ url: '/fleet?tab=km&period=thisYear', dto: PERIOD_YEAR }),
      'km',
    );
    expect(year).toContain('data-km-chart="month"');
    expect(year).not.toContain('data-km-average');
    expect(text(year)).toContain('2026/01');
    expect(column(year, '2026-01')).toContain(
      'href="/fleet/odometer?from=2026-01-01&amp;to=2026-01-31',
    );
    expect(column(year, '2026-02')).toContain('data-km-part="empty"');
    expect(column(year, '2026-11')).toContain('data-km-part="open"');
    expect(text(year)).toContain(ar('fleet.dash.km.chart.monthly'));
  });
});

// ── Tab 8 ─────────────────────────────────────────────────────────────────────────────────────

describe('tab 8 «ترتيب السيارات»', () => {
  const body = tabBody(renderPeriod({ url: URL_30('ranking') }), 'ranking');

  it('ranks the five top and five bottom cars, each opening its readings over the period', () => {
    expect(body).toContain('data-rank="top-1"');
    expect(body).toContain('data-rank="bottom-5"');
    expect(hrefs(body, 'km.top')[0]).toBe(`/fleet/odometer?vehicleCodes=182&${DATES}`);
    expect(hrefs(body, 'km.bottom')[0]).toBe(`/fleet/odometer?vehicleCodes=141&${DATES}`);
    expect(hrefOf(body, 'km.topVehicle')).toBe('/fleet/vehicles/v182');
  });

  it('says how long a bottom car has been in the workshop, «منذ N أيام» only', () => {
    expect(body).toContain('data-in-workshop="2026-10-23"');
    expect(text(body)).toContain('في الورشة منذ 9 أيام');
  });

  it('lists every car without a valid reading with its reason, and never ranks it', () => {
    const out = slice(body, 'data-without-readings', 'true', 'data-dash-tab-body');
    for (const reason of ['noRow', 'onlyOpen', 'notActive'] as const) {
      expect(out).toContain(`data-reason="${reason}"`);
      expect(text(out)).toContain(ar(`fleet.dash.ranking.reason.${reason}`));
    }
    expect(body).not.toContain('data-rank="top-6"');
    expect(hrefs(out, 'km.withoutReadings')).toEqual([
      '/fleet/vehicles/v318',
      '/fleet/vehicles/v305',
      '/fleet/vehicles/v260',
    ]);
  });

  it('names a car whose only readings need review, right after the days without a counter', () => {
    const km = PERIOD_FULL.km as NonNullable<FleetDashboardPeriodDto['km']>;
    const dto: FleetDashboardPeriodDto = {
      ...PERIOD_FULL,
      km: {
        ...km,
        withoutReadings: [
          ...km.withoutReadings,
          { vehicleId: 'v209', code: '209', reason: 'onlyInvalid' },
        ],
      },
    };
    const out = slice(
      tabBody(renderPeriod({ url: URL_30('ranking'), dto }), 'ranking'),
      'data-without-readings',
      'true',
      'data-dash-tab-body',
    );
    expect(out).toContain('data-reason="onlyInvalid"');
    expect(text(out)).toContain(ar('fleet.dash.ranking.reason.onlyInvalid'));
    expect(out.indexOf('data-reason="onlyOpen"')).toBeLessThan(
      out.indexOf('data-reason="onlyInvalid"'),
    );
    expect(out.indexOf('data-reason="onlyInvalid"')).toBeLessThan(
      out.indexOf('data-reason="notActive"'),
    );
  });

  it('links no car record for a reader without the registry', () => {
    const blind = tabBody(
      renderPeriod({
        url: URL_30('ranking'),
        permissions: ALL_KEYS.filter((k) => k !== 'fleetVehicle.view'),
      }),
      'ranking',
    );
    expect(links(blind).filter((l) => l.href.startsWith('/fleet/vehicles/'))).toEqual([]);
    expect(hrefs(blind, 'km.top')).toHaveLength(5);
  });
});

// ── Tab 9 ─────────────────────────────────────────────────────────────────────────────────────

describe('tab 9 «الصيانة»', () => {
  const body = tabBody(renderPeriod({ url: URL_30('maintenance') }), 'maintenance');

  it('opens each work type, workshop and car on the maintenance screen over the period', () => {
    expect(hrefOf(body, 'visits.byWorkType')).toBe(
      `/fleet/maintenance?${DATES}&workTypes=${WT_SERVICE}`,
    );
    expect(hrefs(body, 'visits.byWorkType')).toHaveLength(5);
    expect(hrefOf(body, 'visits.byWorkshop')).toBe(
      `/fleet/maintenance?${DATES}&workshops=${WS_COMPANY}`,
    );
    expect(hrefOf(body, 'visits.topVehicle')).toBe(`/fleet/maintenance?${DATES}&vehicleCodes=182`);
    expect(text(body)).toContain(ar('fleet.dash.maintenance.unnamed'));
    expect(text(body)).toContain(ar('fleet.dash.maintenance.lastToday'));
  });

  it('carries no money anywhere, and says where the cost is', () => {
    expect(text(body)).not.toContain('ج.م.');
    expect(body).toContain('data-no-money="true"');
    expect(text(body)).toContain(ar('fleet.dash.maintenance.noMoney'));
  });
});

// ── Tab 10 ────────────────────────────────────────────────────────────────────────────────────

describe('tab 10 «الحوادث»', () => {
  const body = tabBody(renderPeriod({ url: URL_30('accidents') }), 'accidents');

  it('heads the list with the period’s count, the open files and their outstanding (= tab 6)', () => {
    expect(hrefOf(body, 'accidents.count')).toBe(`/fleet/accidents?${DATES}`);
    expect(hrefOf(body, 'accidents.open')).toBe(`/fleet/accidents?${DATES}&status=open`);
    expect(text(body)).toContain('9,800.00');
  });

  it('shows each accident’s date only, never a time, and opens it on its car and day', () => {
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      const row = text(slice(body, 'data-accident-row', id, 'data-accident-row'));
      expect(row).not.toMatch(/\d{1,2}:\d{2}/u);
    }
    expect(hrefs(body, 'accidentList.row')[0]).toBe(
      '/fleet/accidents?vehicleCodes=207&from=2026-10-27&to=2026-10-27',
    );
    expect(text(body)).toContain('2026/10/06');
  });

  it('puts the driver card only on a culprit who is one of ours; the text as written otherwise', () => {
    expect(slice(body, 'data-accident-row', 'a1', 'data-accident-row')).toContain(
      'data-culprit="driver"',
    );
    expect(slice(body, 'data-accident-row', 'a2', 'data-accident-row')).toContain(
      'data-culprit="text"',
    );
    expect(text(slice(body, 'data-accident-row', 'a4', 'data-accident-row'))).toContain(
      ar('fleet.dash.licences.noCulprit'),
    );
  });

  it('opens the rest of the list in the log when there are more than the rows shown', () => {
    expect(hrefs(body, 'accidentList.more')).toEqual([]);
    const more = tabBody(
      renderPeriod({
        url: URL_30('accidents'),
        dto: {
          ...PERIOD_FULL,
          accidentList: {
            ...(PERIOD_FULL.accidentList as NonNullable<FleetDashboardPeriodDto['accidentList']>),
            more: 3,
          },
        },
      }),
      'accidents',
    );
    expect(hrefOf(more, 'accidentList.more')).toBe(`/fleet/accidents?${DATES}`);
    expect(hrefOf(more, 'accidentList.all')).toBe(`/fleet/accidents?${DATES}`);
  });
});

// ── The filter bar and the one filter state ───────────────────────────────────────────────────

describe('the filter bar — one state for the five tabs', () => {
  const tabs = ['period', 'km', 'ranking', 'maintenance', 'accidents'] as const;

  it('stands at the top of every period tab, with the same filters and the echoed range', () => {
    for (const tab of tabs) {
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
    expect(renderPeriodTab({ tab: 'km', loading: true })).toContain('data-dash-loading="true"');
    const failed = renderPeriodTab({ tab: 'km', error: true });
    expect(failed).toContain('data-dash-read-error="true"');
    expect(failed).toContain('data-period-filters="true"');
  });

  it('keeps the shell’s hand-over: the tab’s heading and its range', () => {
    const html = renderPeriodTab({ tab: 'maintenance', data: PERIOD_FULL });
    expect(html).toContain('data-period-tab="maintenance"');
    expect(html).toContain(ar('fleet.dash.shell.tab.maintenance'));
    expect(html).toContain('data-period-range="true"');
  });

  it('draws no Phase-2 piece and names every figure after a period section', () => {
    const sections = new Set(['km', 'visits', 'accidents', 'accidentList', 'opex', 'dealership']);
    for (const tab of ['period', 'km', 'ranking', 'maintenance', 'accidents']) {
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
