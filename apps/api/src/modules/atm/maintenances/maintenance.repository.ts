import { type ClientSession, type FilterQuery, type Types } from 'mongoose';
import { AtmOperationLogRepository } from '../shared/operation-log.repository';
import { AtmMaintenanceModel, type AtmMaintenanceDoc } from './maintenance.model';

// The mail `duplication` question is the shared `openMachineCodes`/`hasOpenOperation` now: "does
// this machine have an OPEN maintenance on the ticket's day?" — any branch. The legacy asked
// "opened TODAY, in this deployment" (contad_app.js:2674); the owner's rule (port doc OD-1) made
// the flag exactly what accept refuses, so the two can no longer disagree.
class AtmMaintenanceRepository extends AtmOperationLogRepository<AtmMaintenanceDoc> {
  constructor() {
    super(AtmMaintenanceModel, { branchField: 'branchId' });
  }

  /**
   * Is an OPEN maintenance opened FROM this mail ticket? — then an accept of the ticket already
   * landed (or is landing, in a concurrent request), and a refusal of it would be a false report.
   * A maintenance from a ticket always carries the ticket's branch, which keeps this on the
   * branch's open-rows index.
   */
  async hasOpenFromTicket(branchId: Types.ObjectId, ticketId: Types.ObjectId): Promise<boolean> {
    const filter = {
      branchId,
      closedAt: null,
      isDeleted: false,
      mailTicketId: ticketId,
    } as FilterQuery<AtmMaintenanceDoc>;
    return (await this.model.exists(filter).exec()) !== null;
  }

  /**
   * Every maintenance opened FROM this mail ticket — open, closed and deleted — what the mail
   * restore removes, or refuses over (mail-ticket.service.ts `restore`). Closed rows are wanted: a
   * live closed one is a refusal. Deleted rows are wanted too: they tell "its maintenance was
   * deleted on the board" (the ticket simply returns) from "no maintenance was ever linked to it"
   * (a legacy accept — refused). Unscoped beyond the ticket's branch, because the authority is the
   * ticket's: accept opened it under `atmMailTicket.decide`, and the restore undoes it under the
   * same grant. Pass the restore's `session`, so the read and the delete are one snapshot.
   */
  async findFromTicket(
    branchId: Types.ObjectId,
    ticketId: Types.ObjectId,
    session: ClientSession | null = null,
  ): Promise<AtmMaintenanceDoc[]> {
    const filter = {
      branchId,
      mailTicketId: ticketId,
    } as FilterQuery<AtmMaintenanceDoc>;
    return this.model.find(filter).session(session).lean<AtmMaintenanceDoc[]>().exec();
  }
}

export const atmMaintenanceRepository = new AtmMaintenanceRepository();
