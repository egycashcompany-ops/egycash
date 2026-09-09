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

  /**
   * WHICH of these drivers are covered on this date — one query for a whole board.
   *
   * `existsCovering` above answers for ONE driver, which is right for a save checking a handful.
   * A board asks for every driver in the fleet, and asking one at a time made the overlay cost a
   * round trip per driver: the roster loop is the reason this exists.
   */
  async coveredOn(employeeIds: readonly string[], date: Date): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.model
      .find({
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
        ...this.coversDateFilter(date),
      })
      .select({ employeeId: 1 })
      .lean<{ employeeId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row.employeeId)));
  }

  async listSpans(
    params: ListParams<FleetUnavailabilityDoc>,
  ): Promise<Paginated<FleetUnavailabilityDoc>> {
    return this.list({ ...params, sortableFields: ['from', 'to', 'createdAt'] });
  }
}

export const fleetUnavailabilityRepository = new FleetUnavailabilityRepository();
