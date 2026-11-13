import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsCurrencyModel, type OperationsCurrencyDoc } from './currency.model';

class OperationsCurrencyRepository extends BaseRepository<OperationsCurrencyDoc> {
  constructor() {
    super(OperationsCurrencyModel, {}); // organization-level reference data, no org scoping
  }

  /** Active currencies among the given ids — one query for a whole lines[] check. */
  async findActiveByIds(ids: readonly string[]): Promise<OperationsCurrencyDoc[]> {
    return this.model
      .find({ _id: { $in: ids }, isDeleted: false, isActive: true })
      .lean<OperationsCurrencyDoc[]>()
      .exec();
  }

  /**
   * Every live currency matching `filter`, unpaged — the catalog's default order is applied in the
   * service (numeric-aware codes are not a Mongo sort without a collation). A catalog of currencies
   * is a few dozen rows at most, never a growing history, so reading it whole costs nothing.
   */
  async listAll(filter: FilterQuery<OperationsCurrencyDoc> = {}): Promise<OperationsCurrencyDoc[]> {
    return this.model
      .find({ ...filter, isDeleted: false })
      .lean<OperationsCurrencyDoc[]>()
      .exec();
  }

  /**
   * Write the catalog's order: each id gets its position. `bulkWrite` in one call; the version is
   * left alone — a place in a list is not a fact the edit dialog carries, so reordering must not
   * refuse the next edit as stale (Fleet's catalog `writeOrder`, the same rule).
   */
  async writeOrder(ids: readonly Types.ObjectId[], by: string): Promise<void> {
    if (ids.length === 0) return;
    const updatedBy = new Types.ObjectId(by);
    await this.model.bulkWrite(
      ids.map((_id, index) => ({
        updateOne: { filter: { _id }, update: { $set: { sortOrder: index, updatedBy } } },
      })),
    );
  }

  /** The highest place used in the catalog, or null when it has never been arranged. */
  async maxOrder(): Promise<number | null> {
    const top = await this.model
      .findOne({ isDeleted: false, sortOrder: { $ne: null } })
      .sort({ sortOrder: -1 })
      .select({ sortOrder: 1 })
      .lean<{ sortOrder?: number | null }>()
      .exec();
    return top?.sortOrder ?? null;
  }
}

export const operationsCurrencyRepository = new OperationsCurrencyRepository();
