import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetDutyAssignmentModel, type FleetDutyAssignmentDoc } from './duty-assignment.model';

class FleetDutyAssignmentRepository extends BaseRepository<FleetDutyAssignmentDoc> {
  constructor() {
    // Scope is enforced on the VEHICLES a caller may see/plan (the board is built from the
    // vehicle registry's scoped list); the assignment row itself carries no org placement.
    super(FleetDutyAssignmentModel, {});
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
