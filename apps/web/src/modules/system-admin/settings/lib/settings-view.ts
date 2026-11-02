// Turning the settings registry into a screen — and being honest about the three things the
// registry does not tell us.
//
// **1. The definition carries a TYPE, never a constraint.** `SettingDefinitionDto.type` is derived
// from the Zod type name (`settings.service.listDefinitions`), so `number` arrives without its
// `.min(8).max(64)`, `string` without its regex, `array` without its element enum. Guessing any of
// them here would produce a client that refuses values the server accepts, or — worse — accepts
// values it rejects and blames the user for a rule this file invented. So nothing below validates.
// The only thing it does is PARSE: turning the text in an input into the JSON type the key was
// declared as. A parse failure is "this is not a number", never "this number is too small"; the
// second sentence belongs to the server and arrives from it.
//
// **2. `GET /settings/me` resolves for the CALLER, not for the organization.** There is no endpoint
// that reads the raw organization value, and this slice adds none. So a key the caller has a
// personal or branch override for shows THEIR value while this screen writes the organization's —
// and the two need not agree. `resolvedFrom` is in the DTO precisely so that can be said out loud
// rather than looking like a save that did nothing. `shadowed` below is that flag.
//
// **3. A definition this file does not recognise still belongs on screen.** An unplaced key and an
// unhandled Zod type are both "the registry grew and this screen has not caught up", which is not a
// reason to hide a configurable value from the person who administers it. Unplaced keys go to their
// department's «more» section, or to Other; unhandled types render read-only. Nothing is ever
// dropped — `buildSettingGroups` returns exactly as many rows as it was given definitions, and a
// test pins that.
import { type ResolvedSettingDto, type SettingDefinitionDto } from '@ecms/contracts';
import { foldIncludes } from '../../../../shared/lib/fold';
import {
  MANAGED_ELSEWHERE,
  RETIRED_SETTINGS,
  SETTING_DEPARTMENTS,
  SETTING_SECTIONS,
  placementOf,
  type ManagedElsewhere,
  type SettingDepartment,
  type SettingPlacement,
} from './settings-catalog';

/** How a value is edited. `readonly` is the honest answer for a type this screen cannot render. */
export type SettingEditor = 'boolean' | 'number' | 'text' | 'list' | 'readonly';

export interface SettingRowModel {
  key: string;
  placement: SettingPlacement;
  definition: SettingDefinitionDto;
  /** The caller's resolved value. Absent while `/settings/me` is in flight. */
  resolved: ResolvedSettingDto | null;
  editor: SettingEditor;
  /**
   * The displayed value comes from a layer this screen does not write (`user` or `branch`), so
   * editing the organization value will not change the number above it.
   */
  shadowed: boolean;
  /** Edited on its own screen (a structure of ids or rows): this row links there. */
  managedAt: ManagedElsewhere | null;
  /** Declared but read by nothing: changing it changes nothing. */
  retired: boolean;
}

export interface SettingSectionModel {
  id: string;
  rows: SettingRowModel[];
}

export interface SettingDepartmentModel {
  department: SettingDepartment;
  sections: SettingSectionModel[];
}

export const editorFor = (type: string): SettingEditor => {
  switch (type) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'text';
    case 'array':
      return 'list';
    default:
      return 'readonly';
  }
};

/**
 * Group the registry for display: department, then section, in the order `settings-catalog`
 * declares them. Inside a section the rows keep the order their module DECLARES them in — password
 * length before complexity before lockout — which reads as the module meant it; sorting by key put
 * «صلاحية رابط التفعيل» above «الحد الأدنى لطول كلمة المرور». That order is stable: a section's
 * keys come from one declaration file, and the definitions arrive in declaration order (only the
 * order BETWEEN modules follows boot, and departments and sections fix that). Empty departments
 * and sections are left out.
 */
export const buildSettingGroups = (
  definitions: readonly SettingDefinitionDto[],
  resolved: readonly ResolvedSettingDto[],
): SettingDepartmentModel[] => {
  const byKey = new Map(resolved.map((entry) => [entry.key, entry]));
  const buckets = new Map<string, SettingRowModel[]>();
  const bucketOf = (placement: SettingPlacement): string => `${placement.department}/${placement.section}`;

  for (const definition of definitions) {
    const placement = placementOf(definition.key);
    const value = byKey.get(definition.key) ?? null;
    const row: SettingRowModel = {
      key: definition.key,
      placement,
      definition,
      resolved: value,
      editor: editorFor(definition.type),
      shadowed: value !== null && (value.resolvedFrom === 'user' || value.resolvedFrom === 'branch'),
      managedAt: MANAGED_ELSEWHERE[definition.key] ?? null,
      retired: RETIRED_SETTINGS.has(definition.key),
    };
    const bucket = buckets.get(bucketOf(placement));
    if (bucket === undefined) buckets.set(bucketOf(placement), [row]);
    else bucket.push(row);
  }

  return SETTING_DEPARTMENTS.flatMap((department) => {
    const sections = SETTING_SECTIONS[department].flatMap((id) => {
      const rows = buckets.get(`${department}/${id}`);
      return rows === undefined ? [] : [{ id, rows }];
    });
    return sections.length === 0 ? [] : [{ department, sections }];
  });
};

/** How many settings a department (or the whole screen) holds. */
export const countRows = (groups: readonly SettingDepartmentModel[]): number =>
  groups.reduce(
    (sum, group) => sum + group.sections.reduce((inner, section) => inner + section.rows.length, 0),
    0,
  );

/**
 * Search and the department filter.
 *
 * The label and the description are translations, which this file cannot resolve — so the caller
 * passes in what a row reads as on screen (its label and description in the current language). A
 * search on the key alone would be useless in Arabic; one on the text alone, useless for someone
 * searching the key they read in a config file. Both, plus the English description the server sends.
 *
 * An empty department filter means "all". A section that loses every row disappears, and so does a
 * department that loses every section.
 */
export const filterSettingGroups = (
  groups: readonly SettingDepartmentModel[],
  query: string,
  department: string,
  textOf: (row: SettingRowModel) => string,
): SettingDepartmentModel[] => {
  // Folded as every search box in the app folds: «الاسماعيليه» finds «الإسماعيلية», «١٥» finds 15.
  const matches = (row: SettingRowModel): boolean =>
    foldIncludes(row.key, query) ||
    foldIncludes(row.definition.description, query) ||
    foldIncludes(textOf(row), query);
  return groups.flatMap((group) => {
    if (department !== '' && group.department !== department) return [];
    const sections = group.sections.flatMap((section) => {
      const rows = section.rows.filter(matches);
      return rows.length === 0 ? [] : [{ id: section.id, rows }];
    });
    return sections.length === 0 ? [] : [{ department: group.department, sections }];
  });
};

/**
 * Why a row cannot be edited here — different answers that must not be collapsed into one disabled
 * control with no explanation.
 *
 * `not-organization-scoped` cannot happen with today's declarations (all of them allow
 * `organization`), and it is here because the alternative is a screen that silently sends a scope
 * the server will refuse with 422. This slice writes organization values only — by design, since a
 * branch or user write needs a subject to write it for, and that is a different screen.
 */
export const ROW_EDITABILITIES = [
  'editable',
  'no-permission',
  'retired',
  'managed-elsewhere',
  'unsupported-type',
  'not-organization-scoped',
] as const;
export type RowEditability = (typeof ROW_EDITABILITIES)[number];

export const rowEditability = (row: SettingRowModel, canEdit: boolean): RowEditability => {
  if (!canEdit) return 'no-permission';
  // A retired value changes nothing, and a structure with its own screen is edited there: neither
  // is offered as a field here, whatever its type.
  if (row.retired) return 'retired';
  if (row.managedAt !== null) return 'managed-elsewhere';
  if (!row.definition.allowedScopes.includes('organization')) return 'not-organization-scoped';
  if (row.editor === 'readonly') return 'unsupported-type';
  return 'editable';
};

// ── Values: text in an input ⇄ the JSON type the key was declared as ─────────

export const PARSE_FAILURES = ['not-a-number', 'not-a-number-list', 'not-editable'] as const;
export type ParseFailure = (typeof PARSE_FAILURES)[number];
export type ParsedValue = { ok: true; value: unknown } | { ok: false; reason: ParseFailure };

/**
 * A list's element type, read from the DEFAULT rather than declared anywhere.
 *
 * `SettingDefinitionDto` says `array` and stops, so the only evidence available is what the code
 * default contains — `[5, 6]` for weekend days, `['username', …]` for login identifiers. An empty
 * default carries no evidence at all and falls back to strings; the server is what refuses either
 * way, so the cost of guessing wrong is a clear 422 rather than a corrupted value.
 */
export const listElementKind = (defaultValue: unknown): 'number' | 'string' =>
  Array.isArray(defaultValue) &&
  defaultValue.length > 0 &&
  defaultValue.every((element) => typeof element === 'number')
    ? 'number'
    : 'string';

export const serializeValue = (value: unknown, editor: SettingEditor): string => {
  switch (editor) {
    case 'boolean':
      return value === true ? 'true' : 'false';
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    case 'text':
      return typeof value === 'string' ? value : '';
    case 'list':
      return Array.isArray(value) ? value.map((element) => String(element)).join(', ') : '';
    case 'readonly':
      return JSON.stringify(value ?? null);
  }
};

export const parseValue = (
  raw: string,
  editor: SettingEditor,
  defaultValue: unknown,
): ParsedValue => {
  switch (editor) {
    case 'boolean':
      return { ok: true, value: raw === 'true' };
    case 'number': {
      const trimmed = raw.trim();
      if (trimmed === '') return { ok: false, reason: 'not-a-number' };
      const parsed = Number(trimmed);
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: 'not-a-number' };
    }
    case 'text':
      return { ok: true, value: raw };
    case 'list': {
      // An empty field is an empty list, not a parse failure: `hr.workCalendar.weekendDays`
      // declares `.min(0)`, so "no weekend days" is a value the server accepts.
      const parts = raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
      if (listElementKind(defaultValue) === 'string') return { ok: true, value: parts };
      const numbers = parts.map((part) => Number(part));
      return numbers.every((element) => Number.isFinite(element))
        ? { ok: true, value: numbers }
        : { ok: false, reason: 'not-a-number-list' };
    }
    case 'readonly':
      return { ok: false, reason: 'not-editable' };
  }
};

/** The i18n key carrying a setting's bilingual label. Absent labels fall back to the key itself. */
export const settingLabelKey = (key: string): string => `systemAdmin.settings.keys.${key}`;
