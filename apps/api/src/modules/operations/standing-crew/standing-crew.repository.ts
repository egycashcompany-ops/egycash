import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  OperationsStandingCrewModel,
  type OperationsStandingCrewDoc,
} from './standing-crew.model';

class OperationsStandingCrewRepository extends BaseRepository<OperationsStandingCrewDoc> {
  constructor() {
    super(OperationsStandingCrewModel, {}); // organization-wide, like the crew board it feeds
  }

  /** The whole standing crew. Bounded by the size of the cash-transfer fleet — tens of rows. */
  async findAll(session?: ClientSession): Promise<OperationsStandingCrewDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .session(session ?? null)
      .lean<OperationsStandingCrewDoc[]>()
      .exec();
  }

  async findByVehicle(
    vehicleId: string,
    session?: ClientSession,
  ): Promise<OperationsStandingCrewDoc | null> {
    return this.model
      .findOne({ vehicleId, isDeleted: false })
      .session(session ?? null)
      .lean<OperationsStandingCrewDoc | null>()
      .exec();
  }
}

export const operationsStandingCrewRepository = new OperationsStandingCrewRepository();
