// «لوحة تحكم الحركة» — the fleet module's home (/fleet), Phase 1.
//
// Two reads feed eleven tabs, in the strip's order (FLEET_DASHBOARD_TABS): the six rebuilt tabs
// «نظرة عامة» (overview), «الحركة اليوم» (today), «توزيع السيارات» (distribution),
// «الصيانة والورش» (maintenance), «العدادات والكيلومترات» (km) and «الحوادث ومطالبات التأمين»
// (accidents) — the last four rebuilt in place, under their old keys, so every old link opens the
// new body («ترتيب السيارات» lives inside «العدادات والكيلومترات» now: a link to the retired
// `ranking` opens `km`) — then two NEW tabs with no old tab of their own, «المخالفات المرورية
// والتسويات» (violations) and «الوقود والمصروفات» (fuel), then the three old tabs, each standing
// where its rebuilt replacement will stand and drawn as before until it is rebuilt:
//   · R1 `GET /fleet/dashboard/now`    — the state of the fleet NOW, one Cairo `today`;
//   · R2 `GET /fleet/dashboard/period` — a period's figures, a preset or a custom range. The overview
//     and «توزيع السيارات» also read R2 for «هذا الشهر» on their own (never the page filters) — the
//     'month' read.
// FLEET_DASHBOARD_TAB_READS says which read(s) each tab draws. «الصيانة والورش», «العدادات
// والكيلومترات», «الحوادث ومطالبات التأمين», «المخالفات المرورية والتسويات» and «الوقود
// والمصروفات» are MIXED tabs: R1 «الآن» parts and R2 parts under the page filters, each read with
// its own loading and error.
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
import {
  type FleetAccidentStatus,
  type FleetAccidentTotalsDto,
  type FleetDealershipWorkKind,
  type FleetDriverUnavailableReason,
  type FleetFuelCardCompany,
  type FleetNoticeTemplate,
  vehicleCodesQuery,
} from './fleet.js';

// ── Tabs, presets, constants ────────────────────────────────────────────────

/**
 * The strip, in its visible order: «نظرة عامة» · «الحركة اليوم» · «توزيع السيارات» ·
 * «الصيانة والورش» · «العدادات والكيلومترات» · «الحوادث ومطالبات التأمين» · «المخالفات المرورية
 * والتسويات» · «الوقود والمصروفات» · «أرقام الفترة» · «ملخصات» · «التراخيص». `overview` and
 * `today` replaced the old `alerts` and `now` (a link to either opens its replacement);
 * `distribution`, `maintenance`, `km` and `accidents` were rebuilt under their own keys (an old link
 * opens the new body); the old `ranking` («ترتيب السيارات») is retired — its top and bottom five live
 * in «العدادات والكيلومترات», and a link to it opens `km`. `violations` and `fuel` are NEW tabs (no
 * old tab of their own, so no old key maps onto them). The last three are the old tabs, unchanged,
 * each where its rebuilt replacement will stand.
 */
export const FLEET_DASHBOARD_TABS = [
  'overview',
  'today',
  'distribution',
  'maintenance',
  'km',
  'accidents',
  'violations',
  'fuel',
  'period',
  'summaries',
  'licences',
] as const;
export type FleetDashboardTab = (typeof FLEET_DASHBOARD_TABS)[number];

/**
 * What a tab draws from: 'now' = R1; 'period' = R2 under the page filters; 'month' = R2 «هذا الشهر»
 * with no filter at all (the overview's month card, the km of «توزيع السيارات»); 'web' = a screen's
 * own hooks in the browser (the custody board; the supply contracts' summary).
 */
export type FleetDashboardRead = 'now' | 'period' | 'month' | 'web';
export const FLEET_DASHBOARD_TAB_READS: Readonly<
  Record<FleetDashboardTab, readonly FleetDashboardRead[]>
> = Object.freeze({
  overview: ['now', 'month', 'web'],
  today: ['now'],
  distribution: ['now', 'month', 'web'],
  maintenance: ['now', 'period'],
  km: ['now', 'period'],
  accidents: ['now', 'period'],
  violations: ['now', 'period'],
  fuel: ['now', 'period'],
  period: ['period'],
  summaries: ['now', 'web'],
  licences: ['now'],
});

/**
 * The old tab drawn under the page filter bar (the old `PeriodTab` wrapper), read from R2 alone —
 * «أرقام الفترة», kept until it is rebuilt. The five MIXED tabs draw the bar inside their body:
 * «الصيانة والورش», «الحوادث ومطالبات التأمين», «المخالفات المرورية والتسويات» and «الوقود
 * والمصروفات» between their «الآن» band (R1) and their period band (R2); «العدادات والكيلومترات»
 * at the top of its body.
 */
export const FLEET_DASHBOARD_PERIOD_TABS = ['period'] as const;

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
/** «الحركة اليوم»: rows of each list («سيارات بلا سائق اليوم», «الغائبون اليوم») before «عرض الكل (N)». */
export const FLEET_DASHBOARD_TODAY_ROWS = 8;
/** T4.4: licence rows listed before «+N». */
export const FLEET_DASHBOARD_LICENCE_ROWS = 6;
/** «حوادث الفترة» (`accidentList.rows`): accident rows listed before «عرض الباقي (N) في السجل». */
export const FLEET_DASHBOARD_ACCIDENT_ROWS = 6;
/**
 * «إخطارات ينقصها مرفق» (`notices.rows`): notice rows listed before «و N أخرى». Same number as the
 * accident rows, but a separate rule.
 */
export const FLEET_DASHBOARD_NOTICE_ROWS = 6;
/**
 * Rows of a ranking: «العدادات والكيلومترات»'s top and bottom five (`km.top5` / `km.bottom5`), and
 * «أكثر السيارات دخولًا للورشة» (`exits.topVehicles`).
 */
export const FLEET_DASHBOARD_RANK_ROWS = 5;
/**
 * «استثناءات قراءات العدادات»: rows of EACH group («بلا قراءة حديثة» `noReading.staleRows`,
 * «لم تُقرأ أبدًا» `noReading.neverReadRows`, «قراءات تحتاج مراجعة» `km.invalidList`) before
 * «و N أخرى في القائمة الكاملة».
 */
export const FLEET_DASHBOARD_EXCEPTION_ROWS = 3;
/** «إنذارات الصيانة بالكيلومتر»: alarm rows listed before «كل إنذارات الصيانة (N)». */
export const FLEET_DASHBOARD_ALARM_ROWS = 8;
/** «أطول بقاء في الورشة الآن»: open visits listed before «كل السيارات في الورشة (N)». */
export const FLEET_DASHBOARD_WORKSHOP_ROWS = 5;
/**
 * «مخالفات السائقين في الفترة» (`violationList.rows`): the period's fines listed before «عرض الباقي
 * (N) في السجل». Same number as the accident rows, but a separate rule.
 */
export const FLEET_DASHBOARD_VIOLATION_ROWS = 6;
/**
 * «كروت تحتاج متابعة» (`fuelCardList.rows`): flagged cards listed before «تُعرض هنا أول 8 كروت…»
 * (a count is `fuelCardList.total`, never `rows.length`).
 */
export const FLEET_DASHBOARD_FUEL_CARD_ROWS = 8;
/**
 * «فواتير التوكيل في الفترة» (`dealershipList.rows`): invoice rows listed before «عرض الباقي (N) في
 * شاشة التوكيل».
 */
export const FLEET_DASHBOARD_DEALERSHIP_ROWS = 6;
/**
 * Why a card is in «كروت تحتاج متابعة», in URGENCY order (the table's order, and the order of a row's
 * `states`): `expired` — its expiry day is today or earlier (R-02); `critical` — balance below the
 * red threshold («يوشك على النفاد»); `requested` — a charge request waits («طلب رصيد»); `low` —
 * balance below the yellow threshold and not critical («رصيد منخفض»); `expiring` — expires within
 * the warning window («ينتهي قريباً»). `critical` and `low` never stand on one card.
 */
export const FLEET_DASHBOARD_FUEL_CARD_STATES = [
  'expired',
  'critical',
  'requested',
  'low',
  'expiring',
] as const;
export type FleetDashboardFuelCardState = (typeof FLEET_DASHBOARD_FUEL_CARD_STATES)[number];
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
  'fuelCardList',
  'fuelSheets',
  'recentWorkshop',
  'recentAccidents',
  'notices',
  'dealershipPending',
  'accidentsOpen',
  'violationsYear',
  'violationsOpen',
] as const;
export const FLEET_DASHBOARD_PERIOD_SECTIONS = [
  'km',
  'visits',
  'exits',
  'accidents',
  'accidentList',
  'violations',
  'violationList',
  'opex',
  'opexSeries',
  'dealership',
  'dealershipList',
] as const;
export type FleetDashboardNowSection = (typeof FLEET_DASHBOARD_NOW_SECTIONS)[number];
export type FleetDashboardPeriodSection = (typeof FLEET_DASHBOARD_PERIOD_SECTIONS)[number];
/**
 * Drawn only as a PART of a tab the reader already sees — never a key of a read or of the page, and
 * never a reason for a tab to show. `supplyContracts` = «عقود توريد السيارات» on «توزيع السيارات»:
 * a reader who holds only `fleetVehicleContract.view` still cannot open the dashboard.
 */
export const FLEET_DASHBOARD_PART_SECTIONS = ['supplyContracts'] as const;
export type FleetDashboardPartSection = (typeof FLEET_DASHBOARD_PART_SECTIONS)[number];

/**
 * `custodyFund` is computed in the browser from the custody hooks (D3), and `supplyContracts` from
 * the vehicle-contracts summary hook — never by R1 or R2.
 */
export type FleetDashboardSection =
  | FleetDashboardNowSection
  | FleetDashboardPeriodSection
  | 'custodyFund'
  | FleetDashboardPartSection;

export interface FleetDashboardGate {
  /** 'web' = from a screen's own hooks in the browser (custody, supply contracts), never R1/R2. */
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
    fuelCardList: gate(
      'now',
      'fleetFuelCard.view',
      '/fleet/fuel-cards/charging',
      'fleetFuelCharge.view',
    ),
    fuelSheets: gate(
      'now',
      'fleetFuelCard.view',
      '/fleet/fuel-cards/reconcile',
      'fleetFuelCharge.view',
    ),
    recentAccidents: gate('now', 'fleetAccident.view', '/fleet/accidents'),
    accidentsOpen: gate('now', 'fleetAccident.view', '/fleet/accidents'),
    notices: gate('now', 'fleetNotice.view', '/fleet/notices'),
    dealershipPending: gate('now', 'fleetDealership.view', '/fleet/dealership'),
    violationsYear: gate('now', 'fleetViolation.view', '/fleet/violations'),
    violationsOpen: gate('now', 'fleetViolation.view', '/fleet/violations'),
    km: gate('period', 'fleetOdometer.view', '/fleet/odometer'),
    visits: gate('period', 'fleetMaintenance.view', '/fleet/maintenance'),
    exits: gate('period', 'fleetMaintenance.view', '/fleet/maintenance'),
    accidents: gate('period', 'fleetAccident.view', '/fleet/accidents'),
    accidentList: gate('period', 'fleetAccident.view', '/fleet/accidents'),
    violations: gate('period', 'fleetViolation.view', '/fleet/violations'),
    violationList: gate('period', 'fleetViolation.view', '/fleet/violations'),
    opex: gate('period', 'fleetReceipt.view', '/fleet/receipts'),
    opexSeries: gate('period', 'fleetReceipt.view', '/fleet/receipts'),
    dealership: gate('period', 'fleetDealership.view', '/fleet/dealership'),
    dealershipList: gate('period', 'fleetDealership.view', '/fleet/dealership'),
    custodyFund: gate('web', 'fleetCustody.view', '/fleet/custody/dashboard'),
    supplyContracts: gate('web', 'fleetVehicleContract.view', '/fleet/vehicle-contracts'),
  });

const ALL_SECTIONS: readonly FleetDashboardSection[] = [
  ...FLEET_DASHBOARD_NOW_SECTIONS,
  ...FLEET_DASHBOARD_PERIOD_SECTIONS,
  'custodyFund',
  ...FLEET_DASHBOARD_PART_SECTIONS,
];

const isPartSection = (section: FleetDashboardSection): boolean =>
  (FLEET_DASHBOARD_PART_SECTIONS as readonly string[]).includes(section);

const distinct = (keys: Iterable<string>): readonly string[] => Object.freeze([...new Set(keys)]);

/** A section is returned only when the reader holds EVERY key of api ∪ page. */
export const fleetDashboardGateKeys = (section: FleetDashboardSection): readonly string[] => {
  const { api, page } = FLEET_DASHBOARD_GATES[section];
  return distinct([...api, ...page]);
};

/** A PART section is never a key of a read or of the page (FLEET_DASHBOARD_PART_SECTIONS). */
const keysOfRead = (read: FleetDashboardGate['read'] | null): readonly string[] =>
  distinct(
    ALL_SECTIONS.filter(
      (section) =>
        !isPartSection(section) && (read === null || FLEET_DASHBOARD_GATES[section].read === read),
    ).flatMap((section) => fleetDashboardGateKeys(section)),
  );

/** ∪ of the 'now' gates → `authorizeAny` on `/now`. */
export const FLEET_DASHBOARD_NOW_KEYS: readonly string[] = keysOfRead('now');
/**
 * ∪ of the 'period' gates → `authorizeAny` on `/period`. `fleetViolation.view` is in it since
 * «المخالفات المرورية والتسويات» (its period band: `violations`, `violationList`), so a reader who
 * holds only that key reads R2 too; the NOW and PAGE unions did not change (the key already gated
 * `violationsYear` / `violationsOpen`).
 */
export const FLEET_DASHBOARD_PERIOD_KEYS: readonly string[] = keysOfRead('period');
/**
 * ∪ of all gates, custodyFund included, the PART sections left out → the index route's anyOf (so
 * `fleetVehicleContract.view` alone does not open the dashboard).
 */
export const FLEET_DASHBOARD_PAGE_KEYS: readonly string[] = keysOfRead(null);

/**
 * Which sections make a tab visible (hidden when every one is null / not permitted). A PART section
 * is in none of them (FLEET_DASHBOARD_TAB_PARTS).
 */
export const FLEET_DASHBOARD_TAB_SECTIONS: Readonly<
  Record<FleetDashboardTab, readonly FleetDashboardSection[]>
> = Object.freeze({
  /**
   * KPIs, the action centre (every alert section), the hub and the «هذا الشهر» card (`km`, `exits`,
   * `accidents`, `opex` — read through the 'month' read).
   */
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
  /**
   * «العدادات والكيلومترات» (the old «الكيلومترات» and «ترتيب السيارات» in one body): the period's km
   * (R2) and the cars with no recent reading now (R1), both under `fleetOdometer.view`.
   */
  km: ['km', 'noReading'],
  /**
   * «الصيانة والورش», each KPI under its own gate: «الآن» (alarms, the workshop, the dealership's
   * value-less rows) and the period by EXIT day (`exits`). A dealership-only or odometer-only reader
   * sees the tab with that part alone.
   */
  maintenance: ['maintenanceAlarm', 'workshop', 'dealershipPending', 'exits'],
  /**
   * «الحوادث ومطالبات التأمين», each part under its own gate: «الآن» (the open files, the insurance
   * notices) and the period by ACCIDENT day (the count, the money, the list). A notices-only reader
   * sees the tab with the notices alone; an accidents-only reader sees it without them.
   */
  accidents: ['accidentsOpen', 'notices', 'accidents', 'accidentList'],
  /**
   * «المخالفات المرورية والتسويات» (NEW), each part under `fleetViolation.view`: «الآن» (every year's
   * owed fines, company and drivers) and the period (the DRIVERS' fines by the fine's day, and their
   * rows). «ملخصات» keeps `violationsYear` (the Cairo year), untouched.
   */
  violations: ['violationsOpen', 'violations', 'violationList'],
  /**
   * «الوقود والمصروفات» (NEW), each part under its own gate: «الآن» (the expiry KPI under
   * `fleetFuelCard.view` alone; balances, requests, «شُحن اليوم», the cards to follow up and the
   * sheet card under the charging screen's keys too) and the period (operating spend from the
   * receipts and its day series under `fleetReceipt.view`; the dealership invoices and their rows
   * under `fleetDealership.view`). A receipts-only reader sees the tab with the spend alone; a
   * dealership-only reader the invoices alone; a `fleetFuelCard.view`-only reader the expiry KPI.
   */
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

/**
 * Sections a tab DRAWS that never make it visible on their own: «توزيع السيارات» shows the km of
 * «هذا الشهر» (the 'month' read) and the supply contracts (a PART section) only beside its R1
 * figures.
 */
export const FLEET_DASHBOARD_TAB_PARTS: Readonly<
  Partial<Record<FleetDashboardTab, readonly FleetDashboardSection[]>>
> = Object.freeze({
  distribution: ['km', 'supplyContracts'],
});

// ── Alerts (the overview's action centre). The server derives them LAST from the sections; custody
// is added by the web. ──

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
  /**
   * The branch switcher's branch (`ctx.activeBranchId`, never `currentBranchId`), honoured only when
   * it is one of the reader's branches; `null` otherwise.
   */
  branchId: string | null;
  /**
   * What the figures cover: `null` = the whole company; else the reader's branches (one = a branch
   * view, several = «كل فروعي»; `[]` = a branch reach with no branch, which narrows to nothing).
   */
  scopeBranches: FleetDashboardNamedDto[] | null;
}

// ── R1: GET /fleet/dashboard/now (no query; branch from X-Active-Branch) ────

export interface FleetDashboardNowDto {
  /** Cairo today, 'YYYY-MM-DD'. */
  today: string;
  /** ISO instant of the request clock. */
  asOf: string;
  /** The switcher's branch, honoured only inside `scopeBranches` (as on `vehicleScope`). */
  branchId: string | null;
  /** What the figures cover: `null` = the whole company; else the reader's branches. */
  scopeBranches: FleetDashboardNamedDto[] | null;
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
  /**
   * The cards that expire (R-02), over the cards whose CURRENT car is in the reader's branches (a car
   * deleted since counts by its last branch); a card on no car counts in the company view only.
   */
  fuelCards: {
    warnDays: number;
    expired: number;
    expiring: number;
    /**
     * «أقربها»: the earliest expiry day in tomorrow … today + warnDays ('YYYY-MM-DD') over the same
     * cards; `null` when none expires in the window.
     */
    nearest: string | null;
  } | null;
  fuelCharging: FleetDashboardNowFuelChargingDto | null;
  /**
   * «كروت تحتاج متابعة»: at most FLEET_DASHBOARD_FUEL_CARD_ROWS flagged cards (any of
   * FLEET_DASHBOARD_FUEL_CARD_STATES), in urgency order — the most urgent state first (expired →
   * critical → requested → low → expiring), then the car's code; cards on no car last, by label.
   * `total` = every flagged card («تُعرض هنا أول N…»), never `rows.length`. The same cards as
   * `fuelCharging` (the reader's branches by the card's CURRENT car; no car = company view only).
   */
  fuelCardList: { rows: FleetDashboardNowFuelCardRowDto[]; total: number } | null;
  /**
   * «مطابقة شيت شركة الوقود»: the latest READ sheet of each company (the stored reconcile session),
   * as it stood at its read — a later card movement never moves it. `null` per company = no sheet of
   * that company was ever read. Under a branch: the lines of the branch's cards, the company's
   * sheet day.
   */
  fuelSheets: Record<FleetFuelCardCompany, FleetDashboardNowFuelSheetDto | null> | null;
  recentWorkshop: FleetDashboardRecentVisitDto[] | null;
  recentAccidents: FleetDashboardRecentAccidentDto[] | null;
  /**
   * The open notices — the notices screen's own `status=open` filter, over the cars of the reader's
   * scope by the car's CURRENT branch (a notice with no car counts in the company view only).
   * `missingAny` = missing ANY attachment (a notice missing both counts once).
   */
  notices: {
    open: number;
    missingAny: number;
    missingLicences: number;
    missingCheckImage: number;
    /**
     * «إخطارات ينقصها مرفق»: at most FLEET_DASHBOARD_NOTICE_ROWS of the `missingAny` notices, the
     * oldest notice date first (no date last), then the oldest recorded first. A count is
     * `missingAny`, never `rows.length`.
     */
    rows: FleetDashboardNoticeRowDto[];
  } | null;
  dealershipPending: { rows: number } | null;
  /** Q-07: open files only. */
  accidentsOpen: { count: number; remaining: number } | null;
  violationsYear: FleetDashboardNowViolationsDto | null;
  violationsOpen: FleetDashboardNowViolationsOpenDto | null;
  /** count > 0 only, red first. */
  alerts: FleetDashboardAlertDto[];
  /** Non-null only when the figures are narrowed (`scopeBranches !== null`). */
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
  /**
   * «الحركة اليوم»: at most FLEET_DASHBOARD_TODAY_ROWS of the `unmanned` cars, by class
   * (crewGap → stalePlan → noCrew → unassigned, the same rules as the tiles), then code asc.
   */
  unmannedRows: FleetDashboardUnmannedRowDto[];
  /** Of unmanned: none of the three tile rules, so the three tiles + this = unmanned. */
  unmannedUnassigned: number;
  /**
   * At most FLEET_DASHBOARD_TODAY_ROWS of the absent drivers (fleetUnavailability | hrLeave):
   * fixed-crew members first, then «تمام» before leave, then employee code.
   */
  absentDrivers: FleetDashboardAbsentDriverDto[];
}

/** Why a ready car has no driver today — the class of a «سيارات بلا سائق اليوم» row. */
export type FleetDashboardUnmannedClass = 'crewGap' | 'stalePlan' | 'noCrew' | 'unassigned';

/** One row of «سيارات بلا سائق اليوم»; every name resolved on the server. */
export interface FleetDashboardUnmannedRowDto {
  vehicleId: string;
  code: string;
  typeName: LocalizedString | null;
  /** The car's current branch; `null` = «بلا فرع». */
  branch: FleetDashboardNamedDto | null;
  /** The day's mission type (planned, or carried from the standing crew); `null` = none. */
  mission: LocalizedString | null;
  why: FleetDashboardUnmannedClass;
  /** crewGap → the first gap seat's fixed driver; stalePlan → the planned unavailable driver; else null. */
  absent: { employeeId: string; reason: FleetDriverUnavailableReason } | null;
}

/** One row of «الغائبون اليوم». */
export interface FleetDashboardAbsentDriverDto {
  employeeId: string;
  reason: 'fleetUnavailability' | 'hrLeave';
  /** The car whose STANDING (fixed) crew holds this driver; `null` = none. */
  crewVehicle: { vehicleId: string; code: string } | null;
}

/** T2.4, R-09 — open visits of ANY status. */
export interface FleetDashboardNowWorkshopDto {
  open: number;
  openActive: number;
  openOutOfService: number;
  /** `longest[0]`, its `deleted` flag included. */
  oldest: {
    vehicleId: string | null;
    code: string;
    inDate: string;
    days: number;
    deleted: boolean;
  } | null;
  /**
   * «أطول بقاء في الورشة الآن»: at most FLEET_DASHBOARD_WORKSHOP_ROWS of the open visits `open`
   * counts (the same filter), oldest check-in first, then the visit id; `oldest` is `longest[0]`.
   * `longest.length ≤ open`.
   */
  longest: FleetDashboardWorkshopStayDto[];
}

/** One row of «أطول بقاء في الورشة الآن»; every name resolved on the server. */
export interface FleetDashboardWorkshopStayDto {
  visitId: string;
  vehicleId: string | null;
  code: string;
  /**
   * The registry car was DELETED since (soft delete; its visit stays open and counted). Its file is
   * no longer served and the list finds no live car by its code, so the web gives such a row no car
   * link and opens the open-visits list instead (where the visit is still listed). `false` for an
   * old-book row with no registry car: its code matches the book's.
   */
  deleted: boolean;
  /** The make, as the maintenance list names it; `null` for an old-book code with no registry car. */
  typeName: LocalizedString | null;
  /** Check-in day, 'YYYY-MM-DD'. */
  inDate: string;
  /** Cairo today − inDate, in whole days; 0 = «منذ اليوم». */
  days: number;
  workshop: LocalizedString | null;
  workType: LocalizedString | null;
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
  /**
   * The two thresholds as the alarms resolve them (the organization's settings) — present even when
   * no car is in alarm.
   */
  redKm: number;
  yellowKm: number;
  /**
   * «إنذارات الصيانة بالكيلومتر»: at most FLEET_DASHBOARD_ALARM_ROWS red/yellow cars AFTER the
   * branch narrowing — red first, then `remainingKm` ascending (the most overdue first), then code.
   * A count is `red` / `yellow`, never `rows.length`.
   */
  rows: FleetDashboardAlarmRowDto[];
}

/** One row of «إنذارات الصيانة بالكيلومتر», as the alarms board computes it. */
export interface FleetDashboardAlarmRowDto {
  vehicleId: string;
  code: string;
  /** The make, as the alarms board names it. */
  typeName: LocalizedString | null;
  level: 'red' | 'yellow';
  /** km left before the service; < 0 = past the limit by |remainingKm| km. */
  remainingKm: number;
  /** km since the last counted service. */
  sinceServiceKm: number;
  /** The rule's service interval, in km. */
  intervalKm: number;
  /** The last counted service, 'YYYY-MM-DD'; `null` = none recorded. */
  lastServiceAt: string | null;
  /** The car's OPEN visit («في الورشة: X»); `null` when it has none. */
  inWorkshop: { workshop: LocalizedString | null } | null;
}

/** T1.12, R-07 — active, no open visit. */
export interface FleetDashboardNowNoReadingDto {
  days: number;
  /**
   * lastDate < today − days, code asc — the whole list (the overview's line and the ≤ 50-code links
   * read it).
   */
  stale: { vehicleId: string; code: string; lastDate: string }[];
  /** Never read, code asc — the whole list. */
  neverRead: { vehicleId: string; code: string }[];
  /** = `stale.length`: «بلا قراءة عداد منذ N أيام» and the overview's alert. */
  staleCount: number;
  /** = `neverRead.length`. */
  neverReadCount: number;
  /**
   * «بلا قراءة حديثة»: at most FLEET_DASHBOARD_EXCEPTION_ROWS of `stale`, the longest gap first
   * (lastDate asc, then code); `staleRows[0]` is «أطول انقطاع». A count is `staleCount`.
   */
  staleRows: FleetDashboardStaleCarDto[];
  /**
   * «لم تُقرأ أبدًا»: at most FLEET_DASHBOARD_EXCEPTION_ROWS of `neverRead`, code order. A count is
   * `neverReadCount`.
   */
  neverReadRows: FleetDashboardNeverReadCarDto[];
}

/** One row of «بلا قراءة حديثة»; every name resolved on the server. */
export interface FleetDashboardStaleCarDto {
  vehicleId: string;
  code: string;
  /** The make, as the vehicles list names it. */
  typeName: LocalizedString | null;
  /** The last reading's day, 'YYYY-MM-DD'. */
  lastDate: string;
  /** Cairo today − lastDate, in whole days. */
  days: number;
}

/** One row of «لم تُقرأ أبدًا». */
export interface FleetDashboardNeverReadCarDto {
  vehicleId: string;
  code: string;
  typeName: LocalizedString | null;
}

/** One row of «إخطارات ينقصها مرفق»; every name resolved on the server. */
export interface FleetDashboardNoticeRowDto {
  noticeId: string;
  /** The form = the insurer («مصر للتأمين» / «الدلتا للتأمين»). */
  template: FleetNoticeTemplate;
  /** `null` = a notice with no car («بلا سيارة»), listed in the company view only. */
  vehicleId: string | null;
  code: string | null;
  /** The car's make; `null` with no car (or a car with no type name). */
  typeName: LocalizedString | null;
  noticeNumber: string | null;
  /** The notice's date, 'YYYY-MM-DD' (no time); `null` = none recorded. */
  noticeDate: string | null;
  /** What is still owed — the notices screen's own rules (the licences by the reader's grants). */
  missing: { vehicleLicense: boolean; driverLicense: boolean; checkImage: boolean };
}

/** Active cars by operation kind (one operation per car: cash + atm + other = the cars counted). */
export interface FleetDashboardOperationKindsDto {
  /** «نقل الأموال». */
  cash: number;
  atm: number;
  /** «أخرى»: an operation of neither kind, or none. */
  other: number;
}

/** T3.1–T3.3, T3.5, T3.7. */
export interface FleetDashboardNowDistributionVehiclesDto {
  /**
   * The reader's scope branches (and any branch a counted car sits in), in column order: active cars
   * descending, then the branch list's order. One order for the branch cards and the matrix columns.
   */
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
  /** Branches holding ≥ 1 active car in the reader's fleetVehicle.view scope («بلا فرع» is no branch). */
  branchCount: number;
  cash: { vehicles: number; operationIds: string[] };
  atm: { vehicles: number; operationIds: string[] };
  /**
   * Per column of `branches` — every one, zeros included — the branch's active cars by operation
   * kind (they sum to `totals.counts[id]`). Σ kinds.cash + noBranchKinds.cash = cash.vehicles (the
   * same for atm).
   */
  kinds: Record<string, FleetDashboardOperationKindsDto>;
  /** «بلا فرع»'s active cars by kind (all 0 when `totals.noBranch` = 0). */
  noBranchKinds: FleetDashboardOperationKindsDto;
  /** «أخرى»: active cars of neither kind (= Σ other over the branches and «بلا فرع»). */
  other: { vehicles: number };
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

/**
 * T1.7, T1.8, T5.1–T5.5 — the charging screen's summary over the cards whose CURRENT car is in the
 * reader's branches (a car deleted since counts by its last branch; a card on no car belongs to no
 * branch, so it counts in the company view only).
 */
export interface FleetDashboardNowFuelChargingDto {
  /** «أرصدة وطنية» — Σ balance of the company's cards. */
  wataniya: number;
  /** «أرصدة شل أوت». */
  chillout: number;
  requested: { count: number; amount: number };
  low: { belowYellow: number; belowRed: number; yellowAt: number; redAt: number };
  /**
   * The fuel summary's `chargedTodayAmount`: «شُحن اليوم», the CAIRO day so far — batch 3 (D5) made
   * it the day from Cairo's midnight, no longer a rolling 24 hours. The name is kept.
   */
  charged24h: number;
  /** The fuel-card summary's `cardCount` («موزعة على N كارتًا»). */
  cards: number;
  /** The cards of each company (the summary's `wataniyaCards` / `chilloutCards`); they sum to `cards`. */
  companyCards: Record<FleetFuelCardCompany, number>;
  /**
   * Cards on no car («سفر»، «اسبير»): how many and their balance (the summary's `noCarCards` /
   * `noCarBalance`; they are inside `cards` and the balances). The company view only: `null`
   * whenever the reader's branches narrow (such a card is in no branch).
   */
  unassigned: { count: number; balance: number } | null;
}

/** One row of «كروت تحتاج متابعة»; every name resolved on the server. */
export interface FleetDashboardNowFuelCardRowDto {
  cardId: string;
  company: FleetFuelCardCompany;
  /**
   * The card's full number — the value the cards list already gives `fleetFuelCard.view`; the web
   * shows «…» and its last four, and a card on no car (or on a deleted car) links by it (`number=`).
   */
  number: string;
  /** `null` = a card on no car, named by `label`; listed in the company view only. */
  vehicleId: string | null;
  /** The car's registry code; `null` with no car. */
  code: string | null;
  /** The car's make; `null` with no car (or a car with no type name). */
  typeName: LocalizedString | null;
  /**
   * The card's car was DELETED from the registry since (soft delete; the card still sits on it and is
   * counted by the car's last branch). No record link; «فتح» opens the cards list by the number.
   * `false` with no car.
   */
  vehicleDeleted: boolean;
  /** What a card on no car is called («سفر 1»، «اسبير»); `null` on a card that is on a car. */
  label: string | null;
  balance: number;
  /** «طلب رصيد» written and not yet approved; `null` when none. */
  requestedAmount: number | null;
  /** 'YYYY-MM-DD'; `null` until it is known. */
  expiresAt: string | null;
  /** Never empty, in FLEET_DASHBOARD_FUEL_CARD_STATES order; `critical` and `low` never both. */
  states: FleetDashboardFuelCardState[];
}

/** One company's last read sheet, as it stood at its read (plain figures: no list shows exactly them). */
export interface FleetDashboardNowFuelSheetDto {
  /** «تاريخ الشيت», 'YYYY-MM-DD'; `null` on a session stored before the sheet day was recorded. */
  sheetDate: string | null;
  /** The Cairo day of the read, 'YYYY-MM-DD' — shown when `sheetDate` is null. */
  readDay: string;
  /** «اختلف رصيدها عند القراءة»: the session's balance lines (under a branch, those of its cards). */
  differing: number;
  /** Of them, the lines with no decision yet (a line held in repair counts as undecided). */
  undecided: number;
  /**
   * Σ (sheet balance − system balance) over the undecided lines, to the piastre, as at the read; 0
   * when none is undecided.
   */
  undecidedNet: number;
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

/**
 * Every fine still owed («قائمة»: `collected` not true), of EVERY year, old-book rows never ticked
 * included — the violations register's own outstanding sums (amounts rounded as the register's).
 * «ملخصات» keeps `violationsYear` (the Cairo year, amounts).
 */
export interface FleetDashboardNowViolationsOpenDto {
  /** Σ outstandingVehicleAmount / Σ outstandingVehicleCount. */
  company: { amount: number; count: number };
  drivers: {
    /**
     * Σ outstandingDriverAmount / Σ outstandingDriverCount = attributed + unknown + unlinked (amount
     * AND count).
     */
    total: { amount: number; count: number };
    /**
     * Fines on an HR-linked driver: their amount, the fines, and the distinct drivers («سائقون
     * معروفون» — a count with no names and no order).
     */
    attributed: { amount: number; count: number; drivers: number };
    /** «مجهول» (`isUnknownFleetDriver`). */
    unknown: { amount: number; count: number };
    /** «اسم غير مربوط»: a name that is not an HR employee and not «مجهول». */
    unlinked: { amount: number; count: number };
  };
  /** company + drivers. */
  total: { amount: number; count: number };
  /**
   * Of the owed fines above, those on cars the registry never had (`vehicleId` null — old-book rows
   * known by their code only), company and drivers apart. The company view only: `null` whenever the
   * reader's branches narrow (such a row is in no branch).
   */
  bookOnly: {
    company: { amount: number; count: number };
    drivers: { amount: number; count: number };
  } | null;
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
  /**
   * By CHECK-IN day — «أرقام الفترة» alone («بتاريخ دخول الورشة»): the visits that entered in the
   * range, and their state now.
   */
  visits: FleetDashboardPeriodVisitsDto | null;
  /**
   * Visits that LEFT the workshop in the range (EXIT day, `outFrom`/`outTo`, never `from`/`to`), over
   * the maintenance list's own filter — every period figure of «الصيانة والورش» and the overview's
   * «زيارات الصيانة» («بتاريخ الخروج من الورشة»).
   */
  exits: FleetDashboardPeriodExitsDto | null;
  /**
   * By ACCIDENT day, over the accidents register's own filter. `undated`: company view only.
   * `openRemaining` (the open files' remaining) is «أرقام الفترة»'s.
   */
  accidents: {
    count: number;
    open: number;
    openRemaining: number;
    undated: number | null;
    /**
     * «مبالغ ملفات حوادث الفترة»: the period's files, open AND closed, as their amounts stand NOW —
     * the register's «الإحصائيات» over the same filter (FleetAccidentTotalsDto without `count`).
     */
    totals: FleetDashboardPeriodAccidentTotalsDto;
  } | null;
  /**
   * «حوادث الفترة»: at most FLEET_DASHBOARD_ACCIDENT_ROWS of the period's files, open and closed,
   * newest first; `more` = the files left out («عرض الباقي (N) في السجل»).
   */
  accidentList: { rows: FleetDashboardPeriodAccidentRowDto[]; more: number } | null;
  /**
   * «مخالفات السائقين في الفترة»: the DRIVERS' fines whose day is in the range (whole days on both
   * ends), over the drivers' ledger's own filter (a vehicle set drops the old book's carless rows),
   * their states as of NOW. A company statement carries a year, never a day, so it is never here
   * (also under «هذه السنة»).
   */
  violations: FleetDashboardPeriodViolationsDto | null;
  /**
   * The period's driver fines, owed and collected: at most FLEET_DASHBOARD_VIOLATION_ROWS, the
   * newest fine day first (the register's `sortBy=date&sortDir=desc`); `more` = the fines left out
   * («عرض الباقي (N) في السجل»).
   */
  violationList: { rows: FleetDashboardPeriodViolationRowDto[]; more: number } | null;
  /**
   * R-19 «مصروف التشغيل» — the receipts screen's own totals over the range (by the receipt's paper
   * day), never added to the dealership figure. Card receipts are fuel only, so
   * card + fuelCustody + tyres + wash + maintenance = total = card + custody, and fuel = card +
   * fuelCustody. A card's fuel with no receipt is not here (only a sheet difference).
   */
  opex: {
    /** «وقود من الكارت». */
    card: number;
    /** Every custody-paid receipt (fuel, tyres, wash, maintenance). */
    custody: number;
    /** Fuel receipts (card + custody): the receipts screen's `kind=fuel` total. */
    fuel: number;
    total: number;
    count: number;
    dataFrom: string | null;
    /** «وقود من العهدة»: the fuel receipts paid from the custody (`kind=fuel&source=custody`). */
    fuelCustody: number;
    /** «كاوتش» (`kind=tyres`). */
    tyres: number;
    /** «غسيل» (`kind=wash`). */
    wash: number;
    /** «صيانة» (`kind=maintenance`). */
    maintenance: number;
    /**
     * «نحو N لترًا»: the whole litres of the priced fuel receipts — each priced at the litre price of
     * its own day, so an estimate.
     */
    litres: number;
    /** Fuel receipts with no litre price: they are in `fuel`, never in `litres`. */
    unpricedFuel: number;
  } | null;
  /**
   * «مصروف التشغيل يومًا بيوم» (or «شهرًا بشهر»): EVERY bucket of the range in order, by the receipt's
   * paper day — 'YYYY-MM-DD' or 'YYYY-MM' as `range.granularity` says; Σ amount = `opex.total`,
   * Σ count = `opex.count`.
   */
  opexSeries: { buckets: FleetDashboardOpexBucketDto[] } | null;
  /** R-20 by outDate. */
  dealership: { amount: number; rows: number; pending: number; dataFrom: string } | null;
  /**
   * «فواتير التوكيل في الفترة»: at most FLEET_DASHBOARD_DEALERSHIP_ROWS of the rows `dealership`
   * counts, in the dealership screen's order (exit day newest first, then the newest recorded) — the
   * first page of its link; `more` + `rows.length` = `dealership.rows`.
   */
  dealershipList: { rows: FleetDashboardPeriodDealershipRowDto[]; more: number } | null;
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

/**
 * «العدادات والكيلومترات» (and «أرقام الفترة»'s km), R-14…R-17. Every count is a field here, never a
 * list's length.
 */
export interface FleetDashboardPeriodKmDto {
  total: number;
  /** «قراءات تحتاج مراجعة»: the period's closed rows with km < 0 (R-14); they never enter `total`. */
  invalidRows: number;
  /** total ÷ the cars with a valid row in it (any status, old-book codes included); null when none. */
  perVehicleAvg: number | null;
  /**
   * «قراءات لـX من Y»: `of` = the set's cars counted in the period — active now, not in the workshop
   * for the WHOLE period, not joined after it; `withReadings` = of them, those with a valid row.
   * `active` = the set's active cars now; `inWorkshop` = of them, in the workshop for the whole period;
   * `joinedAfter` = of them, joined after the period. Always `of = active − inWorkshop − joinedAfter`.
   */
  coverage: {
    withReadings: number;
    of: number;
    active: number;
    inWorkshop: number;
    joinedAfter: number;
  };
  /**
   * «سيارات بلا مسافة في الفترة»: `cars` = of − withReadings (the reasons noRow | onlyOpen |
   * onlyNoCounter | onlyInvalid); `neverRead` = of those, the cars with no reading at ANY date.
   * `codes` / `neverReadCodes` feed the vehicles-list links, code order, `[]` when over 50 (no link).
   */
  noDistance: { cars: number; neverRead: number; codes: string[]; neverReadCodes: string[] };
  /**
   * «قراءات تحتاج مراجعة»: at most FLEET_DASHBOARD_EXCEPTION_ROWS of the `invalidRows` rows, the
   * oldest day first, then code. A count is `invalidRows`.
   */
  invalidList: FleetDashboardInvalidReadingDto[];
  /** R-15 average line. */
  confirmedThrough: string | null;
  closedDays: number;
  average: number | null;
  buckets: FleetDashboardKmBucketDto[];
  spans: { km: number; count: number };
  /** Current branch (K-12). */
  byBranch: { branchId: string | null; name: LocalizedString | null; km: number }[];
  /**
   * «الكيلومترات حسب النوع» — only when exactly one branch is in scope (a chosen branch, or a reader's
   * only branch: `vehicleScope.scopeBranches` of length 1); `null` in the company view and under
   * «كل فروعي».
   */
  byType: { typeId: string; name: LocalizedString; km: number }[] | null;
  /** km of vehicleId-null rows; null when a set exists. */
  unregistered: number | null;
  /** «أعلى 5»: ≤ FLEET_DASHBOARD_RANK_ROWS; `typeName` = the make. */
  top5: { vehicleId: string; code: string; km: number; typeName: LocalizedString | null }[];
  /** «أقل 5»: ≤ FLEET_DASHBOARD_RANK_ROWS, active cars only; `typeName` = the make. */
  bottom5: {
    vehicleId: string;
    code: string;
    km: number;
    inWorkshopSince: string | null;
    typeName: LocalizedString | null;
  }[];
  withoutReadings: { vehicleId: string; code: string; reason: FleetDashboardNoReadingReason }[];
}

/** One row of «قراءات تحتاج مراجعة»: a closed row whose km is negative (R-14). */
export interface FleetDashboardInvalidReadingDto {
  /** `null` = an old-book code with no registry car. */
  vehicleId: string | null;
  /** The car's code, else the row's own (old-book) code. */
  code: string;
  /**
   * The registry car was DELETED since (soft delete; its readings stay and are listed). Its file is
   * no longer served and the register's code filter finds live cars only, so the web gives such a
   * row no car link and its «فتح» opens that ONE day without the code (the row is among them).
   * `false` for an old-book row with no registry car.
   */
  deleted: boolean;
  /** The make; `null` for an old-book code. */
  typeName: LocalizedString | null;
  /** The row's day, 'YYYY-MM-DD'. */
  date: string;
  /** The row's out reading. */
  from: number;
  /** from + km (below `from`). */
  to: number;
  /** < 0. */
  km: number;
}

/** T6.3/T6.4, R-18 — «أرقام الفترة»: visits by CHECK-IN day. */
export interface FleetDashboardPeriodVisitsDto {
  /** State NOW («حتى الآن»): closed + open = count. */
  count: number;
  closed: number;
  open: number;
}

/** One bar of «الصيانة والورش»'s period pair (by work type, by workshop). */
export interface FleetDashboardPeriodExitBarDto {
  /** The catalog id: `workTypes=` / `workshops=` on the maintenance list. */
  id: string;
  name: LocalizedString | null;
  count: number;
}

/** One row of «أكثر السيارات دخولًا للورشة». */
export interface FleetDashboardPeriodTopVehicleDto {
  vehicleId: string | null;
  code: string;
  /** The make, as the maintenance list names it. */
  typeName: LocalizedString | null;
  /** The car's exits in the range. */
  visits: number;
  /** Check-in day of its latest exit visit, 'YYYY-MM-DD'. */
  lastInDate: string;
  /** That visit's work type. */
  lastWorkType: LocalizedString | null;
}

/** «الصيانة والورش», the period band — visits that LEFT the workshop in the range (EXIT day). */
export interface FleetDashboardPeriodExitsDto {
  count: number;
  /**
   * The mean of whole days check-in → check-out over `count` (the same day = 0), one decimal; `null`
   * when count = 0.
   */
  avgStayDays: number | null;
  /** count desc, name asc, nameless last; each list sums to `count`. */
  byWorkType: FleetDashboardPeriodExitBarDto[];
  byWorkshop: FleetDashboardPeriodExitBarDto[];
  /**
   * ≤ FLEET_DASHBOARD_RANK_ROWS: exits desc, latest check-in desc, then code. A car deleted from the
   * registry is not ranked (its code opens an empty list), and — a choice, not a dead link — neither
   * is an old-book visit with no registry car: every row names a registry car. Both stay in `count`
   * and the bars (the old-book ones also in `unregistered`).
   */
  topVehicles: FleetDashboardPeriodTopVehicleDto[];
  /** Exits of old-book visits with no registry car; `null` when a vehicle clause applies. */
  unregistered: number | null;
}

/**
 * «مبالغ ملفات حوادث الفترة» — the register's sums without `count`:
 * remaining = amountCollected + companyCost − paidAmount + transferredIn − transferredOut.
 */
export type FleetDashboardPeriodAccidentTotalsDto = Omit<FleetAccidentTotalsDto, 'count'>;

/** One row of «حوادث الفترة» — date only, newest first. */
export interface FleetDashboardPeriodAccidentRowDto {
  accidentId: string;
  vehicleId: string | null;
  code: string;
  /** The car's make; `null` for a carless old-book file (or a car with no type name). */
  typeName: LocalizedString | null;
  /** The accident's day, 'YYYY-MM-DD' — never a time. */
  date: string;
  /** The file's «بيان», verbatim (may be '' on old-book files). */
  statement: string;
  culprit: string | null;
  culpritEmployeeIds: string[];
  status: FleetAccidentStatus;
  /** As of now («المتبقي (حتى الآن)»). */
  remaining: number;
}

/** «مخالفات السائقين في الفترة» — every count and sum a server field. */
export interface FleetDashboardPeriodViolationsDto {
  count: number;
  amount: number;
  /** Still owed («قائمة»): `collected` not true (a missing tick is owed), as of now. */
  owed: { count: number; amount: number };
  /**
   * Collected («محصَّلة») as of now: no collection day is recorded, so this is how much of the
   * period's fines is collected TODAY, not what was collected during the period.
   */
  collected: { count: number; amount: number };
  /**
   * «مخالفات الفترة حسب النوع»: only the types with at least one fine, count desc, then amount desc,
   * then name; the catalog's «غير محدد (مخالفات السائقين)» (`unspecified`) always last. Σ count =
   * `count`, Σ amount = `amount`.
   */
  byType: FleetDashboardPeriodViolationTypeDto[];
}

/** One bar of «مخالفات الفترة حسب النوع». */
export interface FleetDashboardPeriodViolationTypeDto {
  /** The catalog id: `violationTypeId=` on the register (`dtype=` on its drivers' half). */
  violationTypeId: string;
  /** The catalog name; `null` when the type is gone from the catalog. */
  name: LocalizedString | null;
  /** The catalog's «غير محدد (مخالفات السائقين)» — drawn last and labelled «غير محدد». */
  unspecified: boolean;
  count: number;
  amount: number;
}

/** One row of «مخالفات السائقين في الفترة»; every name resolved on the server. */
export interface FleetDashboardPeriodViolationRowDto {
  violationId: string;
  /** `null` = an old-book row on a car the registry never had (known by its code). */
  vehicleId: string | null;
  /** The car's registry code, else the row's own (old-book) code. */
  code: string;
  /** The car's make; `null` for an old-book code (or a car with no type name). */
  typeName: LocalizedString | null;
  /**
   * The registry car was DELETED since (soft delete; its fines stay and are listed): no record
   * link. `false` for an old-book row with no registry car.
   */
  vehicleDeleted: boolean;
  /** The fine's day, 'YYYY-MM-DD' — never a time. */
  date: string;
  /** The HR employee the fine is on; `null` = «مجهول» or a name not linked to HR. */
  driverEmployeeId: string | null;
  /** The name as recorded (`isUnknownFleetDriver` tells «مجهول»); `null` when none was. */
  driverName: string | null;
  violationTypeId: string;
  /** The catalog name; `null` when the type is gone from the catalog. */
  violationType: LocalizedString | null;
  /** The catalog's «غير محدد (مخالفات السائقين)» — labelled «غير محدد». */
  unspecified: boolean;
  amount: number;
  /** «محصَّلة» when true, «قائمة» otherwise — as of now. */
  collected: boolean;
}

/** One slot of «مصروف التشغيل يومًا بيوم» / «شهرًا بشهر». */
export interface FleetDashboardOpexBucketDto {
  /** 'YYYY-MM-DD' (day) or 'YYYY-MM' (month). */
  key: string;
  /** false → an EMPTY slot (no receipt that day), never a zero column. */
  hasRows: boolean;
  amount: number;
  /** The receipts of the slot. */
  count: number;
}

/** One row of «فواتير التوكيل في الفترة»; every name resolved on the server. */
export interface FleetDashboardPeriodDealershipRowDto {
  /** The dealership row's id. */
  id: string;
  /** `null` = an old-book row on a car the registry never had (known by its code). */
  vehicleId: string | null;
  /** The car's registry code, else the row's own (old-book) code. */
  code: string;
  /** The car's make; `null` for an old-book code (or a car with no type name). */
  typeName: LocalizedString | null;
  /** The registry car was DELETED since (soft delete): no record link. `false` for an old-book row. */
  vehicleDeleted: boolean;
  /** The car's exit day from the dealership, 'YYYY-MM-DD' — the day the period counts by. */
  date: string;
  /** «صيانة» or «إصلاح». */
  workKind: FleetDealershipWorkKind;
  /** «صيانة», «إصلاح» or «إصلاح (كهرباء)» — the dealership screen's work-type column. */
  workTypeLabel: string;
  invoiceNumber: string | null;
  /** `null` = «بانتظار تسجيل القيمة» (counted in `dealership.pending`). */
  invoiceAmount: number | null;
}
