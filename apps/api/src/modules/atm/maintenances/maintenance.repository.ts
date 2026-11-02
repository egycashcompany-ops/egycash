import { type ClientSession, type FilterQuery, type Types } from 'mongoose';
import { AtmOperationLogRepository } from '../shared/operation-log.repository';
import { AtmMaintenanceModel, type AtmMaintenanceDoc } from './maintenance.model';

// The mail `duplication` question is the shared `openMachineCodes`/`hasOpenOperation`: "does
// this machine have an OPEN maintenance on the ticket's day?" — any branch. The legacy asked
// "opened TODAY, in this deployment" (contad_app.js:2674). While the owner's rule held (port doc
// OD-1) the flag was exactly what accept refused; since OD-1c (2026-11-02) it is a warning only,
// and accept opens another maintenance for the machine.
class AtmMaintenanceRepository extends AtmOperationLogRepository<AtmMaintenanceDoc> {
  constructor() {
    super(AtmMaintenanceModel, { branchField: 'branchId' });
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
