import { type ClientSession, type Types } from 'mongoose';
import { type OperationsShipmentLeg } from '@ecms/contracts';
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
