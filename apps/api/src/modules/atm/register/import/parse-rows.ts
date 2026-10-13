// Cells → register rows, and the notes only the whole file can tell (spec §6.4, first half).
//
// A `ParsedRow` holds every converted value of its Excel row — the key columns and the plaintext
// combination included — in MEMORY ONLY. It is never serialized into a DTO, an error or a run
// record, and never handed to the logger (§5.4: `plaintextCombination` is on the redaction list as
// a backstop, not as permission). What leaves the import is built field by field from P values,
// row numbers, column letters and issue codes.
//
// File-level issues compare rows with each other — by code, serial, HDB spelling or an in-memory
// hash of all 49 values — and their details are ROW NUMBERS (or, for `hdbSpelling`, the other
// P-class spelling of the code), never a value of a K or S column.
import { createHash } from 'node:crypto';
import {
  ATM_REGISTER_COLUMNS,
  atmRegisterIdFormatOk,
  deriveAtmRegisterStatus,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterCassettesDto,
  type AtmRegisterField,
  type AtmRegisterImportIssueCode,
  type AtmRegisterKeysDto,
  type AtmRegisterStatus,
} from '@ecms/contracts';
import { isPlaceholderMachineCode } from '../register-coupling';
import { REGISTER_CASSETTE_FIELDS, REGISTER_KEY_FIELDS } from '../register.mapper';
import { type AtmRegisterLegacyMarks } from '../register.model';
import {
  convertBank,
  convertBranch,
  convertCode,
  convertCombination,
  convertDate,
  convertName,
  convertText,
  convertTime,
  EMPTY_CELL,
  type CellColumn,
  type ImportIssue,
} from './cell-convert';
import { columnLetter } from './register-columns';
import { type RegisterWorkbookRead } from './read-register-workbook';

/** Every register field one Excel row fills — AO excepted, which is `plaintextCombination`. */
export interface RegisterRowValues {
  branchCode: AtmRegisterBranchCode | null;
  area: string | null;
  bankCode: AtmBankCode | null;
  machineCode: string | null;
  name: string | null;
  operationType: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  keys: AtmRegisterKeysDto;
  cassettes: AtmRegisterCassettesDto;
  openTime: string | null;
  closeTime: string | null;
  accessHoursNotes: string | null;
  receiptNotes: string | null;
  locationPlusCode: string | null;
  /** `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  receivedByName: string | null;
  handoverName: string | null;
  handoverNotes: string | null;
  locationUrl: string | null;
  hub: string | null;
}

export interface ParsedRow {
  /** The Excel row number — the entry's `importRow` (D8 idempotency). */
  importRow: number;
  values: RegisterRowValues;
  status: AtmRegisterStatus;
  issues: ImportIssue[];
  legacyMarks: AtmRegisterLegacyMarks | null;
  /** AO as Excel shows it. In memory only; it goes to the sealer and nowhere else. */
  plaintextCombination: string | null;
  /** DEC-11: one of a duplicate-open pair. */
  openPeriodExempt: boolean;
  /** Column A holds anything at all — the Excel helper CI's `A>0` (§6.5). */
  branchCellPresent: boolean;
  /** A non-empty AQ/AR that is not a date (DEC-31 → blocker `dateUnreadable`). */
  dateUnreadable: boolean;
  /** Any J..Q, AN, AO or AU value (DEC-7 per branch → blocker `secretsOutOfReach`). */
  carriesSecrets: boolean;
}

export interface ParsedRegisterFile {
  rows: ParsedRow[];
  headerFills: { column: string; fill: string }[];
  sentinelRow: number | null;
  lastDataRow: number;
}

const emptyKeys = (): AtmRegisterKeysDto =>
  Object.fromEntries(
    REGISTER_KEY_FIELDS.map((field) => [field, null]),
  ) as unknown as AtmRegisterKeysDto;

const emptyCassettes = (): AtmRegisterCassettesDto =>
  Object.fromEntries(
    REGISTER_CASSETTE_FIELDS.map((field) => [field, null]),
  ) as unknown as AtmRegisterCassettesDto;

const emptyValues = (): RegisterRowValues => ({
  branchCode: null,
  area: null,
  bankCode: null,
  machineCode: null,
  name: null,
  operationType: null,
  vendor: null,
  model: null,
  serial: null,
  keys: emptyKeys(),
  cassettes: emptyCassettes(),
  openTime: null,
  closeTime: null,
  accessHoursNotes: null,
  receiptNotes: null,
  locationPlusCode: null,
  startDate: null,
  endDate: null,
  receivedByName: null,
  handoverName: null,
  handoverNotes: null,
  locationUrl: null,
  hub: null,
});

/** A field's converted value, by its catalogue path (AO reads the plaintext). */
export const fieldValue = (row: ParsedRow, field: AtmRegisterField): string | null => {
  if (field === 'safeCombination') return row.plaintextCombination;
  if (field.startsWith('keys.')) {
    return row.values.keys[field.slice(5) as keyof AtmRegisterKeysDto];
  }
  if (field.startsWith('cassettes.')) {
    return row.values.cassettes[field.slice(10) as keyof AtmRegisterCassettesDto];
  }
  return row.values[field as Exclude<keyof RegisterRowValues, 'keys' | 'cassettes'>];
};

const setField = (values: RegisterRowValues, field: AtmRegisterField, value: unknown): void => {
  if (field.startsWith('keys.')) {
    values.keys[field.slice(5) as keyof AtmRegisterKeysDto] = value as string | null;
    return;
  }
  if (field.startsWith('cassettes.')) {
    values.cassettes[field.slice(10) as keyof AtmRegisterCassettesDto] = value as string | null;
    return;
  }
  (values as unknown as Record<string, unknown>)[field] = value;
};

const fileIssue = (
  code: AtmRegisterImportIssueCode,
  column: string | null,
  detail: string | null,
): ImportIssue => ({ code, column, detail });

/**
 * At most this many other rows (or spellings) are named in one issue's detail; the rest are
 * counted (review finding SEC-3). Every row of a group names the others, so an uncapped list is
 * quadratic: 8,000 identical rows built 750 MB of detail text from a 191 KB upload.
 */
export const DETAIL_LIST_LIMIT = 20;

/** The first `DETAIL_LIST_LIMIT` of `shown`, then `… (+n)` for the `total` not shown. */
const listDetail = (shown: readonly string[], total: number): string => {
  const head = shown.slice(0, DETAIL_LIST_LIMIT).join(', ');
  return total > DETAIL_LIST_LIMIT ? `${head}, … (+${String(total - DETAIL_LIST_LIMIT)})` : head;
};

/** The row numbers of `group` other than `row` — linear in the limit, not in the group. */
const othersDetail = (group: readonly ParsedRow[], row: ParsedRow): string => {
  const shown: string[] = [];
  for (const other of group) {
    if (other === row) continue;
    shown.push(String(other.importRow));
    if (shown.length > DETAIL_LIST_LIMIT) break;
  }
  return listDetail(shown, group.length - 1);
};

/**
 * The digits a code ends with — scanned back by hand: `/(\d+)$/` retries from every digit of a long
 * run that ends in a letter, and a code's length is whatever the cell held (SEC-3).
 */
export const trailingDigits = (code: string): string | null => {
  let start = code.length;
  while (start > 0) {
    const c = code.charCodeAt(start - 1);
    if (c < 48 || c > 57) break;
    start -= 1;
  }
  return start === code.length ? null : code.slice(start);
};

const realCode = (code: string | null): code is string =>
  code !== null && !isPlaceholderMachineCode(code);

/** Convert one data row; file-level issues are added afterwards. */
const parseRow = (
  read: RegisterWorkbookRead,
  rowNumber: number,
  cells: RegisterWorkbookRead['rows'][number]['cells'],
): ParsedRow & { fingerprintInput: (string | null)[] } => {
  const values = emptyValues();
  const issues: ImportIssue[] = [];
  let plaintextCombination: string | null = null;
  let branchCellPresent = false;
  let dateUnreadable = false;
  const fingerprintInput: (string | null)[] = [];

  for (const { def, index } of read.columns) {
    const cell = cells[index] ?? EMPTY_CELL;
    const column: CellColumn = { excel: def.excel, sensitivity: def.sensitivity };
    let value: string | null;
    switch (def.field) {
      case 'branchCode': {
        const out = convertBranch(cell.value, column);
        branchCellPresent = out.present;
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'area': {
        const out = convertText(cell.value, column, 'areaError');
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'bankCode': {
        const out = convertBank(cell.value, column);
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'machineCode': {
        const out = convertCode(cell.value, column);
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'name': {
        const out = convertName(cell.value, column);
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'startDate':
      case 'endDate': {
        const out = convertDate(cell.value, column, read.date1904);
        if (out.invalid) dateUnreadable = true;
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'openTime':
      case 'closeTime':
      case 'accessHoursNotes': {
        const out = convertTime(cell.value, column, read.date1904);
        issues.push(...out.issues);
        value = out.value;
        break;
      }
      case 'safeCombination': {
        const out = convertCombination(cell.value, column, cell.numFmt);
        issues.push(...out.issues);
        plaintextCombination = out.value;
        fingerprintInput.push(out.value);
        continue;
      }
      default: {
        const out = convertText(cell.value, column);
        issues.push(...out.issues);
        value = out.value;
      }
    }
    setField(values, def.field, value);
    fingerprintInput.push(value);
  }

  const cellFills: { column: string; fill: string }[] = [];
  cells.forEach((cell, i) => {
    if (cell.fill !== null) cellFills.push({ column: columnLetter(i + 1), fill: cell.fill });
  });
  const fillAt = (letter: string): string | null => {
    const index = read.columns.find((c) => c.def.excel === letter)?.index;
    return index === undefined ? null : (cells[index]?.fill ?? null);
  };
  const legacyMarks: AtmRegisterLegacyMarks | null =
    cellFills.length === 0
      ? null
      : {
          areaRedFill: fillAt('B')?.toUpperCase() === 'FFFF0000',
          rowFill: fillAt('A'),
          cellFills,
        };

  const carriesSecrets =
    plaintextCombination !== null ||
    values.receiptNotes !== null ||
    values.handoverNotes !== null ||
    Object.values(values.keys).some((v) => v !== null);

  return {
    importRow: rowNumber,
    values,
    status: deriveAtmRegisterStatus(values.startDate, values.endDate),
    issues,
    legacyMarks,
    plaintextCombination,
    openPeriodExempt: false,
    branchCellPresent,
    dateUnreadable,
    carriesSecrets,
    fingerprintInput,
  };
};

const groupBy = <K, T>(items: readonly T[], key: (item: T) => K | null): Map<K, T[]> => {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
};

/**
 * The whole sheet → parsed rows with their per-cell AND file-level issues (§6.4). `today` is the
 * Cairo calendar day of the upload — "future" means after it.
 */
export const parseRegisterRows = (
  read: RegisterWorkbookRead,
  options: { today: string },
): ParsedRegisterFile => {
  const parsed = read.rows.map((row) => parseRow(read, row.rowNumber, row.cells));
  const rows: ParsedRow[] = parsed;
  const add = (row: ParsedRow, entry: ImportIssue): void => {
    row.issues.push(entry);
  };

  // duplicateOpen (DEC-11): ≥ 2 OPEN rows with one real code, anywhere in the company.
  const openByCode = groupBy(
    rows.filter((r) => r.status === 'open'),
    (r) => (realCode(r.values.machineCode) ? r.values.machineCode : null),
  );
  for (const group of openByCode.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.openPeriodExempt = true;
      add(row, fileIssue('duplicateOpen', 'D', othersDetail(group, row)));
    }
  }
  // An OPEN row whose code is a placeholder (`#`, `********`) names no machine: it is never coupled
  // and no receipt can open one (§5.6), but two of them would still collide on
  // `ux_open_period_per_code` and abort their apply batch with a bare E11000 (review finding
  // DATA-2). The index is about one machine per code, so they are exempt from it.
  for (const row of rows) {
    const code = row.values.machineCode;
    if (row.status === 'open' && code !== null && isPlaceholderMachineCode(code)) {
      row.openPeriodExempt = true;
    }
  }

  // openNotNewest: an open row with a later period of the same code elsewhere in the file. Walked
  // from the latest start down, carrying the lowest row numbers seen so far, so a large group
  // costs n log n, not n² (SEC-3).
  const byCode = groupBy(rows, (r) =>
    realCode(r.values.machineCode) ? r.values.machineCode : null,
  );
  for (const group of byCode.values()) {
    if (group.length < 2) continue;
    const dated = group
      .filter((r) => r.values.startDate !== null)
      .sort((a, b) => {
        const [x, y] = [a.values.startDate ?? '', b.values.startDate ?? ''];
        return x < y ? 1 : x > y ? -1 : a.importRow - b.importRow;
      });
    const newer: number[] = []; // ascending row numbers, at most DETAIL_LIST_LIMIT + 1
    let newerCount = 0;
    for (let i = 0; i < dated.length;) {
      const start = dated[i]?.values.startDate;
      let end = i;
      while (end < dated.length && dated[end]?.values.startDate === start) end += 1;
      const level = dated.slice(i, end);
      if (newerCount > 0) {
        for (const row of level) {
          if (row.status !== 'open') continue;
          add(row, fileIssue('openNotNewest', 'AQ', listDetail(newer.map(String), newerCount)));
        }
      }
      for (const row of level) {
        newerCount += 1;
        const at = newer.findIndex((n) => n > row.importRow);
        newer.splice(at === -1 ? newer.length : at, 0, row.importRow);
        if (newer.length > DETAIL_LIST_LIMIT + 1) newer.pop();
      }
      i = end;
    }
  }

  // hdbSpelling (EG-7): one HDB machine number written more than one way.
  const hdbRows = rows.filter((r) => r.values.bankCode === 'HDB' && realCode(r.values.machineCode));
  const byDigits = groupBy(hdbRows, (r) => {
    const digits = trailingDigits(r.values.machineCode ?? '');
    return digits === null ? null : digits.replace(/^0+(?=\d)/, '');
  });
  for (const group of byDigits.values()) {
    const spellings = [...new Set(group.map((r) => r.values.machineCode ?? ''))];
    if (spellings.length < 2) continue;
    const head = spellings.slice(0, DETAIL_LIST_LIMIT + 1);
    for (const row of group) {
      const others = head.filter((s) => s !== row.values.machineCode);
      add(row, fileIssue('hdbSpelling', 'D', listDetail(others, spellings.length - 1)));
    }
  }

  // exactDuplicate: all 49 converted values identical. The hash lives and dies here; the detail
  // is the other row numbers.
  const fingerprints = new Map<ParsedRow, string>(
    parsed.map((row) => [
      row,
      createHash('sha256').update(JSON.stringify(row.fingerprintInput)).digest('hex'),
    ]),
  );
  for (const group of groupBy(rows, (r) => fingerprints.get(r) ?? null).values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      add(row, fileIssue('exactDuplicate', null, othersDetail(group, row)));
    }
  }

  // serialDuplicate: open rows sharing a serial (trim, case-insensitive) under different codes.
  // The first rows under another code are found once per CODE of the group, each search stopping
  // after the limit — linear in the group, not quadratic (SEC-3).
  const openBySerial = groupBy(
    rows.filter((r) => r.status === 'open'),
    (r) => (r.values.serial === null ? null : r.values.serial.trim().toLowerCase()),
  );
  for (const group of openBySerial.values()) {
    if (group.length < 2) continue;
    const perCode = new Map<string | null, number>();
    for (const row of group) {
      perCode.set(row.values.machineCode, (perCode.get(row.values.machineCode) ?? 0) + 1);
    }
    if (perCode.size < 2) continue;
    const detailByCode = new Map<string | null, string>();
    for (const [code, count] of perCode) {
      const shown: string[] = [];
      for (const other of group) {
        if (other.values.machineCode === code) continue;
        shown.push(String(other.importRow));
        if (shown.length > DETAIL_LIST_LIMIT) break;
      }
      detailByCode.set(code, listDetail(shown, group.length - count));
    }
    for (const row of group) {
      const detail = detailByCode.get(row.values.machineCode);
      if (detail !== undefined) add(row, fileIssue('serialDuplicate', 'I', detail));
    }
  }

  for (const row of rows) {
    const { bankCode, machineCode, startDate, endDate, area } = row.values;
    if (
      bankCode !== null &&
      machineCode !== null &&
      !atmRegisterIdFormatOk(bankCode, machineCode)
    ) {
      add(row, fileIssue('idFormat', 'D', machineCode));
    }
    if (startDate !== null && endDate !== null && endDate < startDate) {
      add(row, fileIssue('endBeforeStart', 'AR', null));
    }
    if (startDate !== null && startDate > options.today) {
      add(row, fileIssue('futureStart', 'AQ', startDate));
    }
    if (endDate !== null && endDate > options.today) {
      add(row, fileIssue('futureEnd', 'AR', endDate));
    }
    if (row.status === 'open' && area === null) add(row, fileIssue('openNoArea', 'B', null));
    if (row.status === 'open' && bankCode === null) add(row, fileIssue('noBank', 'C', null));
  }

  for (const row of parsed) {
    // The hash input held every value of the row; it does not outlive the parse.
    delete (row as Partial<typeof row>).fingerprintInput;
  }
  return {
    rows,
    headerFills: read.headerFills,
    sentinelRow: read.sentinelRow,
    lastDataRow: read.lastDataRow,
  };
};

/**
 * The columns a stored entry is compared on for `changedSinceImport` (DEC-31): A..AN and AP..AW —
 * AO is not compared (that would mean opening every sealed value). Excel letter → the row's value.
 */
export const comparableColumns = (row: ParsedRow): Map<string, string | null> =>
  new Map(
    ATM_REGISTER_COLUMNS.filter((c) => c.field !== 'safeCombination').map((c) => [
      c.excel,
      fieldValue(row, c.field),
    ]),
  );
