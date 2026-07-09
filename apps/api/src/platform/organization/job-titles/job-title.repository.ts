import { BaseRepository } from '../../../shared/base/base.repository';
import { JobTitleModel, type JobTitleDoc } from './job-title.model';

class JobTitleRepository extends BaseRepository<JobTitleDoc> {
  constructor() {
    super(JobTitleModel, {}); // organization-level catalog: branch scope = organization
  }
}

export const jobTitleRepository = new JobTitleRepository();
