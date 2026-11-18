// The consumables' ledger (ADR-024's shape). It inherits `create` and the readers from the base and
// adds ONE write: the device an issued unit sits in (`setInstalledOn`), the one fact of a row that
// may be corrected because it moves no quantity (the model's header). It adds no other — no general
// update, no delete, no correction of what moved: a mistaken movement is corrected by an opposing
// one, which is what keeps every on-hand figure explainable, and the missing methods are the
// cheapest enforcement of that.
import { Types, type ClientSession, type FilterQuery, type UpdateQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BusinessRuleError, NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { collectionReady } from '../mobile-lines/ensure-collection';
import {
  ItConsumableMovementModel,
  type ItConsumableMovementDoc,
} from './consumable-movement.model';

/** The refusal for a movement that is not an issue — only an issued unit sits in a device. */
export const notAnIssue = (kind: string): BusinessRuleError =>
  new BusinessRuleError(`only an issued movement is installed on a device; this one is ${kind}`);

class ItConsumableMovementRepository extends BaseRepository<ItConsumableMovementDoc> {
  readonly ensureCollection = collectionReady(ItConsumableMovementModel);

  constructor() {
    // Scoped on the item's store, which a movement copies and an item never changes.
    super(ItConsumableMovementModel, { branchField: 'branchId' });
  }

  /**
   * «تعديل الجهاز» — the device an ISSUED unit sits in, and nothing else: one atomic write whose
   * filter is the whole rule — this id, within the caller's scope, at the version they read, of
   * kind `issued`, naming the device they read (`previous`), not deleted — setting `assetId` (null
   * clears it), keeping the device it named before in `installedOnBefore` (FR-5's guard reads it),
   * and moving the version on. A miss says why, most precise first: gone or out of scope (404), not
   * an issue (422), or somebody changed it first (409).
   */
  async setInstalledOn(
    id: string,
    assetId: Types.ObjectId | null,
    meta: {
      version: number;
      previous: Types.ObjectId | null;
      scope: ScopeSelector;
      by: string | null;
      session: ClientSession;
    },
  ): Promise<ItConsumableMovementDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('movement not found');
    const _id = new Types.ObjectId(id);
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const updated = await this.model
      .findOneAndUpdate(
        this.baseFilter(meta.scope, {
          _id,
          __v: meta.version,
          kind: 'issued',
          assetId: meta.previous,
        } as FilterQuery<ItConsumableMovementDoc>),
        {
          $set: { assetId, updatedBy: by },
          $inc: { __v: 1 },
          ...(meta.previous === null ? {} : { $addToSet: { installedOnBefore: meta.previous } }),
        } as UpdateQuery<ItConsumableMovementDoc>,
        { new: true, session: meta.session },
      )
      .lean<ItConsumableMovementDoc>()
      .exec();
    if (updated !== null) return updated;

    // Read back in the same transaction, under the same scope, to say WHICH refusal it was.
    const current = await this.model
      .findOne(this.baseFilter(meta.scope, { _id } as FilterQuery<ItConsumableMovementDoc>))
      .session(meta.session)
      .lean<ItConsumableMovementDoc>()
      .exec();
    if (current === null) throw new NotFoundError('movement not found');
    if (current.kind !== 'issued') throw notAnIssue(current.kind);
    throw new StaleDocumentError();
  }
}

export const itConsumableMovementRepository = new ItConsumableMovementRepository();
