// Data access only (ADR-003).
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { JobPapersModel, type JobPaperOverride, type JobPapersDoc } from './job-papers.model';

const idOrNull = (id: string | null): Types.ObjectId | null => (id === null ? null : new Types.ObjectId(id));

class JobPapersRepository extends BaseRepository<JobPapersDoc> {
  constructor() {
    super(JobPapersModel, {});
  }

  /** The line of a job in a department; `departmentId` null — the job-wide line. */
  async findLine(departmentId: string | null, jobTitleId: string): Promise<JobPapersDoc | null> {
    return this.model
      .findOne({ departmentId: idOrNull(departmentId), jobTitleId: new Types.ObjectId(jobTitleId), isDeleted: false })
      .lean<JobPapersDoc>()
      .exec();
  }

  /**
   * What «مستندات الوظائف» set for a job in a department: the department's own line, else the
   * job-wide one, else null — the job follows its templates.
   */
  async overrideOf(departmentId: string | null, jobTitleId: string): Promise<JobPaperOverride | null> {
    const own = departmentId === null ? null : await this.findLine(departmentId, jobTitleId);
    const row = own ?? (await this.findLine(null, jobTitleId));
    return row === null ? null : { added: row.added, removed: row.removed };
  }

  async listAll(): Promise<JobPapersDoc[]> {
    return this.model.find({ isDeleted: false }).lean<JobPapersDoc[]>().exec();
  }
}

export const jobPapersRepository = new JobPapersRepository();
