import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetLicenseExpenseSettingsModel,
  type FleetLicenseExpenseSettingsDoc,
} from './license-expense-settings.model';

class FleetLicenseExpenseSettingsRepository extends BaseRepository<FleetLicenseExpenseSettingsDoc> {
  constructor() {
    // The screen's set-up, not a branch's: `fleetLicenseExpense.view` / `.edit` decide.
    super(FleetLicenseExpenseSettingsModel, {});
  }
}

export const fleetLicenseExpenseSettingsRepository = new FleetLicenseExpenseSettingsRepository();
