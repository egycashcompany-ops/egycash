// Public surface of the Payroll Adjustments feature (P-HR-04). The HR manifest and sibling
// features import from here; internal files are not reached across the boundary.
export {
  buildEmployeeAdjustmentsRouter,
  buildPayrollAdjustmentsRouter,
} from './payroll-adjustment.routes';
export { payrollAdjustmentService } from './payroll-adjustment.service';
export { payrollAdjustmentRepository } from './payroll-adjustment.repository';
export { toPayrollAdjustmentDto } from './payroll-adjustment.mapper';
export { type PayrollAdjustmentDoc } from './payroll-adjustment.model';
export { ensureAdjustmentAttachmentsCategory } from './payroll-adjustment.files';
export { hrAdjustmentFileAuthorizers } from './payroll-adjustment-file-access';
