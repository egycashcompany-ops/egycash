import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import {
  DRIVER_PROFILE_KIND,
  FleetDriverProfileModel,
  type FleetDriverProfileDoc,
} from './driver-profile.model';

class FleetDriverProfileRepository extends BaseRepository<FleetDriverProfileDoc> {
  constructor() {
    // Organization-level: a driver's placement (and therefore scoping) is an HR fact read
    // through the directory seam, not a copy this collection re-scopes on.
    super(FleetDriverProfileModel, {});
  }

  async findDriverByEmployeeId(employeeId: string): Promise<FleetDriverProfileDoc | null> {
    return this.model
      .findOne({
        employeeId: new Types.ObjectId(employeeId),
        kind: DRIVER_PROFILE_KIND,
        isDeleted: false,
      })
      .lean<FleetDriverProfileDoc>()
      .exec();
  }

  async listDrivers(
    params: ListParams<FleetDriverProfileDoc>,
  ): Promise<Paginated<FleetDriverProfileDoc>> {
    const kindFilter: FilterQuery<FleetDriverProfileDoc> = { kind: DRIVER_PROFILE_KIND };
    return this.list({
      ...params,
      filter: { $and: [kindFilter, params.filter ?? {}] },
      sortableFields: ['createdAt', 'licenseExpiresAt'],
    });
  }
}

export const fleetDriverProfileRepository = new FleetDriverProfileRepository();
