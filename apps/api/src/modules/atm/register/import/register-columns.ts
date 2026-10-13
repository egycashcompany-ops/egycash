// Row 1 of the `ATMs` sheet → the 49 register columns (spec §6.2, §4).
//
// Binding is by (EXACT header, nth occurrence), never by position and never by a loosened header:
// four headers appear twice (`Number of\nkeys`, `Number of\nloading cassettes`, `Cassette -1..5`,
// `LOCATION\nGPS`) and the first and second of each pair are different fields, so "the column
// called X" is not an address. D8 says exact, so this is deliberately stricter than the roster's
// `normalizeHeader` (workforce-import/columns.ts): the only folding is `\r\n` → `\n` (the same
// text saved on another platform) and number headers read as `String(value)` (AB..AD are the
// number cells 200 / 100 / 50). A renamed or missing header refuses the whole file with the column
// letter and the expected header — never a half-bound import (risk R-10).
//
// Header texts are not secret, so they may appear in the refusal.
import { ATM_REGISTER_COLUMNS, type AtmRegisterColumnDef } from '@ecms/contracts';

/** A1..AW1 — the import never reads a 50th column (D8; AX..NJ are scratch and helpers, EG-4/5). */
export const REGISTER_COLUMN_COUNT = 49;

/** 1-based column number → Excel letters (1 → A, 27 → AA, 49 → AW). */
export const columnLetter = (column: number): string => {
  let n = column;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/**
 * One row-1 cell as the text it is compared by: strings keep every space (exact), `\r\n` becomes
 * `\n`; a number header is its `String(value)`; rich text is joined; a formula reads its result.
 * Null when the cell is empty.
 */
export const headerText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value === '' ? null : value.replace(/\r\n/g, '\n');
  if (typeof value === 'object') {
    const o = value as { richText?: { text?: unknown }[]; result?: unknown; text?: unknown };
    if (Array.isArray(o.richText)) {
      return headerText(o.richText.map((part) => String(part.text ?? '')).join(''));
    }
    if (o.result !== undefined) return headerText(o.result);
    if (o.text !== undefined) return headerText(o.text);
  }
  return null;
};

export interface BoundRegisterColumn {
  def: AtmRegisterColumnDef;
  /** 0-based position among A..AW where this column's (header, occurrence) was found. */
  index: number;
}

export interface MissingRegisterColumn {
  /** The letter the catalogue expects the column at. */
  column: string;
  /** The exact header that was not found at that occurrence. */
  header: string;
}

export type RegisterColumnBinding =
  { columns: BoundRegisterColumn[] } | { missing: MissingRegisterColumn[] };

/**
 * Bind every column of `ATM_REGISTER_COLUMNS` to its position in the header row (A..AW only).
 * All 49 must bind; otherwise every unbound one is listed.
 */
export const bindRegisterColumns = (headers: readonly (string | null)[]): RegisterColumnBinding => {
  const window = headers.slice(0, REGISTER_COLUMN_COUNT);
  const columns: BoundRegisterColumn[] = [];
  const missing: MissingRegisterColumn[] = [];
  for (const def of ATM_REGISTER_COLUMNS) {
    let seen = -1;
    const index = window.findIndex((header) => {
      if (header !== def.header) return false;
      seen += 1;
      return seen === def.occurrence;
    });
    if (index === -1) missing.push({ column: def.excel, header: def.header });
    else columns.push({ def, index });
  }
  return missing.length > 0 ? { missing } : { columns };
};
