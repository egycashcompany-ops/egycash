// A synthetic bank master workbook (`Full list` + `REP. TAPE`), built in-test with ExcelJS
// (docs/12-planning/atm-settlements-phase1.md §10, "no workbook is committed").
//
// NO VALUE OF THE OWNER'S WORKBOOKS IS HERE, AND NONE MAY BE ADDED. Codes are invented
// (`BRKN9001` …), names are «ماكينة اختبار n», counts are made up. What is copied from the real
// sheets is their header TEXT and positions — the binding contract of the import profile, not data.
//
// ExcelJS's writer puts every worksheet ahead of `sharedStrings.xml`, which is exactly the layout
// that would make ExcelJS's own streaming reader spill sheets to the temp directory; the import
// must read it without writing anything.
import ExcelJS from 'exceljs';

/** `Full list` row 1, A..P (the sheet's own words: `No-of bills1` vs `No- of bills2`). */
export const FULL_LIST_HEADERS = [
  'Reference',
  'location',
  'No-of bills1',
  'Denom1',
  'No- of bills2',
  'Denom2',
  'No- of bills3',
  'Denom3',
  'No- of bills4',
  'Denom4',
  'Total cash fill for the ATM',
  'Deposit',
  'Dep',
  'Date',
  'Bank',
  'HELP',
] as const;

/** `REP. TAPE` row 7, B..P. */
export const REP_TAPE_HEADERS = [
  'Reference',
  'location',
  'No-of bills1',
  'Denom1',
  'No- of bills2',
  'Denom2',
  'No- of bills3',
  'Denom3',
  'No- of bills4',
  'Denom4',
  'Total cash fill for the ATM',
  'Comments',
  'Dep',
  'Request Date',
  'Bank',
] as const;

type Value = string | number | null | { formula: string; result?: number | string };

export interface MasterRow {
  code: Value;
  location?: Value;
  /** `Denom1..4`; 0 or null = no cassette. */
  denominations: Value[];
  /** Written into the `No-of bills` columns, which the import must never read. */
  counts?: Value[];
  deposit?: Value;
  dep?: Value;
  bank?: Value;
  help?: Value;
  /** Column N, which the import does not bind. */
  date?: Value;
}

export interface MasterDayLine {
  code: Value;
  location?: Value;
  denominations: Value[];
  /** Written into D/F/H/J, which the import must never read. */
  counts?: Value[];
}

export interface MasterWorkbookInput {
  fullList?: MasterRow[];
  /** `REP. TAPE!D1:G2`: [D (total), E (200s), F (100s), G (50s)] per row. */
  standardRows?: Value[][];
  dayLines?: MasterDayLine[];
  /** Replace a `Full list` row-1 header (0-based column index → text). */
  fullListHeaders?: Record<number, string>;
  /** Replace a `REP. TAPE` row-7 header (letter → text). */
  repTapeHeaders?: Record<string, string>;
  /** Leave a sheet out. */
  omit?: 'Full list' | 'REP. TAPE';
  /** Extra cells written on `Full list` (A1 address → value), e.g. far rows. */
  fullListCells?: Record<string, Value>;
  /** A sheet placed before the two, holding a fake secret. */
  sheetBefore?: { name: string; cells: Record<string, Value> };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const write = (sheet: ExcelJS.Worksheet, address: string, value: Value | undefined): void => {
  if (value === undefined || value === null) return;
  sheet.getCell(address).value = value as ExcelJS.CellValue;
};

/** Build the workbook; every argument is synthetic. */
export const buildMasterWorkbook = async (input: MasterWorkbookInput = {}): Promise<Buffer> => {
  const book = new ExcelJS.Workbook();
  if (input.sheetBefore !== undefined) {
    const before = book.addWorksheet(input.sheetBefore.name);
    for (const [address, value] of Object.entries(input.sheetBefore.cells)) {
      write(before, address, value);
    }
  }

  if (input.omit !== 'Full list') {
    const full = book.addWorksheet('Full list');
    FULL_LIST_HEADERS.forEach((header, i) => {
      write(full, `${LETTERS[i] ?? ''}1`, input.fullListHeaders?.[i] ?? header);
    });
    (input.fullList ?? []).forEach((row, i) => {
      const r = String(i + 3);
      write(full, `A${r}`, row.code);
      write(full, `B${r}`, row.location ?? null);
      ['D', 'F', 'H', 'J'].forEach((letter, k) => {
        write(full, `${letter}${r}`, row.denominations[k] ?? null);
      });
      ['C', 'E', 'G', 'I'].forEach((letter, k) => {
        write(full, `${letter}${r}`, row.counts?.[k] ?? null);
      });
      write(full, `L${r}`, row.deposit ?? null);
      write(full, `M${r}`, row.dep ?? null);
      write(full, `N${r}`, row.date ?? null);
      write(full, `O${r}`, row.bank ?? null);
      write(full, `P${r}`, row.help ?? null);
    });
    for (const [address, value] of Object.entries(input.fullListCells ?? {})) {
      write(full, address, value);
    }
  }

  if (input.omit !== 'REP. TAPE') {
    const tape = book.addWorksheet('REP. TAPE');
    (input.standardRows ?? []).forEach((values, i) => {
      ['D', 'E', 'F', 'G'].forEach((letter, k) => {
        write(tape, `${letter}${String(i + 1)}`, values[k] ?? null);
      });
    });
    write(tape, 'B4', 'Date of cash fill:');
    write(tape, 'B6', ' ATMs');
    REP_TAPE_HEADERS.forEach((header, i) => {
      const letter = LETTERS[i + 1] ?? '';
      write(tape, `${letter}7`, input.repTapeHeaders?.[letter] ?? header);
    });
    (input.dayLines ?? []).forEach((line, i) => {
      const r = String(i + 8);
      write(tape, `B${r}`, line.code);
      write(tape, `C${r}`, line.location ?? null);
      ['E', 'G', 'I', 'K'].forEach((letter, k) => {
        write(tape, `${letter}${r}`, line.denominations[k] ?? null);
      });
      ['D', 'F', 'H', 'J'].forEach((letter, k) => {
        write(tape, `${letter}${r}`, line.counts?.[k] ?? null);
      });
    });
  }

  return Buffer.from(await book.xlsx.writeBuffer());
};
