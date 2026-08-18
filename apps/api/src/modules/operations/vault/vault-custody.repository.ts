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
