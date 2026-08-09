import { Types, type ClientSession } from 'mongoose';
import { type ListItMaintenanceOrdersQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { NotFoundError } from '../../../shared/errors';
import { ACTIVE_ORDER_STATUSES } from './order-lifecycle';
import { ItMaintenanceOrderModel, type ItMaintenanceOrderDoc } from './order.model';

class ItMaintenanceOrderRepository extends BaseRepository<ItMaintenanceOrderDoc> {
  constructor() {
    // Orders inherit the ASSET's scope anchor conceptually, but carry no branch of their own —
    // the asset is the scoped thing, and the service reads it through the asset repository.
    super(ItMaintenanceOrderModel, {});
  }

  /** Transactional read — the version handed to `updateById` must come from inside the tx. */
  async getByIdForUpdate(id: string, session: ClientSession): Promise<ItMaintenanceOrderDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError();
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .session(session)
      .lean<ItMaintenanceOrderDoc>()
      .exec();
    if (doc === null) throw new NotFoundError();
    return doc;
  }

  async listFiltered(
    query: ListItMaintenanceOrdersQuery,
  ): Promise<Paginated<ItMaintenanceOrderDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter.kind = query.kind;
    if (query.status !== undefined) filter.status = query.status;
    if (query.assetId !== undefined) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.planId !== undefined) filter.planId = new Types.ObjectId(query.planId);
    if (query.ticketId !== undefined) filter.ticketId = new Types.ObjectId(query.ticketId);
    if (query.vendorId !== undefined) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.active === true) filter.status = { $in: ACTIVE_ORDER_STATUSES };
    if (query.active === false) filter.status = { $in: ['completed', 'cancelled'] };
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ orderCode: pattern }, { summary: pattern }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'orderCode', 'status', 'scheduledFor'],
    });
  }

  /**
   * Is this asset under an order that still governs it?
   *
   * The question the custody guards ask before letting an asset move (§2.7). `session` is passed
   * so the check happens INSIDE the custody transaction — a check outside it could pass while a
   * concurrent `start` was committing.
   */
  async hasActiveForAsset(assetId: string, session?: ClientSession): Promise<boolean> {
    if (!Types.ObjectId.isValid(assetId)) return false;
    const query = this.model.findOne({
      assetId: new Types.ObjectId(assetId),
      status: { $in: ACTIVE_ORDER_STATUSES },
      isDeleted: false,
    });
    if (session !== undefined) query.session(session);
    return (await query.select({ _id: 1 }).lean().exec()) !== null;
  }

  /** §4.6's idempotency guard: a plan gets no second order while one is still unfinished. */
  async hasUnfinishedForPlan(planId: Types.ObjectId): Promise<boolean> {
    const found = await this.model
      .findOne({ planId, status: { $in: ACTIVE_ORDER_STATUSES }, isDeleted: false })
      .select({ _id: 1 })
      .lean()
      .exec();
    return found !== null;
  }
}

export const itMaintenanceOrderRepository = new ItMaintenanceOrderRepository();
