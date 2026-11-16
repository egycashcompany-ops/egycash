// R1 · `GET /fleet/dashboard/now` — tabs 1–5, the fleet as it stands on Cairo `today` (plan §5.2).
//
// COMPOSITION ONLY. Every figure is counted by the module that owns the screen it links to, with the
// query that screen sends (D9), so the number here is the number there by construction:
//   · 'screen' sections pass the reader's `scopeSelector` of the screen's own key (vehicles, roster,
//     licensing — R-27);
//   · 'company+set' sections pass no permission scope; the reader's branches narrow them through the
//     vehicle set only (`branchIds` = `DashboardContext.branchIds`: the switcher's branch, the
//     reader's only branch, or «كل فروعي»), the very parameter the link carries.
// The pure counting below (the roster digest, the distribution matrix) reads server fields the
// owning module already derived — it never re-spells a filter.
import {
  FLEET_DASHBOARD_ALARM_ROWS,
  FLEET_DASHBOARD_LICENCE_ROWS,
  FLEET_DASHBOARD_RECENT_DAYS,
  FLEET_DASHBOARD_RECENT_ROWS,
  FLEET_DASHBOARD_TODAY_ROWS,
  FLEET_DRIVER_UNAVAILABLE_REASONS,
  FLEET_LICENCE_GREY_DAYS,
  FleetSettingKeys,
  addDaysYmd,
  calendarDayBounds,
  compareFleetVehicleCodes,
  daysBetweenYmd,
  licenceWindows,
  ymdOf,
  ymdToUtcDate,
  type FleetDashboardAbsentDriverDto,
  type FleetDashboardAlarmRowDto,
  type FleetDashboardNamedDto,
  type FleetDashboardNowDistributionVehiclesDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowRosterDto,
  type FleetDashboardNowSection,
  type FleetDashboardOperationKindsDto,
  type FleetDashboardUnmannedClass,
  type FleetDashboardUnmannedRowDto,
  type FleetDashboardVehicleScopeDto,
  type FleetDriverUnavailableReason,
  type FleetMaintenanceAlarmDto,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type ListFleetVehiclesQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { fleetAccidentService } from '../accidents/accident.service';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetDealershipService } from '../dealership/dealership.service';
import { fleetDriverProfileService } from '../driver-profiles/driver-profile.service';
import { fleetFuelCardService } from '../fuel-cards/fuel-card.service';
import { fleetLicensingService } from '../licensing/licensing.service';
import { computeAlarms } from '../maintenance/maintenance-alarm';
import { fleetMaintenanceService } from '../maintenance/maintenance.service';
import { fleetNoticeService } from '../notices/notice.service';
import { fleetOdometerService } from '../odometer/odometer.service';
import { isAbsenceReason } from '../roster/roster-rules';
import { fleetRosterService } from '../roster/roster.service';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { vehicleSet, withVehicleFilterMemo } from '../vehicles/vehicle-set';
import { fleetViolationService } from '../violations/violation.service';
import {
  branchList,
  dashboardContext,
  scopeBranchesOf,
  type DashboardContext,
} from './dashboard-context';
import { idsOfKind, operationKind, specializationKind, type KindItem } from './dashboard-kinds';
import { runSections, section, type DashboardSection } from './dashboard-sections';
import { deriveNowAlerts } from './now-alerts';

/** The screens' `vehicleCodes` cap (`vehicleCodesQuery`): a longer list gets no link (D19). */
const LINK_CODES_CAP = 50;

type NowValues = { [K in FleetDashboardNowSection]: NonNullable<FleetDashboardNowDto[K]> };

// ── Shared reads, each once per request ─────────────────────────────────────────────────────

/** R-13: the cars of the reader's branches, every status and deleted ones included (D19). */
const branchSet = (d: DashboardContext) =>
  d.memo('branchSet', () => vehicleSet({}, d.branchIds, { branchId: d.branchId }));

/**
 * A 'company+set' section's screen filter on R1: only the reader's branches narrow (`{br}`) —
 * nothing for the whole company; one id, «كل فروعي»'s several, or `[]` (narrows to nothing).
 */
const branchFilter = (d: DashboardContext): { branchIds?: string[] } =>
  d.branchIds === null ? {} : { branchIds: [...d.branchIds] };

/** The vehicle types, read once per request (the matrix and the roster rows name them). */
const typeList = (d: DashboardContext) =>
  d.memo('vehicleTypes', () => fleetVehicleTypeRepository.listAll());

const catalog = (d: DashboardContext, kind: 'operation' | 'driverSpecialization') =>
  d.memo(`catalog:${kind}`, () => fleetCatalogItemRepository.listKind(kind));

/** The first and last instant of one Cairo day (R-02), the bounds the linked pages send. */
const dayStart = (ymd: string): Date => calendarDayBounds(ymd, ymd).from;
const dayEnd = (ymd: string): Date => calendarDayBounds(ymd, ymd).before;

/** The R-12 window's first day: the last 30 Cairo days, today included. */
const recentSince = (d: DashboardContext): string =>
  addDaysYmd(d.today, 1 - FLEET_DASHBOARD_RECENT_DAYS);

/** The drivers registry's digest (R-08, R-10) — T3.4/T3.6/T3.8 and T1.3/T4.5 read the same call. */
const driverRegistry = (d: DashboardContext) =>
  d.memo('driverRegistry', async () => {
    const [warnDays, specs] = await Promise.all([
      d.setting<number>(FleetSettingKeys.DriverLicenseWarnDays),
      catalog(d, 'driverSpecialization'),
    ]);
    const kindOf = (items: readonly KindItem[], id: string) => specializationKind(items, id, null);
    const cashSpecIds = idsOfKind(specs, 'cash', kindOf);
    const atmSpecIds = idsOfKind(specs, 'atm', kindOf);
    const digest = await fleetDriverProfileService.registryDigest({
      today: d.today,
      warnDays,
      branchIds: d.branchIds,
      cashSpecIds,
      atmSpecIds,
    });
    return { warnDays, cashSpecIds, atmSpecIds, digest };
  });

// ── Pure counting over server-derived fields ────────────────────────────────────────────────

/**
 * Why a ready car is unmanned — the tiles' rule, in the tiles' order, one class each: a crew gap
 * first, then a stale plan, then «بلا طاقم ثابت ولا تخطيط» (no standing crew, no seat planned),
 * else none of the three (`unassigned`: «لم يُعيَّن لها سائق»). The digest's counts and the list's
 * rows both read THIS, so the tiles and the table cannot disagree.
 */
export const unmannedClassOf = (
  row: FleetRosterRowDto,
  crewVehicleIds: ReadonlySet<string>,
): FleetDashboardUnmannedClass => {
  if ((row.crewGaps ?? []).length > 0) return 'crewGap';
  if (row.stalePlan === true) return 'stalePlan';
  if (
    !crewVehicleIds.has(row.vehicleId) &&
    row.driver1EmployeeId === null &&
    row.driver2EmployeeId === null
  ) {
    return 'noCrew';
  }
  return 'unassigned';
};

/** A ready car with no seat a driver available today holds (R-03, R-06) — `unmanned`'s rows. */
const isUnmanned = (row: FleetRosterRowDto): boolean =>
  row.assignable === true && row.manned !== true;

/** The cars with a standing crew (a fixed driver on either seat). */
export const crewVehicleIdsOf = (fixedCrews: readonly FixedCrewLike[]): Set<string> =>
  new Set(
    fixedCrews
      .filter((crew) => crew.driver1EmployeeId != null || crew.driver2EmployeeId != null)
      .map((crew) => String(crew.vehicleId)),
  );

/**
 * T2.3–T2.7, T1.6 — one `board(today)` read, counted. Every row flag is the board's own (R-03, R-06);
 * `crewVehicleIds` (cars with a standing crew) only tells «بلا طاقم ثابت ولا تخطيط» apart. The two
 * «الحركة اليوم» lists are `rosterLists`'.
 */
export const rosterDigest = (
  board: FleetRosterDayDto,
  crewVehicleIds: ReadonlySet<string>,
): Omit<FleetDashboardNowRosterDto, 'unmannedRows' | 'absentDrivers'> => {
  const c = {
    inWorkshop: 0,
    licenceExpired: 0,
    ready: 0,
    readyManned: 0,
    unmanned: 0,
    unmannedCrewGap: 0,
    unmannedStalePlan: 0,
    unmannedNoCrew: 0,
    unmannedUnassigned: 0,
  };
  const gap = { vehicles: 0, otherReasons: 0, covered: 0, stalePlan: 0 };
  for (const row of board.rows) {
    if (row.inMaintenance) c.inWorkshop += 1;
    else if (row.licenceExpired === true) c.licenceExpired += 1;
    if (row.assignable !== true) continue;
    c.ready += 1;
    const gaps = row.crewGaps ?? [];
    if (gaps.some((g) => isAbsenceReason(g.reason))) gap.vehicles += 1;
    if (gaps.some((g) => !isAbsenceReason(g.reason))) gap.otherReasons += 1;
    if ((row.crewCovered ?? 0) > 0) gap.covered += 1;
    if (row.stalePlan === true) gap.stalePlan += 1;
    if (row.manned === true) {
      c.readyManned += 1;
      continue;
    }
    c.unmanned += 1;
    const why = unmannedClassOf(row, crewVehicleIds);
    if (why === 'crewGap') c.unmannedCrewGap += 1;
    else if (why === 'stalePlan') c.unmannedStalePlan += 1;
    else if (why === 'noCrew') c.unmannedNoCrew += 1;
    else c.unmannedUnassigned += 1;
  }
  const available = board.availableDrivers.filter((driver) => driver.licence !== 'expired');
  const reasons = new Map<string, number>();
  for (const driver of board.unavailableDrivers) {
    reasons.set(driver.reason, (reasons.get(driver.reason) ?? 0) + 1);
  }
  const reason = (key: string): number => reasons.get(key) ?? 0;
  const flagged = board.availableDrivers.length - available.length;
  return {
    date: board.date,
    licenceRule: board.licenceRule ?? 'flag',
    rows: board.rows.length,
    ...c,
    crewGap: gap,
    // The whole pool: every seat-holder has exactly one verdict (R-04), so this is the sum below.
    registry: board.availableDrivers.length + board.unavailableDrivers.length,
    available: available.length,
    availableWithoutVehicle: available.filter((driver) => driver.assignedVehicleId === null).length,
    availableLicenceNotRecorded: available.filter((driver) => driver.licence === 'notRecorded')
      .length,
    availableNoProfile: available.filter((driver) => driver.licence === 'noProfile').length,
    absent: { attendance: reason('fleetUnavailability'), leave: reason('hrLeave') },
    profileInactive: reason('profileInactive'),
    notEmployed: reason('notEmployed'),
    licenceExpiredDrivers: flagged + reason('licenceExpired'),
  };
};

/** A standing crew as `fleet_fixed_crews` stores it (ids as ObjectIds or strings). */
export interface FixedCrewLike {
  vehicleId: unknown;
  driver1EmployeeId?: unknown;
  driver2EmployeeId?: unknown;
}

const UNMANNED_ORDER: Readonly<Record<FleetDashboardUnmannedClass, number>> = {
  crewGap: 0,
  stalePlan: 1,
  noCrew: 2,
  unassigned: 3,
};

/** What `rosterLists` names its rows with, every name resolved on the server. */
export interface RosterListNames {
  /** The car's branch now, for every row of the board (`null` = «بلا فرع»). */
  branchOf: ReadonlyMap<string, string | null>;
  typeNames: ReadonlyMap<string, LocalizedString>;
  branchNames: ReadonlyMap<string, LocalizedString>;
  missionNames: ReadonlyMap<string, LocalizedString>;
  /** vehicleId → code for the standing-crew cars the absent drivers belong to. */
  codesOf: ReadonlyMap<string, string>;
  /** employeeId → HR employee code (the absent list's last order key). */
  driverCodes: ReadonlyMap<string, string>;
}

/** The board's `reason` (a `FLEET_DRIVER_UNAVAILABLE_REASONS` value on the wire, typed `string`). */
const reasonOfWire = (reason: string): FleetDriverUnavailableReason =>
  (FLEET_DRIVER_UNAVAILABLE_REASONS as readonly string[]).includes(reason)
    ? (reason as FleetDriverUnavailableReason)
    : 'notADriver';

/** One of the two absences «الغائبون اليوم» lists (`isAbsenceReason`: «تمام: غير متاح», leave). */
const isAbsentToday = (reason: string): reason is FleetDashboardAbsentDriverDto['reason'] =>
  isAbsenceReason(reasonOfWire(reason)) &&
  (reason === 'fleetUnavailability' || reason === 'hrLeave');

/**
 * The board's own verdict for a driver on the day (`reasonOf` in roster.service.ts), read back from
 * the board: the unavailable half's reason; an expired licence while the rule only flags; nobody
 * in the pool at all is not a driver; else available (`null`).
 */
const boardReasonOf = (
  board: FleetRosterDayDto,
): ((employeeId: string) => FleetDriverUnavailableReason | null) => {
  const unavailable = new Map(
    board.unavailableDrivers.map((d) => [d.employeeId, reasonOfWire(d.reason)]),
  );
  const available = new Map(board.availableDrivers.map((d) => [d.employeeId, d.licence]));
  return (employeeId) => {
    const reason = unavailable.get(employeeId);
    if (reason !== undefined) return reason;
    const licence = available.get(employeeId);
    if (licence === undefined) return 'notADriver';
    return licence === 'expired' ? 'licenceExpired' : null;
  };
};

/** The unmanned rows `rosterLists` lists — class order, then code — capped (pure). */
export const listedUnmanned = (
  board: FleetRosterDayDto,
  crewVehicleIds: ReadonlySet<string>,
): { row: FleetRosterRowDto; why: FleetDashboardUnmannedClass }[] =>
  board.rows
    .filter(isUnmanned)
    .map((row) => ({ row, why: unmannedClassOf(row, crewVehicleIds) }))
    .sort(
      (a, b) =>
        UNMANNED_ORDER[a.why] - UNMANNED_ORDER[b.why] ||
        compareFleetVehicleCodes(a.row.code, b.row.code) ||
        a.row.vehicleId.localeCompare(b.row.vehicleId),
    )
    .slice(0, FLEET_DASHBOARD_TODAY_ROWS);

/** employeeId → the car whose STANDING crew holds that driver, on either seat. */
const crewCarOf = (fixedCrews: readonly FixedCrewLike[]): Map<string, string> => {
  const carOf = new Map<string, string>();
  for (const crew of fixedCrews) {
    for (const seat of [crew.driver1EmployeeId, crew.driver2EmployeeId]) {
      if (seat == null) continue;
      if (!carOf.has(String(seat))) carOf.set(String(seat), String(crew.vehicleId));
    }
  }
  return carOf;
};

/**
 * The absent drivers `rosterLists` lists (pure): the pool's «تمام: غير متاح» and «إجازة معتمدة»
 * (`isAbsenceReason`), each with the car whose STANDING crew holds them — read from the fixed
 * crews, so it is named even when that car is in the workshop or the seat is covered today. Crew
 * members first, then «تمام» before leave, then the employee code; capped.
 */
export const listedAbsent = (
  board: FleetRosterDayDto,
  fixedCrews: readonly FixedCrewLike[],
  driverCodes: ReadonlyMap<string, string>,
): {
  employeeId: string;
  reason: FleetDashboardAbsentDriverDto['reason'];
  car: string | null;
}[] => {
  const carOf = crewCarOf(fixedCrews);
  const code = (employeeId: string): string => driverCodes.get(employeeId) ?? '';
  return board.unavailableDrivers
    .flatMap((driver) =>
      isAbsentToday(driver.reason)
        ? [
            {
              employeeId: driver.employeeId,
              reason: driver.reason,
              car: carOf.get(driver.employeeId) ?? null,
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        Number(a.car === null) - Number(b.car === null) ||
        Number(a.reason === 'hrLeave') - Number(b.reason === 'hrLeave') ||
        code(a.employeeId).localeCompare(code(b.employeeId), 'en', { numeric: true }) ||
        a.employeeId.localeCompare(b.employeeId),
    )
    .slice(0, FLEET_DASHBOARD_TODAY_ROWS);
};

/** A branch the list does not name (deleted since): its id, never a made-up name. */
const UNNAMED: LocalizedString = { ar: '—', en: '—' };

/**
 * A lookup that only names a section's rows: when it fails, the rows go out with that name missing
 * (as `rosterLists` draws an unknown one) and the section still answers — the failure is logged,
 * the figures are kept.
 */
const namesOnly = <T>(what: string, load: Promise<T>, empty: T): Promise<T> =>
  load.catch((err: unknown) => {
    logger.error({ err, lookup: what }, 'fleet dashboard roster names failed');
    return empty;
  });

/**
 * «الحركة اليوم» — the two lists beside the digest, PURE: «سيارات بلا سائق اليوم» (the unmanned
 * rows by the digest's own classes, see `listedUnmanned`) and «الغائبون اليوم» (`listedAbsent`).
 *
 * A row's `absent` driver: the first gap seat's fixed driver for a crew gap; for a stale plan, the
 * planned seat whose driver is not available today and is not one of the car's standing crew (the
 * rule `stalePlanOf` fires on); none otherwise. Names come resolved (`names`); a car type or mission
 * the catalogs do not hold is `null`, never invented.
 */
export const rosterLists = (
  board: FleetRosterDayDto,
  fixedCrews: readonly FixedCrewLike[],
  names: RosterListNames,
): Pick<FleetDashboardNowRosterDto, 'unmannedRows' | 'absentDrivers'> => {
  const crewVehicleIds = crewVehicleIdsOf(fixedCrews);
  const reasonOf = boardReasonOf(board);
  const crewOf = new Map(
    fixedCrews.map((crew) => [
      String(crew.vehicleId),
      new Set(
        [crew.driver1EmployeeId, crew.driver2EmployeeId].flatMap((id) =>
          id == null ? [] : [String(id)],
        ),
      ),
    ]),
  );
  const absentOf = (
    row: FleetRosterRowDto,
    why: FleetDashboardUnmannedClass,
  ): FleetDashboardUnmannedRowDto['absent'] => {
    if (why === 'crewGap') {
      const gap = (row.crewGaps ?? [])[0];
      return gap === undefined ? null : { employeeId: gap.employeeId, reason: gap.reason };
    }
    if (why !== 'stalePlan') return null;
    const crew = crewOf.get(row.vehicleId) ?? new Set<string>();
    for (const employeeId of [row.driver1EmployeeId, row.driver2EmployeeId]) {
      if (employeeId === null || crew.has(employeeId)) continue;
      const reason = reasonOf(employeeId);
      if (reason !== null) return { employeeId, reason };
    }
    return null;
  };
  const unmannedRows = listedUnmanned(board, crewVehicleIds).map(({ row, why }) => {
    const branchId = names.branchOf.get(row.vehicleId) ?? null;
    return {
      vehicleId: row.vehicleId,
      code: row.code,
      typeName: names.typeNames.get(row.typeId) ?? null,
      branch:
        branchId === null
          ? null
          : { id: branchId, name: names.branchNames.get(branchId) ?? UNNAMED },
      mission:
        row.missionTypeId === null ? null : (names.missionNames.get(row.missionTypeId) ?? null),
      why,
      absent: absentOf(row, why),
    };
  });
  const absentDrivers = listedAbsent(board, fixedCrews, names.driverCodes).map((driver) => {
    const code = driver.car === null ? undefined : names.codesOf.get(driver.car);
    return {
      employeeId: driver.employeeId,
      reason: driver.reason,
      crewVehicle:
        driver.car === null || code === undefined ? null : { vehicleId: driver.car, code },
    };
  });
  return { unmannedRows, absentDrivers };
};

/** The reader's branches for the matrix columns: every branch for an organization grant. */
const scopeBranchIds = (scope: ScopeSelector): ReadonlySet<string> | null => {
  if (scope.scope === 'organization') return null;
  const listed = [...(scope.branchIds ?? []), ...(scope.departmentBranchIds ?? [])];
  return new Set(listed.length > 0 ? listed : scope.branchId === null ? [] : [scope.branchId]);
};

/**
 * T3.1–T3.3 — the type × branch matrix of ACTIVE cars, as the vehicles list counts them. Columns are
 * the reader's branches (plus any branch a counted car sits in, so no car is ever dropped); a car
 * with no branch is «بلا فرع». Row total = Σ cells + noBranch; the grand total = vehicles.active.
 * `branchCount` (the overview's «توزيع السيارات») = the columns that hold a car.
 *
 * The cells come split by the car's operation as well; the type rows ignore that split, and each
 * column folds it into `kinds` through `kindOf` (the very test the cash / ATM links' ids come from),
 * so a branch's cash + atm + other = its column. The columns are ordered by active cars, largest
 * first, a tie keeping the branch list's order — one order for the branch cards and the matrix.
 */
export const distributionMatrix = (input: {
  cells: readonly {
    typeId: string;
    branchId: string | null;
    operationId: string | null;
    count: number;
  }[];
  typeNames: ReadonlyMap<string, LocalizedString>;
  branches: readonly FleetDashboardNamedDto[];
  scopeBranches: ReadonlySet<string> | null;
  kindOf: (operationId: string | null) => 'cash' | 'atm' | null;
}): Pick<
  FleetDashboardNowDistributionVehiclesDto,
  'branches' | 'rows' | 'totals' | 'branchCount' | 'kinds' | 'noBranchKinds' | 'other'
> => {
  const seen = new Set(
    input.cells.flatMap((cell) => (cell.branchId === null ? [] : [cell.branchId])),
  );
  const listed = input.branches.filter(
    (branch) =>
      input.scopeBranches === null || input.scopeBranches.has(branch.id) || seen.has(branch.id),
  );
  const rows = new Map<string, FleetDashboardNowDistributionVehiclesDto['rows'][number]>();
  const totals: FleetDashboardNowDistributionVehiclesDto['totals'] = {
    counts: {},
    noBranch: 0,
    total: 0,
  };
  const zeroKinds = (): FleetDashboardOperationKindsDto => ({ cash: 0, atm: 0, other: 0 });
  // Every column, zeros included: a branch with no active car still has its card.
  const kinds: Record<string, FleetDashboardOperationKindsDto> = Object.fromEntries(
    listed.map((branch) => [branch.id, zeroKinds()]),
  );
  const noBranchKinds = zeroKinds();
  for (const cell of input.cells) {
    const row = rows.get(cell.typeId) ?? {
      typeId: cell.typeId,
      name: input.typeNames.get(cell.typeId) ?? { ar: '—', en: '—' },
      counts: {},
      noBranch: 0,
      total: 0,
    };
    const kind = input.kindOf(cell.operationId) ?? 'other';
    if (cell.branchId === null) {
      row.noBranch += cell.count;
      totals.noBranch += cell.count;
      noBranchKinds[kind] += cell.count;
    } else {
      row.counts[cell.branchId] = (row.counts[cell.branchId] ?? 0) + cell.count;
      totals.counts[cell.branchId] = (totals.counts[cell.branchId] ?? 0) + cell.count;
      const column = (kinds[cell.branchId] ??= zeroKinds());
      column[kind] += cell.count;
    }
    row.total += cell.count;
    totals.total += cell.count;
    rows.set(cell.typeId, row);
  }
  // Active cars desc; `sort` is stable, so a tie keeps the branch list's order.
  const branches = [...listed].sort(
    (a, b) => (totals.counts[b.id] ?? 0) - (totals.counts[a.id] ?? 0),
  );
  return {
    branches,
    rows: [...rows.values()].sort(
      (a, b) => b.total - a.total || a.name.ar.localeCompare(b.name.ar),
    ),
    totals,
    // The branches holding at least one counted car; «بلا فرع» is no branch, an empty column none.
    branchCount: Object.values(totals.counts).filter((count) => count > 0).length,
    kinds,
    noBranchKinds,
    other: {
      vehicles:
        Object.values(kinds).reduce((sum, column) => sum + column.other, 0) + noBranchKinds.other,
    },
  };
};

/**
 * «إنذارات الصيانة بالكيلومتر» — a projection of the alarm rows the counts read (already narrowed to
 * the reader's branches): red and yellow cars with a figure, red first, then the km left ascending
 * (the most overdue first), then the car code; at most FLEET_DASHBOARD_ALARM_ROWS. Every field is
 * the projection's own — the make and the interval of its rule, the day of its last counted
 * service, and the workshop of its OPEN visit (`newerUncountedVisit.why === 'open'`) only.
 */
export const alarmTableRows = (
  alarms: readonly FleetMaintenanceAlarmDto[],
): FleetDashboardAlarmRowDto[] =>
  alarms
    .flatMap((alarm): FleetDashboardAlarmRowDto[] => {
      if (alarm.level !== 'red' && alarm.level !== 'yellow') return [];
      if (alarm.remainingKm === null || alarm.sinceServiceKm === null) return [];
      const open = alarm.newerUncountedVisit?.why === 'open' ? alarm.newerUncountedVisit : null;
      return [
        {
          vehicleId: alarm.vehicleId,
          code: alarm.code,
          typeName: alarm.rule.vehicleType?.name ?? null,
          level: alarm.level,
          remainingKm: alarm.remainingKm,
          sinceServiceKm: alarm.sinceServiceKm,
          intervalKm: alarm.rule.intervalKm,
          lastServiceAt: alarm.lastServiceAt === null ? null : ymdOf(alarm.lastServiceAt),
          inWorkshop: open === null ? null : { workshop: open.workshop?.name ?? null },
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1) ||
        a.remainingKm - b.remainingKm ||
        compareFleetVehicleCodes(a.code, b.code),
    )
    .slice(0, FLEET_DASHBOARD_ALARM_ROWS);

// ── The sections ─────────────────────────────────────────────────────────────────────────────

const SECTIONS: { [K in FleetDashboardNowSection]: DashboardSection<K, NowValues[K]> } = {
  // T2.1/T2.2 — the registry by status, and the out-of-service cars with their reasons as written.
  vehicles: section('vehicles', 'screen', async (d) => {
    const scope = d.scope('fleetVehicle.view');
    const [counts, outOfServiceList] = await Promise.all([
      fleetVehicleRepository.statusCounts(scope),
      fleetVehicleRepository.outOfServiceList(scope),
    ]);
    return { ...counts, outOfServiceList };
  }),

  // T2.3–T2.7, T1.6 — the roster board of the Cairo day; its driver pool is company-wide (R-27).
  // «الحركة اليوم»'s two lists come from the same board: the rows follow the roster's scope, the
  // absent drivers the company-wide pool.
  roster: section('roster', 'screen', async (d) => {
    // The standing crews, the cars' branches and the drivers' codes come with the board (it reads
    // them anyway): one read, not four.
    const { board, fixedCrews, branchOf, driverCodes } = await fleetRosterService.boardWithCrews(
      ymdToUtcDate(d.today),
      d.scope('fleetRoster.view'),
    );
    const crewVehicleIds = crewVehicleIdsOf(fixedCrews);
    const listed = listedUnmanned(board, crewVehicleIds);
    const absent = listedAbsent(board, fixedCrews, driverCodes);
    // Only what the listed rows name is asked for: the type and branch lists (memoised, shared
    // with the matrix), the ≤ 8 rows' missions, and — once, only when one is off the board — the
    // codes of the absent drivers' crew cars.
    const missionIds = [
      ...new Set(
        listed.flatMap(({ row }) => (row.missionTypeId === null ? [] : [row.missionTypeId])),
      ),
    ];
    const boardCodes = new Map(board.rows.map((row) => [row.vehicleId, row.code]));
    const offBoard = [
      ...new Set(absent.flatMap((a) => (a.car === null || boardCodes.has(a.car) ? [] : [a.car]))),
    ];
    // Each lookup only NAMES rows: one that fails costs its names (a type or mission `null`, a
    // branch «—», no crew car), never the digest the tiles, the badge and the alert line read.
    const [types, branches, missionNames, otherCodes] = await Promise.all([
      listed.length === 0 ? Promise.resolve([]) : namesOnly('types', typeList(d), []),
      listed.length === 0 ? Promise.resolve([]) : namesOnly('branches', branchList(d), []),
      missionIds.length === 0
        ? Promise.resolve(new Map<string, LocalizedString>())
        : namesOnly(
            'missions',
            fleetCatalogItemRepository.namesByIds(missionIds),
            new Map<string, LocalizedString>(),
          ),
      offBoard.length === 0
        ? Promise.resolve(new Map<string, string>())
        : namesOnly(
            'crewCars',
            fleetVehicleRepository.codesByIds(offBoard),
            new Map<string, string>(),
          ),
    ]);
    return {
      ...rosterDigest(board, crewVehicleIds),
      ...rosterLists(board, fixedCrews, {
        branchOf,
        typeNames: new Map(types.map((type) => [String(type._id), type.name as LocalizedString])),
        branchNames: new Map(branches.map((b) => [String(b._id), b.name as LocalizedString])),
        missionNames,
        codesOf: new Map([...boardCodes, ...otherCodes]),
        driverCodes,
      }),
    };
  }),

  // T2.4, R-09 — open visits of any status, through the maintenance list's own filter.
  workshop: section('workshop', 'company+set', (d) =>
    fleetMaintenanceService.openNow({ today: d.today, filter: branchFilter(d) }),
  ),

  // T1.1 — the alarm projection, narrowed to the branch's cars AFTER computing (D19); the two
  // thresholds are the settings the projection itself resolves (organization level, memoised).
  maintenanceAlarm: section('maintenanceAlarm', 'company+set', async (d) => {
    const [alarms, set, redKm, yellowKm] = await Promise.all([
      computeAlarms(),
      branchSet(d),
      d.setting<number>(FleetSettingKeys.AlarmRedKm),
      d.setting<number>(FleetSettingKeys.AlarmYellowKm),
    ]);
    const inSet = set.ids === undefined ? null : new Set(set.ids);
    const rows = inSet === null ? alarms : alarms.filter((row) => inSet.has(row.vehicleId));
    const red = rows.filter((row) => row.level === 'red');
    const yellow = rows.filter((row) => row.level === 'yellow');
    // Each level's link carries its own codes, capped on its own: a branch with many green cars and
    // three red ones still links its three.
    const codesOf = (level: readonly { code: string }[]): string[] => {
      const codes = level.map((row) => row.code).sort((a, b) => a.localeCompare(b));
      return codes.length <= LINK_CODES_CAP ? codes : [];
    };
    return {
      red: red.length,
      overdue: red.filter((row) => row.remainingKm !== null && row.remainingKm < 0).length,
      yellow: yellow.length,
      codes: inSet === null ? null : { red: codesOf(red), yellow: codesOf(yellow) },
      redKm,
      yellowKm,
      // «إنذارات الصيانة بالكيلومتر» — the SAME narrowed rows the counts above read.
      rows: alarmTableRows(rows),
    };
  }),

  // T1.12, R-07 — active cars out of the workshop with no chain reading for N days.
  noReading: section('noReading', 'company+set', async (d) => {
    const [days, set] = await Promise.all([
      d.setting<number>(FleetSettingKeys.OdometerMissingReadingDays),
      branchSet(d),
    ]);
    const digest = await fleetOdometerService.noReadingDigest({
      today: d.today,
      days,
      ...(set.ids === undefined ? {} : { vehicleIds: set.ids }),
    });
    // The whole lists (the overview's line and the links), their counts and the ≤ 3 listed rows.
    return { days, ...digest };
  }),

  // T3.1–T3.3, T3.5, T3.7 — the matrix and the cash / ATM cars, counted by the vehicles list.
  distributionVehicles: section('distributionVehicles', 'screen', async (d) => {
    const scope = d.scope('fleetVehicle.view');
    const [cells, types, branches, operations] = await Promise.all([
      fleetVehicleRepository.activeByTypeAndBranch(scope),
      typeList(d),
      branchList(d),
      catalog(d, 'operation'),
    ]);
    const countKind = async (operationIds: string[]) => ({
      vehicles:
        operationIds.length === 0
          ? 0
          : await fleetVehicleRepository.countListed(
              {
                status: ['active'],
                operationId: operationIds,
              } satisfies Partial<ListFleetVehiclesQuery>,
              scope,
            ),
      operationIds,
    });
    const [cash, atm] = await Promise.all([
      countKind(idsOfKind(operations, 'cash', (items, id) => operationKind(items, id))),
      countKind(idsOfKind(operations, 'atm', (items, id) => operationKind(items, id))),
    ]);
    return {
      ...distributionMatrix({
        cells,
        typeNames: new Map(types.map((type) => [String(type._id), type.name as LocalizedString])),
        branches: branches.map((b) => ({ id: String(b._id), name: b.name as LocalizedString })),
        scopeBranches: scopeBranchIds(scope),
        // The same name test the cash / ATM ids (and so their links) come from.
        kindOf: (operationId) => operationKind(operations, operationId),
      }),
      cash,
      atm,
    };
  }),

  // T3.4, T3.6, T3.8 — the drivers registry (R-08), by HR branch when the reader's branches narrow.
  distributionDrivers: section('distributionDrivers', 'company+set', async (d) => {
    const { digest, cashSpecIds, atmSpecIds } = await driverRegistry(d);
    return {
      total: digest.total,
      cash: { ...digest.cash, specializationIds: cashSpecIds },
      atm: { ...digest.atm, specializationIds: atmSpecIds },
    };
  }),

  // T1.2, T4.1–T4.4 — ACTIVE cars (Q-15) in the three disjoint windows of R-10.
  licenceVehicles: section('licenceVehicles', 'screen', async (d) => {
    const scope = d.scope('fleetVehicle.view');
    const warnDays = await d.setting<number>(FleetSettingKeys.VehicleLicenseWarnDays);
    const w = licenceWindows(d.today, warnDays);
    const count = (status: 'active' | 'outOfService', from: string | null, to: string) =>
      fleetVehicleRepository.countListed(
        {
          status: [status],
          ...(from === null ? {} : { licenseExpiresFrom: dayStart(from) }),
          licenseExpiresBefore: dayEnd(to),
        },
        scope,
      );
    const [expired, expiring, soon, outOfServiceExpired, nearest] = await Promise.all([
      count('active', null, w.expired.to),
      count('active', w.expiring.from, w.expiring.to),
      w.soon === null ? Promise.resolve(0) : count('active', w.soon.from, w.soon.to),
      count('outOfService', null, w.expired.to),
      fleetVehicleRepository.nearestLicences(
        scope,
        addDaysYmd(d.today, FLEET_LICENCE_GREY_DAYS),
        FLEET_DASHBOARD_LICENCE_ROWS,
      ),
    ]);
    const list = nearest.rows.map((row) => ({
      ...row,
      days: daysBetweenYmd(d.today, ymdOf(row.expiresAt)),
    }));
    return {
      warnDays,
      expired,
      expiring,
      soon,
      outOfServiceExpired,
      list,
      more: nearest.total - list.length,
    };
  }),

  // T1.3, T4.5 — the same registry digest, its licence windows.
  licenceDrivers: section('licenceDrivers', 'company+set', async (d) => {
    const { warnDays, digest } = await driverRegistry(d);
    return { warnDays, ...digest.licence };
  }),

  // T4.6, R-11 — open papers through the licensing module's READ-ONLY count (never the writing GET).
  papers: section('papers', 'screen', (d) =>
    fleetLicensingService.openPaperCounts(d.scope('fleetLicensing.view')),
  ),

  // T1.4, T4.7 — expired cards, and the cards expiring after today within the warning window.
  fuelCards: section('fuelCards', 'company+set', async (d) => {
    const warnDays = await d.setting<number>(FleetSettingKeys.FuelCardExpiryWarnDays);
    const [expired, expiring] = await Promise.all([
      fleetFuelCardService.summary({ expiresBefore: dayEnd(d.today) }, d.now),
      fleetFuelCardService.summary(
        {
          expiresFrom: dayStart(addDaysYmd(d.today, 1)),
          expiresBefore: dayEnd(addDaysYmd(d.today, warnDays)),
        },
        d.now,
      ),
    ]);
    return { warnDays, expired: expired.cardCount, expiring: expiring.cardCount };
  }),

  // T1.7, T1.8, T5.1–T5.5 — the charging screen's figures; «شُحن اليوم» (the Cairo day, batch 3's
  // D5) on the request clock.
  fuelCharging: section('fuelCharging', 'company+set', async (d) => {
    const [yellowAt, redAt] = await Promise.all([
      d.setting<number>(FleetSettingKeys.FuelCardBalanceYellow),
      d.setting<number>(FleetSettingKeys.FuelCardBalanceRed),
    ]);
    const [all, belowYellow, belowRed] = await Promise.all([
      fleetFuelCardService.summary({}, d.now),
      fleetFuelCardService.summary({ balanceBelow: yellowAt }, d.now),
      fleetFuelCardService.summary({ balanceBelow: redAt }, d.now),
    ]);
    return {
      wataniya: all.wataniyaBalance,
      chillout: all.chilloutBalance,
      requested: { count: all.requestedCount, amount: all.requestedAmount },
      low: {
        belowYellow: belowYellow.cardCount,
        belowRed: belowRed.cardCount,
        yellowAt,
        redAt,
      },
      charged24h: all.chargedTodayAmount,
      // «موزعة على N كارتًا» — the cards the same summary counted.
      cards: all.cardCount,
    };
  }),

  // T4.8, R-12 — the most recently written visits of the last 30 Cairo days.
  recentWorkshop: section('recentWorkshop', 'company+set', (d) =>
    fleetMaintenanceService.recentWritten({
      sinceYmd: recentSince(d),
      limit: FLEET_DASHBOARD_RECENT_ROWS,
      filter: branchFilter(d),
    }),
  ),

  // T4.9, R-12 — the same over accidents; date only, undated files never recent.
  recentAccidents: section('recentAccidents', 'company+set', (d) =>
    fleetAccidentService.recentWritten({
      sinceYmd: recentSince(d),
      limit: FLEET_DASHBOARD_RECENT_ROWS,
      filter: branchFilter(d),
    }),
  ),

  // T1.10 and «إخطارات ينقصها مرفق» — the open notices (their count, the two parts, the union
  // missing ANY attachment, each once, and ≤ 6 of those), ONE read through the screen's own filter
  // by the car's CURRENT branch (a notice with no car is the company view's only); the caller's own
  // context, so the licence scans read as on /fleet/notices (R-25).
  notices: section('notices', 'company+set', (d) =>
    fleetNoticeService.dashboardDigest({ ...branchFilter(d) }, d.ctx),
  ),

  // T1.9 — dealership rows still waiting for an amount (`state=pending` sends `pending=true`).
  dealershipPending: section('dealershipPending', 'company+set', async (d) => ({
    rows: (await fleetDealershipService.summaryOver({ pending: true, ...branchFilter(d) })).count,
  })),

  // T5.10 — open files and what they still owe (Q-07).
  accidentsOpen: section('accidentsOpen', 'company+set', async (d) => {
    const totals = await fleetAccidentService.summaryOver({ status: 'open', ...branchFilter(d) });
    return { count: totals.count, remaining: totals.remaining };
  }),

  // T5.11/T5.12, R-24 — the Cairo year's uncollected fines, split.
  violationsYear: section('violationsYear', 'company+set', (d) =>
    fleetViolationService.yearDigest({
      year: Number(d.today.slice(0, 4)),
      filter: branchFilter(d),
    }),
  ),

  // «مخالفات قائمة» (the overview) — EVERY year's fines still owed, amount and count, as the rollup
  // without a year sums them; «ملخصات» keeps the Cairo year's above.
  violationsOpen: section('violationsOpen', 'company+set', (d) =>
    fleetViolationService.openDigest({ filter: branchFilter(d) }),
  ),
};

/** Registry order = the DTO's field order. */
export const NOW_SECTIONS = Object.values(SECTIONS) as readonly DashboardSection<
  FleetDashboardNowSection,
  unknown
>[];

class FleetDashboardNowService {
  /** `now` is the controller's one clock; nothing below reads another. */
  async read(ctx: AuthContext, now: Date): Promise<FleetDashboardNowDto> {
    // The modules resolve the same branch filter several times; the registry is asked once.
    return withVehicleFilterMemo(() => this.compose(ctx, now));
  }

  private async compose(ctx: AuthContext, now: Date): Promise<FleetDashboardNowDto> {
    const d = dashboardContext(ctx, now);
    // The echo needs nothing a section computes — the branch's car set and the branch list are
    // memoised and shared — so it is asked beside the sections. Awaited after them, its car count
    // was one more round trip on the end of every read, after the slowest section had answered.
    const [{ values, unavailable }, scopeBranches, vehicleScope] = await Promise.all([
      runSections('now', d, NOW_SECTIONS),
      scopeBranchesOf(d),
      this.scopeEcho(d),
    ]);
    const v = values as { [K in FleetDashboardNowSection]: NowValues[K] | null };
    return {
      today: d.today,
      asOf: now.toISOString(),
      branchId: d.branchId,
      scopeBranches,
      ...v,
      alerts: deriveNowAlerts(v),
      vehicleScope,
      unavailable,
    };
  }

  /**
   * R-13's echo, only while the reader's branches narrow (`branchIds !== null`: a branch view or
   * «كل فروعي»); a failure to resolve it costs the echo, not the read. Its car count is the
   * registry's (deleted cars left out) and only for a reader of the registry (`fleetVehicle.view`);
   * the filters themselves stay, the links are built from them.
   */
  private async scopeEcho(d: DashboardContext): Promise<FleetDashboardVehicleScopeDto | null> {
    if (d.branchIds === null) return null;
    try {
      const [set, scopeBranches] = await Promise.all([branchSet(d), scopeBranchesOf(d)]);
      const count =
        set.ids !== undefined && hasPermission(d.ctx, 'fleetVehicle.view')
          ? await fleetVehicleRepository.countLive(set.ids)
          : null;
      return { ...set.scope, count, scopeBranches };
    } catch (err) {
      logger.error({ err, read: 'now' }, 'fleet dashboard vehicle scope failed');
      return null;
    }
  }
}

export const fleetDashboardNowService = new FleetDashboardNowService();
