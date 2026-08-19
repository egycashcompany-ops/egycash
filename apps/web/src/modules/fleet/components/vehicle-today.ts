// "Which vehicle is this driver on today?", answered from one roster day.
//
// A driver has no permanent vehicle. `fleet_duty_assignments` is keyed `(vehicleId, date)` and
// FR-7 gives a driver one assignment per date, so the question only means something with a day
// attached. `GET /fleet/roster?date=` already returns the whole answer — this is the pure
// selection over that response, kept out of the component so the two ways a driver can be
// assigned are testable without a browser.
import { type FleetRosterDayDto } from '@ecms/contracts';

export interface VehicleToday {
  /** كود العربية — the registry's own vehicle code. */
  code: string;
  /** الماركة — the vehicle TYPE's localized name, resolved by the caller. */
  make: string;
}

/**
 * The driver's vehicle on the given roster day, or null when they are not on it.
 *
 * TWO lookups, and the second is not redundant: `availableDrivers` lists the drivers free to be
 * assigned, so a driver who holds an assignment AND is marked unavailable that day is absent from
 * it. The assignment rows are the authoritative record, so they are consulted rather than
 * reporting "no vehicle" for someone who plainly has one.
 */
export const vehicleTodayFrom = (
  day: FleetRosterDayDto | undefined,
  employeeId: string,
  typeName: (typeId: string) => string | null,
): VehicleToday | null => {
  if (day === undefined || employeeId === '') return null;
  const assignedVehicleId =
    day.availableDrivers.find((d) => d.employeeId === employeeId)?.assignedVehicleId ?? null;
  const row =
    day.rows.find((r) => assignedVehicleId !== null && r.vehicleId === assignedVehicleId) ??
    day.rows.find(
      (r) => r.driver1EmployeeId === employeeId || r.driver2EmployeeId === employeeId,
    ) ??
    null;
  if (row === null) return null;
  // An unresolved type name is a dash, never the raw id: the type list answers to
  // `fleetVehicle.view`, which a drivers-only role may not hold.
  return { code: row.code, make: typeName(row.typeId) ?? '—' };
};
