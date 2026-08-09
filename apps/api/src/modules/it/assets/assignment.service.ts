// Assignment reads (design §2.5, §12). Writes live in `custody.service` — the intervals are only
// ever created and closed by a custody transition, never edited directly, which is why there is no
// create/update here at all.
import { type ListItAssignmentsQuery, type Paginated } from '@ecms/contracts';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { itAssetRepository } from './asset.repository';
import { itAssetAssignmentRepository } from './assignment.repository';
import { type ItAssetAssignmentDoc } from './assignment.model';

class ItAssetAssignmentService {
  /** The cross-asset custody register. Branch-scoped like everything else in the module. */
  async list(
    query: ListItAssignmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItAssetAssignmentDoc>> {
    return itAssetAssignmentRepository.listFiltered({
      open: query.open,
      assetId: query.assetId,
      employeeId: query.employeeId,
      branchId: query.branchId,
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
