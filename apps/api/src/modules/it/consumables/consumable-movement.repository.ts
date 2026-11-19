// The consumables' ledger (ADR-024's shape). It inherits `create` and the readers from the base and
// adds ONE correctable fact: the device an issued unit sits in (`setInstalledOn`), the one fact of a
// row that may be corrected because it moves no quantity (the model's header) — on a counted issue,
// the device AND the printer's counter reading taken on it. That reading is ONE fact of a memo's
// rows on one printer («one memo, one printer, one reading»: one display, read once), so the write
// of it reaches the memo's other counted rows on that printer too (`setMemoCounterOnPrinter`) —
// their reading and reset, nothing else. It adds no other — no general update, no delete, no
// correction of what moved: a mistaken movement is corrected by an opposing one, which is what
// keeps every on-hand figure explainable, and the missing methods are the cheapest enforcement of
// that.
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

/** One reading on a printer's counter — a counted issue, as its timeline reads it. */
export type ItCounterTimelineRow = Pick<
  ItConsumableMovementDoc,
  '_id' | 'consumableId' | 'assetId' | 'at' | 'memoId' | 'counterReset'
> & { counterReading: number };

/** A counted issue: an issued row that carries a reading, not deleted. */
const COUNTED = {
  kind: 'issued',
  counterReading: { $type: 'number' },
  isDeleted: false,
} as FilterQuery<ItConsumableMovementDoc>;

const COUNTER_FIELDS = {
  _id: 1,
  consumableId: 1,
  assetId: 1,
  at: 1,
  memoId: 1,
  counterReading: 1,
  counterReset: 1,
} as const;

class ItConsumableMovementRepository extends BaseRepository<ItConsumableMovementDoc> {
  readonly ensureCollection = collectionReady(ItConsumableMovementModel);

  constructor() {
    // Scoped on the item's store, which a movement copies and an item never changes.
    super(ItConsumableMovementModel, { branchField: 'branchId' });
  }

  /**
   * A printer's counter timeline — every counted issue onto these assets, oldest first (`at`, then
   * id: one memo's lines share `at` and were written in line order). UNSCOPED on purpose: a reading
   * is a fact of the printer, and a branch's clerk is judged against another store's reading on the
   * same printer as much as their own. Inside the caller's transaction when it is given one — the
   * writers read it under the printer's lock.
   */
  async counterTimelineSystem(
    assetIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<ItCounterTimelineRow[]> {
    if (assetIds.length === 0) return [];
    return this.model
      .find({ ...COUNTED, assetId: { $in: [...assetIds] } })
      .select(COUNTER_FIELDS)
      .sort({ at: 1, _id: 1 })
      .session(session ?? null)
      .lean<ItCounterTimelineRow[]>()
      .exec();
  }

  /**
   * One item's counted issues, oldest first. A system read: the caller has already read the item
   * under its scope, and every row of an item shares the item's store.
   */
  async counterRowsOfItem(consumableId: Types.ObjectId): Promise<ItCounterTimelineRow[]> {
    return this.model
      .find({ ...COUNTED, consumableId })
      .select(COUNTER_FIELDS)
      .sort({ at: 1, _id: 1 })
      .lean<ItCounterTimelineRow[]>()
      .exec();
  }

  /**
   * «تعديل الجهاز» — the device an ISSUED unit sits in, and nothing else: one atomic write whose
   * filter is the whole rule — this id, within the caller's scope, at the version they read, of
   * kind `issued`, naming the device they read (`previous`), not deleted — setting `assetId` (null
   * clears it), keeping the device it named before in `installedOnBefore` (FR-5's guard reads it),
   * and moving the version on. A miss says why, most precise first: gone or out of scope (404), not
   * an issue (422), or somebody changed it first (409).
   *
   * `counter`, on a counted issue only: the reading taken on the device it now names — set (and
   * `counterReset` set, or taken off when false), or taken off with the device (`reading` null,
   * «بدون جهاز»). Absent: the reading is not touched. The filter is the same: `__v` already guards
   * the row, so a reading somebody corrected first is the same 409.
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
      counter?: { reading: number | null; reset: boolean };
    },
  ): Promise<ItConsumableMovementDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('movement not found');
    const _id = new Types.ObjectId(id);
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const counter = meta.counter;
    const set: Record<string, unknown> = { assetId, updatedBy: by };
    const unset: Record<string, ''> = {};
    if (counter !== undefined) {
      if (counter.reading === null) {
        unset.counterReading = '';
        unset.counterReset = '';
      } else {
        set.counterReading = counter.reading;
        if (counter.reset) set.counterReset = true;
        else unset.counterReset = '';
      }
    }
    // A reading corrected on the device it already names keeps no «before»: it named no other.
    const moved = meta.previous !== null && (assetId === null || !meta.previous.equals(assetId));
    const updated = await this.model
      .findOneAndUpdate(
        this.baseFilter(meta.scope, {
          _id,
          __v: meta.version,
          kind: 'issued',
          assetId: meta.previous,
        } as FilterQuery<ItConsumableMovementDoc>),
        {
          $set: set,
          ...(Object.keys(unset).length === 0 ? {} : { $unset: unset }),
          $inc: { __v: 1 },
          ...(moved ? { $addToSet: { installedOnBefore: meta.previous } } : {}),
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

  /**
   * «One memo, one printer, one reading» — the reading (and reset) just written on one counted row
   * of a memo, written to the memo's OTHER counted rows on that printer (`ids`, read by the caller
   * under the printer's lock in this transaction), and nothing else of them: one atomic write whose
   * filter is the whole rule — these ids, of this memo, on this printer, counted issues, not
   * deleted — setting `counterReading` (and `counterReset`, or taking it off), and moving each
   * row's version on, so a dialog opened on one of them before is a 409 rather than an overwrite.
   * A row the filter no longer finds is somebody's change first — 409.
   */
  async setMemoCounterOnPrinter(
    ids: readonly Types.ObjectId[],
    group: { memoId: Types.ObjectId; assetId: Types.ObjectId },
    counter: { reading: number; reset: boolean },
    meta: { by: string | null; session: ClientSession },
  ): Promise<void> {
    if (ids.length === 0) return;
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const result = await this.model
      .updateMany(
        {
          ...COUNTED,
          _id: { $in: [...ids] },
          memoId: group.memoId,
          assetId: group.assetId,
        } as FilterQuery<ItConsumableMovementDoc>,
        {
          $set: {
            counterReading: counter.reading,
            updatedBy: by,
            ...(counter.reset ? { counterReset: true } : {}),
          },
          ...(counter.reset ? {} : { $unset: { counterReset: '' } }),
          $inc: { __v: 1 },
        } as UpdateQuery<ItConsumableMovementDoc>,
        { session: meta.session },
      )
      .exec();
    if (result.matchedCount !== ids.length) throw new StaleDocumentError();
  }
}

export const itConsumableMovementRepository = new ItConsumableMovementRepository();
