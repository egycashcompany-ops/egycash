import { BaseRepository } from '../../../shared/base/base.repository';
import { JobPositionModel, type JobPositionDoc } from './job-position.model';

class JobPositionRepository extends BaseRepository<JobPositionDoc> {
  constructor() {
    super(JobPositionModel, {}); // organization-level master entity: scope = organization
  }
}

export const jobPositionRepository = new JobPositionRepository();
