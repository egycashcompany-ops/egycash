import { Types, type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetCustodyOperationModel,
  type FleetCustodyOperationCancellationDoc,
  type FleetCustodyOperationDoc,
  type FleetCustodyOperationTransferDoc,
} from './custody-operation.model';

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
}

export const fleetCustodyOperationRepository = new FleetCustodyOperationRepository();
