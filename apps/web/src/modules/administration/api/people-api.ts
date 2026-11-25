// The people the module names (§7.8), read through its own endpoint under its own keys — never
// HR's list under `employee.view`. `GET /administration/people` offers only those who work here
// today, within the reach of the warehouse write keys the reader holds; it takes no status, so a new
// keeper is never a leaver.
import { type AdministrationPersonDto, type Paginated } from '@ecms/contracts';
import { buildQuery, getPage } from '../../../shared/lib/api-client';

/** The picker's few rows for what was typed. */
export const PEOPLE_PICKER_ROWS = 8;

export const searchPeople = (search: string): Promise<Paginated<AdministrationPersonDto>> =>
  getPage<AdministrationPersonDto>(
    `/administration/people${buildQuery({ search, pageSize: PEOPLE_PICKER_ROWS })}`,
  );
