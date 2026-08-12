// Payroll-run data access. Organization-wide by nature: a run is a period, not a branch.
import { BaseRepository } from '../../../../shared/base/base.repository';
import { PayrollRunModel, type PayrollRunDoc } from './payroll-run.model';

class PayrollRunRepository extends BaseRepository<PayrollRunDoc> {
  constructor() {
    super(PayrollRunModel, {}); // no branch or own axis — the period belongs to the organization
  }
}

export const payrollRunRepository = new PayrollRunRepository();
