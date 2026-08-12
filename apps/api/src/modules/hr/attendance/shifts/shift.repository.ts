import { BaseRepository } from '../../../../shared/base/base.repository';
import { ShiftModel, type ShiftDoc } from './shift.model';

class ShiftRepository extends BaseRepository<ShiftDoc> {
  constructor() {
    super(ShiftModel, {}); // organization-wide catalog, no branch scope
  }

  async findByCode(code: string): Promise<ShiftDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<ShiftDoc>().exec();
  }

  async listAll(): Promise<ShiftDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .sort({ sortOrder: 1, code: 1 })
      .lean<ShiftDoc[]>()
      .exec();
  }
}

export const shiftRepository = new ShiftRepository();
