// The vehicle checks dashboard's rules (FR-21) — «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند
// الـ IT», and on 2026-11-10, of the approved sample, «تمام نفذا الـ Dashboard بتاعت الفحص».
//
// Pure on purpose: the window, which cars a reader sees, each car's latest report, the faults, the
// overdue cars and what every filter means are decided here and pinned by this folder's spec; the
// service only reads. Derived on every read — no collection and no stored figure, like the IT
// home dashboard (`../dashboard/dashboard-rules.ts`).
import { Types, type FilterQuery } from 'mongoose';
import {
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_OVERDUE_DAYS,
  addDaysYmd,
  daysBetweenYmd,
  ymdToUtcDate,
  type ItVehicleCheckAnswer,
  type ItVehicleCheckDashboardDto,
  type ItVehicleCheckDashboardQuery,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
  type ItVehicleCheckOverdueDto,
  type ListItVehicleChecksQuery,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { type ItVehicleOnBoard } from '../fleet-boundary';
import { registerSearchPattern } from '../shared/register-search';
import { type ItVehicleCheckDoc } from './vehicle-check.model';

/** The days the period figures cover, `YYYY-MM-DD`, both ends included. */
export interface VehicleCheckWindow {
  from: string;
  to: string;
}

/**
 * The dashboard's window. No `to` is today in Cairo, and a `to` after today is today — a report is
 * never filed for a later day, so a later end would only make the window look longer than what it
 * counts. No `from` is the «لم تُفحص منذ ٧ أيام» window ending at `to`: seven days, `to` included.
 * A `from` after the (clamped) `to` is kept as asked, and the window then holds no report.
 */
export const dashboardWindow = (
  query: Pick<ItVehicleCheckDashboardQuery, 'from' | 'to'>,
  today: string,
): VehicleCheckWindow => {
  const to = query.to === undefined || query.to > today ? today : query.to;
  const from = query.from ?? addDaysYmd(to, -(IT_VEHICLE_CHECK_OVERDUE_DAYS - 1));
  return { from, to };
};

/**
 * The branches whose cars a reader's `itVehicleCheck.view` selector reaches, by the car's CURRENT
 * branch — `'all'` for an organization-wide reader.
 *
 * Decided from the selector, never from a filter the reader sent: the reach lists when the grant
 * names units beyond home (whole branches, and the branches its department copies sit in — the
 * branch-only reading `orgScopeMatch` gives a collection like this one), else the home branch.
 * Department and section grants narrow to the home branch, as the dashboards' `finerNarrowsToBranch`
 * does: a car carries a branch and nothing finer, and a section head sees their site's cars, not
 * the company's. `own` — the roles screen's default — reaches no car: a car is nobody's own, and a
 * reader placed in no branch reaches none either (fail closed).
 */
export const carReachOf = (scope: ScopeSelector): 'all' | ReadonlySet<string> => {
  if (scope.scope === 'organization') return 'all';
  if (scope.scope === 'own') return new Set();
  const branchIds = scope.branchIds ?? [];
  const departmentIds = scope.departmentIds ?? [];
  if (branchIds.length > 0 || departmentIds.length > 0) {
    return new Set([
      ...branchIds,
      ...(departmentIds.length > 0 ? (scope.departmentBranchIds ?? []) : []),
    ]);
  }
  return scope.branchId === null ? new Set() : new Set([scope.branchId]);
};

/**
 * The active cars a reader sees — under their scope first, then narrowed to the branch filter.
 * The filter only ever narrows: a branch outside the reach leaves no car, never that branch's.
 * Fleet's code order is kept, since every panel lists the cars in it.
 */
export const carsVisibleTo = (
  cars: readonly ItVehicleOnBoard[],
  scope: ScopeSelector,
  branchId?: string,
): ItVehicleOnBoard[] => {
  const reach = carReachOf(scope);
  return cars.filter(
    (car) =>
      (reach === 'all' || (car.branchId !== null && reach.has(car.branchId))) &&
      (branchId === undefined || car.branchId === branchId),
  );
};

/** The list filters the screen sends, without the page. */
export type VehicleCheckListFilters = Omit<
  ListItVehicleChecksQuery,
  'page' | 'pageSize' | 'sortBy' | 'sortDir'
>;

/**
 * What the reports list's filters mean, every one ANDed (the dashboard's window and branch read
 * through the same function, so a figure and the list it opens agree):
 * - `from` / `to`: the Cairo days on `checkDate`, both ends included — the day is stored as that
 *   day's UTC midnight, so the bounds are the days themselves;
 * - `branchId`: the REPORT's branch — the car's branch at filing, the data-scope anchor;
 * - `vehicleId`: one car, whatever its code was when each report was filed;
 * - `carCode`: «كود السيارة» typed — anywhere in the code at filing, any digit set, letter case
 *   ignored, everything else literal (`registerSearchPattern`); nothing left to match is no filter;
 * - `faultsOnly`: a report with any device «لا يعمل»; `false` is every report;
 * - `device`: a report where THAT device is «لا يعمل» — the bar the reader clicked.
 */
export const vehicleCheckListFilter = (
  filters: VehicleCheckListFilters,
): FilterQuery<ItVehicleCheckDoc> => {
  const filter: Record<string, unknown> = {};
  if (filters.from !== undefined || filters.to !== undefined) {
    filter.checkDate = {
      ...(filters.from === undefined ? {} : { $gte: ymdToUtcDate(filters.from) }),
      ...(filters.to === undefined ? {} : { $lte: ymdToUtcDate(filters.to) }),
    };
  }
  if (filters.branchId !== undefined) filter.branchId = new Types.ObjectId(filters.branchId);
  if (filters.vehicleId !== undefined) filter.vehicleId = new Types.ObjectId(filters.vehicleId);
  const code = filters.carCode === undefined ? null : registerSearchPattern(filters.carCode);
  if (code !== null) filter.vehicleCode = code;
  if (filters.device !== undefined) filter[`items.${filters.device}`] = 'notWorking';
  if (filters.faultsOnly === true) {
    filter.$or = IT_VEHICLE_CHECK_ITEMS.map((item) => ({ [`items.${item}`]: 'notWorking' }));
  }
  return filter as FilterQuery<ItVehicleCheckDoc>;
};

/**
 * The reports the «آخر تقرير» reduction reads: the visible cars' (which also lets the latest-per-
 * car index answer it), under the branch filter on the REPORT's branch. Not the window: a car's
 * latest report is its latest whenever it was filed.
 */
export const latestReportsFilter = (
  cars: readonly ItVehicleOnBoard[],
  branchId?: string,
): FilterQuery<ItVehicleCheckDoc> => ({
  ...vehicleCheckListFilter(branchId === undefined ? {} : { branchId }),
  vehicleId: { $in: cars.map((car) => new Types.ObjectId(car.id)) },
});

/**
 * Each car's latest report, kept only for the cars listed and in THEIR order (Fleet's code order).
 * A report on a car not listed — out of service now, disposed, or outside the reader's cars —
 * is not a row of the matrix.
 */
export const latestOfCars = <R extends { vehicleId: string }>(
  cars: readonly ItVehicleOnBoard[],
  latest: readonly R[],
): R[] => {
  const byCar = new Map(latest.map((report) => [report.vehicleId, report]));
  return cars.flatMap((car) => {
    const report = byCar.get(car.id);
    return report === undefined ? [] : [report];
  });
};

type Answers = Readonly<Record<ItVehicleCheckItem, ItVehicleCheckAnswer | null>>;

const hasFault = (items: Answers): boolean =>
  IT_VEHICLE_CHECK_ITEMS.some((item) => items[item] === 'notWorking');

/**
 * «الأعطال حسب الجهاز» over the latest reports: for each device the cars whose latest report has it
 * «لا يعمل»; the cars with any; and the devices summed («أجهزة لا تعمل»). A car fixed since — its
 * newer report «يعمل» — counts no more.
 */
export const faultFigures = (
  latest: readonly { items: Answers }[],
): {
  faultsByDevice: Record<ItVehicleCheckItem, number>;
  carsWithFaults: number;
  devicesNotWorking: number;
} => {
  const faultsByDevice = Object.fromEntries(
    IT_VEHICLE_CHECK_ITEMS.map((item) => [
      item,
      latest.filter((report) => report.items[item] === 'notWorking').length,
    ]),
  ) as Record<ItVehicleCheckItem, number>;
  return {
    faultsByDevice,
    carsWithFaults: latest.filter((report) => hasFault(report.items)).length,
    devicesNotWorking: Object.values(faultsByDevice).reduce((sum, n) => sum + n, 0),
  };
};

/**
 * «سيارات لم تُفحص منذ ٧ أيام»: the cars whose latest report is for a day before the last
 * `IT_VEHICLE_CHECK_OVERDUE_DAYS` days (today included), or who have none. `daysSince` is whole
 * Cairo days from that day to today. A car never checked comes first — it has waited longest of
 * all — then the longest unchecked, then Fleet's code order.
 */
export const overdueCars = (
  cars: readonly ItVehicleOnBoard[],
  latest: readonly { vehicleId: string; checkDate: string }[],
  today: string,
): ItVehicleCheckOverdueDto[] => {
  const since = addDaysYmd(today, -(IT_VEHICLE_CHECK_OVERDUE_DAYS - 1));
  const lastDay = new Map(latest.map((report) => [report.vehicleId, report.checkDate]));
  const rows = cars.flatMap((car, order) => {
    const last = lastDay.get(car.id) ?? null;
    if (last !== null && last >= since) return [];
    const row: ItVehicleCheckOverdueDto = {
      vehicleId: car.id,
      vehicleCode: car.code,
      branchId: car.branchId,
      lastCheckDate: last,
      daysSince: last === null ? null : daysBetweenYmd(last, today),
    };
    return [{ row, order }];
  });
  rows.sort((a, b) => {
    const left = a.row.daysSince;
    const right = b.row.daysSince;
    if (left !== right) {
      if (left === null) return -1;
      if (right === null) return 1;
      return right - left;
    }
    return a.order - b.order;
  });
  return rows.map(({ row }) => row);
};

/**
 * The window's own figures, read in one pass over the reports filed for a day in it. The cars
 * come back as their ids, not a count: which of them the tile may count is the visible cars'
 * question, answered by `carsCheckedOf` — the read runs beside Fleet's, before the cars are known.
 */
export interface VehicleCheckWindowFigures {
  reports: number;
  reporters: number;
  /** The distinct cars those reports are on — every one, whether active and visible or not. */
  vehicleIds: readonly string[];
  reportsWithoutPhoto: number;
}

/**
 * «سيارات فُحصت»: the window's cars counted among the visible active cars only. The tile reads
 * «X من Y سيارة نشطة» against `activeCars`, so a car out of service now (checked before it left)
 * or one beyond the reader's cars would make X count what Y does not — «١ من ٤» with no active car
 * checked, or a section reader's «١٥٠ من ١٢». The reports, reporters and photo-less reports stay
 * every visible report's: those tiles name no car.
 */
export const carsCheckedOf = (
  cars: readonly ItVehicleOnBoard[],
  vehicleIds: readonly string[],
): number => {
  const checked = new Set(vehicleIds);
  return cars.filter((car) => checked.has(car.id)).length;
};

/** The dashboard from its reads: the window, the visible cars, their latest reports, the period. */
export const buildVehicleCheckDashboard = (input: {
  window: VehicleCheckWindow;
  today: string;
  cars: readonly ItVehicleOnBoard[];
  latest: readonly ItVehicleCheckLatestDto[];
  period: VehicleCheckWindowFigures;
}): ItVehicleCheckDashboardDto => {
  const latest = latestOfCars(input.cars, input.latest);
  const faults = faultFigures(latest);
  const overdue = overdueCars(input.cars, latest, input.today);
  return {
    from: input.window.from,
    to: input.window.to,
    totals: {
      reports: input.period.reports,
      reporters: input.period.reporters,
      carsChecked: carsCheckedOf(input.cars, input.period.vehicleIds),
      reportsWithoutPhoto: input.period.reportsWithoutPhoto,
      activeCars: input.cars.length,
      carsWithFaults: faults.carsWithFaults,
      devicesNotWorking: faults.devicesNotWorking,
      overdueCars: overdue.length,
    },
    faultsByDevice: faults.faultsByDevice,
    latest,
    overdue,
    overdueDays: IT_VEHICLE_CHECK_OVERDUE_DAYS,
  };
};
