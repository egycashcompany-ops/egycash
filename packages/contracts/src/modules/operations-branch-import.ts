// «استيراد فروع بنك من شيت» (Round 29) — on «البيانات المرجعية» → «الفروع», beside «إضافة فرع».
//
// The owner: «عاوز اضيف دول فى البيانات المرجعية تبع (الفروع والبنوك والمناطق) ملحوظه هتلاقى area دى
// ضيفها ل منطقة العمليات و منطقة الحسابات تمام ؟» and «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن زى
// بتاع كروت الشحن كدا». A bank's branch sheet is uploaded, COMPARED with the branches the bank holds
// (nothing is written), and written only on «تأكيد الاستيراد» — the fuel-card sheet's flow.
//
// What the owner decided, each in force here:
//   1. The operator picks the BANK; the sheet does not name it.
//   2. The sheet's area goes into BOTH «منطقة العمليات» and «منطقة الحسابات». An area «المناطق» does
//      not hold is CREATED there, the Arabic name in `name` and the English in `nameEn` («فى خانة
//      العربى اكتبها عربي وفى خانة الانجليزى اكتبها انجليزى»); one it holds (its Arabic name folded
//      as the crew board folds it — `foldOperationsAreaName` — or its English name without case) is
//      reused in ITS spelling, and its empty `nameEn` is filled from the sheet.
//   3. A branch the bank holds by NAME (tidied — `tidyOperationsBranchName`) takes the sheet's code
//      and area («حدّث الكود والمنطقة»); a cell the sheet leaves empty never wipes what is held. The
//      address is set on a new branch, and on a held one only when it has none. A NEW row whose name
//      is a held branch's in another spelling («ى/ي», «ة/ه», «أ/ا») stays new, and is marked
//      (`similarTo`) for the operator to see before confirming (Round 29 critic).
//   4. A code repeated in the bank («ضيف رقم بعد الكود»): the first branch keeps it, each further one
//      takes «-2», «-3», … — skipping a suffix any branch of the bank already uses (a held branch keeps
//      its code; the sheet's row takes the next free one). A placeholder such as «0» likewise.
//   5. Names are stored tidied; an area cell without a letter («ــــــ») is no area; a code is the
//      TEXT the cell shows («084» stays «084»). An «Area» cell in Arabic letters is never an English
//      name: it is the Arabic one.
//
// `POST /operations/bank-branches/import/compare` and `…/import/apply` (multipart: the `.xlsx` under
// `file`, beside these fields) — `operationsCatalog.manage`, the grant every write of the
// reference data already needs. The apply posts the SAME file again with the compare's
// `fileSha256` and `planDigest`: the server reads it again, plans again, and writes nothing (409
// `OPERATIONS_BRANCH_IMPORT_CHANGED`) unless the plan is the one the reader looked at. Then
// everything is written in ONE transaction — the new areas first, then the branches — and audited
// as the catalog's own add and edit are.
import { z } from 'zod';
import { objectId } from '../common/index.js';
import { foldOperationsAreaName } from './operations.js';

/** The largest sheet accepted, in MB — the fuel-card sheet's cap. */
export const OPERATIONS_BRANCH_IMPORT_MAX_MB = 10;
/** The most branch rows one sheet may hold (blank rows not counted) — the fuel-card sheet's cap. */
export const OPERATIONS_BRANCH_IMPORT_MAX_ROWS = 5_000;

/**
 * The columns the reader binds, by their HEADER (synonyms below); any other column («م»,
 * «التكلفة») is never read. Only `name` is required.
 */
export const OPERATIONS_BRANCH_IMPORT_ROLES = [
  'name',
  'code',
  'areaAr',
  'areaEn',
  'address',
] as const;
export type OperationsBranchImportRole = (typeof OPERATIONS_BRANCH_IMPORT_ROLES)[number];

/**
 * Each role's headers, FOLDED by `foldSheetHeader` (lower case, «أ إ آ» → «ا», «ة» → «ه», «ى» → «ي»,
 * no tatweel, no spaces or `. _ - : / ( )`): «المنطقة (عربي)» → `المنطقهعربي`.
 */
export const OPERATIONS_BRANCH_IMPORT_SYNONYMS: Readonly<
  Record<OperationsBranchImportRole, readonly string[]>
> = {
  name: ['اسمالفرع', 'الفرع', 'branches', 'branch', 'branchname'],
  code: ['رقمالفرع', 'الكود', 'كودالفرع', 'code', 'branchcode'],
  areaAr: ['المنطقه', 'المنطقهعربي'],
  areaEn: ['area', 'areaenglish', 'المنطقهانجليزي'],
  address: ['عنوانالفرع', 'العنوان', 'address'],
};

/**
 * A branch name as it is stored and compared: trimmed, every run of spaces one space, the tatweel
 * «ـ» dropped («فـــرع  المعادي» → «فرع المعادي»). Also an area's and an address's text.
 */
export const tidyOperationsBranchName = (text: string): string =>
  text.replace(/ـ/gu, '').replace(/\s+/gu, ' ').trim();

/** What two branch names are matched on: tidied, and Latin letters without case. */
export const operationsBranchNameKey = (text: string): string =>
  tidyOperationsBranchName(text).toLocaleLowerCase('en');

/**
 * Two branch names that may be one branch spelt two ways — folded as the crew board folds an area
 * (`foldOperationsAreaName`: «أ إ آ» → «ا», «ى» → «ي», «ة» → «ه», tashkeel, Arabic-Indic digits, a
 * leading «ال»). Never a match (rule 3 matches on `operationsBranchNameKey`): only a mark.
 */
export const operationsBranchNameLookalikeKey = (text: string): string =>
  foldOperationsAreaName(tidyOperationsBranchName(text));

/** The code a repeated code takes — «116» → «116-2», «116-3». */
export const suffixedOperationsBranchCode = (code: string, n: number): string => `${code}-${n}`;

/** What the import does with a row of the sheet. */
export const OPERATIONS_BRANCH_IMPORT_OUTCOMES = ['new', 'update', 'unchanged', 'problem'] as const;
export type OperationsBranchImportOutcome = (typeof OPERATIONS_BRANCH_IMPORT_OUTCOMES)[number];

/**
 * Why a row is not written:
 *   · `noName` — the row has a code, an area or an address, and no branch name;
 *   · `nameIsDate` — the name cell holds a DATE (Excel turned a name such as «3 فبراير» into one), so
 *     the name as typed is lost — retype it as text;
 *   · `duplicateName` — an earlier row of the sheet names the same branch;
 *   · `ambiguousName` — the bank holds two branches whose names tidy to this one;
 *   · `noCode` — a NEW branch with no code (a held branch keeps its own).
 */
export const OPERATIONS_BRANCH_IMPORT_PROBLEMS = [
  'noName',
  'nameIsDate',
  'duplicateName',
  'ambiguousName',
  'noCode',
] as const;
export type OperationsBranchImportProblem = (typeof OPERATIONS_BRANCH_IMPORT_PROBLEMS)[number];

/**
 * Why the area a row writes is not the sheet's pair as it stands (Round 29 critic):
 *   · `byEnglish` — the row's Arabic area is no area «المناطق» holds or this import creates, but its
 *     English name is one's: that area is written, in its own spelling — not the row's Arabic;
 *   · `englishElsewhere` — the row's Arabic area is one area and its English name ANOTHER's: the
 *     Arabic one is written, and its empty English name is not filled with the other's.
 */
export const OPERATIONS_BRANCH_IMPORT_AREA_NOTES = ['byEnglish', 'englishElsewhere'] as const;
export type OperationsBranchImportAreaNote = (typeof OPERATIONS_BRANCH_IMPORT_AREA_NOTES)[number];

/** A held branch a «جديد» row may be, spelt another way (`operationsBranchNameLookalikeKey`). */
export interface OperationsBranchImportSimilarDto {
  branchId: string;
  name: string;
  code: string;
}

/** The fields an update changes on a held branch. */
export const OPERATIONS_BRANCH_IMPORT_FIELDS = [
  'code',
  'opsAreaName',
  'financeAreaName',
  'address',
] as const;
export type OperationsBranchImportField = (typeof OPERATIONS_BRANCH_IMPORT_FIELDS)[number];

/** A branch's importable fields, as held or as they will be written. */
export interface OperationsBranchImportValuesDto {
  code: string | null;
  opsAreaName: string | null;
  financeAreaName: string | null;
  address: string | null;
}

export interface OperationsBranchImportRowDto {
  /** The sheet's own row number. */
  row: number;
  /** The branch name, tidied — the held branch's own name on an update; null when the row has none. */
  name: string | null;
  /** The code as the sheet shows it; null when empty. */
  sheetCode: string | null;
  /** The area as the sheet gives it (tidied; null when empty or without a letter). */
  sheetArea: { ar: string | null; en: string | null };
  /** The address as the sheet gives it (tidied). */
  sheetAddress: string | null;
  outcome: OperationsBranchImportOutcome;
  problem: OperationsBranchImportProblem | null;
  /** The held branch an update or an unchanged row is; null for a new row or a problem. */
  branchId: string | null;
  /** The held branch is stopped («موقوف») — it is updated all the same, and stays stopped. */
  inactive: boolean;
  /** The held branch's values; null for a new row or a problem. */
  before: OperationsBranchImportValuesDto | null;
  /** The values written (new) or held after the write (update, unchanged); null for a problem. */
  after: OperationsBranchImportValuesDto | null;
  /** What an update changes, in `OPERATIONS_BRANCH_IMPORT_FIELDS` order; [] otherwise. */
  changes: OperationsBranchImportField[];
  /**
   * The branch's code is the sheet's with a suffix («116» → «116-2») — written now (a new row, an
   * update of the code: `isOperationsBranchImportSuffixedWrite`), or already held so (unchanged).
   */
  codeSuffixed: boolean;
  /**
   * The area written is one this import creates from Latin letters only: its English name stands
   * for the Arabic one too. A Latin-only cell whose English another row gives in Arabic takes that
   * Arabic, whichever row comes first — it is not Latin-only then.
   */
  areaLatinOnly: boolean;
  /** The row's area is one the import creates. */
  areaIsNew: boolean;
  /** Why the area written is not the sheet's own pair; null when it is. */
  areaNote: OperationsBranchImportAreaNote | null;
  /** A «جديد» row only: the held branch it may be, spelt another way; null otherwise. */
  similarTo: OperationsBranchImportSimilarDto | null;
}

/**
 * «كود معدَّل» as the import WRITES it: a new branch's suffixed code, or a held branch's code changed
 * to a suffixed one — never a held branch that already carries its suffix and is written nothing.
 */
export const isOperationsBranchImportSuffixedWrite = (
  row: Pick<OperationsBranchImportRowDto, 'codeSuffixed' | 'outcome' | 'changes'>,
): boolean =>
  row.codeSuffixed &&
  (row.outcome === 'new' || (row.outcome === 'update' && row.changes.includes('code')));

/** An area «المناطق» will hold after the import. */
export interface OperationsBranchImportNewAreaDto {
  name: string;
  nameEn: string | null;
  /** The rows of the sheet that name it. */
  rows: number;
  /** Its English name stands for the Arabic one too: the sheet gave it in Latin letters only. */
  latinOnly: boolean;
}

/** A held area whose empty English name the sheet fills. */
export interface OperationsBranchImportFilledAreaDto {
  id: string;
  name: string;
  nameEn: string;
}

export interface OperationsBranchImportLayoutColumnDto {
  role: OperationsBranchImportRole;
  /** «A», «B», … */
  column: string;
  /** The header as printed. */
  header: string;
}

export interface OperationsBranchImportCountsDto {
  /** Branch rows read (blank rows and rows with only a serial are not). */
  rows: number;
  new: number;
  update: number;
  unchanged: number;
  problem: number;
  /** «كود معدَّل» — the rows whose suffixed code this import writes (`isOperationsBranchImportSuffixedWrite`). */
  suffixed: number;
  areasNew: number;
  areasFilled: number;
  /** «جديد» rows marked `similarTo`. */
  similar: number;
  /** Rows with an `areaNote`. */
  areaNotes: number;
}

export interface OperationsBranchImportCompareDto {
  bankId: string;
  /** The bank's operations name («بنك مصر»). */
  bankName: string;
  fileName: string;
  fileSha256: string;
  /** The plan itself, hashed — what `…/import/apply` must send back. */
  planDigest: string;
  /** The tab read — the first visible one. */
  sheetName: string;
  /** The header's row number. */
  headerRow: number;
  layout: OperationsBranchImportLayoutColumnDto[];
  counts: OperationsBranchImportCountsDto;
  /** Every branch row, in the sheet's order. */
  rows: OperationsBranchImportRowDto[];
  newAreas: OperationsBranchImportNewAreaDto[];
  filledAreas: OperationsBranchImportFilledAreaDto[];
}

/** What an apply wrote. */
export interface OperationsBranchImportAppliedDto {
  bankId: string;
  branchesCreated: number;
  branchesUpdated: number;
  unchanged: number;
  /** Rows not written (`problem`). */
  problems: number;
  areasCreated: number;
  areasFilled: number;
}

/** The compare's multipart fields (beside `file`). */
export const CompareOperationsBranchImportSchema = z.object({ bankId: objectId() }).strict();
export type CompareOperationsBranchImport = z.infer<typeof CompareOperationsBranchImportSchema>;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/u, 'a SHA-256 in lower-case hex');

/** The apply's multipart fields (beside the SAME `file`): the compare's hashes come back. */
export const ApplyOperationsBranchImportSchema = z
  .object({ bankId: objectId(), fileSha256: sha256Hex, planDigest: sha256Hex })
  .strict();
export type ApplyOperationsBranchImport = z.infer<typeof ApplyOperationsBranchImportSchema>;
