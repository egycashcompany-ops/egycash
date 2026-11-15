import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsShiftTypeModel, type OperationsShiftTypeDoc } from './shift-type.model';

class OperationsShiftTypeRepository extends BaseRepository<OperationsShiftTypeDoc> {
  constructor() {
    super(OperationsShiftTypeModel, {}); // organization-level reference data, no org scoping
  }

  /**
   * Every live type matching `filter`, unpaged — the catalog's order is applied in the service.
   * A list of types is a dozen rows, never a growing history.
   */
  async listAll(filter: FilterQuery<OperationsShiftTypeDoc> = {}): Promise<OperationsShiftTypeDoc[]> {
    return this.model
      .find({ ...filter, isDeleted: false })
      .lean<OperationsShiftTypeDoc[]>()
      .exec();
  }

  /** The live types among these ids, active or not — one read for a whole crew-board save. */
  async findLiveByIds(ids: readonly string[]): Promise<OperationsShiftTypeDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .lean<OperationsShiftTypeDoc[]>()
      .exec();
  }

  /** The currencies' `writeOrder`: each id its position, the version left alone. */
  async writeOrder(ids: readonly Types.ObjectId[], by: string): Promise<void> {
    if (ids.length === 0) return;
    const updatedBy = new Types.ObjectId(by);
    await this.model.bulkWrite(
      ids.map((_id, index) => ({
        updateOne: { filter: { _id }, update: { $set: { sortOrder: index, updatedBy } } },
      })),
    );
  }

  /** The highest place used, or null when the catalog has never been arranged. */
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

export const operationsShiftTypeRepository = new OperationsShiftTypeRepository();
