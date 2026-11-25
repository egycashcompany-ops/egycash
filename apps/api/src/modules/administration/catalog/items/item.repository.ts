import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { collectionReady } from '../../shared/collection-ready';
import { floorFrom, highestCodePipeline, ITEM_CODE_SERIES } from '../../shared/document-number';
import { AdministrationItemModel, type AdministrationItemDoc } from './item.model';

/** Every live row but `exceptId` — the row being edited never clashes with itself. */
const others = (exceptId: string | undefined): FilterQuery<AdministrationItemDoc> =>
  exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } };

class AdministrationItemRepository extends BaseRepository<AdministrationItemDoc> {
  /** Awaited before every write: `ux_name_key` and `ux_barcode` are what two racing writes meet. */
  readonly ensureCollection = collectionReady(AdministrationItemModel);

  constructor() {
    super(AdministrationItemModel, {}); // organization-wide master data, no scoping (§7.1)
  }

  /** The live item whose folded name is `nameKey`, if any — the early duplicate answer. */
  async findLiveByNameKey(
    nameKey: string,
    exceptId?: string,
  ): Promise<AdministrationItemDoc | null> {
    return this.findOne({ nameKey, ...others(exceptId) });
  }

  /**
   * The live item holding `barcode`. Never asked before a write — `ux_barcode` is the barcode's
   * only check — but after one it refused, to name the field that clashed.
   */
  async findLiveByBarcode(
    barcode: string,
    exceptId?: string,
  ): Promise<AdministrationItemDoc | null> {
    return this.findOne({ barcode, ...others(exceptId) });
  }

  /**
   * The number of the highest code ever given, retired and deleted rows included — a code is never
   * reused — and 0 before the first: the item counter's floor (§2.8).
   */
  async highestCodeNumber(): Promise<number> {
    const rows = await this.model
      .aggregate<{ top?: unknown }>(highestCodePipeline(ITEM_CODE_SERIES))
      .exec();
    return floorFrom(ITEM_CODE_SERIES, rows);
  }
}

export const administrationItemRepository = new AdministrationItemRepository();
