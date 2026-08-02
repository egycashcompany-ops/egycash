// The §2.9 annual rollup's PURE half: merge the aggregate sums, the grievance figures, and the
// vehicle codes into the DTO the page shows. Kept free of I/O so the merge — the part with the
// off-by-one traps (a grievance with no violations, violations with no grievance) — is
// unit-tested without a database. Everything here is derived at query time, never stored.
import { type FleetViolationRollupDto } from '@ecms/contracts';
import { type ViolationYearSums } from './violation.repository';

export interface GrievanceFigure {
  vehicleId: string;
  totalBeforeGrievance: number;
}

/**
 * One row per vehicle that has ANYTHING in the year — violations, a grievance, or both. A
 * grievance-only vehicle still appears (its statement was wiped by the appeal, the figure is
 * the history); a vehicle without a grievance shows 0, not null, matching the legacy page.
 */
export const assembleRollups = (
  year: number,
  sums: readonly ViolationYearSums[],
  grievances: readonly GrievanceFigure[],
  codes: ReadonlyMap<string, string>,
): FleetViolationRollupDto[] => {
  const byVehicle = new Map<string, FleetViolationRollupDto>();
  const blank = (vehicleId: string): FleetViolationRollupDto => ({
    vehicleId,
    code: codes.get(vehicleId) ?? vehicleId,
    year,
    vehicleCount: 0,
    vehicleAmount: 0,
    driverCount: 0,
    driverAmount: 0,
    totalCount: 0,
    totalAmount: 0,
    totalBeforeGrievance: 0,
  });

  for (const sum of sums) {
    byVehicle.set(sum.vehicleId, {
      ...blank(sum.vehicleId),
      vehicleCount: sum.vehicleCount,
      vehicleAmount: sum.vehicleAmount,
      driverCount: sum.driverCount,
      driverAmount: sum.driverAmount,
      totalCount: sum.vehicleCount + sum.driverCount,
      totalAmount: sum.vehicleAmount + sum.driverAmount,
    });
  }
  for (const grievance of grievances) {
    const row = byVehicle.get(grievance.vehicleId) ?? blank(grievance.vehicleId);
    row.totalBeforeGrievance = grievance.totalBeforeGrievance;
    byVehicle.set(grievance.vehicleId, row);
  }

  return [...byVehicle.values()].sort((a, b) => a.code.localeCompare(b.code));
};
