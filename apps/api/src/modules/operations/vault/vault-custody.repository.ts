import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsVaultCustodyModel,
  type OperationsVaultCustodyDoc,
} from './vault-custody.model';

class OperationsVaultCustodyRepository extends BaseRepository<OperationsVaultCustodyDoc> {
  constructor() {
    super(OperationsVaultCustodyModel, {});
  }

  async findByShipment(
    shipmentId: string,
    session?: ClientSession,
  ): Promise<OperationsVaultCustodyDoc | null> {
    return this.model
      .findOne({ shipmentId, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsVaultCustodyDoc>()
      .exec();
  }

  /**
   * Every custody received in [from, toExclusive), held or released, newest first — served by
   * `ix_received_at`. Cancelled receipts are OUT: a cancel stamps `cancelledAt` and soft-deletes the
   * row in one write (vault-custody.service.ts), so `isDeleted: false` is what leaves them out. The
   * vault roll-up reads a whole period with it, unpaged like the captain and bank reports.
   */
  async findReceivedBetween(from: Date, toExclusive: Date): Promise<OperationsVaultCustodyDoc[]> {
    return this.model
      .find({ receivedAt: { $gte: from, $lt: toExclusive }, isDeleted: false })
      .sort({ receivedAt: -1 })
      .lean<OperationsVaultCustodyDoc[]>()
      .exec();
  }

  /**
   * EVERY custody the treasury ever took for one shipment — the live one AND any cancelled receipt
   * (Round 10), oldest received first — served by `ix_shipment_received`. For the action log only:
   * every other read is about what is held now, and asks `isDeleted: false`.
   */
  async findHistoryByShipment(shipmentId: string): Promise<OperationsVaultCustodyDoc[]> {
    return this.model
      .find({ shipmentId })
      .sort({ receivedAt: 1, _id: 1 })
      .lean<OperationsVaultCustodyDoc[]>()
      .exec();
  }

  /** Custody for a SET of shipments — the reports' package counts, in one round trip. */
  async findByShipments(shipmentIds: string[]): Promise<OperationsVaultCustodyDoc[]> {
    if (shipmentIds.length === 0) return [];
    return this.model
      .find({ shipmentId: { $in: shipmentIds }, isDeleted: false })
      .lean<OperationsVaultCustodyDoc[]>()
      .exec();
  }
}

export const operationsVaultCustodyRepository = new OperationsVaultCustodyRepository();
