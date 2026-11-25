import { Types, type FilterQuery } from 'mongoose';
import { type AdministrationCatalogKind } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { collectionReady } from '../../shared/collection-ready';
import {
  AdministrationCatalogItemModel,
  type AdministrationCatalogItemDoc,
} from './catalog-item.model';

/** Every live row but `exceptId` — the row being edited never clashes with itself. */
const others = (exceptId: string | undefined): FilterQuery<AdministrationCatalogItemDoc> =>
  exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } };

class AdministrationCatalogItemRepository extends BaseRepository<AdministrationCatalogItemDoc> {
  /** Awaited before every write: `ux_kind_name_key` is the only guard two racing creates meet. */
  readonly ensureCollection = collectionReady(AdministrationCatalogItemModel);

  constructor() {
    super(AdministrationCatalogItemModel, {}); // organization-wide master data, no scoping (§7.1)
  }

  /** The live row of this kind whose folded name is `nameKey`, if any — the early duplicate answer. */
  async findLiveByNameKey(
    kind: AdministrationCatalogKind,
    nameKey: string,
    exceptId?: string,
  ): Promise<AdministrationCatalogItemDoc | null> {
    return this.findOne({ kind, nameKey, ...others(exceptId) });
  }

  async findLiveByCode(
    kind: AdministrationCatalogKind,
    code: string,
    exceptId?: string,
  ): Promise<AdministrationCatalogItemDoc | null> {
    return this.findOne({ kind, code, ...others(exceptId) });
  }
}

export const administrationCatalogItemRepository = new AdministrationCatalogItemRepository();
