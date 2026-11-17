import { type Types } from 'mongoose';
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

  /**
   * Every ACTIVE job title's id and Arabic name — for a feature that links its own rows to jobs by
   * name (the hiring papers, A27). System-level and unscoped, as above.
   */
  async activeNamesSystem(): Promise<{ _id: Types.ObjectId; name: { ar: string } }[]> {
    return this.model
      .find({ status: 'active', isDeleted: false })
      .select({ _id: 1, name: 1 })
      .lean<{ _id: Types.ObjectId; name: { ar: string } }[]>()
      .exec();
  }

  /**
   * Every ACTIVE job title that has a fixed salary («الراتب الثابت») — the salary an offer starts
   * from for that job. System-level and unscoped, as above.
   */
  async activeFixedSalariesSystem(): Promise<{ jobTitleId: string; amount: number; currency: string }[]> {
    const rows = await this.model
      .find({ status: 'active', isDeleted: false, fixedSalary: { $ne: null } })
      .select({ _id: 1, fixedSalary: 1 })
      .lean<{ _id: Types.ObjectId; fixedSalary: { amount: number; currency: string } | null }[]>()
      .exec();
    return rows.flatMap((row) =>
      row.fixedSalary === null
        ? []
        : [{ jobTitleId: String(row._id), amount: row.fixedSalary.amount, currency: row.fixedSalary.currency }],
    );
  }
}

export const jobTitleRepository = new JobTitleRepository();
