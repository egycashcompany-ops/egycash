import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { SectionModel, type SectionDoc } from './section.model';

class SectionRepository extends BaseRepository<SectionDoc> {
  constructor() {
    super(SectionModel, { branchField: 'branchId' });
  }

  async existsUnderDepartment(departmentId: string): Promise<boolean> {
    return this.exists({ departmentId: new Types.ObjectId(departmentId) });
  }
}

export const sectionRepository = new SectionRepository();
