import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetCustodyPaperSettingsModel,
  type FleetCustodyPaperSettingsDoc,
} from './custody-paper-settings.model';

class FleetCustodyPaperSettingsRepository extends BaseRepository<FleetCustodyPaperSettingsDoc> {
  constructor() {
    // The screen's set-up, not a branch's: `fleetCustody.view` / `fleetReceipt.edit` decide.
    super(FleetCustodyPaperSettingsModel, {});
  }

  /** The one live set-up row, in `session` when given; `null` before anybody saved. */
  async findByKey(
    key: string,
    session?: ClientSession,
  ): Promise<FleetCustodyPaperSettingsDoc | null> {
    return this.model
      .findOne({ key, isDeleted: false })
      .session(session ?? null)
      .lean<FleetCustodyPaperSettingsDoc>()
      .exec();
  }
}

export const fleetCustodyPaperSettingsRepository = new FleetCustodyPaperSettingsRepository();
