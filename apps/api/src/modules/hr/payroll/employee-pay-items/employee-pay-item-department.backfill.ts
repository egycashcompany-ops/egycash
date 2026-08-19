// P-SCOPE-1 stage 3 — this collection's share of the department backfill.
//
// It lives HERE, beside its own model, because that is the only place allowed to name it: the
// seam guards hold each collection to the feature that owns it. The mechanics are shared
// (`hr/shared/department-backfill.ts`) and the rule is shared
// (`hr/shared/department-at.ts`); what this file contributes is the one import the architecture
// says only it may make.
//
// `createdAt` IS this row's date, unlike a payslip's: these carry no period, so when they were
// written is when they happened.
import { type BackfillResult, backfillDepartments } from '../../shared/department-backfill';
import { EmployeePayItemModel } from './employee-pay-item.model';

export const backfillEmployeePayItemDepartments = async (): Promise<BackfillResult> =>
  backfillDepartments(EmployeePayItemModel, (row) => (row['createdAt'] as Date | undefined) ?? null, {
    createdAt: 1,
  });
