// Assignment reads (design §2.5, §12). Writes live in `custody.service` — the intervals are only
// ever created and closed by a custody transition, never edited directly, which is why there is no
// create/update here at all.
import { Types, type FilterQuery } from 'mongoose';
import { type ListItAssignmentsQuery, type Paginated } from '@ecms/contracts';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { registerSearchPattern } from '../shared/register-search';
import { itAssetRepository } from './asset.repository';
import { type ItAssetDoc } from './asset.model';
import {
  itAssetAssignmentRepository,
  type ItAssignmentRegisterFilter,
} from './assignment.repository';
import { type ItAssetAssignmentDoc } from './assignment.model';
import { itCustodyReceiptRepository } from './receipt.repository';

/**
 * The register's filters that are facts of the ASSET rather than of the interval — «الصنف» and the
 * category — as one filter over the assets, or `null` when neither is set.
 *
 * «الصنف» is the asset's code, name or serial, matched wherever it occurs, letter case ignored and
 * the reader's characters taken literally. A name or a serial is kept as it was typed, in whichever
 * digit set, so a digit matches its value in every set (`registerSearchPattern`): «٢٤» and "24"
 * both find «شاشة ٢٤ بوصة» and «شاشة 24 بوصة».
 */
export const registerAssetFilter = (
  query: Pick<ListItAssignmentsQuery, 'search' | 'categoryId'>,
): FilterQuery<ItAssetDoc> | null => {
  const filter: FilterQuery<ItAssetDoc> = {};
  if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
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

class ItAssetAssignmentService {
  /**
   * The cross-asset custody register. Branch-scoped like everything else in the module.
   *
   * «زود الفلتر بتاع الجدول ببيانات الجدول» — a filter for each of the table's columns. The ones
   * that are facts of something ELSE name a set, and each set is read ONCE, side by side, before
   * the page is: the assets «الصنف» and the category match (under the caller's scope, the way the
   * row's own asset label is read — a reader cannot find an interval by an asset they cannot see),
   * and the receipts that are signed. Never a read per row.
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
    return itAssetAssignmentRepository.listFiltered({
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
      now: new Date(),
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
