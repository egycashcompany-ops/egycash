// Data access only (ADR-003).
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { InsuranceJobTitleModel, type InsuranceJobTitleDoc } from './insurance-job-title.model';

class InsuranceJobTitleRepository extends BaseRepository<InsuranceJobTitleDoc> {
  constructor() {
    super(InsuranceJobTitleModel, {});
  }

  async findByJob(jobTitleId: string): Promise<InsuranceJobTitleDoc | null> {
    if (!Types.ObjectId.isValid(jobTitleId)) return null;
    return this.model
      .findOne({ jobTitleId: new Types.ObjectId(jobTitleId), isDeleted: false })
      .lean<InsuranceJobTitleDoc>()
      .exec();
  }

  async listAll(): Promise<InsuranceJobTitleDoc[]> {
    return this.model.find({ isDeleted: false }).lean<InsuranceJobTitleDoc[]>().exec();
  }
}

export const insuranceJobTitleRepository = new InsuranceJobTitleRepository();
