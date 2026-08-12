import { BaseRepository } from '../../shared/base/base.repository';
import { ApplicationSectionModel, type ApplicationSectionDoc } from './application-section.model';

class ApplicationSectionRepository extends BaseRepository<ApplicationSectionDoc> {
  constructor() {
    super(ApplicationSectionModel, {}); // platform-level catalog: scope = organization
  }
}

export const applicationSectionRepository = new ApplicationSectionRepository();
