import { Types, type ClientSession } from 'mongoose';
import { type OperationsExecutionStatus, type OperationsShipmentLeg } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsShipmentAssignmentModel,
  type OperationsShipmentAssignmentDoc,
} from './shipment-assignment.model';

class OperationsShipmentAssignmentRepository extends BaseRepository<OperationsShipmentAssignmentDoc> {
  constructor() {
    super(OperationsShipmentAssignmentModel, {});
  }

  /** One captain's ordered stops for a day+leg — the mobile read and the reorder's source set. */
  async findForCaptainDay(
    operationsDayId: Types.ObjectId | string,
    captainEmployeeId: string,
    leg: OperationsShipmentLeg,
    session?: ClientSession,
  ): Promise<OperationsShipmentAssignmentDoc[]> {
    return this.model
      .find({ operationsDayId, captainEmployeeId, leg, isDeleted: false })
      .sort({ sequence: 1 })
      .session(session ?? null)
      .lean<OperationsShipmentAssignmentDoc[]>()
      .exec();
  }

  /** All of a day's assignments, any captain — the route read joins crew rows off these. */
  async findForDay(
    operationsDayId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<OperationsShipmentAssignmentDoc[]> {
    return this.model
      .find({ operationsDayId, isDeleted: false })
      .sort({ sequence: 1 })
      .session(session ?? null)
      .lean<OperationsShipmentAssignmentDoc[]>()
      .exec();
  }

  /**
   * Park a row on a temporary NEGATIVE position inside the reorder transaction.
   *
   * Deliberately version-free: the caller has already version-checked the client's intent, and the
   * park is an internal half-step of one atomic operation, not a user-visible edit. Positions are
   * negative so they cannot collide with any real (positive) position under the unique index.
   */
  async parkSequence(id: string, sequence: number, session: ClientSession): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $set: { sequence } })
      .session(session)
      .exec();
  }

  /**
   * Advance execution by COMPARE-AND-SWAP on the state itself (OP-7).
   *
   * The expected `from` state is part of the FILTER, so the transition is the atomic unit: two
   * concurrent callers cannot both move the same stop, because the second one matches no document
   * and gets `null`. That is stronger than a version check for this operation — a version says
   * "nobody wrote this row", while this says "the row is still in the state your transition is
   * legal from", which is the precondition that actually matters. `version` is still honoured when
   * the caller supplies one, so the standard optimistic-concurrency contract is not weakened.
   *
   * `pending` also matches a row written before this field existed: an OP-5 assignment has no
   * `executionStatus`, and it has plainly not been started.
   */
  async advanceExecution(
    id: string,
    from: OperationsExecutionStatus,
    set: Partial<OperationsShipmentAssignmentDoc>,
    meta: { by: string; version?: number | undefined; session?: ClientSession | undefined },
  ): Promise<OperationsShipmentAssignmentDoc | null> {
    const stateFilter =
      from === 'pending'
        ? { $or: [{ executionStatus: 'pending' }, { executionStatus: { $exists: false } }] }
        : { executionStatus: from };
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          isDeleted: false,
          ...(meta.version === undefined ? {} : { __v: meta.version }),
          ...stateFilter,
        },
        {
          $set: { ...set, updatedBy: new Types.ObjectId(meta.by) },
          $inc: { __v: 1 },
        },
        { new: true, session: meta.session ?? null },
      )
      .lean<OperationsShipmentAssignmentDoc>()
      .exec();
  }

  async findByShipmentAndLeg(
    shipmentId: string,
    leg: OperationsShipmentLeg,
    session?: ClientSession,
  ): Promise<OperationsShipmentAssignmentDoc | null> {
    return this.model
      .findOne({ shipmentId, leg, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsShipmentAssignmentDoc>()
      .exec();
  }
}

export const operationsShipmentAssignmentRepository =
  new OperationsShipmentAssignmentRepository();
