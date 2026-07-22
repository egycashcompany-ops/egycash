import { Types } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { DepartmentApplicationModel, type DepartmentApplicationDoc } from './department-application.model';

class DepartmentApplicationRepository extends BaseRepository<DepartmentApplicationDoc> {
  constructor() {
    super(DepartmentApplicationModel, {}); // platform-level link: scope = organization
  }

  /** All live assignments for a department. */
  findByDepartment(departmentId: string): Promise<DepartmentApplicationDoc[]> {
    return this.model
      .find({ departmentId: new Types.ObjectId(departmentId), isDeleted: false })
      .lean<DepartmentApplicationDoc[]>()
      .exec();
  }
}

export const departmentApplicationRepository = new DepartmentApplicationRepository();
