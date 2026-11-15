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

  /**
   * Round 21b — the seals of every custody the treasury HOLDS now, and whose they are: `state:
   * 'held'` on a row not cancelled (a cancel soft-deletes it) — the vault inventory's own set
   * (`listHeld`), served by `ix_state`. Only the two seal lists and the shipment travel: the vault
   * holds hundreds of محصنات at most, so a receipt's seals are compared against these in memory
   * (`vaultSealKey` cannot be asked of an index without storing a second copy of every seal).
   * Oldest received first, so a seal held twice (receipts taken before this rule) is answered by
   * the receipt that took it first.
   */
  async findHeldSeals(
    excludeShipmentId?: string,
    session?: ClientSession,
  ): Promise<Pick<OperationsVaultCustodyDoc, 'shipmentId' | 'bagSeals' | 'boxSeals'>[]> {
    return this.model
      .find({
        state: 'held',
        isDeleted: false,
        ...(excludeShipmentId === undefined ? {} : { shipmentId: { $ne: excludeShipmentId } }),
      })
      .select({ shipmentId: 1, bagSeals: 1, boxSeals: 1 })
      .sort({ receivedAt: 1, _id: 1 })
      .session(session ?? null)
      .lean<Pick<OperationsVaultCustodyDoc, 'shipmentId' | 'bagSeals' | 'boxSeals'>[]>()
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
