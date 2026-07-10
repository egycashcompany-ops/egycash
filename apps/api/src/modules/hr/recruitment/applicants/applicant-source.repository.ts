import { BaseRepository } from '../../../../shared/base/base.repository';
import { ApplicantSourceModel, type ApplicantSourceDoc } from './applicant-source.model';

class ApplicantSourceRepository extends BaseRepository<ApplicantSourceDoc> {
  constructor() {
    super(ApplicantSourceModel, {}); // organization-level catalog, no branch scope
  }

  async findByKey(key: string): Promise<ApplicantSourceDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).lean<ApplicantSourceDoc>().exec();
  }

  async findActiveById(id: string): Promise<ApplicantSourceDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.active ? doc : null;
  }
}

export const applicantSourceRepository = new ApplicantSourceRepository();
