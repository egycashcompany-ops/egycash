// Which placement options a reader may pick from, given what they have already picked — and what
// has to be dropped when they change their mind higher up the tree.
//
// THE THING THIS FILE KNOWS THAT THE SCREEN MUST NOT SHOW: a department is one record PER BRANCH.
// «الأمن» exists eight times in the database, once per site, because each site's security is its
// own unit with its own people. But it is ONE department to the company — one name, one catalog
// entry — and a filter that listed it eight times, identically, was listing the storage rather than
// the organization. So options are FOLDED here: every branch copy of a catalog entry becomes one
// choice, and choosing it means every copy at once (or the one copy in the chosen site).
//
// Pure, and separate from the page, because the interesting behaviour is the CASCADE: choosing a
// site narrows the departments, choosing a department narrows the sections, and a selection that no
// longer belongs under its new parent has to go rather than quietly filtering the list to nothing.
// The three lists are fetched once each and narrowed here, instead of one permission-gated request
// per selection.
import { type OrgUnitOptionDto } from '@ecms/contracts';

/**
 * The four placement filters, `''` meaning "not narrowed by this one".
 *
 * `departmentKey` and `sectionKey` are GROUP keys, not ids — see `groupKeyOf`. The ids a query
 * needs come from `departmentIdsFor` / `sectionIdsFor`, which expand a key to the branch copies
 * currently in scope.
 */
export interface PlacementSelection {
  branchId: string;
  departmentKey: string;
  sectionKey: string;
  jobTitleId: string;
}

export const EMPTY_PLACEMENT: PlacementSelection = {
  branchId: '',
  departmentKey: '',
  sectionKey: '',
  jobTitleId: '',
};

export const hasPlacementFilter = (sel: PlacementSelection): boolean =>
  sel.branchId !== '' || sel.departmentKey !== '' || sel.sectionKey !== '' || sel.jobTitleId !== '';

/** One choice in a dropdown: a catalog entry, standing for every branch copy of it in scope. */
export interface UnitGroup {
  key: string;
  name: OrgUnitOptionDto['name'];
  /** The branch copies this choice stands for, already narrowed to the selection above it. */
  ids: string[];
}

/**
 * What makes two branch copies the same unit.
 *
 * The catalog entry when there is one — that is what "the same department" means to the company.
 * The Arabic name otherwise: a unit created before the catalog existed, or never linked to it, is
 * still recognisably «الأمن», and folding it by name is what a reader would do by eye. Prefixed so
 * the two key spaces can never collide.
 */
export const groupKeyOf = (unit: OrgUnitOptionDto): string =>
  unit.catalogId === null ? `name:${unit.name.ar.trim()}` : `catalog:${unit.catalogId}`;

const fold = (units: readonly OrgUnitOptionDto[]): UnitGroup[] => {
  const groups = new Map<string, UnitGroup>();
  for (const u of units) {
    const key = groupKeyOf(u);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, name: u.name, ids: [u.id] });
    else group.ids.push(u.id);
  }
  return [...groups.values()].sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar'));
};

/** Branch copies of departments in the chosen site — all of them when no site is chosen. */
const departmentUnitsIn = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string,
): OrgUnitOptionDto[] =>
  branchId === '' ? [...departments] : departments.filter((d) => d.parentId === branchId);

/** Department choices for the chosen site: one per catalog entry, not one per branch copy. */
export const departmentGroupsIn = (
  departments: readonly OrgUnitOptionDto[],
  branchId: string,
): UnitGroup[] => fold(departmentUnitsIn(departments, branchId));

/** The department ids a query should carry for the current selection — empty when unnarrowed. */
export const departmentIdsFor = (
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchId' | 'departmentKey'>,
): string[] =>
  sel.departmentKey === ''
    ? []
    : (departmentGroupsIn(departments, sel.branchId).find((g) => g.key === sel.departmentKey)?.ids ??
      []);

/**
 * Sections available under the current narrowing.
 *
 * A chosen department decides it outright — every branch copy of it. With only a site chosen, the
 * sections of every department in that site are offered: the reader narrowed to a place, not to a
 * department, and offering every section in the company would put units from other sites in the
 * list.
 */
const sectionUnitsIn = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchId' | 'departmentKey'>,
): OrgUnitOptionDto[] => {
  const departmentIds = departmentIdsFor(departments, sel);
  if (departmentIds.length > 0) {
    const under = new Set(departmentIds);
    return sections.filter((s) => s.parentId !== null && under.has(s.parentId));
  }
  if (sel.branchId === '') return [...sections];
  const inBranch = new Set(departmentUnitsIn(departments, sel.branchId).map((d) => d.id));
  return sections.filter((s) => s.parentId !== null && inBranch.has(s.parentId));
};

export const sectionGroupsIn = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchId' | 'departmentKey'>,
): UnitGroup[] => fold(sectionUnitsIn(sections, departments, sel));

export const sectionIdsFor = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: PlacementSelection,
): string[] =>
  sel.sectionKey === ''
    ? []
    : (sectionGroupsIn(sections, departments, sel).find((g) => g.key === sel.sectionKey)?.ids ?? []);

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
  const departmentKey = departmentGroupsIn(departments, sel.branchId).some(
    (g) => g.key === sel.departmentKey,
  )
    ? sel.departmentKey
    : '';
  const narrowed = { branchId: sel.branchId, departmentKey };
  const sectionKey = sectionGroupsIn(sections, departments, narrowed).some(
    (g) => g.key === sel.sectionKey,
  )
    ? sel.sectionKey
    : '';
  return { ...sel, departmentKey, sectionKey };
};
