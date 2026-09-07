import { Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { DepartmentModel, type DepartmentDoc } from './department.model';

class DepartmentRepository extends BaseRepository<DepartmentDoc> {
  constructor() {
    super(DepartmentModel, { branchField: 'branchId' });
  }

  async existsUnderBranch(branchId: string): Promise<boolean> {
    return this.exists({ branchId: new Types.ObjectId(branchId) });
  }

  /** Does any branch still declare this company-wide department? Blocks deleting the entry. */
  async existsWithCatalog(catalogId: string): Promise<boolean> {
    return this.exists({ catalogId: new Types.ObjectId(catalogId) });
  }

  /**
   * Re-spell every living row that declares this catalog entry, and say how many followed.
   *
   * `updateMany` rather than a loop of `updateById`: this is ONE decision taken on the catalog, and
   * the audit entry recording it is written there (see `OrgCatalogService.update`). Bumping each
   * row's `__v` would also invalidate an editor's open form for a change they did not make.
   */
  async renameByCatalog(catalogId: string, name: LocalizedString, by: string): Promise<number> {
    const result = await this.model.updateMany(
      { catalogId: new Types.ObjectId(catalogId), isDeleted: false },
      { $set: { name, updatedBy: new Types.ObjectId(by) } },
    );
    return result.modifiedCount;
  }
}

export const departmentRepository = new DepartmentRepository();
