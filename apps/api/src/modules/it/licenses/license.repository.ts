import { Types } from 'mongoose';
import { type ListItLicensesQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItLicenseModel, type ItLicenseDoc } from './license.model';

class ItLicenseRepository extends BaseRepository<ItLicenseDoc> {
  constructor() {
    // Company-wide: a licence is bought once and consumed from anywhere, so it carries no branch.
    super(ItLicenseModel, {});
  }

  async listFiltered(query: ListItLicensesQuery): Promise<Paginated<ItLicenseDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.productId !== undefined) filter.productId = new Types.ObjectId(query.productId);
    if (query.vendorId !== undefined) {
      filter['purchase.vendorId'] = new Types.ObjectId(query.vendorId);
    }
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ notes: pattern }, { 'purchase.invoiceRef': pattern }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['expiresAt', 'seats', 'createdAt'],
    });
  }

  /**
   * Licenses whose expiry falls at or before `cutoff`. Backed by `ix_expires`, which is sparse —
   * a perpetual licence has no date and belongs in no expiry scan, so it never enters the index.
   */
  async findExpiringBefore(cutoff: Date, limit: number): Promise<ItLicenseDoc[]> {
    return this.model
      .find({ isDeleted: false, expiresAt: { $ne: null, $lte: cutoff } })
      .limit(limit)
      .lean<ItLicenseDoc[]>()
      .exec();
  }

  /** Does any licence reference this product? The archive-not-delete guard's other question. */
  async existsForProduct(productId: Types.ObjectId): Promise<boolean> {
    return this.exists({ productId });
  }
}

export const itLicenseRepository = new ItLicenseRepository();
