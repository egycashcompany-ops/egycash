import { Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { catalogNameFilter } from '../shared/org-catalog.service';
import { SectionCatalogModel, type SectionCatalogDoc } from './section-catalog.model';

class SectionCatalogRepository extends BaseRepository<SectionCatalogDoc> {
  constructor() {
    super(SectionCatalogModel, {}); // organization-wide catalog, no branch scope
  }

  /**
   * A section name is unique WITHIN its department entry, not across the company.
   *
   * «الصيانة» under Fleet and «الصيانة» under Facilities are two different jobs that share a word,
   * and refusing the second would be this catalog inventing a rule the company does not have. What
   * it does refuse is the same section named twice under one department, which is the duplication
   * being removed.
   */
  async findByNameUnderDepartment(
    departmentCatalogId: string,
    name: LocalizedString,
    excludeId?: string,
  ): Promise<SectionCatalogDoc | null> {
    return this.findOne({
      ...catalogNameFilter(name, excludeId),
      departmentCatalogId: new Types.ObjectId(departmentCatalogId),
    });
  }

  async existsUnderDepartmentCatalog(departmentCatalogId: string): Promise<boolean> {
    return this.exists({ departmentCatalogId: new Types.ObjectId(departmentCatalogId) });
  }

  /** Every LIVING entry, unscoped — see the department catalog repository for why. */
  async allSystem(): Promise<SectionCatalogDoc[]> {
    return this.model.find({ isDeleted: false }).lean<SectionCatalogDoc[]>().exec();
  }
}

export const sectionCatalogRepository = new SectionCatalogRepository();
