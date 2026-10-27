import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type FleetReceiptMemoLinkDto, type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { BusinessRuleError } from '../../../shared/errors';
import { FleetCustodyMemoModel, type FleetCustodyMemoDoc } from './custody-memo.model';

const dayOf = (value: Date | null | undefined): string | null =>
  value == null ? null : value.toISOString().slice(0, 10);

/** The columns «المذكرات» orders by on the server. */
export const CUSTODY_MEMO_SORTABLE = ['no', 'date', 'createdAt'] as const;

class FleetCustodyMemoRepository extends BaseRepository<FleetCustodyMemoDoc> {
  constructor() {
    // The custody screen's own paperwork: `fleetCustody.view` (and the receipt grants for a write)
    // decide who reads and writes it; the memo carries no org placement of its own.
    super(FleetCustodyMemoModel, {});
  }

  /**
   * A memo a replenishment took is frozen — held or transferred alike — riding inside the same
   * atomic write as every edit and delete, so a «استعاضة» landing a moment earlier cannot be
   * overtaken by a request that read the memo before it.
   */
  protected override writeConditions(): FilterQuery<FleetCustodyMemoDoc> {
    return { replenishmentId: null };
  }

  protected override assertWritable(current: FleetCustodyMemoDoc): void {
    assertCustodyMemoWritable(current);
  }

  async listMemos(
    params: ListParams<FleetCustodyMemoDoc>,
  ): Promise<Paginated<FleetCustodyMemoDoc>> {
    return this.list({ ...params, sortableFields: CUSTODY_MEMO_SORTABLE });
  }

  /** One live memo, read inside `session`. */
  async findLive(id: string, session?: ClientSession): Promise<FleetCustodyMemoDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .session(session ?? null)
      .lean<FleetCustodyMemoDoc>()
      .exec();
  }

  /** The live memos among `ids` (any missing or deleted id is simply absent), by `no`. */
  async findLiveByIds(
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<FleetCustodyMemoDoc[]> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return [];
    return this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .sort({ no: 1 })
      .session(session ?? null)
      .lean<FleetCustodyMemoDoc[]>()
      .exec();
  }

  /** id → memo number, for every id given — deleted memos named too. */
  async numbersByIds(ids: readonly string[]): Promise<Map<string, number>> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } })
      .select({ no: 1 })
      .lean<{ _id: Types.ObjectId; no: number }[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.no]));
  }

  /**
   * id → the receipts screen's link («مذكرة … رقم N»): the day its replenishment brought the money
   * back — none while pending, and none while held (`held`: the transfer is not confirmed yet).
   */
  async linksByIds(ids: readonly string[]): Promise<Map<string, FleetReceiptMemoLinkDto>> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .select({ no: 1, replenishmentId: 1, replenishedAt: 1, replenishmentHeld: 1 })
      .lean<
        {
          _id: Types.ObjectId;
          no: number;
          replenishmentId?: Types.ObjectId | null;
          replenishedAt?: Date | null;
          replenishmentHeld?: boolean;
        }[]
      >()
      .exec();
    return new Map(
      rows.map((row) => {
        const held = row.replenishmentId != null && row.replenishmentHeld === true;
        return [
          String(row._id),
          {
            id: String(row._id),
            no: row.no,
            replenishedAt:
              row.replenishmentId == null || held ? null : dayOf(row.replenishedAt ?? null),
            held,
          },
        ];
      }),
    );
  }

  /** The highest number ever handed out — deleted memos included: a number is never reused. */
  async maxNo(): Promise<number> {
    const top = await this.model
      .findOne({})
      .sort({ no: -1 })
      .select({ no: 1 })
      .lean<{ no: number }>()
      .exec();
    return top?.no ?? 0;
  }

  /**
   * A write to the memo itself, inside a receipt edit's transaction — a native `$inc` on a field no
   * DTO carries, so `__v` (and an edit dialog open on the memo) is untouched. A «استعاضة», a memo
   * edit or a memo delete running at the same moment writes the same document, so one of the two
   * transactions meets a write conflict and is retried: the receipt rule is never decided on a
   * memo state that is already stale. Copies `fleetVehicleRepository.lockForAccidentTransfer`.
   */
  async lockForReceipt(id: string, session: ClientSession): Promise<void> {
    await this.model.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $inc: { lockSeq: 1 } },
      { session },
    );
  }

  /**
   * Mark memos as taken by one «استعاضة عهدة» — only live ones no replenishment holds yet. `held`:
   * the replenishment waits for its transfer, and `date` is its letter's day. Returns how many were
   * marked; the caller compares it with how many it asked for and aborts its transaction on a
   * shortfall. `__v` moves, so an edit dialog open on the memo goes stale.
   */
  async markReplenished(
    ids: readonly string[],
    operationId: Types.ObjectId,
    date: Date,
    by: string | null,
    session: ClientSession,
    { held = false }: { held?: boolean } = {},
  ): Promise<number> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return 0;
    const result = await this.model
      .updateMany(
        {
          _id: { $in: valid.map((id) => new Types.ObjectId(id)) },
          isDeleted: false,
          replenishmentId: null,
        },
        {
          $set: {
            replenishmentId: operationId,
            replenishedAt: date,
            replenishmentHeld: held,
            updatedBy: by === null ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** The live memos `operationId` holds while it waits for its transfer, among `ids`. */
  private heldBy(
    ids: readonly string[],
    operationId: Types.ObjectId,
  ): FilterQuery<FleetCustodyMemoDoc> {
    const valid = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    return {
      _id: { $in: valid.map((id) => new Types.ObjectId(id)) },
      isDeleted: false,
      replenishmentId: operationId,
      replenishmentHeld: true,
    };
  }

  /**
   * «تأكيد التحويل»: the memos a held replenishment took are replenished from the transfer's day —
   * only those it still holds. Returns how many moved; the caller checks the count.
   */
  async markTransferred(
    ids: readonly string[],
    operationId: Types.ObjectId,
    day: Date,
    by: string | null,
    session: ClientSession,
  ): Promise<number> {
    const result = await this.model
      .updateMany(
        this.heldBy(ids, operationId),
        {
          $set: {
            replenishmentHeld: false,
            replenishedAt: day,
            updatedBy: by === null ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * «إلغاء الاستعاضة المعلّقة»: the memos a held replenishment took are free again — back to «لم
   * تُستعَض بعد», editable, and offered to the next replenishment. Returns how many were freed.
   */
  async releaseHeld(
    ids: readonly string[],
    operationId: Types.ObjectId,
    by: string | null,
    session: ClientSession,
  ): Promise<number> {
    const result = await this.model
      .updateMany(
        this.heldBy(ids, operationId),
        {
          $set: {
            replenishmentId: null,
            replenishedAt: null,
            replenishmentHeld: false,
            updatedBy: by === null ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }
}

/**
 * A memo a replenishment took can no longer be changed or deleted (422) — while it waits for the
 * transfer, and after.
 */
export const assertCustodyMemoWritable = (
  memo: Pick<FleetCustodyMemoDoc, 'no' | 'replenishmentId' | 'replenishedAt' | 'replenishmentHeld'>,
): void => {
  if (memo.replenishmentId == null) return;
  const day = dayOf(memo.replenishedAt ?? null);
  if (memo.replenishmentHeld === true) {
    throw new BusinessRuleError(
      `custody memo ${memo.no} is held by a replenishment${day === null ? '' : ` of ${day}`} waiting for its transfer — it cannot be changed or deleted unless that replenishment is cancelled`,
    );
  }
  throw new BusinessRuleError(
    `custody memo ${memo.no} was replenished${day === null ? '' : ` on ${day}`} — it can no longer be changed or deleted`,
  );
};

export const fleetCustodyMemoRepository = new FleetCustodyMemoRepository();
