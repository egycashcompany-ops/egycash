import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetNoticeModel, type FleetNoticeDoc } from './notice.model';

class FleetNoticeRepository extends BaseRepository<FleetNoticeDoc> {
  constructor() {
    // No org placement of its own: a notice is paperwork about a car, and who may read it is
    // decided by `fleetNotice.view` alone.
    super(FleetNoticeModel, {});
  }
}

export const fleetNoticeRepository = new FleetNoticeRepository();
