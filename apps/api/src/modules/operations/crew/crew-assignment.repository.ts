import { type ClientSession, type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsCrewAssignmentModel,
  hasVan,
  type OperationsCrewAssignmentDoc,
  type OperationsVanCrewDoc,
} from './crew-assignment.model';
import { crewMembers } from './crew-slots';

/** A row ON A VAN — `$type`, the same test `ux_day_vehicle`'s partial filter makes. */
const ON_A_VAN = { vehicleId: { $type: 'objectId' } } as const;

class OperationsCrewAssignmentRepository extends BaseRepository<OperationsCrewAssignmentDoc> {
  constructor() {
    super(OperationsCrewAssignmentModel, {}); // organization-wide board, like the fleet roster
  }

  /**
   * EVERY live crew row of the day — the vans' and, since Round 20, the rows without a van. Only
   * the crew board and its save read this: it is the day's whole plan, which Q11 is judged over.
   * A reader about VANS reads `findVansForDay`.
   */
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

  /** The day's crew rows ON A VAN — the van cards, the distribution: never a row without a van. */
  async findVansForDay(
    operationsDayId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<OperationsVanCrewDoc[]> {
    return this.model
      .find({ operationsDayId, isDeleted: false, ...ON_A_VAN })
      .session(session ?? null)
      .lean<OperationsVanCrewDoc[]>()
      .exec();
  }

  /**
   * One crew row, ON A VAN — what a shipment leg, a dispatch or the captain's stop is addressed
   * by. A row without a van answers null, exactly as a missing one does: it has no van to carry a
   * stop, so to every act that needs a van it is not a crew at all (Round 20).
   */
  async findVanById(id: string): Promise<OperationsVanCrewDoc | null> {
    const row = await this.findById(id);
    return row !== null && hasVan(row) ? row : null;
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
   *
   * VANS ONLY (Round 20). A captain on a row WITHOUT a van has no van to drive a stop in — no leg
   * can be given to such a row — so on that day he is not a captain of anything the app can show.
   * The question this answers was always "which VEHICLES", and a row with none is not an answer.
   */
  async findForCaptainDay(
    operationsDayId: Types.ObjectId | string,
    captainEmployeeId: string,
    session?: ClientSession,
  ): Promise<OperationsVanCrewDoc[]> {
    return this.model
      .find({
        operationsDayId,
        captainEmployeeIds: captainEmployeeId,
        isDeleted: false,
        ...ON_A_VAN,
      })
      .session(session ?? null)
      .lean<OperationsVanCrewDoc[]>()
      .exec();
  }

  /**
   * employeeId → vehicleId over a day's rows — the Q11 exclusivity lookup.
   *
   * One of THREE implementations of Q11 that must move together: this one (the service's end-state
   * check reads it), `PlanOperationsCrewRowSchema`'s cross-row refinement, and the payload's own
   * cross-slot refinement. The rule itself is unchanged — one person, one row per operating
   * day — and only the traversal widened, because a slot is now a list.
   *
   * A row WITHOUT A VAN (Round 20) holds its people all the same, but has no vehicle to name, so
   * they are not in this map: what it answers is "which VEHICLE does he hold" (the pool's
   * `assignedVehicleId`), and for them the true answer is none. The save's own Q11 check counts
   * them (crew.service.ts `plan`).
   */
  takenCrew(rows: readonly OperationsCrewAssignmentDoc[]): Map<string, string> {
    const taken = new Map<string, string>();
    for (const row of rows) {
      if (!hasVan(row)) continue;
      for (const employeeId of crewMembers(row)) taken.set(employeeId, String(row.vehicleId));
    }
    return taken;
  }
}

export const operationsCrewAssignmentRepository = new OperationsCrewAssignmentRepository();
