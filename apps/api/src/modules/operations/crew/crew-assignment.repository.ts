import { type ClientSession, type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsCrewAssignmentModel,
  type OperationsCrewAssignmentDoc,
} from './crew-assignment.model';

class OperationsCrewAssignmentRepository extends BaseRepository<OperationsCrewAssignmentDoc> {
  constructor() {
    super(OperationsCrewAssignmentModel, {}); // organization-wide board, like the fleet roster
  }

  async findForDay(
    operationsDayId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<OperationsCrewAssignmentDoc[]> {
    return this.model
      .find({ operationsDayId, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsCrewAssignmentDoc[]>()
      .exec();
  }

  /** employeeId → vehicleId over a day's rows — the Q11 exclusivity lookup. */
  takenCrew(rows: readonly OperationsCrewAssignmentDoc[]): Map<string, string> {
    const taken = new Map<string, string>();
    for (const row of rows) {
      for (const slot of [
        row.captainEmployeeId,
        row.specialist1EmployeeId,
        row.specialist2EmployeeId,
      ]) {
        if (slot !== null) taken.set(String(slot), String(row.vehicleId));
      }
    }
    return taken;
  }
}

export const operationsCrewAssignmentRepository = new OperationsCrewAssignmentRepository();
