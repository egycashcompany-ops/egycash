// Public surface of the Employee Loans feature (P-HR-05). The HR manifest and sibling features
// import from here; internal files are not reached across the boundary.
//
// What is deliberately NOT exported: the models, the repositories that reach them, and the pure
// schedule generator. Payroll's port (P-HR-05-B) takes `employeeLoanService` and nothing else, so
// "what can payroll do to a loan?" is answered by that class's two seam methods rather than by
// whatever happened to be public.
export { buildEmployeeLoansRouter, buildEmployeeLoansAdminRouter } from './employee-loan.routes';
export { employeeLoanService } from './employee-loan.service';
export { employeeLoanRepository } from './employee-loan.repository';
export { toEmployeeLoanDto, toEmployeeLoanDetailDto } from './employee-loan.mapper';
export { type EmployeeLoanDoc } from './employee-loan.model';
export { ensureLoanAttachmentsCategory } from './employee-loan.files';
export { hrEmployeeLoanFileAuthorizers } from './employee-loan-file-access';
export { backfillEmployeeLoanDepartments } from './employee-loan-department.backfill';
