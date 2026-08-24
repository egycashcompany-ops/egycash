import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetFixedCrewModel, type FleetFixedCrewDoc } from './fixed-crew.model';

class FleetFixedCrewRepository extends BaseRepository<FleetFixedCrewDoc> {
  constructor() {
    // Scope rides the VEHICLES a caller may see or plan, exactly as it does for the daily
    // assignment row: the crew row itself carries no org placement of its own.
    super(FleetFixedCrewModel, {});
  }

  /** Every fixed crew there is — the board's crew side, and the exclusivity checking ground. */
  async findAll(session?: ClientSession): Promise<FleetFixedCrewDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .session(session ?? null)
      .lean<FleetFixedCrewDoc[]>()
      .exec();
  }

  /** employeeId → vehicleId for every fixed slot taken, both slots. */
  takenDrivers(rows: readonly FleetFixedCrewDoc[]): Map<string, string> {
    const taken = new Map<string, string>();
    for (const row of rows) {
      for (const slot of [row.driver1EmployeeId, row.driver2EmployeeId]) {
        if (slot !== null) taken.set(String(slot), String(row.vehicleId));
      }
    }
    return taken;
  }
}

export const fleetFixedCrewRepository = new FleetFixedCrewRepository();
