import { BaseRepository } from '../../../../shared/base/base.repository';
import { HiringDocumentTypeModel, type HiringDocumentTypeDoc } from './hiring-document-type.model';

class HiringDocumentTypeRepository extends BaseRepository<HiringDocumentTypeDoc> {
  constructor() {
    super(HiringDocumentTypeModel, {}); // organization-level catalog, no branch scope
  }

  async findByKey(key: string): Promise<HiringDocumentTypeDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).lean<HiringDocumentTypeDoc>().exec();
  }

  async findActiveById(id: string): Promise<HiringDocumentTypeDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.active ? doc : null;
  }

  /** All active required types — drives the mandatory-completion check. */
  async listActiveRequired(): Promise<HiringDocumentTypeDoc[]> {
    return this.model
      .find({ isDeleted: false, active: true, required: true })
      .lean<HiringDocumentTypeDoc[]>()
      .exec();
  }
}

export const hiringDocumentTypeRepository = new HiringDocumentTypeRepository();
