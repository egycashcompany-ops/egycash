import { Types } from 'mongoose';
import { type CreateDepartment, type DepartmentDto } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { OrgUnitService } from '../shared/org-unit';
import { assertManagerExists } from '../shared/managers';
import { branchRepository } from '../branches';
import { departmentRepository } from './department.repository';
import { type DepartmentDoc } from './department.model';

export const departmentService = new OrgUnitService<DepartmentDoc>(
  'department',
  departmentRepository,
  {
    buildCreateExtras: async (raw, id: Types.ObjectId) => {
      const input = raw as CreateDepartment;
      const branch = await branchRepository.findById(input.branchId);
      if (branch === null || branch.status !== 'active') {
        throw new BusinessRuleError('Department must belong to an existing active branch');
      }
      return {
        branchId: new Types.ObjectId(input.branchId),
        path: `${input.branchId}/${String(id)}`,
      } as Partial<DepartmentDoc>;
    },
    // hasChildren (sections guard) is wired by the organization composition.
    assertManagerExists,
  },
);

export const toDepartmentDto = (doc: DepartmentDoc): DepartmentDto => ({
  ...departmentService.baseDto(doc),
  branchId: String(doc.branchId),
});
