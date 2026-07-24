import { BaseRepository } from '../../../shared/base/base.repository';
import { HolidayModel, type HolidayDoc } from './holiday.model';

class HolidayRepository extends BaseRepository<HolidayDoc> {
  constructor() {
    super(HolidayModel, {}); // organization-level calendar, no branch scope
  }
}

export const holidayRepository = new HolidayRepository();
