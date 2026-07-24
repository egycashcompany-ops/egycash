import { BaseRepository } from '../../../../shared/base/base.repository';
import { LeaveTypeModel, type LeaveTypeDoc } from './leave-type.model';

class LeaveTypeRepository extends BaseRepository<LeaveTypeDoc> {
  constructor() {
    super(LeaveTypeModel, {}); // organization-wide catalog, no branch scope
  }

  async findByCode(code: string): Promise<LeaveTypeDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<LeaveTypeDoc>().exec();
  }

  async listAll(): Promise<LeaveTypeDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .sort({ sortOrder: 1, code: 1 })
      .lean<LeaveTypeDoc[]>()
      .exec();
  }

  async listActiveBanked(): Promise<LeaveTypeDoc[]> {
    return this.model
      .find({ isDeleted: false, active: true, balanceSource: 'self' })
      .lean<LeaveTypeDoc[]>()
      .exec();
  }
}

export const leaveTypeRepository = new LeaveTypeRepository();
