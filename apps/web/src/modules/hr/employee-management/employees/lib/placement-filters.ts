// Which placement options a reader may pick from, given what they have already picked — and what
// has to be dropped when they change their mind higher up the tree.
//
// Pure, and separate from the page, because the interesting behaviour is the CASCADE: choosing a
// site narrows the departments, choosing a department narrows the sections, and a selection that no
// longer belongs under its new parent has to go rather than quietly filtering the list to nothing.
//
// It reads `parentId` off the option itself (a Department's Branch, a Section's Department), which
// is why the option DTO carries one: the three lists are fetched once each and narrowed here,
// instead of one permission-gated request per selection.
import { type OrgUnitOptionDto } from '@ecms/contracts';

/** The four placement filters, `''` meaning "not narrowed by this one". */
export interface PlacementSelection {
  branchId: string;
  departmentId: string;
  sectionId: string;
  jobTitleId: string;
}

export const EMPTY_PLACEMENT: PlacementSelection = {
  branchId: '',
  departmentId: '',
  sectionId: '',
  jobTitleId: '',
};

export const hasPlacementFilter = (sel: PlacementSelection): boolean =>
  sel.branchId !== '' || sel.departmentId !== '' || sel.sectionId !== '' || sel.jobTitleId !== '';

/** Departments of the chosen site — all of them when no site is chosen. */
export const departmentsIn = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string,
): OrgUnitOptionDto[] =>
  branchId === '' ? [...departments] : departments.filter((d) => d.parentId === branchId);

/**
 * Sections available under the current narrowing.
 *
 * A chosen department decides it outright. With only a site chosen, the sections of every
 * department in that site are offered — the reader narrowed to a place, not to a department, and
 * offering them every section in the company would put units from other sites in the list.
 */
export const sectionsIn = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  branchId: string,
  departmentId: string,
): OrgUnitOptionDto[] => {
  if (departmentId !== '') return sections.filter((s) => s.parentId === departmentId);
  if (branchId === '') return [...sections];
  const inBranch = new Set(departmentsIn(departments, branchId).map((d) => d.id));
  return sections.filter((s) => s.parentId !== null && inBranch.has(s.parentId));
};

/**
 * The selection after a change, with anything that no longer belongs under its parent dropped.
 *
 * Called ONLY from a change handler, never on render: the option lists arrive asynchronously, and
 * pruning against a list that has not loaded yet would erase a perfectly good selection restored
 * from the URL the instant the page opened.
 */
export const prunePlacement = (
  sel: PlacementSelection,
  departments: readonly OrgUnitOptionDto[],
  sections: readonly OrgUnitOptionDto[],
): PlacementSelection => {
  const departmentId = departmentsIn(departments, sel.branchId).some((d) => d.id === sel.departmentId)
    ? sel.departmentId
    : '';
  const sectionId = sectionsIn(sections, departments, sel.branchId, departmentId).some(
    (s) => s.id === sel.sectionId,
  )
    ? sel.sectionId
    : '';
  return { ...sel, departmentId, sectionId };
};
