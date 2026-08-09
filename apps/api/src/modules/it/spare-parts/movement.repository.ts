import { Types } from 'mongoose';
import { type ListItSparePartMovementsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItSparePartMovementModel, type ItSparePartMovementDoc } from './movement.model';

/**
 * The ledger (ADR-024). It inherits `create` and the readers from the base and adds nothing that
 * changes a row — no update, no delete, no correction-in-place. A mistaken movement is corrected
 * by an opposing movement, which is what makes the history defensible six months later.
 */
class ItSparePartMovementRepository extends BaseRepository<ItSparePartMovementDoc> {
  constructor() {
    super(ItSparePartMovementModel, {});
  }

  async listFiltered(
    query: ListItSparePartMovementsQuery,
  ): Promise<Paginated<ItSparePartMovementDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.partId !== undefined) filter.partId = new Types.ObjectId(query.partId);
    if (query.orderId !== undefined) filter.orderId = new Types.ObjectId(query.orderId);
    if (query.direction === 'in') filter.qty = { $gt: 0 };
    if (query.direction === 'out') filter.qty = { $lt: 0 };
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['at', 'createdAt'],
    });
  }

  /** Every movement of one order — the order detail's "parts used" panel. */
  async listForOrder(orderId: Types.ObjectId): Promise<ItSparePartMovementDoc[]> {
    return this.model
      .find({ orderId, isDeleted: false })
      .sort({ at: 1 })
      .lean<ItSparePartMovementDoc[]>()
      .exec();
  }
}

export const itSparePartMovementRepository = new ItSparePartMovementRepository();
