// The department filter on the System Users list — one choice per COMPANY department.
//
// A department is one record per branch (P-ORG-2), so «الأمن» exists once in every site. A filter
// that listed the records would offer «الأمن» eight times; this one offers it once, and choosing it
// means every branch copy (or only the copy in the branch already chosen). What makes two copies
// the same department is the rule the contracts share with the server, `orgUnitGroupKeys`.
import { orgUnitGroupKeys, type OrgUnitOptionDto } from '@ecms/contracts';

/** One department choice: a company department, standing for its branch copies in reach. */
export interface DepartmentChoice {
  key: string;
  name: OrgUnitOptionDto['name'];
  ids: string[];
}

/** Department choices, narrowed to one branch's copies when a branch is chosen. */
export const departmentChoices = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string | null,
): DepartmentChoice[] => {
  const keys = orgUnitGroupKeys(departments);
  const choices = new Map<string, DepartmentChoice>();
  for (const unit of departments) {
    if (branchId !== null && unit.parentId !== branchId) continue;
    const key = keys.get(unit.id) ?? `unit:${unit.id}`;
    const choice = choices.get(key);
    if (choice === undefined) choices.set(key, { key, name: unit.name, ids: [unit.id] });
    else choice.ids.push(unit.id);
  }
  return [...choices.values()].sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'));
};

/** The department ids a query carries for the chosen keys — empty when none is chosen. */
export const departmentIdsFor = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string | null,
  keys: readonly string[],
): string[] =>
  keys.length === 0
    ? []
    : departmentChoices(departments, branchId)
        .filter((choice) => keys.includes(choice.key))
        .flatMap((choice) => choice.ids);
