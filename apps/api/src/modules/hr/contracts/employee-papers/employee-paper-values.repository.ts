// Data access only (ADR-003).
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { EmployeePaperValuesModel, type EmployeePaperValuesDoc } from './employee-paper-values.model';

class EmployeePaperValuesRepository extends BaseRepository<EmployeePaperValuesDoc> {
  constructor() {
    super(EmployeePaperValuesModel, {});
  }

  async findByEmployee(employeeId: string): Promise<EmployeePaperValuesDoc | null> {
    return this.model
      .findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .lean<EmployeePaperValuesDoc>()
      .exec();
  }
}

export const employeePaperValuesRepository = new EmployeePaperValuesRepository();
