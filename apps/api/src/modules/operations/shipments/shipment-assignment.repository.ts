import { Types, type ClientSession } from 'mongoose';
import { type OperationsExecutionStatus, type OperationsShipmentLeg } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsShipmentAssignmentModel,
  type OperationsShipmentAssignmentDoc,
} from './shipment-assignment.model';
import { OperationsShipmentModel } from './shipment.model';

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
   * Round 30 critic — the SECURED shipments whose LIVE delivery leg rides a crew row of one day:
   * what a past day's record lists beside the ones due on it (distribution.service.ts `view`). Ids
   * only, the day's delivery legs alone (`ix_day_captain`'s day prefix), joined to the shipments
   * here so a day's daily legs — pickup and delivery, as many as the day carries — never come back,
   * nor reach the record's `$in`.
   */
  async securedDeliveryShipmentIdsOfDay(operationsDayId: Types.ObjectId): Promise<string[]> {
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId }>([
        { $match: { operationsDayId, leg: 'delivery', isDeleted: false } },
        { $group: { _id: '$shipmentId' } },
        {
          $lookup: {
            from: OperationsShipmentModel.collection.collectionName,
            localField: '_id',
            foreignField: '_id',
            pipeline: [
              { $match: { shipmentType: 'secured', isDeleted: false } },
              { $project: { _id: 1 } },
            ],
            as: 'secured',
          },
        },
        { $match: { 'secured.0': { $exists: true } } },
        { $project: { _id: 1 } },
      ])
      .exec();
    return rows.map((row) => String(row._id));
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

  /**
   * Every assignment on a SET of shipments — the reports' captain attribution, in one round trip.
   *
   * Both legs come back and the caller picks the one its shipment type reports on: a secured
   * shipment usually has a pickup leg too, and reporting it under the collecting captain instead
   * of the delivering one would silently move a month's work between people.
   */
  async findByShipments(shipmentIds: string[]): Promise<OperationsShipmentAssignmentDoc[]> {
    if (shipmentIds.length === 0) return [];
    return this.model
      .find({ shipmentId: { $in: shipmentIds }, isDeleted: false })
      .lean<OperationsShipmentAssignmentDoc[]>()
      .exec();
  }

  /**
   * EVERY leg one shipment ever had — live and RETIRED (Round 12: «توزيع المحصنات» retires the
   * delivery leg of a shipment taken off its van) — oldest first, through `ix_shipment_all_legs`.
   * For the action log only: every other read asks for the live legs, which are the plan.
   */
  async findAllByShipment(shipmentId: string): Promise<OperationsShipmentAssignmentDoc[]> {
    return this.model
      .find({ shipmentId: new Types.ObjectId(shipmentId) })
      .sort({ leg: 1, createdAt: 1, _id: 1 })
      .lean<OperationsShipmentAssignmentDoc[]>()
      .exec();
  }

  /**
   * Round 24 — every LIVE leg riding one crew row: what follows the row when it is given a van
   * (crew.service.ts `plan`). Delivered or not — a leg copies its row's van, whatever its state.
   */
  async findLiveByCrew(
    crewAssignmentId: string,
    session?: ClientSession,
  ): Promise<OperationsShipmentAssignmentDoc[]> {
    return this.model
      .find({ crewAssignmentId: new Types.ObjectId(crewAssignmentId), isDeleted: false })
      .session(session ?? null)
      .lean<OperationsShipmentAssignmentDoc[]>()
      .exec();
  }

  /**
   * Round 24 — how many LIVE legs ride each of these crew rows: a row that holds any is not
   * removed from the board (crew.service.ts `plan`). Rows holding none are absent from the map.
   */
  async countLiveByCrew(
    crewAssignmentIds: readonly string[],
    session?: ClientSession,
  ): Promise<Map<string, number>> {
    if (crewAssignmentIds.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            crewAssignmentId: { $in: crewAssignmentIds.map((id) => new Types.ObjectId(id)) },
            isDeleted: false,
          },
        },
        { $group: { _id: '$crewAssignmentId', count: { $sum: 1 } } },
      ])
      .session(session ?? null)
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  /**
   * Round 33 B — the live legs whose captain confirmed «تم التسليم» within `[from, before)` and that
   * still say so (delivered, or completed after it). Which of them carried a shipment TO ITS BANK is
   * the caller's to decide (`deliveryLegOf`: a daily's pickup leg, a محصنة's delivery leg — a secured
   * pickup leg delivers to the vault). Through `ix_delivered_at_live`.
   */
  async deliveredBetween(from: Date, before: Date): Promise<OperationsShipmentAssignmentDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        deliveredAt: { $gte: from, $lt: before },
        executionStatus: { $in: ['delivered', 'completed'] },
      })
      .lean<OperationsShipmentAssignmentDoc[]>()
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
