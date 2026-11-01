// One workbook cell → one register value, and the import notes it earns (spec §6.3).
//
// Every rule here is "what the Excel SHOWS, kept as the owner typed it" — nothing is cleaned up,
// guessed or merged (D6: imported rows keep their blanks). Where a cell cannot be read the way the
// sheet's own formulas read it, the cell becomes an issue, and for the two date columns a
// file-level blocker (DEC-31): the Excel's helper CI reads a text AQ as "set" and a text AR as
// "not empty", so writing null would silently change a row's status.
//
// THE DETAIL RULE. An issue's `detail` may carry the cell's text only for a P-class column. For
// K columns (J..Q, AN, AU) and the combination (AO) it is ALWAYS null — the value never leaves the
// converter except as the field it fills (`issue()` below is the one place that decides it).
import {
  ATM_REGISTER_BANK_ALIASES,
  ATM_REGISTER_BRANCH_CODES,
  ATM_SEED_BANK_CODES,
  normalizeAtmMachineCode,
  type AtmRegisterBranchCode,
  type AtmRegisterImportIssueCode,
  type AtmRegisterSensitivity,
  type AtmSeedBankCode,
} from '@ecms/contracts';
import { isPlaceholderMachineCode } from '../register-coupling';

/** A cell's value after unwrapping formulas, rich text and hyperlinks — the value a person sees. */
export type RawCellValue =
  | { kind: 'empty' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: Date }
  | { kind: 'error'; value: string | null };

/** One A..AW cell as the reader hands it over: value, number format, solid fill (EG-2). */
export interface RawCell {
  value: RawCellValue;
  numFmt: string | null;
  fill: string | null;
}

export const EMPTY_CELL: RawCell = { value: { kind: 'empty' }, numFmt: null, fill: null };

export interface ImportIssue {
  code: AtmRegisterImportIssueCode;
  column: string | null;
  detail: string | null;
}

/** The column a converter writes for: its letter and its secrecy class. */
export interface CellColumn {
  excel: string;
  sensitivity: AtmRegisterSensitivity;
}

export interface Converted<T> {
  value: T;
  issues: ImportIssue[];
}

/** THE detail rule: only a P column's issue may say what the cell held. */
export const issue = (
  code: AtmRegisterImportIssueCode,
  column: CellColumn,
  detail: string | null = null,
): ImportIssue => ({
  code,
  column: column.excel,
  detail: column.sensitivity === 'P' ? detail : null,
});

const DAY_MS = 86_400_000;
/** Day 0 of the 1900 date system as Excel counts it (the 1900 leap-year bug folded in). */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const epochOf = (date1904: boolean): number => (date1904 ? EPOCH_1904 : EPOCH_1900);

/**
 * ExcelJS's own test for a date/time number format (`utils.isDateFmt`): ignore `[…]` and quoted
 * literals, then look for a date or time token.
 */
export const isDateFormat = (format: string | null): boolean => {
  if (format === null || format === '') return false;
  const bare = format.replace(/\[[^\]]*]/g, '').replace(/"[^"]*"/g, '');
  return /[ymdhMsb]+/.test(bare);
};

/** Excel serial → the instant ExcelJS itself produces for a date-formatted number. */
const serialToDate = (serial: number, date1904: boolean): Date =>
  new Date(epochOf(date1904) + Math.round(serial * DAY_MS));

/**
 * ExcelJS's rich cell objects → what the sheet shows (the `read-workbook.ts` unwrapping, plus the
 * error marker and the date rule for a formula whose cached result is a date-formatted number —
 * the streaming reader converts plain date cells, not formula results).
 */
export const unwrapCellValue = (
  value: unknown,
  numFmt: string | null,
  date1904: boolean,
): RawCellValue => {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (typeof value === 'string')
    return value === '' ? { kind: 'empty' } : { kind: 'string', value };
  if (typeof value === 'number') {
    return Number.isNaN(value) ? { kind: 'error', value: null } : { kind: 'number', value };
  }
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { kind: 'error', value: null } : { kind: 'date', value };
  }
  if (typeof value === 'object') {
    const o = value as {
      richText?: { text?: unknown }[];
      error?: unknown;
      formula?: unknown;
      sharedFormula?: unknown;
      result?: unknown;
      text?: unknown;
    };
    if (Array.isArray(o.richText)) {
      return unwrapCellValue(
        o.richText.map((part) => String(part.text ?? '')).join(''),
        numFmt,
        date1904,
      );
    }
    if (o.error !== undefined) return { kind: 'error', value: String(o.error) };
    if (o.formula !== undefined || o.sharedFormula !== undefined) {
      const result = o.result;
      // A formula whose cached value is an Excel error comes back from the streaming reader as
      // `parseFloat('#N/A')`, i.e. NaN — still an error, its text unknown.
      if (typeof result === 'number' && !Number.isNaN(result) && isDateFormat(numFmt)) {
        return { kind: 'date', value: serialToDate(result, date1904) };
      }
      return unwrapCellValue(result, numFmt, date1904);
    }
    if (o.text !== undefined) return unwrapCellValue(o.text, numFmt, date1904);
  }
  return { kind: 'empty' };
};

/** A number as Excel's General format shows it — integers never in exponent form. */
export const numberText = (n: number): string =>
  Number.isInteger(n) && Math.abs(n) >= 1e21 ? BigInt(n).toString() : String(n);

/** `YYYY-MM-DD` of a Date's UTC calendar day — ExcelJS builds date cells at UTC. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const plainText = (cell: RawCellValue): string | null => {
  switch (cell.kind) {
    case 'string': {
      const trimmed = cell.value.trim();
      return trimmed === '' ? null : trimmed;
    }
    case 'number':
      return numberText(cell.value);
    case 'boolean':
      return cell.value ? 'TRUE' : 'FALSE';
    case 'date':
      return isoDay(cell.value);
    default:
      return null;
  }
};

/**
 * The text rule: blanks and whitespace → null, strings trimmed (JS `trim` covers NBSP and TAB),
 * numbers as shown, a Date typed into a text column kept as its day + `dateInText`, an Excel
 * error → null + `errorValue` (B's error is `areaError`).
 */
export const convertText = (
  cell: RawCellValue,
  column: CellColumn,
  errorCode: AtmRegisterImportIssueCode = 'errorValue',
): Converted<string | null> => {
  if (cell.kind === 'error') return { value: null, issues: [issue(errorCode, column, cell.value)] };
  const value = plainText(cell);
  if (cell.kind === 'date' && value !== null) {
    return { value, issues: [issue('dateInText', column, value)] };
  }
  return { value, issues: [] };
};

/** E — the machine's name. A blank stays null (DEC-32) with `noName`. */
export const convertName = (cell: RawCellValue, column: CellColumn): Converted<string | null> => {
  const text = convertText(cell, column);
  return text.value === null
    ? { value: null, issues: [...text.issues, issue('noName', column)] }
    : text;
};

/**
 * A — `EGYCASH-1..7`. `present` is what the Excel's helper CI tests (`A>0`, true for any text):
 * the 57-number check counts a row with an unknown code in Section 1, as the sheet does.
 */
export const convertBranch = (
  cell: RawCellValue,
  column: CellColumn,
): Converted<AtmRegisterBranchCode | null> & { present: boolean } => {
  if (cell.kind === 'error') {
    return {
      value: null,
      present: false,
      issues: [issue('errorValue', column, cell.value), issue('noBranch', column)],
    };
  }
  const present = cell.kind !== 'empty';
  const text = plainText(cell);
  if (text === null) return { value: null, present, issues: [issue('noBranch', column)] };
  const code = ATM_REGISTER_BRANCH_CODES.find((candidate) => candidate === text);
  return code === undefined
    ? { value: null, present, issues: [issue('unknownBranchCode', column, text)] }
    : { value: code, present, issues: [] };
};

/**
 * C — the workbook's six banks; the one spelling alias (`نيكست` → NXT) is noted, any other text
 * refused. The SEEDS, not the catalog (DEC-35): this workbook was written before any bank was added
 * at runtime, and its 57-cell Data Report knows exactly these six.
 */
export const convertBank = (
  cell: RawCellValue,
  column: CellColumn,
): Converted<AtmSeedBankCode | null> => {
  if (cell.kind === 'error') {
    return { value: null, issues: [issue('errorValue', column, cell.value)] };
  }
  const text = plainText(cell);
  if (text === null) return { value: null, issues: [] };
  const code = ATM_SEED_BANK_CODES.find((candidate) => candidate === text);
  if (code !== undefined) return { value: code, issues: [] };
  const alias = ATM_REGISTER_BANK_ALIASES[text];
  if (alias !== undefined) return { value: alias, issues: [issue('bankAlias', column, text)] };
  return { value: null, issues: [issue('unknownBank', column, text)] };
};

/**
 * D — the ATM ID. A number is its integer text; text is normalized exactly as every other code
 * path normalizes it (`normalizeAtmMachineCode`: trim + leading zeros); `#`/`********` are kept
 * as typed and marked, never coupled.
 */
export const convertCode = (cell: RawCellValue, column: CellColumn): Converted<string | null> => {
  if (cell.kind === 'empty') return { value: null, issues: [issue('noCode', column)] };
  if (cell.kind === 'error') {
    return {
      value: null,
      issues: [issue('errorValue', column, cell.value), issue('noCode', column)],
    };
  }
  const issues: ImportIssue[] = [];
  let raw: string;
  if (cell.kind === 'string') raw = cell.value;
  else if (cell.kind === 'number') raw = numberText(cell.value);
  else {
    const text = convertText(cell, column);
    issues.push(...text.issues);
    raw = text.value ?? '';
  }
  if (raw.includes('\u00A0') || raw !== raw.trim()) issues.push(issue('codeWhitespace', column));
  const code = normalizeAtmMachineCode(raw);
  if (code === '') return { value: null, issues: [...issues, issue('noCode', column)] };
  if (isPlaceholderMachineCode(code)) issues.push(issue('placeholderCode', column, code));
  return { value: code, issues };
};

/** The window a bare number in AQ/AR is read as an Excel serial in: 2000-01-01 … 2049-12-31. */
const SERIAL_MIN = 36_526;
const SERIAL_MAX = 54_789;

/**
 * AQ / AR. A Date is its day; an integer serial in range converts (the three BM rows typed as
 * `46034` are counted by the Data Report and MUST convert) with `dateSerial`; empty is null; any
 * other non-empty cell is null + `dateInvalid` — and `invalid: true`, which the plan turns into
 * the `dateUnreadable` blocker (DEC-31).
 */
export const convertDate = (
  cell: RawCellValue,
  column: CellColumn,
  date1904: boolean,
): Converted<string | null> & { invalid: boolean } => {
  if (cell.kind === 'empty') return { value: null, issues: [], invalid: false };
  if (cell.kind === 'date') return { value: isoDay(cell.value), issues: [], invalid: false };
  if (
    cell.kind === 'number' &&
    Number.isInteger(cell.value) &&
    cell.value >= SERIAL_MIN &&
    cell.value <= SERIAL_MAX
  ) {
    const day = isoDay(serialToDate(cell.value, date1904));
    return { value: day, issues: [issue('dateSerial', column, day)], invalid: false };
  }
  const shown =
    cell.kind === 'string'
      ? cell.value.trim().slice(0, 64)
      : cell.kind === 'error'
        ? cell.value
        : plainText(cell);
  return { value: null, issues: [issue('dateInvalid', column, shown)], invalid: true };
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * AK / AL / AM. Only a Date converts — ExcelJS makes one only for a time-formatted number — and
 * it is stored as Excel SHOWS it: the time of day, `HH:mm`, minutes rounded. A value of a day or
 * more (1.0, typed as `24:00`, shows `0:00`; 3.75 shows `18:00`) keeps its day count in the
 * `timeOverDay` detail — nothing lost, nothing interpreted (EG-20). Numbers in General format,
 * and text, follow the text rule.
 */
export const convertTime = (
  cell: RawCellValue,
  column: CellColumn,
  date1904: boolean,
): Converted<string | null> => {
  if (cell.kind !== 'date') return convertText(cell, column);
  const days = (cell.value.getTime() - epochOf(date1904)) / DAY_MS;
  const minutes = Math.round((days - Math.floor(days)) * 1440) % 1440;
  const shown = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  return days >= 1
    ? { value: shown, issues: [issue('timeOverDay', column, String(Number(days.toFixed(6))))] }
    : { value: shown, issues: [] };
};

/** `00 - 00 - 00` and its kin: zero groups joined by dashes, once quotes and escapes are gone. */
const COMBINATION_FORMAT = /^0+(\s*-\s*0+)+$/;
const COMBINATION_SHAPE = /^\d{2} ?- ?\d{2} ?- ?\d{2}$/;

/**
 * AO — the safe-door combination. A number in a zero-group format is laid into that format,
 * zero-padded, exactly as Excel displays it (`25` under `00 - 00 - 00` → `00 - 00 - 25`); any
 * other shape is kept as typed with `aoShape`. The value goes ONLY to the sealer; `aoShape` never
 * carries a detail (the column is S-class, so `issue()` forces null anyway).
 */
export const convertCombination = (
  cell: RawCellValue,
  column: CellColumn,
  numFmt: string | null,
): Converted<string | null> => {
  if (cell.kind === 'empty') return { value: null, issues: [] };
  if (cell.kind === 'error') return { value: null, issues: [issue('errorValue', column)] };
  if (cell.kind === 'number') {
    const format = (numFmt ?? '').replace(/["\\]/g, '');
    const zeros = (format.match(/0/g) ?? []).length;
    if (
      Number.isInteger(cell.value) &&
      cell.value >= 0 &&
      cell.value <= 999_999 &&
      COMBINATION_FORMAT.test(format) &&
      String(cell.value).length <= zeros
    ) {
      const digits = String(cell.value).padStart(zeros, '0');
      let next = 0;
      const value = format.replace(/0/g, () => digits.charAt(next++));
      return { value, issues: [] };
    }
    return { value: numberText(cell.value), issues: [issue('aoShape', column)] };
  }
  const value = plainText(cell);
  if (value === null) return { value: null, issues: [] };
  return COMBINATION_SHAPE.test(value)
    ? { value, issues: [] }
    : { value, issues: [issue('aoShape', column)] };
};
