import { type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetNoticeModel, type FleetNoticeDoc } from './notice.model';

class FleetNoticeRepository extends BaseRepository<FleetNoticeDoc> {
  constructor() {
    // No org placement of its own: a notice is paperwork about a car, and who may read it is
    // decided by `fleetNotice.view` alone.
    super(FleetNoticeModel, {});
  }

  /** Every live notice the filters leave — the figures behind «الإحصائيات» count over these. */
  async findLive(filter: FilterQuery<FleetNoticeDoc>): Promise<FleetNoticeDoc[]> {
    return this.model
      .find({ ...filter, isDeleted: false })
      .select({ values: 0, checks: 0 })
      .lean<FleetNoticeDoc[]>()
      .exec();
  }
}

export const fleetNoticeRepository = new FleetNoticeRepository();
