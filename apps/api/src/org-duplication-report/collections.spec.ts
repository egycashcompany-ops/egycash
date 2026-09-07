// The duplication report names its collections as strings, because importing the Mongoose models
// from a CLI re-opens an import cycle that kills the entrypoint before its first line of logic.
//
// That trade has exactly one cost: a model renamed, a report that silently reads an empty
// collection and cheerfully answers "no duplication". This removes it. A spec CAN import the
// models safely — vitest enters the graph the way the application does — so the strings are
// checked against what each model actually declares.
import { describe, expect, it } from 'vitest';
import { type Schema } from 'mongoose';
// These two side-effect imports are load-bearing and must come FIRST.
//
// Importing a model file directly is the very thing that broke the CLI: it enters the graph at
// `department.model` → `shared/org-unit` → `audit.service` → auth → users → the department
// repository → back into the model while its schema helpers are still initializing, and the file
// dies on a half-built module (a TDZ `ReferenceError` from Node, `addOrgUnitIndexes is not a
// function` under vitest — same cycle, two symptoms). The barrels enter the graph in the order the
// APPLICATION does, so by the time the models are named below they are fully built.
//
// Do not remove them because they look unused. Removing them fails this file.
import '../modules';
import '../platform/organization';
import { BranchModel } from '../platform/organization/branches/branch.model';
import { DepartmentModel } from '../platform/organization/departments/department.model';
import { SectionModel } from '../platform/organization/sections/section.model';
import { JobTitleModel } from '../platform/organization/job-titles/job-title.model';
import { EmployeeLoanModel } from '../modules/hr/employee-loans/employee-loan.model';
import { LeaveRequestModel } from '../modules/hr/leave-management/leave-requests/leave-request.model';
import { PayrollAdjustmentModel } from '../modules/hr/payroll/adjustments/payroll-adjustment.model';
import { EmployeePayItemModel } from '../modules/hr/payroll/employee-pay-items/employee-pay-item.model';
import { PayslipModel } from '../modules/hr/payroll/payslips/payslip.model';
import { NULLABLE_BRANCH_COLLECTIONS, ORG_COLLECTIONS } from './collections';

describe('the report reads the collections the models actually write', () => {
  it('names the four org-unit collections correctly', () => {
    expect(ORG_COLLECTIONS.branches).toBe(BranchModel.collection.name);
    expect(ORG_COLLECTIONS.departments).toBe(DepartmentModel.collection.name);
    expect(ORG_COLLECTIONS.sections).toBe(SectionModel.collection.name);
    expect(ORG_COLLECTIONS.jobTitles).toBe(JobTitleModel.collection.name);
  });

  it('names every nullable-branch collection correctly', () => {
    expect([...NULLABLE_BRANCH_COLLECTIONS].sort()).toEqual(
      [
        PayslipModel.collection.name,
        EmployeeLoanModel.collection.name,
        PayrollAdjustmentModel.collection.name,
        EmployeePayItemModel.collection.name,
        LeaveRequestModel.collection.name,
      ].sort(),
    );
  });

  it('is asking about collections whose branchId really is nullable', () => {
    // The premise of question ⑤. If one of these ever made branchId required, the query would be
    // asking something that cannot happen, and the zero it returned would mean nothing.
    for (const model of [
      PayslipModel,
      EmployeeLoanModel,
      PayrollAdjustmentModel,
      EmployeePayItemModel,
      LeaveRequestModel,
    ]) {
      const path = (model.schema as Schema).path('branchId') as
        | { isRequired?: boolean }
        | undefined;
      expect(path, `${model.collection.name} must carry a branchId`).toBeDefined();
      expect(path?.isRequired, `${model.collection.name}.branchId is required now`).toBeFalsy();
    }
  });
});
