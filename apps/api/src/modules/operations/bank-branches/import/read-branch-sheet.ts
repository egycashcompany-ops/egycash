// Reading a bank's branch sheet (Round 29 — «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن زى بتاع
// كروت الشحن كدا»). The only file of the import that knows what a workbook is; what leaves it is the
// sheet's branch rows as TEXT, each with its row number — nothing decided (that is
// `plan-branch-import.ts`). Refusals name a column, a header or a cap, never a cell's content.
//
// NOTHING TOUCHES THE DISK, and the workbook is never inflated whole — the fuel-card sheet's and
// the IT assets upload's way (`shared/xlsx/one-sheet-zip.ts`): the zip's entry count is checked
// before JSZip opens anything (SEC-13), five parts are inflated under their caps — the workbook, its
// relationships, the styles, the shared strings and ONE sheet, the FIRST VISIBLE one — and
// re-zipped in memory for ExcelJS's streaming reader, handed to it in slices
// (`shared/xlsx/stream-text.ts`), which stops one row past the cap. ExcelJS is CommonJS and loaded
// with `await import` at the point of use, never at module scope.
//
// THE SHEET AS A PERSON READS IT:
//   · the header is the first of the first ten rows naming the branch name by one of its labels
//     (`OPERATIONS_BRANCH_IMPORT_SYNONYMS`: «اسم الفرع» / «الفرع» / «Branches» …); every other
//     column is bound by its own label, the first column of a label winning, and a column no label
//     names («م», «التكلفة») is never read;
//   · a cell merged DOWN (an area over a block of branches) is every covered row's — the streaming
//     reader gives it to the block's first row only;
//   · a row with nothing in a bound column (blank, or only a serial «م») is no branch row;
//   · a CODE is the text the cell shows: a text cell as typed («084»), a number with a zero-padded
//     format («000») padded, any other number by its digits — never «84.0»;
//   · names, areas and addresses are tidied (`tidyOperationsBranchName`); an AREA with no letter in
//     it («ــــــ», «-») is no area; a NAME cell holding a date (Excel's own turn of «3 فبراير») is
//     flagged, never taken for a name.
import { Readable } from 'node:stream';
import {
  ErrorCodes,
  OPERATIONS_BRANCH_IMPORT_MAX_ROWS,
  OPERATIONS_BRANCH_IMPORT_ROLES,
  OPERATIONS_BRANCH_IMPORT_SYNONYMS,
  foldSheetHeader,
  tidyOperationsBranchName,
  type ApiErrorDetail,
  type OperationsBranchImportLayoutColumnDto,
  type OperationsBranchImportRole,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import {
  reduceToOneSheet,
  type OneSheetZipErrors,
  type OneSheetZipLimits,
} from '../../../../shared/xlsx/one-sheet-zip';
import { decodeXstring, readSlices } from '../../../../shared/xlsx/stream-text';

const MB = 1024 * 1024;

export interface BranchSheetLimits extends OneSheetZipLimits {
  /** Rows the reader may iterate in total, blank ones included. */
  maxRowsIterated: number;
  /** Branch rows (non-blank, after the header). */
  maxDataRows: number;
  /** Wall-clock for the whole read, inflation included. */
  timeMs: number;
  /** The slices the reduced zip is streamed in (`readSlices`). */
  chunkBytes: number;
  /** The furthest column a bound column may stand in. */
  maxColumns: number;
}

/**
 * The owner's sheets: 200–700 rows of five columns, a 30 KB file. The caps are against a mistake
 * or a crafted file, not a size — 5 000 rows of five columns are under 3 MB of sheet.
 */
export const BRANCH_SHEET_LIMITS: BranchSheetLimits = {
  workbookBytes: 2 * MB,
  relsBytes: 2 * MB,
  stylesBytes: 10 * MB,
  sharedStringsBytes: 10 * MB,
  sheetBytes: 20 * MB,
  maxRowsIterated: 20_000,
  maxDataRows: OPERATIONS_BRANCH_IMPORT_MAX_ROWS,
  timeMs: 20_000,
  chunkBytes: 64 * 1024,
  maxColumns: 256,
};

/** The header is looked for up to this row. */
const HEADER_SEARCH_ROWS = 10;

export interface BranchSheetRow {
  /** The sheet's own row number. */
  row: number;
  /** Tidied; null when empty. A date cell's ISO day when `nameIsDate`. */
  name: string | null;
  /** The name cell holds a date — the name as typed is lost. */
  nameIsDate: boolean;
  /** As the cell shows it, trimmed; null when empty. */
  code: string | null;
  /** Tidied; null when empty or without a letter. */
  areaAr: string | null;
  areaEn: string | null;
  address: string | null;
}

export interface BranchSheetRead {
  sheetName: string;
  headerRow: number;
  layout: OperationsBranchImportLayoutColumnDto[];
  rows: BranchSheetRow[];
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────

const UNREADABLE = 'not a readable .xlsx workbook';

const unreadable = (): AppError =>
  new AppError(ErrorCodes.VALIDATION_FAILED, 422, UNREADABLE, {
    details: [{ field: 'file', code: 'UNREADABLE', message: UNREADABLE }],
  });

const layoutError = (message: string, details: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT, 422, message, { details });

const tooLarge = (what: string): AppError =>
  layoutError(
    `the sheet is larger than a bank's branch list — at most ${String(OPERATIONS_BRANCH_IMPORT_MAX_ROWS)} branches`,
    [{ field: 'file', code: 'TOO_LARGE', message: what }],
  );

const noSheet = (): AppError =>
  layoutError('the workbook has no visible sheet', [
    { field: 'file', code: 'MISSING_SHEET', message: 'firstVisible' },
  ]);

/** The label a refusal names when no header row names the branch. */
export const BRANCH_NAME_HEADER = 'اسم الفرع';

const noHeader = (): AppError =>
  layoutError(`no header row in the first rows names the column «${BRANCH_NAME_HEADER}»`, [
    { field: 'file', code: 'MISSING_HEADER', message: BRANCH_NAME_HEADER },
  ]);

const ZIP_ERRORS: OneSheetZipErrors = { unreadable, tooLarge, missingSheet: noSheet };

// ── Cells ──────────────────────────────────────────────────────────────────────────────────────

/** A number as Excel's General format shows a whole one — never in exponent form. */
const numberText = (n: number): string =>
  Number.isInteger(n) && Math.abs(n) >= 1e21 ? BigInt(n).toString() : String(n);

/** A cell's value with a formula's, a hyperlink's or rich text's text taken out of it. */
const plainValue = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  const cell = value as {
    richText?: { text?: unknown }[];
    result?: unknown;
    formula?: unknown;
    sharedFormula?: unknown;
    text?: unknown;
  };
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => (typeof part.text === 'string' ? part.text : '')).join('');
  }
  if ('formula' in cell || 'sharedFormula' in cell || 'result' in cell) {
    return plainValue(cell.result);
  }
  if ('text' in cell) return plainValue(cell.text);
  // An error value (#N/A) is nothing a person typed.
  return null;
};

/** What a cell shows as text, Excel's escapes decoded; '' for nothing. Not tidied. */
const rawText = (value: unknown): string => {
  const plain = plainValue(value);
  if (plain === null || plain === undefined) return '';
  if (typeof plain === 'string') return decodeXstring(plain);
  if (typeof plain === 'number') return Number.isFinite(plain) ? numberText(plain) : '';
  if (typeof plain === 'boolean') return plain ? 'TRUE' : 'FALSE';
  if (plain instanceof Date) {
    return Number.isNaN(plain.getTime()) ? '' : plain.toISOString().slice(0, 10);
  }
  return '';
};

const orNull = (text: string): string | null => (text === '' ? null : text);

/** A zero-padded number format — «000» shows 84 as «084». */
const ZERO_PADDED = /^0+$/u;

/** The code the cell shows (rule above); null when empty. */
export const codeTextOf = (value: unknown, numFmt: string | undefined): string | null => {
  const plain = plainValue(value);
  if (
    typeof plain === 'number' &&
    Number.isInteger(plain) &&
    plain >= 0 &&
    numFmt !== undefined &&
    ZERO_PADDED.test(numFmt)
  ) {
    return String(plain).padStart(numFmt.length, '0');
  }
  return orNull(rawText(value).replace(/\s+/gu, ' ').trim());
};

/** A name, an area or an address, tidied; null when empty. */
const tidyText = (value: unknown): string | null =>
  orNull(tidyOperationsBranchName(rawText(value)));

/** An area cell: no letter in it is no area. */
const areaText = (value: unknown): string | null => {
  const text = tidyText(value);
  return text !== null && /\p{L}/u.test(text) ? text : null;
};

/** «2001-02-03 00:00:00», «2001-02-03T00:00:00.000Z» — a date written out where a name belongs. */
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/u;

const isDateValue = (value: unknown): boolean => {
  const plain = plainValue(value);
  if (plain instanceof Date) return true;
  return typeof plain === 'string' && DATE_TEXT.test(plain.trim());
};

// ── The header ─────────────────────────────────────────────────────────────────────────────────

const HEADER_ROLES = new Map<string, OperationsBranchImportRole>(
  OPERATIONS_BRANCH_IMPORT_ROLES.flatMap((role) =>
    OPERATIONS_BRANCH_IMPORT_SYNONYMS[role].map((key) => [key, role] as const),
  ),
);

interface Header {
  row: number;
  /** 0-based column of each role (the first column of a label wins). */
  roles: Map<OperationsBranchImportRole, number>;
  texts: string[];
  /** One past the furthest bound column. */
  width: number;
}

const headerOf = (row: number, cells: readonly unknown[]): Header => {
  const roles = new Map<OperationsBranchImportRole, number>();
  const texts = cells.map((cell) => rawText(cell).trim());
  texts.forEach((text, i) => {
    if (text === '') return;
    const role = HEADER_ROLES.get(foldSheetHeader(text));
    if (role !== undefined && !roles.has(role)) roles.set(role, i);
  });
  return { row, roles, texts, width: Math.max(0, ...roles.values()) + 1 };
};

/** «A», «B», … «AA» — a column's letter. */
export const columnLetter = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/**
 * No branch in it: every bound cell is empty once read as the import reads it — a row of a serial
 * alone («م» is bound by no label), or of an area without a letter («ــــ»), included.
 */
const isBlankRow = (header: Header, cells: readonly unknown[]): boolean => {
  const at = (role: OperationsBranchImportRole): unknown => {
    const column = header.roles.get(role);
    return column === undefined ? undefined : cells[column];
  };
  return (
    tidyText(at('name')) === null &&
    codeTextOf(at('code'), undefined) === null &&
    areaText(at('areaAr')) === null &&
    areaText(at('areaEn')) === null &&
    tidyText(at('address')) === null
  );
};

// ── Merged cells ───────────────────────────────────────────────────────────────────────────────

/** «AB12» → column 27 (A = 0), row 12; null for anything else. */
const cellRef = (ref: string): { column: number; row: number } | null => {
  const match = /^([A-Z]{1,3})([0-9]{1,7})$/u.exec(ref);
  if (match === null) return null;
  const [, letters = '', digits = ''] = match;
  let column = 0;
  for (const char of letters) column = column * 26 + (char.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(digits) };
};

interface ReadRow {
  row: number;
  cells: unknown[];
  /** The code column's number format, as the cell carries it. */
  codeFormat: string | undefined;
}

/**
 * A merged cell's value, given to the rows under it in ITS column (only down, never across); a
 * range starting on or above the header is the header's own, and a cell holding a value of its own
 * keeps it. Rows that were never read (blank) gain nothing.
 */
const fillMergedDown = (rows: ReadRow[], merges: readonly string[], header: Header): void => {
  if (merges.length === 0) return;
  const byRow = new Map(rows.map((entry) => [entry.row, entry]));
  for (const range of merges) {
    const [from, to] = range.split(':').map(cellRef);
    if (from === null || from === undefined || to === null || to === undefined) continue;
    const column = Math.min(from.column, to.column);
    const [top, bottom] = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
    if (top <= header.row || column >= header.width || bottom === top) continue;
    const first = byRow.get(top);
    const value = first?.cells[column];
    if (first === undefined || rawText(value).trim() === '') continue;
    for (const entry of rows) {
      if (entry.row <= top || entry.row > bottom) continue;
      if (rawText(entry.cells[column]).trim() === '') {
        entry.cells[column] = value;
        if (column === header.roles.get('code')) entry.codeFormat = first.codeFormat;
      }
    }
  }
};

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

/** A row as ExcelJS's streaming reader hands it: its number, its values from index 1 (column A). */
export interface StreamedBranchRow {
  number: number;
  values: unknown;
  /** The number format of the cell in this 1-based column. */
  numFmtAt?: (column: number) => string | undefined;
}

/**
 * The branch rows, read as the sheet's rows stream in: the header found in the first ten rows,
 * each later row only as wide as the bound columns, blank ones dropped, and no further than one row
 * past the cap.
 */
export const readBranchSheetRows = async (
  sheetName: string,
  rows: AsyncIterable<StreamedBranchRow>,
  merges: readonly string[] = [],
  limits: BranchSheetLimits = BRANCH_SHEET_LIMITS,
  deadline = Number.POSITIVE_INFINITY,
): Promise<BranchSheetRead> => {
  let header: Header | null = null;
  const read: ReadRow[] = [];
  let iterated = 0;
  for await (const streamed of rows) {
    iterated += 1;
    if (iterated > limits.maxRowsIterated) throw tooLarge('rows');
    if (Date.now() > deadline) throw tooLarge('time');
    // `values` is built afresh on every read of it: once per row.
    const values: readonly unknown[] = Array.isArray(streamed.values) ? streamed.values : [];
    if (header === null) {
      if (streamed.number > HEADER_SEARCH_ROWS) break;
      const candidate = headerOf(streamed.number, values.slice(1));
      if (candidate.roles.has('name')) {
        if (candidate.width > limits.maxColumns) throw tooLarge('columns');
        header = candidate;
      }
      continue;
    }
    const cells = Array.from({ length: header.width }, (_, column) => values[column + 1]);
    if (isBlankRow(header, cells)) continue;
    if (read.length >= limits.maxDataRows) throw tooLarge('rows');
    const codeColumn = header.roles.get('code');
    read.push({
      row: streamed.number,
      cells,
      codeFormat: codeColumn === undefined ? undefined : streamed.numFmtAt?.(codeColumn + 1),
    });
  }
  if (header === null) throw noHeader();
  fillMergedDown(read, merges, header);

  const found = header;
  const at = (cells: readonly unknown[], role: OperationsBranchImportRole): unknown => {
    const column = found.roles.get(role);
    return column === undefined ? undefined : cells[column];
  };
  const layout = OPERATIONS_BRANCH_IMPORT_ROLES.flatMap((role) => {
    const column = found.roles.get(role);
    return column === undefined
      ? []
      : [{ role, column: columnLetter(column), header: found.texts[column] ?? '' }];
  });
  return {
    sheetName,
    headerRow: found.row,
    layout,
    rows: read.map(({ row, cells, codeFormat }) => {
      const nameIsDate = isDateValue(at(cells, 'name'));
      return {
        row,
        name: tidyText(at(cells, 'name')),
        nameIsDate,
        code: codeTextOf(at(cells, 'code'), codeFormat),
        areaAr: areaText(at(cells, 'areaAr')),
        areaEn: areaText(at(cells, 'areaEn')),
        address: tidyText(at(cells, 'address')),
      };
    }),
  };
};

interface ExcelStreamRow {
  number: number;
  values: unknown;
  getCell: (column: number) => { numFmt?: string };
}

/**
 * Read the upload: its first VISIBLE sheet, under `limits` (a parameter so the spec can shrink
 * them; production passes none). A file that is no workbook is refused as such (422
 * `VALIDATION_FAILED`); one past a cap, or with no header, 422 `OPERATIONS_BRANCH_IMPORT_LAYOUT`.
 */
export const readBranchSheet = async (
  buffer: Buffer,
  limits: BranchSheetLimits = BRANCH_SHEET_LIMITS,
): Promise<BranchSheetRead> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceToOneSheet(buffer, 'firstVisible', limits, deadline, ZIP_ERRORS, {
    joinInlineRuns: true,
    readMerges: true,
  });
  const { default: ExcelJS } = await import('exceljs');
  const source = Readable.from(readSlices(reduced.buffer, limits.chunkBytes));
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    worksheets: 'emit',
    entries: 'emit',
  });
  // The reduced zip holds exactly one worksheet: the one picked.
  const rows = async function* (): AsyncGenerator<StreamedBranchRow> {
    for await (const worksheet of reader) {
      for await (const excelRow of worksheet) {
        const row = excelRow as unknown as ExcelStreamRow;
        yield {
          number: row.number,
          values: row.values,
          numFmtAt: (column) => row.getCell(column).numFmt,
        };
      }
      return;
    }
  };
  try {
    return await readBranchSheetRows(reduced.sheetName, rows(), reduced.merges, limits, deadline);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  } finally {
    // A read stopped early leaves the rest of the slices unread: stop feeding them.
    source.destroy();
  }
};
