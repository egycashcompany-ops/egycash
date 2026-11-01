// Reading a machines file — the only file of the machine sync that knows what a workbook is.
//
// The owner's file is the old system's machine list as it exports it («ATM (4).xlsx»): one sheet
// named «ATM», a header row «Bank | ID | ATM Name | Area», a machine per row. A hand-made list may
// call its sheet anything, put the header a few rows down, order the columns otherwise, or write
// the headers in Arabic. So: the sheet named «ATM» if there is one, else the first; the header is
// the first of the opening rows that names all four columns; and from it on, every row is read as
// the four texts, nothing more.
//
// The upload goes through the register import's reader (`reduceWorkbookToSheets`, `readSheetRows`):
// in memory only, the zip's entry count and every inflated part capped, one deadline. Errors name
// a column or a cap — never a cell's content.
import { ErrorCodes, type ApiErrorDetail } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { numberText, type RawCell } from '../../register/import/cell-convert';
import {
  reduceWorkbookToSheets,
  readSheetRows,
  unreadableWorkbook,
  type WorkbookPartLimits,
  type WorkbookReadErrors,
} from '../../register/import/read-register-workbook';

const MB = 1024 * 1024;

export interface MachineFileLimits extends WorkbookPartLimits {
  maxRowsIterated: number;
  maxDataRows: number;
  timeMs: number;
}

/** The owner's list is ~1,840 rows and 80 KB; the caps are against a mistake, not a size. */
export const MACHINE_FILE_LIMITS: MachineFileLimits = {
  workbookBytes: 2 * MB,
  relsBytes: 2 * MB,
  stylesBytes: 10 * MB,
  sharedStringsBytes: 20 * MB,
  sheetBytes: 50 * MB,
  maxRowsIterated: 30_000,
  maxDataRows: 10_000,
  timeMs: 30_000,
};

/** Header rows are looked for among the first rows only. */
const HEADER_SEARCH_ROWS = 10;
/** Columns read per row — a header further right than this is not a machine list. */
const COLUMNS_READ = 15;

export const MACHINE_FILE_COLUMNS = ['bank', 'code', 'name', 'area'] as const;
export type MachineFileColumn = (typeof MACHINE_FILE_COLUMNS)[number];

/** What each column's header may say, folded (lower case, spaces and hamza folded). */
const HEADER_ALIASES: Record<MachineFileColumn, readonly string[]> = {
  bank: ['bank', 'bank name', 'البنك', 'بنك', 'اسم البنك'],
  code: [
    'id',
    'atm id',
    'code',
    'atm code',
    'machine id',
    'machine code',
    'الكود',
    'كود',
    'كود الماكينه',
    'رقم الماكينه',
    'الرقم',
  ],
  name: ['atm name', 'name', 'machine name', 'الاسم', 'اسم الماكينه', 'اسم'],
  area: ['area', 'zone area', 'المنطقه', 'منطقه'],
};

const MACHINE_FILE_ERRORS: WorkbookReadErrors = {
  layout: (message: string, details: ApiErrorDetail[]) =>
    new AppError(ErrorCodes.ATM_MACHINE_SYNC_LAYOUT, 422, message, { details }),
  unreadable: unreadableWorkbook,
};

const foldHeader = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s_]+/g, ' ')
    .trim();

/** A cell as the text a person sees — numbers as Excel's General format shows them. */
export const cellText = (cell: RawCell | undefined): string => {
  const value = cell?.value;
  if (value === undefined) return '';
  switch (value.kind) {
    case 'string':
      return value.value.trim();
    case 'number':
      return numberText(value.value);
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'date':
      return value.value.toISOString().slice(0, 10);
    default:
      return '';
  }
};

/**
 * Pure: which column (0-based among those read) each field is in, if this row is a header — all
 * four must be named, each once. Exported for its spec.
 */
export const bindMachineHeader = (
  texts: readonly string[],
): Record<MachineFileColumn, number> | null => {
  const bound: Partial<Record<MachineFileColumn, number>> = {};
  texts.forEach((text, index) => {
    const folded = foldHeader(text);
    if (folded === '') return;
    for (const column of MACHINE_FILE_COLUMNS) {
      if (bound[column] === undefined && HEADER_ALIASES[column].includes(folded)) {
        bound[column] = index;
        return;
      }
    }
  });
  return MACHINE_FILE_COLUMNS.every((column) => bound[column] !== undefined)
    ? (bound as Record<MachineFileColumn, number>)
    : null;
};

/** Pure: the sheet to read — «ATM» if declared (any case), else the first. Exported for its spec. */
export const machineSheetOf = (declared: readonly string[]): string[] => {
  const atm = declared.find((name) => name.trim().toLowerCase() === 'atm');
  const first = atm ?? declared[0];
  return first === undefined ? [] : [first];
};

export interface MachineFileRow {
  /** The Excel row. */
  row: number;
  bank: string;
  code: string;
  name: string;
  area: string;
}

/** Read the machines of an uploaded workbook. The limits are a parameter so a spec can shrink them. */
export const readMachineFile = async (
  upload: Buffer,
  limits: MachineFileLimits = MACHINE_FILE_LIMITS,
): Promise<MachineFileRow[]> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceWorkbookToSheets(
    upload,
    machineSheetOf,
    limits,
    deadline,
    MACHINE_FILE_ERRORS,
  );
  const sheet = reduced.sheets[0];
  if (sheet === undefined) {
    throw MACHINE_FILE_ERRORS.layout('the workbook has no sheet', [
      { field: 'file', code: 'MISSING_SHEET', message: 'ATM' },
    ]);
  }
  const columns = Array.from({ length: COLUMNS_READ }, (_, i) => i + 1);
  let header: Record<MachineFileColumn, number> | null = null;
  let rowsSeen = 0;
  const rows: MachineFileRow[] = [];
  for await (const { row, cells } of readSheetRows(reduced, sheet, {
    maxRowsIterated: limits.maxRowsIterated,
    maxDataRows: limits.maxDataRows,
    deadline,
    columns,
  })) {
    const texts = cells.map(cellText);
    if (header === null) {
      rowsSeen += 1;
      header = bindMachineHeader(texts);
      if (header === null && rowsSeen >= HEADER_SEARCH_ROWS) break;
      continue;
    }
    const at = header;
    rows.push({
      row,
      bank: texts[at.bank] ?? '',
      code: texts[at.code] ?? '',
      name: texts[at.name] ?? '',
      area: texts[at.area] ?? '',
    });
  }
  if (header === null) {
    throw MACHINE_FILE_ERRORS.layout('no header row names Bank, ID, ATM Name and Area', [
      { field: 'file', code: 'MISSING_HEADER', message: MACHINE_FILE_COLUMNS.join(',') },
    ]);
  }
  return rows;
};
