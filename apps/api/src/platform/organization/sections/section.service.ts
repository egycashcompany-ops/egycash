import { type Types } from 'mongoose';
import { type CreateSection, type SectionDto } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { OrgUnitService } from '../shared/org-unit';
import { assertManagerExists } from '../shared/managers';
import { departmentRepository } from '../departments';
import { sectionCatalogService } from '../section-catalog';
import { sectionRepository } from './section.repository';
import { type SectionDoc } from './section.model';

export const sectionService = new OrgUnitService<SectionDoc>('section', sectionRepository, {
  /** `name` follows the catalog entry when one is named — see the Department service for why. */
  buildCreateExtras: async (raw, id: Types.ObjectId) => {
    const input = raw as CreateSection;
    const department = await departmentRepository.findById(input.departmentId);
    if (department === null || department.status !== 'active') {
      throw new BusinessRuleError('Section must belong to an existing active department');
    }
    const catalog =
      input.catalogId === undefined
        ? null
        : await sectionCatalogService.findActive(input.catalogId);
    if (input.catalogId !== undefined && catalog === null) {
      throw new BusinessRuleError(
        'The chosen company-wide section does not exist or is no longer active',
      );
    }
    // The section entry belongs to a company-wide DEPARTMENT; the row's department must be an
    // instance of that same one, or the branch would be declaring a section of some other
    // department it happens to have.
    if (
      catalog !== null &&
      String(department.catalogId ?? '') !== String(catalog.departmentCatalogId)
    ) {
      throw new BusinessRuleError(
        'That section belongs to a different company-wide department than the one chosen here',
      );
    }
    if (catalog === null && input.name === undefined) {
      throw new BusinessRuleError('A section needs a name, or a catalog entry to take one from');
    }
    return {
      branchId: department.branchId,
      departmentId: department._id,
      catalogId: catalog === null ? null : catalog._id,
      path: `${String(department.branchId)}/${String(department._id)}/${String(id)}`,
      description: input.description ?? null,
      ...(catalog === null ? {} : { name: catalog.name }),
    } as Partial<SectionDoc>;
  },
  assertManagerExists,
  // A Section hangs under a Department — see the Department service for why this is here.
  optionParentId: (doc) => String(doc.departmentId),
  // `description` is a per-unit column the generic update does not know about (ADR-015 seam).
  buildUpdateSet: (input) =>
    input.description !== undefined ? { description: input.description ?? null } : {},
});

export const toSectionDto = (doc: SectionDoc): SectionDto => ({
  ...sectionService.baseDto(doc),
  branchId: String(doc.branchId),
  departmentId: String(doc.departmentId),
  catalogId: doc.catalogId == null ? null : String(doc.catalogId),
  description: doc.description ?? null,
});
