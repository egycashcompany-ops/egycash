// The §2.9 annual rollup's PURE half: merge the aggregate sums, the grievance figures, and the
// vehicle codes into the DTO the page shows. Kept free of I/O so the merge — the part with the
// off-by-one traps (a grievance with no violations, violations with no grievance) — is
// unit-tested without a database. Everything here is derived at query time, never stored.
import { type FleetViolationRollupDto } from '@ecms/contracts';
import { type ViolationYearSums } from './violation.repository';

export interface GrievanceFigure {
  vehicleId: string;
  year: number;
  totalBeforeGrievance: number;
}

/**
 * One row per (VEHICLE, YEAR) that has anything in it — violations, a grievance, or both. A
 * grievance-only vehicle still appears (its statement was wiped by the appeal, the figure is
 * the history); a vehicle without a grievance shows 0, not null, matching the legacy page.
 *
 * The pair is the key, not the vehicle: a car's 2025 and its 2026 are two rows on the board and
 * summing them into one would report a fleet's whole history as this year's bill.
 */
const keyOf = (vehicleId: string | null, code: string | null, year: number): string =>
  `${vehicleId ?? `code:${code ?? ''}`}:${year}`;

/**
 * Does this (vehicle, year) still hold anything to show?
 *
 * "Has anything in it" was the rule the paragraph above already stated, but nothing enforced it:
 * a grievance record is keyed by (vehicle, year) and survives the violations it was raised
 * against, so deleting the last fine left a row of four zeroes sitting on the board — «لما مسحت
 * كله فضلت موجوده». There is nothing behind it to open, tick or settle.
 *
 * `rowCount` is the test rather than the money, and the difference matters: a car whose statement
 * rows are all COLLECTED reports 0 in every amount — that is what excluding collected rows from
 * the sums means — while still holding rows a reader may untick. Dropping on a zero total would
 * take that car off the board with its settled history inside it. A grievance figure that is a
 * real number also keeps its row: the appeal wiped the statement, and the figure IS the history.
 *
 * `rowCount` NOW COUNTS THE WHOLE GROUP — the statement rows and the drivers' fines on the same
 * car and year — because that is what the board's tick reaches. So a year whose only fines were
 * its drivers' stays on the board, and it stays there after they are all settled too: the tick
 * can untick them, and a row a reader may still act on is a row that has something in it.
 *
 * The grievance limb remains its own: an appeal can wipe the statement and leave the figure, and
 * that figure IS the history.
 */
const hasSomethingInIt = (row: FleetViolationRollupDto): boolean =>
  row.rowCount > 0 || row.totalBeforeGrievance !== 0;

export const assembleRollups = (
  sums: readonly ViolationYearSums[],
  grievances: readonly GrievanceFigure[],
  codes: ReadonlyMap<string, string>,
): FleetViolationRollupDto[] => {
  const byVehicle = new Map<string, FleetViolationRollupDto>();
  // A group with no vehicle — rows kept from the old book on a car the registry never had — is
  // named by the code the book wrote, which travels with the sums.
  const blank = (
    vehicleId: string | null,
    bookCode: string | null,
    year: number,
  ): FleetViolationRollupDto => ({
    vehicleId,
    code: vehicleId === null ? (bookCode ?? '—') : (codes.get(vehicleId) ?? vehicleId),
    year,
    vehicleCount: 0,
    vehicleAmount: 0,
    driverCount: 0,
    driverAmount: 0,
    totalCount: 0,
    totalAmount: 0,
    outstandingVehicleAmount: 0,
    outstandingDriverAmount: 0,
    outstandingTotalAmount: 0,
    totalBeforeGrievance: 0,
    rowCount: 0,
    collectedCount: 0,
  });

  for (const sum of sums) {
    byVehicle.set(keyOf(sum.vehicleId, sum.vehicleCode, sum.year), {
      ...blank(sum.vehicleId, sum.vehicleCode, sum.year),
      vehicleCount: sum.vehicleCount,
      vehicleAmount: sum.vehicleAmount,
      driverCount: sum.driverCount,
      driverAmount: sum.driverAmount,
      totalCount: sum.vehicleCount + sum.driverCount,
      totalAmount: sum.vehicleAmount + sum.driverAmount,
      outstandingVehicleAmount: sum.outstandingVehicleAmount,
      outstandingDriverAmount: sum.outstandingDriverAmount,
      outstandingTotalAmount: sum.outstandingVehicleAmount + sum.outstandingDriverAmount,
      rowCount: sum.rowCount,
      collectedCount: sum.collectedCount,
    });
  }
  for (const grievance of grievances) {
    const key = keyOf(grievance.vehicleId, null, grievance.year);
    const row = byVehicle.get(key) ?? blank(grievance.vehicleId, null, grievance.year);
    row.totalBeforeGrievance = grievance.totalBeforeGrievance;
    byVehicle.set(key, row);
  }

  // Newest year first, then by code — the board is read as "what is outstanding now", and a
  // vehicle's current year is the row a reader is looking for.
  return [...byVehicle.values()]
    .filter(hasSomethingInIt)
    .sort((a, b) => b.year - a.year || a.code.localeCompare(b.code));
};
