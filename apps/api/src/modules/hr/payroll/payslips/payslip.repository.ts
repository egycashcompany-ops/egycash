// Payslip data access.
//
// `branchId` is the ADR-015 scope axis, denormalized from the employee at issue time exactly as
// the pay-item assignments do. Unlike those, these rows ARE scoped here rather than inheriting
// from an employee the caller resolved first: a payslip list is a list of many employees at once,
// so there is no single employee whose visibility it could follow.
//
// There is no update and no delete. The base class provides them; nothing in this phase calls
// them, and a payslip is a document somebody was paid against.
import { BaseRepository } from '../../../../shared/base/base.repository';
import { PayslipModel, type PayslipDoc } from './payslip.model';

class PayslipRepository extends BaseRepository<PayslipDoc> {
  constructor() {
    super(PayslipModel, { branchField: 'branchId' });
  }
}

export const payslipRepository = new PayslipRepository();
