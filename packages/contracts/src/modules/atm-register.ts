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
  type Locale,
  type LocalizedString,
} from '../common/index.js';
import { ATM_BANK_CODE_PATTERN, normalizeAtmMachineCode } from './atm.js';

// ── Banks (D5, amended by DEC-35: the bank catalog) ─────────────────────────────────────────────
//
// The owner's call (final): a bank added at runtime is a FULL register bank — it appears in the
// register, the Data Report, settlements and the map. So the bank vocabulary is no longer a fixed
// enum here: it is the company-wide catalog `atm_banks` (owned by ATM, seeded with the workbook's
// six), and this file keeps only what does not change with the catalog — the code SHAPE, the six
// seeds' own facts, and the sheet's report orders. Whether a code EXISTS is the server's question.
//
// The old `ATM_BANK_CODES` / `ATM_BANK_NAMES` / `ATM_BANK_REPORT_COLORS` /
// `ATM_DEFAULT_OPS_BANK_LABELS` are deleted with no alias on purpose: every `X[code]` that assumed
// six banks stops compiling, and that compiler list is the migration checklist (design §2).

// `ATM_BANK_CODE_PATTERN` itself lives in atm.ts beside the machine-code rule: the ref-label
// schemas there validate a spelling's `bankCode` with it, and atm.ts may not import this file back
// (a module cycle would leave the pattern undefined for whoever loads this file first).

/**
 * A bank code as input: the shape only (`^[A-Z][A-Z0-9]{1,9}$`). The six seeds still parse, so
 * every body, query and stored value written before the catalog stays valid. The lower-case
 * sentinels `none` (map) and `total` (fold) can never collide with a code.
 */
export const AtmBankCodeSchema = z.string().regex(ATM_BANK_CODE_PATTERN);
/** Any catalog code. A `string`: a seventh bank is data, not a type. */
export type AtmBankCode = string;

/** The workbook's six — the catalog's seeds (DEC-35), in the sheet's section-3 order. */
export const ATM_SEED_BANK_CODES = ['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT'] as const;
export type AtmSeedBankCode = (typeof ATM_SEED_BANK_CODES)[number];

export const isAtmSeedBankCode = (code: string): code is AtmSeedBankCode =>
  (ATM_SEED_BANK_CODES as readonly string[]).includes(code);

/** One seed's facts — exactly what the deleted per-bank records held, in one row. */
export interface AtmBankSeed {
  code: AtmSeedBankCode;
  /** The Data Report's own names (Data Report AE2..AI2, AD2 with D7's double-space fix). */
  name: LocalizedString;
  /** The Excel chart-3 series colour (D7) — identity, used in both themes. */
  color: string;
  /** D5 default bankCode → Operations label (legacy labels: reports_atm.ejs:350 MISR, :403 NBE FOREX). */
  opsLabel: string;
  /** Section-3 order × 10, so a curated bank can be slotted between two seeds. */
  sortOrder: number;
}

/**
 * The six seeds. Read by the boot seed (`$setOnInsert`, so a curated catalog edit is never
 * overwritten) and, on the web, as the fallback when the catalog has not loaded yet — so a seed
 * bank is never shown as a bare code.
 */
export const ATM_BANK_SEED: readonly AtmBankSeed[] = [
  {
    code: 'NBE',
    name: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' },
    color: '#385723',
    opsLabel: 'NBE',
    sortOrder: 10,
  },
  {
    code: 'BM',
    name: { ar: 'بنك مصر', en: 'Banque Misr' },
    color: '#AC2100',
    opsLabel: 'MISR',
    sortOrder: 20,
  },
  {
    code: 'CIB',
    name: { ar: 'البنك التجارى الدولى', en: 'Commercial International Bank' },
    color: '#FFD966',
    opsLabel: 'CIB',
    sortOrder: 30,
  },
  {
    code: 'HDB',
    name: { ar: 'بنك التعمير والاسكان', en: 'Housing and Development Bank' },
    color: '#B4C7E7',
    opsLabel: 'HDB',
    sortOrder: 40,
  },
  {
    code: 'BRK',
    name: { ar: 'بنك البركة', en: 'Al Baraka Bank' },
    color: '#F4B183',
    opsLabel: 'BRK',
    sortOrder: 50,
  },
  {
    code: 'NXT',
    name: { ar: 'NXT BANK', en: 'NXT BANK' },
    color: '#000099',
    opsLabel: 'NXT',
    sortOrder: 60,
  },
];

/** The seed row of a code, or undefined for a catalog-only bank. */
export const atmBankSeedOf = (code: string): AtmBankSeed | undefined =>
  ATM_BANK_SEED.find((seed) => seed.code === code);

/** Charts 1–2: the workbook theme's accent1 (xl/theme/theme1.xml), the Excel's single series (DEC-19). */
export const ATM_REPORT_TOTALS_COLOR = '#4472C4';

/** A catalog colour: `#RRGGBB`, upper-case (the seeds' own spelling). */
export const ATM_BANK_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

/**
 * The colours a new bank is offered by default — the first one no bank uses yet. Excel's own
 * standard and theme colours (the workbook's palette), none equal to a seed's or to
 * `ATM_REPORT_TOTALS_COLOR`, so a seventh bank's bar, series and map pin never read as another's.
 */
export const ATM_BANK_EXTRA_COLORS: readonly string[] = [
  '#7030A0',
  '#00B0F0',
  '#00B050',
  '#FF66CC',
  '#7F6000',
  '#008080',
  '#C55A11',
  '#92D050',
];

/** Import-only spellings (exact match after trim). Row 2120 is the only one. */
export const ATM_REGISTER_BANK_ALIASES: Readonly<Record<string, AtmSeedBankCode>> = {
  نيكست: 'NXT',
};

/** The Operations bank label an NBE machine in an ` FX` area may carry (D5, DEC-16). */
export const ATM_NBE_FOREX_LABEL = 'NBE FOREX';

/**
 * D6: per-bank ID shapes — a WARNING, never a block. HDB is written three ways in the workbook
 * (`HDB - n`, `HDB-ATM n`, `HDB-ATMn`) and all three are accepted; which one is canonical is EG-7.
 *
 * Kept in code for the six only, never in the catalog: a regex typed by a user would run on every
 * register write and every layout import row (a ReDoS risk, and a regex editor) for what is only a
 * warning. A Map, so a crafted bank key cannot reach `Object.prototype`.
 */
export const ATM_REGISTER_ID_FORMATS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>([
  ['NBE', /^\d{8}$/],
  ['BM', /^\d{7}$/],
  ['CIB', /^\d{1,4}$/],
  ['HDB', /^HDB(?: - |-ATM ?)\d+$/],
  ['BRK', /^BRK[NW]\d+$/],
  ['NXT', /^ATM\d{4}$/],
]);

/** A bank with no known shape never warns. */
export const atmRegisterIdFormatOk = (bank: AtmBankCode, code: string): boolean =>
  ATM_REGISTER_ID_FORMATS.get(bank)?.test(code) ?? true;

// ── Bank catalog (DEC-35) — `atm_banks`, GET/POST /atm/banks, PATCH /atm/banks/:code ────────────

/**
 * One catalog bank. `code` is never changed after creation: it is the key stored on register
 * entries, plans, plan lines, preparations, standard loads, layout-import runs, the note-counter
 * key, URLs (`?bank=`) and report keys (`s1.NBE`). `opsLabel` is the ONE text a receipt writes on
 * `atm_machines.bankName`; `formerOpsLabels` keeps the labels it had, so machines that still carry
 * an old text keep resolving to the bank. Nothing is ever deleted — `isActive: false` archives.
 */
export interface AtmBankDto {
  id: string;
  code: AtmBankCode;
  name: LocalizedString;
  opsLabel: string;
  /** System-managed: every earlier `opsLabel`, oldest first. The API never edits it directly. */
  formerOpsLabels: string[];
  color: string;
  sortOrder: number;
  isActive: boolean;
  /** One of the workbook's six — always shown in the Data Report, as in the sheet. */
  isSeed: boolean;
  /** Whether the register warns on this bank's ID shape (`ATM_REGISTER_ID_FORMATS`, the six only). */
  hasIdFormat: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Arabic AND English, both required: the register, the report and the map show the reader's own. */
const AtmBankNameSchema = z
  .object({ ar: z.string().trim().min(1).max(80), en: z.string().trim().min(1).max(80) })
  .strict();

/** `<input type="color">` answers lower-case; the catalog stores the seeds' upper-case spelling. */
const AtmBankColorSchema = z.string().trim().toUpperCase().regex(ATM_BANK_COLOR_PATTERN);

/** The setting's own limit (`AtmRegisterBankLabelsSettingSchema`), which `opsLabel` replaced. */
const AtmBankOpsLabelSchema = z.string().trim().min(1).max(64);

const AtmBankSortOrderSchema = z.number().int().min(0).max(100_000);

/**
 * POST /atm/banks — `atmBank.create` at ORGANIZATION scope (a bank is one fact about the company).
 * The code is upper-cased before its shape is checked, so `qnb` is QNB. Without an `opsLabel`
 * the code is the label — what Operations type for most banks (NBE, CIB, HDB …). Colour and order
 * default on the server (the first unused `ATM_BANK_EXTRA_COLORS`, max `sortOrder` + 10).
 */
export const CreateAtmBankSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(ATM_BANK_CODE_PATTERN),
    name: AtmBankNameSchema,
    opsLabel: AtmBankOpsLabelSchema.optional(),
    color: AtmBankColorSchema.optional(),
    sortOrder: AtmBankSortOrderSchema.optional(),
  })
  .strict()
  .transform((input) => ({ ...input, opsLabel: input.opsLabel ?? input.code }));
export type CreateAtmBankInput = z.input<typeof CreateAtmBankSchema>;
export type CreateAtmBank = z.output<typeof CreateAtmBankSchema>;

/**
 * PATCH /atm/banks/:code — `atmBank.edit` at organization scope, versioned. The code is not
 * editable (see `AtmBankDto`). A new `opsLabel` moves the old one to `formerOpsLabels`; existing
 * machines keep the text they carry. Archiving is always allowed and deletes nothing.
 */
export const UpdateAtmBankSchema = z
  .object({
    name: AtmBankNameSchema.optional(),
    opsLabel: AtmBankOpsLabelSchema.optional(),
    color: AtmBankColorSchema.optional(),
    sortOrder: AtmBankSortOrderSchema.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAtmBank = z.infer<typeof UpdateAtmBankSchema>;

/**
 * The key a label is matched on (`opsLabelKeys`, and a spelling against them): trimmed and
 * upper-cased, so «nbe » and «NBE» are the same bank and can never map to two.
 */
export const atmBankLabelKey = (label: string): string => label.trim().toUpperCase();

/**
 * A bank's name in the reader's language: the catalog's (when the caller has it), else the seed's,
 * else the code itself — so a missed consumer, or a page whose catalog is still loading, shows a
 * code rather than nothing.
 */
export const atmBankName = (
  code: AtmBankCode,
  locale: Locale,
  banks?: readonly { code: AtmBankCode; name: LocalizedString }[],
): string =>
  (banks?.find((bank) => bank.code === code) ?? atmBankSeedOf(code))?.name[locale] ?? code;

/** A bank's colour: the catalog's, else the seed's, else null (the web draws it grey). */
export const atmBankColor = (
  code: AtmBankCode,
  banks?: readonly { code: AtmBankCode; color: string }[],
): string | null =>
  (banks?.find((bank) => bank.code === code) ?? atmBankSeedOf(code))?.color ?? null;

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

/**
 * `atm.register.bankLabels` — RETIRED (DEC-35). The catalog's `opsLabel` replaced it; the boot seed
 * reads it ONCE, when it first inserts the six, so an administrator's curated label survives the
 * move. Still declared so a stored value keeps validating, and still the six only: no catalog bank
 * added later was ever in it.
 */
export const AtmRegisterBankLabelsSettingSchema = z
  .array(
    z
      .object({ bankCode: z.enum(ATM_SEED_BANK_CODES), label: z.string().trim().min(1).max(64) })
      .strict(),
  )
  .max(6)
  .refine(
    uniqueBy((r) => r.bankCode),
    'each bank once',
  );
export type AtmRegisterBankLabelsSetting = z.infer<typeof AtmRegisterBankLabelsSettingSchema>;

/** The retired setting's default — the seeds' own labels. */
export const ATM_DEFAULT_BANK_LABELS_SETTING: AtmRegisterBankLabelsSetting = ATM_BANK_SEED.map(
  (seed) => ({ bankCode: seed.code, label: seed.opsLabel }),
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

/**
 * Section 1 categories, left to right as the sheet lays them out (AD2..AI2). The SHEET's order of
 * its six — a catalog bank is appended by `atmReportBankOrders`, never slotted in here.
 */
export const ATM_REPORT_SECTION1_BANKS: readonly AtmSeedBankCode[] = [
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
/** Section 3 columns (AE7..AJ7) — the sheet's six; a catalog bank is appended (DEC-40). */
export const ATM_REPORT_SECTION3_BANKS: readonly AtmSeedBankCode[] = [
  'NBE',
  'BM',
  'CIB',
  'HDB',
  'BRK',
  'NXT',
];

/** The report's bank orders once the catalog holds banks beyond the sheet's six. */
export interface AtmReportBankOrders {
  section1: AtmBankCode[];
  section3: AtmBankCode[];
}

/**
 * DEC-40: the six keep their sheet positions — so the page still reads like the workbook it
 * replaced — and every other bank follows, in the order given (the server passes the catalog's
 * `sortOrder`, then code): after BRK in section 1, after NXT in section 3. A seed code or a repeat
 * in `extras` is dropped, so a careless caller cannot show a bank twice.
 */
export const atmReportBankOrders = (extras: readonly AtmBankCode[]): AtmReportBankOrders => {
  const tail: AtmBankCode[] = [];
  for (const code of extras) {
    if (!isAtmSeedBankCode(code) && !tail.includes(code)) tail.push(code);
  }
  return {
    section1: [...ATM_REPORT_SECTION1_BANKS, ...tail],
    section3: [...ATM_REPORT_SECTION3_BANKS, ...tail],
  };
};

/** One group of ACTIVE entries. `branchCode:null` = branch set but not mapped. */
export interface AtmRegisterReportGroup {
  branchCode: AtmRegisterBranchCode | null;
  bankCode: AtmBankCode | null;
  count: number;
}

export interface AtmRegisterReportCounts {
  /**
   * AD3..AI3 + AJ3, one cell per bank folded (the six, then any catalog bank). `total` = Σ the
   * bank cells, as `=SUM(AD3:AI3)` — a bank code is upper-case, so it can never be `total`.
   */
  section1: Record<AtmBankCode, number> & { total: number };
  /** AD5..AJ5 + AK5 (total = Σ the branch cells shown). Only branches in `branchesShown`. */
  section2: Partial<Record<AtmRegisterBranchCode, number>> & { total: number };
  /** rows 8–14 × one column per bank folded. No totals (the Excel has none). */
  section3: Partial<Record<AtmRegisterBranchCode, Record<AtmBankCode, number>>>;
  /** ACTIVE with a branch outside the mapping: counted in section 1 only. */
  activeWithUnmappedBranch: number;
  /** ACTIVE with no bank: counted in sections 2/3 rows only, never in a bank cell. */
  activeWithoutBank: number;
}

const zeroBanks = (banks: readonly AtmBankCode[]): Record<AtmBankCode, number> =>
  Object.fromEntries(banks.map((bank) => [bank, 0]));

/**
 * The single implementation of D7 — used by the report endpoint AND the import's 57-number check,
 * so the page and the cut-over check cannot disagree about what a cell counts.
 *
 * Every cell is a number (0 when nothing), never absent: each shown branch is present in section 2
 * and carries every folded bank in section 3. `groups` must already be ACTIVE entries only — the
 * fold counts, it does not judge (`isAtmRegisterActive` is the judge).
 *
 * `banks` defaults to the six, which is what the workbook knows: the import's 57-cell check folds
 * with the default and stays the sheet's arithmetic. The report endpoint passes the catalog's
 * banks. A group whose bank is NOT in `banks` is still counted — appended as its own cell (sorted,
 * so the answer does not depend on the order the groups arrived in) — because dropping it would
 * make section 1's total disagree with section 2's for the same entries.
 */
export const foldAtmRegisterReport = (
  groups: readonly AtmRegisterReportGroup[],
  branchesShown: readonly AtmRegisterBranchCode[] = ATM_REGISTER_BRANCH_CODES,
  banks: readonly AtmBankCode[] = ATM_SEED_BANK_CODES,
): AtmRegisterReportCounts => {
  const listed = new Set<AtmBankCode>(banks);
  const unlisted = new Set<AtmBankCode>();
  for (const { bankCode } of groups) {
    if (bankCode !== null && !listed.has(bankCode)) unlisted.add(bankCode);
  }
  const folded = [...listed, ...[...unlisted].sort()];

  const shown = new Set<AtmRegisterBranchCode>(branchesShown);
  const section1: Record<AtmBankCode, number> & { total: number } = {
    ...zeroBanks(folded),
    total: 0,
  };
  const section2: Partial<Record<AtmRegisterBranchCode, number>> & { total: number } = { total: 0 };
  const section3: Partial<Record<AtmRegisterBranchCode, Record<AtmBankCode, number>>> = {};
  for (const code of shown) {
    section2[code] = 0;
    section3[code] = zeroBanks(folded);
  }
  let activeWithUnmappedBranch = 0;
  let activeWithoutBank = 0;

  for (const { branchCode, bankCode, count } of groups) {
    if (bankCode !== null) section1[bankCode] = (section1[bankCode] ?? 0) + count;
    if (branchCode === null) activeWithUnmappedBranch += count;
    if (bankCode === null) activeWithoutBank += count;
    if (branchCode === null || !shown.has(branchCode)) continue;
    section2[branchCode] = (section2[branchCode] ?? 0) + count;
    const row = section3[branchCode];
    if (bankCode !== null && row !== undefined) row[bankCode] = (row[bankCode] ?? 0) + count;
  }

  section1.total = folded.reduce((sum, bank) => sum + (section1[bank] ?? 0), 0);
  section2.total = [...shown].reduce((sum, code) => sum + (section2[code] ?? 0), 0);
  return { section1, section2, section3, activeWithUnmappedBranch, activeWithoutBank };
};

/** One numeric cell of the Data Report — the sheet's 57, or a catalog bank's (`cell: ''`). */
export interface AtmReportCellRef {
  key: string;
  /** The sheet address; '' for a catalog bank's cell, which the workbook does not have. */
  cell: string;
  section: 1 | 2 | 3;
  branchCode: AtmRegisterBranchCode | null;
  bankCode: AtmBankCode | null;
  isTotal: boolean;
}

/** The sheet's report columns, AD onward. */
const REPORT_COLUMNS = ['AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK'] as const;
const reportColumn = (index: number): string => REPORT_COLUMNS[index] ?? '';

/** A seed's sheet column in a section, by ITS sheet position — '' for a catalog bank. */
const sheetColumn = (
  sheetOrder: readonly AtmSeedBankCode[],
  bankCode: AtmBankCode,
  offset: number,
): string => {
  const index = isAtmSeedBankCode(bankCode) ? sheetOrder.indexOf(bankCode) : -1;
  return index === -1 ? '' : reportColumn(index + offset);
};

/**
 * The Data Report's numeric cells for the given bank orders, keyed as the sheet's always were:
 * section 1 `s1.<bank>` … `s1.total`, section 2 `s2.EGYCASH-7` … `s2.total`, section 3
 * `s3.<branch>.<bank>`. A seed carries its sheet letter (AD3.., AE8..) wherever the order puts it,
 * a catalog bank carries `cell: ''` (the letters are shown only in the import's check, which knows
 * the six), and the totals keep AJ3 and AK5 — they are the workbook's totals.
 */
export const buildAtmReportCells = (
  section1Banks: readonly AtmBankCode[],
  section3Banks: readonly AtmBankCode[],
): AtmReportCellRef[] => [
  ...section1Banks.map((bankCode): AtmReportCellRef => {
    const column = sheetColumn(ATM_REPORT_SECTION1_BANKS, bankCode, 0);
    return {
      key: `s1.${bankCode}`,
      cell: column === '' ? '' : `${column}3`,
      section: 1,
      branchCode: null,
      bankCode,
      isTotal: false,
    };
  }),
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
    section3Banks.map((bankCode): AtmReportCellRef => {
      const column = sheetColumn(ATM_REPORT_SECTION3_BANKS, bankCode, 1);
      return {
        key: `s3.${branchCode}.${bankCode}`,
        cell: column === '' ? '' : `${column}${String(row + 8)}`,
        section: 3,
        branchCode,
        bankCode,
        isTotal: false,
      };
    }),
  ),
];

/**
 * The sheet's 57 numeric cells: section 1 AD3..AI3 + AJ3 total, section 2 AD5..AJ5 + AK5 total,
 * section 3 rows 8..14 × AE..AJ. 7 + 8 + 42 = 57 — byte for byte what this constant held before the
 * catalog (pinned by a spec), because the import's cut-over check compares against the workbook.
 */
export const ATM_DATA_REPORT_CELLS: readonly AtmReportCellRef[] = buildAtmReportCells(
  ATM_REPORT_SECTION1_BANKS,
  ATM_REPORT_SECTION3_BANKS,
);

/** The value a fold gives one cell. A branch outside `branchesShown`, or a bank not folded, reads 0. */
export const readAtmReportCell = (
  counts: AtmRegisterReportCounts,
  ref: AtmReportCellRef,
): number => {
  if (ref.section === 1) {
    if (ref.isTotal) return counts.section1.total;
    return ref.bankCode === null ? 0 : (counts.section1[ref.bankCode] ?? 0);
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
    /**
     * DEC-37 «بيانات ناقصة»: Efficiency ticks it off once they have completed a receipt Operations
     * recorded from data-edit (or sets it on any entry they mean to come back to). Never cleared by
     * the server on its own — a filled field is not proof the row was reviewed.
     */
    dataIncomplete: z.boolean().optional(),
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
  /** DEC-37: true → only entries flagged «بيانات ناقصة»; false → only those not flagged. */
  incomplete: booleanQuery().optional(),
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

/**
 * Where an entry came from. `operations` (DEC-36): recorded by the server when Operations added the
 * machine on /atm/data-edit — the owner's call that such a machine lands in the register as an
 * OPEN, linked receipt dated the add day. Its own value, not `manual`, so Efficiency can see that
 * nobody on their side typed it.
 */
export const ATM_REGISTER_SOURCES = ['manual', 'import', 'operations'] as const;
export type AtmRegisterSource = (typeof ATM_REGISTER_SOURCES)[number];

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
  source: AtmRegisterSource;
  /**
   * DEC-37 «بيانات ناقصة»: a stored flag, not derived from blank fields — most imported rows have
   * legitimate blanks (DEC-32), and the key fields cannot be judged without `viewSecrets`. Set by
   * the data-edit intake, set or cleared by Efficiency. False on every row written before it.
   */
  dataIncomplete: boolean;
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
  /**
   * EVERY catalog bank, archived ones included (an entry may still carry one), in `sortOrder`.
   * A picker offers the active ones plus the entry's current bank.
   */
  banks: {
    code: AtmBankCode;
    name: LocalizedString;
    opsLabel: string;
    color: string;
    isActive: boolean;
    sortOrder: number;
    isSeed: boolean;
  }[];
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
  /** ACTIVE atm_ref_labels of that branch (stored names; kept for older screens). */
  areaLabels: string[];
  bankLabels: string[];
  /**
   * The same ACTIVE area labels with their display names (DEC-38): `name` is what an entry and a
   * machine store, `nameAr`/`nameEn` are what the picker shows.
   */
  areaOptions: { name: string; nameAr: string | null; nameEn: string | null }[];
  /**
   * The branch's ACTIVE Operations spellings that are mapped to an ACTIVE catalog bank — what the
   * Operations-label select offers once a bank is chosen (DEC-25, now enforced by the server).
   */
  bankVariants: { name: string; bankCode: AtmBankCode }[];
  /** Distinct entry values in that branch. */
  areas: string[];
  operationTypes: string[];
  vendors: string[];
  models: string[];
  hubs: string[];
}

/** One bank as the report draws it — every bank the report folded, archived ones included. */
export interface AtmRegisterReportBankDto {
  code: AtmBankCode;
  name: LocalizedString;
  color: string;
  isActive: boolean;
  isSeed: boolean;
}

export interface AtmRegisterReportDto {
  /** ISO — the as-of stamp (D7): computation time = data time. */
  generatedAt: string;
  /** Mapped ∩ in scope (DEC-27). */
  branchesShown: AtmRegisterBranchCode[];
  counts: AtmRegisterReportCounts;
  /** The banks of `section1Banks`, with what the page needs to name and colour them. */
  banks: AtmRegisterReportBankDto[];
  /** DEC-40: `atmReportBankOrders` of the catalog — the sheet's six, then every other bank. */
  section1Banks: AtmBankCode[];
  section3Banks: AtmBankCode[];
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
