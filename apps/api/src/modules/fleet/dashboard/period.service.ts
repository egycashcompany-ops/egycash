// R2 · `GET /fleet/dashboard/period` — tabs 6–10, a period's figures over the vehicle set (plan §5.2).
//
// The period is R-01's (`periodOf` on the request's Cairo `today`), echoed with its granularity so the
// browser labels and links from the echo, never from its own clock. The vehicle set (R-13) is echoed
// as FILTERS; each section then calls its owning module with the same query its linked screen sends
// (D9): `from`/`to` as the page sends them, `vehicleCodes`/`typeIds`/`operationIds` as given, and
// `branchIds` = the reader's branches (`DashboardContext.branchIds`: the switcher's branch, the
// reader's only branch, or «كل فروعي»; nothing for the whole company). Each module resolves that
// query exactly as its screen does, so a figure equals its link by construction.
import {
  FLEET_DASHBOARD_ACCIDENT_ROWS,
  FLEET_DASHBOARD_DEALERSHIP_ROWS,
  FLEET_DASHBOARD_VIOLATION_ROWS,
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
  type LocalizedString,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { hasPermission, type AuthContext } from '../../../shared/types';
import { fleetAccidentService } from '../accidents/accident.service';
import { fleetDealershipService } from '../dealership/dealership.service';
import { culpritIdsOf } from '../fleet.mappers';
import { DEALERSHIP_BACKFILL_FROM } from '../go-live/dealership-backfill-plan';
import { fleetLicenseExpenseService } from '../license-expenses/license-expense.service';
import { fleetMaintenanceService } from '../maintenance/maintenance.service';
import { fleetOdometerService } from '../odometer/odometer.service';
import { fleetReceiptService } from '../receipts/receipt.service';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { vehicleSet, withVehicleFilterMemo } from '../vehicles/vehicle-set';
import { fleetViolationService } from '../violations/violation.service';
import { dashboardContext, scopeBranchesOf, type DashboardContext } from './dashboard-context';
import { runSections, section, type DashboardSection } from './dashboard-sections';

type PeriodValues = { [K in FleetDashboardPeriodSection]: NonNullable<FleetDashboardPeriodDto[K]> };

/** What every period section reads: the resolved range and the screens' own filter. */
export interface PeriodInput {
  range: { from: string; to: string };
  /** The range's slots — days, or months for a long range — as the echo states them. */
  granularity: 'day' | 'month';
  /**
   * A vehicle set narrows (codes, type, operation or the reader's branches) — read from the QUERY,
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

/**
 * The filter the linked screens send for this query and the reader's branches (D9): `null` = the
 * whole company, no branch clause; a list (one branch, «كل فروعي», or `[]`, which narrows to
 * nothing) travels as `branchIds`, which every linked screen reads as a list.
 */
export const screenFilter = (
  query: Pick<FleetDashboardPeriodQuery, 'vehicleCodes' | 'typeIds' | 'operationIds'>,
  branchIds: readonly string[] | null,
): PeriodInput['filter'] => ({
  ...(query.vehicleCodes === undefined ? {} : { vehicleCodes: query.vehicleCodes }),
  ...(query.typeIds === undefined ? {} : { typeIds: query.typeIds }),
  ...(query.operationIds === undefined ? {} : { operationIds: query.operationIds }),
  ...(branchIds === null ? {} : { branchIds: [...branchIds] }),
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
        // «حسب النوع» is drawn for exactly ONE branch in scope — the switcher's, or a reader's only
        // branch (D10); never for the company or «كل فروعي».
        byType: d.branchIds?.length === 1,
        setNarrows: p.setNarrows,
      },
    ),
  ),

  // «الصيانة والورش» (every period figure) and the overview's «زيارات الصيانة» (D6) — the visits that
  // LEFT the workshop in the period, by the maintenance list's own filter over `outFrom`/`outTo`
  // (the EXIT day), never `from`/`to` (the check-in day, which no tab counts by).
  exits: section('exits', 'company+set', () =>
    fleetMaintenanceService.exitBreakdown({
      outFrom: ymdToUtcDate(p.range.from),
      outTo: ymdToUtcDate(p.range.to),
      ...p.filter,
    }),
  ),

  // T6.5/T6.6, T10.2 — R-23: the period's files, and of them the open ones now («حتى الآن»).
  accidents: section('accidents', 'company+set', async () => {
    const query = dated(p);
    const [all, open, undated] = await Promise.all([
      fleetAccidentService.summaryOver(query),
      fleetAccidentService.summaryOver({ ...query, status: 'open' }),
      // Undated files never enter a period; the company view names them («حوادث بلا تاريخ»).
      p.setNarrows ? Promise.resolve(null) : fleetAccidentService.undatedCount({}),
    ]);
    // «مبالغ ملفات حوادث الفترة» — the period's files' sums (open AND closed, as they are now),
    // the register's «الإحصائيات» over the same filter: `all` itself, no new query.
    const { count, ...totals } = all;
    return { count, open: open.count, undated, totals };
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
    // The listed files' cars (code and make id, deleted ones included — their files are history),
    // then their makes: one read each, none when no file has a car.
    const cars = await fleetVehicleRepository.findByIdsSystem([
      ...new Set(
        page.items.flatMap((doc) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)])),
      ),
    ]);
    const carOf = new Map(cars.map((car) => [String(car._id), car]));
    const typeIds = [...new Set(cars.map((car) => String(car.typeId)))];
    const types =
      typeIds.length === 0 ? [] : await fleetVehicleTypeRepository.findByIdsSystem(typeIds);
    const makes = new Map(types.map((type) => [String(type._id), type.name as LocalizedString]));
    const rows = page.items.map((doc) => {
      const vehicleId = doc.vehicleId == null ? null : String(doc.vehicleId);
      const car = vehicleId === null ? undefined : carOf.get(vehicleId);
      return {
        accidentId: String(doc._id),
        vehicleId,
        code: car?.code ?? doc.vehicleCode ?? '—',
        typeName: car?.typeId == null ? null : (makes.get(String(car.typeId)) ?? null),
        // A period's files are dated by construction (`from` bounds the accident day).
        date: doc.occurredAt === null ? p.range.from : ymdOf(doc.occurredAt),
        // «البيان» verbatim — '' on a file the old book kept without one.
        statement: doc.statement ?? '',
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

  // «مخالفات السائقين في الفترة» — the DRIVERS' fines by the fine's day (whole days), their states
  // now, and by type: the register's own `kind=driver&from&to` over the same vehicle set. A company
  // statement carries a year, never a day, so it is never in a period.
  violations: section('violations', 'company+set', () =>
    fleetViolationService.periodDigest(dated(p)),
  ),

  // …and the register's first page of them, newest fine day first, then «+M».
  violationList: section('violationList', 'company+set', () =>
    fleetViolationService.dashboardRows(dated(p), FLEET_DASHBOARD_VIOLATION_ROWS),
  ),

  // T6.7/T6.8, R-19/R-21 — card and custody receipts, never added to the dealership figure.
  opex: section('opex', 'company+set', async () => {
    const [totals, dataFrom] = await Promise.all([
      fleetReceiptService.summaryOver(dated(p)),
      fleetReceiptService.firstReceiptDate(),
    ]);
    return {
      card: totals.cardTotal,
      custody: totals.custodyTotal,
      // «مصروف الوقود» — the fuel receipts of either payer, the receipts screen's `kind=fuel` total.
      fuel: totals.fuelTotal,
      total: addMoney(totals.cardTotal, totals.custodyTotal),
      count: totals.count,
      dataFrom,
      // «مصروف التشغيل حسب النوع» — the same totals by kind (card receipts are fuel only, so
      // card + fuelCustody + tyres + wash + maintenance = total), and «نحو N لترًا» with the fuel
      // receipts that carry no litre price beside it.
      fuelCustody: totals.fuelCustodyTotal,
      tyres: totals.tyresTotal,
      wash: totals.washTotal,
      maintenance: totals.maintenanceTotal,
      litres: Math.round(totals.fuelLitres),
      unpricedFuel: totals.fuelUnpriced,
      // «N إيصالًا» on «العهدة»'s «مصروفات العهدة»: the custody-paid receipts of the same rows.
      custodyCount: totals.custodyCount,
    };
  }),

  // «مصروف التشغيل يومًا بيوم» (or «شهرًا بشهر») — the same receipts by their paper day or month,
  // every slot of the range (an empty one marked), so the slots add up to `opex`.
  opexSeries: section('opexSeries', 'company+set', async () => ({
    buckets: await fleetReceiptService.seriesOver(dated(p), p.granularity),
  })),

  // «العهدة» — «منها حتى الآن»: the SAME custody receipts `opex.custody` counts (the receipts
  // screen's own query: the paper day in the range, codes / type / operation, the branch by the
  // receipt's car), put where their memo stands NOW (a held replenishment's memo still waits);
  // Σ = `opex.custody`, to the piastre.
  custodyStates: section('custodyStates', 'company+set', () =>
    fleetReceiptService.custodyStatesOver(dated(p)),
  ),

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

  // «فواتير التوكيل في الفترة» — the dealership screen's first page of the rows `dealership` counts
  // (its own order), then «+M».
  dealershipList: section('dealershipList', 'company+set', () =>
    fleetDealershipService.dashboardRows(dated(p), FLEET_DASHBOARD_DEALERSHIP_ROWS),
  ),

  // «التراخيص والتجديدات» — «مصروفات التراخيص في الفترة»: the licence-expense register over the
  // RANGE ONLY (the memo day, the register's own whole-day rule). The vehicle set never reaches a
  // memo — it carries no branch, no car type, no operation and no amount per car — so this section
  // reads the whole company whatever `p.filter` says (PAGELESS: its key never opens the page).
  licenceSpend: section('licenceSpend', 'company+set', () =>
    fleetLicenseExpenseService.periodSpend({
      from: ymdToUtcDate(p.range.from),
      to: ymdToUtcDate(p.range.to),
    }),
  ),
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
    const filter = screenFilter(query, d.branchIds);
    const granularity = periodGranularity({
      from: ymdToUtcDate(range.from),
      to: ymdToUtcDate(range.to),
    });
    const input: PeriodInput = {
      range,
      granularity,
      setNarrows: Object.keys(filter).length > 0,
      filter,
    };
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
        granularity,
      },
      vehicleScope,
      ...v,
      unavailable,
    };
  }

  /**
   * R-13's echo: the FILTERS the links are built from and the reader's branches by name
   * (`scopeBranches`, what the figures cover), always; the car count only for a reader of the
   * registry (`fleetVehicle.view`, deleted cars left out). A failure to resolve the set costs the
   * count, never the read (the sections run on the query, not on the set).
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
    const [set, scopeBranches] = await Promise.all([
      vehicleSet(f, d.branchIds, {
        count: hasPermission(d.ctx, 'fleetVehicle.view'),
        branchId: d.branchId,
      }).catch((err: unknown) => {
        logger.error({ err, read: 'period' }, 'fleet dashboard vehicle scope failed');
        return null;
      }),
      scopeBranchesOf(d),
    ]);
    if (set !== null) return { ...set.scope, scopeBranches };
    return {
      count: null,
      typeIds: [...(f.typeIds ?? [])],
      operationIds: [...(f.operationIds ?? [])],
      vehicleCodes: [...(f.vehicleCodes ?? [])],
      branchId: d.branchId,
      scopeBranches,
    };
  }
}

export const fleetDashboardPeriodService = new FleetDashboardPeriodService();
