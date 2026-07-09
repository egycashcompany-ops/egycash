import { type Types } from 'mongoose';
import { type CreateSection, type SectionDto } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { OrgUnitService } from '../shared/org-unit';
import { assertManagerExists } from '../shared/managers';
import { departmentRepository } from '../departments';
import { sectionRepository } from './section.repository';
import { type SectionDoc } from './section.model';

export const sectionService = new OrgUnitService<SectionDoc>('section', sectionRepository, {
  buildCreateExtras: async (raw, id: Types.ObjectId) => {
    const input = raw as CreateSection;
    const department = await departmentRepository.findById(input.departmentId);
    if (department === null || department.status !== 'active') {
      throw new BusinessRuleError('Section must belong to an existing active department');
    }
    return {
      branchId: department.branchId,
      departmentId: department._id,
      path: `${String(department.branchId)}/${String(department._id)}/${String(id)}`,
    } as Partial<SectionDoc>;
  },
  assertManagerExists,
});

export const toSectionDto = (doc: SectionDoc): SectionDto => ({
  ...sectionService.baseDto(doc),
  branchId: String(doc.branchId),
  departmentId: String(doc.departmentId),
});
