// Append-only reads and one write. There is deliberately no update and no delete on this
// repository: `it_asset_events` is a business record (ADR-021), and the absence of those methods
// is the cheapest possible enforcement of that.
import { Types, type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type Paginated } from '@ecms/contracts';
import { ItAssetEventModel, type ItAssetEventDoc } from './asset-event.model';

class ItAssetEventRepository extends BaseRepository<ItAssetEventDoc> {
  constructor() {
    super(ItAssetEventModel);
  }

  /**
   * Append one entry. Always inside the caller's transaction — the event and the state change it
   * describes must land together or not at all (FR-3).
   */
  async append(
    entry: {
      subjectId: Types.ObjectId;
      type: ItAssetEventDoc['type'];
      at: Date;
      actorUserId: Types.ObjectId | null;
      actorName: string;
      metadata: Record<string, unknown>;
      notes: string | null;
    },
    options: { by: string; session?: ClientSession },
  ): Promise<ItAssetEventDoc> {
    return this.create(entry as Partial<ItAssetEventDoc>, options);
  }

  /**
   * The newest entries of these kinds across these assets — the dashboard's «آخر الحركات». The
   * assets are the ones the reader may see, already read under their scope: this collection carries
   * no branch of its own, so WHOSE history may be read is decided by the assets, never here. No
   * assets, no read.
   */
  async latestOfTypes(params: {
    assetIds: readonly Types.ObjectId[];
    types: readonly ItAssetEventDoc['type'][];
    limit: number;
  }): Promise<ItAssetEventDoc[]> {
    if (params.assetIds.length === 0 || params.types.length === 0) return [];
    return (
      this.model
        .find(
          this.baseFilter(undefined, {
            subjectId: { $in: [...params.assetIds] },
            type: { $in: [...params.types] },
          }),
        )
        // `at` alone, which `ix_type_at` serves for each kind: the read stops at `limit` instead of
        // sorting every movement the reader's assets ever had. Two entries of the same instant may
        // come in either order — a list of the newest, not a ledger.
        .sort({ at: -1 })
        .limit(params.limit)
        .lean<ItAssetEventDoc[]>()
        .exec()
    );
  }

  async listForAsset(params: {
    assetId: string;
    type?: string | undefined;
    // Required, not optional: `PaginationQuerySchema` already defaulted them at the boundary, so
    // an undefined here would mean a caller bypassed validation.
    page: number;
    pageSize: number;
  }): Promise<Paginated<ItAssetEventDoc>> {
    const filter: Record<string, unknown> = { subjectId: new Types.ObjectId(params.assetId) };
    if (params.type !== undefined) filter.type = params.type;
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      // History reads newest-first and nothing else — it is a chronology, not a sortable table.
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at'],
    });
  }
}

export const itAssetEventRepository = new ItAssetEventRepository();
