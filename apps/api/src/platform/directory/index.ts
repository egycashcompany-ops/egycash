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

export interface DirectoryEmployee {
  employeeId: string;
  code: string;
  fullNameAr: string;
  /** HR employment status gates fleet eligibility regardless of the fleet-side profile switch. */
  status: 'probation' | 'active' | 'onLeave' | 'suspended' | 'exited';
  branchId: string | null;
  departmentId: string | null;
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

let employeeLookup: EmployeeLookup | null = null;
let employeeBatchLookup: EmployeeBatchLookup | null = null;
let leaveLookup: LeaveLookup | null = null;

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

/** True when an APPROVED or ACTIVE leave covers the date — pending requests are not yet facts. */
export const isOnApprovedLeave = async (employeeId: string, date: Date): Promise<boolean> =>
  leaveLookup === null ? false : leaveLookup(employeeId, date);

export { directoryProfileService } from './directory-profile.service';
export { buildDirectoryRouter } from './directory.routes';
