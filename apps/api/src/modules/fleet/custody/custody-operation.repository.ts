import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetCustodyOperationModel,
  type FleetCustodyOperationDoc,
} from './custody-operation.model';

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
}

export const fleetCustodyOperationRepository = new FleetCustodyOperationRepository();
