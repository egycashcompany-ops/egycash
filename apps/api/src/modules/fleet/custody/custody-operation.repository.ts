import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type FleetCustodyOperationKind, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetCustodyOperationModel,
  type FleetCustodyOperationCancellationDoc,
  type FleetCustodyOperationDeletionDoc,
  type FleetCustodyOperationDoc,
  type FleetCustodyOperationTransferDoc,
} from './custody-operation.model';

/** «العمليات المحذوفة» as the repository reads it — the bounds are instants, already Cairo's. */
export interface DeletedOperationsQuery {
  kinds?: readonly FleetCustodyOperationKind[] | undefined;
  /** Deleted at or after this instant. */
  from?: Date | undefined;
  /** Deleted strictly before this instant. */
  before?: Date | undefined;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** What a held replenishment becomes: transferred, or cancelled. */
export type LeaveHeld =
  | { status: 'done'; transfer: FleetCustodyOperationTransferDoc }
  | { status: 'cancelled'; cancellation: FleetCustodyOperationCancellationDoc };

class FleetCustodyOperationRepository extends BaseRepository<FleetCustodyOperationDoc> {
  constructor() {
    // No org placement of its own: the fund is the department's, and who may read it is decided
    // by `fleetCustody.view` alone.
    super(FleetCustodyOperationModel, {});
  }

  /** Every live operation, in the ledger's order: day, then the order they were recorded in. */
  async allLive(session?: ClientSession): Promise<FleetCustodyOperationDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .session(session ?? null)
      .lean<FleetCustodyOperationDoc[]>()
      .exec();
  }

  /** One live operation, read inside `session`; `null` for a malformed, missing or deleted id. */
  async findLive(id: string, session?: ClientSession): Promise<FleetCustodyOperationDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .session(session ?? null)
      .lean<FleetCustodyOperationDoc>()
      .exec();
  }

  /**
   * Move a held replenishment on — only while it IS held: the condition rides inside the write, so
   * of two moves racing on one replenishment exactly one lands. `false` when it was no longer
   * held. Only the status and its own fact are written; every frozen figure stays as printed.
   */
  async leaveHeld(
    id: Types.ObjectId,
    next: LeaveHeld,
    by: string | null,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: id, isDeleted: false, kind: 'replenish', status: 'held' },
        {
          $set: { ...next, updatedBy: by === null ? null : new Types.ObjectId(by) },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * «حذف العملية» — only while the operation is live AND still at the version the dialog read: the
   * condition rides inside the write, so of a delete and a confirm, a cancel or another delete
   * racing on one operation exactly one lands. `false` when it missed. The base fields say it is
   * deleted (every read filters them); `deletion` says who, when, why and the fund around it. No
   * figure the letter printed is touched.
   */
  async markDeleted(
    id: Types.ObjectId,
    version: number,
    deletion: FleetCustodyOperationDeletionDoc,
    by: string | null,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { _id: id, isDeleted: false, __v: version },
        {
          $set: {
            isDeleted: true,
            deletedAt: deletion.at,
            deletedBy: deletion.by,
            deletion,
            updatedBy: by === null || !Types.ObjectId.isValid(by) ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** One DELETED operation; `null` for a malformed, missing or live id. */
  async findDeleted(id: string): Promise<FleetCustodyOperationDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: true })
      .lean<FleetCustodyOperationDoc>()
      .exec();
  }

  /** How many operations «العمليات المحذوفة» holds — the toolbar pill. */
  async countDeleted(): Promise<number> {
    return this.model.countDocuments({ isDeleted: true }).exec();
  }

  /**
   * «العمليات المحذوفة» — one page, by the instant of the delete (`deletedAt`, the same instant as
   * `deletion.at`), `_id` closing the order so a page never repeats or drops a row.
   */
  async listDeleted(query: DeletedOperationsQuery): Promise<Paginated<FleetCustodyOperationDoc>> {
    const at: { $gte?: Date; $lt?: Date } = {};
    if (query.from !== undefined) at.$gte = query.from;
    if (query.before !== undefined) at.$lt = query.before;
    const filter: FilterQuery<FleetCustodyOperationDoc> = {
      isDeleted: true,
      ...(query.kinds === undefined || query.kinds.length === 0
        ? {}
        : { kind: { $in: [...query.kinds] } }),
      ...(Object.keys(at).length === 0 ? {} : { deletedAt: at }),
    };
    const dir = query.dir === 'asc' ? 1 : -1;
    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .sort({ deletedAt: dir, _id: dir })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<FleetCustodyOperationDoc[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }
}

export const fleetCustodyOperationRepository = new FleetCustodyOperationRepository();
