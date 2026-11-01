// Reading a bank's daily master workbook for the cassette-layout seed (docs/12-planning/
// atm-settlements-phase1.md §5.1, S-1). The only settlements file that knows what a zip and a sheet
// are; it reuses the register's reader (`register/import/read-register-workbook.ts`), so the same
// rules hold: nothing touches the disk, every part is inflated under its own cap, the entry count is
// checked before JSZip builds anything, and errors name a sheet, a header or a limit — never a
// cell's content.
//
// ONE reduction keeps both sheets (`Full list` and `REP. TAPE`); each is then streamed once from
// that in-memory zip. One deadline covers the whole read.
//
// WHAT IS READ, AND NOTHING ELSE:
//   · `Full list` row 1 (to bind the profile's headers by text), then rows 3.. to the sheet's end,
//     the bound columns only: code, location, the four denominations, the three labels and HELP.
//     The sheet's count columns are never read.
//   · `REP. TAPE` rows 1–2, D:G (the standard totals and their 200/100/50 counts, S-3);
//     row 7's headers over B, E, G, I, K; and rows 8–107, B, E, G, I, K — today's lines' codes and
//     denominations. Its count columns (C, D, F, H, J from row 8) are never read.
// The cells leave this file as typed cell values; `plan-layout-import.ts` decides what they mean.
import { ErrorCodes, type ApiErrorDetail } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { type RawCellValue } from '../../register/import/cell-convert';
import {
  readSheetRows,
  reduceWorkbookToSheets,
  unreadableWorkbook,
  type ReducedWorkbook,
  type WorkbookPartLimits,
  type WorkbookReadErrors,
} from '../../register/import/read-register-workbook';
import { columnNumber, headerKey, type AtmMasterProfile } from './master-profiles';

const MB = 1024 * 1024;

export interface MasterWorkbookLimits extends WorkbookPartLimits {
  /** Rows the reader may iterate per sheet, blank ones included. */
  maxRowsIterated: number;
  /** Non-blank rows per sheet. */
  maxDataRows: number;
  /** Wall-clock for the whole read, both sheets and the inflation included. */
  timeMs: number;
}

/**
 * Sized for a bank master, not for the register (§5.1): the BRK master's parts are about 75 KB
 * (`Full list`), 130 KB (`REP. TAPE`), 12 KB of shared strings and 90 KB of styles, in 39 entries
 * and 1.1 MB on disk.
 */
export const MASTER_WORKBOOK_LIMITS: MasterWorkbookLimits = {
  workbookBytes: 1 * MB,
  relsBytes: 1 * MB,
  stylesBytes: 4 * MB,
  sharedStringsBytes: 8 * MB,
  sheetBytes: 16 * MB,
  maxRowsIterated: 5_000,
  maxDataRows: 2_000,
  timeMs: 20_000,
};

/** The upload cap (§6.3). */
export const MASTER_IMPORT_MAX_MB = 10;

/** How far along row 1 the profile's headers are looked for. */
const HEADER_SCAN_COLUMNS = 64;

/** `ATM_LAYOUT_IMPORT_LAYOUT` 422 (SEC-12): a settlements read never answers a register code. */
export const MASTER_READ_ERRORS: WorkbookReadErrors = {
  layout: (message: string, details: ApiErrorDetail[]) =>
    new AppError(ErrorCodes.ATM_LAYOUT_IMPORT_LAYOUT, 422, message, { details }),
  unreadable: unreadableWorkbook,
};

const missingHeaders = (sheet: string, details: ApiErrorDetail[]): AppError =>
  MASTER_READ_ERRORS.layout(`the ${sheet} sheet does not have the expected columns`, details);

export interface MasterFullListRow {
  /** The Excel row number. */
  row: number;
  code: RawCellValue;
  location: RawCellValue;
  /** `Denom1..4`, in slot order. */
  denominations: RawCellValue[];
  typeLabel: RawCellValue;
  featuresLabel: RawCellValue;
  hubLabel: RawCellValue;
  help: RawCellValue;
}

export interface MasterStandardRow {
  row: 1 | 2;
  /** Column D. */
  total: RawCellValue;
  /** Columns E/F/G with the denomination each one counts. */
  counts: { denomination: number; cell: RawCellValue }[];
}

export interface MasterDayLine {
  row: number;
  code: RawCellValue;
  /** E, G, I, K — cassettes 1..4. */
  denominations: RawCellValue[];
}

export interface MasterWorkbookRead {
  fullList: MasterFullListRow[];
  standardRows: MasterStandardRow[];
  dayLines: MasterDayLine[];
}

const EMPTY: RawCellValue = { kind: 'empty' };

/** A header cell's text, as the binding compares it; null for anything that is not text. */
const headerTextOf = (value: RawCellValue): string | null => {
  if (value.kind === 'string') return headerKey(value.value);
  if (value.kind === 'number') return String(value.value);
  return null;
};

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The Full list's profile headers → the first column carrying each, or the missing ones. */
const bindFullList = (
  profile: AtmMasterProfile,
  headerCells: readonly { value: RawCellValue }[],
): number[] => {
  const texts = headerCells.map((cell) => headerTextOf(cell.value));
  const wanted = [
    profile.columns.code,
    profile.columns.location,
    ...profile.columns.denominations,
    profile.columns.typeLabel,
    profile.columns.featuresLabel,
    profile.columns.hubLabel,
    profile.columns.help,
  ];
  const missing: ApiErrorDetail[] = [];
  const columns = wanted.map((header) => {
    const index = texts.indexOf(header);
    if (index === -1) {
      missing.push({ field: profile.sheet, code: 'MISSING_HEADER', message: header });
    }
    return index + 1;
  });
  if (missing.length > 0) throw missingHeaders(profile.sheet, missing);
  return columns;
};

const readFullList = async (
  reduced: ReducedWorkbook,
  profile: AtmMasterProfile,
  limits: MasterWorkbookLimits,
  deadline: number,
): Promise<MasterFullListRow[]> => {
  const headerColumns = range(1, HEADER_SCAN_COLUMNS);
  let bound: number[] | null = null;
  const rows: MasterFullListRow[] = [];
  for await (const { row, cells } of readSheetRows(reduced, profile.sheet, {
    maxRowsIterated: limits.maxRowsIterated,
    maxDataRows: limits.maxDataRows,
    deadline,
    columns: (n) => {
      if (n === profile.headerRow) return headerColumns;
      return n >= profile.firstDataRow && bound !== null ? bound : [];
    },
  })) {
    if (row === profile.headerRow) {
      bound = bindFullList(profile, cells);
      continue;
    }
    const value = (i: number): RawCellValue => cells[i]?.value ?? EMPTY;
    rows.push({
      row,
      code: value(0),
      location: value(1),
      denominations: [value(2), value(3), value(4), value(5)],
      typeLabel: value(6),
      featuresLabel: value(7),
      hubLabel: value(8),
      help: value(9),
    });
  }
  if (bound === null) bindFullList(profile, []); // no header row at all: every header is missing
  return rows;
};

const readRepTape = async (
  reduced: ReducedWorkbook,
  profile: AtmMasterProfile,
  limits: MasterWorkbookLimits,
  deadline: number,
): Promise<{ standardRows: MasterStandardRow[]; dayLines: MasterDayLine[] }> => {
  const { standardLoads, dayLines } = profile;
  const countLetters = Object.keys(standardLoads.counts) as (keyof typeof standardLoads.counts)[];
  const standardColumns = [standardLoads.total, ...countLetters].map(columnNumber);
  const dayColumns = [dayLines.code, ...dayLines.denominations].map(columnNumber);
  const dayHeaders = [profile.columns.code, ...profile.columns.denominations];
  const standardRows = new Map<number, RawCellValue[]>();
  const lines: MasterDayLine[] = [];
  let headerChecked = false;

  for await (const { row, cells } of readSheetRows(reduced, dayLines.sheet, {
    maxRowsIterated: limits.maxRowsIterated,
    maxDataRows: limits.maxDataRows,
    deadline,
    lastRow: dayLines.lastRow,
    columns: (n) => {
      if ((standardLoads.rows as readonly number[]).includes(n)) return standardColumns;
      if (n === dayLines.headerRow || n >= dayLines.firstRow) return dayColumns;
      return [];
    },
  })) {
    const values = cells.map((cell) => cell.value);
    if ((standardLoads.rows as readonly number[]).includes(row)) {
      standardRows.set(row, values);
    } else if (row === dayLines.headerRow) {
      checkDayHeaders(profile, dayHeaders, values);
      headerChecked = true;
    } else {
      lines.push({ row, code: values[0] ?? EMPTY, denominations: values.slice(1) });
    }
  }
  if (!headerChecked) checkDayHeaders(profile, dayHeaders, []);

  return {
    standardRows: standardLoads.rows.map((n) => {
      const values = standardRows.get(n) ?? [];
      return {
        row: n,
        total: values[0] ?? EMPTY,
        counts: countLetters.map((letter, i) => ({
          denomination: standardLoads.counts[letter],
          cell: values[i + 1] ?? EMPTY,
        })),
      };
    }),
    dayLines: lines,
  };
};

/** REP. TAPE row 7 over the columns read: `Reference`, `Denom1..4` (§5.2). */
const checkDayHeaders = (
  profile: AtmMasterProfile,
  expected: readonly string[],
  values: readonly RawCellValue[],
): void => {
  const letters = [profile.dayLines.code, ...profile.dayLines.denominations];
  const missing: ApiErrorDetail[] = [];
  expected.forEach((header, i) => {
    if (headerTextOf(values[i] ?? EMPTY) !== header) {
      missing.push({
        field: `${profile.dayLines.sheet}!${letters[i] ?? ''}${String(profile.dayLines.headerRow)}`,
        code: 'MISSING_HEADER',
        message: header,
      });
    }
  });
  if (missing.length > 0) throw missingHeaders(profile.dayLines.sheet, missing);
};

/**
 * Read a bank's master workbook with its profile (§5.1). The limits are a parameter so the spec can
 * shrink them; production passes none.
 */
export const readMasterWorkbook = async (
  upload: Buffer,
  profile: AtmMasterProfile,
  limits: MasterWorkbookLimits = MASTER_WORKBOOK_LIMITS,
): Promise<MasterWorkbookRead> => {
  const deadline = Date.now() + limits.timeMs;
  const reduced = await reduceWorkbookToSheets(
    upload,
    [profile.sheet, profile.dayLines.sheet],
    limits,
    deadline,
    MASTER_READ_ERRORS,
  );
  const fullList = await readFullList(reduced, profile, limits, deadline);
  const { standardRows, dayLines } = await readRepTape(reduced, profile, limits, deadline);
  return { fullList, standardRows, dayLines };
};
