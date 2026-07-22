import { BaseRepository } from '../../shared/base/base.repository';
import { ApplicationCategoryModel, type ApplicationCategoryDoc } from './application-category.model';

class ApplicationCategoryRepository extends BaseRepository<ApplicationCategoryDoc> {
  constructor() {
    super(ApplicationCategoryModel, {}); // platform-level catalog: scope = organization
  }
}

export const applicationCategoryRepository = new ApplicationCategoryRepository();
