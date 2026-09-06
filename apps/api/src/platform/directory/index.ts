// The employee-directory seam. Business modules may not import each other (module-hierarchy §1:
// Business Module → Business Module, never), yet Fleet must validate that a driver IS an HR
// employee and read HR leave for availability (fleet design §9.1, owner decision Q1). The same
// inversion `platform/auth/identity-seams` established: the OWNING module registers a closure
// here at load, and any module consumes it through the platform — neither imports the other.
//
// Unregistered behaviour is deliberate and asymmetric:
//   lookups  → null  (fail-closed: nothing can validate against an absent HR, so a driver
//              profile simply cannot be created in a deployment with no employee source)
//   leave    → false (best-effort read: availability degrades to fleet-owned records alone,
//              which is exactly what `fleet.availability.useHrLeave=false` means)

import { type AttendanceDayStatus } from '@ecms/contracts';

export interface DirectoryEmployee {
  employeeId: string;
  code: string;
  fullNameAr: string;
  /** HR employment status gates fleet eligibility regardless of the fleet-side profile switch. */
  status: 'probation' | 'active' | 'onLeave' | 'suspended' | 'exited';
  branchId: string | null;
  departmentId: string | null;
}

/**
 * One employee's answer for one day, as attendance already computed it. Deliberately a SUBSET of
 * HR's day record: a consumer of this seam gets the status and the covering-leave flag, not the
 * punches, the hours or the regularization trail — those are HR's screens to show.
 */
export interface DirectoryAttendanceDay {
  employeeId: string;
  status: AttendanceDayStatus;
  /** True when the day is covered by an approved/active leave request. */
  onLeave: boolean;
}

type EmployeeLookup = (employeeId: string) => Promise<DirectoryEmployee | null>;
/**
 * The batch shape, for LIST reads (IT-6). One query per page instead of one per row.
 *
 * A list screen that resolved names through the single lookup would issue an N+1 the moment
 * somebody paged it — which is why this is a separate registration rather than a loop over the
 * one above. Missing ids are simply absent from the map: a name that cannot be read is a name
 * the caller renders as nothing, never a row it drops.
 */
type EmployeeBatchLookup = (
  employeeIds: readonly string[],
) => Promise<Map<string, DirectoryEmployee>>;
type LeaveLookup = (employeeId: string, date: Date) => Promise<boolean>;
/**
 * A day's attendance answer for a SET of employees. Batch by design: the consumers are boards
 * that ask about a whole crew at once, and a per-employee call would make one screen N queries.
 *
 * Returns only the employees HR actually has a day record for. An ABSENT key is not "present" —
 * it is "attendance has not answered", which is a different thing and the caller must show it as
 * such rather than inventing a status.
 */
type AttendanceDayLookup = (
  employeeIds: string[],
  date: Date,
) => Promise<Map<string, DirectoryAttendanceDay>>;
/** The self lookup: which employee IS this login? Owned by HR, consumed by self-service surfaces. */
type SelfEmployeeLookup = (userId: string) => Promise<DirectoryEmployee | null>;
/**
 * Everyone currently employed in a set of departments.
 *
 * The seam's first LIST. Every lookup before it answers about one person a consumer already knew
 * to ask about; this one answers "who is in this part of the company" — which is the question a
 * module has to ask when membership of its roster is the org chart rather than a list it keeps.
 *
 * Employed only: an exited employee is not on anybody's roster, and making each consumer remember
 * to filter would be one forgotten filter away from crewing somebody who left.
 */
type EmployeesByDepartmentLookup = (departmentIds: string[]) => Promise<DirectoryEmployee[]>;

/**
 * Everyone EMPLOYED in a set of JOB TITLES — "who holds these seats".
 *
 * The sibling of the lookup above, asking along the other axis of the org chart. A department says
 * where somebody works; a job title says what they do, and some rosters are built from the second:
 * Fleet's drivers registry is every employee whose seat requires a driving test, because the
 * company already declares that on the job title and a second list of drivers would go stale the
 * first time somebody was hired.
 *
 * Employed only, for the reason the one above gives: a driver who has left is not on the road, and
 * making each consumer remember to filter is one forgotten filter away from dispatching them.
 */
type EmployeesByJobTitlesLookup = (jobTitleIds: string[]) => Promise<DirectoryEmployee[]>;

let employeeLookup: EmployeeLookup | null = null;
let employeeBatchLookup: EmployeeBatchLookup | null = null;
let leaveLookup: LeaveLookup | null = null;
let attendanceDayLookup: AttendanceDayLookup | null = null;
let selfEmployeeLookup: SelfEmployeeLookup | null = null;
let employeesByDepartmentLookup: EmployeesByDepartmentLookup | null = null;
let employeesByJobTitlesLookup: EmployeesByJobTitlesLookup | null = null;

/** Idempotent — the last registration wins, so a test can install a fake over the real one. */
export const registerEmployeeLookup = (lookup: EmployeeLookup): void => {
  employeeLookup = lookup;
};

export const registerEmployeeBatchLookup = (lookup: EmployeeBatchLookup): void => {
  employeeBatchLookup = lookup;
};

export const registerLeaveLookup = (lookup: LeaveLookup): void => {
  leaveLookup = lookup;
};

export const registerAttendanceDayLookup = (lookup: AttendanceDayLookup): void => {
  attendanceDayLookup = lookup;
};

export const registerSelfEmployeeLookup = (lookup: SelfEmployeeLookup): void => {
  selfEmployeeLookup = lookup;
};

export const registerEmployeesByDepartmentLookup = (
  lookup: EmployeesByDepartmentLookup,
): void => {
  employeesByDepartmentLookup = lookup;
};

export const registerEmployeesByJobTitlesLookup = (lookup: EmployeesByJobTitlesLookup): void => {
  employeesByJobTitlesLookup = lookup;
};

export const getDirectoryEmployee = async (
  employeeId: string,
): Promise<DirectoryEmployee | null> =>
  employeeLookup === null ? null : employeeLookup(employeeId);

/**
 * Display names for many employees at once — id → employee, missing ids omitted.
 *
 * Unregistered returns an EMPTY MAP rather than throwing, which is the same fail-closed posture as
 * the single lookup: a deployment with no employee source shows ids, and shows them honestly.
 */
export const getDirectoryEmployees = async (
  employeeIds: readonly string[],
): Promise<Map<string, DirectoryEmployee>> =>
  employeeBatchLookup === null ? new Map() : employeeBatchLookup(employeeIds);

/**
 * Everyone employed in these departments, or `[]` when HR is absent.
 *
 * Fail-closed like the single lookup, and for the same reason: a deployment with no employee
 * source cannot answer who is in a department, and inventing an empty answer is honest where
 * inventing a populated one would not be. An EMPTY `departmentIds` also answers `[]` — "nobody
 * asked about any department" is not "everybody".
 */
export const listDirectoryEmployeesByDepartment = async (
  departmentIds: readonly string[],
): Promise<DirectoryEmployee[]> =>
  employeesByDepartmentLookup === null || departmentIds.length === 0
    ? []
    : employeesByDepartmentLookup([...departmentIds]);

/**
 * Everyone employed in these job titles, or EMPTY when none is asked for or HR is not registered.
 *
 * Empty on an empty list is the honest answer and not a shortcut: "nobody holds none of the seats"
 * is true, and it is also what keeps a caller that has resolved no driving titles from accidentally
 * asking for the whole company.
 */
export const listDirectoryEmployeesByJobTitles = async (
  jobTitleIds: readonly string[],
): Promise<DirectoryEmployee[]> =>
  employeesByJobTitlesLookup === null || jobTitleIds.length === 0
    ? []
    : employeesByJobTitlesLookup([...jobTitleIds]);

/**
 * The employee behind a login, or null when the account is not linked to one.
 *
 * Fail-closed like `getDirectoryEmployee`: with no HR registered, a self-service surface can
 * identify nobody and therefore authorizes nobody — which is the safe direction for a screen whose
 * whole authorization model is "you may see your own work and only your own".
 */
export const getSelfDirectoryEmployee = async (
  userId: string,
): Promise<DirectoryEmployee | null> =>
  selfEmployeeLookup === null ? null : selfEmployeeLookup(userId);

/**
 * A day's attendance for a set of employees, or an EMPTY map when no attendance source is
 * registered.
 *
 * Empty rather than throwing, and empty rather than fabricating "present": every consumer of this
 * is a read-only overlay, so a deployment without attendance degrades to showing nothing known —
 * which is honest — instead of degrading to showing everyone as fine, which is not.
 */
export const getDirectoryAttendanceDay = async (
  employeeIds: string[],
  date: Date,
): Promise<Map<string, DirectoryAttendanceDay>> =>
  attendanceDayLookup === null || employeeIds.length === 0
    ? new Map()
    : attendanceDayLookup(employeeIds, date);

/** True when an APPROVED or ACTIVE leave covers the date — pending requests are not yet facts. */
export const isOnApprovedLeave = async (employeeId: string, date: Date): Promise<boolean> =>
  leaveLookup === null ? false : leaveLookup(employeeId, date);

export { directoryProfileService } from './directory-profile.service';
export { buildDirectoryRouter } from './directory.routes';
