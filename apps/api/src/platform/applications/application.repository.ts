import { BaseRepository } from '../../shared/base/base.repository';
import { ApplicationModel, type ApplicationDoc } from './application.model';

class ApplicationRepository extends BaseRepository<ApplicationDoc> {
  constructor() {
    super(ApplicationModel, {}); // platform-level catalog: scope = organization
  }
}

export const applicationRepository = new ApplicationRepository();
