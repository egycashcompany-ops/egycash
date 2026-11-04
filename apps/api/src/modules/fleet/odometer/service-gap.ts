// «فارق عداد الصيانة» AT EACH READING (batch 3, D1) — SERVER-derived, never stored.
//
// «مش بيخصم الكيلومترات اللى بتخش كل يوم بيجيب الفرق ويسجل القراء مش بيزود على فارق الصيانه».
// The odometer page used to print the car's CURRENT figure on every one of its rows, so a month of
// readings all said 5,507 and the distance never seemed to grow. Each row now carries the gap AT
// THAT READING: the row's reading less the counter of the counting service IN FORCE ON ITS DAY.
//
// ONE RULE, THE ALARM'S. Nothing here decides what a service or a counter is:
//   • the service in force is the latest closed, alarm-counting, live visit checked out STRICTLY
//     before the row's day, in `alarmBaselines`' own order (check-out, then `_id`, newest first) —
//     so a row read on the service day itself is still measured from the service before, exactly
//     as the alarm calls a reading of that day «older than the service»;
//   • the counter is chosen by `measureFromVisit` through `computeAlarm`, with the bounds of THAT
//     visit asked by the alarm's own `visitBounds` (R3, R4), and the row's reading standing where
//     the car's latest reading stands for the alarm;
//   • the row's reading is its EFFECTIVE one, `max(out, in ?? out)` — how far the car had got by
//     the end of that row, the figure `latestReadings` reports for the row it picks.
// So the row the alarm measured (`latestReadingLogId`) carries exactly the alarm's `sinceServiceKm`
// whenever the alarm computed one, and every earlier row the figure the alarm would have shown that
// day.
//
// `null` — nothing honest to show — for a row with no car, a day recorded without a reading, a car
// the alarm does not cover (not active, or its make has no «مسافة الصيانة»), no counting service
// before the row's day, or a counter the alarm would refuse.
//
// The pure half (`serviceGapOf`) is tested without a database; `loadServiceGaps` gathers its inputs
// for a page of rows in a handful of queries, bounded by the page, never by the fleet.
import {
  computeAlarm,
  NO_BOUNDS,
  visitBounds,
  type VisitBounds,
} from '../maintenance/maintenance-alarm';
import { measureFromVisit } from '../maintenance/measure-from-visit';
import {
  fleetMaintenanceRepository,
  type CountingVisit,
} from '../maintenance/maintenance.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';

/** The fields of a log row the gap reads. Structural, so a lean document or a test literal will do. */
export interface GapRow {
  _id: { toString(): string };
  vehicleId: { toString(): string } | null;
  date: Date;
  outReading: number | null;
  inReading: number | null;
}

/** Everything the rule needs about the cars on a page — gathered by `loadServiceGaps`. */
export interface GapWorld {
  /**
   * The make's «مسافة الصيانة» of each car the alarm COVERS, by vehicle id. A car missing here — not
   * active, or a make with no interval — is outside the alarm, and its rows carry no figure.
   */
  intervals: ReadonlyMap<string, number>;
  /** Each car's counting visits, newest check-out first (`outDate`, then `_id`, descending). */
  visits: ReadonlyMap<string, readonly CountingVisit[]>;
  /** The chain points each visit's counters are judged against, by visit id. */
  bounds: ReadonlyMap<string, VisitBounds>;
}

/** Midnight UTC of the day `on` names — dates are stored as days, as the repositories cut them. */
const dayStart = (on: Date): number =>
  Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());

/** How far the car had got by the end of this row; `null` on a day recorded without a reading. */
export const rowReading = (row: Pick<GapRow, 'outReading' | 'inReading'>): number | null =>
  row.outReading === null ? null : Math.max(row.outReading, row.inReading ?? row.outReading);

/**
 * The service IN FORCE on a day: the first visit (newest check-out first) checked out strictly
 * before that day. `null` before the car's first counting service.
 */
export const visitInForce = (visits: readonly CountingVisit[], on: Date): CountingVisit | null => {
  const day = dayStart(on);
  return visits.find((visit) => visit.outDate.getTime() < day) ?? null;
};

/** One row's gap — the alarm's arithmetic, asked about this row's reading on this row's day. */
export const serviceGapOf = (row: GapRow, world: GapWorld): number | null => {
  const reading = rowReading(row);
  if (row.vehicleId === null || reading === null) return null;
  const car = row.vehicleId.toString();
  const intervalKm = world.intervals.get(car);
  if (intervalKm === undefined) return null;
  const visit = visitInForce(world.visits.get(car) ?? [], row.date);
  if (visit === null) return null;
  const { result } = measureFromVisit(
    computeAlarm,
    {
      intervalKm,
      // The level is not asked here, only the distance; the thresholds move nothing in it.
      yellowKm: 0,
      redKm: 0,
      latestReading: reading,
      latestReadingDate: row.date,
    },
    { ...visit, ...(world.bounds.get(visit.visitId) ?? NO_BOUNDS) },
  );
  return result.sinceServiceKm;
};

/** The gap of every row, keyed by row id — `null` where `serviceGapOf` says so. */
export const serviceGapsOf = (
  rows: readonly GapRow[],
  world: GapWorld,
): Map<string, number | null> =>
  new Map(rows.map((row) => [row._id.toString(), serviceGapOf(row, world)]));

const groupByCar = <T extends { vehicleId: string }>(items: readonly T[]): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.vehicleId);
    if (group === undefined) groups.set(item.vehicleId, [item]);
    else group.push(item);
  }
  return groups;
};

/**
 * The chain points of the visits a page needs. `visitBounds` answers ONE visit per car per call
 * (the repository keys by car), and a page can fall under two services of one car — a month that
 * holds a service day — so the visits are asked in rounds: the first needed visit of every car,
 * then the second, all rounds at once. A page needs one round, rarely two.
 */
const boundsOf = async (visits: readonly CountingVisit[]): Promise<Map<string, VisitBounds>> => {
  const rounds: CountingVisit[][] = [];
  for (const group of groupByCar(visits).values()) {
    group.forEach((visit, round) => {
      (rounds[round] ??= []).push(visit);
    });
  }
  const answers = await Promise.all(rounds.map((round) => visitBounds(round)));
  return new Map(answers.flatMap((answer) => [...answer]));
};

/**
 * The gap of every row of a page (D1), gathered in a handful of queries: the cars, their makes,
 * the counting work types, the counting visits before the page's newest day, and the bounds of the
 * visits some row actually falls under. Rows that cannot carry a figure ask nothing.
 */
export const loadServiceGaps = async (
  rows: readonly GapRow[],
): Promise<Map<string, number | null>> => {
  const none = new Map(rows.map((row) => [row._id.toString(), null as number | null]));
  const measured = rows.filter((row) => row.vehicleId !== null && row.outReading !== null);
  if (measured.length === 0) return none;

  // The alarm's scope: ACTIVE, live cars whose make has an interval — as `computeAlarms` reads it.
  // The cars, the makes and the counting work types in ONE round trip: every live make (a handful,
  // read whole as `computeAlarms` reads them) rather than the cars' makes once the cars are in,
  // which was a second round trip before the visits could even be asked. A deleted make has no
  // interval — it is not among the live ones.
  const carIds = [...new Set(measured.map((row) => String(row.vehicleId)))];
  const [found, makes, countingIds] = await Promise.all([
    fleetVehicleRepository.findByIdsSystem(carIds),
    fleetVehicleTypeRepository.listAll(),
    fleetCatalogItemRepository.countingWorkTypeIds(),
  ]);
  const cars = found.filter((car) => !car.isDeleted && car.status === 'active');
  const byMake = new Map(makes.map((make) => [String(make._id), make.maintenanceIntervalKm ?? 0]));
  const intervals = new Map<string, number>();
  for (const car of cars) {
    const intervalKm = byMake.get(String(car.typeId)) ?? 0;
    if (intervalKm > 0) intervals.set(String(car._id), intervalKm);
  }
  if (intervals.size === 0) return none;

  // Every counting visit of those cars checked out before the newest day on the page — the only
  // ones a row on it can fall under.
  const newestDay = measured.reduce((max, row) => Math.max(max, dayStart(row.date)), 0);
  const visits = groupByCar(
    await fleetMaintenanceRepository.countingVisitsOf(
      [...intervals.keys()],
      countingIds,
      new Date(newestDay),
    ),
  );

  // …and only the ones some row actually falls under need their chain points.
  const needed = new Map<string, CountingVisit>();
  for (const row of measured) {
    const visit = visitInForce(visits.get(String(row.vehicleId)) ?? [], row.date);
    if (visit !== null) needed.set(visit.visitId, visit);
  }
  const bounds = await boundsOf([...needed.values()]);
  return serviceGapsOf(rows, { intervals, visits, bounds });
};
