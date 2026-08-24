import { type Types, type FilterQuery } from 'mongoose';
import { AtmOperationLogRepository } from '../shared/operation-log.repository';
import { cairoDayRange, cairoDateString } from '../shared/cairo-time';
import { AtmMaintenanceModel, type AtmMaintenanceDoc } from './maintenance.model';

class AtmMaintenanceRepository extends AtmOperationLogRepository<AtmMaintenanceDoc> {
  constructor() {
    super(AtmMaintenanceModel, { branchField: 'branchId' });
  }

  /**
   * "Is there an open maintenance for this machine TODAY?" — the mail duplication rule, exactly
   * as the pending-mail screen recomputes it per row (contad_app.js:2674: status 0, not deleted,
   * open_time inside today). Today is the Cairo day (T1 normalization).
   */
  async hasOpenToday(branchId: Types.ObjectId, machineCode: string): Promise<boolean> {
    const { start, end } = cairoDayRange(cairoDateString(new Date()));
    const found = await this.model
      .exists({
        isDeleted: false,
        branchId,
        machineCode,
        closedAt: null,
        openedAt: { $gte: start, $lt: end },
      } as FilterQuery<AtmMaintenanceDoc>)
      .exec();
    return found !== null;
  }
}

export const atmMaintenanceRepository = new AtmMaintenanceRepository();
