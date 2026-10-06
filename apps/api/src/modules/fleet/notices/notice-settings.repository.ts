import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetNoticeSettingsModel, type FleetNoticeSettingsDoc } from './notice-settings.model';

class FleetNoticeSettingsRepository extends BaseRepository<FleetNoticeSettingsDoc> {
  constructor() {
    // A form's set-up is the screen's, not a branch's: `fleetNotice.view` / `.edit` decide.
    super(FleetNoticeSettingsModel, {});
  }
}

export const fleetNoticeSettingsRepository = new FleetNoticeSettingsRepository();
