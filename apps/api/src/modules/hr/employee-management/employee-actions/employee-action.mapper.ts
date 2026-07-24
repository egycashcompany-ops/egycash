// Personnel Action DTO mapping. The raw payload is INTERNAL (it may carry salary data) and is
// never exposed; salary-bearing change entries are dropped for callers without
// `employee.viewCompensation`, with `redacted: true` telling the UI something was withheld.
import { SALARY_BEARING_ACTION_TYPES, type EmployeeActionDto } from '@ecms/contracts';
import { type EmployeeActionDoc } from './employee-action.model';

const SALARY_FIELDS = new Set(['employment.salary', 'employment.allowances']);

export const toEmployeeActionDto = (
  doc: EmployeeActionDoc,
  opts: { compensationVisible: boolean },
): EmployeeActionDto => {
  const salaryBearing = SALARY_BEARING_ACTION_TYPES.includes(doc.type);
  const changes = doc.changes
    .filter((c) => opts.compensationVisible || !SALARY_FIELDS.has(c.field))
    .map((c) => ({ field: c.field, from: c.from, to: c.to }));
  return {
    id: String(doc._id),
    employeeId: String(doc.employeeId),
    employeeCode: doc.employeeCode,
    seq: doc.seq,
    type: doc.type,
    status: doc.status,
    effectiveDate: doc.effectiveDate.toISOString(),
    appliedAt: doc.appliedAt === null ? null : doc.appliedAt.toISOString(),
    changes,
    reason: doc.reason,
    note: doc.note,
    attachmentFileId: doc.attachmentFileId === null ? null : String(doc.attachmentFileId),
    failureReason: doc.failureReason,
    redacted: !opts.compensationVisible && salaryBearing,
    by: doc.by === null ? null : String(doc.by),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};
