// «لوحة تحكم الحركة» — ONE builder for the link behind every figure of the ten tabs (plan R-28,
// unified.md §6.2). A figure on the dashboard opens the screen that shows the same number: this file
// knows each screen's OWN parameter names and fills them from the server's echo only — `today`, the
// `range` of a period, the `vehicleScope` filters and the active `branchId` — never from the browser
// clock and never from a list the browser assembled.
//
// THREE RULES THE LINK CENSUS HOLDS IT TO:
//   · NO BARE LIST LINK. A list screen opened without a query restores the reader's remembered
//     filters, so it would show another number. Every list link names at least one parameter. The
//     exceptions are not lists: a record (`/fleet/vehicles/:id`), and the two screens that keep no
//     filter to remember — «لوحة تحكم العهدة» and «مطابقة أرصدة الكروت» (`PATH_ONLY` below).
//   · FILTERS TRAVEL AS FILTERS. A type, an operation or a branch goes as `type` / `operation` /
//     `branch` — never turned into a list of codes, so a 60-car type still has its link.
//   · A FIGURE WITH NO EXACT LIST HAS NO LINK. The builder returns `null` (the named exceptions,
//     unified.md §8.2), and the tab shows the figure as plain text.
import {
  FLEET_LICENCE_GREY_DAYS,
  addDaysYmd,
  type FleetDashboardVehicleScopeDto,
} from '@ecms/contracts';

/** A figure's link: where it goes, and which figure it is (`data-metric="<section>.<field>"`). */
export interface DashLink {
  to: string;
  metric: string;
}

type Param = string | number | boolean | readonly string[] | null | undefined;

/** A comma list stays readable (`type=a,b`); everything else is encoded. Empty values are dropped. */
const query = (params: Record<string, Param>): string => {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      parts.push(`${key}=${raw.map((v: string) => encodeURIComponent(v)).join(',')}`);
      continue;
    }
    parts.push(`${key}=${encodeURIComponent(String(raw))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

const at = (path: string, params: Record<string, Param>, metric: string): DashLink => ({
  to: `${path}${query(params)}`,
  metric,
});

/** The screens a link may name without a query: they read no parameter and remember none. */
export const PATH_ONLY: readonly string[] = ['/fleet/custody/dashboard', '/fleet/fuel-cards/reconcile'];

/** The cap every screen's `vehicleCodes` takes (`vehicleCodesQuery`, 50). */
export const LINK_CODES_CAP = 50;

/** A list of cars as a `vehicleCodes` link, or `null` when it is empty or over the screens' cap. */
const codesOrNull = (codes: readonly string[]): readonly string[] | null =>
  codes.length === 0 || codes.length > LINK_CODES_CAP ? null : codes;

/** T1.11 / T5.6–T5.9 — the custody dashboard has no filters: its link is its path (no R1 needed). */
export const custodyDashboardLink = (metric: string): DashLink => ({
  to: '/fleet/custody/dashboard',
  metric,
});

// ── The «الآن» tabs (R1): today and the active branch ───────────────────────────────────────────

export interface NowEcho {
  /** Cairo today, as R1 echoes it. */
  today: string;
  /** The active branch (X-Active-Branch), as R1 echoes it. */
  branchId: string | null;
}

export const nowLinks = ({ today, branchId }: NowEcho) => {
  /** `{br}` — the active branch, on the screens that read `branch`. */
  const br = { branch: branchId };
  const licence = (metric: string, from: string | null, before: string) =>
    at('/fleet/vehicles', { status: 'active', licExpFrom: from, licExpBefore: before }, metric);
  const driverLicence = (metric: string, from: string | null, before: string) =>
    at('/fleet/drivers', { licExpFrom: from, licExpBefore: before, ...br }, metric);
  const roster = (metric: string, extra: Record<string, Param>) =>
    at('/fleet/roster', { date: today, ...extra }, metric);
  return {
    // Tab 1 — alerts.
    /** T1.1: the alarms board, narrowed to the branch's cars when a branch is chosen (D19). */
    alarm: (level: 'red' | 'yellow', codes: readonly string[] | null): DashLink | null => {
      if (codes === null) return at('/fleet/maintenance-alarms', { level }, `maintenanceAlarm.${level}`);
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('/fleet/maintenance-alarms', { level, vehicleCodes: narrowed }, `maintenanceAlarm.${level}`);
    },
    /** T1.2 / T4.1: expired = on or before today (R-02). */
    vehicleLicencesExpired: (): DashLink => licence('licenceVehicles.expired', null, today),
    /** T4.2: today+1 … today+W. */
    vehicleLicencesExpiring: (warnDays: number): DashLink =>
      licence('licenceVehicles.expiring', addDaysYmd(today, 1), addDaysYmd(today, warnDays)),
    /** T4.3: today+W+1 … today+60 (empty, so no link, when W ≥ 60). */
    vehicleLicencesSoon: (warnDays: number): DashLink | null =>
      warnDays >= FLEET_LICENCE_GREY_DAYS
        ? null
        : licence(
            'licenceVehicles.soon',
            addDaysYmd(today, warnDays + 1),
            addDaysYmd(today, FLEET_LICENCE_GREY_DAYS),
          ),
    /** T4.4 «+N»: every active car expired or expiring up to today+60. */
    vehicleLicencesWithin60: (): DashLink =>
      licence('licenceVehicles.more', null, addDaysYmd(today, FLEET_LICENCE_GREY_DAYS)),
    vehicle: (vehicleId: string, metric: string): DashLink => ({
      to: `/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
      metric,
    }),
    /** T1.3 / T4.5. */
    driverLicencesExpired: (): DashLink => driverLicence('licenceDrivers.expired', null, today),
    driverLicencesExpiring: (warnDays: number): DashLink =>
      driverLicence('licenceDrivers.expiring', addDaysYmd(today, 1), addDaysYmd(today, warnDays)),
    driverLicencesSoon: (warnDays: number): DashLink | null =>
      warnDays >= FLEET_LICENCE_GREY_DAYS
        ? null
        : driverLicence(
            'licenceDrivers.soon',
            addDaysYmd(today, warnDays + 1),
            addDaysYmd(today, FLEET_LICENCE_GREY_DAYS),
          ),
    /** «بلا تاريخ» (D18). «غير مسجّلين» has no list (named exception): no builder. */
    driverLicencesNotRecorded: (): DashLink =>
      at('/fleet/drivers', { licExp: 'none', ...br }, 'licenceDrivers.notRecorded'),
    /** T1.4. */
    fuelCardsExpired: (): DashLink =>
      at('/fleet/fuel-cards', { expiresBefore: today }, 'fuelCards.expired'),
    /** T4.7: today+1 … today+N, expired cards excluded. */
    fuelCardsExpiring: (warnDays: number): DashLink =>
      at(
        '/fleet/fuel-cards',
        { expiresFrom: addDaysYmd(today, 1), expiresBefore: addDaysYmd(today, warnDays) },
        'fuelCards.expiring',
      ),
    /** T1.6. */
    crewGap: (): DashLink => roster('roster.crewGap', { view: 'crewGap' }),
    /** T1.7 / T5.3, T1.8 / T5.4, T5.5. */
    charging: (state: 'requested' | 'low' | 'charged'): DashLink =>
      at('/fleet/fuel-cards/charging', { state }, `fuelCharging.${state}`),
    /** T5.1 / T5.2. */
    chargingCompany: (company: 'wataniya' | 'chillout'): DashLink =>
      at('/fleet/fuel-cards/charging', { company }, `fuelCharging.${company}`),
    /** T1.9. */
    dealershipPending: (): DashLink =>
      at('/fleet/dealership', { state: 'pending', ...br }, 'dealershipPending.rows'),
    /** T1.10: the union headline is a named exception (D16) — the open notices, its closest list. */
    noticesOpen: (): DashLink => at('/fleet/notices', { status: 'open' }, 'notices.missingAny'),
    noticesCheckImage: (): DashLink =>
      at('/fleet/notices', { status: 'open', checkImage: 'missing' }, 'notices.missingCheckImage'),
    custodyDashboard: custodyDashboardLink,
    /** T5.9: the spend screen over the last 30 days. */
    custodyExpenses: (): DashLink =>
      at('/fleet/custody-expenses', { from: addDaysYmd(today, -29), to: today }, 'custodyFund.expenses'),
    /** T1.12: the stale cars' whole history (`period=all`), at most 50 of them. */
    noReading: (codes: readonly string[]): DashLink | null => {
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('/fleet/odometer', { vehicleCodes: narrowed, period: 'all' }, 'noReading.stale');
    },
    neverRead: (codes: readonly string[]): DashLink | null => {
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('/fleet/vehicles', { vehicleCodes: narrowed }, 'noReading.neverRead');
    },

    // Tab 2 — «الحركة الآن».
    vehiclesActive: (): DashLink => at('/fleet/vehicles', { status: 'active' }, 'vehicles.active'),
    vehiclesOutOfService: (): DashLink =>
      at('/fleet/vehicles', { status: 'outOfService' }, 'vehicles.outOfService'),
    rosterReady: (): DashLink => roster('roster.ready', { view: 'ready' }),
    rosterUnmanned: (metric = 'roster.unmanned'): DashLink => roster(metric, { view: 'unmanned' }),
    rosterWorkshop: (): DashLink => roster('roster.inWorkshop', { view: 'workshop' }),
    rosterAvailable: (metric = 'roster.available'): DashLink => roster(metric, {}),
    rosterAbsent: (reason: 'fleetUnavailability' | 'hrLeave'): DashLink =>
      roster(reason === 'hrLeave' ? 'roster.absent.leave' : 'roster.absent.attendance', {
        unavailable: reason,
      }),
    rosterUnavailable: (
      reason: 'profileInactive' | 'notEmployed' | 'licenceExpired',
      metric: string,
    ): DashLink => roster(metric, { unavailable: reason }),
    /** A secondary link (its own page guard, `fleetAvailability.view`). */
    attendance: (): DashLink => at('/fleet/attendance', { date: today }, 'roster.absent.attendanceSheet'),
    /** T2.4 — open visits of any status. */
    workshopOpen: (metric = 'workshop.open'): DashLink =>
      at('/fleet/maintenance', { state: 'open', ...br }, metric),

    // Tab 3 — distribution.
    vehiclesBy: (
      cell: { typeId?: string; branchId?: string; operationIds?: readonly string[] },
      metric: string,
    ): DashLink =>
      at(
        '/fleet/vehicles',
        { status: 'active', type: cell.typeId, branch: cell.branchId, operation: cell.operationIds },
        metric,
      ),
    /** T3.4: the registry, never bare (a bare URL restores remembered filters, CR-11). */
    drivers: (): DashLink =>
      at('/fleet/drivers', { sort: 'employeeCode:asc', ...br }, 'distributionDrivers.total'),
    /** T3.6 / T3.8: the catalog specialisations (the legacy-only profiles are a sub-line). */
    driversBySpec: (specializationIds: readonly string[], metric: string): DashLink | null =>
      specializationIds.length === 0
        ? null
        : at('/fleet/drivers', { spec: specializationIds, ...br }, metric),

    // Tab 4 — licences and recent records.
    /** T4.6 (D17): the licensing board's own stats bar, never the bare page. */
    licensing: (paper: 'insurance' | 'tax'): DashLink =>
      at('/fleet/licensing', { sort: 'asc' }, `papers.${paper}`),
    /** T4.8: the visit's day on the maintenance screen. */
    visitDay: (code: string, day: string): DashLink =>
      at('/fleet/maintenance', { vehicleCodes: [code], from: day, to: day }, 'recentWorkshop.row'),
    /** T4.9 / T10.1: the accident's day on the accidents screen. */
    accidentDay: (code: string, day: string, metric = 'recentAccidents.row'): DashLink =>
      at('/fleet/accidents', { vehicleCodes: [code], from: day, to: day }, metric),
    /** The two «سجل …» foot links of «آخر ما سُجّل» — the 30-day window the list shows. */
    accidentsRecent: (days: number): DashLink =>
      at('/fleet/accidents', { from: addDaysYmd(today, 1 - days), to: today }, 'recentAccidents.all'),
    visitsRecent: (days: number): DashLink =>
      at('/fleet/maintenance', { from: addDaysYmd(today, 1 - days), to: today }, 'recentWorkshop.all'),

    // Tab 5 — summaries.
    /** T5.10. */
    accidentsOpen: (): DashLink =>
      at('/fleet/accidents', { status: 'open', ...br }, 'accidentsOpen.count'),
    /** T5.11: company statements and the drivers' ledger of the Cairo year, unpaid. */
    violationsCompany: (year: number): DashLink =>
      at('/fleet/violations', { year: String(year), cset: 'false', ...br }, 'violationsYear.company'),
    violationsDrivers: (year: number): DashLink =>
      at('/fleet/violations', { year: String(year), dset: 'false', ...br }, 'violationsYear.drivers'),
    /** T5.12 «مجهول». «اسم غير مربوط» has no list parameter (named exception). */
    violationsUnknown: (year: number): DashLink =>
      at(
        '/fleet/violations',
        { year: String(year), dunknown: 'true', dset: 'false', ...br },
        'violationsYear.unknown',
      ),
    /** «مطابقة أرصدة الكروت» — a quick link to an existing screen that keeps no filters. */
    reconcile: (): DashLink => ({ to: '/fleet/fuel-cards/reconcile', metric: 'fuelCharging.reconcile' }),
  };
};
export type NowLinks = ReturnType<typeof nowLinks>;

// ── The «حسب الفلاتر» tabs (R2): the range and the vehicle set ──────────────────────────────────

export interface PeriodEcho {
  range: { from: string; to: string };
  vehicleScope: FleetDashboardVehicleScopeDto;
}

export const periodLinks = ({ range, vehicleScope }: PeriodEcho) => {
  /** `{set}` — the filters as each period screen reads them (D10). */
  const set = {
    type: vehicleScope.typeIds,
    operation: vehicleScope.operationIds,
    branch: vehicleScope.branchId,
    vehicleCodes: vehicleScope.vehicleCodes,
  };
  const dates = { from: range.from, to: range.to };
  const over = (path: string, metric: string, extra: Record<string, Param> = {}) =>
    at(path, { ...dates, ...set, ...extra }, metric);
  return {
    /** T6.1 / T7 / T8. */
    km: (metric = 'km.total'): DashLink => over('/fleet/odometer', metric),
    /** T8.x: one car's readings over the period. */
    carKm: (code: string, metric: string): DashLink =>
      at('/fleet/odometer', { vehicleCodes: [code], ...dates }, metric),
    vehicle: (vehicleId: string, metric: string): DashLink => ({
      to: `/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
      metric,
    }),
    /** T6.3 / T6.4 / T9. */
    visits: (
      metric = 'visits.count',
      extra: {
        state?: 'open' | 'closed';
        workTypes?: readonly string[];
        workshops?: readonly string[];
        vehicleCodes?: readonly string[];
      } = {},
    ): DashLink => over('/fleet/maintenance', metric, extra),
    /** T6.5 / T6.6 / T10.2. */
    accidents: (metric = 'accidents.count', status?: 'open'): DashLink =>
      over('/fleet/accidents', metric, { status }),
    accidentDay: (code: string, day: string, metric = 'accidentList.row'): DashLink =>
      at('/fleet/accidents', { vehicleCodes: [code], from: day, to: day }, metric),
    /** T6.7 / T6.8. */
    opex: (metric = 'opex.total', source?: 'card'): DashLink =>
      over('/fleet/receipts', metric, { source }),
    /** D20: the custody part — the spend screen when nothing but codes narrows, else the receipts. */
    opexCustody: (): DashLink =>
      vehicleScope.typeIds.length === 0 &&
      vehicleScope.operationIds.length === 0 &&
      vehicleScope.branchId === null
        ? at('/fleet/custody-expenses', { ...dates, vehicleCodes: vehicleScope.vehicleCodes }, 'opex.custody')
        : over('/fleet/receipts', 'opex.custody', { source: 'custody' }),
    /** T6.9. */
    dealership: (metric = 'dealership.amount'): DashLink => over('/fleet/dealership', metric),
  };
};
export type PeriodLinks = ReturnType<typeof periodLinks>;
