// «استيراد فروع من شيت» (Round 29) — what the comparison screen decides, pure, for its spec: which
// rows a filter and a search show, the filters' counts, whether «تأكيد الاستيراد» has anything to
// write, and the words of a refusal.
import {
  ErrorCodes,
  type OperationsBranchImportCompareDto,
  type OperationsBranchImportRowDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';

/** The table's filters — the outcomes, and «كود معدَّل» across them. */
export const BRANCH_IMPORT_FILTERS = [
  'all',
  'new',
  'update',
  'unchanged',
  'suffixed',
  'problem',
] as const;
export type BranchImportFilter = (typeof BRANCH_IMPORT_FILTERS)[number];

const inFilter = (row: OperationsBranchImportRowDto, filter: BranchImportFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'suffixed') return row.codeSuffixed;
  return row.outcome === filter;
};

/** Search text as compared: Latin without case, Arabic «أ إ آ» as «ا», «ة» as «ه», «ى» as «ي». */
const fold = (text: string): string =>
  text
    .toLocaleLowerCase('en')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ة/gu, 'ه')
    .replace(/ى/gu, 'ي')
    .replace(/ـ/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

/** Every text of the row a search may hit: name, codes, areas, address, row number. */
const haystackOf = (row: OperationsBranchImportRowDto): string =>
  fold(
    [
      String(row.row),
      row.name,
      row.sheetCode,
      row.after?.code,
      row.before?.code,
      row.sheetArea.ar,
      row.sheetArea.en,
      row.after?.opsAreaName,
      row.sheetAddress,
    ]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' '),
  );

export const visibleRows = (
  rows: readonly OperationsBranchImportRowDto[],
  filter: BranchImportFilter,
  search: string,
): OperationsBranchImportRowDto[] => {
  const wanted = fold(search);
  return rows.filter(
    (row) => inFilter(row, filter) && (wanted === '' || haystackOf(row).includes(wanted)),
  );
};

export const filterCounts = (
  dto: OperationsBranchImportCompareDto,
): Record<BranchImportFilter, number> => ({
  all: dto.counts.rows,
  new: dto.counts.new,
  update: dto.counts.update,
  unchanged: dto.counts.unchanged,
  suffixed: dto.counts.suffixed,
  problem: dto.counts.problem,
});

/** Whether «تأكيد الاستيراد» would write anything at all. */
export const writesAnything = (dto: OperationsBranchImportCompareDto): boolean =>
  dto.counts.new + dto.counts.update + dto.counts.areasNew + dto.counts.areasFilled > 0;

/** The comparison is out of date — the bank, the areas or the file moved since it was made. */
export const isOutOfDate = (error: unknown): boolean =>
  error instanceof ApiError &&
  (error.code === ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED ||
    error.code === ErrorCodes.STALE_DOCUMENT ||
    error.code === ErrorCodes.DUPLICATE);

const P = 'operations.catalogs.branchImport.refusal.';

/**
 * The catalog key that words a refusal of either call, or null for one the screen has no words of
 * its own for (the shared `errorMessage` speaks then).
 */
export const refusalKeyOf = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  const detail = error.details?.[0]?.code;
  if (error.code === ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT) {
    if (detail === 'TOO_LARGE') return `${P}tooLarge`;
    if (detail === 'MISSING_SHEET') return `${P}noSheet`;
    return `${P}noHeader`;
  }
  if (error.code === ErrorCodes.FILE_TOO_LARGE) return `${P}fileTooLarge`;
  if (error.code === ErrorCodes.VALIDATION_FAILED && detail === 'UNREADABLE') {
    return `${P}unreadable`;
  }
  if (error.code === ErrorCodes.OPERATIONS_UNKNOWN_BANK) return `${P}unknownBank`;
  if (isOutOfDate(error)) return `${P}changed`;
  return null;
};
