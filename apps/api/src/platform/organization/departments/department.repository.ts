import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { DepartmentModel, type DepartmentDoc } from './department.model';

class DepartmentRepository extends BaseRepository<DepartmentDoc> {
  constructor() {
    super(DepartmentModel, { branchField: 'branchId' });
  }

  async existsUnderBranch(branchId: string): Promise<boolean> {
    return this.exists({ branchId: new Types.ObjectId(branchId) });
  }
}

export const departmentRepository = new DepartmentRepository();
