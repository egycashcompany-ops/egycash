import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { collectionReady } from '../../shared/collection-ready';
import {
  AdministrationItemCategoryModel,
  type AdministrationItemCategoryDoc,
} from './item-category.model';

const idOrNull = (id: string | null): Types.ObjectId | null =>
  id === null ? null : new Types.ObjectId(id);

/** Every live row but `exceptId` — the row being edited never clashes with itself. */
const others = (exceptId: string | undefined): FilterQuery<AdministrationItemCategoryDoc> =>
  exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } };

class AdministrationItemCategoryRepository extends BaseRepository<AdministrationItemCategoryDoc> {
  /** Awaited before every write: `ux_parent_name_key` is the only guard two racing creates meet. */
  readonly ensureCollection = collectionReady(AdministrationItemCategoryModel);

  constructor() {
    super(AdministrationItemCategoryModel, {}); // organization-wide master data, no scoping (§7.1)
  }

  /** The live category under `parentId` (null: the top level) whose folded name is `nameKey`. */
  async findLiveByParentAndNameKey(
    parentId: string | null,
    nameKey: string,
    exceptId?: string,
  ): Promise<AdministrationItemCategoryDoc | null> {
    return this.findOne({ parentId: idOrNull(parentId), nameKey, ...others(exceptId) });
  }

  async findLiveByCode(
    code: string,
    exceptId?: string,
  ): Promise<AdministrationItemCategoryDoc | null> {
    return this.findOne({ code, ...others(exceptId) });
  }

  /** Does any live category, active or retired, sit under this one? */
  async hasChildren(id: string): Promise<boolean> {
    return this.exists({ parentId: new Types.ObjectId(id) });
  }

  /** Does an active subcategory sit under this one — one a new item could name instead? */
  async hasActiveChildren(id: string): Promise<boolean> {
    return this.exists({ parentId: new Types.ObjectId(id), isActive: true });
  }

  /** The ids of every live subcategory under this one, retired ones included. */
  async childIds(id: string): Promise<string[]> {
    const children = await this.model
      .find(this.baseFilter(undefined, { parentId: new Types.ObjectId(id) }))
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return children.map((child) => String(child._id));
  }
}

export const administrationItemCategoryRepository = new AdministrationItemCategoryRepository();
