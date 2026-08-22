import { Types, type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetDutyAssignmentModel, type FleetDutyAssignmentDoc } from './duty-assignment.model';

class FleetDutyAssignmentRepository extends BaseRepository<FleetDutyAssignmentDoc> {
  constructor() {
    // Scope is enforced on the VEHICLES a caller may see/plan (the board is built from the
    // vehicle registry's scoped list); the assignment row itself carries no org placement.
    super(FleetDutyAssignmentModel, {});
  }

  /**
   * The crew a vehicle carried on a given DAY, or null when the roster has no row for it.
   *
   * Matched across the whole day rather than on an exact instant: the (vehicle, date) pair is
   * unique and the roster stamps it at midnight, but the callers asking this question hold dates
   * that came from elsewhere — a workshop visit's check-in, for one — and comparing those to an
   * exact midnight would answer "no crew" for every row.
   */
  async findForVehicleOnDate(
    vehicleId: string,
    day: Date,
    session?: ClientSession,
  ): Promise<FleetDutyAssignmentDoc | null> {
    const start = new Date(day);
    start.setUTCHours(0, 0, 0, 0);
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 1);
    return this.model
      .findOne({
        vehicleId: new Types.ObjectId(vehicleId),
        date: { $gte: start, $lt: next },
        isDeleted: false,
      })
      .session(session ?? null)
      .lean<FleetDutyAssignmentDoc>()
      .exec();
  }

  /** Every row of one day's plan — the board's assignment side and FR-7's checking ground. */
  async findForDate(day: Date, session?: ClientSession): Promise<FleetDutyAssignmentDoc[]> {
    return this.model
      .find({ date: day, isDeleted: false })
      .session(session ?? null)
      .lean<FleetDutyAssignmentDoc[]>()
      .exec();
  }

  /** employeeId → vehicleId for every driver slot taken on the day (both slots). */
  takenDrivers(rows: readonly FleetDutyAssignmentDoc[]): Map<string, string> {
    const taken = new Map<string, string>();
    for (const row of rows) {
      for (const slot of [row.driver1EmployeeId, row.driver2EmployeeId]) {
        if (slot !== null) taken.set(String(slot), String(row.vehicleId));
      }
    }
    return taken;
  }
}

export const fleetDutyAssignmentRepository = new FleetDutyAssignmentRepository();
