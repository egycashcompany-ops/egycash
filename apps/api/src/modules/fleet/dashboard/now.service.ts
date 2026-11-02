// R1 · `GET /fleet/dashboard/now` — tabs 1–5, the fleet as it stands on Cairo `today` (plan §5.2).
//
// COMPOSITION ONLY. Every figure is counted by the module that owns the screen it links to, with the
// query that screen sends (D9), so the number here is the number there by construction:
//   · 'screen' sections pass the reader's `scopeSelector` of the screen's own key (vehicles, roster,
//     licensing — R-27);
//   · 'company+set' sections pass no permission scope; the switcher's branch narrows them through the
//     vehicle set only (`branchIds = [activeBranchId]`), the very parameter the link carries.
// The pure counting below (the roster digest, the distribution matrix) reads server fields the
// owning module already derived — it never re-spells a filter.
import {
  FLEET_DASHBOARD_LICENCE_ROWS,
  FLEET_DASHBOARD_RECENT_DAYS,
  FLEET_DASHBOARD_RECENT_ROWS,
  FLEET_LICENCE_GREY_DAYS,
  FleetSettingKeys,
  addDaysYmd,
  calendarDayBounds,
  daysBetweenYmd,
  licenceWindows,
  ymdOf,
  ymdToUtcDate,
  type FleetDashboardNamedDto,
  type FleetDashboardNowDistributionVehiclesDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowRosterDto,
  type FleetDashboardNowSection,
  type FleetDashboardVehicleScopeDto,
  type FleetRosterDayDto,
  type ListFleetVehiclesQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { branchRepository } from '../../../platform/organization/branches/branch.repository';
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
import { type DashboardContext, dashboardContext } from './dashboard-context';
import { idsOfKind, operationKind, specializationKind, type KindItem } from './dashboard-kinds';
import { runSections, section, type DashboardSection } from './dashboard-sections';
import { deriveNowAlerts } from './now-alerts';

/** The screens' `vehicleCodes` cap (`vehicleCodesQuery`): a longer list gets no link (D19). */
const LINK_CODES_CAP = 50;

type NowValues = { [K in FleetDashboardNowSection]: NonNullable<FleetDashboardNowDto[K]> };

// ── Shared reads, each once per request ─────────────────────────────────────────────────────

/** R-13: the cars of the switcher's branch, every status and deleted ones included (D19). */
const branchSet = (d: DashboardContext) => d.memo('branchSet', () => vehicleSet({}, d.branchId));

/** A 'company+set' section's screen filter on R1: only the switcher's branch narrows (`{br}`). */
const branchFilter = (d: DashboardContext): { branchIds?: string[] } =>
  d.branchId === null ? {} : { branchIds: [d.branchId] };

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
      branchId: d.branchId,
      cashSpecIds,
      atmSpecIds,
    });
    return { warnDays, cashSpecIds, atmSpecIds, digest };
  });

// ── Pure counting over server-derived fields ────────────────────────────────────────────────

/**
 * T2.3–T2.7, T1.6 — one `board(today)` read, counted. Every row flag is the board's own (R-03, R-06);
 * `crewVehicleIds` (cars with a standing crew) only tells «بلا طاقم ثابت ولا تخطيط» apart.
 */
export const rosterDigest = (
  board: FleetRosterDayDto,
  crewVehicleIds: ReadonlySet<string>,
): FleetDashboardNowRosterDto => {
  const c = {
    inWorkshop: 0,
    licenceExpired: 0,
    ready: 0,
    readyManned: 0,
    unmanned: 0,
    unmannedCrewGap: 0,
    unmannedStalePlan: 0,
    unmannedNoCrew: 0,
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
    if (gaps.length > 0) c.unmannedCrewGap += 1;
    else if (row.stalePlan === true) c.unmannedStalePlan += 1;
    else if (
      !crewVehicleIds.has(row.vehicleId) &&
      row.driver1EmployeeId === null &&
      row.driver2EmployeeId === null
    ) {
      c.unmannedNoCrew += 1;
    }
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
 */
export const distributionMatrix = (input: {
  cells: readonly { typeId: string; branchId: string | null; count: number }[];
  typeNames: ReadonlyMap<string, LocalizedString>;
  branches: readonly FleetDashboardNamedDto[];
  scopeBranches: ReadonlySet<string> | null;
}): Pick<FleetDashboardNowDistributionVehiclesDto, 'branches' | 'rows' | 'totals'> => {
  const seen = new Set(
    input.cells.flatMap((cell) => (cell.branchId === null ? [] : [cell.branchId])),
  );
  const branches = input.branches.filter(
    (branch) =>
      input.scopeBranches === null || input.scopeBranches.has(branch.id) || seen.has(branch.id),
  );
  const rows = new Map<string, FleetDashboardNowDistributionVehiclesDto['rows'][number]>();
  const totals: FleetDashboardNowDistributionVehiclesDto['totals'] = {
    counts: {},
    noBranch: 0,
    total: 0,
  };
  for (const cell of input.cells) {
    const row = rows.get(cell.typeId) ?? {
      typeId: cell.typeId,
      name: input.typeNames.get(cell.typeId) ?? { ar: '—', en: '—' },
      counts: {},
      noBranch: 0,
      total: 0,
    };
    if (cell.branchId === null) {
      row.noBranch += cell.count;
      totals.noBranch += cell.count;
    } else {
      row.counts[cell.branchId] = (row.counts[cell.branchId] ?? 0) + cell.count;
      totals.counts[cell.branchId] = (totals.counts[cell.branchId] ?? 0) + cell.count;
    }
    row.total += cell.count;
    totals.total += cell.count;
    rows.set(cell.typeId, row);
  }
  return {
    branches,
    rows: [...rows.values()].sort(
      (a, b) => b.total - a.total || a.name.ar.localeCompare(b.name.ar),
    ),
    totals,
  };
};

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
  roster: section('roster', 'screen', async (d) => {
    // The standing crews come with the board (it reads them anyway): one read, not two.
    const { board, fixedCrews } = await fleetRosterService.boardWithCrews(
      ymdToUtcDate(d.today),
      d.scope('fleetRoster.view'),
    );
    const crewVehicleIds = new Set(
      fixedCrews
        .filter((crew) => crew.driver1EmployeeId !== null || crew.driver2EmployeeId !== null)
        .map((crew) => String(crew.vehicleId)),
    );
    return rosterDigest(board, crewVehicleIds);
  }),

  // T2.4, R-09 — open visits of any status, through the maintenance list's own filter.
  workshop: section('workshop', 'company+set', (d) =>
    fleetMaintenanceService.openNow({ today: d.today, filter: branchFilter(d) }),
  ),

  // T1.1 — the alarm projection, narrowed to the branch's cars AFTER computing (D19).
  maintenanceAlarm: section('maintenanceAlarm', 'company+set', async (d) => {
    const [alarms, set] = await Promise.all([computeAlarms(), branchSet(d)]);
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
    return { days, stale: digest.stale, neverRead: digest.neverRead };
  }),

  // T3.1–T3.3, T3.5, T3.7 — the matrix and the cash / ATM cars, counted by the vehicles list.
  distributionVehicles: section('distributionVehicles', 'screen', async (d) => {
    const scope = d.scope('fleetVehicle.view');
    const [cells, types, branches, operations] = await Promise.all([
      fleetVehicleRepository.activeByTypeAndBranch(scope),
      fleetVehicleTypeRepository.listAll(),
      branchRepository.listAll(),
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
      }),
      cash,
      atm,
    };
  }),

  // T3.4, T3.6, T3.8 — the drivers registry (R-08), the HR branch when one is chosen.
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

  // T1.10 — open notices missing ANY attachment (once each), its two parts beside it; the
  // caller's own context, so the licence scans read as on /fleet/notices (R-25).
  notices: section('notices', 'company+set', async (d) => {
    const [summary, missingAny] = await Promise.all([
      fleetNoticeService.summary({ status: 'open' }, d.ctx),
      fleetNoticeService.missingAnyCount({}, d.ctx),
    ]);
    return {
      open: summary.open,
      missingAny,
      missingLicences: summary.missingLicences,
      missingCheckImage: summary.missingCheckImage,
    };
  }),

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
    const { values, unavailable } = await runSections('now', d, NOW_SECTIONS);
    const v = values as { [K in FleetDashboardNowSection]: NowValues[K] | null };
    return {
      today: d.today,
      asOf: now.toISOString(),
      branchId: d.branchId,
      ...v,
      alerts: deriveNowAlerts(v),
      vehicleScope: await this.scopeEcho(d),
      unavailable,
    };
  }

  /**
   * R-13's echo, only while a branch narrows; a failure to resolve it costs the echo, not the read.
   * Its car count is the registry's (deleted cars left out) and only for a reader of the registry
   * (`fleetVehicle.view`); the filters themselves stay, the links are built from them.
   */
  private async scopeEcho(d: DashboardContext): Promise<FleetDashboardVehicleScopeDto | null> {
    if (d.branchId === null) return null;
    try {
      const set = await branchSet(d);
      const count =
        set.ids !== undefined && hasPermission(d.ctx, 'fleetVehicle.view')
          ? await fleetVehicleRepository.countLive(set.ids)
          : null;
      return { ...set.scope, count };
    } catch (err) {
      logger.error({ err, read: 'now' }, 'fleet dashboard vehicle scope failed');
      return null;
    }
  }
}

export const fleetDashboardNowService = new FleetDashboardNowService();
