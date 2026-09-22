// The shape of «الصلاحيات» as the owner describes it: one PERSON, the branches he works in, the
// departments inside each branch, and the screens inside each department.
//
// Same records and same server rules as before (ADR-032, Gap 1) — this module only decides how the
// units are grouped and what each level's checkbox means, so the screen can be walked top-down
// instead of assembled from two dropdowns before it will show anything.
//
// Three properties the levels hold to, all of them consequences of the delegation rules rather
// than new policy:
//
//   • «الفرع كله» is a GRANT, not a «tick everything» shortcut. It is its own record on the server
//     (`departmentId: null`) and it carries departments that do not exist yet, so while it is on
//     the departments beneath it are read-only — what they hold separately is redundant, not gone,
//     and clearing the branch grant brings it back.
//   • A tick never reaches a key outside the caller's ceiling for that unit, in either direction:
//     a key granted by somebody with more authority is shown, counted, and cannot be cleared here.
//   • Every count is computed from the same state the checkboxes read. Counts written by hand are
//     how a screen ends up saying «٩ شاشات» over eight rows.
import {
  type DelegationCatalogDto,
  type DelegationDto,
  type LocalizedString,
  type PageDto,
} from '@ecms/contracts';
import { buildRows, pageState, type GridRow, type Selection } from './delegation-grid';

/** One department in one branch, or (`departmentId: null`) the whole branch. */
export interface Unit {
  branchId: string;
  departmentId: string | null;
}

/** The account's own placement, pinned into the tree even when the caller cannot grant there. */
export interface HomeUnit extends Unit {
  branchName?: LocalizedString;
  departmentName?: LocalizedString;
}

export const unitKey = (unit: Unit): string => `${unit.branchId}:${unit.departmentId ?? '*'}`;

export const parseUnit = (key: string): Unit => {
  const [branchId = '', department = '*'] = key.split(':');
  return { branchId, departmentId: department === '*' ? null : department };
};

/** The keys the caller may hand out over a unit: the branch's whole-branch keys plus the department's own. */
export const ceilingOf = (cat: DelegationCatalogDto, unit: Unit): Set<string> => {
  const branch = cat.branches.find((b) => b.id === unit.branchId);
  if (branch === undefined) return new Set();
  const own =
    unit.departmentId === null
      ? []
      : (branch.departments.find((d) => d.id === unit.departmentId)?.permissionKeys ?? []);
  // A department the catalog does not list under this branch is not one the caller delegates in,
  // even when the branch itself is: the whole-branch keys apply only to units the catalog offers.
  const offered = unit.departmentId === null || branch.departments.some((d) => d.id === unit.departmentId);
  return new Set(offered ? [...branch.permissionKeys, ...own] : []);
};

export type TickState = 'all' | 'some' | 'none';

/** One screen — the registry page, its keys in this unit, and how much of it is ticked. */
export interface ScreenNode {
  /** The page id, or `other` for the registry's deliberate no-page bucket. */
  id: string;
  page: PageDto | null;
  row: GridRow;
  state: TickState;
  /** Ticked actions, and every action shown on the screen — locked ones included in both. */
  on: number;
  total: number;
  /**
   * Ticked in the SAVED record, ignoring the draft.
   *
   * A default that reads the draft moves under the manager's hand: a module group open «because
   * something is ticked in it» shuts the moment he clears the last tick, with his cursor still in
   * it. The saved record does not change while he works, so a default read off it holds still.
   */
  savedOn: number;
  /** False when no action here is the caller's to grant in this unit: shown, never ticked. */
  grantable: boolean;
}

/** Screens grouped the way the registry groups them; `moduleId: null` is the no-page bucket. */
export interface ModuleNode {
  moduleId: string | null;
  screens: ScreenNode[];
  on: number;
  total: number;
  /** Screens carrying something in the SAVED record. */
  savedOn: number;
  /** Screens with at least one action the caller may grant here. */
  grantableScreens: number;
  /**
   * Whether the group shows itself without being asked.
   *
   * Read off the SAVED record and the ceiling, never off the draft, so it does not move while the
   * manager ticks. A group opens when the account already holds something in it — a grant nobody
   * can see is a grant nobody can take back — and the first group carrying anything the caller may
   * actually grant opens too, so the unit never lands on nothing but shut headers. A group that is
   * only there because somebody with more authority granted in it stays shut: there is nothing in
   * it for this reader to do, and its count is on the line below.
   */
  openByDefault: boolean;
}

/** One record on the server: a department in a branch, or the branch as a whole. */
export interface UnitNode {
  unit: Unit;
  ceiling: Set<string>;
  selected: Set<string>;
  /** What the server holds for this unit right now — what a cleared unit goes back to. */
  saved: Set<string>;
  modules: ModuleNode[];
  state: TickState;
  screensOn: number;
  screensTotal: number;
  lockedScreens: number;
  /** Screens the caller MAY tick and has not — never the locked ones, which are not his to tick. */
  untickedScreens: number;
  actionsOn: number;
  actionsTotal: number;
  /** Nothing here is the caller's to grant: the block explains a refusal, it is not a control. */
  editable: boolean;
  /** Everything shown is ticked — the line reads «all actions» rather than a pair of numbers. */
  everything: boolean;
  /** Ticked, and nothing but «view» — the one shape worth naming, because it is the common one. */
  viewOnly: boolean;
  /**
   * Nothing here is drawable — the caller can grant nothing and the account holds nothing.
   *
   * Distinct from `editable`, which says only that the CEILING is empty. A unit can be uneditable
   * and still worth drawing, because the account holds a grant in it that somebody with more
   * authority made. This one means the node has no rows at all, and the level above drops it.
   */
  empty: boolean;
}

export interface DepartmentNode extends UnitNode {
  id: string;
  name: LocalizedString;
  /** The branch grant is on, so this department rides on it and its own table is moot. */
  coveredByBranch: boolean;
}

export interface BranchNode {
  id: string;
  name: LocalizedString;
  /** The branch as one unit — its own record, never a «tick all the departments» shortcut. */
  whole: UnitNode;
  departments: DepartmentNode[];
  state: TickState;
  departmentsOn: number;
  departmentsTotal: number;
}

const VIEW_ACTION = 'view';
const OTHER_SCREEN = 'other';

const screenOf = (
  row: GridRow,
  selected: Selection,
  ceiling: Selection,
  saved: Selection,
): ScreenNode => ({
  id: row.page?.id ?? OTHER_SCREEN,
  page: row.page,
  row,
  state: pageState(selected, row),
  on: row.keys.filter((k) => selected.has(k.key)).length,
  total: row.keys.length,
  savedOn: row.keys.filter((k) => saved.has(k.key)).length,
  grantable: row.keys.some((k) => ceiling.has(k.key)),
});

/** The registry's own grouping, module by module, with the no-page bucket last. */
const groupByModule = (screens: readonly ScreenNode[]): ModuleNode[] => {
  const groups: ModuleNode[] = [];
  for (const screen of screens) {
    const moduleId = screen.page?.moduleId ?? null;
    const found = groups.find((g) => g.moduleId === moduleId);
    if (found === undefined) {
      groups.push({
        moduleId,
        screens: [screen],
        on: 0,
        total: 0,
        savedOn: 0,
        grantableScreens: 0,
        openByDefault: false,
      });
    } else found.screens.push(screen);
  }
  for (const group of groups) {
    group.on = group.screens.filter((s) => s.on > 0).length;
    group.total = group.screens.length;
    group.savedOn = group.screens.filter((s) => s.savedOn > 0).length;
    group.grantableScreens = group.screens.filter((s) => s.grantable).length;
  }
  const ordered = [...groups].sort((a, b) => (a.moduleId === null ? 1 : b.moduleId === null ? -1 : 0));
  const lead = ordered.find((g) => g.grantableScreens > 0);
  for (const group of ordered) {
    group.openByDefault = group.savedOn > 0 || group === lead;
  }
  return ordered;
};

/**
 * The screens this unit actually puts on the screen.
 *
 * «ادام حاجة مليش عليها اكسس مشوفهاش اصلا». A screen the caller cannot grant here is not drawn
 * greyed with a reason on it — it is not drawn. The earlier rendering made him read every row in
 * the registry to find the four that were his, and argued with him about the rest: «أكتوبر فيه
 * أربع شاشات، يظهروا الأربعة؛ ما يظهرش باقي الشاشات ويقولّي مش مسموح لك».
 *
 * One exception, and it is not a softening of the rule: a screen THIS ACCOUNT ALREADY HOLDS stays,
 * even when the caller cannot grant it. That is not «a thing I have no access to» — it is a thing
 * the person in front of him HAS, and a grant that vanishes because the reader lacks the authority
 * to change it reads as a grant that was removed. The same asymmetry the role editor applies to a
 * key a role carries that its editor could not have granted.
 */
const visibleScreens = (screens: readonly ScreenNode[]): ScreenNode[] =>
  screens.filter((s) => s.grantable || s.on > 0 || s.savedOn > 0);

const buildUnit = (
  cat: DelegationCatalogDto,
  unit: Unit,
  selected: Selection,
  saved: Selection,
  readOnly: ReadonlySet<string>,
): UnitNode => {
  const ceiling = readOnly.has(unitKey(unit)) ? new Set<string>() : ceilingOf(cat, unit);
  const rows = buildRows(cat, ceiling, saved);
  const screens = visibleScreens(rows.map((row) => screenOf(row, selected, ceiling, saved)));
  const actionsOn = screens.reduce((n, s) => n + s.on, 0);
  const actionsTotal = screens.reduce((n, s) => n + s.total, 0);
  const ticked = screens.flatMap((s) => s.row.keys.filter((k) => selected.has(k.key)));
  return {
    unit,
    ceiling,
    selected: new Set(selected),
    saved: new Set(saved),
    modules: groupByModule(screens),
    state: actionsOn === 0 ? 'none' : actionsOn === actionsTotal ? 'all' : 'some',
    screensOn: screens.filter((s) => s.on > 0).length,
    screensTotal: screens.length,
    lockedScreens: screens.filter((s) => !s.grantable).length,
    untickedScreens: screens.filter((s) => s.grantable && s.on === 0).length,
    actionsOn,
    actionsTotal,
    editable: ceiling.size > 0,
    everything: actionsTotal > 0 && actionsOn === actionsTotal,
    viewOnly: ticked.length > 0 && ticked.every((k) => k.action === VIEW_ACTION),
    // Nothing survived the filter, so there is nothing here to show OR to explain. The level above
    // drops the whole node rather than drawing a heading over an empty list.
    empty: screens.length === 0,
  };
};

/**
 * Branches and departments the caller does not delegate in, but that this account already holds a
 * grant in — or that are its own placement — folded into the catalog with nothing grantable.
 *
 * They must be SEEN: a grant that vanishes from the screen because the reader lost the authority
 * to change it reads as a grant that was removed.
 */
export interface MergedCatalog {
  catalog: DelegationCatalogDto;
  /**
   * The units this function invented — ones the catalog did not offer.
   *
   * They must be read-only whatever else is true of their branch. A department the server no
   * longer lists (soft-deleted after a grant was written on it) would otherwise inherit its
   * branch's whole-branch keys through `ceilingOf`, render as a perfectly ordinary editable row,
   * and produce a PUT the server answers «Unknown department» — which aborts the save loop and
   * strands every unit queued behind it.
   */
  readOnly: Set<string>;
}

export const withSavedUnits = (
  cat: DelegationCatalogDto,
  grants: readonly DelegationDto[],
  home: HomeUnit | null,
): MergedCatalog => {
  const readOnly = new Set<string>();
  const unnamed = (id: string): LocalizedString => ({ ar: id, en: id });
  const branches = cat.branches.map((b) => ({ ...b, departments: [...b.departments] }));
  const add = (
    branchId: string,
    branchName: LocalizedString,
    departmentId: string | null,
    departmentName: LocalizedString,
  ): void => {
    let branch = branches.find((b) => b.id === branchId);
    if (branch === undefined) {
      branch = { id: branchId, name: branchName, permissionKeys: [], departments: [] };
      branches.push(branch);
      readOnly.add(unitKey({ branchId, departmentId: null }));
    }
    if (departmentId !== null && !branch.departments.some((d) => d.id === departmentId)) {
      branch.departments.push({ id: departmentId, name: departmentName, permissionKeys: [] });
      readOnly.add(unitKey({ branchId, departmentId }));
    }
  };
  for (const grant of grants) {
    add(
      grant.branch.id,
      grant.branch.name,
      grant.department?.id ?? null,
      grant.department?.name ?? unnamed(grant.branch.id),
    );
  }
  if (home !== null) {
    add(
      home.branchId,
      home.branchName ?? unnamed(home.branchId),
      home.departmentId,
      home.departmentName ?? unnamed(home.departmentId ?? home.branchId),
    );
    // The account's own unit first, at both levels: it is the one being asked about nine times in
    // ten, and a manager should not scroll past four branches to reach the one his colleague is in.
    const first = <T extends { id: string }>(items: T[], id: string | null): T[] =>
      id === null ? items : [...items.filter((x) => x.id === id), ...items.filter((x) => x.id !== id)];
    for (const branch of branches) {
      if (branch.id === home.branchId) branch.departments = first(branch.departments, home.departmentId);
    }
    return { catalog: { ...cat, branches: first(branches, home.branchId) }, readOnly };
  }
  return { catalog: { ...cat, branches }, readOnly };
};

/**
 * The whole tree for one account: every branch the caller may work in here, its whole-branch
 * record, and its departments.
 *
 * `selectedOf` and `savedOf` are read per unit rather than passed as one map so the caller keeps
 * one source of truth for drafts — the tree is a projection, never a second copy of the state.
 */
export const buildTree = (
  cat: DelegationCatalogDto,
  selectedOf: (unit: Unit) => Selection,
  savedOf: (unit: Unit) => Selection,
  readOnly: ReadonlySet<string> = new Set(),
): BranchNode[] =>
  cat.branches
    .map((branch) => {
      const wholeUnit: Unit = { branchId: branch.id, departmentId: null };
      const whole = buildUnit(cat, wholeUnit, selectedOf(wholeUnit), savedOf(wholeUnit), readOnly);
      const departments = branch.departments
        .map((department): DepartmentNode => {
          const unit: Unit = { branchId: branch.id, departmentId: department.id };
          const node = buildUnit(cat, unit, selectedOf(unit), savedOf(unit), readOnly);
          return {
            ...node,
            id: department.id,
            name: department.name,
            coveredByBranch: carries(whole, node),
          };
        })
        // A department whose every screen was filtered away is dropped whole. The rule reads the
        // same one level up as it does one level down: «اللي مسموح لي يظهر لي بس». A heading left
        // standing over an empty list is the greyed row wearing a different hat — it still makes
        // the reader open something to find out there was nothing behind it.
        .filter((department) => !department.empty);
      const departmentsOn = departments.filter((d) => d.state !== 'none').length;
      const node: BranchNode = {
        id: branch.id,
        name: branch.name,
        whole,
        departments,
        state:
          whole.state === 'all'
            ? 'all'
            : whole.state !== 'none' || departmentsOn > 0
              ? 'some'
              : 'none',
        departmentsOn,
        departmentsTotal: departments.length,
      };
      return node;
    })
    // And a branch with no departments left AND nothing on its own record is not a branch this
    // caller works in at all. «طب أنا إيه لازمتها تظهر لي فرع المهندسين وأسيوط وطنطا وأنا مش
    // مسموح لي بحاجة؟»
    .filter((branch) => branch.departments.length > 0 || !branch.whole.empty);

/**
 * Does the branch record carry this department whole — nothing left here to decide?
 *
 * Only then may the department be drawn as a locked «مشمولة في منح الفرع كله» row, because only
 * then is there nothing behind the lock. Three conditions, and each one is a bug that was found by
 * leaving it out:
 *
 *   • the branch record has to hold something at all;
 *   • it has to already hold everything the caller could grant in this department — a department
 *     ceiling can carry keys the branch's does not, and those are still his to give;
 *   • the department must hold nothing of its own, or the lock would hide a grant. That includes a
 *     grant from somebody with more authority than the caller, which he may not touch but must
 *     still be able to SEE.
 *
 * The middle one is what stops a department-level manager from being locked out of his own
 * department by a whole-branch grant that somebody above him made and he cannot edit.
 */
const carries = (whole: UnitNode, department: UnitNode): boolean =>
  whole.actionsOn > 0 &&
  department.actionsOn === 0 &&
  [...department.ceiling].every((key) => whole.selected.has(key));

/** Everything the caller may grant in this unit, or none of it. Locked keys never move. */
export const setAll = (selected: Selection, ceiling: Selection, on: boolean): Set<string> => {
  const next = new Set(selected);
  for (const key of ceiling) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
};

/**
 * Clearing a whole branch: the draft each of its units is left with.
 *
 * Only what the caller could have ticked is removed — a key somebody with more authority granted
 * survives a clear at every level, exactly as it survives one on a single screen.
 */
export const clearBranch = (branch: BranchNode): Record<string, string[]> => {
  const drafts: Record<string, string[]> = {};
  for (const unit of [branch.whole, ...branch.departments]) {
    drafts[unitKey(unit.unit)] = [...setAll(unit.selected, unit.ceiling, false)].sort();
  }
  return drafts;
};

/**
 * How many keys the caller could remove across a branch — the branch-level clear's whole reason to
 * exist, and the test for whether to offer it at all.
 */
export const clearableIn = (branch: BranchNode): number =>
  [branch.whole, ...branch.departments].reduce(
    (n, unit) => n + [...unit.selected].filter((key) => unit.ceiling.has(key)).length,
    0,
  );

/** One line of «what this person will see», per unit that ends up with something on it. */
export interface GrantLine {
  unit: Unit;
  branch: LocalizedString;
  /** `null` for the whole-branch grant, whose line names no department by design. */
  department: LocalizedString | null;
  screens: number;
  actions: number;
  everything: boolean;
  viewOnly: boolean;
}

/**
 * The summary, read off the tree rather than the drafts — a department carried by its branch grant
 * is not a second line, because on the server it is not a second thing the person gained.
 */
export const grantLines = (tree: readonly BranchNode[]): GrantLine[] =>
  tree.flatMap((branch) => {
    const line = (unit: UnitNode, department: LocalizedString | null): GrantLine[] =>
      unit.actionsOn === 0
        ? []
        : [
            {
              unit: unit.unit,
              branch: branch.name,
              department,
              screens: unit.screensOn,
              actions: unit.actionsOn,
              everything: unit.everything,
              viewOnly: unit.viewOnly,
            },
          ];
    const whole = line(branch.whole, null);
    if (whole.length > 0) return whole;
    return branch.departments.flatMap((d) => line(d, d.name));
  });
