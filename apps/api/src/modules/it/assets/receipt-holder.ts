// Who the receipt names — «الإسم» and «الوظيفة» — read once, through the platform seams.
//
// HR's facts arrive through the directory (IT never imports HR); the job title's NAME through the
// organization catalogue the title belongs to. Both are read OUTSIDE any custody transaction, for
// the reason the assign path already gives: another module's data has no business holding a
// custody write open.
//
// Nothing here refuses. An employee the directory cannot read — a deployment with no HR source —
// gives a receipt with the name left blank for the pen, exactly as the paper form has always
// been filled in; whether a LEAVER may receive custody is the custody service's rule, decided on
// the `employee` this hands back.
import {
  getDirectoryEmployee,
  searchDirectoryEmployees,
  type DirectoryEmployee,
} from '../../../platform/directory';
import { jobTitleRepository } from '../../../platform/organization';

export interface ReceiptHolder {
  /** HR's answer, or null when it has none — what the leaver rule is judged on. */
  employee: DirectoryEmployee | null;
  employeeCode: string | null;
  employeeName: string | null;
  jobTitle: { ar: string; en: string } | null;
}

export const readReceiptHolder = async (employeeId: string): Promise<ReceiptHolder> => {
  // The listing carries the job title; the plain lookup is the fallback for a source that only
  // answers by id.
  const page = await searchDirectoryEmployees({
    employeeIds: [employeeId],
    status: 'all',
    page: 1,
    pageSize: 1,
  });
  const listing = page.items[0] ?? null;
  const employee = listing ?? (await getDirectoryEmployee(employeeId));
  const jobTitleId = listing?.jobTitleId ?? null;
  const [title] = jobTitleId === null ? [] : await jobTitleRepository.findByIdsSystem([jobTitleId]);
  return {
    employee,
    employeeCode: employee?.code ?? null,
    employeeName: employee?.fullNameAr ?? null,
    jobTitle: title === undefined ? null : { ar: title.name.ar, en: title.name.en },
  };
};
