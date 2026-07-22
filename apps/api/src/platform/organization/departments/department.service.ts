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
        description: input.description ?? null,
      } as Partial<DepartmentDoc>;
    },
    // hasChildren (sections guard) is wired by the organization composition.
    assertManagerExists,
    // `description` is a per-unit column the generic update does not know about (ADR-015 seam).
    buildUpdateSet: (input) =>
      input.description !== undefined ? { description: input.description ?? null } : {},
  },
);

export const toDepartmentDto = (doc: DepartmentDoc): DepartmentDto => ({
  ...departmentService.baseDto(doc),
  branchId: String(doc.branchId),
  description: doc.description ?? null,
});
