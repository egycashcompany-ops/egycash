import { Types } from 'mongoose';
import { type CreateSectionCatalog, type SectionCatalogDto } from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { OrgCatalogService } from '../shared/org-catalog.service';
import { departmentCatalogService } from '../department-catalog';
import { sectionCatalogRepository } from './section-catalog.repository';
import { type SectionCatalogDoc } from './section-catalog.model';

/** The department entry a create body or a stored section entry hangs under. */
const parentOf = (owner: unknown): string => {
  const value = (owner as { departmentCatalogId?: unknown }).departmentCatalogId;
  return value === undefined || value === null ? '' : String(value);
};

export const sectionCatalogService = new OrgCatalogService<SectionCatalogDoc>(
  'sectionCatalog',
  sectionCatalogRepository,
  {
    // Unique UNDER ITS DEPARTMENT, not across the company — see the repository for why.
    assertNameAvailable: async (name, owner, excludeId) => {
      const departmentCatalogId = parentOf(owner);
      if (departmentCatalogId === '') return; // create validates the parent below; nothing to check
      const clash = await sectionCatalogRepository.findByNameUnderDepartment(
        departmentCatalogId,
        name,
        excludeId,
      );
      if (clash !== null) {
        throw new ConflictError(
          `"${name.ar}" is already a section of this department (${clash.code})`,
        );
      }
    },
    buildCreateExtras: async (raw) => {
      const input = raw as CreateSectionCatalog;
      const parent = await departmentCatalogService.findActive(input.departmentCatalogId);
      if (parent === null) {
        throw new BusinessRuleError(
          'A section catalog entry must belong to an existing active department catalog entry',
        );
      }
      return { departmentCatalogId: new Types.ObjectId(input.departmentCatalogId) };
    },
  },
);

export const toSectionCatalogDto = (doc: SectionCatalogDoc): SectionCatalogDto => ({
  ...sectionCatalogService.baseDto(doc),
  departmentCatalogId: String(doc.departmentCatalogId),
});
