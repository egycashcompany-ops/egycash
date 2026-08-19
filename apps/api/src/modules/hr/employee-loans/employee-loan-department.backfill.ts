// P-SCOPE-1 stage 3 — the loans' share of the department backfill.
//
// It lives HERE and nowhere else, and that is the P-HR-05-B seam rather than a preference: payroll
// may not name a loan collection anywhere (`reconciliation-guards.spec.ts`), so a single migration
// that reached all four collections was architecturally impossible. The rule and the mechanics are
// shared; the one import that touches the loan ledger is made from inside the loans feature.
import { type BackfillResult, backfillDepartments } from '../shared/department-backfill';
import { EmployeeLoanModel } from './employee-loan.model';

export const backfillEmployeeLoanDepartments = async (): Promise<BackfillResult> =>
  backfillDepartments(EmployeeLoanModel, 'createdAt');
