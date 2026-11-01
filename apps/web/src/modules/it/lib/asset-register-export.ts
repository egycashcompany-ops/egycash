// The asset register as a file — «اعمل نفس الزرارين في شاشة الأصول»: the custody register's Excel
// and PDF, on the asset list. What the two share is `register-export.ts`; this is what the asset
// table says. The columns are the table's, in its order: the code, the name, the category, the
// serial, the branch, the status and — «بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة» — the
// holder, with the code the table stacks under the name given a column of its own, as in the
// custody register's file: in a sheet a code is something to filter by, not a caption.
import { type ItAssetDto, type ItAssetStatus } from '@ecms/contracts';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';

export interface AssetRegisterContext {
  t: Translate;
  /** Category id → its name, as the table resolves it. */
  categoryName: ReadonlyMap<string, string>;
  /** Branch id → its name, as the table resolves it. */
  branchName: ReadonlyMap<string, string>;
}

/** The heading row, in the table's order. */
export const assetRegisterHeader = (t: Translate): string[] => [
  t('it.assets.columns.code'),
  t('it.assets.columns.name'),
  t('it.assets.columns.category'),
  t('it.assets.columns.serial'),
  t('it.assets.columns.branch'),
  t('it.assets.columns.status'),
  t('it.custody.holder'),
  t('it.custody.export.holderCode'),
];

/**
 * One asset as a line of the file. `empty` is what a blank cell holds: nothing in the sheet, «—»
 * on paper — the table's own dash for a serial it does not have, a name it cannot resolve, or an
 * asset nobody holds.
 */
export const assetRegisterLine = (
  row: ItAssetDto,
  { t, categoryName, branchName }: AssetRegisterContext,
  empty: string,
): string[] => [
  row.assetCode,
  row.name,
  categoryName.get(row.categoryId) ?? empty,
  row.serialNumber ?? empty,
  branchName.get(row.branchId) ?? empty,
  t(`it.assets.status.${row.status}`),
  // The table's own fallback: a holder HR cannot name is written by the id the row carries.
  row.holder === null ? empty : (row.holder.employeeName ?? row.holder.employeeId),
  row.holder?.employeeCode ?? empty,
];

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface AssetRegisterFilters {
  search: string | null;
  status: ItAssetStatus | null;
  /** The name picked from the register's own names. */
  name: string | null;
  /** `''` when a category is set but its name is not among the options. */
  category: string | null;
  /** `''` when a branch is set but its name is not among the options. */
  branch: string | null;
  holder: string | null;
}

/**
 * The screen's filters, named for paper. A filter in force is never dropped: a category or a
 * branch whose name cannot be had prints as «فئة محددة» / «فرع محدد», and a holder as the chip's
 * label (name and code), the gathered rows' own name for them (every row is theirs), or, failing
 * both, the id.
 */
export const assetRegisterFilters = ({
  search,
  status,
  name,
  categoryId,
  categoryName,
  branchId,
  branchName,
  holderId,
  holderLabel,
  rows,
}: {
  search: string;
  status: string;
  name: string;
  categoryId: string;
  categoryName: ReadonlyMap<string, string>;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  holderId: string;
  holderLabel: string;
  rows: readonly ItAssetDto[];
}): AssetRegisterFilters => ({
  search: search.trim() === '' ? null : search.trim(),
  status: status === '' ? null : (status as ItAssetStatus),
  name: name === '' ? null : name,
  category: categoryId === '' ? null : (categoryName.get(categoryId) ?? ''),
  branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
  holder:
    holderId === ''
      ? null
      : holderLabel ||
        rows.find((row) => row.holder?.employeeId === holderId)?.holder?.employeeName ||
        holderId,
});

/**
 * What the printed page is a view OF, under its title: the status, the name, the category, the
 * branch, the holder and the search when they are set — in the filter bar's order — and the day it
 * was taken.
 */
export const assetRegisterSubtitle = (
  t: Translate,
  filters: AssetRegisterFilters & { asOf: string },
): string =>
  filterLine([
    filters.status === null ? t('it.assets.allStatuses') : t(`it.assets.status.${filters.status}`),
    filters.name === null ? null : t('it.export.nameIs', { name: filters.name }),
    namedFilter(t, filters.category, {
      all: 'it.assets.allCategories',
      one: 'it.export.oneCategory',
    }),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.holder === null ? null : t('it.export.holderIs', { name: filters.holder }),
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/**
 * The printed register: the company's report form, landscape for eight columns (the holder and
 * their code joined the six that fit portrait), nobody signs it.
 */
export const assetRegisterReport = (
  rows: readonly ItAssetDto[],
  context: AssetRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.nav.assets'),
    header: assetRegisterHeader(context.t),
    rows: rows.map((row) => assetRegisterLine(row, context, '—')),
    subtitle,
    orientation: 'landscape',
  });
