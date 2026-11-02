// R2 · `GET /fleet/dashboard/period` — tabs 6–10, a period's figures over the vehicle set (plan §5.2).
//
// The period is R-01's (`periodOf` on the request's Cairo `today`), echoed with its granularity so the
// browser labels and links from the echo, never from its own clock. The vehicle set (R-13) is echoed
// as FILTERS; each section then calls its owning module with the same query its linked screen sends
// (D9): `from`/`to` as the page sends them, `vehicleCodes`/`typeIds`/`operationIds` as given, and
// `branchIds = [activeBranchId]` when the switcher names a branch. Each module resolves that query
// exactly as its screen does, so a figure equals its link by construction.
import {
  FLEET_DASHBOARD_ACCIDENT_ROWS,
  FleetSettingKeys,
  fleetAccidentRemaining,
  periodGranularity,
  periodOf,
  ymdOf,
  ymdToUtcDate,
  type FleetAccidentStatus,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodQuery,
  type FleetDashboardPeriodSection,
  type FleetDashboardVehicleScopeDto,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { hasPermission, type AuthContext } from '../../../shared/types';
import { fleetAccidentService } from '../accidents/accident.service';
import { fleetDealershipService } from '../dealership/dealership.service';
import { culpritIdsOf } from '../fleet.mappers';
import { DEALERSHIP_BACKFILL_FROM } from '../go-live/dealership-backfill-plan';
import { fleetMaintenanceService } from '../maintenance/maintenance.service';
import { fleetOdometerService } from '../odometer/odometer.service';
import { fleetReceiptService } from '../receipts/receipt.service';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { vehicleSet, withVehicleFilterMemo } from '../vehicles/vehicle-set';
import { dashboardContext, type DashboardContext } from './dashboard-context';
import { runSections, section, type DashboardSection } from './dashboard-sections';

type PeriodValues = { [K in FleetDashboardPeriodSection]: NonNullable<FleetDashboardPeriodDto[K]> };

/** What every period section reads: the resolved range and the screens' own filter. */
export interface PeriodInput {
  range: { from: string; to: string };
  /**
   * A vehicle set narrows (codes, type, operation or the switcher's branch) — read from the QUERY,
   * so no section waits on (or fails with) the set's resolution: each owning module resolves the
   * filter itself, as its screen does.
   */
  setNarrows: boolean;
  /** The screen-shaped vehicle filter (D9, D10). */
  filter: {
    vehicleCodes?: string[];
    typeIds?: string[];
    operationIds?: string[];
    branchIds?: string[];
  };
}

/** The filter the linked screens send for this query and switcher branch (D9). */
export const screenFilter = (
  query: Pick<FleetDashboardPeriodQuery, 'vehicleCodes' | 'typeIds' | 'operationIds'>,
  branchId: string | null,
): PeriodInput['filter'] => ({
  ...(query.vehicleCodes === undefined ? {} : { vehicleCodes: query.vehicleCodes }),
  ...(query.typeIds === undefined ? {} : { typeIds: query.typeIds }),
  ...(query.operationIds === undefined ? {} : { operationIds: query.operationIds }),
  ...(branchId === null ? {} : { branchIds: [branchId] }),
});

/** A money sum of two figures, to the piastre (never a float tail on the card). */
const addMoney = (a: number, b: number): number => Math.round((a + b) * 100) / 100;

/** The bounds as the period pages send them: the days themselves, read as dates. */
const dated = (p: PeriodInput) => ({
  from: ymdToUtcDate(p.range.from),
  to: ymdToUtcDate(p.range.to),
  ...p.filter,
});

const periodSections = (
  p: PeriodInput,
): { [K in FleetDashboardPeriodSection]: DashboardSection<K, PeriodValues[K]> } => ({
  // T6.1/T6.2, tabs 7–8 — R-14…R-17 in the odometer module, one function with its summary.
  km: section('km', 'company+set', async (d) =>
    fleetOdometerService.kmBreakdown(
      { from: p.range.from, to: p.range.to, ...p.filter },
      {
        today: d.today,
        staleDays: await d.setting<number>(FleetSettingKeys.OdometerMissingReadingDays),
        branchId: d.branchId,
        setNarrows: p.setNarrows,
      },
    ),
  ),

  // T6.3/T6.4, tab 9 — R-18 over the maintenance list's own filter (check-in day in the period).
  visits: section('visits', 'company+set', () => fleetMaintenanceService.visitBreakdown(dated(p))),

  // T6.5/T6.6, T10.2 — R-23: the period's files, and of them the open ones now («حتى الآن»).
  accidents: section('accidents', 'company+set', async () => {
    const query = dated(p);
    const [all, open, undated] = await Promise.all([
      fleetAccidentService.summaryOver(query),
      fleetAccidentService.summaryOver({ ...query, status: 'open' }),
      // Undated files never enter a period; the company view names them («حوادث بلا تاريخ»).
      p.setNarrows ? Promise.resolve(null) : fleetAccidentService.undatedCount({}),
    ]);
    return { count: all.count, open: open.count, openRemaining: open.remaining, undated };
  }),

  // T10.1 — the accidents screen's own list, newest accident first, then «+M».
  accidentList: section('accidentList', 'company+set', async () => {
    const page = await fleetAccidentService.list({
      ...dated(p),
      page: 1,
      pageSize: FLEET_DASHBOARD_ACCIDENT_ROWS,
      sortBy: 'occurredAt',
      sortDir: 'desc',
    });
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(
        page.items.flatMap((doc) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)])),
      ),
    ]);
    const rows = page.items.map((doc) => {
      const vehicleId = doc.vehicleId == null ? null : String(doc.vehicleId);
      return {
        accidentId: String(doc._id),
        vehicleId,
        code: (vehicleId === null ? undefined : codes.get(vehicleId)) ?? doc.vehicleCode ?? '—',
        // A period's files are dated by construction (`from` bounds the accident day).
        date: doc.occurredAt === null ? p.range.from : ymdOf(doc.occurredAt),
        culprit: doc.culprit ?? null,
        culpritEmployeeIds: culpritIdsOf({
          culpritEmployeeId: doc.culpritEmployeeId ?? null,
          ...(doc.culpritEmployeeIds === undefined
            ? {}
            : { culpritEmployeeIds: doc.culpritEmployeeIds }),
        }),
        status: doc.status as FleetAccidentStatus,
        remaining: fleetAccidentRemaining(doc),
      };
    });
    return { rows, more: Math.max(0, page.meta.totalItems - rows.length) };
  }),

  // T6.7/T6.8, R-19/R-21 — card and custody receipts, never added to the dealership figure.
  opex: section('opex', 'company+set', async () => {
    const [totals, dataFrom] = await Promise.all([
      fleetReceiptService.summaryOver(dated(p)),
      fleetReceiptService.firstReceiptDate(),
    ]);
    return {
      card: totals.cardTotal,
      custody: totals.custodyTotal,
      total: addMoney(totals.cardTotal, totals.custodyTotal),
      count: totals.count,
      dataFrom,
    };
  }),

  // T6.9, R-20/R-21 — rows by the car's exit day; the data starts at the backfill's first day.
  dealership: section('dealership', 'company+set', async () => {
    const totals = await fleetDealershipService.summaryOver(dated(p));
    return {
      amount: totals.dealershipTotal,
      rows: totals.count,
      pending: totals.pending,
      dataFrom: DEALERSHIP_BACKFILL_FROM,
    };
  }),
});

class FleetDashboardPeriodService {
  /** `now` is the controller's one clock; `query` is already validated by the schema. */
  async read(
    ctx: AuthContext,
    now: Date,
    query: FleetDashboardPeriodQuery,
  ): Promise<FleetDashboardPeriodDto> {
    // Six modules resolve the same «type / operation / branch» filter, each as its screen does;
    // inside one read the registry answers each narrowing once.
    return withVehicleFilterMemo(() => this.compose(ctx, now, query));
  }

  private async compose(
    ctx: AuthContext,
    now: Date,
    query: FleetDashboardPeriodQuery,
  ): Promise<FleetDashboardPeriodDto> {
    const d = dashboardContext(ctx, now);
    const custom =
      query.preset === 'custom' && query.from !== undefined && query.to !== undefined
        ? { from: query.from, to: query.to }
        : undefined;
    const range = periodOf(query.preset, d.today, custom);
    const filter = screenFilter(query, d.branchId);
    const input: PeriodInput = { range, setNarrows: Object.keys(filter).length > 0, filter };
    const [{ values, unavailable }, vehicleScope] = await Promise.all([
      runSections(
        'period',
        d,
        Object.values(periodSections(input)) as readonly DashboardSection<
          FleetDashboardPeriodSection,
          unknown
        >[],
      ),
      this.scopeEcho(d, query),
    ]);
    const v = values as { [K in FleetDashboardPeriodSection]: PeriodValues[K] | null };
    return {
      today: d.today,
      asOf: now.toISOString(),
      range: {
        preset: range.preset,
        from: range.from,
        to: range.to,
        days: range.days,
        granularity: periodGranularity({
          from: ymdToUtcDate(range.from),
          to: ymdToUtcDate(range.to),
        }),
      },
      vehicleScope,
      ...v,
      unavailable,
    };
  }

  /**
   * R-13's echo: the FILTERS the links are built from, always; the car count only for a reader of
   * the registry (`fleetVehicle.view`, deleted cars left out). A failure to resolve the set costs
   * the count, never the read (the sections run on the query, not on the set).
   */
  private async scopeEcho(
    d: DashboardContext,
    query: FleetDashboardPeriodQuery,
  ): Promise<FleetDashboardVehicleScopeDto> {
    const f = {
      vehicleCodes: query.vehicleCodes,
      typeIds: query.typeIds,
      operationIds: query.operationIds,
    };
    try {
      return (await vehicleSet(f, d.branchId, { count: hasPermission(d.ctx, 'fleetVehicle.view') }))
        .scope;
    } catch (err) {
      logger.error({ err, read: 'period' }, 'fleet dashboard vehicle scope failed');
      return {
        count: null,
        typeIds: [...(f.typeIds ?? [])],
        operationIds: [...(f.operationIds ?? [])],
        vehicleCodes: [...(f.vehicleCodes ?? [])],
        branchId: d.branchId,
      };
    }
  }
}

export const fleetDashboardPeriodService = new FleetDashboardPeriodService();
