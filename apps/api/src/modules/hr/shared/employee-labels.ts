// Display enrichment for HR list reads: one batch employee fetch per page, id → label.
//
// Deliberately NOT denormalized onto the rows — a day row is derived, a regularization is a
// request, and an adjustment or a loan is a decision about somebody; none of them should go stale
// when a name is corrected. (The leave model denormalizes because its rows are point-in-time
// filings; these are answers about a person who still exists.)
//
// WHY IT LIVES IN `shared/` (P-HR-06 / D7). It arrived with AT-6 inside `attendance/`, and the
// second feature that needed it was payroll — which may not import attendance at all (the §15.1
// seam, enforced by eslint). Moving it here is the smallest change that lets both use ONE
// implementation: the behaviour is untouched, and attendance now reaches it from `../../shared/`.
import { employeeRepository } from '../employee-management/employees';

export interface EmployeeLabel {
  code: string;
  name: string;
}

export const employeeLabelMap = async (
  employeeIds: readonly string[],
): Promise<Map<string, EmployeeLabel>> => {
  const unique = [...new Set(employeeIds)];
  const docs = await employeeRepository.findByIdsSystem(unique);
  return new Map(
    docs.map((doc) => [String(doc._id), { code: doc.code, name: doc.personal.fullNameAr }]),
  );
};

/** Spread-friendly: `{ ...labelFields(map, id) }` adds the two fields only when the label exists. */
export const labelFields = (
  map: Map<string, EmployeeLabel>,
  employeeId: string,
): { employeeCode?: string; employeeName?: string } => {
  const label = map.get(employeeId);
  return label === undefined ? {} : { employeeCode: label.code, employeeName: label.name };
};
