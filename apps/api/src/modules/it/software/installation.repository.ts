import { Types, type ClientSession } from 'mongoose';
import { type ListItSoftwareInstallationsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { ItSoftwareInstallationModel, type ItSoftwareInstallationDoc } from './installation.model';

class ItSoftwareInstallationRepository extends BaseRepository<ItSoftwareInstallationDoc> {
  constructor() {
    // Branch-scoped through the asset's own anchor, denormalized at creation — the
    // `it_asset_assignments` precedent, and the same one the maintenance order now follows.
    super(ItSoftwareInstallationModel, { branchField: 'branchId' });
  }

  async getByIdForUpdate(
    id: string,
    scope: ScopeSelector | undefined,
    session: ClientSession,
  ): Promise<ItSoftwareInstallationDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError();
    const doc = await this.model
      .findOne(this.baseFilter(scope, { _id: new Types.ObjectId(id) }))
      .session(session)
      .lean<ItSoftwareInstallationDoc>()
      .exec();
    if (doc === null) throw new NotFoundError();
    return doc;
  }

  async listFiltered(
    query: ListItSoftwareInstallationsQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<ItSoftwareInstallationDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.assetId !== undefined) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.productId !== undefined) filter.productId = new Types.ObjectId(query.productId);
    if (query.licenseId !== undefined) filter.licenseId = new Types.ObjectId(query.licenseId);
    // "Active" reads `removedAt`, never a stored status — the row's open end IS its state.
    if (query.active === true) filter.removedAt = null;
    if (query.active === false) filter.removedAt = { $ne: null };
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['installedAt', 'removedAt', 'createdAt'],
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /**
   * `seatsUsed` for many licenses in ONE round trip (FR-10).
   *
   * The per-row alternative would be a query per license on every list render, which is exactly
   * how a derived number ends up getting stored "for performance" and then drifting. Backed by
   * `ix_license_active`.
   *
   * Deliberately UNSCOPED: a licence's seat count is a company fact. Showing a branch-scoped
   * reader a smaller number would not be a narrower view, it would be a wrong one.
   */
  async countActiveByLicense(licenseIds: readonly Types.ObjectId[]): Promise<Map<string, number>> {
    if (licenseIds.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { licenseId: { $in: [...licenseIds] }, removedAt: null, isDeleted: false } },
        { $group: { _id: '$licenseId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  /** One licence's live seat count, for the write path that has to decide whether to warn. */
  async countActiveForLicense(licenseId: Types.ObjectId, session?: ClientSession): Promise<number> {
    const query = this.model.countDocuments({ licenseId, removedAt: null, isDeleted: false });
    if (session !== undefined) query.session(session);
    return query.exec();
  }

  /** Does any installation reference this product? The FR-11 archive-not-delete guard's question. */
  async existsForProduct(productId: Types.ObjectId): Promise<boolean> {
    return this.exists({ productId });
  }
}

export const itSoftwareInstallationRepository = new ItSoftwareInstallationRepository();
