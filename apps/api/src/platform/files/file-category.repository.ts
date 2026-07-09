import { BaseRepository } from '../../shared/base/base.repository';
import { FileCategoryModel, type FileCategoryDoc } from './file-category.model';

class FileCategoryRepository extends BaseRepository<FileCategoryDoc> {
  constructor() {
    super(FileCategoryModel, {}); // organization-level catalog
  }

  async findByKey(key: string): Promise<FileCategoryDoc | null> {
    return this.model
      .findOne({ key: key.toLowerCase(), isDeleted: false })
      .lean<FileCategoryDoc>()
      .exec();
  }
}

export const fileCategoryRepository = new FileCategoryRepository();
