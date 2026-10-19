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
   * A replenished memo is frozen — riding inside the same atomic write as every edit and delete,
   * so a «استعاضة» landing a moment earlier cannot be overtaken by a request that read the memo
   * before it.
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

  /** id → the receipts screen's link («مذكرة … رقم N», and its replenishment's day). */
  async linksByIds(ids: readonly string[]): Promise<Map<string, FleetReceiptMemoLinkDto>> {
    const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .select({ no: 1, replenishmentId: 1, replenishedAt: 1 })
      .lean<
        {
          _id: Types.ObjectId;
          no: number;
          replenishmentId?: Types.ObjectId | null;
          replenishedAt?: Date | null;
        }[]
      >()
      .exec();
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          id: String(row._id),
          no: row.no,
          replenishedAt: row.replenishmentId == null ? null : dayOf(row.replenishedAt ?? null),
        },
      ]),
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
   * Mark memos as brought back by one «استعاضة عهدة» — only live ones not replenished yet. Returns
   * how many were marked; the caller compares it with how many it asked for and aborts its
   * transaction on a shortfall. `__v` moves, so an edit dialog open on the memo goes stale.
   */
  async markReplenished(
    ids: readonly string[],
    operationId: Types.ObjectId,
    date: Date,
    by: string | null,
    session: ClientSession,
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

/** A replenished memo can no longer be changed or deleted (422). */
export const assertCustodyMemoWritable = (
  memo: Pick<FleetCustodyMemoDoc, 'no' | 'replenishmentId' | 'replenishedAt'>,
): void => {
  if (memo.replenishmentId != null) {
    const day = dayOf(memo.replenishedAt ?? null);
    throw new BusinessRuleError(
      `custody memo ${memo.no} was replenished${day === null ? '' : ` on ${day}`} — it can no longer be changed or deleted`,
    );
  }
};

export const fleetCustodyMemoRepository = new FleetCustodyMemoRepository();
