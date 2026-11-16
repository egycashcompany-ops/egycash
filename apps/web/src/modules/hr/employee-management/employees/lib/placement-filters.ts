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
// Pure, and separate from the page, because the interesting behaviour is the CASCADE: choosing
// sites narrows the departments, choosing departments narrows the sections, and a pick that no
// longer belongs under its new parents has to go rather than quietly filtering the list to nothing.
//
// EVERY FILTER TAKES SEVERAL — «هنخلي كل الفلترز multi زي checkbox كدا اقدر اختار اكتر من حاجه». Each
// of the four is a list; an empty list means "not narrowed by this one", and the picks of one
// filter are ORed (any of these sites), the four filters ANDed, as the registry query reads them.
// The three lists are fetched once each and narrowed here, instead of one permission-gated request
// per selection.
import { type OrgUnitOptionDto } from '@ecms/contracts';

/**
 * The four placement filters, each a list — `[]` meaning "not narrowed by this one".
 *
 * `departmentKeys` and `sectionKeys` are GROUP keys, not ids — see `groupKeyOf`. The ids a query
 * needs come from `departmentIdsFor` / `sectionIdsFor`, which expand the keys to the branch copies
 * currently in scope.
 */
export interface PlacementSelection {
  branchIds: string[];
  departmentKeys: string[];
  sectionKeys: string[];
  jobTitleIds: string[];
}

export const EMPTY_PLACEMENT: PlacementSelection = {
  branchIds: [],
  departmentKeys: [],
  sectionKeys: [],
  jobTitleIds: [],
};

export const hasPlacementFilter = (sel: PlacementSelection): boolean =>
  sel.branchIds.length > 0 ||
  sel.departmentKeys.length > 0 ||
  sel.sectionKeys.length > 0 ||
  sel.jobTitleIds.length > 0;

/** One choice in a list: a catalog entry, standing for every branch copy of it in scope. */
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

/** Branch copies of departments in the chosen sites — all of them when no site is chosen. */
const departmentUnitsIn = (
  departments: readonly OrgUnitOptionDto[],
  branchIds: readonly string[],
): OrgUnitOptionDto[] =>
  branchIds.length === 0
    ? [...departments]
    : departments.filter((d) => d.parentId !== null && branchIds.includes(d.parentId));

/** Department choices for the chosen sites: one per catalog entry, not one per branch copy. */
export const departmentGroupsIn = (
  departments: readonly OrgUnitOptionDto[],
  branchIds: readonly string[],
): UnitGroup[] => fold(departmentUnitsIn(departments, branchIds));

/** The department ids a query should carry for the current selection — empty when unnarrowed. */
export const departmentIdsFor = (
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchIds' | 'departmentKeys'>,
): string[] =>
  sel.departmentKeys.length === 0
    ? []
    : departmentGroupsIn(departments, sel.branchIds)
        .filter((g) => sel.departmentKeys.includes(g.key))
        .flatMap((g) => g.ids);

/**
 * Sections available under the current narrowing.
 *
 * Chosen departments decide it outright — every branch copy of them. With only sites chosen, the
 * sections of every department in those sites are offered: the reader narrowed to places, not to
 * departments, and offering every section in the company would put units from other sites in the
 * list.
 */
const sectionUnitsIn = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchIds' | 'departmentKeys'>,
): OrgUnitOptionDto[] => {
  const departmentIds = departmentIdsFor(departments, sel);
  if (departmentIds.length > 0) {
    const under = new Set(departmentIds);
    return sections.filter((s) => s.parentId !== null && under.has(s.parentId));
  }
  if (sel.branchIds.length === 0) return [...sections];
  const inBranches = new Set(departmentUnitsIn(departments, sel.branchIds).map((d) => d.id));
  return sections.filter((s) => s.parentId !== null && inBranches.has(s.parentId));
};

export const sectionGroupsIn = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: Pick<PlacementSelection, 'branchIds' | 'departmentKeys'>,
): UnitGroup[] => fold(sectionUnitsIn(sections, departments, sel));

export const sectionIdsFor = (
  sections: readonly OrgUnitOptionDto[],
  departments: readonly OrgUnitOptionDto[],
  sel: PlacementSelection,
): string[] =>
  sel.sectionKeys.length === 0
    ? []
    : sectionGroupsIn(sections, departments, sel)
        .filter((g) => sel.sectionKeys.includes(g.key))
        .flatMap((g) => g.ids);

/**
 * The selection after a change, with every pick that no longer belongs under its parents dropped.
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
  const departmentsHere = new Set(departmentGroupsIn(departments, sel.branchIds).map((g) => g.key));
  const departmentKeys = sel.departmentKeys.filter((key) => departmentsHere.has(key));
  const narrowed = { branchIds: sel.branchIds, departmentKeys };
  const sectionsHere = new Set(sectionGroupsIn(sections, departments, narrowed).map((g) => g.key));
  const sectionKeys = sel.sectionKeys.filter((key) => sectionsHere.has(key));
  return { ...sel, departmentKeys, sectionKeys };
};
