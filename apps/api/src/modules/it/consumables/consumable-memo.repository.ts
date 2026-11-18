import { Types, type ClientSession, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../mobile-lines/ensure-collection';
import {
  ItConsumableMemoModel,
  type ItConsumableMemoDoc,
  type ItConsumableMemoLineSub,
} from './consumable-memo.model';

/** A memo line's «مركّب على», as the register named the device — or none («بدون جهاز»). */
export interface ItConsumableMemoLineDevice {
  assetId: Types.ObjectId;
  assetCode: string;
  assetName: string;
}

class ItConsumableMemoRepository extends BaseRepository<ItConsumableMemoDoc> {
  readonly ensureCollection = collectionReady(ItConsumableMemoModel);

  constructor() {
    // Branch-scoped on the store the memo's items came from, like the items themselves.
    super(ItConsumableMemoModel, { branchField: 'branchId' });
  }

  /**
   * «تعديل الجهاز» on the paper: the ONE line that is this movement gets the device re-snapshotted
   * (all three null when cleared), so a reprint prints the new device. Nothing else of the memo is
   * touched — its number, its other lines, the signer, and the signed copy already filed stay as
   * they are — and its version moves on, as any change to it does. Unscoped: the caller found the
   * movement within its scope, and the memo is that movement's own paper, in the same store.
   *
   * Answers the line as it read BEFORE the write (the audit's «from»), or null when there is no such
   * line to change: the memo is gone (the workforce reset purges the papers) or does not list it.
   */
  async setLineDevice(
    memoId: Types.ObjectId,
    movementId: Types.ObjectId,
    device: ItConsumableMemoLineDevice | null,
    meta: { by: string | null; session: ClientSession },
  ): Promise<ItConsumableMemoLineSub | null> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const before = await this.model
      .findOneAndUpdate(
        this.baseFilter(undefined, {
          _id: memoId,
          'lines.movementId': movementId,
        } as FilterQuery<ItConsumableMemoDoc>),
        {
          $set: {
            'lines.$.assetId': device?.assetId ?? null,
            'lines.$.assetCode': device?.assetCode ?? null,
            'lines.$.assetName': device?.assetName ?? null,
            updatedBy: by,
          },
          $inc: { __v: 1 },
        } as UpdateQuery<ItConsumableMemoDoc>,
        { new: false, session: meta.session },
      )
      .lean<ItConsumableMemoDoc>()
      .exec();
    return before?.lines.find((line) => line.movementId.equals(movementId)) ?? null;
  }
}

export const itConsumableMemoRepository = new ItConsumableMemoRepository();
