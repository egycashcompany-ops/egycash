// Data access only (ADR-003).
import { BaseRepository } from '../../../../shared/base/base.repository';
import { InsuranceJobTitleModel, type InsuranceJobTitleDoc } from './insurance-job-title.model';

class InsuranceJobTitleRepository extends BaseRepository<InsuranceJobTitleDoc> {
  constructor() {
    super(InsuranceJobTitleModel, {});
  }

  async findByNameKey(nameKey: string): Promise<InsuranceJobTitleDoc | null> {
    return this.model.findOne({ nameKey, isDeleted: false }).lean<InsuranceJobTitleDoc>().exec();
  }

  async listAll(): Promise<InsuranceJobTitleDoc[]> {
    return this.model.find({ isDeleted: false }).lean<InsuranceJobTitleDoc[]>().exec();
  }
}

export const insuranceJobTitleRepository = new InsuranceJobTitleRepository();
