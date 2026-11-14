// One company department, however many branches have it — the rule a screen and the server share.
//
// The owner, on the Operations crew card that listed «نقل الاموال» seven times and «العمليات» six:
// «القائمة دي كانت معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع.
// فإحنا عايزين نعدل الموضوع ده». A department is one org unit PER BRANCH (P-ORG-2 explains why the
// rows must stay apart), so a picker built from the rows lists the storage, not the company. What
// the company has is the catalog entry the rows declare — and, for a row never linked to one, its
// name, read the way a person reads it.
//
// Here, and not in one app, because two readers must agree on it to the letter: the card that
// GROUPS the rows into choices, and the server that EXPANDS a saved choice back into rows when it
// works out who the crew is. A fold that differed between them would show a department as chosen
// on the screen while the roster quietly left one of its branches out.

/** The three facts grouping needs — `OrgUnitOptionDto` has them, and so does a department row. */
export interface OrgUnitGroupSource {
  id: string;
  name: { ar: string; en: string };
  /** The company-wide catalog entry this branch row is a copy of, or null when never linked. */
  catalogId: string | null;
}

/**
 * An org-unit name folded for "is this the same department?".
 *
 * The importer's spellings, which are the company's: «نقل الاموال» and «نقل الأموال», «الإدارة» and
 * «الاداره», «الرقابة و المستهلكات» and «الرقابة والمستهلكات», «التشغيل ( ادارى )» and «التشغيل
 * (إدارى)». Marks a reader does not see (direction marks, tatweel, tashkeel) are dropped; the hamza
 * forms, final ya and ta marbuta are folded; brackets and runs of spaces stop counting; and a «و»
 * standing alone is joined to the word it introduces, as `orgKey` (workforce-import) does.
 *
 * MATCHING ONLY. What a screen prints is a unit's own name, never this.
 */
export const foldOrgUnitName = (value: string): string =>
  value
    .replace(/[​-‏‪-‮⁦-⁩﻿]/gu, '')
    .toLowerCase()
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[()[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/ و /gu, ' و')
    .trim();

/** The folded Arabic name, else the folded English one, else nothing to fold by. */
const nameKey = (unit: OrgUnitGroupSource): string | null => {
  const ar = foldOrgUnitName(unit.name.ar);
  if (ar !== '') return ar;
  const en = foldOrgUnitName(unit.name.en);
  return en === '' ? null : en;
};

/**
 * Every unit's GROUP — the company department it is a branch copy of — as `id → key`.
 *
 *   · Linked to a catalog entry: `catalog:<catalogId>`. The catalog IS what "the same department"
 *     means to the company, whatever any one branch calls its copy.
 *   · Never linked: the catalog group whose units carry the same folded name, when exactly ONE
 *     does — «العمليات» created in a new branch before anyone linked it is still the company's
 *     «العمليات», and listing it twice is the duplication being removed. Two catalog entries
 *     sharing a name is a question nobody here can answer, so then (and when no catalog shares
 *     it) the unit groups by `name:<folded>` with the other unlinked units of that name.
 *   · A name that folds to nothing groups by `unit:<id>`, alone, rather than with every other
 *     nameless unit.
 *
 * The answer depends on the whole population (a name joins a catalog only if one is present), so
 * both readers pass the SAME population: every department, the inactive ones too.
 */
export const orgUnitGroupKeys = (units: readonly OrgUnitGroupSource[]): Map<string, string> => {
  const catalogsByName = new Map<string, Set<string>>();
  for (const unit of units) {
    if (unit.catalogId === null) continue;
    const name = nameKey(unit);
    if (name === null) continue;
    const set = catalogsByName.get(name) ?? new Set<string>();
    set.add(`catalog:${unit.catalogId}`);
    catalogsByName.set(name, set);
  }

  const keys = new Map<string, string>();
  for (const unit of units) {
    if (unit.catalogId !== null) {
      keys.set(unit.id, `catalog:${unit.catalogId}`);
      continue;
    }
    const name = nameKey(unit);
    if (name === null) {
      keys.set(unit.id, `unit:${unit.id}`);
      continue;
    }
    const catalogs = catalogsByName.get(name);
    const onlyCatalog = catalogs !== undefined && catalogs.size === 1 ? [...catalogs][0] : undefined;
    keys.set(unit.id, onlyCatalog ?? `name:${name}`);
  }
  return keys;
};

/**
 * A saved list of units, widened to every ELIGIBLE unit of the same company departments.
 *
 * The saved ids come first, in their order, each once — every one of them stays, whatever its
 * state, so the answer is never narrower than the list itself. Then every eligible unit (the
 * caller passes the active ones) whose group one of the saved ids belongs to: the same department
 * in the other branches, including a branch that opened after the list was saved. A saved id the
 * population does not know (deleted since) widens to nothing and stays harmless: nobody works in
 * a unit that is not there.
 */
export const expandOrgUnitSelection = (
  selectedIds: readonly string[],
  population: readonly OrgUnitGroupSource[],
  eligible: readonly OrgUnitGroupSource[],
): string[] => {
  const byId = new Map<string, OrgUnitGroupSource>();
  for (const unit of [...population, ...eligible]) byId.set(unit.id.toLowerCase(), unit);
  const keys = orgUnitGroupKeys([...byId.values()].map((unit) => ({ ...unit, id: unit.id.toLowerCase() })));

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    const lower = id.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(lower);
  };

  const chosen = new Set<string>();
  for (const id of selectedIds) {
    add(id);
    const key = keys.get(id.toLowerCase());
    if (key !== undefined) chosen.add(key);
  }
  for (const unit of eligible) {
    const key = keys.get(unit.id.toLowerCase());
    if (key !== undefined && chosen.has(key)) add(unit.id);
  }
  return out;
};
