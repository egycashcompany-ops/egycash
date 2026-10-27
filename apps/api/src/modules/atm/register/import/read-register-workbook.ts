// Reading the owner's workbook — the only file of the import that knows what a zip and a sheet are
// (spec §6.2).
//
// NOTHING TOUCHES THE DISK. ExcelJS's streaming `WorkbookReader` writes every worksheet that comes
// before `xl/sharedStrings.xml` in the zip to an OS temp file and removes it only after its loop
// ends (exceljs/lib/stream/xlsx/workbook-reader.js). The owner's workbook stores five sheets ahead
// of its shared strings — one of them `Sheet1`, whose cached values repeat the safe-door
// combinations and key codes (EG-13) — and ExcelJS's own writer puts every worksheet first, so even
// a test workbook would spill. The upload is therefore NEVER handed to `WorkbookReader`:
//
//   1. the zip is opened in memory (JSZip) and only five entries are ever inflated — the workbook,
//      its relationships, the styles, the shared strings, and the ONE worksheet the workbook names
//      `ATMs` — each through a byte counter that stops the inflation past its cap (a zip bomb
//      cannot grow further than that, and no other sheet is inflated at all);
//   2. those five are re-zipped in memory, worksheet LAST, so the reader has the shared strings
//      before it meets the sheet and parses the sheet straight from the stream;
//   3. that reduced zip is streamed, row by row, and the loop stops at the `END` sentinel.
//
// Steps 1–2 are `shared/xlsx/one-sheet-zip.ts` (shared with the fleet's fuel-card sheet, so the
// no-spill rule lives in one place). Both libraries are CommonJS and are loaded with `await import`
// at the point of use — never at module scope, where they would sit in the API's boot path
// (workforce-import/read-workbook.ts learned that with a production outage) — and both are
// `external` in tsup.config.ts.
//
// What leaves this file is cells, not values a person would type into a log: the caller (parse-
// rows.ts) turns them into register fields. Errors name an entry path, a column letter or a limit
// — never a cell's content.
import { Readable } from 'node:stream';
import { ErrorCodes, type ApiErrorDetail } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  attributes,
  reduceToOneSheet,
  startTags,
  type OneSheetZipErrors,
  type ReducedOneSheetWorkbook,
} from '../../../../shared/xlsx/one-sheet-zip';
import { EMPTY_CELL, unwrapCellValue, type RawCell } from './cell-convert';
import {
  REGISTER_COLUMN_COUNT,
  bindRegisterColumns,
  columnLetter,
  headerText,
  type BoundRegisterColumn,
} from './register-columns';

/** The sheet the register lives on (D8). */
export const REGISTER_SHEET_NAME = 'ATMs';

const MB = 1024 * 1024;

export interface RegisterWorkbookLimits {
  /** Inflated-size caps per zip entry (the real file's sizes in brackets, §6.2). */
  workbookBytes: number; // (2.5 KB)
  relsBytes: number; // (1.7 KB)
  stylesBytes: number; // (83 KB)
  sharedStringsBytes: number; // (1.1 MB)
  sheetBytes: number; // (35.8 MB)
  /** Rows the reader may iterate in total — the sentinel normally stops it at row 5000. */
  maxRowsIterated: number;
  /** Data rows without a sentinel. */
  maxDataRows: number;
  /** Wall-clock for the whole read, inflation included. */
  timeMs: number;
}

export const REGISTER_WORKBOOK_LIMITS: RegisterWorkbookLimits = {
  workbookBytes: 2 * MB,
  relsBytes: 2 * MB,
  stylesBytes: 10 * MB,
  sharedStringsBytes: 50 * MB,
  sheetBytes: 150 * MB,
  maxRowsIterated: 60_000,
  maxDataRows: 20_000,
  timeMs: 60_000,
};

// ── Errors (codes, paths and letters — never a cell value) ─────────────────────────────────────

const UNREADABLE = 'not a readable .xlsx workbook';

/** §6.7: the library's own message is never echoed. */
export const unreadableWorkbook = (): AppError =>
  new AppError(ErrorCodes.VALIDATION_FAILED, 422, UNREADABLE, {
    details: [{ field: 'file', code: 'UNREADABLE', message: UNREADABLE }],
  });

const layoutError = (message: string, details: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCodes.ATM_REGISTER_IMPORT_LAYOUT, 422, message, { details });

const tooLarge = (what: string): AppError =>
  layoutError('the workbook is larger than the import reads', [
    { field: 'file', code: 'TOO_LARGE', message: what },
  ]);

const noRegisterSheet = (): AppError =>
  layoutError(`the workbook has no sheet named ${REGISTER_SHEET_NAME}`, [
    { field: 'file', code: 'MISSING_SHEET', message: REGISTER_SHEET_NAME },
  ]);

const REGISTER_ZIP_ERRORS: OneSheetZipErrors = {
  unreadable: unreadableWorkbook,
  tooLarge,
  missingSheet: noRegisterSheet,
};

// ── Zip: five entries, inflated under caps, re-zipped in reading order ─────────────────────────
//
// The in-memory reducer and its linear XML scans live in `shared/xlsx/one-sheet-zip.ts`, shared
// with the fleet's fuel-card sheet; the scans are re-exported here for this file's spec.

export { attributes, startTags };

export type ReducedRegisterWorkbook = ReducedOneSheetWorkbook;

/**
 * Steps 1–2 of §6.2: open the upload in memory, inflate exactly five entries under their caps,
 * and re-zip them in the order the streaming reader needs. Exported for its spec.
 */
export const reduceRegisterWorkbook = async (
  upload: Buffer,
  limits: RegisterWorkbookLimits = REGISTER_WORKBOOK_LIMITS,
  deadline: number = Date.now() + limits.timeMs,
): Promise<ReducedRegisterWorkbook> =>
  reduceToOneSheet(upload, { name: REGISTER_SHEET_NAME }, limits, deadline, REGISTER_ZIP_ERRORS);

// ── The sheet: row 1 binds, row 2 is the SUM band, row 3 on is data until `END` ─────────────────

export interface RegisterWorkbookRow {
  /** The Excel row number — the entry's `importRow`. */
  rowNumber: number;
  /** A1..AW1 positions, 49 cells, empty ones included. */
  cells: RawCell[];
}

export interface RegisterWorkbookRead {
  columns: BoundRegisterColumn[];
  date1904: boolean;
  /** Row 1's solid fills (EG-2: M, O, Z, AP are red in the owner's sheet). */
  headerFills: { column: string; fill: string }[];
  /** Rows 3.. with at least one value in A..AW, up to the sentinel. */
  rows: RegisterWorkbookRow[];
  sentinelRow: number | null;
  /** The last data row read (2 when there is none). */
  lastDataRow: number;
}

/** A solid fill as `argb`, `theme:<n>:<tint>` or `indexed:<n>`; none and white are not marks. */
export const solidFillOf = (fill: unknown): string | null => {
  if (typeof fill !== 'object' || fill === null) return null;
  const f = fill as {
    type?: unknown;
    pattern?: unknown;
    fgColor?: { argb?: unknown; theme?: unknown; tint?: unknown; indexed?: unknown };
  };
  if (f.type !== 'pattern' || f.pattern !== 'solid') return null;
  const color = f.fgColor ?? {};
  if (typeof color.argb === 'string') {
    return color.argb.toUpperCase() === 'FFFFFFFF' ? null : color.argb;
  }
  if (typeof color.theme === 'number') {
    return `theme:${String(color.theme)}:${typeof color.tint === 'number' ? String(color.tint) : '0'}`;
  }
  if (typeof color.indexed === 'number') return `indexed:${String(color.indexed)}`;
  return null;
};

interface ReaderCell {
  value: unknown;
  numFmt?: unknown;
  fill?: unknown;
}

interface ReaderRow {
  number: number;
  findCell(column: number): ReaderCell | undefined;
}

const readCell = (cell: ReaderCell | undefined, date1904: boolean): RawCell => {
  if (cell === undefined) return EMPTY_CELL;
  const numFmt = typeof cell.numFmt === 'string' ? cell.numFmt : null;
  return {
    value: unwrapCellValue(cell.value, numFmt, date1904),
    numFmt,
    fill: solidFillOf(cell.fill),
  };
};

const isBlank = (cell: RawCell): boolean =>
  cell.value.kind === 'empty' || (cell.value.kind === 'string' && cell.value.value.trim() === '');

/**
 * Read the register sheet of an uploaded workbook (§6.2). The limits are a parameter so the spec
 * can shrink them; production passes none.
 */
export const readRegisterWorkbook = async (
  upload: Buffer,
  limits: RegisterWorkbookLimits = REGISTER_WORKBOOK_LIMITS,
): Promise<RegisterWorkbookRead> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceRegisterWorkbook(upload, limits, deadline);
  const { default: ExcelJS } = await import('exceljs');
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(reduced.buffer), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });

  let columns: BoundRegisterColumn[] | null = null;
  let branchIndex = 0;
  const headerFills: { column: string; fill: string }[] = [];
  const rows: RegisterWorkbookRow[] = [];
  let sentinelRow: number | null = null;
  let iterated = 0;

  try {
    // The reduced zip holds exactly one worksheet: the `ATMs` sheet.
    sheets: for await (const worksheet of reader) {
      for await (const excelRow of worksheet) {
        iterated += 1;
        if (iterated > limits.maxRowsIterated) throw tooLarge('rows');
        if (Date.now() > deadline) throw tooLarge('time');
        const row = excelRow as unknown as ReaderRow;
        const cells: RawCell[] = [];
        for (let c = 1; c <= REGISTER_COLUMN_COUNT; c += 1) {
          cells.push(readCell(row.findCell(c), reduced.date1904));
        }

        if (row.number === 1) {
          const bound = bindRegisterColumns(
            Array.from({ length: REGISTER_COLUMN_COUNT }, (_, i) =>
              headerText(row.findCell(i + 1)?.value),
            ),
          );
          if ('missing' in bound) {
            throw layoutError(
              `the ${REGISTER_SHEET_NAME} sheet does not have the expected columns`,
              bound.missing.map((m) => ({
                field: m.column,
                code: 'MISSING_HEADER',
                message: m.header,
              })),
            );
          }
          columns = bound.columns;
          branchIndex = bound.columns.find((c) => c.def.excel === 'A')?.index ?? 0;
          cells.forEach((cell, i) => {
            if (cell.fill !== null)
              headerFills.push({ column: columnLetter(i + 1), fill: cell.fill });
          });
          continue;
        }
        if (columns === null) break sheets; // no header row → refused below
        if (row.number < 3) continue; // row 2 is the SUM band

        const branch = cells[branchIndex]?.value;
        if (branch?.kind === 'string' && branch.value.trim() === 'END') {
          sentinelRow = row.number;
          break sheets;
        }
        if (cells.every(isBlank)) continue;
        rows.push({ rowNumber: row.number, cells });
        if (rows.length > limits.maxDataRows) throw tooLarge('rows');
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadableWorkbook();
  }

  if (columns === null) {
    throw layoutError(
      `the ${REGISTER_SHEET_NAME} sheet does not have the expected columns`,
      bindMissingAll(),
    );
  }
  return {
    columns,
    date1904: reduced.date1904,
    headerFills,
    rows,
    sentinelRow,
    lastDataRow: rows.at(-1)?.rowNumber ?? 2,
  };
};

/** No header row at all: every column is missing. */
const bindMissingAll = (): ApiErrorDetail[] => {
  const bound = bindRegisterColumns([]);
  return 'missing' in bound
    ? bound.missing.map((m) => ({ field: m.column, code: 'MISSING_HEADER', message: m.header }))
    : [];
};
