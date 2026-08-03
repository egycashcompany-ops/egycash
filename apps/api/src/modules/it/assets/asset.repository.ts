import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { ItAssetModel, type ItAssetDoc } from './asset.model';

class ItAssetRepository extends BaseRepository<ItAssetDoc> {
  constructor() {
    // Branch-scoped (design §7): a branch-scoped technician sees that branch's assets.
    super(ItAssetModel, { branchField: 'branchId' });
  }

  /** Scan resolve (design §4.2): the QR payload is the plain assetCode. Scoped like any read. */
  async findByCode(assetCode: string, scope?: ScopeSelector): Promise<ItAssetDoc | null> {
    return this.findOne({ assetCode }, scope);
  }

  /** Uniqueness pre-check — deliberately UNscoped: a serial is unique company-wide (FR-1). */
  async findBySerial(serialNumber: string): Promise<ItAssetDoc | null> {
    return this.model.findOne({ serialNumber, isDeleted: false }).lean<ItAssetDoc>().exec();
  }

  /**
   * Label-sheet load: the requested ids the caller may see, in request order. Goes through the
   * scoped list path so a branch-scoped caller cannot print another branch's labels.
   */
  async findManyByIds(ids: readonly string[], scope?: ScopeSelector): Promise<ItAssetDoc[]> {
    const page = await this.list({
      filter: { _id: { $in: ids } },
      page: 1,
      pageSize: Math.max(ids.length, 1),
      ...(scope === undefined ? {} : { scope }),
    });
    const byId = new Map(page.items.map((d) => [String(d._id), d]));
    return ids.flatMap((id) => {
      const doc = byId.get(id);
      return doc === undefined ? [] : [doc];
    });
  }
}

export const itAssetRepository = new ItAssetRepository();
