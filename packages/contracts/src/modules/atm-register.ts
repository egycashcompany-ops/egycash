// ATM Efficiency & Investigations — the machine register and the Data Report (module `atm`).
//
// The register is the owner's workbook `Comprehensive ATMs report` made a collection: sheet `ATMs`
// becomes `atm_register_entries`, ONE document per Excel row = one custody period (receipt from
// the bank → handover to the bank), and sheet `Data Report` becomes a computed page. Every name,
// order, label and colour below is the workbook's own; the spec that maps one onto the other is
// docs/12-planning/atm-efficiency-register.md (owner decisions D1–D8, designer decisions DEC-n,
// unknowns EG-n). This file is its §3, verbatim in shape.
//
// Three classes of column, and the class is the whole security model (D3):
//   P — public to `atmRegister.view`;
//   K — key codes and the two notes columns, returned only where `atmRegister.viewSecrets` reaches;
//   S — the safe-door combination, sealed at rest and readable only through the audited reveal.
// A K or S input field carries no regex, enum or custom refinement: Zod's `max` and type messages
// never contain the input, an enum or a regex message could.
import { z } from 'zod';
import {
  PaginationQuerySchema,
  booleanQuery,
  listQuery,
  objectId,
  type LocalizedString,
} from '../common/index.js';
import { normalizeAtmMachineCode } from './atm.js';

// ── Banks (D5) ──────────────────────────────────────────────────────────────────────────────────

/** The company-wide bank vocabulary of the register. Fixed: a bank is not a free-text label here. */
export const ATM_BANK_CODES = ['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT'] as const;
export const AtmBankCodeSchema = z.enum(ATM_BANK_CODES);
export type AtmBankCode = z.infer<typeof AtmBankCodeSchema>;

/** The Data Report's own Arabic names (Data Report AE2..AI2, AD2 with D7's double-space fix). */
export const ATM_BANK_NAMES: Readonly<Record<AtmBankCode, LocalizedString>> = {
  NBE: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' },
  BM: { ar: 'بنك مصر', en: 'Banque Misr' },
  CIB: { ar: 'البنك التجارى الدولى', en: 'Commercial International Bank' },
  HDB: { ar: 'بنك التعمير والاسكان', en: 'Housing and Development Bank' },
  BRK: { ar: 'بنك البركة', en: 'Al Baraka Bank' },
  NXT: { ar: 'NXT BANK', en: 'NXT BANK' },
};

/** The Excel chart-3 series colours (D7) — identity, used in both themes. */
export const ATM_BANK_REPORT_COLORS: Readonly<Record<AtmBankCode, string>> = {
  NBE: '#385723',
  BM: '#AC2100',
  CIB: '#FFD966',
  HDB: '#B4C7E7',
  BRK: '#F4B183',
  NXT: '#000099',
};

/** Charts 1–2: the workbook theme's accent1 (xl/theme/theme1.xml), the Excel's single series (DEC-19). */
export const ATM_REPORT_TOTALS_COLOR = '#4472C4';

/** D5 default bankCode → Operations label (legacy labels: reports_atm.ejs:350 MISR, :403 NBE FOREX). */
export const ATM_DEFAULT_OPS_BANK_LABELS: Readonly<Record<AtmBankCode, string>> = {
  NBE: 'NBE',
  BM: 'MISR',
  CIB: 'CIB',
  HDB: 'HDB',
  BRK: 'BRK',
  NXT: 'NXT',
};

/** Import-only spellings (exact match after trim). Row 2120 is the only one. */
export const ATM_REGISTER_BANK_ALIASES: Readonly<Record<string, AtmBankCode>> = { نيكست: 'NXT' };

/** The Operations bank label an NBE machine in an ` FX` area may carry (D5, DEC-16). */
export const ATM_NBE_FOREX_LABEL = 'NBE FOREX';

/**
 * D6: per-bank ID shapes — a WARNING, never a block. HDB is written three ways in the workbook
 * (`HDB - n`, `HDB-ATM n`, `HDB-ATMn`) and all three are accepted; which one is canonical is EG-7.
 */
export const ATM_REGISTER_ID_FORMATS: Readonly<Record<AtmBankCode, RegExp>> = {
  NBE: /^\d{8}$/,
  BM: /^\d{7}$/,
  CIB: /^\d{1,4}$/,
  HDB: /^HDB(?: - |-ATM ?)\d+$/,
  BRK: /^BRK[NW]\d+$/,
  NXT: /^ATM\d{4}$/,
};

export const atmRegisterIdFormatOk = (bank: AtmBankCode, code: string): boolean =>
  ATM_REGISTER_ID_FORMATS[bank].test(code);

// ── Branch codes (D4) ───────────────────────────────────────────────────────────────────────────

/** The workbook's column A. Which ECMS branch each one is, is the admin's setting (EG-18). */
export const ATM_REGISTER_BRANCH_CODES = [
  'EGYCASH-1',
  'EGYCASH-2',
  'EGYCASH-3',
  'EGYCASH-4',
  'EGYCASH-5',
  'EGYCASH-6',
  'EGYCASH-7',
] as const;
export const AtmRegisterBranchCodeSchema = z.enum(ATM_REGISTER_BRANCH_CODES);
export type AtmRegisterBranchCode = z.infer<typeof AtmRegisterBranchCodeSchema>;

/** The sheet's own branch names (ATMs DE1..DK1 + Data Report row 4), D7 typo fix applied. */
export const ATM_REGISTER_BRANCH_NAMES: Readonly<Record<AtmRegisterBranchCode, LocalizedString>> = {
  'EGYCASH-1': { ar: 'المهندسين', en: 'Mohandessin' },
  'EGYCASH-2': { ar: 'طنطا', en: 'Tanta' },
  'EGYCASH-3': { ar: 'أسيوط', en: 'Asyut' },
  'EGYCASH-4': { ar: 'الإسكندرية', en: 'Alexandria' },
  'EGYCASH-5': { ar: 'أكتوبر', en: 'October' },
  'EGYCASH-6': { ar: 'بور سعيد', en: 'Port Said' },
  'EGYCASH-7': { ar: 'وصال', en: 'Wisal' },
};

// ── Settings value schemas (D4, D5) — keys live in `AtmSettingKeys` (atm.ts) ────────────────────

const uniqueBy =
  <T>(pick: (row: T) => string) =>
  (rows: readonly T[]): boolean =>
    new Set(rows.map(pick)).size === rows.length;

/** `atm.register.branchCodes` — default `[]`: no branch is guessed (EG-18), so nothing is received. */
export const AtmRegisterBranchCodesSettingSchema = z
  .array(z.object({ code: AtmRegisterBranchCodeSchema, branchId: objectId() }).strict())
  .max(7)
  .refine(
    uniqueBy((r) => r.code),
    'each code once',
  )
  .refine(
    uniqueBy((r) => r.branchId),
    'each branch once',
  );
export type AtmRegisterBranchCodesSetting = z.infer<typeof AtmRegisterBranchCodesSettingSchema>;

/** `atm.register.bankLabels` — a stored value that omits a bank falls back to that bank's default. */
export const AtmRegisterBankLabelsSettingSchema = z
  .array(
    z.object({ bankCode: AtmBankCodeSchema, label: z.string().trim().min(1).max(64) }).strict(),
  )
  .max(6)
  .refine(
    uniqueBy((r) => r.bankCode),
    'each bank once',
  );
export type AtmRegisterBankLabelsSetting = z.infer<typeof AtmRegisterBankLabelsSettingSchema>;

export const ATM_DEFAULT_BANK_LABELS_SETTING: AtmRegisterBankLabelsSetting = ATM_BANK_CODES.map(
  (bankCode) => ({ bankCode, label: ATM_DEFAULT_OPS_BANK_LABELS[bankCode] }),
);

// ── Status, dates, active (D1, D7) ──────────────────────────────────────────────────────────────

export const ATM_REGISTER_STATUSES = ['pending', 'open', 'ended'] as const;
export const AtmRegisterStatusSchema = z.enum(ATM_REGISTER_STATUSES);
export type AtmRegisterStatus = z.infer<typeof AtmRegisterStatusSchema>;

/** D1 — the ONLY way a status is produced. Never read from input. An end date alone is `ended`. */
export const deriveAtmRegisterStatus = (
  startDate: string | Date | null,
  endDate: string | Date | null,
): AtmRegisterStatus => (endDate !== null ? 'ended' : startDate !== null ? 'open' : 'pending');

/** D7 — Excel helper CI `=IF(A>0,IF(AQ>0,IF(AR="",1,0)))`: the ONE definition of "active". */
export const isAtmRegisterActive = (e: {
  hasBranch: boolean;
  startDate: string | Date | null;
  endDate: string | Date | null;
}): boolean => e.hasBranch && e.startDate !== null && e.endDate === null;

/** Calendar date `YYYY-MM-DD`; stored as UTC midnight (the HR business-date convention). */
export const AtmRegisterDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a calendar date');

// ── Data Report — orders, cells and the ONE fold (D7) ───────────────────────────────────────────

/** Section 1 categories, left to right as the sheet lays them out (AD2..AI2). */
export const ATM_REPORT_SECTION1_BANKS: readonly AtmBankCode[] = [
  'NXT',
  'NBE',
  'BM',
  'CIB',
  'HDB',
  'BRK',
];
/** Section 2 categories (AD4..AJ4) — وصال first, as in the sheet. */
export const ATM_REPORT_SECTION2_BRANCHES: readonly AtmRegisterBranchCode[] = [
  'EGYCASH-7',
  'EGYCASH-1',
  'EGYCASH-2',
  'EGYCASH-3',
  'EGYCASH-4',
  'EGYCASH-5',
  'EGYCASH-6',
];
/** Section 3 rows (AD8..AD14). */
export const ATM_REPORT_SECTION3_BRANCHES: readonly AtmRegisterBranchCode[] = [
  'EGYCASH-1',
  'EGYCASH-5',
  'EGYCASH-2',
  'EGYCASH-3',
  'EGYCASH-4',
  'EGYCASH-6',
  'EGYCASH-7',
];
/** Section 3 columns (AE7..AJ7). */
export const ATM_REPORT_SECTION3_BANKS: readonly AtmBankCode[] = [
  'NBE',
  'BM',
  'CIB',
  'HDB',
  'BRK',
  'NXT',
];

/** One group of ACTIVE entries. `branchCode:null` = branch set but not mapped. */
export interface AtmRegisterReportGroup {
  branchCode: AtmRegisterBranchCode | null;
  bankCode: AtmBankCode | null;
  count: number;
}

export interface AtmRegisterReportCounts {
  /** AD3..AI3 + AJ3 (total = Σ the six bank cells, as `=SUM(AD3:AI3)`). */
  section1: Record<AtmBankCode, number> & { total: number };
  /** AD5..AJ5 + AK5 (total = Σ the branch cells shown). Only branches in `branchesShown`. */
  section2: Partial<Record<AtmRegisterBranchCode, number>> & { total: number };
  /** rows 8–14 × AE..AJ. No totals (the Excel has none). */
  section3: Partial<Record<AtmRegisterBranchCode, Record<AtmBankCode, number>>>;
  /** ACTIVE with a branch outside the mapping: counted in section 1 only. */
  activeWithUnmappedBranch: number;
  /** ACTIVE with no bank: counted in sections 2/3 rows only, never in a bank cell. */
  activeWithoutBank: number;
}

const zeroBanks = (): Record<AtmBankCode, number> => ({
  NBE: 0,
  BM: 0,
  CIB: 0,
  HDB: 0,
  BRK: 0,
  NXT: 0,
});

/**
 * The single implementation of D7 — used by the report endpoint AND the import's 57-number check,
 * so the page and the cut-over check cannot disagree about what a cell counts.
 *
 * Every cell is a number (0 when nothing), never absent: each shown branch is present in section 2
 * and carries all six banks in section 3. `groups` must already be ACTIVE entries only — the fold
 * counts, it does not judge (`isAtmRegisterActive` is the judge).
 */
export const foldAtmRegisterReport = (
  groups: readonly AtmRegisterReportGroup[],
  branchesShown: readonly AtmRegisterBranchCode[] = ATM_REGISTER_BRANCH_CODES,
): AtmRegisterReportCounts => {
  const shown = new Set<AtmRegisterBranchCode>(branchesShown);
  const section1: Record<AtmBankCode, number> & { total: number } = { ...zeroBanks(), total: 0 };
  const section2: Partial<Record<AtmRegisterBranchCode, number>> & { total: number } = { total: 0 };
  const section3: Partial<Record<AtmRegisterBranchCode, Record<AtmBankCode, number>>> = {};
  for (const code of shown) {
    section2[code] = 0;
    section3[code] = zeroBanks();
  }
  let activeWithUnmappedBranch = 0;
  let activeWithoutBank = 0;

  for (const { branchCode, bankCode, count } of groups) {
    if (bankCode !== null) section1[bankCode] += count;
    if (branchCode === null) activeWithUnmappedBranch += count;
    if (bankCode === null) activeWithoutBank += count;
    if (branchCode === null || !shown.has(branchCode)) continue;
    section2[branchCode] = (section2[branchCode] ?? 0) + count;
    const row = section3[branchCode];
    if (bankCode !== null && row !== undefined) row[bankCode] += count;
  }

  section1.total = ATM_BANK_CODES.reduce((sum, bank) => sum + section1[bank], 0);
  section2.total = [...shown].reduce((sum, code) => sum + (section2[code] ?? 0), 0);
  return { section1, section2, section3, activeWithUnmappedBranch, activeWithoutBank };
};

/** One of the 57 numeric cells of the Data Report sheet, for the import check (§6.5). */
export interface AtmReportCellRef {
  key: string;
  cell: string;
  section: 1 | 2 | 3;
  branchCode: AtmRegisterBranchCode | null;
  bankCode: AtmBankCode | null;
  isTotal: boolean;
}

/** The sheet's report columns, AD onward. */
const REPORT_COLUMNS = ['AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK'] as const;
const reportColumn = (index: number): string => REPORT_COLUMNS[index] ?? '';

/**
 * The 57 numeric cells, built from the orders above: section 1 AD3..AI3 + AJ3 total (keys
 * `s1.NXT` … `s1.total`), section 2 AD5..AJ5 + AK5 total (`s2.EGYCASH-7` … `s2.total`), section 3
 * rows 8..14 × AE..AJ (`s3.EGYCASH-1.NBE` …). 7 + 8 + 42 = 57.
 */
export const ATM_DATA_REPORT_CELLS: readonly AtmReportCellRef[] = [
  ...ATM_REPORT_SECTION1_BANKS.map((bankCode, i): AtmReportCellRef => ({
    key: `s1.${bankCode}`,
    cell: `${reportColumn(i)}3`,
    section: 1,
    branchCode: null,
    bankCode,
    isTotal: false,
  })),
  {
    key: 's1.total',
    cell: `${reportColumn(ATM_REPORT_SECTION1_BANKS.length)}3`,
    section: 1,
    branchCode: null,
    bankCode: null,
    isTotal: true,
  },
  ...ATM_REPORT_SECTION2_BRANCHES.map((branchCode, i): AtmReportCellRef => ({
    key: `s2.${branchCode}`,
    cell: `${reportColumn(i)}5`,
    section: 2,
    branchCode,
    bankCode: null,
    isTotal: false,
  })),
  {
    key: 's2.total',
    cell: `${reportColumn(ATM_REPORT_SECTION2_BRANCHES.length)}5`,
    section: 2,
    branchCode: null,
    bankCode: null,
    isTotal: true,
  },
  ...ATM_REPORT_SECTION3_BRANCHES.flatMap((branchCode, row) =>
    ATM_REPORT_SECTION3_BANKS.map((bankCode, col): AtmReportCellRef => ({
      key: `s3.${branchCode}.${bankCode}`,
      cell: `${reportColumn(col + 1)}${String(row + 8)}`,
      section: 3,
      branchCode,
      bankCode,
      isTotal: false,
    })),
  ),
];

/** The value a fold gives one sheet cell. A branch outside `branchesShown` reads 0. */
export const readAtmReportCell = (
  counts: AtmRegisterReportCounts,
  ref: AtmReportCellRef,
): number => {
  if (ref.section === 1) {
    if (ref.isTotal) return counts.section1.total;
    return ref.bankCode === null ? 0 : counts.section1[ref.bankCode];
  }
  if (ref.section === 2) {
    if (ref.isTotal) return counts.section2.total;
    return ref.branchCode === null ? 0 : (counts.section2[ref.branchCode] ?? 0);
  }
  if (ref.branchCode === null || ref.bankCode === null) return 0;
  return counts.section3[ref.branchCode]?.[ref.bankCode] ?? 0;
};

// ── Column catalogue (single source for import binding, export, grid, i18n tests) ───────────────

export const ATM_REGISTER_GROUPS = [
  'identity',
  'keys',
  'cassettes',
  'hours',
  'secret',
  'location',
  'lifecycle',
  'hub',
] as const;
export type AtmRegisterGroup = (typeof ATM_REGISTER_GROUPS)[number];

/** P = everyone with atmRegister.view; K = viewSecrets only; S = sealed, reveal endpoint only. */
export type AtmRegisterSensitivity = 'P' | 'K' | 'S';

/** The 49 field paths of the register, one per Excel column A..AW (dotted into `keys`/`cassettes`). */
export type AtmRegisterField =
  | 'branchCode'
  | 'area'
  | 'bankCode'
  | 'machineCode'
  | 'name'
  | 'operationType'
  | 'vendor'
  | 'model'
  | 'serial'
  | 'keys.supervisorCode'
  | 'keys.supervisorCount'
  | 'keys.safeDoorCount'
  | 'keys.alanki'
  | 'keys.combinationKeyCode'
  | 'keys.combinationKeyCount'
  | 'keys.cashUnitCode'
  | 'keys.cashUnitCount'
  | 'cassettes.withdrawalType'
  | 'cassettes.withdrawalCount'
  | 'cassettes.withdrawal1'
  | 'cassettes.withdrawal2'
  | 'cassettes.withdrawal3'
  | 'cassettes.withdrawal4'
  | 'cassettes.withdrawal5'
  | 'cassettes.depositType'
  | 'cassettes.depositCount'
  | 'cassettes.collectionCount'
  | 'cassettes.recycle200'
  | 'cassettes.recycle100'
  | 'cassettes.recycle50'
  | 'cassettes.spareCount'
  | 'cassettes.spare1'
  | 'cassettes.spare2'
  | 'cassettes.spare3'
  | 'cassettes.spare4'
  | 'cassettes.spare5'
  | 'openTime'
  | 'closeTime'
  | 'accessHoursNotes'
  | 'receiptNotes'
  | 'safeCombination'
  | 'locationPlusCode'
  | 'startDate'
  | 'endDate'
  | 'receivedByName'
  | 'handoverName'
  | 'handoverNotes'
  | 'locationUrl'
  | 'hub';

export interface AtmRegisterColumnDef {
  /** 'A' … 'AW'. */
  excel: string;
  /** The EXACT row-1 text, newlines and stray spaces included (AB..AD are number cells). */
  header: string;
  /** 0-based nth occurrence of `header` in A..AW — four headers appear twice. */
  occurrence: number;
  /** Dotted path into the entry, e.g. 'keys.supervisorCode'. */
  field: AtmRegisterField;
  group: AtmRegisterGroup;
  sensitivity: AtmRegisterSensitivity;
  /** The sheet's <col width>, for the grid (§8.3). */
  excelWidth: number;
}

const col = (
  excel: string,
  header: string,
  occurrence: number,
  field: AtmRegisterField,
  group: AtmRegisterGroup,
  sensitivity: AtmRegisterSensitivity,
  excelWidth: number,
): AtmRegisterColumnDef => ({ excel, header, occurrence, field, group, sensitivity, excelWidth });

/** The 49 columns of the `ATMs` sheet, in A..AW order (spec §4, row for row). */
export const ATM_REGISTER_COLUMNS: readonly AtmRegisterColumnDef[] = [
  col('A', 'Branch', 0, 'branchCode', 'identity', 'P', 11.71),
  col('B', 'Aria', 0, 'area', 'identity', 'P', 16.57),
  col('C', 'BANK', 0, 'bankCode', 'identity', 'P', 9.14),
  col('D', 'ATM ID', 0, 'machineCode', 'identity', 'P', 13.14),
  col('E', 'Name', 0, 'name', 'identity', 'P', 42.57),
  col('F', 'opration type', 0, 'operationType', 'identity', 'P', 13.43),
  col('G', 'ATM type', 0, 'vendor', 'identity', 'P', 9.14),
  col('H', 'Model', 0, 'model', 'identity', 'P', 14.14),
  col('I', 'Serial', 0, 'serial', 'identity', 'P', 12.43),
  col('J', 'Supervisor\nKeys', 0, 'keys.supervisorCode', 'keys', 'K', 16.29),
  col('K', 'Number', 0, 'keys.supervisorCount', 'keys', 'K', 19.29),
  col('L', 'Safe Door\nKeys', 0, 'keys.safeDoorCount', 'keys', 'K', 9.29),
  col('M', 'Alanki', 0, 'keys.alanki', 'keys', 'K', 9.29),
  col('N', 'Combination safe Door\nKeys', 0, 'keys.combinationKeyCode', 'keys', 'K', 11.29),
  col('O', 'Number of\nkeys', 0, 'keys.combinationKeyCount', 'keys', 'K', 9.29),
  col('P', 'CASH Unit \nKeys', 0, 'keys.cashUnitCode', 'keys', 'K', 11.14),
  col('Q', 'Number of\nkeys', 1, 'keys.cashUnitCount', 'keys', 'K', 9.29),
  col('R', 'Withdrawall\nCassettes ', 0, 'cassettes.withdrawalType', 'cassettes', 'P', 16),
  col('S', 'Number of\nloading cassettes', 0, 'cassettes.withdrawalCount', 'cassettes', 'P', 9.29),
  col('T', 'Cassette -1', 0, 'cassettes.withdrawal1', 'cassettes', 'P', 9.29),
  col('U', 'Cassette -2', 0, 'cassettes.withdrawal2', 'cassettes', 'P', 9.29),
  col('V', 'Cassette -3', 0, 'cassettes.withdrawal3', 'cassettes', 'P', 9.29),
  col('W', 'Cassette -4', 0, 'cassettes.withdrawal4', 'cassettes', 'P', 9.29),
  col('X', 'Cassette -5', 0, 'cassettes.withdrawal5', 'cassettes', 'P', 9.29),
  col('Y', 'Deposit Cassettes', 0, 'cassettes.depositType', 'cassettes', 'P', 17),
  col('Z', 'Number of\nloading cassettes', 1, 'cassettes.depositCount', 'cassettes', 'P', 9.14),
  col('AA', 'Collection', 0, 'cassettes.collectionCount', 'cassettes', 'P', 9.29),
  col('AB', '200', 0, 'cassettes.recycle200', 'cassettes', 'P', 9.29),
  col('AC', '100', 0, 'cassettes.recycle100', 'cassettes', 'P', 9.29),
  col('AD', '50', 0, 'cassettes.recycle50', 'cassettes', 'P', 9.29),
  col('AE', 'Withdrawall \nCassettes Spear', 0, 'cassettes.spareCount', 'cassettes', 'P', 13.71),
  col('AF', 'Cassette -1', 1, 'cassettes.spare1', 'cassettes', 'P', 9.29),
  col('AG', 'Cassette -2', 1, 'cassettes.spare2', 'cassettes', 'P', 9.29),
  col('AH', 'Cassette -3', 1, 'cassettes.spare3', 'cassettes', 'P', 9.29),
  col('AI', 'Cassette -4', 1, 'cassettes.spare4', 'cassettes', 'P', 9.29),
  col('AJ', 'Cassette -5', 1, 'cassettes.spare5', 'cassettes', 'P', 9.14),
  col('AK', 'Open time', 0, 'openTime', 'hours', 'P', 9.29),
  col('AL', 'End time', 0, 'closeTime', 'hours', 'P', 9.29),
  col('AM', 'Notes lemite time', 0, 'accessHoursNotes', 'hours', 'P', 15.43),
  col('AN', 'Notes Received', 0, 'receiptNotes', 'hours', 'K', 27.29),
  col('AO', 'Combination\nSafe Door\n P.W', 0, 'safeCombination', 'secret', 'S', 18.29),
  col('AP', 'LOCATION\nGPS', 0, 'locationPlusCode', 'location', 'P', 9.14),
  col('AQ', 'Start Date\nOpration', 0, 'startDate', 'lifecycle', 'P', 12.14),
  col('AR', 'End Date\nOpration', 0, 'endDate', 'lifecycle', 'P', 14),
  col('AS', 'Received\nName', 0, 'receivedByName', 'lifecycle', 'P', 14.57),
  col('AT', 'Delivered\nName', 0, 'handoverName', 'lifecycle', 'P', 16.57),
  col('AU', 'Notes\nDelivered', 0, 'handoverNotes', 'lifecycle', 'K', 9.14),
  col('AV', 'LOCATION\nGPS', 1, 'locationUrl', 'location', 'P', 9.14),
  col('AW', 'HUB', 0, 'hub', 'hub', 'P', 14.57),
];

/** Display order (the owner's register layout: the Location group is AP + AV): A..AO, AP, AV, AQ..AU, AW. */
export const ATM_REGISTER_DISPLAY_ORDER: readonly string[] = [
  ...ATM_REGISTER_COLUMNS.slice(0, ATM_REGISTER_COLUMNS.findIndex((c) => c.excel === 'AP') + 1),
  ...ATM_REGISTER_COLUMNS.filter((c) => c.excel === 'AV'),
  ...ATM_REGISTER_COLUMNS.filter((c) => ['AQ', 'AR', 'AS', 'AT', 'AU'].includes(c.excel)),
  ...ATM_REGISTER_COLUMNS.filter((c) => c.excel === 'AW'),
].map((c) => c.excel);

// ── Input schemas ───────────────────────────────────────────────────────────────────────────────

/** Trim (JS `\s` covers NBSP and TAB), '' → null. Messages never echo the value. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => (s.trim() === '' ? null : s.trim()))
    .nullable();

/** K — every field needs `atmRegister.viewSecrets` to be written (DEC-7). */
export const AtmRegisterKeysInputSchema = z
  .object({
    supervisorCode: text(500).optional(),
    supervisorCount: text(200).optional(),
    safeDoorCount: text(200).optional(),
    alanki: text(200).optional(),
    combinationKeyCode: text(500).optional(),
    combinationKeyCount: text(200).optional(),
    cashUnitCode: text(500).optional(),
    cashUnitCount: text(200).optional(),
  })
  .strict();
export type AtmRegisterKeysInput = z.infer<typeof AtmRegisterKeysInputSchema>;

export const AtmRegisterCassettesInputSchema = z
  .object({
    withdrawalType: text(120).optional(),
    withdrawalCount: text(120).optional(),
    withdrawal1: text(120).optional(),
    withdrawal2: text(120).optional(),
    withdrawal3: text(120).optional(),
    withdrawal4: text(120).optional(),
    withdrawal5: text(120).optional(),
    depositType: text(120).optional(),
    depositCount: text(120).optional(),
    collectionCount: text(120).optional(),
    recycle200: text(120).optional(),
    recycle100: text(120).optional(),
    recycle50: text(120).optional(),
    spareCount: text(120).optional(),
    spare1: text(120).optional(),
    spare2: text(120).optional(),
    spare3: text(120).optional(),
    spare4: text(120).optional(),
    spare5: text(120).optional(),
  })
  .strict();
export type AtmRegisterCassettesInput = z.infer<typeof AtmRegisterCassettesInputSchema>;

const commonFields = {
  area: text(120).optional(),
  bankCode: AtmBankCodeSchema.nullable().optional(),
  opsBankLabel: text(64).optional(),
  name: z.string().trim().min(1).max(300),
  operationType: text(120).optional(),
  vendor: text(120).optional(),
  model: text(120).optional(),
  serial: text(120).optional(),
  /** K — viewSecrets (DEC-7). */
  keys: AtmRegisterKeysInputSchema.optional(),
  cassettes: AtmRegisterCassettesInputSchema.optional(),
  openTime: text(120).optional(),
  closeTime: text(120).optional(),
  accessHoursNotes: text(2000).optional(),
  /** K. */
  receiptNotes: text(4000).optional(),
  locationPlusCode: text(500).optional(),
  locationUrl: text(2048).optional(),
  hub: text(200).optional(),
  receivedByName: text(300).optional(),
};

/**
 * POST /atm/register/entries — Receive (startDate set) or a pending entry (startDate absent/null).
 * Status, end date and the Operations link are never input: the server derives them (D1).
 */
export const ReceiveAtmRegisterEntrySchema = z
  .object({
    branchId: objectId(),
    /** Normalized server-side (`normalizeAtmMachineCode`). */
    machineCode: z.string().max(64).optional(),
    ...commonFields,
    /** S — viewSecrets (DEC-7). */
    safeCombination: text(200).optional(),
    startDate: AtmRegisterDateSchema.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.startDate === undefined || v.startDate === null) return;
    if (v.bankCode === undefined || v.bankCode === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['bankCode'],
        message: 'required when startDate is set',
      });
    }
    if (v.machineCode === undefined || normalizeAtmMachineCode(v.machineCode) === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['machineCode'],
        message: 'required when startDate is set',
      });
    }
    // D6: area is required for a new open receipt.
    if (v.area === undefined || v.area === null) {
      ctx.addIssue({ code: 'custom', path: ['area'], message: 'required when startDate is set' });
    }
  });
export type ReceiveAtmRegisterEntry = z.infer<typeof ReceiveAtmRegisterEntrySchema>;

/** PATCH /atm/register/entries/:id — partial; `keys`/`cassettes` merge per sub-field. */
export const UpdateAtmRegisterEntrySchema = z
  .object({
    area: text(120).optional(),
    bankCode: AtmBankCodeSchema.nullable().optional(),
    opsBankLabel: text(64).optional(),
    /** Pending, or open ∧ unlinked (§5.6, DEC-30). */
    machineCode: z.string().max(64).optional(),
    name: z.string().trim().min(1).max(300).optional(),
    operationType: text(120).optional(),
    vendor: text(120).optional(),
    model: text(120).optional(),
    serial: text(120).optional(),
    /** K. */
    keys: AtmRegisterKeysInputSchema.optional(),
    cassettes: AtmRegisterCassettesInputSchema.optional(),
    openTime: text(120).optional(),
    closeTime: text(120).optional(),
    accessHoursNotes: text(2000).optional(),
    /** K. */
    receiptNotes: text(4000).optional(),
    /** S — `null` clears, absent keeps. */
    safeCombination: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
    locationPlusCode: text(500).optional(),
    locationUrl: text(2048).optional(),
    hub: text(200).optional(),
    /** Open/ended only, never cleared. */
    startDate: AtmRegisterDateSchema.optional(),
    /** Ended only, never cleared. */
    endDate: AtmRegisterDateSchema.optional(),
    receivedByName: text(300).optional(),
    /** Ended only. */
    handoverName: text(300).optional(),
    /** Ended only, K. */
    handoverNotes: text(4000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmRegisterEntry = z.infer<typeof UpdateAtmRegisterEntrySchema>;

/** POST /atm/register/entries/:id/receive — pending → open. */
export const ReceivePendingAtmRegisterEntrySchema = z
  .object({
    startDate: AtmRegisterDateSchema,
    area: text(120).optional(),
    bankCode: AtmBankCodeSchema.optional(),
    machineCode: z.string().max(64).optional(),
    opsBankLabel: text(64).optional(),
    receivedByName: text(300).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type ReceivePendingAtmRegisterEntry = z.infer<typeof ReceivePendingAtmRegisterEntrySchema>;

/**
 * POST /atm/register/entries/:id/handover — open → ended. An ABSENT field keeps the stored value
 * (8 imported open rows already carry AT, 7 carry AU); a sent value — `null`/'' included — replaces it.
 */
export const HandoverAtmRegisterEntrySchema = z
  .object({
    endDate: AtmRegisterDateSchema,
    handoverName: text(300).optional(),
    /** K. */
    handoverNotes: text(4000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type HandoverAtmRegisterEntry = z.infer<typeof HandoverAtmRegisterEntrySchema>;

/** DELETE /atm/register/entries/:id (body). */
export const DeleteAtmRegisterEntrySchema = z.object({ version: z.number().int().min(0) }).strict();
export type DeleteAtmRegisterEntry = z.infer<typeof DeleteAtmRegisterEntrySchema>;

/** POST /atm/register/entries/:id/link — couple an OPEN, unlinked entry to Operations (DEC-30). */
export const LinkAtmRegisterEntrySchema = z.object({ version: z.number().int().min(0) }).strict();
export type LinkAtmRegisterEntry = z.infer<typeof LinkAtmRegisterEntrySchema>;

export const ATM_REGISTER_SORT_FIELDS = [
  'createdAt',
  'branchId',
  'area',
  'bankCode',
  'machineCode',
  'name',
  'startDate',
  'endDate',
  'status',
] as const;

export const ListAtmRegisterEntriesQuerySchema = PaginationQuerySchema.extend({
  branchId: objectId().optional(),
  banks: listQuery(AtmBankCodeSchema),
  statuses: listQuery(AtmRegisterStatusSchema),
  area: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  withIssues: booleanQuery().optional(),
}).strict();
export type ListAtmRegisterEntriesQuery = z.infer<typeof ListAtmRegisterEntriesQuerySchema>;

/** The CSV export takes the list's filters and no page: it streams every matching row. */
export const ExportAtmRegisterEntriesQuerySchema = ListAtmRegisterEntriesQuerySchema.omit({
  page: true,
  pageSize: true,
});
export type ExportAtmRegisterEntriesQuery = z.infer<typeof ExportAtmRegisterEntriesQuerySchema>;

export const AtmRegisterBranchOptionsQuerySchema = z.object({ branchId: objectId() }).strict();
export type AtmRegisterBranchOptionsQuery = z.infer<typeof AtmRegisterBranchOptionsQuerySchema>;

// ── DTOs ────────────────────────────────────────────────────────────────────────────────────────

export interface AtmRegisterKeysDto {
  supervisorCode: string | null;
  supervisorCount: string | null;
  safeDoorCount: string | null;
  alanki: string | null;
  combinationKeyCode: string | null;
  combinationKeyCount: string | null;
  cashUnitCode: string | null;
  cashUnitCount: string | null;
}

export interface AtmRegisterCassettesDto {
  withdrawalType: string | null;
  withdrawalCount: string | null;
  withdrawal1: string | null;
  withdrawal2: string | null;
  withdrawal3: string | null;
  withdrawal4: string | null;
  withdrawal5: string | null;
  depositType: string | null;
  depositCount: string | null;
  collectionCount: string | null;
  recycle200: string | null;
  recycle100: string | null;
  recycle50: string | null;
  spareCount: string | null;
  spare1: string | null;
  spare2: string | null;
  spare3: string | null;
  spare4: string | null;
  spare5: string | null;
}

/** `unlinked` = an OPEN entry with no `machineId` (DEC-30); the other four describe a linked master. */
export const ATM_REGISTER_MASTER_STATES = [
  'active',
  'archived',
  'deleted',
  'missing',
  'unlinked',
] as const;
export type AtmRegisterMasterState = (typeof ATM_REGISTER_MASTER_STATES)[number];

export interface AtmRegisterImportIssueDto {
  code: AtmRegisterImportIssueCode;
  column: string | null;
  /** Only for P-class columns; ALWAYS null for J..Q, AN, AO, AU. */
  detail: string | null;
}

export interface AtmRegisterEntryDto {
  id: string;
  branchId: string | null;
  /** Resolved from the setting at read time. */
  branchCode: AtmRegisterBranchCode | null;
  area: string | null;
  bankCode: AtmBankCode | null;
  /** The stored override (null = automatic). */
  opsBankLabel: string | null;
  /** override ?? the setting's label for bankCode. */
  effectiveOpsBankLabel: string | null;
  machineCode: string | null;
  machineId: string | null;
  /** 'unlinked' when open ∧ machineId null; null for pending/ended without machineId (DEC-24, DEC-30). */
  masterState: AtmRegisterMasterState | null;
  /** Null only on an imported row with a blank E (DEC-32). */
  name: string | null;
  operationType: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  /** DEC-7 / D3, per entry (§5.4). */
  secretsVisible: boolean;
  /** Null when !secretsVisible. */
  keys: AtmRegisterKeysDto | null;
  cassettes: AtmRegisterCassettesDto;
  openTime: string | null;
  closeTime: string | null;
  accessHoursNotes: string | null;
  /** Null when !secretsVisible. */
  receiptNotes: string | null;
  /** The ONLY trace of AO in any DTO. */
  safeCombinationSet: boolean;
  locationPlusCode: string | null;
  locationUrl: string | null;
  hub: string | null;
  /** 'YYYY-MM-DD'. */
  startDate: string | null;
  /** 'YYYY-MM-DD'. */
  endDate: string | null;
  receivedByName: string | null;
  handoverName: string | null;
  /** Null when !secretsVisible. */
  handoverNotes: string | null;
  status: AtmRegisterStatus;
  source: 'manual' | 'import';
  importRow: number | null;
  importIssues: AtmRegisterImportIssueDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a write noticed without refusing it. `codeActiveElsewhere`: an edit that set the area of an
 * unlinked entry could not couple it (DEC-9/DEC-30); the edit is saved.
 */
export const ATM_REGISTER_WARNINGS = [
  'idFormat',
  'serialDuplicate',
  'endBeforeStart',
  'futureDate',
  'masterDiffers',
  'opsBankLabelIgnored',
  'codeActiveElsewhere',
] as const;
export type AtmRegisterWarning = (typeof ATM_REGISTER_WARNINGS)[number];

/** What a write did to the Operations machine master (D2). */
export const ATM_REGISTER_MASTER_ACTIONS = [
  'link',
  'reactivate',
  'create',
  'archive',
  'sync',
  'none',
] as const;
export type AtmRegisterMasterAction = (typeof ATM_REGISTER_MASTER_ACTIONS)[number];

export interface AtmRegisterWriteResultDto {
  entry: AtmRegisterEntryDto;
  warnings: AtmRegisterWarning[];
  master: { action: AtmRegisterMasterAction; machineId: string | null };
}

export interface AtmRegisterRevealDto {
  safeCombination: string | null;
}

export interface AtmRegisterMetaDto {
  banks: { code: AtmBankCode; name: LocalizedString; opsLabel: string; color: string }[];
  branches: {
    code: AtmRegisterBranchCode;
    name: LocalizedString;
    branchId: string | null;
    branchName: LocalizedString | null;
    branchActive: boolean;
    canView: boolean;
    canCreate: boolean;
  }[];
}

export interface AtmRegisterBranchOptionsDto {
  branchId: string;
  /** ACTIVE atm_ref_labels of that branch. */
  areaLabels: string[];
  bankLabels: string[];
  /** Distinct entry values in that branch. */
  areas: string[];
  operationTypes: string[];
  vendors: string[];
  models: string[];
  hubs: string[];
}

export interface AtmRegisterReportDto {
  /** ISO — the as-of stamp (D7): computation time = data time. */
  generatedAt: string;
  /** Mapped ∩ in scope (DEC-27). */
  branchesShown: AtmRegisterBranchCode[];
  counts: AtmRegisterReportCounts;
}

// ── Import vocabulary (§6) ──────────────────────────────────────────────────────────────────────

export const ATM_REGISTER_IMPORT_ISSUES = [
  'noBranch',
  'unknownBranchCode',
  'areaError',
  'openNoArea',
  'bankAlias',
  'unknownBank',
  'noBank',
  'noCode',
  'placeholderCode',
  'codeWhitespace',
  'idFormat',
  'hdbSpelling',
  'duplicateOpen',
  'openNotNewest',
  'serialDuplicate',
  'exactDuplicate',
  'timeOverDay',
  'aoShape',
  'dateSerial',
  'dateInvalid',
  'endBeforeStart',
  'futureStart',
  'futureEnd',
  'dateInText',
  'errorValue',
  'noName',
] as const;
export type AtmRegisterImportIssueCode = (typeof ATM_REGISTER_IMPORT_ISSUES)[number];

/** Approvable, applied only when named in `apply`. */
export const ATM_REGISTER_IMPORT_CATEGORIES = [
  'entries',
  'link',
  'reactivate',
  'create',
  'nbeForex',
] as const;
export type AtmRegisterImportCategory = (typeof ATM_REGISTER_IMPORT_CATEGORIES)[number];

/** Report-only. The last two are the item lists behind the blockers of the same name (DEC-31). */
export const ATM_REGISTER_IMPORT_REPORTS = [
  'cannotCouple',
  'activeElsewhere',
  'activeMasterWithoutOpenEntry',
  'openInRegister',
  'changedSinceImport',
] as const;
export type AtmRegisterImportReport = (typeof ATM_REGISTER_IMPORT_REPORTS)[number];

export const ATM_REGISTER_IMPORT_REASONS = [
  'blankArea',
  'activeElsewhere',
  'noCode',
  'placeholderCode',
  'noBank',
  'noName',
  'labelMissing',
  'keepsMasterLabel',
  'notImported',
] as const;
export type AtmRegisterImportReason = (typeof ATM_REGISTER_IMPORT_REASONS)[number];

export const ATM_REGISTER_IMPORT_BLOCKERS = [
  'branchUnmapped',
  'branchInactive',
  'branchOutOfReach',
  'secretsOutOfReach',
  'reportMismatch',
  'dateUnreadable',
  'openInRegister',
  'changedSinceImport',
  'secretStoreUnavailable',
  'runInProgress',
] as const;
export type AtmRegisterImportBlocker = (typeof ATM_REGISTER_IMPORT_BLOCKERS)[number];

export const ATM_REGISTER_IMPORT_RUN_STATES = [
  'running',
  'completed',
  'failed',
  'abandoned',
] as const;
export type AtmRegisterImportRunState = (typeof ATM_REGISTER_IMPORT_RUN_STATES)[number];

/** Keys of `counts` on an applied result / run (§6.6). */
export const ATM_REGISTER_IMPORT_OUTCOMES = [
  'imported',
  'alreadyImported',
  'linked',
  'reactivated',
  'created',
  'nbeForex',
  'cannotCouple',
  'notApproved',
  'openInRegister',
] as const;
export type AtmRegisterImportOutcome = (typeof ATM_REGISTER_IMPORT_OUTCOMES)[number];

export interface AtmRegisterImportItemDto {
  importRow: number;
  branchCode: AtmRegisterBranchCode | null;
  machineCode: string | null;
  name: string | null;
  area: string | null;
  bankCode: AtmBankCode | null;
  /** The master this item links/reactivates. */
  machineId: string | null;
  /** link: the label adopted (D5). */
  masterBankLabel: string | null;
  reason: AtmRegisterImportReason | null;
  /** link only (DEC-8). */
  differences: ('name' | 'area')[];
  /**
   * activeElsewhere / openInRegister: where the conflicting master or entry is — named only when
   * the importer's `atmRegister.import` reaches that branch (else both null).
   */
  otherBranchCode: AtmRegisterBranchCode | null;
  otherBranchName: LocalizedString | null;
  /** openInRegister / changedSinceImport: the stored entry. */
  entryId: string | null;
  /** changedSinceImport: Excel letters that differ — NEVER values. */
  columns: string[];
}

export interface AtmRegisterImportCategoryDto {
  key: AtmRegisterImportCategory | AtmRegisterImportReport;
  approvable: boolean;
  count: number;
  items: AtmRegisterImportItemDto[];
  /** activeElsewhere only: one row per (other branch → this row's branch); [] elsewhere. */
  pairs: {
    fromBranchCode: AtmRegisterBranchCode | null;
    fromBranchName: LocalizedString | null;
    toBranchCode: AtmRegisterBranchCode;
    count: number;
  }[];
}

export interface AtmRegisterImportReportCellDto extends AtmReportCellRef {
  expected: number;
  recomputed: number;
  matches: boolean;
}

export interface AtmRegisterImportResultDto {
  mode: 'preview' | 'applied';
  fileName: string;
  fileSha256: string;
  sheet: { firstDataRow: 3; lastDataRow: number; sentinelRow: number | null };
  counts: { rows: number; open: number; ended: number; pending: number; alreadyImported: number };
  blockers: AtmRegisterImportBlocker[];
  report: { cells: AtmRegisterImportReportCellDto[]; allMatch: boolean };
  issues: {
    byCode: { code: AtmRegisterImportIssueCode; count: number }[];
    rows: { importRow: number; issues: AtmRegisterImportIssueDto[] }[];
  };
  branches: {
    code: AtmRegisterBranchCode;
    branchId: string | null;
    branchName: LocalizedString | null;
    active: boolean;
    inReach: boolean;
    rows: number;
    openRows: number;
  }[];
  categories: AtmRegisterImportCategoryDto[];
  applied: {
    runId: string;
    categories: AtmRegisterImportCategory[];
    reportOverride: boolean;
    counts: Record<string, number>;
  } | null;
}

export interface AtmRegisterImportRunDto {
  id: string;
  fileName: string;
  fileSha256: string;
  state: AtmRegisterImportRunState;
  startedAt: string;
  finishedAt: string | null;
  actorName: string | null;
  categories: AtmRegisterImportCategory[];
  reportOverride: boolean;
  counts: Record<string, number>;
}
