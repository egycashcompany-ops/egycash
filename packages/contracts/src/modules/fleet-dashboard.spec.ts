// The dashboard's shared rules, pinned (plan §9 "contracts unit"): the period presets on the Cairo
// day, the period query, the expiry states and licence windows, the paper stage, the granularity
// lifted from custody, and the gate table every section, tab and route guard is derived from.
import { describe, expect, it } from 'vitest';
import { addDaysYmd, cairoYmd, calendarDayBounds, daysBetweenYmd } from '../common/cairo-date.js';
import {
  FLEET_DASHBOARD_ACCIDENT_ROWS,
  FLEET_DASHBOARD_ALARM_ROWS,
  FLEET_DASHBOARD_ALERTS,
  FLEET_DASHBOARD_CUSTODY_RECENT_ROWS,
  FLEET_DASHBOARD_CUSTODY_WAIT_ROWS,
  FLEET_DASHBOARD_DEALERSHIP_ROWS,
  FLEET_DASHBOARD_DEFAULT_PRESET,
  FLEET_DASHBOARD_EXCEPTION_ROWS,
  FLEET_DASHBOARD_FUEL_CARD_ROWS,
  FLEET_DASHBOARD_FUEL_CARD_STATES,
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_LICENCE_MONTHS,
  FLEET_DASHBOARD_LICENCE_ROWS,
  FLEET_DASHBOARD_MAX_CUSTOM_DAYS,
  FLEET_DASHBOARD_NOTICE_ROWS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_NOW_SECTIONS,
  FLEET_DASHBOARD_PAGE_KEYS,
  FLEET_DASHBOARD_PAGELESS_SECTIONS,
  FLEET_DASHBOARD_PART_SECTIONS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_PERIOD_SECTIONS,
  FLEET_DASHBOARD_PERIOD_TABS,
  FLEET_DASHBOARD_PRESETS,
  FLEET_DASHBOARD_RANK_ROWS,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_PARTS,
  FLEET_DASHBOARD_TAB_READS,
  FLEET_DASHBOARD_TAB_SECTIONS,
  FLEET_DASHBOARD_TODAY_ROWS,
  FLEET_DASHBOARD_VIOLATION_ROWS,
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
  type FleetDashboardFuelCardState,
  type FleetDashboardLicenceMonthDto,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardNowDistributionVehiclesDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowFuelCardRowDto,
  type FleetDashboardNowFuelChargingDto,
  type FleetDashboardNowFuelSheetDto,
  type FleetDashboardNowLicenceDriverRowDto,
  type FleetDashboardNowLicenceDriversDto,
  type FleetDashboardNowLicenceVehicleRowDto,
  type FleetDashboardNowLicenceVehiclesDto,
  type FleetDashboardNowNoReadingDto,
  type FleetDashboardNowViolationsOpenDto,
  type FleetDashboardNowWorkshopDto,
  type FleetDashboardOpexBucketDto,
  type FleetDashboardPeriodAccidentRowDto,
  type FleetDashboardPeriodCustodyStatesDto,
  type FleetDashboardPeriodDealershipRowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodExitsDto,
  type FleetDashboardPeriodKmDto,
  type FleetDashboardPeriodLicenceSpendDto,
  type FleetDashboardPeriodViolationRowDto,
  type FleetDashboardPeriodViolationsDto,
  type FleetDashboardPeriodVisitsDto,
  type FleetDashboardRead,
  type FleetDashboardSection,
  type FleetDashboardTab,
} from './fleet-dashboard.js';
import {
  FLEET_CUSTODY_MEMO_STATES,
  FLEET_CUSTODY_MEMO_STATE_OF_STATUS,
  FLEET_DRIVER_LICENCE_STATES,
  FLEET_DRIVER_UNAVAILABLE_REASONS,
  FleetAccidentSummaryQuerySchema,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyHeldLetterDto,
  FleetDealershipSummaryQuerySchema,
  FleetFuelCardSummaryQuerySchema,
  type FleetFuelCardTotalsDto,
  FleetNoticesSummaryQuerySchema,
  FleetOdometerSummaryQuerySchema,
  FleetReceiptSummaryQuerySchema,
  type FleetReceiptTotalsDto,
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
const PAGELESS_SECTIONS: readonly FleetDashboardSection[] = FLEET_DASHBOARD_PAGELESS_SECTIONS;
const ALL_SECTIONS: FleetDashboardSection[] = [
  ...FLEET_DASHBOARD_NOW_SECTIONS,
  ...FLEET_DASHBOARD_PERIOD_SECTIONS,
  'custodyFund',
  ...FLEET_DASHBOARD_PART_SECTIONS,
];

/**
 * The plan's gate table (unified.md §2.3), row by row. `api` is one key, or the list when a section
 * reads two modules (`custodyStates`: the receipts against the custody memos).
 */
const TABLE: Record<
  FleetDashboardSection,
  [read: string, api: string | readonly string[], page: string, path: string]
> = {
  vehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  distributionVehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  licenceVehicles: ['now', 'fleetVehicle.view', 'fleetVehicle.view', '/fleet/vehicles'],
  roster: ['now', 'fleetRoster.view', 'fleetRoster.view', '/fleet/roster'],
  workshop: ['now', 'fleetMaintenance.view', 'fleetMaintenance.view', '/fleet/maintenance'],
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
  fuelCardList: ['now', 'fleetFuelCard.view', 'fleetFuelCharge.view', '/fleet/fuel-cards/charging'],
  fuelSheets: ['now', 'fleetFuelCard.view', 'fleetFuelCharge.view', '/fleet/fuel-cards/reconcile'],
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
  violations: ['period', 'fleetViolation.view', 'fleetViolation.view', '/fleet/violations'],
  violationList: ['period', 'fleetViolation.view', 'fleetViolation.view', '/fleet/violations'],
  opex: ['period', 'fleetReceipt.view', 'fleetReceipt.view', '/fleet/receipts'],
  opexSeries: ['period', 'fleetReceipt.view', 'fleetReceipt.view', '/fleet/receipts'],
  custodyStates: [
    'period',
    ['fleetReceipt.view', 'fleetCustody.view'],
    'fleetCustody.view',
    '/fleet/custody-expenses',
  ],
  dealership: ['period', 'fleetDealership.view', 'fleetDealership.view', '/fleet/dealership'],
  dealershipList: ['period', 'fleetDealership.view', 'fleetDealership.view', '/fleet/dealership'],
  licenceSpend: [
    'period',
    'fleetLicenseExpense.view',
    'fleetLicenseExpense.view',
    '/fleet/license-expenses',
  ],
  custodyFund: ['web', 'fleetCustody.view', 'fleetCustody.view', '/fleet/custody/dashboard'],
  supplyContracts: [
    'web',
    'fleetVehicleContract.view',
    'fleetVehicleContract.view',
    '/fleet/vehicle-contracts',
  ],
};

const sorted = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();
const apiOf = (section: FleetDashboardSection): string[] => {
  const api = TABLE[section][1];
  return typeof api === 'string' ? [api] : [...api];
};

/** NOW_KEYS / PAGE_KEYS as they stood before «العهدة» and «التراخيص والتجديدات» (#728). */
const NOW_KEYS_BEFORE = [
  'fleetVehicle.view',
  'fleetRoster.view',
  'fleetMaintenance.view',
  'fleetOdometer.view',
  'fleetDriver.view',
  'fleetLicensing.view',
  'fleetFuelCard.view',
  'fleetFuelCharge.view',
  'fleetAccident.view',
  'fleetNotice.view',
  'fleetDealership.view',
  'fleetViolation.view',
];
const PAGE_KEYS_BEFORE = [...NOW_KEYS_BEFORE, 'fleetReceipt.view', 'fleetCustody.view'];

describe('the gate table', () => {
  it('gives every section exactly the gate the plan names, and nothing more', () => {
    expect(Object.keys(FLEET_DASHBOARD_GATES).sort()).toEqual([...ALL_SECTIONS].sort());
    for (const section of ALL_SECTIONS) {
      const [read, , page, path] = TABLE[section];
      expect(FLEET_DASHBOARD_GATES[section], section).toEqual({
        read,
        api: apiOf(section),
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
    // The PAGELESS sections are R2 sections (their key reads R2, never opens the page).
    expect(FLEET_DASHBOARD_PAGELESS_SECTIONS).toEqual(['licenceSpend']);
    for (const section of FLEET_DASHBOARD_PAGELESS_SECTIONS) {
      expect(FLEET_DASHBOARD_PERIOD_SECTIONS, section).toContain(section);
      expect(PART_SECTIONS, section).not.toContain(section);
    }
  });

  it('needs BOTH keys for fuel charging: the cards’ data and the charging screen', () => {
    expect(sorted(fleetDashboardGateKeys('fuelCharging'))).toEqual([
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
    ]);
    expect(fleetDashboardGateKeys('fuelCards')).toEqual(['fleetFuelCard.view']);
    // «كروت تحتاج متابعة» and the sheet card open the charging and reconcile screens, both under
    // the charging key: the same two keys.
    for (const section of ['fuelCardList', 'fuelSheets'] as const) {
      expect(sorted(fleetDashboardGateKeys(section)), section).toEqual([
        'fleetFuelCard.view',
        'fleetFuelCharge.view',
      ]);
    }
  });

  it('the unions equal the table, the PART sections left out (and the PAGELESS ones from the page)', () => {
    const union = (read: string | null): string[] =>
      sorted(
        ALL_SECTIONS.filter(
          (s) =>
            !PART_SECTIONS.includes(s) &&
            (read === null ? !PAGELESS_SECTIONS.includes(s) : TABLE[s][0] === read),
        ).flatMap((s) => [...apiOf(s), TABLE[s][2]]),
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

  it('a PAGELESS section reads R2 and opens no page: a licence-expense-only reader cannot open /fleet', () => {
    // «مصروفات التراخيص في الفترة» is drawn on «التراخيص والتجديدات» for a reader who already sees
    // the tab (§11 A2): its key admits R2, never the index route.
    expect(fleetDashboardGateKeys('licenceSpend')).toEqual(['fleetLicenseExpense.view']);
    expect(FLEET_DASHBOARD_PERIOD_KEYS).toContain('fleetLicenseExpense.view');
    expect(FLEET_DASHBOARD_PAGE_KEYS).not.toContain('fleetLicenseExpense.view');
    expect(FLEET_DASHBOARD_NOW_KEYS).not.toContain('fleetLicenseExpense.view');
    // …and it never makes a tab show.
    for (const section of PAGELESS_SECTIONS) {
      for (const tab of FLEET_DASHBOARD_TABS) {
        expect(FLEET_DASHBOARD_TAB_SECTIONS[tab], `${tab}:${section}`).not.toContain(section);
      }
    }
    expect(FLEET_DASHBOARD_TAB_PARTS.licences).toEqual(['licenceSpend']);
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

  it('the new sections reuse keys already gating a section: only the R2 union grew, by `fleetCustody.view` and `fleetLicenseExpense.view`', () => {
    // `violationsOpen` sits beside `violationsYear`, `exits` beside `visits`; `fuelCardList` and
    // `fuelSheets` beside `fuelCharging`; `opexSeries` beside `opex`, `dealershipList` beside
    // `dealership` — the same keys. `violations` / `violationList` brought `fleetViolation.view` to
    // the R2 union (#728). «العهدة»'s `custodyStates` brings `fleetCustody.view` (it already opened
    // the page through `custodyFund`); «التراخيص والتجديدات»'s `licenceSpend` brings
    // `fleetLicenseExpense.view` (PAGELESS — never the page).
    expect(FLEET_DASHBOARD_GATES.violationsOpen).toEqual(FLEET_DASHBOARD_GATES.violationsYear);
    expect(FLEET_DASHBOARD_GATES.exits).toEqual(FLEET_DASHBOARD_GATES.visits);
    expect(FLEET_DASHBOARD_GATES.fuelCardList).toEqual(FLEET_DASHBOARD_GATES.fuelCharging);
    expect(FLEET_DASHBOARD_GATES.opexSeries).toEqual(FLEET_DASHBOARD_GATES.opex);
    expect(FLEET_DASHBOARD_GATES.dealershipList).toEqual(FLEET_DASHBOARD_GATES.dealership);
    expect(FLEET_DASHBOARD_GATES.violations).toEqual({
      ...FLEET_DASHBOARD_GATES.violationsOpen,
      read: 'period',
    });
    expect(FLEET_DASHBOARD_GATES.violationList).toEqual(FLEET_DASHBOARD_GATES.violations);
    // `custodyStates` needs the receipts' key AND the custody key; its figures open a custody screen.
    expect(sorted(fleetDashboardGateKeys('custodyStates'))).toEqual([
      'fleetCustody.view',
      'fleetReceipt.view',
    ]);
    // NOW and PAGE: the same SETS as before. PAGE keeps its order; NOW lost `recentAccidents` (the
    // first `fleetAccident.view` gate), so that key is first seen at `accidentsOpen` now.
    expect(sorted(FLEET_DASHBOARD_NOW_KEYS)).toEqual(sorted(NOW_KEYS_BEFORE));
    expect(sorted(FLEET_DASHBOARD_PAGE_KEYS)).toEqual(sorted(PAGE_KEYS_BEFORE));
    expect([...FLEET_DASHBOARD_NOW_KEYS]).toEqual([
      'fleetVehicle.view',
      'fleetRoster.view',
      'fleetMaintenance.view',
      'fleetOdometer.view',
      'fleetDriver.view',
      'fleetLicensing.view',
      'fleetFuelCard.view',
      'fleetFuelCharge.view',
      'fleetNotice.view',
      'fleetDealership.view',
      'fleetAccident.view',
      'fleetViolation.view',
    ]);
    expect([...FLEET_DASHBOARD_PAGE_KEYS]).toEqual([
      ...FLEET_DASHBOARD_NOW_KEYS,
      'fleetReceipt.view',
      'fleetCustody.view',
    ]);
    expect([...FLEET_DASHBOARD_PERIOD_KEYS]).toEqual([
      'fleetOdometer.view',
      'fleetMaintenance.view',
      'fleetAccident.view',
      'fleetViolation.view',
      'fleetReceipt.view',
      'fleetCustody.view',
      'fleetDealership.view',
      'fleetLicenseExpense.view',
    ]);
    expect(sorted(FLEET_DASHBOARD_PAGE_KEYS)).toEqual(
      sorted([...FLEET_DASHBOARD_NOW_KEYS, ...FLEET_DASHBOARD_PERIOD_KEYS]).filter(
        (key) => key !== 'fleetLicenseExpense.view',
      ),
    );
  });

  it('is frozen: nothing at runtime can widen a gate', () => {
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_GATES.roster)).toBe(true);
    expect(Object.isFrozen(FLEET_DASHBOARD_PAGE_KEYS)).toBe(true);
  });
});

describe('tabs and their sections', () => {
  it('twelve tabs in the strip’s order: the six rebuilt ones, the three new ones, the rebuilt licences, then the two old ones', () => {
    expect(FLEET_DASHBOARD_TABS).toEqual([
      'overview',
      'today',
      'distribution',
      'maintenance',
      'km',
      'accidents',
      'violations',
      'fuel',
      'custody',
      'licences',
      'period',
      'summaries',
    ]);
    // The new tabs stand right after «الحوادث ومطالبات التأمين»; «العهدة» right after «الوقود
    // والمصروفات», then «التراخيص والتجديدات» (the old «التراخيص» key, rebuilt), then the old two.
    expect(FLEET_DASHBOARD_TABS.indexOf('violations')).toBe(
      FLEET_DASHBOARD_TABS.indexOf('accidents') + 1,
    );
    expect(FLEET_DASHBOARD_TABS.indexOf('custody')).toBe(FLEET_DASHBOARD_TABS.indexOf('fuel') + 1);
    expect(FLEET_DASHBOARD_TABS.indexOf('licences')).toBe(
      FLEET_DASHBOARD_TABS.indexOf('custody') + 1,
    );
    expect(FLEET_DASHBOARD_TABS.slice(-2)).toEqual(['period', 'summaries']);
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
      violations: ['now', 'period'],
      fuel: ['now', 'period'],
      custody: ['web', 'period'],
      licences: ['now', 'period'],
      period: ['period'],
      summaries: ['now', 'web'],
    });
    expect(FLEET_DASHBOARD_PERIOD_TABS).toEqual(['period']);
    for (const tab of FLEET_DASHBOARD_PERIOD_TABS) {
      expect(FLEET_DASHBOARD_TABS, tab).toContain(tab);
      expect(FLEET_DASHBOARD_TAB_READS[tab], tab).toEqual(['period']);
    }
    // The seven MIXED tabs: a «الآن» part + R2 parts under the page filters. Six read R1 for «الآن»…
    const mixed = ['maintenance', 'km', 'accidents', 'violations', 'fuel', 'licences'] as const;
    for (const tab of mixed) {
      expect(FLEET_DASHBOARD_PERIOD_TABS, tab).not.toContain(tab);
      expect(FLEET_DASHBOARD_TAB_READS[tab], tab).toEqual(['now', 'period']);
    }
    // …«العهدة» reads the custody screen's own hooks for it, never R1.
    expect(FLEET_DASHBOARD_TAB_READS.custody).toEqual(['web', 'period']);
    expect(FLEET_DASHBOARD_TAB_READS.custody).not.toContain('now');
    // …so the tabs drawn under the page filters are «أرقام الفترة», plus the seven mixed tabs.
    expect(
      sorted(
        FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_READS[tab].includes('period')),
      ),
    ).toEqual(sorted([...FLEET_DASHBOARD_PERIOD_TABS, ...mixed, 'custody']));
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

  it('pins the plan’s mapping (the old two unchanged)', () => {
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
      licences: ['licenceVehicles', 'licenceDrivers', 'papers'],
      custody: ['custodyFund'],
      summaries: ['fuelCharging', 'custodyFund', 'accidentsOpen', 'violationsYear'],
      period: ['km', 'visits', 'accidents', 'opex', 'dealership'],
      km: ['km', 'noReading'],
      maintenance: ['maintenanceAlarm', 'workshop', 'dealershipPending', 'exits'],
      accidents: ['accidentsOpen', 'notices', 'accidents', 'accidentList'],
      violations: ['violationsOpen', 'violations', 'violationList'],
      fuel: [
        'fuelCards',
        'fuelCharging',
        'fuelCardList',
        'fuelSheets',
        'opex',
        'opexSeries',
        'dealership',
        'dealershipList',
      ],
    });
  });

  it('pins the parts a tab draws without them ever showing it', () => {
    expect(Object.isFrozen(FLEET_DASHBOARD_TAB_PARTS)).toBe(true);
    expect(FLEET_DASHBOARD_TAB_PARTS).toEqual({
      distribution: ['km', 'supplyContracts'],
      custody: ['opex', 'custodyStates'],
      licences: ['licenceSpend'],
    });
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
    // «ملخصات» keeps the open files (the same field); the old «آخر ما سُجّل» (the recent accidents
    // and visits on «التراخيص») is retired with the old body: no section, no gate.
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).toContain('accidentsOpen');
    for (const retired of ['recentAccidents', 'recentWorkshop']) {
      expect(ALL_SECTIONS as string[], retired).not.toContain(retired);
      expect(Object.keys(FLEET_DASHBOARD_GATES), retired).not.toContain(retired);
    }
  });

  it('«المخالفات المرورية والتسويات»: every year’s owed fines now, the drivers’ fines of the period — one key', () => {
    const sections = FLEET_DASHBOARD_TAB_SECTIONS.violations;
    expect(sections.map((s) => FLEET_DASHBOARD_GATES[s].read)).toEqual(['now', 'period', 'period']);
    for (const section of sections) {
      expect([...fleetDashboardGateKeys(section)], section).toEqual(['fleetViolation.view']);
    }
    // «ملخصات» keeps the Cairo year (`violationsYear`), untouched; the overview the owed total.
    expect(sections).not.toContain('violationsYear');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).toContain('violationsYear');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.overview).toContain('violationsOpen');
    // The period's violations are this tab's alone; no old tab gains them.
    expect(
      FLEET_DASHBOARD_TABS.filter((tab) =>
        FLEET_DASHBOARD_TAB_SECTIONS[tab].some((s) => s === 'violations' || s === 'violationList'),
      ),
    ).toEqual(['violations']);
  });

  it('«الوقود والمصروفات» shows for any one of its parts, each under its own gate', () => {
    // A receipts-only reader sees the spend alone; a dealership-only reader the invoices alone; a
    // `fleetFuelCard.view`-only reader the expiry KPI alone (`fuelCards`).
    const sections = FLEET_DASHBOARD_TAB_SECTIONS.fuel;
    expect(sections.map((s) => FLEET_DASHBOARD_GATES[s].read)).toEqual([
      'now',
      'now',
      'now',
      'now',
      'period',
      'period',
      'period',
      'period',
    ]);
    expect(sections.map((section) => sorted(fleetDashboardGateKeys(section)))).toEqual([
      ['fleetFuelCard.view'],
      ['fleetFuelCard.view', 'fleetFuelCharge.view'],
      ['fleetFuelCard.view', 'fleetFuelCharge.view'],
      ['fleetFuelCard.view', 'fleetFuelCharge.view'],
      ['fleetReceipt.view'],
      ['fleetReceipt.view'],
      ['fleetDealership.view'],
      ['fleetDealership.view'],
    ]);
    const visibleTo = (held: readonly string[]): FleetDashboardSection[] =>
      sections.filter((section) =>
        fleetDashboardGateKeys(section).every((key) => held.includes(key)),
      );
    expect(visibleTo(['fleetReceipt.view'])).toEqual(['opex', 'opexSeries']);
    expect(visibleTo(['fleetDealership.view'])).toEqual(['dealership', 'dealershipList']);
    expect(visibleTo(['fleetFuelCard.view'])).toEqual(['fuelCards']);
    // The old tabs keep their reads of the same fields: «أرقام الفترة» the spend and the invoices,
    // «ملخصات» the charging summary; the overview all of them. The cards' expiry left «التراخيص»
    // with its old body: it is this tab's and the overview's (§11 Q1).
    expect(FLEET_DASHBOARD_TAB_SECTIONS.period).toEqual(
      expect.arrayContaining(['opex', 'dealership']),
    );
    expect(FLEET_DASHBOARD_TAB_SECTIONS.summaries).toContain('fuelCharging');
    expect(
      FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_SECTIONS[tab].includes('fuelCards')),
    ).toEqual(['overview', 'fuel']);
    // The new parts are this tab's alone.
    for (const section of ['fuelCardList', 'fuelSheets', 'opexSeries', 'dealershipList'] as const) {
      expect(
        FLEET_DASHBOARD_TABS.filter((tab) => FLEET_DASHBOARD_TAB_SECTIONS[tab].includes(section)),
        section,
      ).toEqual(['fuel']);
    }
  });

  it('lists the sections in DTO order: «آخر ما سُجّل» retired from R1, «العهدة» and «التراخيص والتجديدات» add one R2 section each', () => {
    expect([...FLEET_DASHBOARD_NOW_SECTIONS]).toEqual([
      'vehicles',
      'roster',
      'workshop',
      'maintenanceAlarm',
      'noReading',
      'distributionVehicles',
      'distributionDrivers',
      'licenceVehicles',
      'licenceDrivers',
      'papers',
      'fuelCards',
      'fuelCharging',
      'fuelCardList',
      'fuelSheets',
      'notices',
      'dealershipPending',
      'accidentsOpen',
      'violationsYear',
      'violationsOpen',
    ]);
    expect([...FLEET_DASHBOARD_PERIOD_SECTIONS]).toEqual([
      'km',
      'visits',
      'exits',
      'accidents',
      'accidentList',
      'violations',
      'violationList',
      'opex',
      'opexSeries',
      'custodyStates',
      'dealership',
      'dealershipList',
      'licenceSpend',
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

  it('«العهدة» shows for the custody fund’s reader alone; its period band is a part drawn beside it', () => {
    expect(FLEET_DASHBOARD_TAB_SECTIONS.custody).toEqual(['custodyFund']);
    expect(FLEET_DASHBOARD_TAB_PARTS.custody).toEqual(['opex', 'custodyStates']);
    const showsFor = (held: readonly string[]): boolean =>
      FLEET_DASHBOARD_TAB_SECTIONS.custody.some((section) =>
        fleetDashboardGateKeys(section).every((key) => held.includes(key)),
      );
    expect(showsFor(['fleetCustody.view'])).toBe(true);
    // A receipts-only reader gets no «العهدة» (they keep the custody spend on «أرقام الفترة» and the
    // fuel tab's bars — the same `opex` fields).
    expect(showsFor(['fleetReceipt.view'])).toBe(false);
    expect(FLEET_DASHBOARD_TAB_SECTIONS.period).toContain('opex');
    expect(FLEET_DASHBOARD_TAB_SECTIONS.fuel).toContain('opex');
    // «منها حتى الآن» needs both keys: the receipts, and the memos they stand on.
    const permitted = (held: readonly string[]): FleetDashboardSection[] =>
      (FLEET_DASHBOARD_TAB_PARTS.custody ?? []).filter((section) =>
        fleetDashboardGateKeys(section).every((key) => held.includes(key)),
      );
    expect(permitted(['fleetCustody.view'])).toEqual([]);
    expect(permitted(['fleetCustody.view', 'fleetReceipt.view'])).toEqual([
      'opex',
      'custodyStates',
    ]);
    expect(permitted(['fleetReceipt.view'])).toEqual(['opex']);
    // `custodyStates` is this tab's alone.
    expect(
      FLEET_DASHBOARD_TABS.filter((tab) =>
        [...FLEET_DASHBOARD_TAB_SECTIONS[tab], ...(FLEET_DASHBOARD_TAB_PARTS[tab] ?? [])].includes(
          'custodyStates',
        ),
      ),
    ).toEqual(['custody']);
  });

  it('«التراخيص والتجديدات» shows for any one of its KPIs, each under its own gate; a licensing-only reader keeps it', () => {
    const sections = FLEET_DASHBOARD_TAB_SECTIONS.licences;
    expect(sections).toEqual(['licenceVehicles', 'licenceDrivers', 'papers']);
    expect(sections.map((s) => FLEET_DASHBOARD_GATES[s].read)).toEqual(['now', 'now', 'now']);
    expect(sections.map((section) => [...fleetDashboardGateKeys(section)])).toEqual([
      ['fleetVehicle.view'],
      ['fleetDriver.view'],
      ['fleetLicensing.view'],
    ]);
    const visibleTo = (held: readonly string[]): FleetDashboardSection[] =>
      sections.filter((section) =>
        fleetDashboardGateKeys(section).every((key) => held.includes(key)),
      );
    // §11 A2: the licensing board's reader keeps `/fleet` and this tab, with the papers alone.
    expect(visibleTo(['fleetLicensing.view'])).toEqual(['papers']);
    expect(FLEET_DASHBOARD_PAGE_KEYS).toContain('fleetLicensing.view');
    // A licence-expense-only reader: the spend is permitted, but it shows no tab and opens no page.
    expect(visibleTo(['fleetLicenseExpense.view'])).toEqual([]);
    // A fuel-card-only reader lost this tab (the cards' expiry is on «الوقود والمصروفات»).
    expect(visibleTo(['fleetFuelCard.view'])).toEqual([]);
    expect(FLEET_DASHBOARD_TAB_SECTIONS.fuel).toContain('fuelCards');
    // The overview's red lines read the same two sections.
    for (const section of ['licenceVehicles', 'licenceDrivers'] as const) {
      expect(FLEET_DASHBOARD_TAB_SECTIONS.overview, section).toContain(section);
    }
    // `papers` and `licenceSpend` are this tab's alone.
    for (const section of ['papers', 'licenceSpend'] as const) {
      expect(
        FLEET_DASHBOARD_TABS.filter((tab) =>
          [
            ...FLEET_DASHBOARD_TAB_SECTIONS[tab],
            ...(FLEET_DASHBOARD_TAB_PARTS[tab] ?? []),
          ].includes(section),
        ),
        section,
      ).toEqual(['licences']);
    }
  });

  it('caps the «الحركة اليوم» lists with their own constant', () => {
    expect(FLEET_DASHBOARD_TODAY_ROWS).toBe(8);
  });

  it('caps the lists of «العهدة» and «التراخيص والتجديدات» with their own constants', () => {
    // «آخر عمليات العهدة».
    expect(FLEET_DASHBOARD_CUSTODY_RECENT_ROWS).toBe(6);
    // «في مذكرات لم تُستعَض بعد» and «تنتظر التسوية» before «و N أخرى»: the same number, a separate rule.
    expect(FLEET_DASHBOARD_CUSTODY_WAIT_ROWS).toBe(6);
    // «أقرب تراخيص السيارات» and «أقرب رخص السائقين» before «عرض الباقي (N)».
    expect(FLEET_DASHBOARD_LICENCE_ROWS).toBe(6);
    // «التراخيص المستحقة للتجديد — 12 شهرًا».
    expect(FLEET_DASHBOARD_LICENCE_MONTHS).toBe(12);
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

  it('caps the lists of «المخالفات المرورية والتسويات» and «الوقود والمصروفات» with their own constants', () => {
    // «مخالفات السائقين في الفترة» before «عرض الباقي (N) في السجل».
    expect(FLEET_DASHBOARD_VIOLATION_ROWS).toBe(6);
    // «كروت تحتاج متابعة» before «تُعرض هنا أول 8 كروت…».
    expect(FLEET_DASHBOARD_FUEL_CARD_ROWS).toBe(8);
    // «فواتير التوكيل في الفترة» before «عرض الباقي (N) في شاشة التوكيل».
    expect(FLEET_DASHBOARD_DEALERSHIP_ROWS).toBe(6);
  });

  it('orders the states of a card to follow up by urgency', () => {
    expect([...FLEET_DASHBOARD_FUEL_CARD_STATES]).toEqual([
      'expired',
      'critical',
      'requested',
      'low',
      'expiring',
    ]);
    const states: FleetDashboardFuelCardState[] = [...FLEET_DASHBOARD_FUEL_CARD_STATES];
    expect(new Set(states).size).toBe(states.length);
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
          deleted: false,
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
          deleted: false,
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
      // Only a registry car can have been deleted since.
      if (row.vehicleId === null) expect(row.deleted, row.code).toBe(false);
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

describe('the shapes of «المخالفات المرورية والتسويات» and «الوقود والمصروفات»', () => {
  const name = { ar: 'س', en: 'S' };
  const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

  it('violations now: the drivers’ parts tie to their total, the carless rows are the company view’s', () => {
    const open: FleetDashboardNowViolationsOpenDto = {
      company: { amount: 14650, count: 30 },
      drivers: {
        total: { amount: 9850, count: 18 },
        attributed: { amount: 7600, count: 14, drivers: 9 },
        unknown: { amount: 1350, count: 3 },
        unlinked: { amount: 900, count: 1 },
      },
      total: { amount: 24500, count: 48 },
      bookOnly: { company: { amount: 600, count: 2 }, drivers: { amount: 0, count: 0 } },
    };
    const { drivers } = open;
    const parts = [drivers.attributed, drivers.unknown, drivers.unlinked];
    expect(sum(parts.map((p) => p.amount))).toBe(drivers.total.amount);
    expect(sum(parts.map((p) => p.count))).toBe(drivers.total.count);
    // «سائقون معروفون» is a distinct count of drivers: never more than their fines.
    expect(drivers.attributed.drivers).toBeLessThanOrEqual(drivers.attributed.count);
    expect(open.total.count).toBe(open.company.count + drivers.total.count);
    expect(open.total.amount).toBe(open.company.amount + drivers.total.amount);
    // The carless rows are inside the owed figures.
    expect(open.bookOnly?.company.count).toBeLessThanOrEqual(open.company.count);
    expect(open.bookOnly?.drivers.count).toBeLessThanOrEqual(drivers.total.count);
    // Narrowed to branches: no carless line at all.
    const branch: FleetDashboardNowViolationsOpenDto = { ...open, bookOnly: null };
    expect(branch.bookOnly).toBeNull();
  });

  it('violations period: owed + collected = the period, the types sum to it with «غير محدد» last, rows a day each', () => {
    const violations: FleetDashboardPeriodViolationsDto = {
      count: 8,
      amount: 3450,
      owed: { count: 6, amount: 2550 },
      collected: { count: 2, amount: 900 },
      byType: [
        { violationTypeId: ID_A, name, unspecified: false, count: 3, amount: 1500 },
        { violationTypeId: ID_B, name: null, unspecified: false, count: 3, amount: 1200 },
        { violationTypeId: 'c'.repeat(24), name, unspecified: true, count: 2, amount: 750 },
      ],
    };
    expect(violations.owed.count + violations.collected.count).toBe(violations.count);
    expect(violations.owed.amount + violations.collected.amount).toBe(violations.amount);
    expect(sum(violations.byType.map((bar) => bar.count))).toBe(violations.count);
    expect(sum(violations.byType.map((bar) => bar.amount))).toBe(violations.amount);
    expect(violations.byType.at(-1)?.unspecified).toBe(true);
    expect(violations.byType.filter((bar) => bar.unspecified)).toHaveLength(1);
    const row: FleetDashboardPeriodViolationRowDto = {
      violationId: ID_A,
      vehicleId: ID_A,
      code: '150',
      typeName: name,
      vehicleDeleted: false,
      date: '2026-11-10',
      driverEmployeeId: ID_B,
      driverName: 'س',
      violationTypeId: ID_A,
      violationType: name,
      unspecified: false,
      amount: 500,
      collected: false,
    };
    const oldBook: FleetDashboardPeriodViolationRowDto = {
      ...row,
      violationId: ID_B,
      vehicleId: null,
      code: '9001',
      typeName: null,
      date: '2026-11-03',
      driverEmployeeId: null,
      driverName: 'مجهول',
      collected: true,
    };
    const list: NonNullable<FleetDashboardPeriodDto['violationList']> = {
      rows: [row, oldBook],
      more: 6,
    };
    expect(list.rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_VIOLATION_ROWS);
    expect(list.rows.length + list.more).toBe(violations.count);
    // Newest fine day first; a day, never a time.
    expect(list.rows.map((r) => r.date)).toEqual(
      list.rows
        .map((r) => r.date)
        .sort()
        .reverse(),
    );
    for (const r of list.rows) expect(r.date, r.violationId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Only a registry car can have been deleted since.
    expect(oldBook.vehicleDeleted).toBe(false);
  });

  it('fuel now: per-company cards sum to the cards, the no-car cards are the company view’s, the KPI names its nearest day', () => {
    const charging: FleetDashboardNowFuelChargingDto = {
      wataniya: 296480,
      chillout: 189770,
      requested: { count: 5, amount: 37500 },
      low: { belowYellow: 7, belowRed: 2, yellowAt: 500, redAt: 200 },
      charged24h: 15000,
      cards: 142,
      companyCards: { wataniya: 90, chillout: 52 },
      unassigned: { count: 6, balance: 9870 },
    };
    expect(charging.companyCards.wataniya + charging.companyCards.chillout).toBe(charging.cards);
    expect(charging.unassigned?.count).toBeLessThanOrEqual(charging.cards);
    const branch: FleetDashboardNowFuelChargingDto = { ...charging, unassigned: null };
    expect(branch.unassigned).toBeNull();
    const fuelCards: NonNullable<FleetDashboardNowDto['fuelCards']> = {
      warnDays: 30,
      expired: 2,
      expiring: 3,
      nearest: '2026-11-20',
    };
    expect(fuelCards.nearest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const none: NonNullable<FleetDashboardNowDto['fuelCards']> = {
      ...fuelCards,
      expiring: 0,
      nearest: null,
    };
    expect(none.nearest).toBeNull();
  });

  it('fuel now: the cards to follow up — urgency order, a card on no car last, the total a field', () => {
    const card = (
      over: Partial<FleetDashboardNowFuelCardRowDto>,
    ): FleetDashboardNowFuelCardRowDto => ({
      cardId: ID_A,
      company: 'wataniya',
      number: '7080123456784417',
      vehicleId: ID_A,
      code: '150',
      typeName: name,
      vehicleDeleted: false,
      label: null,
      balance: 1200,
      requestedAmount: null,
      expiresAt: '2027-03-31',
      states: ['expiring'],
      ...over,
    });
    const rows: FleetDashboardNowFuelCardRowDto[] = [
      card({ states: ['expired'], expiresAt: '2026-11-01' }),
      card({ code: '151', states: ['critical', 'requested'], balance: 90, requestedAmount: 2000 }),
      card({ code: '152', company: 'chillout', states: ['low'], balance: 380 }),
      // On a car deleted since: counted by its last branch, no record link.
      card({ code: '153', vehicleDeleted: true, states: ['expiring'] }),
      card({
        vehicleId: null,
        code: null,
        typeName: null,
        label: 'سفر 1',
        states: ['low'],
        balance: 300,
      }),
    ];
    const list: NonNullable<FleetDashboardNowDto['fuelCardList']> = { rows, total: 11 };
    expect(list.rows.length).toBeLessThanOrEqual(
      Math.min(list.total, FLEET_DASHBOARD_FUEL_CARD_ROWS),
    );
    const rank = (state: FleetDashboardFuelCardState): number =>
      FLEET_DASHBOARD_FUEL_CARD_STATES.indexOf(state);
    for (const row of list.rows) {
      expect(row.states.length, row.number).toBeGreaterThan(0);
      // Each row's states in urgency order; `critical` and `low` never both.
      expect(row.states.map(rank)).toEqual([...row.states.map(rank)].sort((a, b) => a - b));
      expect(row.states.includes('critical') && row.states.includes('low')).toBe(false);
      if (row.vehicleId === null) {
        expect(row.label, row.number).not.toBeNull();
        expect(row.vehicleDeleted).toBe(false);
      }
    }
    // The cars by their most urgent state; the no-car cards last.
    const onCars = list.rows.filter((row) => row.vehicleId !== null);
    expect(onCars.map((row) => rank(row.states[0] ?? 'expiring'))).toEqual(
      onCars.map((row) => rank(row.states[0] ?? 'expiring')).sort((a, b) => a - b),
    );
    expect(list.rows.at(-1)?.vehicleId).toBeNull();
  });

  it('fuel now: one sheet per company as at its read, `null` for a company never read', () => {
    const read: FleetDashboardNowFuelSheetDto = {
      sheetDate: '2026-11-09',
      readDay: '2026-11-10',
      differing: 9,
      undecided: 3,
      undecidedNet: -1365.5,
    };
    const old: FleetDashboardNowFuelSheetDto = {
      sheetDate: null,
      readDay: '2026-11-05',
      differing: 4,
      undecided: 0,
      undecidedNet: 0,
    };
    const sheets: NonNullable<FleetDashboardNowDto['fuelSheets']> = {
      wataniya: read,
      chillout: old,
    };
    const neverRead: NonNullable<FleetDashboardNowDto['fuelSheets']> = {
      wataniya: read,
      chillout: null,
    };
    expect(Object.keys(sheets).sort()).toEqual(['chillout', 'wataniya']);
    for (const sheet of [read, old]) {
      expect(sheet.undecided).toBeLessThanOrEqual(sheet.differing);
      if (sheet.undecided === 0) expect(sheet.undecidedNet).toBe(0);
    }
    expect(neverRead.chillout).toBeNull();
  });

  it('fuel period: the spend splits by kind, the series sums to it, the invoices are a page of their count', () => {
    const opex: NonNullable<FleetDashboardPeriodDto['opex']> = {
      card: 116350,
      custody: 81950,
      fuel: 142500,
      total: 198300,
      count: 574,
      dataFrom: '2025-01-01',
      fuelCustody: 26150,
      tyres: 28450,
      wash: 9650,
      maintenance: 17700,
      litres: 8890,
      unpricedFuel: 2,
      custodyCount: 236,
    };
    expect(opex.card + opex.fuelCustody + opex.tyres + opex.wash + opex.maintenance).toBe(
      opex.total,
    );
    // The custody receipts are some of the period's receipts.
    expect(opex.custodyCount).toBeLessThanOrEqual(opex.count);
    expect(opex.card + opex.custody).toBe(opex.total);
    expect(opex.card + opex.fuelCustody).toBe(opex.fuel);
    expect(Number.isInteger(opex.litres)).toBe(true);
    const buckets: FleetDashboardOpexBucketDto[] = [
      { key: '2026-11-01', hasRows: true, amount: 98300, count: 300 },
      // An empty slot (no receipt that day), never a zero column.
      { key: '2026-11-02', hasRows: false, amount: 0, count: 0 },
      { key: '2026-11-03', hasRows: true, amount: 100000, count: 274 },
    ];
    const series: NonNullable<FleetDashboardPeriodDto['opexSeries']> = { buckets };
    expect(sum(series.buckets.map((b) => b.amount))).toBe(opex.total);
    expect(sum(series.buckets.map((b) => b.count))).toBe(opex.count);
    expect(series.buckets.map((b) => b.key)).toEqual(series.buckets.map((b) => b.key).sort());
    for (const b of series.buckets.filter((bucket) => !bucket.hasRows)) {
      expect(b.amount, b.key).toBe(0);
      expect(b.count, b.key).toBe(0);
    }
    const dealership: NonNullable<FleetDashboardPeriodDto['dealership']> = {
      amount: 96750,
      rows: 8,
      pending: 1,
      dataFrom: '2025-01-01',
    };
    const row: FleetDashboardPeriodDealershipRowDto = {
      id: ID_A,
      vehicleId: ID_A,
      code: '221',
      typeName: name,
      vehicleDeleted: false,
      date: '2026-11-10',
      workKind: 'repair',
      workTypeLabel: 'إصلاح',
      invoiceNumber: '5531',
      invoiceAmount: null,
    };
    const oldBook: FleetDashboardPeriodDealershipRowDto = {
      ...row,
      id: ID_B,
      vehicleId: null,
      code: '9001',
      typeName: null,
      date: '2026-11-04',
      workKind: 'maintenance',
      workTypeLabel: 'صيانة',
      invoiceAmount: 4200,
    };
    const list: NonNullable<FleetDashboardPeriodDto['dealershipList']> = {
      rows: [row, oldBook],
      more: 6,
    };
    expect(list.rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_DEALERSHIP_ROWS);
    expect(list.rows.length + list.more).toBe(dealership.rows);
    // The exit day, never `outDate` (the dashboard never names that field), never a time.
    expect(Object.keys(row)).not.toContain('outDate');
    for (const r of list.rows) expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // «بانتظار تسجيل القيمة» is a row with no value yet.
    expect(list.rows.filter((r) => r.invoiceAmount === null).length).toBeLessThanOrEqual(
      dealership.pending,
    );
  });
});

describe('the shapes of «العهدة» and «التراخيص والتجديدات»', () => {
  const name = { ar: 'س', en: 'S' };
  const ID_C = 'c'.repeat(24);
  const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
  const today = '2026-11-17';
  /** FLEET_DASHBOARD_LICENCE_MONTHS slots from this (Cairo) month. */
  const MONTH_KEYS = [
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
    '2027-03',
    '2027-04',
    '2027-05',
    '2027-06',
    '2027-07',
    '2027-08',
    '2027-09',
    '2027-10',
  ];
  const months = (counts: readonly number[]): FleetDashboardLicenceMonthDto[] =>
    MONTH_KEYS.map((key, i) => ({ key, count: counts[i] ?? 0 }));

  it('licences now (cars): the nearest rows carry the make, the licence class and the board’s papers; twelve month slots from this month', () => {
    const row = (
      over: Partial<FleetDashboardNowLicenceVehicleRowDto>,
    ): FleetDashboardNowLicenceVehicleRowDto => ({
      vehicleId: ID_A,
      code: '150',
      expiresAt: '2026-11-03',
      days: -14,
      typeName: name,
      licenceClass: name,
      papers: { insurance: 'open', tax: 'none' },
      ...over,
    });
    const cars: FleetDashboardNowLicenceVehiclesDto = {
      warnDays: 30,
      expired: 2,
      expiring: 3,
      soon: 4,
      outOfServiceExpired: 1,
      list: [
        row({}),
        // Expired ON its expiry day (R-02); a «م» car is not on the board: no papers.
        row({ vehicleId: ID_B, code: '151', expiresAt: '2026-11-17', days: 0, papers: null }),
        row({
          code: '152',
          expiresAt: '2026-11-20',
          days: 3,
          typeName: null,
          licenceClass: null,
          papers: { insurance: 'done', tax: 'open' },
        }),
        row({ code: '153', expiresAt: '2026-11-27', days: 10 }),
        row({ code: '154', expiresAt: '2026-12-12', days: 25 }),
        row({ code: '155', expiresAt: '2026-12-27', days: 40, papers: null }),
      ],
      more: 3,
      months: months([4, 2, 0, 1, 0, 0, 3, 0, 0, 0, 1, 0]),
    };
    expect(cars.list.length).toBeLessThanOrEqual(FLEET_DASHBOARD_LICENCE_ROWS);
    // W < 60: the rows and the cars left out are the three windows.
    expect(cars.list.length + cars.more).toBe(cars.expired + cars.expiring + cars.soon);
    // Expiry day ascending — the longest-expired first; `days` from Cairo today; R-02 states.
    expect(cars.list.map((r) => r.expiresAt)).toEqual(cars.list.map((r) => r.expiresAt).sort());
    for (const r of cars.list) {
      expect(r.days, r.code).toBe(daysBetweenYmd(today, r.expiresAt));
      expect(expiryStateOn(r.expiresAt, today, cars.warnDays) === 'expired', r.code).toBe(
        r.days <= 0,
      );
      expect(r.expiresAt, r.code).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(cars.list.filter((r) => r.days <= 0)).toHaveLength(cars.expired);
    // Twelve slots from this month, in order, zeros kept.
    expect(cars.months).toHaveLength(FLEET_DASHBOARD_LICENCE_MONTHS);
    expect(cars.months.map((m) => m.key)).toEqual(MONTH_KEYS);
    expect(cars.months[0]?.key).toBe(today.slice(0, 7));
    expect(cars.months.filter((m) => m.count === 0).length).toBeGreaterThan(0);
    for (const m of cars.months)
      expect(Number.isInteger(m.count) && m.count >= 0, m.key).toBe(true);
  });

  it('licences now (drivers): the nearest files with their licence type, a suspended file flagged and still counted, the same month keys', () => {
    const row = (
      over: Partial<FleetDashboardNowLicenceDriverRowDto>,
    ): FleetDashboardNowLicenceDriverRowDto => ({
      profileId: ID_A,
      employeeId: ID_B,
      expiresAt: '2026-10-01',
      days: -47,
      licenceType: name,
      active: true,
      ...over,
    });
    const drivers: FleetDashboardNowLicenceDriversDto = {
      warnDays: 30,
      expired: 2,
      expiring: 1,
      soon: 1,
      notRecorded: 3,
      unregistered: 1,
      months: months([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]),
      list: {
        rows: [
          // «الملف موقوف»: a suspended Fleet file is counted as the counts are.
          row({ active: false }),
          row({ profileId: ID_B, employeeId: ID_C, expiresAt: '2026-11-10', days: -7 }),
          row({
            profileId: ID_C,
            employeeId: ID_A,
            expiresAt: '2026-11-30',
            days: 13,
            licenceType: null,
          }),
        ],
        more: 1,
      },
    };
    const { rows, more } = drivers.list;
    expect(rows.length).toBeLessThanOrEqual(FLEET_DASHBOARD_LICENCE_ROWS);
    expect(rows.length + more).toBe(drivers.expired + drivers.expiring + drivers.soon);
    expect(rows.map((r) => r.expiresAt)).toEqual(rows.map((r) => r.expiresAt).sort());
    for (const r of rows) {
      expect(r.days, r.profileId).toBe(daysBetweenYmd(today, r.expiresAt));
      expect(r.days, r.profileId).toBeLessThanOrEqual(FLEET_LICENCE_GREY_DAYS);
    }
    expect(rows.filter((r) => !r.active)).toHaveLength(1);
    // The names are the browser's (`/fleet/people`): no name on the wire.
    expect(Object.keys(rows[0] ?? {})).not.toContain('name');
    expect(drivers.months.map((m) => m.key)).toEqual(MONTH_KEYS);
  });

  it('licences period: renewal + extension = visa + cash = total, the register’s count and cars', () => {
    const spend: FleetDashboardPeriodLicenceSpendDto = {
      count: 14,
      cars: 37,
      visa: 41250,
      cash: 9800,
      renewal: 38400,
      extension: 12650,
      total: 51050,
    };
    expect(spend.renewal + spend.extension).toBe(spend.total);
    expect(spend.visa + spend.cash).toBe(spend.total);
    const none: FleetDashboardPeriodLicenceSpendDto = {
      count: 0,
      cars: 0,
      visa: 0,
      cash: 0,
      renewal: 0,
      extension: 0,
      total: 0,
    };
    expect(sum(Object.values(none))).toBe(0);
    const period: Pick<FleetDashboardPeriodDto, 'licenceSpend'> = { licenceSpend: spend };
    expect(period.licenceSpend?.total).toBe(51050);
  });

  it('custody period: the custody receipts counted, and where their money stands now — the three parts are opex.custody', () => {
    const custody = 81950;
    const states: FleetDashboardPeriodCustodyStatesDto = {
      replenished: 52300,
      pending: 21400.5,
      outside: 8249.5,
    };
    // In the memo states' order: «تمت الاستعاضة» · «في مذكرات لم تُستعَض» · «خارج المذكرات».
    expect(Object.keys(states)).toEqual([...FLEET_CUSTODY_MEMO_STATES]);
    expect(states.replenished + states.pending + states.outside).toBe(custody);
    // A held memo's money is not back in the fund yet: it counts as pending.
    expect(FLEET_CUSTODY_MEMO_STATE_OF_STATUS.held).toBe('pending');
    const period: Pick<FleetDashboardPeriodDto, 'custodyStates'> = { custodyStates: states };
    expect(period.custodyStates).toEqual(states);
  });

  it('custody now: each held letter with its memos, the oldest first, tying to the held figures', () => {
    const letters: FleetCustodyHeldLetterDto[] = [
      {
        id: ID_A,
        date: '2026-10-28',
        from: '2026-10-01',
        to: '2026-10-25',
        amount: 12500.75,
        receipts: 31,
        memos: [
          {
            id: ID_A,
            no: 41,
            kind: 'fuel',
            name: '',
            date: '2026-10-26',
            receipts: 20,
            total: 8000.25,
          },
          {
            id: ID_B,
            no: 42,
            kind: 'maintenance',
            name: 'صيانة أكتوبر',
            date: '2026-10-27',
            receipts: 11,
            total: 4500.5,
          },
        ],
      },
      {
        id: ID_B,
        date: '2026-11-05',
        from: null,
        to: null,
        amount: 3000,
        receipts: 4,
        memos: [
          {
            id: ID_C,
            no: 45,
            kind: 'wash',
            name: '',
            date: '2026-11-04',
            receipts: 4,
            total: 3000,
          },
        ],
      },
    ];
    const held: FleetCustodyFundSummaryDto['held'] = {
      count: 2,
      amount: 15500.75,
      memos: 3,
      receipts: 35,
      letters,
    };
    expect(held.letters).toHaveLength(held.count);
    expect(sum(held.letters.map((l) => l.amount))).toBe(held.amount);
    expect(sum(held.letters.map((l) => l.receipts))).toBe(held.receipts);
    expect(sum(held.letters.map((l) => l.memos.length))).toBe(held.memos);
    // The oldest letter first («في انتظار التحويل منذ …» reads `letters[0].date`).
    expect(held.letters.map((l) => l.date)).toEqual(held.letters.map((l) => l.date).sort());
    for (const letter of held.letters) {
      expect(sum(letter.memos.map((m) => m.receipts)), letter.id).toBe(letter.receipts);
      expect(
        letter.memos.map((m) => m.no),
        letter.id,
      ).toEqual([...letter.memos.map((m) => m.no)].sort((a, b) => a - b));
    }
    const none: FleetCustodyFundSummaryDto['held'] = {
      count: 0,
      amount: 0,
      memos: 0,
      receipts: 0,
      letters: [],
    };
    expect(none.letters).toHaveLength(none.count);
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

  it('lets the fuel cards list and summary ask a branch (the card’s current car), and still refuse unknowns', () => {
    for (const [name, schema] of Object.entries({
      ListFleetFuelCardsQuerySchema,
      FleetFuelCardSummaryQuerySchema,
    })) {
      const result = schema.safeParse({ branchIds: `${ID_A},${ID_B}`, company: 'wataniya' });
      expect(result.success, name).toBe(true);
      if (result.success) expect(result.data.branchIds, name).toEqual([ID_A, ID_B]);
      expect(schema.safeParse({ branchIds: 'nope' }).success, name).toBe(false);
      // Branch only: the fuel cards take no type or operation set.
      expect(schema.safeParse({ typeIds: ID_A }).success, name).toBe(false);
      expect(schema.safeParse({ branch: ID_A }).success, name).toBe(false);
    }
  });

  it('the fuel and receipt totals carry the new figures', () => {
    const cards: FleetFuelCardTotalsDto = {
      wataniyaBalance: 296480,
      chilloutBalance: 189770,
      requestedCount: 5,
      requestedAmount: 37500,
      chargedTodayAmount: 15000,
      cardCount: 142,
      wataniyaCards: 90,
      chilloutCards: 52,
      noCarCards: 6,
      noCarBalance: 9870,
    };
    expect(cards.wataniyaCards + cards.chilloutCards).toBe(cards.cardCount);
    const receipts: FleetReceiptTotalsDto = {
      count: 574,
      custodyTotal: 81950,
      cardTotal: 116350,
      fuelTotal: 142500,
      fuelLitres: 8890.4,
      tyresTotal: 28450,
      washTotal: 9650,
      maintenanceTotal: 17700,
      fuelCustodyTotal: 26150,
      fuelUnpriced: 2,
      custodyCount: 236,
    };
    expect(receipts.fuelTotal - receipts.fuelCustodyTotal).toBe(receipts.cardTotal);
    expect(receipts.custodyCount).toBeLessThanOrEqual(receipts.count);
  });

  it('lets the violations list ask the fine’s day (from/to), beside its other filters', () => {
    const result = ListFleetViolationsQuerySchema.safeParse({
      kind: 'driver',
      from: '2026-11-01',
      to: '2026-11-15',
      collected: 'false',
      violationTypeId: ID_A,
      vehicleCodes: '150',
      branchIds: ID_B,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBeInstanceOf(Date);
      expect(result.data.from?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(result.data.to?.toISOString()).toBe('2026-11-15T00:00:00.000Z');
      expect(result.data.collected).toBe(false);
    }
    // Each end alone is a question too.
    expect(ListFleetViolationsQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(true);
    expect(ListFleetViolationsQuerySchema.safeParse({ to: '2026-11-15' }).success).toBe(true);
    expect(ListFleetViolationsQuerySchema.safeParse({ from: 'not a day' }).success).toBe(false);
    // Still strict: the web's own names never reach the API.
    expect(ListFleetViolationsQuerySchema.safeParse({ dfrom: '2026-11-01' }).success).toBe(false);
    // The rollup has no day: a statement carries a year only.
    expect(FleetViolationRollupQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(false);
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
