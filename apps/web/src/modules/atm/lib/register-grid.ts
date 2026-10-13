// The register grid's geometry and vocabulary, kept out of the component so it can be pinned
// without rendering (spec §8.3, `register-grid.spec.ts`).
//
// The grid is the owner's `ATMs` sheet on screen: the same 49 columns in the owner's own layout
// (the Location group is AP + AV, so AV moves up beside AP), the same widths, the same frozen
// panes over Branch · Area · Bank · ATM ID · Name, and the same dark-green rows for a machine that
// was handed back. Everything here is derived from `ATM_REGISTER_COLUMNS` — the single column
// catalogue the import binds by and the export writes from — so the grid cannot drift from either.
import {
  ATM_REGISTER_COLUMNS,
  ATM_REGISTER_DISPLAY_ORDER,
  ATM_REGISTER_SORT_FIELDS,
  type AtmRegisterColumnDef,
  type AtmRegisterEntryDto,
  type AtmRegisterField,
  type AtmRegisterGroup,
  type AtmRegisterKeysDto,
  type AtmRegisterCassettesDto,
} from '@ecms/contracts';

/**
 * A handed-back row (`status === 'ended'`). The sheet paints these dark green with white text
 * (conditional formatting `$AR>0`, #375623 / white); this is the Tailwind token for the same
 * reading, applied to EVERY cell of the row — the frozen and sticky ones included, or the colour
 * would stop at the panes. The End-date cell is the cue that does not depend on colour.
 */
export const REGISTER_ENDED_ROW =
  'bg-emerald-900 text-white dark:bg-emerald-950 dark:text-emerald-50';

const byLetter = new Map(ATM_REGISTER_COLUMNS.map((column) => [column.excel, column]));

/** The 49 columns in the owner's display order: A..AO, AP, AV, AQ..AU, AW. */
export const REGISTER_GRID_COLUMNS: readonly AtmRegisterColumnDef[] =
  ATM_REGISTER_DISPLAY_ORDER.map((letter) => {
    const column = byLetter.get(letter);
    if (column === undefined)
      throw new Error(`register display order names unknown column ${letter}`);
    return column;
  });

/** The sheet's frozen panes: the five identity columns a reader keeps in view while scrolling. */
export const REGISTER_FROZEN_FIELDS: readonly AtmRegisterField[] = [
  'branchCode',
  'area',
  'bankCode',
  'machineCode',
  'name',
];

/** A column's width in pixels from the sheet's `<col width>` (characters): Name → 303 px. */
export const registerColumnWidth = (excelWidth: number): number =>
  Math.max(72, Math.round(excelWidth * 7 + 5));

export const registerWidthOf = (column: AtmRegisterColumnDef): number =>
  registerColumnWidth(column.excelWidth);

/**
 * Where each frozen column sticks: its `inset-inline-start`, the sum of the widths before it.
 * Inline-start, not left — in Arabic the panes freeze on the right, where the sheet's column A is.
 */
export const registerFrozenOffsets = (
  columns: readonly AtmRegisterColumnDef[] = REGISTER_GRID_COLUMNS,
): ReadonlyMap<AtmRegisterField, number> => {
  const offsets = new Map<AtmRegisterField, number>();
  let at = 0;
  for (const field of REGISTER_FROZEN_FIELDS) {
    const column = columns.find((c) => c.field === field);
    if (column === undefined) continue;
    offsets.set(field, at);
    at += registerWidthOf(column);
  }
  return offsets;
};

/** The frozen block's total width (Branch … Name): 87 + 121 + 72 + 97 + 303 = 680 px. */
export const REGISTER_FROZEN_WIDTH = REGISTER_FROZEN_FIELDS.reduce((sum, field) => {
  const column = REGISTER_GRID_COLUMNS.find((c) => c.field === field);
  return column === undefined ? sum : sum + registerWidthOf(column);
}, 0);

/**
 * The least of the sheet a reader must still be able to scroll through beside the frozen panes
 * and the sticky actions. Freezing 680 px plus the actions on a board narrower than this would
 * leave no window at all onto the other 44 columns — at 1024 px with the sidebar open the panes
 * alone are wider than the board — so there the panes scroll with the rest, as on a phone.
 */
export const REGISTER_MIN_SCROLL_WINDOW = 240;

/**
 * Do the panes freeze on a board this wide? `null` = not measured yet (the server render, the
 * first paint): freeze, which is what every screen wide enough for the sheet will settle on.
 * Below `lg` the classes themselves never freeze, whatever this says.
 */
export const registerPanesFreeze = (boardWidth: number | null, actionsWidth: number): boolean =>
  boardWidth === null ||
  boardWidth >= REGISTER_FROZEN_WIDTH + actionsWidth + REGISTER_MIN_SCROLL_WINDOW;

/** One cell of the group header row: a run of adjacent columns of the same group. */
export interface RegisterGroupSpan {
  group: AtmRegisterGroup;
  /** How many columns the run covers (`colSpan`). */
  span: number;
  /** Excel letter of the run's first column. */
  first: string;
}

/**
 * The group header row (`colSpan` per CONTIGUOUS run). In the display order every group is one
 * run: Identity A..I · Keys J..Q · Cassettes R..AJ · Hours & notes AK..AN · Secret AO ·
 * Location AP, AV · Lifecycle AQ..AU · HUB AW.
 */
export const registerGroupSpans = (
  columns: readonly AtmRegisterColumnDef[] = REGISTER_GRID_COLUMNS,
): RegisterGroupSpan[] => {
  const spans: RegisterGroupSpan[] = [];
  for (const column of columns) {
    const last = spans[spans.length - 1];
    if (last !== undefined && last.group === column.group) last.span += 1;
    else spans.push({ group: column.group, span: 1, first: column.excel });
  }
  return spans;
};

/** The headers a reader can order the register by, and the server field each one sorts. */
export const REGISTER_SORT_KEYS: Readonly<Partial<Record<AtmRegisterField, string>>> = {
  branchCode: 'branchId',
  area: 'area',
  bankCode: 'bankCode',
  machineCode: 'machineCode',
  name: 'name',
  startDate: 'startDate',
  endDate: 'endDate',
};

export interface RegisterSort {
  by: string;
  dir: 'asc' | 'desc';
}

/**
 * `sort=field:dir` from the URL. Anything the server would not sort by reads as no sort — the
 * sheet's own order (DEC-21), which is what the server answers when nothing is sent.
 */
export const parseRegisterSort = (raw: string | null): RegisterSort | null => {
  if (raw === null || raw === '') return null;
  const [by = '', dir = 'asc'] = raw.split(':');
  if (!(ATM_REGISTER_SORT_FIELDS as readonly string[]).includes(by)) return null;
  return { by, dir: dir === 'desc' ? 'desc' : 'asc' };
};

/**
 * A header press: ascending, then descending, then back to the sheet's order — the third press
 * is what returns a reader to the register as the Excel kept it, which no other control offers.
 */
export const nextRegisterSort = (current: RegisterSort | null, by: string): string | null => {
  if (current === null || current.by !== by) return `${by}:asc`;
  return current.dir === 'asc' ? `${by}:desc` : null;
};

/** The page sizes the register offers; the server caps a page at 100 and pages through the rest. */
export const REGISTER_PAGE_SIZES = [25, 50, 100];
export const REGISTER_DEFAULT_PAGE_SIZE = 25;

export const parseRegisterPageSize = (raw: string | null): number => {
  const size = Number(raw);
  return REGISTER_PAGE_SIZES.includes(size) ? size : REGISTER_DEFAULT_PAGE_SIZE;
};

/** The header's tooltip: the sheet's EXACT row-1 text, its in-cell line breaks read as spaces. */
export const registerHeaderTitle = (column: AtmRegisterColumnDef): string =>
  column.header.replace(/\n/g, ' ');

/** Columns whose content is Latin by nature — codes, numbers, times, dates, a link. */
export const REGISTER_LTR_FIELDS: ReadonlySet<AtmRegisterField> = new Set<AtmRegisterField>([
  'machineCode',
  'serial',
  'model',
  'openTime',
  'closeTime',
  'startDate',
  'endDate',
  'locationUrl',
  'safeCombination',
]);

/** A location link is a link only when it is plainly one; anything else stays text. */
export const isRegisterHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

/**
 * A field's stored text on an entry, by its dotted path. `null` for an empty cell, for a K field
 * the reader may not see (the DTO carries `keys: null`), and ALWAYS for the combination: the DTO
 * holds no trace of AO beyond `safeCombinationSet`, and this function has nothing to read it from.
 */
export const registerFieldText = (
  entry: AtmRegisterEntryDto,
  field: AtmRegisterField,
): string | null => {
  if (field === 'safeCombination') return null;
  if (field.startsWith('keys.')) {
    const key = field.slice('keys.'.length) as keyof AtmRegisterKeysDto;
    return entry.keys === null ? null : entry.keys[key];
  }
  if (field.startsWith('cassettes.')) {
    const key = field.slice('cassettes.'.length) as keyof AtmRegisterCassettesDto;
    return entry.cassettes[key];
  }
  const value = entry[field as keyof AtmRegisterEntryDto];
  return typeof value === 'string' ? value : null;
};

/** What the reader may do to a row — `can(key)` per key, read once for the grid. */
export interface RegisterActionGrants {
  edit: boolean;
  create: boolean;
  handover: boolean;
  viewSecrets: boolean;
  delete: boolean;
}

/**
 * The most row actions any ONE row can show this reader. A pending row can be received but not
 * handed over or linked; an open row the other way round — so the two are alternatives.
 */
export const registerActionSlots = (grants: RegisterActionGrants): number =>
  Number(grants.edit) +
  Math.max(Number(grants.create), Number(grants.handover) + Number(grants.edit)) +
  Number(grants.viewSecrets) +
  Number(grants.delete);

/** One icon button is 28 px, with 2 px between them and 8 px of cell padding each side. */
export const registerActionsWidth = (slots: number): number =>
  slots === 0 ? 0 : slots * 28 + (slots - 1) * 2 + 16;
