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

  /**
   * Every driver profile for a KNOWN set of employees, in one query.
   *
   * The registry's roster comes from the org chart and the profiles come from here, so the two are
   * joined in the service rather than in the database — FR-11 puts them in different modules. This
   * is the second half of that join: unpaginated on purpose, because the ids are a roster the
   * caller already holds and there is no list to bound.
   */
  async findForEmployeesSystem(employeeIds: readonly string[]): Promise<FleetDriverProfileDoc[]> {
    if (employeeIds.length === 0) return [];
    return this.model
      .find({
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        kind: DRIVER_PROFILE_KIND,
        isDeleted: false,
      })
      .lean<FleetDriverProfileDoc[]>()
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
