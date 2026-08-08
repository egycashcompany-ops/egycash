import { type ItCatalogKind } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItCatalogItemModel, type ItCatalogItemDoc } from './catalog-item.model';

class ItCatalogItemRepository extends BaseRepository<ItCatalogItemDoc> {
  constructor() {
    super(ItCatalogItemModel, {}); // organization-level catalog, no org scoping
  }

  async findByKindAndNameAr(
    kind: ItCatalogKind,
    nameAr: string,
  ): Promise<ItCatalogItemDoc | null> {
    return this.model
      .findOne({ kind, 'name.ar': nameAr, isDeleted: false })
      .lean<ItCatalogItemDoc>()
      .exec();
  }

  /** Active item of the given kind, or null — the reference check services run before writes. */
  async findActiveOfKind(id: string, kind: ItCatalogKind): Promise<ItCatalogItemDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.kind === kind && doc.isActive ? doc : null;
  }
}

export const itCatalogItemRepository = new ItCatalogItemRepository();
