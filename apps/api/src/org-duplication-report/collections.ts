// The collections the read-only duplication report reads.
//
// Named here rather than reached through the Mongoose models on purpose: importing
// `department.model` from a CLI re-opens a real import cycle and kills the entrypoint at load time
// (see the header of `org-duplication-report.cli.ts`). Hardcoding the names costs one risk — that
// a model is renamed and the report silently reads an empty collection — and `collections.spec.ts`
// removes it by asserting each name against what the model itself declares.
export const ORG_COLLECTIONS = {
  branches: 'branches',
  departments: 'departments',
  sections: 'sections',
  jobTitles: 'job_titles',
} as const;

/**
 * Collections that carry a `departmentId` while their `branchId` is NULLABLE.
 *
 * They are the ⑤ question: the only backfill that ever ran fills `departmentId` and never touches
 * `branchId`, so a row with a department and no branch is already invisible to every branch-scoped
 * reader — and it is why a "department AND branch" scope filter would not be the no-op it looks.
 */
export const NULLABLE_BRANCH_COLLECTIONS = [
  'hr_payslips',
  'hr_employee_loans',
  'hr_payroll_adjustments',
  'hr_employee_pay_items',
  'hr_leave_requests',
] as const;
