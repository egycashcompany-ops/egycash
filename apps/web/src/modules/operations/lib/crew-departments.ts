// Which HR departments ARE the operations crew (`operations.crewDepartmentIds`).
//
// This exists because the setting is a list of ObjectIds. Typed into a text box in system settings
// it is unreadable, unverifiable, and — the way it actually failed — never set at all: the roster
// silently fell back to whoever already had a requirements row, so a driver configured months ago
// showed and two new hires did not. The picker turns the setting into department NAMES on the
// screen where the absence is noticed.
//
// The one rule worth a module of its own is `known`. `/platform/departments/options` lists ACTIVE
// departments; a configured id that has since been deactivated or deleted is not in that list, and
// a picker built from the list alone would not render it. It would then be invisible AND still
// stored — the same silent-configuration failure one level down. So a selected id with no option
// behind it gets a row of its own, labelled as unknown, and can be unticked.
import { type Locale } from '@ecms/contracts';

export interface DepartmentOption {
  id: string;
  code: string;
  name: { ar: string; en: string };
}

export interface DepartmentChoice {
  id: string;
  /** The department's name, or null when nothing active answers to this id any more. */
  label: string | null;
  code: string | null;
  selected: boolean;
  known: boolean;
}

/**
 * Every active department plus every selected id, in that order. Options keep the server's
 * ordering (by code); the unknown ones follow so the list an administrator reads day to day is
 * not reshuffled by a stale id.
 */
export const departmentChoices = (
  options: readonly DepartmentOption[],
  selectedIds: readonly string[],
  locale: Locale,
): DepartmentChoice[] => {
  const selected = new Set(selectedIds);
  const known = new Set(options.map((option) => option.id));
  const rows: DepartmentChoice[] = options.map((option) => ({
    id: option.id,
    label: locale === 'ar' ? option.name.ar : option.name.en,
    code: option.code,
    selected: selected.has(option.id),
    known: true,
  }));
  for (const id of selectedIds) {
    if (known.has(id)) continue;
    rows.push({ id, label: null, code: null, selected: true, known: false });
  }
  return rows;
};

/** Tick / untick, preserving the order of what stays — a saved list should not churn. */
export const toggleDepartment = (selected: readonly string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];

/**
 * Same SET, whatever the order — the Save button asks "did anything change?", and a list that
 * came back from the server in another order has not changed.
 */
export const sameDepartments = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id)) && seen.size === new Set(b).size;
};
