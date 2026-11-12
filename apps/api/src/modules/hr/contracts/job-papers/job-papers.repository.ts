// Data access only (ADR-003).
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { JobPapersModel, type JobPaperOverride, type JobPapersDoc } from './job-papers.model';

class JobPapersRepository extends BaseRepository<JobPapersDoc> {
  constructor() {
    super(JobPapersModel, {});
  }

  async findByJob(jobTitleId: string): Promise<JobPapersDoc | null> {
    return this.model
      .findOne({ jobTitleId: new Types.ObjectId(jobTitleId), isDeleted: false })
      .lean<JobPapersDoc>()
      .exec();
  }

  /** The job's override, or null when «مستندات الوظائف» never changed it. */
  async overrideOf(jobTitleId: string): Promise<JobPaperOverride | null> {
    const row = await this.findByJob(jobTitleId);
    return row === null ? null : { added: row.added, removed: row.removed };
  }

  async listAll(): Promise<JobPapersDoc[]> {
    return this.model.find({ isDeleted: false }).lean<JobPapersDoc[]>().exec();
  }
}

export const jobPapersRepository = new JobPapersRepository();
