import { BaseRepository } from '../../../shared/base/base.repository';
import { type LocalizedString } from '@ecms/contracts';
import { catalogNameFilter } from '../shared/org-catalog.service';
import { DepartmentCatalogModel, type DepartmentCatalogDoc } from './department-catalog.model';

class DepartmentCatalogRepository extends BaseRepository<DepartmentCatalogDoc> {
  constructor() {
    super(DepartmentCatalogModel, {}); // organization-wide catalog, no branch scope
  }

  async findByName(
    name: LocalizedString,
    excludeId?: string,
  ): Promise<DepartmentCatalogDoc | null> {
    return this.findOne(catalogNameFilter(name, excludeId));
  }

  /**
   * Every LIVING entry, unscoped — what the migration and the workforce importer read.
   *
   * System-scoped and named so: the catalog is company-wide by definition and carries nothing but
   * codes and names, so there is no per-caller narrowing to apply. The paged `list` is what a
   * request goes through.
   */
  async allSystem(): Promise<DepartmentCatalogDoc[]> {
    return this.model.find({ isDeleted: false }).lean<DepartmentCatalogDoc[]>().exec();
  }
}

export const departmentCatalogRepository = new DepartmentCatalogRepository();
