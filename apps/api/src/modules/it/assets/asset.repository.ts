import { BaseRepository } from '../../../shared/base/base.repository';
import { ItAssetModel, type ItAssetDoc } from './asset.model';

class ItAssetRepository extends BaseRepository<ItAssetDoc> {
  constructor() {
    // Branch-scoped (design §7): a branch-scoped technician sees that branch's assets.
    super(ItAssetModel, { branchField: 'branchId' });
  }

  /** Scan resolve (design §4.2): the QR payload is the plain assetCode. */
  async findByCode(assetCode: string): Promise<ItAssetDoc | null> {
    return this.model.findOne({ assetCode, isDeleted: false }).lean<ItAssetDoc>().exec();
  }

  async findBySerial(serialNumber: string): Promise<ItAssetDoc | null> {
    return this.model.findOne({ serialNumber, isDeleted: false }).lean<ItAssetDoc>().exec();
  }

  /** Label-sheet load: the requested ids that still exist, in request order. */
  async findManyByIds(ids: readonly string[]): Promise<ItAssetDoc[]> {
    const docs = await this.model
      .find({ _id: { $in: ids }, isDeleted: false })
      .lean<ItAssetDoc[]>()
      .exec();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return ids.flatMap((id) => {
      const doc = byId.get(id);
      return doc === undefined ? [] : [doc];
    });
  }
}

export const itAssetRepository = new ItAssetRepository();
