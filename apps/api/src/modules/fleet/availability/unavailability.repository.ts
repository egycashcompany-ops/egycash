import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetUnavailabilityModel, type FleetUnavailabilityDoc } from './unavailability.model';

class FleetUnavailabilityRepository extends BaseRepository<FleetUnavailabilityDoc> {
  constructor() {
    super(FleetUnavailabilityModel, {});
  }

  /** Rows whose [from, to] covers the date — the roster's availability question (§4.5). */
  coversDateFilter(date: Date): FilterQuery<FleetUnavailabilityDoc> {
    return { from: { $lte: date }, to: { $gte: date } };
  }

  async existsCovering(employeeId: string, date: Date): Promise<boolean> {
    const found = await this.model
      .findOne({
        employeeId: new Types.ObjectId(employeeId),
        isDeleted: false,
        ...this.coversDateFilter(date),
      })
      .select({ _id: 1 })
      .lean()
      .exec();
    return found !== null;
  }

  async listSpans(
    params: ListParams<FleetUnavailabilityDoc>,
  ): Promise<Paginated<FleetUnavailabilityDoc>> {
    return this.list({ ...params, sortableFields: ['from', 'to', 'createdAt'] });
  }
}

export const fleetUnavailabilityRepository = new FleetUnavailabilityRepository();
