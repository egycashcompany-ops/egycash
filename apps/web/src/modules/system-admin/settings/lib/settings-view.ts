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
// **3. A definition this file does not recognise still belongs on screen.** An unknown owner and an
// unhandled Zod type are both "the registry grew and this screen has not caught up", which is not a
// reason to hide a configurable value from the person who administers it. Unknown owners group
// under Other; unhandled types render read-only. Nothing is ever dropped — `buildSettingGroups`
// returns exactly as many rows as it was given definitions, and a test pins that.
import { type ResolvedSettingDto, type SettingDefinitionDto } from '@ecms/contracts';

/** How a value is edited. `readonly` is the honest answer for a type this screen cannot render. */
export type SettingEditor = 'boolean' | 'number' | 'text' | 'list' | 'readonly';

/**
 * The owners this screen knows, in the order it shows them: the platform's own three first — they
 * are the ones an administrator comes here for — then feature flags, then the business modules.
 *
 * `flag` earns a place despite the catalog being empty today: `declareFeatureFlagSettings` registers
 * every flag as `flag.<key>`, so the first flag would otherwise land in Other on the day it ships.
 */
export const KNOWN_OWNERS = [
  'auth',
  'audit',
  'notifications',
  'flag',
  'contracts',
  'hr',
  'fleet',
  'it',
] as const;
export type KnownOwner = (typeof KNOWN_OWNERS)[number];

/** Where a definition goes when its first segment is not an owner this screen knows. */
export const OTHER_OWNER = 'other';

export interface SettingRowModel {
  key: string;
  owner: KnownOwner | typeof OTHER_OWNER;
  definition: SettingDefinitionDto;
  /** The caller's resolved value. Absent while `/settings/me` is in flight. */
  resolved: ResolvedSettingDto | null;
  editor: SettingEditor;
  /**
   * The displayed value comes from a layer this screen does not write (`user` or `branch`), so
   * editing the organization value will not change the number above it.
   */
  shadowed: boolean;
}

export interface SettingGroupModel {
  owner: KnownOwner | typeof OTHER_OWNER;
  rows: SettingRowModel[];
}

const isKnownOwner = (segment: string): segment is KnownOwner =>
  (KNOWN_OWNERS as readonly string[]).includes(segment);

/** The first segment of the key IS the owner — the convention every declaration already follows. */
export const ownerOf = (key: string): KnownOwner | typeof OTHER_OWNER => {
  const segment = key.split('.')[0] ?? '';
  return isKnownOwner(segment) ? segment : OTHER_OWNER;
};

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
 * Group the registry for display. Ordered by owner, then by key inside each owner, so two loads of
 * the same registry produce the same screen — the definitions arrive in declaration order, which is
 * boot order, which is not stable enough to render.
 */
export const buildSettingGroups = (
  definitions: readonly SettingDefinitionDto[],
  resolved: readonly ResolvedSettingDto[],
): SettingGroupModel[] => {
  const byKey = new Map(resolved.map((entry) => [entry.key, entry]));
  const groups = new Map<string, SettingRowModel[]>();

  for (const definition of definitions) {
    const owner = ownerOf(definition.key);
    const value = byKey.get(definition.key) ?? null;
    const row: SettingRowModel = {
      key: definition.key,
      owner,
      definition,
      resolved: value,
      editor: editorFor(definition.type),
      shadowed: value !== null && (value.resolvedFrom === 'user' || value.resolvedFrom === 'branch'),
    };
    const bucket = groups.get(owner);
    if (bucket === undefined) groups.set(owner, [row]);
    else bucket.push(row);
  }

  const order = [...KNOWN_OWNERS, OTHER_OWNER];
  return order.flatMap((owner) => {
    const rows = groups.get(owner);
    if (rows === undefined) return [];
    return [{ owner: owner as KnownOwner | typeof OTHER_OWNER, rows: [...rows].sort(byKeyAsc) }];
  });
};

const byKeyAsc = (a: SettingRowModel, b: SettingRowModel): number => a.key.localeCompare(b.key);

/**
 * Search and owner filtering.
 *
 * The label is a translation, which this file cannot resolve — so the caller passes its translator
 * in, the same shape `duplicateBlocker` takes `canGrant`. Matching only on the key would make the
 * search useless in Arabic; matching only on the label would make it useless for someone searching
 * the key they read in a config file. Both, plus the English description the server sends.
 *
 * An empty owner filter means "all". A group that loses every row disappears; a group that keeps
 * one stays, which is what makes the result readable rather than a flat list.
 */
export const filterSettingGroups = (
  groups: readonly SettingGroupModel[],
  query: string,
  owner: string,
  labelOf: (key: string) => string,
): SettingGroupModel[] => {
  const needle = query.trim().toLowerCase();
  const matches = (row: SettingRowModel): boolean => {
    if (needle === '') return true;
    return (
      row.key.toLowerCase().includes(needle) ||
      row.definition.description.toLowerCase().includes(needle) ||
      labelOf(row.key).toLowerCase().includes(needle)
    );
  };
  return groups.flatMap((group) => {
    if (owner !== '' && group.owner !== owner) return [];
    const rows = group.rows.filter(matches);
    return rows.length === 0 ? [] : [{ owner: group.owner, rows }];
  });
};

/**
 * Why a row cannot be edited here — three different answers that must not be collapsed into one
 * disabled control with no explanation.
 *
 * `not-organization-scoped` cannot happen with today's twenty-nine declarations (all of them allow
 * `organization`), and it is here because the alternative is a screen that silently sends a scope
 * the server will refuse with 422. This slice writes organization values only — by design, since a
 * branch or user write needs a subject to write it for, and that is a different screen.
 */
export const ROW_EDITABILITIES = [
  'editable',
  'no-permission',
  'unsupported-type',
  'not-organization-scoped',
] as const;
export type RowEditability = (typeof ROW_EDITABILITIES)[number];

export const rowEditability = (row: SettingRowModel, canEdit: boolean): RowEditability => {
  if (!canEdit) return 'no-permission';
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
