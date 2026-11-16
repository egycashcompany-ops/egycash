import { type ClientSession, type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsCrewAssignmentModel,
  hasVan,
  type OperationsCrewAssignmentDoc,
  type OperationsVanCrewDoc,
} from './crew-assignment.model';
import { crewMembers } from './crew-slots';

class OperationsCrewAssignmentRepository extends BaseRepository<OperationsCrewAssignmentDoc> {
  constructor() {
    super(OperationsCrewAssignmentModel, {}); // organization-wide board, like the fleet roster
  }

  /**
   * EVERY live crew row of the day — the vans' and, since Round 20, the rows without a van. The
   * crew board and its save read it (the day's whole plan, which Q11 is judged over), and since
   * Round 24 «توزيع المحصنات» too: a row without a van takes محصنات like a van.
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

  /**
   * Round 24 — the live rows WITHOUT A VAN of these operating days, in the order they were added
   * (the board's order, `createdAt` then id): what a crew is numbered by — «بدون سيارة (n)» — on
   * every screen after «لوحة التشغيلة».
   */
  async findWithoutVanForDays(
    operationsDayIds: readonly string[],
  ): Promise<OperationsCrewAssignmentDoc[]> {
    if (operationsDayIds.length === 0) return [];
    return this.model
      .find({ operationsDayId: { $in: operationsDayIds }, vehicleId: null, isDeleted: false })
      .sort({ createdAt: 1, _id: 1 })
      .lean<OperationsCrewAssignmentDoc[]>()
      .exec();
  }

  /**
   * One live crew row, ON A VAN — what the daily PICKUP leg (the shipment form's crew) is addressed
   * by. A row without a van answers null, exactly as a missing one does.
   *
   * Round 24 narrowed this to that one act. The delivery leg («توزيع المحصنات», the assign dialog),
   * the handover and the captain's route read any live row (`findById`): «عاوز لو عربيه من غير كود
   * عادى تظهر ان اوزع عليها محصنات» — the owner asked it of the محصنات, not of the daily pickup.
   */
  async findVanById(id: string): Promise<OperationsVanCrewDoc | null> {
    const row = await this.findById(id);
    return row !== null && hasVan(row) ? row : null;
  }

  /**
   * The live crew row of the day holding this van, if any — «one van, one row a day»
   * (`ux_day_vehicle`). Read inside the save's transaction (Round 24).
   */
  async findForDayAndVehicle(
    operationsDayId: Types.ObjectId | string,
    vehicleId: string,
    session?: ClientSession,
  ): Promise<OperationsCrewAssignmentDoc | null> {
    return this.model
      .findOne({ operationsDayId, vehicleId, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsCrewAssignmentDoc>()
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
   *
   * ANY ROW, VAN OR NONE (Round 24). Round 20 answered vans only — a row without a van could carry
   * no leg, so its captain was a captain of nothing the app could show. The owner reversed that for
   * the محصنات («عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»): «توزيع المحصنات» may
   * now give such a row its stops, and its captain must get his route exactly like a van's — so he
   * is a captain that day, stops or none yet, as a van's captain always was. Identity is untouched:
   * the employee still comes from the token, and this still answers from the day's plan alone.
   */
  async findForCaptainDay(
    operationsDayId: Types.ObjectId | string,
    captainEmployeeId: string,
    session?: ClientSession,
  ): Promise<OperationsCrewAssignmentDoc[]> {
    return this.model
      .find({
        operationsDayId,
        captainEmployeeIds: captainEmployeeId,
        isDeleted: false,
      })
      .session(session ?? null)
      .lean<OperationsCrewAssignmentDoc[]>()
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
