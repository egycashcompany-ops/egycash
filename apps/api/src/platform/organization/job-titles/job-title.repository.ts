import { BaseRepository } from '../../../shared/base/base.repository';
import { JobTitleModel, type JobTitleDoc } from './job-title.model';

class JobTitleRepository extends BaseRepository<JobTitleDoc> {
  constructor() {
    super(JobTitleModel, {}); // organization-level catalog: branch scope = organization
  }

  /**
   * The ACTIVE job titles that require a driving test — the seats whose occupant drives.
   *
   * `requiresDrivingTest` is where this company already says which roles are driving roles: the
   * job-title form calls it "the single place driver-ness is decided", and recruitment reads it as
   * `isDriver` to decide which documents a candidate is asked for. Fleet asks the same flag rather
   * than keeping a second list of driving titles, or matching «سائق» in a name that can be written
   * more than one way.
   *
   * System-level and unscoped: the caller is another feature asking who the company's drivers are,
   * not a person browsing the catalog. Inactive titles are excluded — a retired seat has no
   * current occupant to put on the road.
   */
  async idsRequiringDrivingTestSystem(): Promise<string[]> {
    const rows = await this.model
      .find({ requiresDrivingTest: true, status: 'active', isDeleted: false })
      .select({ _id: 1 })
      .lean<{ _id: unknown }[]>()
      .exec();
    return rows.map((row) => String(row._id));
  }
}

export const jobTitleRepository = new JobTitleRepository();
