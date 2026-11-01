// The dashboard's shared rules, pinned (plan §9 "contracts unit"): the period presets on the Cairo
// day, the period query, the expiry states and licence windows, the paper stage, the granularity
// lifted from custody, and the gate table every section, tab and route guard is derived from.
import { describe, expect, it } from 'vitest';
import { addDaysYmd, cairoYmd, calendarDayBounds } from '../common/cairo-date.js';
import {
  FLEET_DASHBOARD_ALERTS,
  FLEET_DASHBOARD_DEFAULT_PRESET,
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_MAX_CUSTOM_DAYS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_NOW_SECTIONS,
  FLEET_DASHBOARD_NOW_TABS,
  FLEET_DASHBOARD_PAGE_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_PERIOD_SECTIONS,
  FLEET_DASHBOARD_PERIOD_TABS,
  FLEET_DASHBOARD_PRESETS,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_SECTIONS,
  FLEET_LICENCE_GREY_DAYS,
  FLEET_LICENSING_PAPERS,
  FleetDashboardPeriodQuerySchema,
  expiryStateOn,
  fleetDashboardGateKeys,
  licenceWindows,
  paperStage,
  periodGranularity,
  periodOf,
  type FleetDashboardSection,
} from './fleet-dashboard.js';
import {
  FLEET_DRIVER_LICENCE_STATES,
  FLEET_DRIVER_UNAVAILABLE_REASONS,
  FleetAccidentSummaryQuerySchema,
  FleetDealershipSummaryQuerySchema,
  FleetFuelCardSummaryQuerySchema,
  FleetOdometerSummaryQuerySchema,
  FleetReceiptSummaryQuerySchema,
  FleetSettingKeys,
  FleetViolationRollupQuerySchema,
  ListFleetAccidentsQuerySchema,
  ListFleetDealershipInvoicesQuerySchema,
  ListFleetDriversQuerySchema,
  ListFleetFuelCardsQuerySchema,
  ListFleetMaintenanceQuerySchema,
  ListFleetOdometerQuerySchema,
  ListFleetReceiptsQuerySchema,
  ListFleetViolationsQuerySchema,
} from './fleet.js';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);

// ── R-01 presets ────────────────────────────────────────────────────────────

describe('periodOf — R-01 presets on the Cairo day', () => {
  it('reads "today" in Cairo: 22:30Z on 31 October is already 1 November', () => {
    const today = cairoYmd(new Date('2026-10-31T22:30:00Z'));
    expect(today).toBe('2026-11-01');
    expect(periodOf('thisMonth', today)).toEqual({
      preset: 'thisMonth',
      from: '2026-11-01',
      to: '2026-11-01',
      days: 1,
    });
    expect(periodOf('lastMonth', today)).toEqual({
      preset: 'lastMonth',
      from: '2026-10-01',
      to: '2026-10-31',
      days: 31,
    });
  });

  it('every preset on 2026-11-01', () => {
    const today = '2026-11-01';
    expect(periodOf('last30', today)).toEqual({
      preset: 'last30',
      from: '2026-10-03',
      to: '2026-11-01',
      days: 30,
    });
    expect(periodOf('thisYear', today)).toEqual({
      preset: 'thisYear',
      from: '2026-01-01',
      to: '2026-11-01',
      days: 305,
    });
    expect(periodOf('custom', today, { from: '2026-09-15', to: '2026-10-14' })).toEqual({
      preset: 'custom',
      from: '2026-09-15',
      to: '2026-10-14',
      days: 30,
    });
  });

  it('every preset on 2026-03-01 (the previous month is a 28-day February)', () => {
    const today = '2026-03-01';
    expect(periodOf('thisMonth', today)).toMatchObject({ from: '2026-03-01', to: today, days: 1 });
    expect(periodOf('lastMonth', today)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      days: 28,
    });
    expect(periodOf('last30', today)).toMatchObject({ from: '2026-01-31', to: today, days: 30 });
    expect(periodOf('thisYear', today)).toMatchObject({ from: '2026-01-01', to: today, days: 60 });
  });

  it('every preset on 2028-03-01 (a leap February)', () => {
    const today = '2028-03-01';
    expect(periodOf('thisMonth', today)).toMatchObject({ from: '2028-03-01', to: today, days: 1 });
    expect(periodOf('lastMonth', today)).toMatchObject({
      from: '2028-02-01',
      to: '2028-02-29',
      days: 29,
    });
    expect(periodOf('last30', today)).toMatchObject({ from: '2028-02-01', to: today, days: 30 });
    expect(periodOf('thisYear', today)).toMatchObject({ from: '2028-01-01', to: today, days: 61 });
  });

  it('the previous month of January is last December', () => {
    expect(periodOf('lastMonth', '2027-01-15')).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
      days: 31,
    });
    expect(periodOf('thisYear', '2027-01-01')).toMatchObject({
      from: '2027-01-01',
      to: '2027-01-01',
      days: 1,
    });
  });

  it('a custom range is read only with the custom preset', () => {
    expect(periodOf('thisMonth', '2026-11-20', { from: '2026-01-01', to: '2026-01-02' })).toEqual({
      preset: 'thisMonth',
      from: '2026-11-01',
      to: '2026-11-20',
      days: 20,
    });
  });

  it('accepts 366 inclusive days and refuses 367, a reversed range and a missing one', () => {
    expect(periodOf('custom', '2028-12-31', { from: '2028-01-01', to: '2028-12-31' }).days).toBe(
      FLEET_DASHBOARD_MAX_CUSTOM_DAYS,
    );
    expect(() =>
      periodOf('custom', '2027-01-02', { from: '2026-01-01', to: '2027-01-02' }),
    ).toThrow(RangeError);
    expect(() =>
      periodOf('custom', '2026-11-01', { from: '2026-11-02', to: '2026-11-01' }),
    ).toThrow(RangeError);
    expect(() => periodOf('custom', '2026-11-01')).toThrow(RangeError);
    expect(() =>
      periodOf('custom', '2026-11-01', { from: '2026-02-30', to: '2026-03-01' }),
    ).toThrow(RangeError);
  });

  it('refuses a "today" that is not a real date', () => {
    expect(() => periodOf('thisMonth', '2026-11-1')).toThrow(RangeError);
  });
});

// ── The period query ────────────────────────────────────────────────────────

describe('FleetDashboardPeriodQuerySchema', () => {
  const parse = (query: Record<string, unknown>) =>
    FleetDashboardPeriodQuerySchema.safeParse(query);

  it('defaults to thisMonth and carries nothing else', () => {
    expect(FLEET_DASHBOARD_DEFAULT_PRESET).toBe('thisMonth');
    const result = parse({});
    expect(result.success && result.data).toEqual({ preset: 'thisMonth' });
  });

  it('accepts every named preset without dates', () => {
    for (const preset of FLEET_DASHBOARD_PRESETS.filter((p) => p !== 'custom')) {
      expect(parse({ preset }).success, preset).toBe(true);
    }
  });

  it('refuses custom without both dates', () => {
    expect(parse({ preset: 'custom' }).success).toBe(false);
    expect(parse({ preset: 'custom', from: '2026-10-01' }).success).toBe(false);
    expect(parse({ preset: 'custom', to: '2026-10-31' }).success).toBe(false);
    expect(parse({ preset: 'custom', from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
  });

  it('refuses dates with a non-custom preset (and with the default one)', () => {
    expect(parse({ preset: 'thisMonth', from: '2026-10-01' }).success).toBe(false);
    expect(parse({ preset: 'last30', to: '2026-10-31' }).success).toBe(false);
    expect(parse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(false);
  });

  it('refuses from after to, and a day that does not exist', () => {
    expect(parse({ preset: 'custom', from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(parse({ preset: 'custom', from: '2026-11-01', to: '2026-11-01' }).success).toBe(true);
    expect(parse({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(
      parse({ preset: 'custom', from: '2026-10-01T00:00:00Z', to: '2026-10-31' }).success,
    ).toBe(false);
  });

  it('accepts 366 inclusive days and refuses 367', () => {
    expect(parse({ preset: 'custom', from: '2028-01-01', to: '2028-12-31' }).success).toBe(true);
    expect(parse({ preset: 'custom', from: '2026-01-01', to: '2027-01-01' }).success).toBe(true);
    expect(parse({ preset: 'custom', from: '2026-01-01', to: '2027-01-02' }).success).toBe(false);
  });

  it('is strict: an unknown parameter is refused, never ignored', () => {
    expect(parse({ preset: 'thisMonth', branchIds: ID_A }).success).toBe(false);
    expect(parse({ page: '1' }).success).toBe(false);
    expect(parse({ preset: 'yesterday' }).success).toBe(false);
  });

  it('parses the vehicle filter: id lists and codes', () => {
    const result = parse({
      preset: 'lastMonth',
      typeIds: `${ID_A},${ID_B}`,
      operationIds: ID_A,
      vehicleCodes: '150, 151,150',
    });
    expect(result.success && result.data).toEqual({
      preset: 'lastMonth',
      typeIds: [ID_A, ID_B],
      operationIds: [ID_A],
      vehicleCodes: ['150', '151'],
    });
    expect(parse({ typeIds: 'not-an-id' }).success).toBe(false);
    // Empty means "not narrowed", as on every list.
    const cleared = parse({ typeIds: '', vehicleCodes: '' });
    expect(cleared.success && cleared.data).toEqual({ preset: 'thisMonth' });
  });
});

// ── R-02 / R-10 documents ───────────────────────────────────────────────────

describe('expiryStateOn — R-02 (expired ON the expiry day)', () => {
  const today = '2026-11-01';

  it('is expired on the expiry day itself, whatever the stored instant', () => {
    expect(expiryStateOn('2026-11-01T00:00:00.000Z', today, 30)).toBe('expired');
    expect(expiryStateOn('2026-11-01T10:00:00Z', today, 30)).toBe('expired');
    expect(expiryStateOn(new Date('2026-11-01T00:00:00.000Z'), today, 30)).toBe('expired');
    expect(expiryStateOn('2026-10-01', today, 30)).toBe('expired');
  });

  it('is expiring the day before, up to today + W, then valid', () => {
    expect(expiryStateOn('2026-11-02T00:00:00.000Z', today, 30)).toBe('expiring');
    expect(expiryStateOn('2026-12-01', today, 30)).toBe('expiring');
    expect(expiryStateOn('2026-12-02', today, 30)).toBe('valid');
    expect(expiryStateOn('2026-11-02', '2026-11-01', 1)).toBe('expiring');
    expect(expiryStateOn('2026-11-03', '2026-11-01', 1)).toBe('valid');
  });

  it('a missing date is not recorded — neither expired nor valid', () => {
    expect(expiryStateOn(null, today, 30)).toBe('notRecorded');
    expect(expiryStateOn(undefined, today, 30)).toBe('notRecorded');
  });
});

describe('licenceWindows + calendarDayBounds — R-10 buckets', () => {
  const today = '2026-11-01';

  it('names the three windows as days', () => {
    expect(licenceWindows(today, 30)).toEqual({
      expired: { to: '2026-11-01' },
      expiring: { from: '2026-11-02', to: '2026-12-01' },
      soon: { from: '2026-12-02', to: '2026-12-31' },
    });
    expect(FLEET_LICENCE_GREY_DAYS).toBe(60);
  });

  it('has no grey window when W reaches 60', () => {
    expect(licenceWindows(today, 60).soon).toBeNull();
    expect(licenceWindows(today, 90).soon).toBeNull();
    expect(licenceWindows(today, 59).soon).toEqual({ from: '2026-12-31', to: '2026-12-31' });
  });

  it('an expiry stamped 2026-11-01T10:00Z is expired on 2026-11-01 and in no other window', () => {
    const w = licenceWindows(today, 30);
    const stamped = new Date('2026-11-01T10:00:00Z').getTime();
    const expiredBefore = calendarDayBounds(w.expired.to, w.expired.to).before.getTime();
    expect(stamped <= expiredBefore).toBe(true);
    const expiring = calendarDayBounds(w.expiring.from, w.expiring.to);
    expect(stamped >= expiring.from.getTime()).toBe(false);
    const soon = w.soon === null ? null : calendarDayBounds(w.soon.from, w.soon.to);
    expect(soon !== null && stamped >= soon.from.getTime()).toBe(false);
    expect(expiryStateOn('2026-11-01T10:00:00Z', today, 30)).toBe('expired');
  });

  it('the windows are contiguous and disjoint, and agree with expiryStateOn on every instant', () => {
    for (const warnDays of [1, 30, 45, 59, 60, 90]) {
      const w = licenceWindows(today, warnDays);
      expect(addDaysYmd(w.expired.to, 1)).toBe(w.expiring.from);
      if (w.soon !== null) {
        expect(addDaysYmd(w.expiring.to, 1)).toBe(w.soon.from);
        expect(w.soon.to).toBe(addDaysYmd(today, FLEET_LICENCE_GREY_DAYS));
      }
      const expiredBefore = calendarDayBounds(w.expired.to, w.expired.to).before.getTime();
      const expiring = calendarDayBounds(w.expiring.from, w.expiring.to);
      const soon = w.soon === null ? null : calendarDayBounds(w.soon.from, w.soon.to);
      for (let offset = -3; offset <= 95; offset += 1) {
        const day = addDaysYmd(today, offset);
        for (const time of ['00:00:00.000', '10:00:00.000', '23:59:59.999']) {
          const iso = `${day}T${time}Z`;
          const instant = new Date(iso).getTime();
          const inExpired = instant <= expiredBefore;
          const inExpiring =
            instant >= expiring.from.getTime() && instant <= expiring.before.getTime();
          const inSoon =
            soon !== null && instant >= soon.from.getTime() && instant <= soon.before.getTime();
          const hits = [inExpired, inExpiring, inSoon].filter(Boolean).length;
          expect(hits, `${iso} W=${warnDays}`).toBeLessThanOrEqual(1);
          const state = expiryStateOn(iso, today, warnDays);
          expect(inExpired, iso).toBe(state === 'expired');
          expect(inExpiring, iso).toBe(state === 'expiring');
          // Every dated licence up to today + 60 (or + W, when the yellow window reaches past
          // 60) falls in exactly one window; anything later in none.
          const reach = Math.max(FLEET_LICENCE_GREY_DAYS, warnDays);
          if (offset <= reach) expect(hits, iso).toBe(1);
          else expect(hits, iso).toBe(0);
        }
      }
    }
  });
});

describe('paperStage — R-11, the licensing page’s own rule', () => {
  const ticks = (
    over: Partial<
      Record<'insuranceHandover' | 'insuranceReceipt' | 'taxHandover' | 'taxReceipt', boolean>
    > = {},
  ) => ({
    insuranceHandover: false,
    insuranceReceipt: false,
    taxHandover: false,
    taxReceipt: false,
    ...over,
  });
  const [insurance, tax] = FLEET_LICENSING_PAPERS;

  it('declares the two papers and their ticks', () => {
    expect(FLEET_LICENSING_PAPERS.map((paper) => paper.key)).toEqual(['insurance', 'tax']);
  });

  it('answers none / open / done and nothing else', () => {
    expect(paperStage(ticks(), insurance)).toBe('none');
    expect(paperStage(ticks({ insuranceHandover: true }), insurance)).toBe('open');
    expect(paperStage(ticks({ insuranceHandover: true, insuranceReceipt: true }), insurance)).toBe(
      'done',
    );
  });

  it('calls a lone «استلام» half-done (open) rather than nothing', () => {
    expect(paperStage(ticks({ insuranceReceipt: true }), insurance)).toBe('open');
    expect(paperStage(ticks({ taxReceipt: true }), tax)).toBe('open');
  });

  it('reads each paper’s own ticks only', () => {
    const row = ticks({ insuranceHandover: true, insuranceReceipt: true, taxHandover: true });
    expect(paperStage(row, insurance)).toBe('done');
    expect(paperStage(row, tax)).toBe('open');
    expect(paperStage(ticks({ insuranceHandover: true }), tax)).toBe('none');
  });
});

describe('periodGranularity — the old custodyGranularity, on its own cases', () => {
  const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  it('goes by the day only when both dates are chosen and a month at most apart', () => {
    expect(periodGranularity({ from: d('2026-10-01'), to: d('2026-10-31') })).toBe('day');
    expect(periodGranularity({ from: d('2026-02-01'), to: d('2026-03-04') })).toBe('day');
    expect(periodGranularity({ from: d('2026-10-01'), to: d('2026-10-01') })).toBe('day');
    expect(periodGranularity({ from: d('2026-10-01'), to: d('2026-11-02') })).toBe('month');
    expect(periodGranularity({ from: d('2026-10-01') })).toBe('month');
    expect(periodGranularity({ to: d('2026-10-31') })).toBe('month');
    expect(periodGranularity({})).toBe('month');
    // Turned round, the filter matches nothing — no day-by-day of a negative span.
    expect(periodGranularity({ from: d('2026-10-31'), to: d('2026-10-01') })).toBe('month');
  });

  it('a 31-day month is drawn by the day, a full year by the month', () => {
    expect(periodGranularity({ from: d('2026-10-01'), to: d('2026-11-01') })).toBe('day');
    expect(periodGranularity({ from: d('2026-01-01'), to: d('2026-11-01') })).toBe('month');
  });
});

// ── Sections, gates, tabs, alerts ───────────────────────────────────────────

const ALL_SECTIONS: FleetDashboardSection[] = [
  ...FLEET_DASHBOARD_NOW_SECTIONS,
  ...FLEET_DASHBOARD_PERIOD_SECTIONS,
  'custodyFund',
];

/** The plan's gate table (unified.md §2.3), row by row. */
const TABLE: Record<
  FleetDashboardSection,
  [read: string, api: string, page: string, path: string]
> = {
  vehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  distributionVehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  licenceVehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  roster: ['now', 'fleetRoster.view', 'fleetRoster.view', '/fleet/roster'],
  workshop: ['now', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
  recentWorkshop: ['now', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
  maintenanceAlarm: [
    'now',
    'fleetOdometer.view',
    'fleetOdometer.view',
    '/fleet/maintenance-alarms',
  ],
  noReading: ['now', 'fleetOdometer.view', 'fleetOdometer.view', '/fleet/odometer'],
  distributionDrivers: ['now', 'fleetDriver.view', 'fleetDriver.view', '/fleet/drivers'],
  licenceDrivers: ['now', 'fleetDriver.view', 'fleetDriver.view', '/fleet/drivers'],
  papers: ['now', 'fleetLicensing.view', 'fleetLicensing.view', '/fleet/licensing'],
  fuelCards: ['now', 'fleetFuelCard.view', 'fleetFuelCard.view', '/fleet/fuel-cards'],
  fuelCharging: ['now', 'fleetFuelCard.view', 'fleetFuelCharge.view', '/fleet/fuel-cards/charging'],
  recentAccidents: ['now', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  accidentsOpen: ['now', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  notices: ['now', 'fleetNotice.view', 'fleetNotice.view', '/fleet/notices'],
  dealershipPending: ['now', 'fleetDealership.view', 'fleetDealership.view', '/fleet/dealership'],
  violationsYear: ['now', 'fleetViolation.view', 'fleetViolation.view', '/fleet/violations'],
  km: ['period', 'fleetOdometer.view', 'fleetOdometer.view', '/fleet/odometer'],
  visits: ['period', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
  accidents: ['period', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  accidentList: ['period', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  opex: ['period', 'fleetReceipt.view', 'fleetReceipt.view', '/fleet/receipts'],
  dealership: ['period', 'fleetDealership.view', 'fleetDealership.view', '/fleet/dealership'],
  custodyFund: ['web', 'fleetCustody.view', 'fleetCustody.view', '/fleet/custody/dashboard'],
};

const sorted = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();

describe('the gate table', () => {
  it('gives every section exactly the gate the plan names, and nothing more', () => {
    expect(Object.keys(FLEET_DASHBOARD_GATES).sort()).toEqual([...ALL_SECTIONS].sort());
    for (const section of ALL_SECTIONS) {
      const [read, api, page, path] = TABLE[section];
      expect(FLEET_DASHBOARD_GATES[section], section).toEqual({
        read,
        api: [api],
        page: [page],
        path,
      });
    }
  });

  it('reads the now sections from R1, the period sections from R2 and custody in the browser', () => {
    for (const section of FLEET_DASHBOARD_NOW_SECTIONS) {
      expect(FLEET_DASHBOARD_GATES[section].read, section).toBe('now');
    }
    for (const section of FLEET_DASHBOARD_PERIOD_SECTIONS) {
      expect(FLEET_DASHBOARD_GATES[section].read, section).toBe('period');
    }
    expect(FLEET_DASHBOARD_GATES.custodyFund.read).toBe('web');
  });

  it('needs BOTH keys for fuel charging: the cards’ data and the charging screen', () => {
    expect(sorted(fleetDashboardGateKeys('fuelCharging'))).toEqual([
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
    ]);
    expect(fleetDashboardGateKeys('fuelCards')).toEqual(['fleetFuelCard.view']);
  });

  it('the unions equal the table', () => {
    const union = (read: string | null): string[] =>
      sorted(
        ALL_SECTIONS.filter((s) => read === null || TABLE[s][0] === read).flatMap((s) => [
          TABLE[s][1],
          TABLE[s][2],
        ]),
      );
    expect(sorted(FLEET_DASHBOARD_NOW_KEYS)).toEqual(union('now'));
    expect(sorted(FLEET_DASHBOARD_PERIOD_KEYS)).toEqual(union('period'));
    expect(sorted(FLEET_DASHBOARD_PAGE_KEYS)).toEqual(union(null));
    // No key twice in a union.
    for (const keys of [
      FLEET_DASHBOARD_NOW_KEYS,
      FLEET_DASHBOARD_PERIOD_KEYS,
      FLEET_DASHBOARD_PAGE_KEYS,
    ]) {
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(FLEET_DASHBOARD_PAGE_KEYS).toContain('fleetCustody.view');
    expect(FLEET_DASHBOARD_NOW_KEYS).not.toContain('fleetCustody.view');
    expect(FLEET_DASHBOARD_NOW_KEYS).toContain('fleetFuelCharge.view');
    expect(FLEET_DASHBOARD_PERIOD_KEYS).not.toContain('fleetRoster.view');
  });

  it('is frozen: nothing at runtime can widen a gate', () => {
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES.roster)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_PAGE_KEYS)).toBe(true);
  });
});

describe('tabs and their sections', () => {
  it('ten tabs: five read now, five by the filters, in the navbar’s order', () => {
    expect(FLEET_DASHBOARD_TABS).toEqual([
      ...FLEET_DASHBOARD_NOW_TABS,
      ...FLEET_DASHBOARD_PERIOD_TABS,
    ]);
    expect(FLEET_DASHBOARD_TABS).toHaveLength(10);
  });

  it('maps every tab to at least one real section', () => {
    expect(Object.keys(FLEET_DASHBOARD_TAB_SECTIONS).sort()).toEqual(
      [...FLEET_DASHBOARD_TABS].sort(),
    );
    for (const tab of FLEET_DASHBOARD_TABS) {
      const sections = FLEET_DASHBOARD_TAB_SECTIONS[tab];
      expect(sections.length, tab).toBeGreaterThan(0);
      for (const section of sections) expect(ALL_SECTIONS, `${tab}:${section}`).toContain(section);
    }
  });

  it('a now tab shows now sections (custody included); a period tab shows period sections', () => {
    for (const tab of FLEET_DASHBOARD_NOW_TABS) {
      for (const section of FLEET_DASHBOARD_TAB_SECTIONS[tab]) {
        expect(['now', 'web'], `${tab}:${section}`).toContain(FLEET_DASHBOARD_GATES[section].read);
      }
    }
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      for (const section of FLEET_DASHBOARD_TAB_SECTIONS[tab]) {
        expect(FLEET_DASHBOARD_GATES[section].read, `${tab}:${section}`).toBe('period');
      }
    }
  });

  it('pins the plan’s mapping', () => {
    expect(FLEET_DASHBOARD_TAB_SECTIONS).toEqual({
      alerts: [
        'maintenanceAlarm',
        'licenceVehicles',
        'licenceDrivers',
        'fuelCards',
        'roster',
        'fuelCharging',
        'dealershipPending',
        'notices',
        'noReading',
        'custodyFund',
      ],
      now: ['vehicles', 'roster', 'workshop'],
      distribution: ['distributionVehicles', 'distributionDrivers'],
      licences: [
        'licenceVehicles',
        'licenceDrivers',
        'papers',
        'fuelCards',
        'recentWorkshop',
        'recentAccidents',
      ],
      summaries: ['fuelCharging', 'custodyFund', 'accidentsOpen', 'violationsYear'],
      period: ['km', 'visits', 'accidents', 'opex', 'dealership'],
      km: ['km'],
      ranking: ['km'],
      maintenance: ['visits'],
      accidents: ['accidents', 'accidentList'],
    });
  });
});

describe('the alerts of tab 1', () => {
  it('names a real now section for every alert, each id once, red before orange', () => {
    const ids = FLEET_DASHBOARD_ALERTS.map((alert) => alert.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const alert of FLEET_DASHBOARD_ALERTS) {
      expect(FLEET_DASHBOARD_NOW_SECTIONS, alert.id).toContain(alert.section);
      expect(FLEET_DASHBOARD_TAB_SECTIONS.alerts, alert.id).toContain(alert.section);
    }
    const levels = FLEET_DASHBOARD_ALERTS.map((alert) => alert.level);
    expect(levels.indexOf('orange')).toBe(levels.lastIndexOf('red') + 1);
  });

  it('pins the display order (the web inserts custody after the notices line)', () => {
    expect(FLEET_DASHBOARD_ALERTS.map((alert) => `${alert.level}:${alert.id}`)).toEqual([
      'red:maintenanceRed',
      'red:vehicleLicenceExpired',
      'red:driverLicenceExpired',
      'red:fuelCardExpired',
      'orange:crewAbsent',
      'orange:fuelRequests',
      'orange:fuelLow',
      'orange:dealershipPending',
      'orange:noticesMissing',
      'orange:noReading',
    ]);
  });
});

// ── §2.2 additions to the fleet contracts ───────────────────────────────────

describe('the fleet contracts the dashboard links through (plan §2.2)', () => {
  it('declares the two new settings', () => {
    expect(FleetSettingKeys.RosterRefuseExpiredLicence).toBe('fleet.roster.refuseExpiredLicence');
    expect(FleetSettingKeys.OdometerMissingReadingDays).toBe('fleet.odometer.missingReadingDays');
  });

  it('checks an expired licence LAST among the unavailable reasons', () => {
    expect(FLEET_DRIVER_UNAVAILABLE_REASONS.at(-1)).toBe('licenceExpired');
    expect(FLEET_DRIVER_UNAVAILABLE_REASONS).toEqual([
      'notADriver',
      'profileInactive',
      'notEmployed',
      'fleetUnavailability',
      'hrLeave',
      'licenceExpired',
    ]);
    expect(FLEET_DRIVER_LICENCE_STATES).toEqual(['valid', 'expired', 'notRecorded', 'noProfile']);
  });

  it('lets the drivers list ask a licence window and «بلا تاريخ»', () => {
    const result = ListFleetDriversQuerySchema.safeParse({
      licenseExpiresFrom: '2026-11-02T00:00:00.000Z',
      licenseExpiresBefore: '2026-12-01T23:59:59.999Z',
      licenseNotRecorded: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.licenseExpiresFrom?.toISOString()).toBe('2026-11-02T00:00:00.000Z');
      // 'false' is false — never JavaScript truthiness.
      expect(result.data.licenseNotRecorded).toBe(false);
    }
  });

  it('lets the fuel cards list and summary ask an expiry window', () => {
    for (const schema of [ListFleetFuelCardsQuerySchema, FleetFuelCardSummaryQuerySchema]) {
      const result = schema.safeParse({ expiresFrom: '2026-11-02', expiresBefore: '2026-12-01' });
      expect(result.success).toBe(true);
    }
  });

  it('gives every period screen the vehicle-set filter, list and total alike', () => {
    const set = { typeIds: `${ID_A},${ID_B}`, operationIds: ID_A, branchIds: ID_B };
    const schemas = {
      ListFleetOdometerQuerySchema,
      FleetOdometerSummaryQuerySchema,
      ListFleetAccidentsQuerySchema,
      FleetAccidentSummaryQuerySchema,
      ListFleetDealershipInvoicesQuerySchema,
      FleetDealershipSummaryQuerySchema,
      ListFleetReceiptsQuerySchema,
      FleetReceiptSummaryQuerySchema,
      ListFleetViolationsQuerySchema,
      FleetViolationRollupQuerySchema,
      ListFleetMaintenanceQuerySchema,
    };
    for (const [name, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(set);
      expect(result.success, name).toBe(true);
      if (result.success) {
        expect(result.data, name).toMatchObject({
          typeIds: [ID_A, ID_B],
          operationIds: [ID_A],
          branchIds: [ID_B],
        });
      }
      expect(schema.safeParse({ typeIds: 'nope' }).success, name).toBe(false);
    }
  });

  it('the odometer total takes the list’s filters and never its paging or sorting', () => {
    const filters = {
      vehicleCodes: '150,151',
      from: '2026-10-01',
      to: '2026-10-31',
      alerts: 'red',
      notes: 'trip',
      typeIds: ID_A,
    };
    expect(FleetOdometerSummaryQuerySchema.safeParse(filters).success).toBe(true);
    expect(ListFleetOdometerQuerySchema.safeParse(filters).success).toBe(true);
    for (const paging of [
      { page: '2' },
      { pageSize: '50' },
      { sort: 'date:desc' },
      { sortBy: 'date' },
    ]) {
      expect(FleetOdometerSummaryQuerySchema.safeParse({ ...filters, ...paging }).success).toBe(
        false,
      );
      expect(ListFleetOdometerQuerySchema.safeParse({ ...filters, ...paging }).success).toBe(true);
    }
  });
});
