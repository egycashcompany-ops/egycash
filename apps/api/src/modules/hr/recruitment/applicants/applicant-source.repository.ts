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

  /** Every active source, by name — the public «how did you hear about us» list. */
  async listActive(): Promise<ApplicantSourceDoc[]> {
    return this.model
      .find({ active: true, isDeleted: false })
      .sort({ 'name.ar': 1 })
      .lean<ApplicantSourceDoc[]>()
      .exec();
  }
}

export const applicantSourceRepository = new ApplicantSourceRepository();
