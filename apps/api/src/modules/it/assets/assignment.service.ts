// Assignment reads (design §2.5, §12). Writes live in `custody.service` — the intervals are only
// ever created and closed by a custody transition, never edited directly, which is why there is no
// create/update here at all.
import { Types, type FilterQuery } from 'mongoose';
import { type ListItAssignmentsQuery, type Paginated } from '@ecms/contracts';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { getDirectoryEmployees, type DirectoryEmployee } from '../../../platform/directory';
import { registerSearchPattern } from '../shared/register-search';
import { itAssetRepository } from './asset.repository';
import { type ItAssetDoc } from './asset.model';
import {
  assignmentRegisterFilter,
  itAssetAssignmentRepository,
  type ItAssignmentRegisterFilter,
} from './assignment.repository';
import { type ItAssetAssignmentDoc } from './assignment.model';
import { itCustodyReceiptRepository } from './receipt.repository';

/**
 * The register's filters that are facts of the ASSET rather than of the interval — the categories,
 * «الصنف» and the free-text search — as ONE filter over the assets (each one that is set ANDed with
 * the others), or `null` when none is set.
 *
 * «وفى /it/custody بردو عايز الصنف يبقي بعد الفئة ... والأتنين يكونوا Multiselect»: the categories
 * and «الصنف» each take several values — an asset in ANY chosen category, by ANY chosen name. A name
 * is one the asset register's name filter offers (`GET /it/assets/names`), so it is matched
 * EXACTLY, never as a part of a longer name.
 *
 * The search is the asset's code, name or serial, matched wherever it occurs, letter case ignored
 * and the reader's characters taken literally. A name or a serial is kept as it was typed, in
 * whichever digit set, so a digit matches its value in every set (`registerSearchPattern`): «٢٤» and
 * "24" both find «شاشة ٢٤ بوصة» and «شاشة 24 بوصة».
 */
export const registerAssetFilter = (
  query: Pick<ListItAssignmentsQuery, 'search' | 'categoryId' | 'assetName'>,
): FilterQuery<ItAssetDoc> | null => {
  const filter: FilterQuery<ItAssetDoc> = {};
  if (query.categoryId !== undefined) {
    filter.categoryId = { $in: query.categoryId.map((id) => new Types.ObjectId(id)) };
  }
  if (query.assetName !== undefined) filter.name = { $in: query.assetName };
  const pattern = registerSearchPattern(query.search ?? '');
  if (pattern !== null) {
    filter.$or = [{ assetCode: pattern }, { name: pattern }, { serialNumber: pattern }];
  }
  return Object.keys(filter).length === 0 ? null : filter;
};

/**
 * The receipt filter, with the signed papers read for it — and read only when the answer needs
 * them: «بدون إيصال» is a fact of the interval alone.
 */
const receiptFilter = async (
  state: ListItAssignmentsQuery['receipt'],
): Promise<ItAssignmentRegisterFilter['receipt']> => {
  if (state === undefined) return undefined;
  if (state === 'none') return { state };
  return { state, signedReceiptIds: await itCustodyReceiptRepository.signedIds() };
};

/**
 * Which of these holders HR shows as having left — FR-13's «assets held by exited employees».
 *
 * Judged live on the directory's answer and never stored: the exit subscription records the fact
 * for the checklist, it marks no interval, and a person's status is HR's to keep. It counts a
 * POSITIVE answer only — an id the directory does not know is not a leaver, because nothing says
 * they left (the hand-over's `refuseLeaver` rule).
 */
export const exitedHolderIds = (
  holderIds: Iterable<string>,
  directory: ReadonlyMap<string, Pick<DirectoryEmployee, 'status'>>,
): Types.ObjectId[] =>
  [...holderIds]
    .filter((id) => Types.ObjectId.isValid(id) && directory.get(id)?.status === 'exited')
    .map((id) => new Types.ObjectId(id));

/**
 * The leavers among the holders of the intervals a filter matches, and how many of those
 * intervals they hold. Two reads whatever the size: the holders in one `$group`, then HR about all
 * of them in one directory batch — and HR is asked nothing when nobody holds anything.
 *
 * Shared by the register's «حالة المستلِم» and the dashboard's «أصول مع موظفين تركوا العمل», so the
 * figure on the dashboard is the number of rows the register opens with.
 */
export const leaverHoldings = async (
  filter: FilterQuery<ItAssetAssignmentDoc>,
  scope: ScopeSelector,
): Promise<{ exitedEmployeeIds: Types.ObjectId[]; intervals: number }> => {
  const holders = await itAssetAssignmentRepository.countByHolder(filter, scope);
  const directory =
    holders.size === 0
      ? new Map<string, DirectoryEmployee>()
      : await getDirectoryEmployees([...holders.keys()]);
  const exitedEmployeeIds = exitedHolderIds(holders.keys(), directory);
  return {
    exitedEmployeeIds,
    intervals: exitedEmployeeIds.reduce((sum, id) => sum + (holders.get(String(id)) ?? 0), 0),
  };
};

class ItAssetAssignmentService {
  /**
   * The cross-asset custody register. Branch-scoped like everything else in the module.
   *
   * «زود الفلتر بتاع الجدول ببيانات الجدول» — a filter for each of the table's columns. The ones
   * that are facts of something ELSE name a set, and each set is read ONCE, side by side, before
   * the page is: the assets the categories, «الصنف» and the search match together (under the
   * caller's scope, the way the row's own asset label is read — a reader cannot find an interval by
   * an asset they cannot see), and the receipts that are signed. Never a read per row.
   *
   * «حالة المستلِم» comes last because it is a fact of HR's: the holders of the intervals every
   * OTHER filter keeps are read once, and HR asked about those alone — so the directory batch is as
   * small as the reader's question makes it.
   */
  async list(
    query: ListItAssignmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItAssetAssignmentDoc>> {
    const assetFilter = registerAssetFilter(query);
    const [assetIds, receipt] = await Promise.all([
      assetFilter === null ? undefined : itAssetRepository.idsMatching(assetFilter, scope),
      receiptFilter(query.receipt),
    ]);
    const now = new Date();
    const filters: ItAssignmentRegisterFilter = {
      open: query.open,
      assetId: query.assetId,
      assetIds,
      employeeId: query.employeeId,
      branchId: query.branchId,
      assignedFrom: query.assignedFrom,
      assignedTo: query.assignedTo,
      returnedFrom: query.returnedFrom,
      returnedTo: query.returnedTo,
      overdue: query.overdue,
      receipt,
    };
    const holderExited =
      query.holderExited === undefined
        ? undefined
        : {
            exited: query.holderExited,
            exitedEmployeeIds: (await leaverHoldings(assignmentRegisterFilter(filters, now), scope))
              .exitedEmployeeIds,
          };
    return itAssetAssignmentRepository.listFiltered({
      ...filters,
      holderExited,
      now,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  /**
   * One asset's custody intervals, newest first.
   *
   * The asset is read first, under the same scope, so this obeys exactly the authorization the
   * asset does — a branch-scoped caller cannot read another branch's custody chain by knowing an
   * id, and an unknown id 404s rather than answering with an empty page.
   */
  async listForAsset(
    assetId: string,
    query: ListItAssignmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItAssetAssignmentDoc>> {
    const asset = await itAssetRepository.findById(assetId, scope);
    if (asset === null) throw new NotFoundError('asset not found');
    return itAssetAssignmentRepository.listFiltered({
      assetId,
      open: query.open,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'assignedAt',
      sortDir: query.sortDir ?? 'desc',
    });
  }
}

export const itAssetAssignmentService = new ItAssetAssignmentService();
