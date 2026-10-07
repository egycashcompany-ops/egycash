import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetLicenseExpenseModel, type FleetLicenseExpenseDoc } from './license-expense.model';

class FleetLicenseExpenseRepository extends BaseRepository<FleetLicenseExpenseDoc> {
  constructor() {
    // No org placement of its own: a memo is the department's paperwork, and who may read it is
    // decided by `fleetLicenseExpense.view` alone.
    super(FleetLicenseExpenseModel, {});
  }
}

export const fleetLicenseExpenseRepository = new FleetLicenseExpenseRepository();
