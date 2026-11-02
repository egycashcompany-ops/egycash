// «لوحة تحكم الحركة» — the fleet module's home (/fleet), Phase 1.
//
// Two reads feed ten tabs:
//   · R1 `GET /fleet/dashboard/now`    — the state of the fleet NOW (tabs 1–5), one Cairo `today`;
//   · R2 `GET /fleet/dashboard/period` — a period's figures (tabs 6–10), a preset or a custom range.
// The server resolves every date (R-01) and echoes it; the browser builds every label, chip and link
// from that echo, never from its own clock. Every section is NULLABLE: `null` is "the reader may not
// see it" or, when it is also named in `unavailable`, "its source failed" — never a zero.
//
// Each figure is counted by the module that owns its screen, with the query that screen sends, so the
// number on the dashboard is the number on the linked page by construction (plan D9). This file holds
// only the shared rules (presets, expiry states, paper stage, gates) and the shapes.
import { z } from 'zod';
import { type LocalizedString } from '../common/localized.js';
import { listQuery, objectId } from '../common/index.js';
import { addDaysYmd, daysBetweenYmd, isYmd, ymdOf } from '../common/cairo-date.js';
import { type FleetAccidentStatus, vehicleCodesQuery } from './fleet.js';

// ── Tabs, presets, constants ────────────────────────────────────────────────

export const FLEET_DASHBOARD_TABS = [
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
] as const;
export type FleetDashboardTab = (typeof FLEET_DASHBOARD_TABS)[number];
/** «الآن» — the tabs read from R1. */
export const FLEET_DASHBOARD_NOW_TABS = [
  'alerts',
  'now',
  'distribution',
  'licences',
  'summaries',
] as const;
/** «حسب الفلاتر» — the tabs read from R2. */
export const FLEET_DASHBOARD_PERIOD_TABS = [
  'period',
  'km',
  'ranking',
  'maintenance',
  'accidents',
] as const;

export const FLEET_DASHBOARD_PRESETS = [
  'thisMonth',
  'lastMonth',
  'last30',
  'thisYear',
  'custom',
] as const;
export type FleetDashboardPreset = (typeof FLEET_DASHBOARD_PRESETS)[number];
export const FLEET_DASHBOARD_DEFAULT_PRESET: FleetDashboardPreset = 'thisMonth';
/** The longest custom range, in inclusive days. */
export const FLEET_DASHBOARD_MAX_CUSTOM_DAYS = 366;
/** R-10: the grey licence bucket's far edge, in days after today (the owner's spec number). */
export const FLEET_LICENCE_GREY_DAYS = 60;
/** R-12: the recent-records window, in Cairo days (today included). */
export const FLEET_DASHBOARD_RECENT_DAYS = 30;
export const FLEET_DASHBOARD_RECENT_ROWS = 8;
/** T4.4: licence rows listed before «+N». */
export const FLEET_DASHBOARD_LICENCE_ROWS = 6;
/** T10.1: accident rows listed before «+M». */
export const FLEET_DASHBOARD_ACCIDENT_ROWS = 6;
export const FLEET_DASHBOARD_RANK_ROWS = 5;
/** R-07: the default of `fleet.odometer.missingReadingDays`. */
export const FLEET_ODOMETER_MISSING_READING_DAYS_DEFAULT = 3;

const firstOfMonth = (ymd: string): string => `${ymd.slice(0, 7)}-01`;

/** Why a custom range is refused, or `null` when it is a valid one. */
const customRangeProblem = (from: string | undefined, to: string | undefined): string | null => {
  if (from === undefined || to === undefined) return 'from and to are required';
  if (!isYmd(from) || !isYmd(to)) return "from and to must be real 'YYYY-MM-DD' dates";
  if (from > to) return 'from must not be after to';
  if (daysBetweenYmd(from, to) + 1 > FLEET_DASHBOARD_MAX_CUSTOM_DAYS) {
    return `the period may span at most ${FLEET_DASHBOARD_MAX_CUSTOM_DAYS} days`;
  }
  return null;
};

/**
 * R-01 on a Cairo `today` ('YYYY-MM-DD'), inclusive Cairo days:
 *   thisMonth = [the 1st of today's month, today] · lastMonth = [the 1st, the last day of the
 *   previous month] · last30 = [today − 29, today] · thisYear = [1 January, today] ·
 *   custom = [from, to], from ≤ to, at most 366 days.
 * `custom` is read only with the `custom` preset. Throws a RangeError on an invalid `today` or an
 * invalid custom range (the schema refuses such a request first).
 */
export const periodOf = (
  preset: FleetDashboardPreset,
  today: string,
  custom?: { from: string; to: string },
): { preset: FleetDashboardPreset; from: string; to: string; days: number } => {
  if (!isYmd(today)) throw new RangeError(`today must be a real 'YYYY-MM-DD' date, got '${today}'`);
  const range = (from: string, to: string) => ({
    preset,
    from,
    to,
    days: daysBetweenYmd(from, to) + 1,
  });
  switch (preset) {
    case 'thisMonth':
      return range(firstOfMonth(today), today);
    case 'lastMonth': {
      const lastDay = addDaysYmd(firstOfMonth(today), -1);
      return range(firstOfMonth(lastDay), lastDay);
    }
    case 'last30':
      return range(addDaysYmd(today, -29), today);
    case 'thisYear':
      return range(`${today.slice(0, 4)}-01-01`, today);
    case 'custom': {
      const problem = customRangeProblem(custom?.from, custom?.to);
      if (problem !== null || custom === undefined) {
        throw new RangeError(`invalid custom period: ${problem ?? 'from and to are required'}`);
      }
      return range(custom.from, custom.to);
    }
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_SPAN = 31;

/**
 * By the day when BOTH dates are given and at most a month (31 days) apart; else by the month.
 *
 * LIFTED UNCHANGED from `custodyGranularity` (apps/api/src/modules/fleet/custody/custody-dashboard.ts),
 * which re-exports it, so the custody dashboard and the period tabs draw the same axis for the same
 * range. A range turned round matches nothing and goes by the month.
 */
export const periodGranularity = (range: {
  from?: Date | undefined;
  to?: Date | undefined;
}): 'day' | 'month' => {
  if (range.from === undefined || range.to === undefined) return 'month';
  const span = (range.to.getTime() - range.from.getTime()) / DAY_MS;
  return span >= 0 && span <= MAX_DAY_SPAN ? 'day' : 'month';
};

/** A Cairo calendar day on the wire. */
const ymd = () => z.string().refine(isYmd, { message: "must be a real 'YYYY-MM-DD' date" });

/**
 * `GET /fleet/dashboard/period`. `from`/`to` come only with `custom`, and then both; from ≤ to; at
 * most 366 inclusive days. `.strict()`: an unknown parameter is refused rather than ignored, so a
 * link can never look filtered while it is not.
 */
export const FleetDashboardPeriodQuerySchema = z
  .object({
    preset: z.enum(FLEET_DASHBOARD_PRESETS).default(FLEET_DASHBOARD_DEFAULT_PRESET),
    from: ymd().optional(),
    to: ymd().optional(),
    /** «النوع» — vehicle types, resolved by each owning module as its own screen does. */
    typeIds: listQuery(objectId()),
    /** «التشغيل» — vehicle operations. */
    operationIds: listQuery(objectId()),
    vehicleCodes: vehicleCodesQuery(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.preset !== 'custom') {
      for (const field of ['from', 'to'] as const) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is accepted only with the custom preset`,
          });
        }
      }
      return;
    }
    for (const field of ['from', 'to'] as const) {
      if (value[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required with the custom preset`,
        });
      }
    }
    if (value.from === undefined || value.to === undefined) return;
    const problem = customRangeProblem(value.from, value.to);
    if (problem !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: problem });
    }
  });
export type FleetDashboardPeriodQuery = z.infer<typeof FleetDashboardPeriodQuerySchema>;

// ── Documents (R-02, R-10, R-11) ────────────────────────────────────────────

export type FleetExpiryState = 'notRecorded' | 'expired' | 'expiring' | 'valid';

/**
 * R-02 (Q-02: a document is expired ON its expiry day). With d = the expiry's calendar date:
 * expired ⇔ d ≤ today; expiring ⇔ today < d ≤ today + warnDays; a missing date → notRecorded,
 * neither expired nor valid. The same rule as every list filter's `$lte` and the sweep's `<= now`.
 */
export const expiryStateOn = (
  expiresAt: Date | string | null | undefined,
  today: string,
  warnDays: number,
): FleetExpiryState => {
  if (expiresAt === null || expiresAt === undefined) return 'notRecorded';
  const day = ymdOf(expiresAt);
  if (day <= today) return 'expired';
  return day <= addDaysYmd(today, warnDays) ? 'expiring' : 'valid';
};

/**
 * R-10: the three disjoint licence windows as Ymd pairs — expired = [−∞, today]; expiring =
 * [today+1, today+W]; soon = [today+W+1, today+60] (`null` when W ≥ 60, the window being empty).
 * The web links and the API counts both use these, through `calendarDayBounds` for the instants.
 */
export const licenceWindows = (
  today: string,
  warnDays: number,
): {
  expired: { to: string };
  expiring: { from: string; to: string };
  soon: { from: string; to: string } | null;
} => ({
  expired: { to: today },
  expiring: { from: addDaysYmd(today, 1), to: addDaysYmd(today, warnDays) },
  soon:
    warnDays >= FLEET_LICENCE_GREY_DAYS
      ? null
      : { from: addDaysYmd(today, warnDays + 1), to: addDaysYmd(today, FLEET_LICENCE_GREY_DAYS) },
});

/** The licensing board's two papers and the two ticks each one carries. */
export const FLEET_LICENSING_PAPERS = [
  { key: 'insurance', handover: 'insuranceHandover', receipt: 'insuranceReceipt' },
  { key: 'tax', handover: 'taxHandover', receipt: 'taxReceipt' },
] as const;
export type FleetLicensingPaper = (typeof FLEET_LICENSING_PAPERS)[number];

/**
 * R-11: how far a paper has got. Both ticks → done; exactly one → open; none → none.
 *
 * MOVED UNCHANGED from the licensing page (`LicensingPage.tsx`), so the board's colour, its stats
 * bar and the dashboard's open-papers count are one rule. «استلام» without «تسليم» should not happen
 * and is still half done rather than nothing: a ticked square must never sit on an uncoloured cell.
 */
export const paperStage = (
  row: Record<'insuranceHandover' | 'insuranceReceipt' | 'taxHandover' | 'taxReceipt', boolean>,
  paper: Pick<FleetLicensingPaper, 'handover' | 'receipt'>,
): 'none' | 'open' | 'done' => {
  const out = row[paper.handover];
  const back = row[paper.receipt];
  if (out && back) return 'done';
  return out || back ? 'open' : 'none';
};

// ── Sections and gates (R-28, §5.5) ─────────────────────────────────────────

export const FLEET_DASHBOARD_NOW_SECTIONS = [
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
  'recentWorkshop',
  'recentAccidents',
  'notices',
  'dealershipPending',
  'accidentsOpen',
  'violationsYear',
] as const;
export const FLEET_DASHBOARD_PERIOD_SECTIONS = [
  'km',
  'visits',
  'accidents',
  'accidentList',
  'opex',
  'dealership',
] as const;
export type FleetDashboardNowSection = (typeof FLEET_DASHBOARD_NOW_SECTIONS)[number];
export type FleetDashboardPeriodSection = (typeof FLEET_DASHBOARD_PERIOD_SECTIONS)[number];
/** `custodyFund` is computed in the browser from the custody hooks (D3), never by R1 or R2. */
export type FleetDashboardSection =
  FleetDashboardNowSection | FleetDashboardPeriodSection | 'custodyFund';

export interface FleetDashboardGate {
  /** 'web' = computed from web hooks (custody), never by R1/R2. */
  read: 'now' | 'period' | 'web';
  /** Permissions the data's own endpoints require. */
  api: readonly string[];
  /** The `RequirePermission` of the screen the figure links to (routes.tsx). */
  page: readonly string[];
  /** That screen's route, e.g. '/fleet/maintenance-alarms'. */
  path: string;
}

const gate = (
  read: FleetDashboardGate['read'],
  api: string,
  path: string,
  page: string = api,
): FleetDashboardGate => Object.freeze({ read, api: [api], page: [page], path });

/**
 * Who sees what. A section is returned only when the reader holds EVERY key of api ∪ page: a figure
 * whose screen the reader cannot open would be a link to a 403, and a figure whose data they cannot
 * read is not theirs to see.
 */
export const FLEET_DASHBOARD_GATES: Readonly<Record<FleetDashboardSection, FleetDashboardGate>> =
  Object.freeze({
    vehicles: gate('now', 'fleetVehicle.view', '/fleet/vehicles'),
    distributionVehicles: gate('now', 'fleetVehicle.view', '/fleet/vehicles'),
    licenceVehicles: gate('now', 'fleetVehicle.view', '/fleet/vehicles'),
    roster: gate('now', 'fleetRoster.view', '/fleet/roster'),
    workshop: gate('now', 'fleetMaintenance.view', '/fleet/maintenance'),
    recentWorkshop: gate('now', 'fleetMaintenance.view', '/fleet/maintenance'),
    maintenanceAlarm: gate('now', 'fleetOdometer.view', '/fleet/maintenance-alarms'),
    noReading: gate('now', 'fleetOdometer.view', '/fleet/odometer'),
    distributionDrivers: gate('now', 'fleetDriver.view', '/fleet/drivers'),
    licenceDrivers: gate('now', 'fleetDriver.view', '/fleet/drivers'),
    papers: gate('now', 'fleetLicensing.view', '/fleet/licensing'),
    fuelCards: gate('now', 'fleetFuelCard.view', '/fleet/fuel-cards'),
    fuelCharging: gate(
      'now',
      'fleetFuelCard.view',
      '/fleet/fuel-cards/charging',
      'fleetFuelCharge.view',
    ),
    recentAccidents: gate('now', 'fleetAccident.view', '/fleet/accidents'),
    accidentsOpen: gate('now', 'fleetAccident.view', '/fleet/accidents'),
    notices: gate('now', 'fleetNotice.view', '/fleet/notices'),
    dealershipPending: gate('now', 'fleetDealership.view', '/fleet/dealership'),
    violationsYear: gate('now', 'fleetViolation.view', '/fleet/violations'),
    km: gate('period', 'fleetOdometer.view', '/fleet/odometer'),
    visits: gate('period', 'fleetMaintenance.view', '/fleet/maintenance'),
    accidents: gate('period', 'fleetAccident.view', '/fleet/accidents'),
    accidentList: gate('period', 'fleetAccident.view', '/fleet/accidents'),
    opex: gate('period', 'fleetReceipt.view', '/fleet/receipts'),
    dealership: gate('period', 'fleetDealership.view', '/fleet/dealership'),
    custodyFund: gate('web', 'fleetCustody.view', '/fleet/custody/dashboard'),
  });

const ALL_SECTIONS: readonly FleetDashboardSection[] = [
  ...FLEET_DASHBOARD_NOW_SECTIONS,
  ...FLEET_DASHBOARD_PERIOD_SECTIONS,
  'custodyFund',
];

const distinct = (keys: Iterable<string>): readonly string[] => Object.freeze([...new Set(keys)]);

/** A section is returned only when the reader holds EVERY key of api ∪ page. */
export const fleetDashboardGateKeys = (section: FleetDashboardSection): readonly string[] => {
  const { api, page } = FLEET_DASHBOARD_GATES[section];
  return distinct([...api, ...page]);
};

const keysOfRead = (read: FleetDashboardGate['read'] | null): readonly string[] =>
  distinct(
    ALL_SECTIONS.filter(
      (section) => read === null || FLEET_DASHBOARD_GATES[section].read === read,
    ).flatMap((section) => fleetDashboardGateKeys(section)),
  );

/** ∪ of the 'now' gates → `authorizeAny` on `/now`. */
export const FLEET_DASHBOARD_NOW_KEYS: readonly string[] = keysOfRead('now');
/** ∪ of the 'period' gates → `authorizeAny` on `/period`. */
export const FLEET_DASHBOARD_PERIOD_KEYS: readonly string[] = keysOfRead('period');
/** ∪ of all gates, custodyFund included → the index route's anyOf. */
export const FLEET_DASHBOARD_PAGE_KEYS: readonly string[] = keysOfRead(null);

/** Which sections make a tab visible (hidden when every one is null / not permitted). */
export const FLEET_DASHBOARD_TAB_SECTIONS: Readonly<
  Record<FleetDashboardTab, readonly FleetDashboardSection[]>
> = Object.freeze({
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

// ── Alerts (tab 1). The server derives them LAST from the sections; custody is added by the web. ──

/** Display order (red first). The web inserts its own 'custody' line (T1.11) after 'noticesMissing'. */
export const FLEET_DASHBOARD_ALERTS = [
  { id: 'maintenanceRed', level: 'red', section: 'maintenanceAlarm' }, // T1.1
  { id: 'vehicleLicenceExpired', level: 'red', section: 'licenceVehicles' }, // T1.2
  { id: 'driverLicenceExpired', level: 'red', section: 'licenceDrivers' }, // T1.3
  { id: 'fuelCardExpired', level: 'red', section: 'fuelCards' }, // T1.4
  { id: 'crewAbsent', level: 'orange', section: 'roster' }, // T1.6
  { id: 'fuelRequests', level: 'orange', section: 'fuelCharging' }, // T1.7
  { id: 'fuelLow', level: 'orange', section: 'fuelCharging' }, // T1.8
  { id: 'dealershipPending', level: 'orange', section: 'dealershipPending' }, // T1.9
  { id: 'noticesMissing', level: 'orange', section: 'notices' }, // T1.10
  { id: 'noReading', level: 'orange', section: 'noReading' }, // T1.12
] as const satisfies readonly {
  id: string;
  level: 'red' | 'orange';
  section: FleetDashboardNowSection;
}[];
export type FleetDashboardAlertId = (typeof FLEET_DASHBOARD_ALERTS)[number]['id'];
export interface FleetDashboardAlertDto {
  id: FleetDashboardAlertId;
  level: 'red' | 'orange';
  count: number;
}

// ── Shared pieces ───────────────────────────────────────────────────────────

export interface FleetDashboardNamedDto {
  id: string;
  name: LocalizedString;
}

/** R-13 echo — the vehicle filter as resolved; the links carry these FILTERS, never the ids. */
export interface FleetDashboardVehicleScopeDto {
  /** Cars in the resolved set; `null` = nothing narrows. */
  count: number | null;
  typeIds: string[];
  operationIds: string[];
  vehicleCodes: string[];
  /** `ctx.activeBranchId` (never `currentBranchId`). */
  branchId: string | null;
}

// ── R1: GET /fleet/dashboard/now (no query; branch from X-Active-Branch) ────

export interface FleetDashboardNowDto {
  /** Cairo today, 'YYYY-MM-DD'. */
  today: string;
  /** ISO instant of the request clock. */
  asOf: string;
  branchId: string | null;
  vehicles: FleetDashboardNowVehiclesDto | null;
  roster: FleetDashboardNowRosterDto | null;
  workshop: FleetDashboardNowWorkshopDto | null;
  maintenanceAlarm: FleetDashboardNowAlarmDto | null;
  noReading: FleetDashboardNowNoReadingDto | null;
  distributionVehicles: FleetDashboardNowDistributionVehiclesDto | null;
  distributionDrivers: FleetDashboardNowDistributionDriversDto | null;
  licenceVehicles: FleetDashboardNowLicenceVehiclesDto | null;
  licenceDrivers: FleetDashboardNowLicenceDriversDto | null;
  /** R-11, `paperStage === 'open'`. */
  papers: { insurance: number; tax: number } | null;
  fuelCards: { warnDays: number; expired: number; expiring: number } | null;
  fuelCharging: FleetDashboardNowFuelChargingDto | null;
  recentWorkshop: FleetDashboardRecentVisitDto[] | null;
  recentAccidents: FleetDashboardRecentAccidentDto[] | null;
  notices: {
    open: number;
    missingAny: number;
    missingLicences: number;
    missingCheckImage: number;
  } | null;
  dealershipPending: { rows: number } | null;
  /** Q-07: open files only. */
  accidentsOpen: { count: number; remaining: number } | null;
  violationsYear: FleetDashboardNowViolationsDto | null;
  /** count > 0 only, red first. */
  alerts: FleetDashboardAlertDto[];
  /** Non-null only when a branch narrows. */
  vehicleScope: FleetDashboardVehicleScopeDto | null;
  /** Sections that FAILED (they are also null). */
  unavailable: FleetDashboardNowSection[];
}

/** T2.1/T2.2, `scopeSelector(fleetVehicle.view)`. */
export interface FleetDashboardNowVehiclesDto {
  active: number;
  outOfService: number;
  disposed: number;
  /** code asc, reason verbatim. */
  outOfServiceList: { vehicleId: string; code: string; reason: string | null }[];
}

/** T2.3–T2.7, T1.6 — counted from ONE `board(today)` call. */
export interface FleetDashboardNowRosterDto {
  date: string;
  licenceRule: 'flag' | 'refuse';
  /** Board rows = active vehicles in the roster scope. */
  rows: number;
  /** assignable (ready = rows − inWorkshop − licenceExpired). */
  ready: number;
  /** Rows inMaintenance. */
  inWorkshop: number;
  /** Rows ¬inMaintenance ∧ licenceExpired. */
  licenceExpired: number;
  /** ready ∧ manned (the tab-2 badge = readyManned ÷ ready, D5-1). */
  readyManned: number;
  /** ready ∧ ¬manned (T2.5). */
  unmanned: number;
  /** Of unmanned: has crewGaps. */
  unmannedCrewGap: number;
  /**
   * Of unmanned without a crew gap: its plan names a driver unavailable today (`stalePlan`). The
   * three «أسباب عدم التعيين» tiles are disjoint and each ≤ unmanned (`crewGap.stalePlan` counts
   * every ready row, manned by its other seat or not, so it is not one of them).
   */
  unmannedStalePlan: number;
  /** Of unmanned: no fixed crew and no planned seat. */
  unmannedNoCrew: number;
  crewGap: {
    /** T1.6 count = rows with ≥ 1 crew gap whose reason is fleetUnavailability | hrLeave. */
    vehicles: number;
    otherReasons: number;
    covered: number;
    stalePlan: number;
  };
  /** available + absent + profileInactive + notEmployed + licenceExpiredDrivers. */
  registry: number;
  /** available ∧ licence ≠ 'expired'. */
  available: number;
  availableWithoutVehicle: number;
  availableLicenceNotRecorded: number;
  availableNoProfile: number;
  /** fleetUnavailability, hrLeave. */
  absent: { attendance: number; leave: number };
  profileInactive: number;
  notEmployed: number;
  licenceExpiredDrivers: number;
}

/** T2.4, R-09 — open visits of ANY status. */
export interface FleetDashboardNowWorkshopDto {
  open: number;
  openActive: number;
  openOutOfService: number;
  oldest: { vehicleId: string | null; code: string; inDate: string; days: number } | null;
}

/** T1.1 — `computeAlarms()`, narrowed after computing (D19). */
export interface FleetDashboardNowAlarmDto {
  red: number;
  overdue: number;
  yellow: number;
  /**
   * Only when a branch narrows: the codes of each level apart (the link already carries `level`), each
   * capped at 50 on its own (over 50 → [] for that level only).
   */
  codes: { red: string[]; yellow: string[] } | null;
}

/** T1.12, R-07 — active, no open visit. */
export interface FleetDashboardNowNoReadingDto {
  days: number;
  /** lastDate < today − days, code asc. */
  stale: { vehicleId: string; code: string; lastDate: string }[];
  neverRead: { vehicleId: string; code: string }[];
}

/** T3.1–T3.3, T3.5, T3.7. */
export interface FleetDashboardNowDistributionVehiclesDto {
  /** The reader's scope branches, column order. */
  branches: FleetDashboardNamedDto[];
  rows: {
    typeId: string;
    name: LocalizedString;
    counts: Record<string, number>;
    noBranch: number;
    total: number;
  }[];
  /** total = vehicles.active. */
  totals: { counts: Record<string, number>; noBranch: number; total: number };
  cash: { vehicles: number; operationIds: string[] };
  atm: { vehicles: number; operationIds: string[] };
}

/** T3.4, T3.6, T3.8 — the registry (R-08). */
export interface FleetDashboardNowDistributionDriversDto {
  total: number;
  cash: { drivers: number; legacy: number; specializationIds: string[] };
  atm: { drivers: number; legacy: number; specializationIds: string[] };
}

/** T1.2, T4.1–T4.4 — status = active (Q-15). */
export interface FleetDashboardNowLicenceVehiclesDto {
  warnDays: number;
  expired: number;
  expiring: number;
  soon: number;
  /** «وخارج الخدمة N». */
  outOfServiceExpired: number;
  /** ≤ 6, nearest first; days < 0 = expired. */
  list: { vehicleId: string; code: string; expiresAt: string; days: number }[];
  more: number;
}

/** T1.3, T4.5. */
export interface FleetDashboardNowLicenceDriversDto {
  warnDays: number;
  expired: number;
  expiring: number;
  soon: number;
  notRecorded: number;
  unregistered: number;
}

/** T1.7, T1.8, T5.1–T5.5. */
export interface FleetDashboardNowFuelChargingDto {
  wataniya: number;
  chillout: number;
  requested: { count: number; amount: number };
  low: { belowYellow: number; belowRed: number; yellowAt: number; redAt: number };
  /** «خلال آخر 24 ساعة», rolling. */
  charged24h: number;
}

/** T4.8, R-12. */
export interface FleetDashboardRecentVisitDto {
  visitId: string;
  vehicleId: string | null;
  code: string;
  /** Business date: inDate, or outDate when later. */
  date: string;
  /** createdAt ISO (the web shows «سُجّل HH:MM» in Cairo time). */
  recordedAt: string;
  workshop: LocalizedString | null;
  workType: LocalizedString | null;
  open: boolean;
}

/** T4.9 — date only, never a time. */
export interface FleetDashboardRecentAccidentDto {
  accidentId: string;
  vehicleId: string | null;
  code: string;
  date: string;
  culprit: string | null;
  culpritEmployeeIds: string[];
  status: FleetAccidentStatus;
}

/** T5.11/T5.12, R-24 — the Cairo year. */
export interface FleetDashboardNowViolationsDto {
  year: number;
  /** Σ outstandingVehicleAmount. */
  company: number;
  drivers: {
    /** Σ outstandingDriverAmount = attributed + unknown + unlinked. */
    total: number;
    attributed: number;
    /** «مجهول». */
    unknown: { amount: number; count: number };
    /** «اسم غير مربوط». */
    unlinked: { amount: number; count: number };
  };
  total: number;
}

// ── R2: GET /fleet/dashboard/period?preset&from&to&typeIds&operationIds&vehicleCodes ──

export interface FleetDashboardPeriodDto {
  today: string;
  asOf: string;
  range: {
    preset: FleetDashboardPreset;
    from: string;
    to: string;
    days: number;
    granularity: 'day' | 'month';
  };
  vehicleScope: FleetDashboardVehicleScopeDto;
  km: FleetDashboardPeriodKmDto | null;
  visits: FleetDashboardPeriodVisitsDto | null;
  /** `undated`: company view only. */
  accidents: { count: number; open: number; openRemaining: number; undated: number | null } | null;
  accidentList: { rows: FleetDashboardPeriodAccidentRowDto[]; more: number } | null;
  /** R-19, never + dealership. */
  opex: {
    card: number;
    custody: number;
    total: number;
    count: number;
    dataFrom: string | null;
  } | null;
  /** R-20 by outDate. */
  dealership: { amount: number; rows: number; pending: number; dataFrom: string } | null;
  unavailable: FleetDashboardPeriodSection[];
}

export interface FleetDashboardKmBucketDto {
  /** 'YYYY-MM-DD' (day) or 'YYYY-MM' (month). */
  key: string;
  /** false → an EMPTY slot, never a zero bar. */
  hasRows: boolean;
  /** R-15 (a month: every day confirmed or row-less). */
  confirmed: boolean;
  confirmedKm: number;
  spanKm: number;
  pending: number;
  stale: number;
  /** Tooltip «مسافة من d إلى d′ على N سيارات». */
  spanTo: string | null;
  spanVehicles: number;
}

/**
 * R-16 (a)–(f), plus `onlyInvalid`: a car whose only closed rows in the period have negative km
 * (R-14 «تحتاج مراجعة») — it has a row, closed, with a counter, so none of (a)–(c) names it.
 */
export type FleetDashboardNoReadingReason =
  | 'noRow'
  | 'onlyOpen'
  | 'onlyNoCounter'
  | 'onlyInvalid'
  | 'inWorkshop'
  | 'notActive'
  | 'joinedAfter';

/** Tabs 6–8, R-14…R-17. */
export interface FleetDashboardPeriodKmDto {
  total: number;
  invalidRows: number;
  /** total ÷ the cars with a valid row in it (any status, old-book codes included); null when none. */
  perVehicleAvg: number | null;
  coverage: { withReadings: number; of: number };
  /** R-15 average line. */
  confirmedThrough: string | null;
  closedDays: number;
  average: number | null;
  buckets: FleetDashboardKmBucketDto[];
  spans: { km: number; count: number };
  /** Current branch (K-12). */
  byBranch: { branchId: string | null; name: LocalizedString | null; km: number }[];
  /** Only when a branch is chosen. */
  byType: { typeId: string; name: LocalizedString; km: number }[] | null;
  /** km of vehicleId-null rows; null when a set exists. */
  unregistered: number | null;
  top5: { vehicleId: string; code: string; km: number }[];
  bottom5: { vehicleId: string; code: string; km: number; inWorkshopSince: string | null }[];
  withoutReadings: { vehicleId: string; code: string; reason: FleetDashboardNoReadingReason }[];
}

/** T6.3/T6.4, tab 9, R-18. */
export interface FleetDashboardPeriodVisitsDto {
  /** State NOW («حتى الآن»). */
  count: number;
  closed: number;
  open: number;
  /** count desc, name asc. */
  byWorkType: { id: string; name: LocalizedString | null; count: number }[];
  byWorkshop: { id: string; name: LocalizedString | null; count: number }[];
  /** ≤ 5. */
  topVehicles: { vehicleId: string | null; code: string; visits: number; lastInDate: string }[];
  unregistered: number | null;
}

/** T10.1 — date only. */
export interface FleetDashboardPeriodAccidentRowDto {
  accidentId: string;
  vehicleId: string | null;
  code: string;
  date: string;
  culprit: string | null;
  culpritEmployeeIds: string[];
  status: FleetAccidentStatus;
  remaining: number;
}
