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
}

export const operationsVaultCustodyRepository = new OperationsVaultCustodyRepository();
