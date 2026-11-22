// The asset register as a file — «اعمل نفس الزرارين في شاشة الأصول»: the custody register's Excel
// and PDF, on the asset list. What the two share is `register-export.ts`; this is what the asset
// table says. The columns are the table's, in its order: the code, the name, the category, the
// serial, the branch, the status and — «بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة» — the
// holder, with the code the table stacks under the name given a column of its own, as in the
// custody register's file: in a sheet a code is something to filter by, not a caption. A device a
// DEPARTMENT holds (2026-11-19) writes «إدارة …» as its holder, and its place and who signed for it
// in two columns of their own — «الموقع» and «المسؤول» — blank for an employee's.
import { type ItAssetDto, type ItAssetStatus, type Locale } from '@ecms/contracts';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import {
  holderCode,
  holderMain,
  holderOfAsset,
  locationText,
  responsibleText,
} from './custody-holder';
import {
  filterLine,
  itRegisterReport,
  namedFilter,
  namedFilters,
  namesPhrase,
  type Translate,
} from './register-export';

export interface AssetRegisterContext {
  t: Translate;
  /** A department's and a place's name are written in the reader's language. */
  locale: Locale;
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
  t('it.custody.department.location'),
  t('it.custody.department.responsible'),
];

/**
 * One asset as a line of the file. `empty` is what a blank cell holds: nothing in the sheet, «—»
 * on paper — the table's own dash for a serial it does not have, a name it cannot resolve, or an
 * asset nobody holds.
 */
export const assetRegisterLine = (
  row: ItAssetDto,
  { t, locale, categoryName, branchName }: AssetRegisterContext,
  empty: string,
): string[] => {
  const holder = row.holder === null ? null : holderOfAsset(row.holder);
  const department = holder?.kind === 'department';
  return [
    row.assetCode,
    row.name,
    categoryName.get(row.categoryId) ?? empty,
    row.serialNumber ?? empty,
    branchName.get(row.branchId) ?? empty,
    t(`it.assets.status.${row.status}`),
    // The table's own fallback: a holder HR cannot name is written by the id the row carries.
    holder === null ? empty : holderMain(holder, locale, t),
    (holder === null ? null : holderCode(holder)) ?? empty,
    holder !== null && department ? locationText(holder, locale) : empty,
    holder !== null && department ? responsibleText(holder) : empty,
  ];
};

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface AssetRegisterFilters {
  search: string | null;
  status: ItAssetStatus | null;
  /** The categories chosen, by name — `''` for one set but not among the options. */
  categories: string[] | null;
  /** The names picked from the register's own names, in the order they were picked. */
  names: string[] | null;
  /** `''` when a branch is set but its name is not among the options. */
  branch: string | null;
  holder: string | null;
  /** «جهة الاستلام» — held by an employee, or by a department; null when not set. */
  holderKind: 'employee' | 'department' | null;
  /** «الإدارة» / «الموقع» by name — `''` for one set but not among the options. */
  department: string | null;
  location: string | null;
  /** «الضمان» — the window as the bar words it («ينتهي خلال ٣٠ يومًا»). */
  warranty: string | null;
}

/**
 * The screen's filters, named for paper. A filter in force is never dropped: a category or a
 * branch whose name cannot be had prints as «فئة محددة» / «فرع محدد», and a holder as the chip's
 * label (name and code), the gathered rows' own name for them (every row is theirs), or, failing
 * both, the id. Every category and every name chosen is named — the request asked for all of them.
 */
export const assetRegisterFilters = ({
  search,
  status,
  names,
  categoryIds,
  categoryName,
  branchId,
  branchName,
  holderId,
  holderLabel,
  holderKind = '',
  departmentId = '',
  departmentName,
  locationId = '',
  locationName,
  warranty,
  rows,
}: {
  search: string;
  status: string;
  names: readonly string[];
  categoryIds: readonly string[];
  categoryName: ReadonlyMap<string, string>;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  holderId: string;
  holderLabel: string;
  /** «جهة الاستلام» — the screen's `holderKind` param, '' when not set. */
  holderKind?: string;
  departmentId?: string;
  /** Department id → «تقنية المعلومات — أسيوط», as the filter's select names it. */
  departmentName?: ReadonlyMap<string, string>;
  locationId?: string;
  /** Place id → its name, as the filter's select names it. */
  locationName?: ReadonlyMap<string, string>;
  /** The warranty window in the bar's words (`warrantyWithin`), `''` when not set. */
  warranty: string;
  rows: readonly ItAssetDto[];
}): AssetRegisterFilters => ({
  search: search.trim() === '' ? null : search.trim(),
  status: status === '' ? null : (status as ItAssetStatus),
  categories: categoryIds.length === 0 ? null : categoryIds.map((id) => categoryName.get(id) ?? ''),
  names: names.length === 0 ? null : [...names],
  branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
  holder:
    holderId === ''
      ? null
      : holderLabel ||
        rows.find((row) => row.holder?.employeeId === holderId)?.holder?.employeeName ||
        holderId,
  holderKind: holderKind === 'employee' || holderKind === 'department' ? holderKind : null,
  department: departmentId === '' ? null : (departmentName?.get(departmentId) ?? ''),
  location: locationId === '' ? null : (locationName?.get(locationId) ?? ''),
  warranty: warranty === '' ? null : warranty,
});

/**
 * What the printed page is a view OF, under its title: the status, the categories, the names, the
 * branch, the holder, the warranty window and the search when they are set — the filter bar's
 * order, the names right after the categories they were picked from — and the day it was taken.
 */
export const assetRegisterSubtitle = (
  t: Translate,
  filters: AssetRegisterFilters & { asOf: string },
): string => {
  const names = namesPhrase(filters.names);
  return filterLine([
    filters.status === null ? t('it.assets.allStatuses') : t(`it.assets.status.${filters.status}`),
    namedFilters(t, filters.categories, {
      all: 'it.assets.allCategories',
      one: 'it.export.oneCategory',
    }),
    names === null ? null : t('it.export.nameIs', { name: names }),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.holder === null ? null : t('it.export.holderIs', { name: filters.holder }),
    filters.holderKind === null
      ? null
      : t('it.custody.department.export.holderKindIs', {
          kind: t(`it.custody.department.kind.${filters.holderKind}`),
        }),
    filters.department === null
      ? null
      : t('it.custody.department.export.departmentIs', {
          name: filters.department || t('it.custody.department.export.oneDepartment'),
        }),
    filters.location === null
      ? null
      : t('it.custody.department.export.locationIs', {
          name: filters.location || t('it.custody.department.export.oneLocation'),
        }),
    filters.warranty === null ? null : t('it.export.warrantyIs', { within: filters.warranty }),
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);
};

/**
 * The printed register: the company's report form, landscape for ten columns (the holder, their
 * code, a department's place and its signer joined the six that fit portrait), nobody signs it.
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
