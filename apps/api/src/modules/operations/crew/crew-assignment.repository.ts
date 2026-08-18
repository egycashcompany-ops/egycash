import { type ClientSession, type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsCrewAssignmentModel,
  type OperationsCrewAssignmentDoc,
} from './crew-assignment.model';
import { crewMembers } from './crew-slots';

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

  /**
   * "Is this employee a captain on this operating day, and on which vehicles?"
   *
   * This is the CAPTAINCY ANCHOR of the captain-mobile identity chain (design §20-هـ):
   * authenticated user → employee → **captain assignment for the operating day** → ordered
   * shipments. Captaincy is a property of the day's plan, not of the person and not of the login:
   * the same employee is a captain on a day he is planned onto a vehicle, and is not one on a day
   * he is not. Nothing is stored on the account to say otherwise.
   *
   * Answering this directly — rather than inferring it backwards from whichever shipments happen to
   * be assigned — is what lets the surface distinguish "planned today, no stops yet" from "not a
   * captain today". Those are different facts and the mobile client must not conflate them.
   *
   * A crew may carry TWO captains, and both of them are captains — there is no first captain and
   * no deputy. The query is therefore membership in `captainEmployeeIds`, and the answer for a
   * co-captain is identical to the answer for the other. Anything else would have invented a
   * seniority rule the business never stated.
   */
  async findForCaptainDay(
    operationsDayId: Types.ObjectId | string,
    captainEmployeeId: string,
    session?: ClientSession,
  ): Promise<OperationsCrewAssignmentDoc[]> {
    return this.model
      .find({ operationsDayId, captainEmployeeIds: captainEmployeeId, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsCrewAssignmentDoc[]>()
      .exec();
  }

  /**
   * employeeId → vehicleId over a day's rows — the Q11 exclusivity lookup.
   *
   * One of THREE implementations of Q11 that must move together: this one (the service's end-state
   * check reads it), `PlanOperationsCrewRowSchema`'s cross-row refinement, and the payload's own
   * cross-slot refinement. The rule itself is unchanged — one person, one vehicle per operating
   * day — and only the traversal widened, because a slot is now a list.
   */
  takenCrew(rows: readonly OperationsCrewAssignmentDoc[]): Map<string, string> {
    const taken = new Map<string, string>();
    for (const row of rows) {
      for (const employeeId of crewMembers(row)) taken.set(employeeId, String(row.vehicleId));
    }
    return taken;
  }
}

export const operationsCrewAssignmentRepository = new OperationsCrewAssignmentRepository();
