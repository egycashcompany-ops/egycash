// Public surface of the Employee Loans feature (P-HR-05, phase A). The HR manifest and sibling
// features import from here; internal files are not reached across the boundary.
//
// What is deliberately NOT exported: the installment model and the schedule generator. Phase B's
// payroll port will need a read of its own, and it should arrive as one named door rather than as
// whatever happened to be public by then.
export { buildEmployeeLoansRouter, buildEmployeeLoansAdminRouter } from './employee-loan.routes';
export { employeeLoanService } from './employee-loan.service';
export { employeeLoanRepository } from './employee-loan.repository';
export { toEmployeeLoanDto, toEmployeeLoanDetailDto } from './employee-loan.mapper';
export { type EmployeeLoanDoc } from './employee-loan.model';
export { ensureLoanAttachmentsCategory } from './employee-loan.files';
export { hrEmployeeLoanFileAuthorizers } from './employee-loan-file-access';
