// Who the receipt names — «الإسم», «الوظيفة» and the identity line «بطاقة رقم قومي … صادرة من
// قسم … – …» — read once, through the platform seams.
//
// HR's facts arrive through the directory (IT never imports HR); the job title's, department's
// and section's NAMES through the organization catalogue they belong to. All of it is read
// OUTSIDE any custody transaction, for the reason the assign path already gives: another module's
// data has no business holding a custody write open.
//
// Nothing here refuses. An employee the directory cannot read — a deployment with no HR source —
// gives a receipt with those lines left blank for the pen, exactly as the paper form has always
// been filled in; whether a LEAVER may receive custody is the custody service's rule, decided on
// the `employee` this hands back.
import {
  getDirectoryEmployee,
  getDirectoryIdentityFacts,
  searchDirectoryEmployees,
  type DirectoryEmployee,
} from '../../../platform/directory';
import {
  departmentRepository,
  jobTitleRepository,
  sectionRepository,
} from '../../../platform/organization';

type Name = { ar: string; en: string };

export interface ReceiptHolder {
  /** HR's answer, or null when it has none — what the leaver rule is judged on. */
  employee: DirectoryEmployee | null;
  employeeCode: string | null;
  employeeName: string | null;
  jobTitle: Name | null;
  /**
   * «بطاقة رقم قومي» — RAW. Kept on the receipt the paper prints from; who may SEE it is the
   * receipt's egress rule (`itAsset.viewNationalId`), never this read's.
   */
  nationalId: string | null;
  /** «صادرة من قسم …» — the employee's section, when HR files them under one. */
  section: Name | null;
  /** «– …» — the department («الإدارة») the employee works in. */
  department: Name | null;
}

/** One organization unit's name, or null for no id or a unit no longer on file. */
const nameOf = async (
  repository: { findByIdsSystem: (ids: readonly string[]) => Promise<{ name: Name }[]> },
  id: string | null,
): Promise<Name | null> => {
  if (id === null) return null;
  const [unit] = await repository.findByIdsSystem([id]);
  return unit === undefined ? null : { ar: unit.name.ar, en: unit.name.en };
};

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
  const facts = await getDirectoryIdentityFacts(employeeId);
  const [jobTitle, department, section] = await Promise.all([
    nameOf(jobTitleRepository, listing?.jobTitleId ?? null),
    nameOf(departmentRepository, employee?.departmentId ?? null),
    nameOf(sectionRepository, facts?.sectionId ?? null),
  ]);
  return {
    employee,
    employeeCode: employee?.code ?? null,
    employeeName: employee?.fullNameAr ?? null,
    jobTitle,
    nationalId: facts?.nationalId ?? null,
    section,
    department,
  };
};
