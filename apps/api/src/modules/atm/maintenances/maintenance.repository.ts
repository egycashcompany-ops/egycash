import { type FilterQuery, type Types } from 'mongoose';
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
}

export const atmMaintenanceRepository = new AtmMaintenanceRepository();
