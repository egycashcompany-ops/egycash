// Reading a fuel company's balance sheet — «الصفحه محتاجه تتظبط جامد».
//
// NOTHING TOUCHES THE DISK. The companies' sheets write every text cell inline and carry no
// shared-strings part, so ExcelJS's streaming reader, handed the file as it came, would always
// spill the sheet to a temp file. The upload is reduced in memory to its FIRST tab first
// (`shared/xlsx/one-sheet-zip.ts`: the entry count is checked before JSZip opens anything, SEC-13,
// and every part is inflated under its cap), then streamed row by row. ExcelJS is CommonJS and
// loaded with `await import` here, never at module scope.
//
// COLUMNS BY ROLE, NOT BY ONE SPELLING. The company's data sheet prints «Card Number / Card Name /
// Card Balance / car code / pass»; its statement of the same cards prints a masked number, the bare
// «EGYCASH», «لوحه», «شاسيه» (or two UNTITLED columns holding them), «كود» and «قيمه الشحن». Each
// header is folded (`foldSheetHeader`) and looked up in `FLEET_FUEL_SHEET_SYNONYMS`; the header row
// is the first of the first ten rows that names a number and a balance. An untitled column between
// the name and the balance is read by its content: the first that holds short figures is the
// plate, the next the chassis — and the reading says so (`assumed`).
//
// NEVER READ: the PIN column («pass») and the company's planned top-up («قيمه الشحن») are
// recognised by their header and their cells are never unwrapped — not into a row, not into a
// variable. They appear in `layout` so the screen can say they were seen and left alone.
//
// What it returns is the rows as read, each with its Excel row number:
//   · a CARD row has a number or a name; a balance that is not a figure of zero or more (a card's
//     balance is never below zero — his Chill Out sheet of 2026-10-20 has one at −2,214.66) sets it
//     aside as `invalid` — shown, never decided;
//   · a row with NO number and NO name is not a card (a title, the totals at the foot of a
//     statement) — `skipped`, and the first such row whose figure equals the cards' sum is the
//     `totalCheck`;
//   · a bare company prefix («EGYCASH») beside a plate or a chassis is rebuilt into the name the
//     card carries («EGYCASH-3674-B257539») — `builtName`, what the comparison matches.
// Errors name a role or a limit, never a cell's content.
import { Readable } from 'node:stream';
import {
  ErrorCodes,
  FLEET_FUEL_SHEET_COLUMNS,
  FLEET_FUEL_SHEET_NAME_PREFIX,
  FLEET_FUEL_SHEET_NEVER_READ,
  FLEET_FUEL_SHEET_ROLES,
  FLEET_FUEL_SHEET_SYNONYMS,
  foldSheetHeader,
  type ApiErrorDetail,
  type FleetFuelSheetLayoutColumnDto,
  type FleetFuelSheetNumberKind,
  type FleetFuelSheetRole,
  type FleetFuelSheetSkippedRowDto,
  type FleetFuelSheetTotalCheckDto,
} from '@ecms/contracts';
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
  /**
   * The furthest column a column the reading uses (a role, a never-read one) may stand in. Every
   * data row is kept only that wide — a stray cell far to the right (column XFD) costs nothing.
   */
  maxColumns: number;
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
  // His sheets print five to seven columns.
  maxColumns: 256,
};

/** The header is looked for up to this row. */
const HEADER_SEARCH_ROWS = 10;
/** An untitled column is read by its content when at least this share of the data rows fill it… */
const UNTITLED_FILLED = 0.5;
/** …and it is the PLATE when at least this share of its values are one to four digits. */
const PLATE_SHARE = 0.8;

export interface FuelSheetRow {
  /** The Excel row number. */
  row: number;
  /** As printed (the companies mask all but the last four digits). */
  number: string;
  /** As printed — the bare company prefix on a statement. */
  name: string;
  /** EGP, rounded to the piastre. */
  balance: number;
  /** What the comparison matches: `name`, or the name rebuilt from the prefix, plate and chassis. */
  builtName: string;
  plate: string | null;
  chassis: string | null;
  /** The sheet's car code, as printed. */
  code: string | null;
  numberKind: FleetFuelSheetNumberKind;
}

export type FuelSheetInvalidReason = 'badBalance';

export interface FuelSheetInvalidRow extends Omit<FuelSheetRow, 'balance'> {
  /** As read — negative on a row that holds one; `null` when it holds no figure. */
  balance: number | null;
  reason: FuelSheetInvalidReason;
}

export interface FuelSheetRead {
  rows: FuelSheetRow[];
  invalid: FuelSheetInvalidRow[];
  /** Data rows read: the card rows (valid and invalid) and the skipped ones. */
  rowsRead: number;
  /** How each column was read, in sheet order. */
  layout: FleetFuelSheetLayoutColumnDto[];
  /** Rows that are not cards. */
  skipped: FleetFuelSheetSkippedRowDto[];
  totalCheck: FleetFuelSheetTotalCheckDto | null;
  /** Some names were rebuilt from the prefix, the plate and the chassis. */
  nameRebuilt: boolean;
  /** The first card row — the layout line's example. */
  example: { row: number; builtName: string } | null;
  /** The sheet has a car-code column. */
  carColumn: boolean;
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

/** The required roles a header lacks, by their English column name («Card Balance»). */
const REQUIRED_ROLES: readonly { role: FleetFuelSheetRole; column: string }[] = [
  { role: 'number', column: FLEET_FUEL_SHEET_COLUMNS[0] },
  { role: 'balance', column: FLEET_FUEL_SHEET_COLUMNS[2] },
];

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

/** A number cell this large has lost digits: a spreadsheet keeps fifteen significant ones. */
const IMPRECISE_FROM = 1e15;

const textOf = (cell: Cell): string => {
  if (cell.kind === 'empty') return '';
  // A number typed into a cell (a 16-digit card number, a plate, a chassis) — its integer part,
  // every digit of it (`BigInt`, never an exponent).
  if (cell.kind === 'number') return BigInt(Math.trunc(cell.value)).toString();
  return cell.value.trim();
};

const orNull = (text: string): string | null => (text === '' ? null : text);

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

/** Full (12–19 digits), masked (digits, a run of `*`/`x`/`•`, at least four digits), or neither. */
export const FULL_NUMBER = /^\d{12,19}$/u;
export const MASKED_NUMBER = /^(\d*)[*xX•●·#]+(\d{4,})$/u;

/** How a card number cell is printed — `FLEET_FUEL_SHEET_NUMBER_KINDS`. */
export const sheetNumberKindOf = (cell: Cell): FleetFuelSheetNumberKind => {
  if (cell.kind === 'number' && Math.abs(cell.value) >= IMPRECISE_FROM) return 'imprecise';
  const spaced = textOf(cell).replace(/\s/gu, '');
  if (spaced === '') return 'none';
  if (FULL_NUMBER.test(spaced)) return 'full';
  if (MASKED_NUMBER.test(spaced)) return 'masked';
  return 'other';
};

/** «EGYCASH», «EGYCASHTCS» — the company prefixes without their dash. */
const BARE_PREFIXES = new Set(
  Object.values(FLEET_FUEL_SHEET_NAME_PREFIX).map((prefix) =>
    prefix.replace(/-$/u, '').toUpperCase(),
  ),
);

/**
 * The name the card carries: a bare company prefix beside a plate or a chassis is rebuilt as
 * «PREFIX-<plate digits>-<CHASSIS>» — the split Excel's «Text to Columns» made, undone. Any other
 * name is the name as printed.
 */
export const buildCardName = (
  name: string,
  plate: string | null,
  chassis: string | null,
): { builtName: string; rebuilt: boolean } => {
  const bare = name.normalize('NFKC').trim().toUpperCase();
  const plateDigits = (plate ?? '').replace(/\D/gu, '');
  const chassisText = (chassis ?? '').normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
  if (!BARE_PREFIXES.has(bare) || (plateDigits === '' && chassisText === '')) {
    return { builtName: name.trim(), rebuilt: false };
  }
  return {
    builtName: [bare, plateDigits, chassisText].filter((part) => part !== '').join('-'),
    rebuilt: true,
  };
};

/** Each folded header → the role it names, or `secret` / `ignored` (never read). */
const HEADER_ROLES = new Map<string, FleetFuelSheetLayoutColumnDto['role']>([
  ...FLEET_FUEL_SHEET_ROLES.flatMap((role) =>
    FLEET_FUEL_SHEET_SYNONYMS[role].map((key) => [key, role] as const),
  ),
  ...FLEET_FUEL_SHEET_NEVER_READ.secret.map((key) => [key, 'secret'] as const),
  ...FLEET_FUEL_SHEET_NEVER_READ.ignored.map((key) => [key, 'ignored'] as const),
]);

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

interface ReaderRow {
  number: number;
  values: unknown;
}

/**
 * The cells, at most `width` of them — a NEVER-READ column's cell is not even unwrapped: it stays
 * empty. ExcelJS's `values` is 1-based (index 0 is always empty) and BUILT AFRESH on every read of
 * it, walking the row as wide as its last cell: the caller reads it once per row.
 */
const cellsOf = (
  values: unknown,
  neverRead: ReadonlySet<number>,
  width = Number.POSITIVE_INFINITY,
): Cell[] => {
  const list = Array.isArray(values) ? (values as unknown[]) : [];
  return Array.from({ length: Math.min(Math.max(0, list.length - 1), width) }, (_, i) =>
    neverRead.has(i) ? EMPTY : unwrapFuelCell(list[i + 1]),
  );
};

interface Header {
  /** 0-based column of each role found by its header (the first such column wins). */
  roles: Map<FleetFuelSheetRole, number>;
  /** Columns recognised and never read. */
  neverRead: Map<number, 'secret' | 'ignored'>;
  /** Each column's header as printed; '' for an untitled one. */
  texts: string[];
  /**
   * One past the furthest column the reading uses — a role or a never-read column. The untitled
   * plate and chassis columns lie between the name and the balance, so inside it too.
   */
  width: number;
}

const headerOf = (cells: readonly Cell[]): Header => {
  const roles = new Map<FleetFuelSheetRole, number>();
  const neverRead = new Map<number, 'secret' | 'ignored'>();
  const texts = cells.map((cell) => (cell.kind === 'text' ? cell.value.trim() : ''));
  texts.forEach((text, i) => {
    if (text === '') return;
    const role = HEADER_ROLES.get(foldSheetHeader(text));
    if (role === 'secret' || role === 'ignored') neverRead.set(i, role);
    else if (role !== undefined && !roles.has(role)) roles.set(role, i);
  });
  const width = Math.max(0, ...roles.values(), ...neverRead.keys()) + 1;
  return { roles, neverRead, texts: texts.slice(0, width), width };
};

const isHeader = (header: Header): boolean =>
  REQUIRED_ROLES.every(({ role }) => header.roles.has(role));

/**
 * The untitled columns strictly between the name and the balance, read by their content: the
 * first well-filled one whose values are short figures is the plate, the next the chassis.
 */
const assumedColumns = (
  header: Header,
  data: readonly { cells: Cell[] }[],
): Map<'plate' | 'chassis', number> => {
  const assumed = new Map<'plate' | 'chassis', number>();
  const name = header.roles.get('name');
  const balance = header.roles.get('balance');
  if (name === undefined || balance === undefined || data.length === 0) return assumed;
  const [lo, hi] = name < balance ? [name, balance] : [balance, name];
  for (let i = lo + 1; i < hi; i += 1) {
    if ((header.texts[i] ?? '') !== '' || header.neverRead.has(i)) continue;
    if ([...header.roles.values()].includes(i)) continue;
    const values = data.map((row) => textOf(row.cells[i] ?? EMPTY)).filter((text) => text !== '');
    if (values.length < data.length * UNTITLED_FILLED) continue;
    const short = values.filter((text) => /^\d{1,4}$/u.test(text)).length / values.length;
    if (!header.roles.has('plate') && !assumed.has('plate') && short >= PLATE_SHARE) {
      assumed.set('plate', i);
    } else if (!header.roles.has('chassis') && !assumed.has('chassis')) {
      assumed.set('chassis', i);
    }
  }
  return assumed;
};

const piastres = (egp: number): number => Math.round(egp * 100);

/**
 * The totals chip: the first skipped row whose figure equals Σ the card balances to the piastre;
 * else the first skipped row with a figure, which disagrees; `null` when none has a figure.
 */
const totalCheckOf = (
  skipped: readonly FleetFuelSheetSkippedRowDto[],
  rows: readonly FuelSheetRow[],
): FleetFuelSheetTotalCheckDto | null => {
  const sum = rows.reduce((total, row) => total + piastres(row.balance), 0);
  const figured = skipped.filter(
    (row): row is FleetFuelSheetSkippedRowDto & { figure: number } => row.figure !== null,
  );
  const agreeing = figured.find((row) => piastres(row.figure) === sum);
  const chosen = agreeing ?? figured[0];
  if (chosen === undefined) return null;
  return {
    row: chosen.row,
    text: chosen.text,
    figure: chosen.figure,
    sum: sum / 100,
    agrees: agreeing !== undefined,
  };
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

  let header: Header | null = null;
  /** The never-read columns, once the header names them. */
  let skipColumns: ReadonlySet<number> = new Set();
  /** The first row up to the tenth that named any role — what a refusal says it lacks. */
  let nearest: Header | null = null;
  const data: { row: number; cells: Cell[] }[] = [];
  let iterated = 0;

  try {
    // The reduced zip holds exactly one worksheet: the first tab.
    sheets: for await (const worksheet of reader) {
      for await (const excelRow of worksheet) {
        iterated += 1;
        if (iterated > limits.maxRowsIterated) throw tooLarge('rows');
        if (Date.now() > deadline) throw tooLarge('time');
        const row = excelRow as unknown as ReaderRow;

        if (header === null) {
          if (row.number > HEADER_SEARCH_ROWS) break sheets;
          const cells = cellsOf(row.values, new Set());
          if (cells.every(isBlank)) continue;
          const candidate = headerOf(cells);
          if (isHeader(candidate)) {
            if (candidate.width > limits.maxColumns) throw tooLarge('columns');
            header = candidate;
            skipColumns = new Set(candidate.neverRead.keys());
          } else if (nearest === null && candidate.roles.size > 0) nearest = candidate;
          continue;
        }

        // Only as wide as the header's columns: nothing past them is ever read.
        const cells = cellsOf(row.values, skipColumns, header.width);
        if (cells.every(isBlank)) continue;
        if (data.length >= limits.maxDataRows) throw tooLarge('rows');
        data.push({ row: row.number, cells });
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unreadable();
  }

  if (header === null) {
    const lacks = REQUIRED_ROLES.filter(({ role }) => !(nearest?.roles.has(role) ?? false));
    throw missingHeaders(lacks.map(({ column }) => column));
  }

  const assumed = assumedColumns(header, data);
  const at = (role: FleetFuelSheetRole): number | undefined =>
    header.roles.get(role) ??
    (role === 'plate' || role === 'chassis' ? assumed.get(role) : undefined);
  const cellAt = (cells: readonly Cell[], role: FleetFuelSheetRole): Cell => {
    const i = at(role);
    return i === undefined ? EMPTY : (cells[i] ?? EMPTY);
  };

  const rows: FuelSheetRow[] = [];
  const invalid: FuelSheetInvalidRow[] = [];
  const skipped: FleetFuelSheetSkippedRowDto[] = [];
  let nameRebuilt = false;
  let example: FuelSheetRead['example'] = null;
  for (const { row, cells } of data) {
    const numberCell = cellAt(cells, 'number');
    const number = textOf(numberCell);
    const name = textOf(cellAt(cells, 'name'));
    const balance = balanceOf(cellAt(cells, 'balance'));
    if (number === '' && name === '') {
      // Not a card: a title, a note, the totals at the foot of a statement.
      const text = textOf(cells.find((cell) => cell.kind === 'text' && !isBlank(cell)) ?? EMPTY);
      if (text !== '' || balance !== null) skipped.push({ row, text, figure: balance });
      continue;
    }
    const plate = orNull(textOf(cellAt(cells, 'plate')));
    const chassis = orNull(textOf(cellAt(cells, 'chassis')));
    const { builtName, rebuilt } = buildCardName(name, plate, chassis);
    nameRebuilt ||= rebuilt;
    example ??= { row, builtName };
    const read = {
      row,
      number,
      name,
      builtName,
      plate,
      chassis,
      code: orNull(textOf(cellAt(cells, 'code'))),
      numberKind: sheetNumberKindOf(numberCell),
    };
    if (balance === null || balance < 0) invalid.push({ ...read, balance, reason: 'badBalance' });
    else rows.push({ ...read, balance });
  }

  const layout: FleetFuelSheetLayoutColumnDto[] = [];
  for (let i = 0; i < header.width; i += 1) {
    const role =
      header.neverRead.get(i) ??
      FLEET_FUEL_SHEET_ROLES.find((r) => header.roles.get(r) === i) ??
      [...assumed].find(([, column]) => column === i)?.[0];
    if (role === undefined) continue;
    const isAssumed = [...assumed.values()].includes(i);
    layout.push({
      role,
      column: columnLetter(i),
      header: isAssumed ? null : orNull(header.texts[i] ?? ''),
      assumed: isAssumed,
    });
  }

  return {
    rows,
    invalid,
    rowsRead: rows.length + invalid.length + skipped.length,
    layout,
    skipped,
    totalCheck: totalCheckOf(skipped, rows),
    nameRebuilt,
    example,
    carColumn: header.roles.has('code'),
  };
};
