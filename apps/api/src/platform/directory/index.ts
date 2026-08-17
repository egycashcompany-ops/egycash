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
type LeaveLookup = (employeeId: string, date: Date) => Promise<boolean>;
/** The self lookup: which employee IS this login? Owned by HR, consumed by self-service surfaces. */
type SelfEmployeeLookup = (userId: string) => Promise<DirectoryEmployee | null>;

let employeeLookup: EmployeeLookup | null = null;
let leaveLookup: LeaveLookup | null = null;
let selfEmployeeLookup: SelfEmployeeLookup | null = null;

/** Idempotent — the last registration wins, so a test can install a fake over the real one. */
export const registerEmployeeLookup = (lookup: EmployeeLookup): void => {
  employeeLookup = lookup;
};

export const registerLeaveLookup = (lookup: LeaveLookup): void => {
  leaveLookup = lookup;
};

export const registerSelfEmployeeLookup = (lookup: SelfEmployeeLookup): void => {
  selfEmployeeLookup = lookup;
};

export const getDirectoryEmployee = async (
  employeeId: string,
): Promise<DirectoryEmployee | null> =>
  employeeLookup === null ? null : employeeLookup(employeeId);

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

/** True when an APPROVED or ACTIVE leave covers the date — pending requests are not yet facts. */
export const isOnApprovedLeave = async (employeeId: string, date: Date): Promise<boolean> =>
  leaveLookup === null ? false : leaveLookup(employeeId, date);

export { directoryProfileService } from './directory-profile.service';
export { buildDirectoryRouter } from './directory.routes';
