import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetAccidentModel, type FleetAccidentDoc } from './accident.model';

class FleetAccidentRepository extends BaseRepository<FleetAccidentDoc> {
  constructor() {
    super(FleetAccidentModel, {});
  }

  async listAccidents(params: ListParams<FleetAccidentDoc>): Promise<Paginated<FleetAccidentDoc>> {
    return this.list({ ...params, sortableFields: ['occurredAt', 'createdAt'] });
  }

  accidentFilter(query: {
    vehicleId?: string | undefined;
    status?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetAccidentDoc> {
    const clauses: FilterQuery<FleetAccidentDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.status !== undefined) clauses.push({ status: query.status });
    if (query.from !== undefined) clauses.push({ occurredAt: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ occurredAt: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetAccidentRepository = new FleetAccidentRepository();
