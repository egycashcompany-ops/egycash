// The dashboard's shared rules, pinned (plan §9 "contracts unit"): the period presets on the Cairo
// day, the period query, the expiry states and licence windows, the paper stage, the granularity
// lifted from custody, and the gate table every section, tab and route guard is derived from.
import { describe, expect, it } from 'vitest';
import { addDaysYmd, cairoYmd, calendarDayBounds } from '../common/cairo-date.js';
import {
  FLEET_DASHBOARD_ACCIDENT_ROWS,
  FLEET_DASHBOARD_ALARM_ROWS,
  FLEET_DASHBOARD_ALERTS,
  FLEET_DASHBOARD_DEFAULT_PRESET,
  FLEET_DASHBOARD_EXCEPTION_ROWS,
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_MAX_CUSTOM_DAYS,
  FLEET_DASHBOARD_NOTICE_ROWS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_NOW_SECTIONS,
  FLEET_DASHBOARD_PAGE_KEYS,
  FLEET_DASHBOARD_PART_SECTIONS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_PERIOD_SECTIONS,
  FLEET_DASHBOARD_PERIOD_TABS,
  FLEET_DASHBOARD_PRESETS,
  FLEET_DASHBOARD_RANK_ROWS,
  FLEET_DASHBOARD_RECENT_ROWS,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_PARTS,
  FLEET_DASHBOARD_TAB_READS,
  FLEET_DASHBOARD_TAB_SECTIONS,
  FLEET_DASHBOARD_TODAY_ROWS,
  FLEET_DASHBOARD_WORKSHOP_ROWS,
  FLEET_LICENCE_GREY_DAYS,
  FLEET_LICENSING_PAPERS,
  FleetDashboardPeriodQuerySchema,
  expiryStateOn,
  fleetDashboardGateKeys,
  licenceWindows,
  paperStage,
  periodGranularity,
  periodOf,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardNowDistributionVehiclesDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowNoReadingDto,
  type FleetDashboardNowWorkshopDto,
  type FleetDashboardPeriodAccidentRowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodExitsDto,
  type FleetDashboardPeriodKmDto,
  type FleetDashboardPeriodVisitsDto,
  type FleetDashboardRead,
  type FleetDashboardSection,
  type FleetDashboardTab,
} from './fleet-dashboard.js';
import {
  FLEET_DRIVER_LICENCE_STATES,
  FLEET_DRIVER_UNAVAILABLE_REASONS,
  FleetAccidentSummaryQuerySchema,
  FleetDealershipSummaryQuerySchema,
  FleetFuelCardSummaryQuerySchema,
  FleetNoticesSummaryQuerySchema,
  FleetOdometerSummaryQuerySchema,
  FleetReceiptSummaryQuerySchema,
  FleetSettingKeys,
  FleetViolationRollupQuerySchema,
  ListFleetAccidentsQuerySchema,
  ListFleetDealershipInvoicesQuerySchema,
  ListFleetDriversQuerySchema,
  ListFleetFuelCardsQuerySchema,
  ListFleetMaintenanceQuerySchema,
  ListFleetNoticesQuerySchema,
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

const PART_SECTIONS: readonly FleetDashboardSection[] = FLEET_DASHBOARD_PART_SECTIONS;
const ALL_SECTIONS: FleetDashboardSection[] = [
  ...FLEET_DASHBOARD_NOW_SECTIONS,
  ...FLEET_DASHBOARD_PERIOD_SECTIONS,
  'custodyFund',
  ...FLEET_DASHBOARD_PART_SECTIONS,
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
  violationsOpen: ['now', 'fleetViolation.view', 'fleetViolation.view', '/fleet/violations'],
  km: ['period', 'fleetOdometer.view', 'fleetOdometer.view', '/fleet/odometer'],
  visits: ['period', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
  exits: ['period', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
  accidents: ['period', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  accidentList: ['period', 'fleetAccident.view', 'fleetAccident.view', '/fleet/accidents'],
  opex: ['period', 'fleetReceipt.view', 'fleetReceipt.view', '/fleet/receipts'],
  dealership: ['period', 'fleetDealership.view', 'fleetDealership.view', '/fleet/dealership'],
  custodyFund: ['web', 'fleetCustody.view', 'fleetCustody.view', '/fleet/custody/dashboard'],
  supplyContracts: [
    'web',
    'fleetVehicleContract.view',
    'fleetVehicleContract.view',
    '/fleet/vehicle-contracts',
  ],
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

  it('reads the now sections from R1, the period sections from R2, custody and the supply contracts in the browser', () => {
    for (const section of FLEET_DASHBOARD_NOW_SECTIONS) {
      expect(FLEET_DASHBOARD_GATES[section].read, section).toBe('now');
    }
    for (const section of FLEET_DASHBOARD_PERIOD_SECTIONS) {
      expect(FLEET_DASHBOARD_GATES[section].read, section).toBe('period');
    }
    expect(FLEET_DASHBOARD_GATES.custodyFund.read).toBe('web');
    expect(FLEET_DASHBOARD_GATES.supplyContracts.read).toBe('web');
    expect(FLEET_DASHBOARD_PART_SECTIONS).toEqual(['supplyContracts']);
  });

  it('needs BOTH keys for fuel charging: the cards’ data and the charging screen', () => {
    expect(sorted(fleetDashboardGateKeys('fuelCharging'))).toEqual([
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
    ]);
    expect(fleetDashboardGateKeys('fuelCards')).toEqual(['fleetFuelCard.view']);
  });

  it('the unions equal the table, the PART sections left out', () => {
    const union = (read: string | null): string[] =>
      sorted(
        ALL_SECTIONS.filter(
          (s) => !PART_SECTIONS.includes(s) && (read === null || TABLE[s][0] === read),
        ).flatMap((s) => [TABLE[s][1], TABLE[s][2]]),
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

  it('a PART section widens no access: the supply contracts open neither a read nor the page', () => {
    // «عقود توريد السيارات» is drawn on «توزيع السيارات» for a reader who already sees the tab; a
    // reader holding only `fleetVehicleContract.view` still cannot open the dashboard (/fleet guard).
    for (const keys of [
      FLEET_DASHBOARD_NOW_KEYS,
      FLEET_DASHBOARD_PERIOD_KEYS,
      FLEET_DASHBOARD_PAGE_KEYS,
    ]) {
      expect(keys).not.toContain('fleetVehicleContract.view');
    }
    expect(fleetDashboardGateKeys('supplyContracts')).toEqual(['fleetVehicleContract.view']);
    for (const section of PART_SECTIONS) {
      expect(ALL_SECTIONS, section).toContain(section);
      for (const tab of FLEET_DASHBOARD_TABS) {
        expect(FLEET_DASHBOARD_TAB_SECTIONS[tab], `${tab}:${section}`).not.toContain(section);
      }
    }
  });

  it('the two new sections reuse keys already gating a section: no union changes', () => {
    // `violationsOpen` sits beside `violationsYear`, `exits` beside `visits` — the same keys, so
    // the routes' authorizeAny and the index route's guard are what they were.
    expect(FLEET_DASHBOARD_GATES.violationsOpen).toEqual(FLEET_DASHBOARD_GATES.violationsYear);
    expect(FLEET_DASHBOARD_GATES.exits).toEqual(FLEET_DASHBOARD_GATES.visits);
    expect(sorted(FLEET_DASHBOARD_NOW_KEYS)).toEqual([
      'fleetAccident.view',
      'fleetDealership.view',
      'fleetDriver.view',
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
      'fleetLicensing.view',
      'fleetMaintenance.view',
      'fleetNotice.view',
      'fleetOdometer.view',
      'fleetRoster.view',
      'fleetVehicle.view',
      'fleetViolation.view',
    ]);
    expect(sorted(FLEET_DASHBOARD_PERIOD_KEYS)).toEqual([
      'fleetAccident.view',
      'fleetDealership.view',
      'fleetMaintenance.view',
      'fleetOdometer.view',
      'fleetReceipt.view',
    ]);
    expect(sorted(FLEET_DASHBOARD_PAGE_KEYS)).toEqual(
      sorted([...FLEET_DASHBOARD_NOW_KEYS, ...FLEET_DASHBOARD_PERIOD_KEYS, 'fleetCustody.view']),
    );
  });

  it('is frozen: nothing at runtime can widen a gate', () => {
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES.roster)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_PAGE_KEYS)).toBe(true);
  });
});

describe('tabs and their sections', () => {
  it('nine tabs in the strip’s order: the six rebuilt ones, then the old three where their replacements will stand', () => {
    expect(FLEET_DASHBOARD_TABS).toEqual([
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
    // The retired `alerts` and `now` keys are gone (the web maps a link to them onto overview / today),
    // and so is `ranking`: «ترتيب السيارات» lives inside «العدادات والكيلومترات» (a link opens `km`).
    expect(FLEET_DASHBOARD_TABS).not.toContain('alerts');
    expect(FLEET_DASHBOARD_TABS).not.toContain('now');
    expect(FLEET_DASHBOARD_TABS).not.toContain('ranking');
    expect(Object.keys(FLEET_DASHBOARD_TAB_SECTIONS)).not.toContain('ranking');
  });

  it('names the read(s) of every tab, and «أرقام الفترة» alone is drawn under the old filter-bar wrapper', () => {
    expect(Object.keys(FLEET_DASHBOARD_TAB_READS)).toEqual([...FLEET_DASHBOARD_TABS]);
    expect(Object.isFrozen(FLEET_DASHBOARD_TAB_READS)).toBe(true);
    expect(FLEET_DASHBOARD_TAB_READS).toEqual({
      overview: ['now', 'month', 'web'],
      today: ['now'],
      distribution: ['now', 'month', 'web'],
      maintenance: ['now', 'period'],
      km: ['now', 'period'],
      accidents: ['now', 'period'],
      period: ['period'],
      summaries: ['now', 'web'],
      licences: ['now'],
    });
    expect(FLEET_DASHBOARD_PERIOD_TABS).toEqual(['period']);
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      expect(FLEET_DASHBOARD_TABS, tab).toContain(tab);
      expect(FLEET_DASHBOARD_TAB_READS[tab], tab).toEqual(['period']);
    }
    // The MIXED tabs left them: R1 «الآن» parts + R2 parts under the page filters…
    const mixed = ['maintenance', 'km', 'accidents'] as const;
    for (const tab of mixed) {
      expect(FLEET_DASHBOARD_PERIOD_TABS, tab).not.toContain(tab);
      expect(FLEET_DASHBOARD_TAB_READS[tab], tab).toEqual(['now', 'period']);
    }
    // …so the tabs drawn under the page filters are «أرقام الفترة», plus the three mixed tabs.
    expect(
      sorted(
        FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_READS[tab].includes('period')),
      ),
    ).toEqual(sorted([...FLEET_DASHBOARD_PERIOD_TABS, ...mixed]));
    // «توزيع السيارات» reads «هذا الشهر» on its own, never the page filters.
    expect(FLEET_DASHBOARD_TAB_READS.distribution).not.toContain('period');
  });

  it('maps every tab to at least one real section', () => {
    expect(Object.keys(FLEET_DASHBOARD_TAB_SECTIONS).sort()).toEqual(
      [...FLEET_DASHBOARD_TABS].sort(),
    );
    for (const tab of FLEET_DASHBOARD_TABS) {
      const sections = FLEET_DASHBOARD_TAB_SECTIONS[tab];
      expect(sections.length, tab).toBeGreaterThan(0);
      expect(new Set(sections).size, tab).toBe(sections.length);
      for (const section of sections) expect(ALL_SECTIONS, `${tab}:${section}`).toContain(section);
    }
  });

  it('every section a tab draws (its sections and its parts) belongs to a read the tab names', () => {
    // 'month' is R2 too (at «هذا الشهر», no filter), so it admits period sections; 'web' admits
    // custodyFund and supplyContracts.
    const readsOf = (reads: readonly FleetDashboardRead[]): string[] =>
      reads.map((read) => (read === 'month' ? 'period' : read));
    for (const tab of FLEET_DASHBOARD_TABS) {
      const reads = readsOf(FLEET_DASHBOARD_TAB_READS[tab]);
      const drawn = [
        ...FLEET_DASHBOARD_TAB_SECTIONS[tab],
        ...(FLEET_DASHBOARD_TAB_PARTS[tab] ?? []),
      ];
      for (const section of drawn) {
        expect(reads, `${tab}:${section}`).toContain(FLEET_DASHBOARD_GATES[section].read);
      }
      // …and every read it names feeds at least one of them.
      for (const read of new Set(reads)) {
        expect(
          drawn.some((s) => FLEET_DASHBOARD_GATES[s].read === read),
          `${tab}:${read}`,
        ).toBe(true);
      }
    }
    // The overview reads R2 only for «هذا الشهر», never under the page filters.
    expect(FLEET_DASHBOARD_TAB_READS.overview).not.toContain('period');
  });

  it('pins the plan’s mapping (the old three unchanged)', () => {
    expect(FLEET_DASHBOARD_TAB_SECTIONS).toEqual({
      overview: [
        'vehicles',
        'roster',
        'workshop',
        'maintenanceAlarm',
        'noReading',
        'distributionVehicles',
        'licenceVehicles',
        'licenceDrivers',
        'fuelCards',
        'fuelCharging',
        'dealershipPending',
        'notices',
        'violationsOpen',
        'custodyFund',
        'km',
        'exits',
        'accidents',
        'opex',
      ],
      today: ['vehicles', 'roster', 'workshop'],
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
      km: ['km', 'noReading'],
      maintenance: ['maintenanceAlarm', 'workshop', 'dealershipPending', 'exits'],
      accidents: ['accidentsOpen', 'notices', 'accidents', 'accidentList'],
    });
  });

  it('pins the parts a tab draws without them ever showing it', () => {
    expect(Object.isFrozen(FLEET_DASHBOARD_TAB_PARTS)).toBe(true);
    expect(FLEET_DASHBOARD_TAB_PARTS).toEqual({ distribution: ['km', 'supplyContracts'] });
    for (const [tab, parts] of Object.entries(FLEET_DASHBOARD_TAB_PARTS)) {
      expect(FLEET_DASHBOARD_TABS, tab).toContain(tab);
      const sections = FLEET_DASHBOARD_TAB_SECTIONS[tab as FleetDashboardTab];
      for (const part of parts ?? []) {
        expect(ALL_SECTIONS, `${tab}:${part}`).toContain(part);
        // Disjoint from the sections that make the same tab visible.
        expect(sections, `${tab}:${part}`).not.toContain(part);
      }
    }
    // «توزيع السيارات» shows for the R1 figures alone, as before.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.distribution).toEqual([
      'distributionVehicles',
      'distributionDrivers',
    ]);
  });

  it('the old tabs keep their sections; visits (check-in day) is «أرقام الفترة»’s alone, exits (exit day) the rebuilt tabs’', () => {
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).toContain('violationsYear');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).not.toContain('violationsOpen');
    expect(
      FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_SECTIONS[tab].includes('visits')),
    ).toEqual(['period']);
    expect(
      FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_SECTIONS[tab].includes('exits')),
    ).toEqual(['overview', 'maintenance']);
    // «الصيانة والورش» counts every period figure by EXIT day, never by check-in.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.maintenance).not.toContain('visits');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.period).not.toContain('exits');
    for (const section of ['violationsOpen', 'exits'] as const) {
      expect(FLEET_DASHBOARD_TAB_SECTIONS.overview, section).toContain(section);
    }
  });

  it('«الصيانة والورش» shows for any one of its parts, each under its own gate', () => {
    // A dealership-only or an odometer-only reader sees the tab with that part alone.
    const keysOf = (tab: FleetDashboardTab): string[][] =>
      FLEET_DASHBOARD_TAB_SECTIONS[tab].map((section) => [...fleetDashboardGateKeys(section)]);
    expect(keysOf('maintenance')).toEqual([
      ['fleetOdometer.view'],
      ['fleetMaintenance.view'],
      ['fleetDealership.view'],
      ['fleetMaintenance.view'],
    ]);
  });

  it('«العدادات والكيلومترات» shows for the odometer reader: the period’s km (R2) and the cars with no recent reading (R1)', () => {
    const keysOf = (tab: FleetDashboardTab): string[][] =>
      FLEET_DASHBOARD_TAB_SECTIONS[tab].map((section) => [...fleetDashboardGateKeys(section)]);
    expect(FLEET_DASHBOARD_TAB_SECTIONS.km.map((s) => FLEET_DASHBOARD_GATES[s].read)).toEqual([
      'period',
      'now',
    ]);
    expect(keysOf('km')).toEqual([['fleetOdometer.view'], ['fleetOdometer.view']]);
    // The old «ترتيب السيارات» drew `km` alone; its body is in this tab now.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.km).toContain('km');
  });

  it('«الحوادث ومطالبات التأمين» shows for any one of its parts, each under its own gate', () => {
    // A notices-only reader sees the tab with the notices alone; an accidents-only reader sees it
    // without them.
    const sections = FLEET_DASHBOARD_TAB_SECTIONS.accidents;
    expect(sections.map((s) => FLEET_DASHBOARD_GATES[s].read)).toEqual([
      'now',
      'now',
      'period',
      'period',
    ]);
    expect(sections.map((section) => [...fleetDashboardGateKeys(section)])).toEqual([
      ['fleetAccident.view'],
      ['fleetNotice.view'],
      ['fleetAccident.view'],
      ['fleetAccident.view'],
    ]);
    // «ملخصات» keeps the open files (the same field), «التراخيص» the recent accidents.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).toContain('accidentsOpen');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.licences).toContain('recentAccidents');
    expect(sections).not.toContain('recentAccidents');
  });

  it('the two rebuilt tabs add no section and no gate: the unions are what they were', () => {
    expect(FLEET_DASHBOARD_NOW_SECTIONS).toContain('noReading');
    expect(FLEET_DASHBOARD_NOW_SECTIONS).toContain('notices');
    expect(FLEET_DASHBOARD_NOW_SECTIONS).toContain('accidentsOpen');
    expect([...FLEET_DASHBOARD_PERIOD_SECTIONS]).toEqual([
      'km',
      'visits',
      'exits',
      'accidents',
      'accidentList',
      'opex',
      'dealership',
    ]);
    expect(sorted(FLEET_DASHBOARD_PAGE_KEYS)).toEqual([
      'fleetAccident.view',
      'fleetCustody.view',
      'fleetDealership.view',
      'fleetDriver.view',
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
      'fleetLicensing.view',
      'fleetMaintenance.view',
      'fleetNotice.view',
      'fleetOdometer.view',
      'fleetReceipt.view',
      'fleetRoster.view',
      'fleetVehicle.view',
      'fleetViolation.view',
    ]);
  });

  it('caps the «الحركة اليوم» lists with their own constant', () => {
    expect(FLEET_DASHBOARD_TODAY_ROWS).toBe(8);
    // Same number as the recent lists today, but a separate rule: changing one never moves the other.
    expect(FLEET_DASHBOARD_RECENT_ROWS).toBe(8);
  });

  it('caps the «الصيانة والورش» lists with their own constants', () => {
    // «إنذارات الصيانة بالكيلومتر» before «كل إنذارات الصيانة (N)».
    expect(FLEET_DASHBOARD_ALARM_ROWS).toBe(8);
    // «أطول بقاء في الورشة الآن» before «كل السيارات في الورشة (N)».
    expect(FLEET_DASHBOARD_WORKSHOP_ROWS).toBe(5);
    // «أكثر السيارات دخولًا للورشة» keeps the ranking rule.
    expect(FLEET_DASHBOARD_RANK_ROWS).toBe(5);
  });

  it('caps the lists of «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين» with their own constants', () => {
    // Each group of «استثناءات قراءات العدادات» before «و N أخرى في القائمة الكاملة».
    expect(FLEET_DASHBOARD_EXCEPTION_ROWS).toBe(3);
    // «إخطارات ينقصها مرفق» before «و N أخرى».
    expect(FLEET_DASHBOARD_NOTICE_ROWS).toBe(6);
    // «حوادث الفترة» before «عرض الباقي (N) في السجل»: the same number, a separate rule.
    expect(FLEET_DASHBOARD_ACCIDENT_ROWS).toBe(6);
    // «أعلى 5» / «أقل 5» keep the ranking rule.
    expect(FLEET_DASHBOARD_RANK_ROWS).toBe(5);
  });
});

// ── The shapes the two rebuilt tabs read (compile-time pins, one sample each) ──

describe('the shapes of «توزيع السيارات» and «الصيانة والورش»', () => {
  const name = { ar: 'س', en: 'S' };

  it('distribution: per-branch kinds, «بلا فرع» kinds and «أخرى», one operation per car', () => {
    const dto: FleetDashboardNowDistributionVehiclesDto = {
      branches: [
        { id: ID_B, name },
        { id: ID_A, name },
      ],
      rows: [{ typeId: ID_A, name, counts: { [ID_A]: 1, [ID_B]: 3 }, noBranch: 1, total: 5 }],
      totals: { counts: { [ID_A]: 1, [ID_B]: 3 }, noBranch: 1, total: 5 },
      branchCount: 2,
      cash: { vehicles: 3, operationIds: [ID_A] },
      atm: { vehicles: 1, operationIds: [ID_B] },
      kinds: {
        [ID_A]: { cash: 1, atm: 0, other: 0 },
        [ID_B]: { cash: 2, atm: 1, other: 0 },
      },
      noBranchKinds: { cash: 0, atm: 0, other: 1 },
      other: { vehicles: 1 },
    };
    // Every column has its kinds, and they add up to the column.
    for (const branch of dto.branches) {
      const kinds = dto.kinds[branch.id];
      expect(kinds, branch.id).toBeDefined();
      if (kinds !== undefined) {
        expect(kinds.cash + kinds.atm + kinds.other).toBe(dto.totals.counts[branch.id]);
      }
    }
    // Branches in column order: active cars descending.
    expect(dto.branches.map((b) => dto.totals.counts[b.id])).toEqual([3, 1]);
  });

  it('maintenance now: thresholds and alarm rows, the longest stays', () => {
    const alarm: FleetDashboardNowAlarmDto = {
      red: 1,
      overdue: 1,
      yellow: 1,
      codes: null,
      redKm: 300,
      yellowKm: 1000,
      rows: [
        {
          vehicleId: ID_A,
          code: '150',
          typeName: name,
          level: 'red',
          remainingKm: -120,
          sinceServiceKm: 10120,
          intervalKm: 10000,
          lastServiceAt: '2026-08-01',
          inWorkshop: { workshop: name },
        },
        {
          vehicleId: ID_B,
          code: '151',
          typeName: null,
          level: 'yellow',
          remainingKm: 640,
          sinceServiceKm: 9360,
          intervalKm: 10000,
          lastServiceAt: null,
          inWorkshop: null,
        },
      ],
    };
    expect(alarm.rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_ALARM_ROWS);
    expect(alarm.rows.map((row) => row.level)).toEqual(['red', 'yellow']);
    const workshop: FleetDashboardNowWorkshopDto = {
      open: 2,
      openActive: 2,
      openOutOfService: 0,
      oldest: { vehicleId: ID_A, code: '150', inDate: '2026-11-03', days: 12, deleted: false },
      longest: [
        {
          visitId: ID_A,
          vehicleId: ID_A,
          code: '150',
          deleted: false,
          typeName: name,
          inDate: '2026-11-03',
          days: 12,
          workshop: name,
          workType: name,
        },
        {
          visitId: ID_B,
          vehicleId: null,
          code: '9001',
          // An old-book row: no registry car, so never «deleted»; its code finds the book's row.
          deleted: false,
          typeName: null,
          inDate: '2026-11-15',
          days: 0,
          workshop: null,
          workType: null,
        },
      ],
    };
    expect(workshop.longest.length).toBeLessThanOrEqual(
      Math.min(workshop.open, FLEET_DASHBOARD_WORKSHOP_ROWS),
    );
    expect(workshop.longest[0]).toMatchObject(workshop.oldest ?? {});
  });

  it('maintenance period: exits by EXIT day carry the breakdown; visits (check-in) only their state', () => {
    const exits: FleetDashboardPeriodExitsDto = {
      count: 3,
      avgStayDays: 1.7,
      byWorkType: [
        { id: ID_A, name, count: 2 },
        { id: ID_B, name: null, count: 1 },
      ],
      byWorkshop: [{ id: ID_A, name, count: 3 }],
      topVehicles: [
        {
          vehicleId: ID_A,
          code: '150',
          typeName: name,
          visits: 2,
          lastInDate: '2026-11-10',
          lastWorkType: name,
        },
      ],
      unregistered: 1,
    };
    const empty: FleetDashboardPeriodExitsDto = {
      count: 0,
      avgStayDays: null,
      byWorkType: [],
      byWorkshop: [],
      topVehicles: [],
      unregistered: null,
    };
    const visits: FleetDashboardPeriodVisitsDto = { count: 4, closed: 3, open: 1 };
    const period: Pick<FleetDashboardPeriodDto, 'visits' | 'exits'> = { visits, exits };
    expect(Object.keys(visits).sort()).toEqual(['closed', 'count', 'open']);
    expect(period.exits?.byWorkType.reduce((sum, bar) => sum + bar.count, 0)).toBe(exits.count);
    expect(period.exits?.byWorkshop.reduce((sum, bar) => sum + bar.count, 0)).toBe(exits.count);
    expect(empty.avgStayDays).toBeNull();
  });
});

describe('the shapes of «العدادات والكيلومترات» and «الحوادث ومطالبات التأمين»', () => {
  const name = { ar: 'س', en: 'S' };

  it('odometer now: the counts are fields, the rows the longest gap first', () => {
    const noReading: FleetDashboardNowNoReadingDto = {
      days: 3,
      stale: [
        { vehicleId: ID_A, code: '150', lastDate: '2026-11-02' },
        { vehicleId: ID_B, code: '151', lastDate: '2026-10-20' },
        { vehicleId: ID_A, code: '152', lastDate: '2026-11-08' },
        { vehicleId: ID_B, code: '153', lastDate: '2026-11-02' },
      ],
      neverRead: [{ vehicleId: ID_A, code: '160' }],
      staleCount: 4,
      neverReadCount: 1,
      staleRows: [
        { vehicleId: ID_B, code: '151', typeName: name, lastDate: '2026-10-20', days: 26 },
        { vehicleId: ID_A, code: '150', typeName: null, lastDate: '2026-11-02', days: 13 },
        { vehicleId: ID_B, code: '153', typeName: name, lastDate: '2026-11-02', days: 13 },
      ],
      neverReadRows: [{ vehicleId: ID_A, code: '160', typeName: name }],
    };
    expect(noReading.staleCount).toBe(noReading.stale.length);
    expect(noReading.neverReadCount).toBe(noReading.neverRead.length);
    expect(noReading.staleRows.length).toBeLessThanOrEqual(
      Math.min(noReading.staleCount, FLEET_DASHBOARD_EXCEPTION_ROWS),
    );
    expect(noReading.neverReadRows.length).toBeLessThanOrEqual(
      Math.min(noReading.neverReadCount, FLEET_DASHBOARD_EXCEPTION_ROWS),
    );
    // The longest gap first, then code: «أطول انقطاع» is `staleRows[0]`.
    expect(noReading.staleRows.map((row) => `${row.lastDate}:${row.code}`)).toEqual(
      noReading.staleRows.map((row) => `${row.lastDate}:${row.code}`).sort(),
    );
    // Every row is one of the whole list's cars.
    for (const row of noReading.staleRows) {
      expect(
        noReading.stale.map((car) => car.code),
        row.code,
      ).toContain(row.code);
    }
  });

  it('notices now: open and missing counts, and at most six rows (a carless notice, a dateless one last)', () => {
    const notices: NonNullable<FleetDashboardNowDto['notices']> = {
      open: 9,
      missingAny: 7,
      missingLicences: 5,
      missingCheckImage: 4,
      rows: [
        {
          noticeId: ID_A,
          template: 'misrInsurance',
          vehicleId: ID_A,
          code: '150',
          typeName: name,
          noticeNumber: '771',
          noticeDate: '2026-10-04',
          missing: { vehicleLicense: true, driverLicense: false, checkImage: true },
        },
        {
          noticeId: ID_B,
          template: 'deltaInsurance',
          // «بلا سيارة» — listed in the company view only.
          vehicleId: null,
          code: null,
          typeName: null,
          noticeNumber: null,
          noticeDate: null,
          missing: { vehicleLicense: false, driverLicense: false, checkImage: true },
        },
      ],
    };
    expect(notices.rows.length).toBeLessThanOrEqual(
      Math.min(notices.missingAny, FLEET_DASHBOARD_NOTICE_ROWS),
    );
    expect(notices.missingAny).toBeLessThanOrEqual(notices.open);
    expect(notices.rows.at(-1)?.noticeDate).toBeNull();
    // Every listed notice misses something.
    for (const row of notices.rows) {
      expect(Object.values(row.missing), row.noticeId).toContain(true);
    }
  });

  it('odometer period: coverage ties, the cars with no distance, the readings to review, makes on the ranking', () => {
    const km: FleetDashboardPeriodKmDto = {
      total: 5200,
      invalidRows: 4,
      perVehicleAvg: 1300,
      coverage: { withReadings: 3, of: 5, active: 8, inWorkshop: 2, joinedAfter: 1 },
      noDistance: { cars: 2, neverRead: 1, codes: ['154', '160'], neverReadCodes: ['160'] },
      invalidList: [
        {
          vehicleId: ID_A,
          code: '150',
          typeName: name,
          date: '2026-11-02',
          from: 84210,
          to: 84190,
          km: -20,
        },
        {
          // An old-book code with no registry car.
          vehicleId: null,
          code: '9001',
          typeName: null,
          date: '2026-11-05',
          from: 1200,
          to: 1100,
          km: -100,
        },
      ],
      confirmedThrough: '2026-11-14',
      closedDays: 14,
      average: 371,
      buckets: [],
      spans: { km: 0, count: 0 },
      byBranch: [],
      byType: null,
      unregistered: 0,
      top5: [{ vehicleId: ID_A, code: '150', km: 2100, typeName: name }],
      bottom5: [
        { vehicleId: ID_B, code: '151', km: 300, inWorkshopSince: '2026-11-10', typeName: null },
      ],
      withoutReadings: [
        { vehicleId: ID_A, code: '154', reason: 'onlyOpen' },
        { vehicleId: ID_B, code: '160', reason: 'noRow' },
      ],
    };
    const { coverage, noDistance } = km;
    expect(coverage.of).toBe(coverage.active - coverage.inWorkshop - coverage.joinedAfter);
    expect(noDistance.cars).toBe(coverage.of - coverage.withReadings);
    expect(noDistance.neverRead).toBeLessThanOrEqual(noDistance.cars);
    expect(noDistance.codes).toEqual(expect.arrayContaining(noDistance.neverReadCodes));
    expect(km.invalidList.length).toBeLessThanOrEqual(
      Math.min(km.invalidRows, FLEET_DASHBOARD_EXCEPTION_ROWS),
    );
    for (const row of km.invalidList) {
      expect(row.km, row.code).toBeLessThan(0);
      expect(row.to, row.code).toBe(row.from + row.km);
    }
    // The oldest day first.
    expect(km.invalidList.map((row) => row.date)).toEqual(
      km.invalidList.map((row) => row.date).sort(),
    );
    expect(km.top5.length).toBeLessThanOrEqual(FLEET_DASHBOARD_RANK_ROWS);
    expect(km.bottom5.length).toBeLessThanOrEqual(FLEET_DASHBOARD_RANK_ROWS);
  });

  it('accidents period: the money of the period’s files without a count, and rows with the statement and the make', () => {
    const accidents: NonNullable<FleetDashboardPeriodDto['accidents']> = {
      count: 4,
      open: 2,
      openRemaining: 1500,
      undated: 1,
      totals: {
        amountCollected: 12000,
        companyCost: 3000,
        paidAmount: 9000,
        transferredIn: 500,
        transferredOut: 1000,
        remaining: 5500,
      },
    };
    const { totals } = accidents;
    expect(Object.keys(totals).sort()).toEqual([
      'amountCollected',
      'companyCost',
      'paidAmount',
      'remaining',
      'transferredIn',
      'transferredOut',
    ]);
    expect(totals.remaining).toBe(
      totals.amountCollected +
        totals.companyCost -
        totals.paidAmount +
        totals.transferredIn -
        totals.transferredOut,
    );
    const row: FleetDashboardPeriodAccidentRowDto = {
      accidentId: ID_A,
      vehicleId: ID_A,
      code: '150',
      typeName: name,
      date: '2026-11-03',
      statement: 'اصطدام خلفي 10:30',
      culprit: null,
      culpritEmployeeIds: [],
      status: 'open',
      remaining: -200,
    };
    const oldBook: FleetDashboardPeriodAccidentRowDto = {
      ...row,
      accidentId: ID_B,
      vehicleId: null,
      code: '9001',
      typeName: null,
      statement: '',
      status: 'closed',
    };
    const list: NonNullable<FleetDashboardPeriodDto['accidentList']> = {
      rows: [row, oldBook],
      more: 0,
    };
    expect(list.rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_ACCIDENT_ROWS);
    // `date` stays a day — the statement may hold a time, the date never does.
    for (const r of list.rows) expect(r.date, r.accidentId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the alerts of the overview’s action centre', () => {
  it('names a real now section for every alert, each id once, red before orange', () => {
    const ids = FLEET_DASHBOARD_ALERTS.map((alert) => alert.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const alert of FLEET_DASHBOARD_ALERTS) {
      expect(FLEET_DASHBOARD_NOW_SECTIONS, alert.id).toContain(alert.section);
      expect(FLEET_DASHBOARD_TAB_SECTIONS.overview, alert.id).toContain(alert.section);
    }
    // The custody line the web adds is drawn there too.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.overview).toContain('custodyFund');
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
      // The notices follow their car: type, operation and CURRENT branch.
      ListFleetNoticesQuerySchema,
      FleetNoticesSummaryQuerySchema,
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
