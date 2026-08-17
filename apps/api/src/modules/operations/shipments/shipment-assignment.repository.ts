import { type ClientSession } from 'mongoose';
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
