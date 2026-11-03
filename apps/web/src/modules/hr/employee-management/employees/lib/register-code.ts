// The register screen's reading of a typed Employee Code, and of where a job title's people sit.
//
// «عايز أول حاجة قبل الاسم الكامل تبقي كود الموظف … وأول لما أكتب الكود تعرف على طول الفرع بتاعه
// … وأنا لو أخترت المسمي الوظيفي يختار على طول الإدارة والقسم التابع ليها». Pure, so a node test
// reaches every rule without rendering the form.
import { type JobTitlePlacementDto } from '@ecms/contracts';

/** The branch a code names: the one whose code is the code's first three digits. */
export const branchOfCode = <B extends { code: string }>(
  code: string,
  branches: readonly B[],
): B | undefined => (code.length >= 3 ? branches.find((b) => b.code === code.slice(0, 3)) : undefined);

/**
 * The job titles in the order the picker offers them: those the branch already has people in,
 * most-held first, then every other title as it came. Nothing is hidden — a title new to the
 * branch is still a title somebody may be hired into.
 */
export const orderTitlesForBranch = <T extends { id: string }>(
  titles: readonly T[],
  placements: readonly JobTitlePlacementDto[],
): { here: T[]; elsewhere: T[] } => {
  const held = new Map(placements.map((p) => [p.jobTitleId, p.employees]));
  return {
    here: titles
      .filter((t) => held.has(t.id))
      .sort((a, b) => (held.get(b.id) ?? 0) - (held.get(a.id) ?? 0)),
    elsewhere: titles.filter((t) => !held.has(t.id)),
  };
};

/**
 * The department and section to fill in for a picked job title — where most of the branch's people
 * with it sit — or null when nobody holds it there yet, or their department is not one the branch
 * still offers.
 */
export const placementForTitle = (
  jobTitleId: string,
  placements: readonly JobTitlePlacementDto[],
  departments: readonly { id: string }[],
): { departmentId: string; sectionId: string } | null => {
  const placed = placements.find((p) => p.jobTitleId === jobTitleId);
  if (placed === undefined || !departments.some((d) => d.id === placed.departmentId)) return null;
  return { departmentId: placed.departmentId, sectionId: placed.sectionId ?? '' };
};
