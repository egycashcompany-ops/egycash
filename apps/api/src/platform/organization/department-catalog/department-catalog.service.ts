import { type DepartmentCatalogDto } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { OrgCatalogService } from '../shared/org-catalog.service';
import { departmentCatalogRepository } from './department-catalog.repository';
import { type DepartmentCatalogDoc } from './department-catalog.model';

// `hasDependents` and `renameLinked` reach the departments feature, so they are wired by the
// organization composition rather than here — the same arrangement the hierarchy's delete guards
// already use (`organization/index.ts`).
export const departmentCatalogService = new OrgCatalogService<DepartmentCatalogDoc>(
  'departmentCatalog',
  departmentCatalogRepository,
  {
    // Once, for the whole company. This is the rule the redesign exists to introduce: «العمليات»
    // could be created seven times before, one per branch, and now it is a name the company has.
    assertNameAvailable: async (name, _owner, excludeId) => {
      const existing = await departmentCatalogRepository.findByName(name, excludeId);
      if (existing !== null) {
        throw new ConflictError(
          `The company already has a department named "${name.ar}" (${existing.code})`,
        );
      }
    },
  },
);

export const toDepartmentCatalogDto = (doc: DepartmentCatalogDoc): DepartmentCatalogDto =>
  departmentCatalogService.baseDto(doc);
