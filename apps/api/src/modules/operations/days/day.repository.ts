import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsDayModel, type OperationsDayDoc } from './day.model';

class OperationsDayRepository extends BaseRepository<OperationsDayDoc> {
  constructor() {
    super(OperationsDayModel, {}); // one day per date, organization-wide
  }

  async findByDate(day: Date, session?: ClientSession): Promise<OperationsDayDoc | null> {
    return this.model
      .findOne({ date: day, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsDayDoc>()
      .exec();
  }
}

export const operationsDayRepository = new OperationsDayRepository();
