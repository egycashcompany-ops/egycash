import { Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { SectionModel, type SectionDoc } from './section.model';

class SectionRepository extends BaseRepository<SectionDoc> {
  constructor() {
    super(SectionModel, { branchField: 'branchId' });
  }

  async existsUnderDepartment(departmentId: string): Promise<boolean> {
    return this.exists({ departmentId: new Types.ObjectId(departmentId) });
  }

  /** Does any department still declare this company-wide section? Blocks deleting the entry. */
  async existsWithCatalog(catalogId: string): Promise<boolean> {
    return this.exists({ catalogId: new Types.ObjectId(catalogId) });
  }

  /** Re-spell every living row declaring this entry — see the department repository for why. */
  async renameByCatalog(catalogId: string, name: LocalizedString, by: string): Promise<number> {
    const result = await this.model.updateMany(
      { catalogId: new Types.ObjectId(catalogId), isDeleted: false },
      { $set: { name, updatedBy: new Types.ObjectId(by) } },
    );
    return result.modifiedCount;
  }
}

export const sectionRepository = new SectionRepository();
