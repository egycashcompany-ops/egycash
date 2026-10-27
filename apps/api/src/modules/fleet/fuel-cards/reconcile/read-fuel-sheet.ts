// Reading a fuel company's balance sheet — «Card Number», «Card Name», «Card Balance».
//
// NOTHING TOUCHES THE DISK. The companies' sheets write every text cell inline and carry no
// shared-strings part, so ExcelJS's streaming reader, handed the file as it came, would always
// spill the sheet to a temp file. The upload is reduced in memory to its FIRST tab first
// (`shared/xlsx/one-sheet-zip.ts`, the ATM register import's reducer), then streamed row by row.
// ExcelJS is CommonJS and loaded with `await import` here, never at module scope.
//
// What it returns is the rows as read, each with its Excel row number. A row whose three cells
// are blank is padding; a row with no name, or a balance that is not a figure of zero or more (a
// card's balance is never below zero — his Chill Out sheet of 2026-10-20 has one at −2,214.66),
// is kept aside as `invalid` — it is shown, never decided. Errors name a column or a limit, never a
// cell's content.
import { Readable } from 'node:stream';
import { ErrorCodes, FLEET_FUEL_SHEET_COLUMNS, type ApiErrorDetail } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  reduceToOneSheet,
  type OneSheetZipErrors,
  type OneSheetZipLimits,
} from '../../../../shared/xlsx/one-sheet-zip';

const MB = 1024 * 1024;

export interface FuelSheetLimits extends OneSheetZipLimits {
  /** Rows the reader may iterate in total, blank ones included. */
  maxRowsIterated: number;
  /** Data rows (non-blank, after the header). Keeps the stored session far below 16 MB. */
  maxDataRows: number;
  /** Wall-clock for the whole read, inflation included. */
  timeMs: number;
}

/** His sheets: ~220 rows, a 42 KB sheet part. The caps are against a mistake, not a size. */
export const FUEL_SHEET_LIMITS: FuelSheetLimits = {
  workbookBytes: 2 * MB,
  relsBytes: 2 * MB,
  stylesBytes: 10 * MB,
  sharedStringsBytes: 20 * MB,
  sheetBytes: 50 * MB,
  maxRowsIterated: 20_000,
  maxDataRows: 5_000,
  timeMs: 20_000,
};

/** The header is the first non-blank row, looked for up to this row. */
const HEADER_SEARCH_ROWS = 10;

export interface FuelSheetRow {
  /** The Excel row number. */
  row: number;
  /** As printed (the companies mask all but the last four digits). */
  number: string;
  name: string;
  /** EGP, rounded to the piastre. */
  balance: number;
}

export type FuelSheetInvalidReason = 'badBalance' | 'noName';

export interface FuelSheetInvalidRow {
  row: number;
  number: string;
  name: string;
  /** As read — negative on a `badBalance` row that holds one; `null` when it holds no figure. */
  balance: number | null;
  reason: FuelSheetInvalidReason;
}

export interface FuelSheetRead {
  rows: FuelSheetRow[];
  invalid: FuelSheetInvalidRow[];
  /** Data rows read (valid and invalid). */
  rowsRead: number;
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────

const UNREADABLE = 'not a readable .xlsx workbook';

/** The library's own message is never echoed. */
const unreadable = (): AppError =>
  new AppError(ErrorCodes.VALIDATION_FAILED, 422, UNREADABLE, {
    details: [{ field: 'file', code: 'UNREADABLE', message: UNREADABLE }],
  });

const layoutError = (message: string, details: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 422, message, { details });

const tooLarge = (what: string): AppError =>
  layoutError('the sheet is larger than the reconciliation reads', [
    { field: 'file', code: 'TOO_LARGE', message: what },
  ]);

const noSheet = (): AppError =>
  layoutError('the workbook has no sheet', [
    { field: 'file', code: 'MISSING_SHEET', message: 'first' },
  ]);

const missingHeaders = (columns: readonly string[]): AppError =>
  layoutError(`the sheet does not have the columns ${columns.join(', ')}`, [
    ...columns.map((column) => ({ field: 'file', code: 'MISSING_HEADER', message: column })),
  ]);

const ZIP_ERRORS: OneSheetZipErrors = { unreadable, tooLarge, missingSheet: noSheet };

// ── Cells ──────────────────────────────────────────────────────────────────────────────────────

type Cell = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'text'; value: string };

const EMPTY: Cell = { kind: 'empty' };

/** A formula's cached result, rich text, a hyperlink's text, a string, a number. */
export const unwrapFuelCell = (value: unknown): Cell => {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', value } : EMPTY;
  if (typeof value === 'string') return { kind: 'text', value };
  if (typeof value === 'boolean') return { kind: 'text', value: String(value) };
  if (value instanceof Date) return { kind: 'text', value: value.toISOString() };
  if (typeof value === 'object') {
    const v = value as { result?: unknown; richText?: unknown; text?: unknown; error?: unknown };
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return unwrapFuelCell(v.result);
    if (Array.isArray(v.richText)) {
      return {
        kind: 'text',
        value: v.richText.map((run: { text?: unknown }) => String(run.text ?? '')).join(''),
      };
    }
    if (typeof v.text === 'string') return { kind: 'text', value: v.text };
    if (typeof v.error === 'string') return { kind: 'text', value: v.error };
  }
  return EMPTY;
};

const isBlank = (cell: Cell): boolean =>
  cell.kind === 'empty' || (cell.kind === 'text' && cell.value.trim() === '');

const textOf = (cell: Cell): string => {
  if (cell.kind === 'empty') return '';
  // A number typed into the number column (16 digits) — its integer part; only the last four
  // digits are ever compared.
  if (cell.kind === 'number') return String(Math.trunc(cell.value));
  return cell.value.trim();
};

const roundPiastre = (egp: number): number => Math.round(egp * 100) / 100;

/**
 * The figure a balance cell holds, to the piastre, or `null` when it holds none: a number, or text
 * with `,`, spaces (`\s` covers the no-break space) and «EGP» stripped. A NEGATIVE figure is
 * returned as read — the caller refuses it (a card's balance is never below zero), and the screen
 * can still show what the sheet said.
 */
export const balanceOf = (cell: Cell): number | null => {
  let value: number;
  if (cell.kind === 'number') value = cell.value;
  else if (cell.kind === 'text') {
    const cleaned = cell.value.replace(/[,\s]/gu, '').replace(/egp/giu, '');
    if (cleaned === '' || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/u.test(cleaned)) return null;
    value = Number(cleaned);
  } else return null;
  if (!Number.isFinite(value)) return null;
  // -0 reads as 0.
  return roundPiastre(value) + 0;
};

/** A header cell's text, compared without case or spacing. */
const headerKey = (cell: Cell): string =>
  cell.kind === 'text' ? cell.value.toLowerCase().replace(/\s+/gu, ' ').trim() : '';

const COLUMN_KEYS = FLEET_FUEL_SHEET_COLUMNS.map((column) => column.toLowerCase());

interface ReaderRow {
  number: number;
  values: unknown;
}

const cellsOf = (row: ReaderRow): Cell[] => {
  const values = Array.isArray(row.values) ? (row.values as unknown[]) : [];
  // ExcelJS's `values` is 1-based; index 0 is always empty.
  return Array.from({ length: Math.max(0, values.length - 1) }, (_, i) =>
    unwrapFuelCell(values[i + 1]),
  );
};

/**
 * Read the first tab of an uploaded sheet. The limits are a parameter so the spec can shrink them;
 * production passes none.
 */
export const readFuelSheet = async (
  upload: Buffer,
  limits: FuelSheetLimits = FUEL_SHEET_LIMITS,
): Promise<FuelSheetRead> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceToOneSheet(upload, 'first', limits, deadline, ZIP_ERRORS);
  const { default: ExcelJS } = await import('exceljs');
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(reduced.buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });

  /** Column positions (0-based) of number, name, balance — once the header is found. */
  let at: [number, number, number] | null = null;
  let headerMissing: string[] | null = null;
  const rows: FuelSheetRow[] = [];
  const invalid: FuelSheetInvalidRow[] = [];
  let iterated = 0;

  try {
    // The reduced zip holds exactly one worksheet: the first tab.
    sheets: for await (const worksheet of reader) {
      for await (const excelRow of worksheet) {
        iterated += 1;
        if (iterated > limits.maxRowsIterated) throw tooLarge('rows');
        if (Date.now() > deadline) throw tooLarge('time');
        const row = excelRow as unknown as ReaderRow;
        const cells = cellsOf(row);

        if (at === null) {
          if (row.number > HEADER_SEARCH_ROWS) break sheets;
          if (cells.every(isBlank)) continue;
          const keys = cells.map(headerKey);
          const found = COLUMN_KEYS.map((key) => keys.indexOf(key));
          const missing = FLEET_FUEL_SHEET_COLUMNS.filter((_, i) => found[i] === -1);
          if (missing.length > 0) {
            headerMissing = missing;
            break sheets;
          }
          at = found as [number, number, number];
          continue;
        }

        const [numberCell, nameCell, balanceCell] = at.map((i) => cells[i] ?? EMPTY) as [
          Cell,
          Cell,
          Cell,
        ];
        if (isBlank(numberCell) && isBlank(nameCell) && isBlank(balanceCell)) continue;
        if (rows.length + invalid.length >= limits.maxDataRows) throw tooLarge('rows');
        const number = textOf(numberCell);
        const name = textOf(nameCell);
        const balance = balanceOf(balanceCell);
        if (name === '') invalid.push({ row: row.number, number, name, balance, reason: 'noName' });
        else if (balance === null || balance < 0) {
          invalid.push({ row: row.number, number, name, balance, reason: 'badBalance' });
        } else rows.push({ row: row.number, number, name, balance });
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  }

  if (at === null) throw missingHeaders(headerMissing ?? [...FLEET_FUEL_SHEET_COLUMNS]);
  return { rows, invalid, rowsRead: rows.length + invalid.length };
};
