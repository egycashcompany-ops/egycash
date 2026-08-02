import { type FleetCatalogKind } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetCatalogItemModel, type FleetCatalogItemDoc } from './catalog-item.model';

class FleetCatalogItemRepository extends BaseRepository<FleetCatalogItemDoc> {
  constructor() {
    super(FleetCatalogItemModel, {}); // organization-level catalog, no org scoping
  }

  async findByKindAndNameAr(
    kind: FleetCatalogKind,
    nameAr: string,
  ): Promise<FleetCatalogItemDoc | null> {
    return this.model
      .findOne({ kind, 'name.ar': nameAr, isDeleted: false })
      .lean<FleetCatalogItemDoc>()
      .exec();
  }

  /** Active item of the given kind, or null — the reference check services run before writes. */
  async findActiveOfKind(id: string, kind: FleetCatalogKind): Promise<FleetCatalogItemDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.kind === kind && doc.isActive ? doc : null;
  }
}

export const fleetCatalogItemRepository = new FleetCatalogItemRepository();
