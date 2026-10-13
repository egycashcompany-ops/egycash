// A synthetic `ATMs` register workbook, built in-test with ExcelJS (spec §10.3).
//
// NO VALUE OF THE OWNER'S WORKBOOK IS HERE, AND NONE MAY BE ADDED. Machine codes, names, key codes
// and combinations in fixtures are made up (`9999xxxx` codes, `FAKE-…` keys); the only things
// copied from the real sheet are its 49 row-1 headers, which are the binding contract and not
// data (they are the catalogue in packages/contracts).
//
// What it can build, because the import has to be proved against each of these:
//   · rows addressed by register FIELD (`atmRow({ branchCode: 'EGYCASH-4', … })`), so a test reads
//     as the register it describes rather than as column letters;
//   · cells with a fill (EG-2 marks), a number format (AO's `00 - 00 - 00`, `h:mm` times), Excel
//     errors, formulas with a cached result, rich text;
//   · the `END` sentinel and junk after it, a renamed or missing header;
//   · a secret-bearing sheet placed BEFORE `ATMs` — ExcelJS's writer puts every worksheet ahead of
//     `sharedStrings.xml`, which is exactly the layout that makes ExcelJS's own streaming reader
//     spill sheets to the temp directory (§6.2). The import must never do that.
import ExcelJS from 'exceljs';
import { ATM_REGISTER_COLUMNS, type AtmRegisterField } from '@ecms/contracts';

/** The exact row-1 header of every column, by letter (numbers for AB..AD, as in the sheet). */
export const REGISTER_HEADERS: ReadonlyMap<string, string | number> = new Map(
  ATM_REGISTER_COLUMNS.map((c) => [
    c.excel,
    ['AB', 'AC', 'AD'].includes(c.excel) ? Number(c.header) : c.header,
  ]),
);

type PlainValue =
  | string
  | number
  | boolean
  | Date
  | null
  | { formula: string; result?: string | number | boolean | Date | { error: string } }
  | { error: string }
  | { richText: { text: string }[] };

const CELL = Symbol('register-workbook-cell');

/** A cell with formatting — build it with `cell()`, `excelDate()`, `excelTime()`. */
export interface StyledCell {
  [CELL]: true;
  value: PlainValue;
  fill?: string;
  numFmt?: string;
}

export type SyntheticValue = PlainValue | StyledCell;

/** A row by Excel letter ('A' … 'AW', or beyond for junk). */
export type SyntheticRow = Record<string, SyntheticValue | undefined>;

export const cell = (
  value: PlainValue,
  style: { fill?: string; numFmt?: string } = {},
): StyledCell => ({
  [CELL]: true,
  value,
  ...style,
});

const isStyled = (value: SyntheticValue): value is StyledCell =>
  typeof value === 'object' && value !== null && CELL in value;

/** A real Excel date cell (a date-formatted number), `YYYY-MM-DD`. */
export const excelDate = (day: string, style: { fill?: string } = {}): StyledCell =>
  cell(new Date(`${day}T00:00:00.000Z`), { numFmt: 'yyyy-mm-dd', ...style });

/** A time-formatted number: `days` is the Excel value (0.5 = 12:00, 1 = typed 24:00, 3.75 …). */
export const excelTime = (days: number): StyledCell =>
  cell(new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86_400_000)), { numFmt: 'h:mm' });

const LETTER_BY_FIELD = new Map<AtmRegisterField, string>(
  ATM_REGISTER_COLUMNS.map((c) => [c.field, c.excel]),
);

/** A row by register field (`machineCode`, `keys.supervisorCode`, `safeCombination`, …). */
export const atmRow = (
  fields: Partial<Record<AtmRegisterField, SyntheticValue>>,
  extra: SyntheticRow = {},
): SyntheticRow => {
  const row: SyntheticRow = { ...extra };
  for (const [field, value] of Object.entries(fields) as [AtmRegisterField, SyntheticValue][]) {
    const letter = LETTER_BY_FIELD.get(field);
    if (letter !== undefined) row[letter] = value;
  }
  return row;
};

export interface RegisterWorkbookSpec {
  /** Data rows from row 3 on, in order; `null` leaves a blank row. */
  rows: (SyntheticRow | null)[];
  /** Write the `END` sentinel after the rows (default true). */
  sentinel?: boolean;
  /** Rows after the sentinel — must never be read. */
  trailing?: SyntheticRow[];
  /** Replace (string/number) or blank (null) a row-1 header, by letter. */
  headers?: Record<string, string | number | null>;
  /** Row-1 fills by letter (EG-2). */
  headerFills?: Record<string, string>;
  /** A worksheet written BEFORE `ATMs`, by address (e.g. `{ A1: 'FAKE-SECRET' }`). */
  sheetBefore?: { name: string; cells: Record<string, string | number> };
  /** Name of the register sheet (default `ATMs`) — to prove a missing sheet is refused. */
  sheetName?: string;
  /** Excel's 1904 date system. */
  date1904?: boolean;
}

const write = (target: ExcelJS.Cell, value: SyntheticValue | undefined): void => {
  if (value === undefined) return;
  if (isStyled(value)) {
    write(target, value.value);
    if (value.numFmt !== undefined) target.numFmt = value.numFmt;
    if (value.fill !== undefined) {
      target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: value.fill } };
    }
    return;
  }
  target.value = value as ExcelJS.CellValue;
};

const writeRow = (sheet: ExcelJS.Worksheet, rowNumber: number, row: SyntheticRow): void => {
  for (const [letter, value] of Object.entries(row))
    write(sheet.getCell(`${letter}${rowNumber}`), value);
};

/** The workbook as the bytes a browser would upload. */
export const buildRegisterWorkbook = async (spec: RegisterWorkbookSpec): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  if (spec.date1904 === true) workbook.properties.date1904 = true;
  if (spec.sheetBefore !== undefined) {
    const before = workbook.addWorksheet(spec.sheetBefore.name);
    for (const [address, value] of Object.entries(spec.sheetBefore.cells)) {
      before.getCell(address).value = value;
    }
  }
  const sheet = workbook.addWorksheet(spec.sheetName ?? 'ATMs');
  for (const [letter, header] of REGISTER_HEADERS) {
    const override = spec.headers?.[letter];
    const value = override === undefined ? header : override;
    if (value !== null) sheet.getCell(`${letter}1`).value = value;
    const fill = spec.headerFills?.[letter];
    if (fill !== undefined) {
      sheet.getCell(`${letter}1`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: fill },
      };
    }
  }
  // Row 2 is the sheet's SUM band — a formula the import must skip.
  sheet.getCell('AB2').value = { formula: 'SUM(AB3:AB4999)', result: 0 };
  let rowNumber = 3;
  for (const row of spec.rows) {
    if (row !== null) writeRow(sheet, rowNumber, row);
    rowNumber += 1;
  }
  if (spec.sentinel !== false) {
    sheet.getCell(`A${rowNumber}`).value = 'END';
    rowNumber += 1;
  }
  for (const row of spec.trailing ?? []) {
    writeRow(sheet, rowNumber, row);
    rowNumber += 1;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
};
