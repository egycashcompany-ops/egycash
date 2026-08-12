// Display enrichment for the AT-6 list reads: one batch employee fetch per page, id → label.
// Deliberately NOT denormalized onto the rows — a day row is derived and a regularization is a
// request; neither should go stale when a name is corrected (the leave model denormalizes because
// its rows are point-in-time filings; attendance rows are recomputable answers).
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
