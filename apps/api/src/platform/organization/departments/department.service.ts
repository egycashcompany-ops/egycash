import { Types } from 'mongoose';
import { type CreateDepartment, type DepartmentDto } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { OrgUnitService } from '../shared/org-unit';
import { assertManagerExists } from '../shared/managers';
import { branchRepository } from '../branches';
import { departmentCatalogService } from '../department-catalog';
import { departmentRepository } from './department.repository';
import { type DepartmentDoc } from './department.model';

export const departmentService = new OrgUnitService<DepartmentDoc>(
  'department',
  departmentRepository,
  {
    /**
     * `name` comes back from here when a catalog entry was named (P-ORG-2).
     *
     * `OrgUnitService.create` spreads these extras AFTER the fields it builds from the body, so
     * returning `name` is how a per-branch row takes the company's spelling instead of whatever
     * this particular form typed. That is the whole mechanism: one name, copied, never re-entered.
     */
    buildCreateExtras: async (raw, id: Types.ObjectId) => {
      const input = raw as CreateDepartment;
      const branch = await branchRepository.findById(input.branchId);
      if (branch === null || branch.status !== 'active') {
        throw new BusinessRuleError('Department must belong to an existing active branch');
      }
      const catalog =
        input.catalogId === undefined
          ? null
          : await departmentCatalogService.findActive(input.catalogId);
      if (input.catalogId !== undefined && catalog === null) {
        throw new BusinessRuleError(
          'The chosen company-wide department does not exist or is no longer active',
        );
      }
      if (catalog === null && input.name === undefined) {
        // Unreachable through HTTP — `CreateDepartmentSchema` refuses it — and here anyway, because
        // the importer and the seeds call this service directly and a nameless unit is not a unit.
        throw new BusinessRuleError(
          'A department needs a name, or a catalog entry to take one from',
        );
      }
      return {
        branchId: new Types.ObjectId(input.branchId),
        catalogId: catalog === null ? null : catalog._id,
        path: `${input.branchId}/${String(id)}`,
        description: input.description ?? null,
        ...(catalog === null ? {} : { name: catalog.name }),
      } as Partial<DepartmentDoc>;
    },
    // hasChildren (sections guard) is wired by the organization composition.
    assertManagerExists,
    // A Department hangs under a Branch — what lets the employees filter narrow one by the other.
    optionParentId: (doc) => String(doc.branchId),
    // `description` is a per-unit column the generic update does not know about (ADR-015 seam).
    buildUpdateSet: (input) =>
      input.description !== undefined ? { description: input.description ?? null } : {},
  },
);

export const toDepartmentDto = (doc: DepartmentDoc): DepartmentDto => ({
  ...departmentService.baseDto(doc),
  branchId: String(doc.branchId),
  catalogId: doc.catalogId == null ? null : String(doc.catalogId),
  description: doc.description ?? null,
});
