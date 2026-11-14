// Which COMPANY departments are the operations crew (`operations.crewDepartmentIds`) — the card's
// rules, without the card.
//
// The owner, of the card that listed «نقل الاموال» seven times and «العمليات» six: «القائمة دي كانت
// معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع. فإحنا عايزين نعدل
// الموضوع ده». A department is one org unit per branch, and the card used to offer each unit. Now it
// offers each department ONCE — the branch copies of one catalog entry, or of one name for a copy
// never linked (`orgUnitGroupKeys`, the rule the server's roster reads too) — and says how many
// branches have it, and which.
//
// WHAT IS SAVED. Still department ids: every active branch copy of each chosen department (and any
// id already saved for it, kept as it was). The server reads a saved id as its whole department, a
// branch opened later included, so the ids only have to name the department; saving all of its
// copies means it stays named if one branch's copy is ever deleted.
//
// THE `known` RULE, CARRIED. The options list ACTIVE units. A saved id whose unit has since been
// deactivated still names its department (the inactive units are read too), so it is shown under
// that department; one nothing answers to any more gets a choice of its own, labelled as unknown,
// and can be unticked — a configuration you cannot see is the failure this card was built to end.
import { foldOrgUnitName, orgUnitGroupKeys, type Locale, type OrgUnitOptionDto } from '@ecms/contracts';

type Name = { ar: string; en: string };

export interface CrewDepartmentBranch {
  id: string;
  /** Null when the branch cannot be named (not in the list that was read). */
  name: string | null;
}

export interface CrewDepartmentChoice {
  /** The group key (`orgUnitGroupKeys`), or `unknown:<id>` for a saved id nothing answers to. */
  key: string;
  /** The department's name in the reader's locale; null for an unknown id. */
  label: string | null;
  /** The ACTIVE branch copies — what ticking this covers today. */
  activeIds: string[];
  /** Every unit the choice stands for, inactive included — what unticking it takes away. */
  memberIds: string[];
  /** The branches that have it (its active copies'; a deactivated department's own, else). */
  branches: CrewDepartmentBranch[];
  /**
   * `active`: at least one branch has it now. `inactive`: saved, but every copy is deactivated.
   * `unknown`: saved, and nothing answers to the id any more.
   */
  state: 'active' | 'inactive' | 'unknown';
}

const nameIn = (name: Name, locale: Locale): string =>
  locale === 'ar' ? name.ar : name.en.trim() === '' ? name.ar : name.en;

/**
 * The name a department is shown by: a catalog-linked copy's (the catalog's own spelling, copied
 * onto every linked row), else the lowest code's — a fixed choice, so the label never depends on
 * which copy the server listed first.
 */
const displayUnit = (units: readonly OrgUnitOptionDto[]): OrgUnitOptionDto | undefined =>
  [...units].sort(
    (a, b) =>
      Number(a.catalogId === null) - Number(b.catalogId === null) || a.code.localeCompare(b.code),
  )[0];

const STATE_ORDER: Record<CrewDepartmentChoice['state'], number> = {
  active: 0,
  inactive: 1,
  unknown: 2,
};

/**
 * One choice per company department, plus one per saved id nothing answers to.
 *
 * `all` is every department, the inactive ones too — the population a saved id is grouped by, as
 * the server groups it. When it could not be read, the active list stands in: a saved id of a
 * deactivated copy then shows as unknown, which is less precise but never hides it.
 *
 * ORDER: what is SAVED first, then the rest — each part alphabetical. Saved, not ticked: the order
 * is decided by what the server holds, so a tile does not jump away from the pointer that ticks it.
 */
export const crewDepartmentChoices = ({
  active,
  all,
  branchNames,
  storedIds,
  locale,
}: {
  active: readonly OrgUnitOptionDto[];
  all?: readonly OrgUnitOptionDto[] | undefined;
  branchNames: ReadonlyMap<string, Name>;
  storedIds: readonly string[];
  locale: Locale;
}): CrewDepartmentChoice[] => {
  const population = new Map<string, OrgUnitOptionDto>();
  for (const unit of [...(all ?? []), ...active]) population.set(unit.id.toLowerCase(), unit);
  const keys = orgUnitGroupKeys([...population.values()]);
  const activeIds = new Set(active.map((unit) => unit.id.toLowerCase()));
  const stored = new Set(storedIds.map((id) => id.toLowerCase()));

  const groups = new Map<string, OrgUnitOptionDto[]>();
  for (const unit of population.values()) {
    const key = keys.get(unit.id) ?? `unit:${unit.id}`;
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }

  const choices: CrewDepartmentChoice[] = [];
  const savedKeys = new Set<string>();
  for (const [key, units] of groups) {
    const live = units.filter((unit) => activeIds.has(unit.id.toLowerCase()));
    const saved = units.some((unit) => stored.has(unit.id.toLowerCase()));
    // A department nobody has any more is offered only while the setting still names it.
    if (live.length === 0 && !saved) continue;
    const shown = displayUnit(live.length > 0 ? live : units);
    const branchIds = [
      ...new Set((live.length > 0 ? live : units).flatMap((unit) => unit.parentId ?? [])),
    ];
    const branches = branchIds
      .map((id) => {
        const name = branchNames.get(id);
        return { id, name: name === undefined ? null : nameIn(name, locale) };
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'));
    choices.push({
      key,
      label: shown === undefined ? null : nameIn(shown.name, locale),
      activeIds: live.map((unit) => unit.id),
      memberIds: units.map((unit) => unit.id),
      branches,
      state: live.length > 0 ? 'active' : 'inactive',
    });
    if (saved) savedKeys.add(key);
  }

  const seenUnknown = new Set<string>();
  for (const id of storedIds) {
    const lower = id.toLowerCase();
    if (population.has(lower) || seenUnknown.has(lower)) continue;
    seenUnknown.add(lower);
    choices.push({
      key: `unknown:${lower}`,
      label: null,
      activeIds: [],
      memberIds: [id],
      branches: [],
      state: 'unknown',
    });
    savedKeys.add(`unknown:${lower}`);
  }

  return choices.sort(
    (a, b) =>
      Number(savedKeys.has(b.key)) - Number(savedKeys.has(a.key)) ||
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.label ?? '').localeCompare(b.label ?? '', 'ar') ||
      a.key.localeCompare(b.key),
  );
};

/** The choices the saved list ticks — a department is chosen when ANY of its copies is saved. */
export const savedChoiceKeys = (
  choices: readonly CrewDepartmentChoice[],
  storedIds: readonly string[],
): string[] => {
  const stored = new Set(storedIds.map((id) => id.toLowerCase()));
  return choices
    .filter((choice) => choice.memberIds.some((id) => stored.has(id.toLowerCase())))
    .map((choice) => choice.key);
};

/** Tick / untick one department, keeping the order of what stays. */
export const toggleChoice = (keys: readonly string[], key: string): string[] =>
  keys.includes(key) ? keys.filter((each) => each !== key) : [...keys, key];

/** Same SET of departments, whatever the order — what «حفظ» and «تراجع» ask. */
export const sameChoices = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
};

/**
 * The setting's new value for the ticked departments.
 *
 * Per chosen department: the ids already saved for it, as they were (the roster is never narrowed
 * by a save that did not mean to), then every active copy not yet among them. A deactivated
 * department and an unknown id keep exactly what was saved. Each id once, in the choices' order.
 */
export const crewDepartmentPayload = (
  choices: readonly CrewDepartmentChoice[],
  keys: readonly string[],
  storedIds: readonly string[],
): string[] => {
  const chosen = new Set(keys);
  const stored = new Set(storedIds.map((id) => id.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    const lower = id.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(id);
  };
  for (const choice of choices) {
    if (!chosen.has(choice.key)) continue;
    for (const id of choice.memberIds) if (stored.has(id.toLowerCase())) add(id);
    for (const id of choice.activeIds) add(id);
  }
  return out;
};

/**
 * Does a choice answer the search box? By its name or by a branch that has it — both are on the
 * tile, so whatever the reader can see, they can find. Folded like the grouping, so «الاموال» finds
 * «الأموال».
 */
export const choiceMatches = (choice: CrewDepartmentChoice, query: string): boolean => {
  const needle = foldOrgUnitName(query);
  if (needle === '') return true;
  const hay = [choice.label ?? '', ...choice.branches.map((branch) => branch.name ?? '')];
  return hay.some((text) => foldOrgUnitName(text).includes(needle));
};
