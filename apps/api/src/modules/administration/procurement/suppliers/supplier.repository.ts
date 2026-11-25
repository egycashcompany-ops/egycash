import { ADMINISTRATION_MAX_LIST_ATTACHMENTS } from '@ecms/contracts';
import { Types, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { collectionReady } from '../../shared/collection-ready';
import { floorFrom, highestCodePipeline, SUPPLIER_CODE_SERIES } from '../../shared/document-number';
import {
  AdministrationSupplierModel,
  type AdministrationSupplierAttachmentSub,
  type AdministrationSupplierDoc,
} from './supplier.model';

/** Every live row but `exceptId` — the row being edited never clashes with itself. */
const others = (exceptId: string | undefined): FilterQuery<AdministrationSupplierDoc> =>
  exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } };

/** The list's last slot: while it is empty, the list holds fewer than the bound (§11.4). */
const LAST_SLOT = `attachments.${String(ADMINISTRATION_MAX_LIST_ATTACHMENTS - 1)}`;

class AdministrationSupplierRepository extends BaseRepository<AdministrationSupplierDoc> {
  /** Awaited before every write: `ux_name_key` is what two racing creates meet. */
  readonly ensureCollection = collectionReady(AdministrationSupplierModel);

  constructor() {
    super(AdministrationSupplierModel, {}); // organization-wide master data, no scoping (§7.1)
  }

  /** The live supplier whose folded name is `nameKey`, if any — the early duplicate answer. */
  async findLiveByNameKey(
    nameKey: string,
    exceptId?: string,
  ): Promise<AdministrationSupplierDoc | null> {
    return this.findOne({ nameKey, ...others(exceptId) });
  }

  /**
   * The live suppliers but `exceptId` holding `taxNumber`, retired ones included, newest first and
   * at most `limit` — the warning's read (OD-11 (i)), served by `ix_tax_number`, whose filter the
   * `$type` repeats so the partial index answers it.
   */
  async taxNumberHolders(
    taxNumber: string,
    exceptId: string,
    limit: number,
  ): Promise<AdministrationSupplierDoc[]> {
    return this.model
      .find(
        this.baseFilter(undefined, {
          taxNumber: { $eq: taxNumber, $type: 'string' },
          ...others(exceptId),
        }),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<AdministrationSupplierDoc[]>()
      .exec();
  }

  /**
   * The number of the highest code ever given, retired and deleted rows included — a code is never
   * reused — and 0 before the first: the supplier counter's floor (§2.8).
   */
  async highestCodeNumber(): Promise<number> {
    const rows = await this.model
      .aggregate<{ top?: unknown }>(highestCodePipeline(SUPPLIER_CODE_SERIES))
      .exec();
    return floorFrom(SUPPLIER_CODE_SERIES, rows);
  }

  /**
   * Link one paper: ONE write that holds the version the person saw and the list's bound in its
   * filter, so a stale view and a 21st paper are refused even when two adds race. Null when it
   * matched nothing; the caller re-reads to say why.
   */
  async pushAttachment(
    id: string,
    version: number,
    entry: AdministrationSupplierAttachmentSub,
    by: string,
  ): Promise<AdministrationSupplierDoc | null> {
    return this.linkWrite(
      id,
      version,
      { [LAST_SLOT]: { $exists: false } },
      { $push: { attachments: entry } },
      by,
    );
  }

  /** Unlink one paper, under the version the person saw. Null when it matched nothing. */
  async pullAttachment(
    id: string,
    version: number,
    attachmentId: Types.ObjectId,
    by: string,
  ): Promise<AdministrationSupplierDoc | null> {
    return this.linkWrite(
      id,
      version,
      { 'attachments.attachmentId': attachmentId },
      { $pull: { attachments: { attachmentId } } },
      by,
    );
  }

  /**
   * A link write is an edit of the record (§11.4): version-held, and it moves the version, so an
   * edit decided before it is answered as stale. `writeConditions()` rides along as on any write.
   */
  private async linkWrite(
    id: string,
    version: number,
    condition: FilterQuery<AdministrationSupplierDoc>,
    change: UpdateQuery<AdministrationSupplierDoc>,
    by: string,
  ): Promise<AdministrationSupplierDoc | null> {
    return this.model
      .findOneAndUpdate(
        this.baseFilter(undefined, {
          _id: new Types.ObjectId(id),
          __v: version,
          ...condition,
          ...this.writeConditions(),
        }),
        { ...change, $set: { updatedBy: new Types.ObjectId(by) }, $inc: { __v: 1 } },
        { new: true },
      )
      .lean<AdministrationSupplierDoc>()
      .exec();
  }
}

export const administrationSupplierRepository = new AdministrationSupplierRepository();
