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
