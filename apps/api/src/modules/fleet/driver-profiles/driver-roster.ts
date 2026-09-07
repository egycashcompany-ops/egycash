// Narrowing and ordering the drivers registry, in memory.
//
// The registry is a JOIN across the FR-11 line: who is a driver comes from the org chart (HR), and
// what Fleet knows about them comes from Fleet. Two modules, two collections, so the database
// cannot do it — the service joins the two lists and these functions do the rest.
//
// Pure, and separate from the service, because that is what makes them testable: every rule below
// is a decision about what a filter MEANS for a driver nobody has recorded anything about yet, and
// each of those decisions is easy to get quietly wrong.
import { type ListFleetDriversQuery } from '@ecms/contracts';

/** What a row is, once the two halves are joined. `profile: null` = nothing recorded yet. */
export interface DriverRosterRow<TProfile> {
  employeeId: string;
  profile: TProfile | null;
}

/** The profile fields the filters ask about — the shape, not the document. */
export interface DriverProfileFacts {
  licenseNumber: string;
  licenseExpiresAt: Date;
  /** The three catalog references, as ids. `null` = nobody has classified this driver yet. */
  jobId?: unknown;
  specializationId?: unknown;
  licenseTypeId?: unknown;
  /** LEGACY «التخصص» enum — still matched by the legacy parameter, written by nothing. */
  specialization?: string | null;
  area: string | null;
  isActive: boolean;
  licenseImage: unknown | null;
  createdAt?: Date;
}

const contains = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

/** An ObjectId, a string, or nothing — compared the one way that works for all three. */
const sameRef = (stored: unknown, wanted: string): boolean =>
  stored != null && String(stored) === wanted;

/**
 * Is this driver in one of the branches asked for?
 *
 * NO BRANCHES ASKED means every driver, including one the directory could not place — «show me
 * everyone» is not a filter. Asked for and unplaced is a MISS, for the same reason the profile
 * filters miss a driver with no profile: a driver with no branch on file is not in Maadi, and
 * putting them in Maadi's list would be a false positive on a page somebody counts from.
 */
export const matchesRosterBranch = (
  branchId: string | null,
  wanted: readonly string[] | undefined,
): boolean => {
  if (wanted === undefined || wanted.length === 0) return true;
  return branchId !== null && wanted.includes(branchId);
};

/**
 * Does this row survive the FLEET half of the filter bar?
 *
 * EVERY ONE OF THESE ASKS ABOUT THE PROFILE, so a driver who has none matches NONE of them — and
 * that is the deliberate answer rather than an oversight. "Whose licence expires before March" is
 * not a question about somebody whose licence was never recorded; including them would be a false
 * positive on a screen people use to find licences about to lapse. An unfiltered registry still
 * shows them, which is where they belong: visible, and visibly incomplete.
 */
export const matchesFleetFilters = (
  profile: DriverProfileFacts | null,
  query: Pick<
    ListFleetDriversQuery,
    | 'jobId'
    | 'specializationId'
    | 'licenseTypeId'
    | 'specialization'
    | 'isActive'
    | 'licenseExpiresBefore'
    | 'search'
    | 'area'
    | 'hasLicenseImage'
  >,
): boolean => {
  const asked =
    query.jobId !== undefined ||
    query.specializationId !== undefined ||
    query.licenseTypeId !== undefined ||
    query.specialization !== undefined ||
    query.isActive !== undefined ||
    query.licenseExpiresBefore !== undefined ||
    query.search !== undefined ||
    query.area !== undefined ||
    query.hasLicenseImage !== undefined;
  if (!asked) return true;
  if (profile === null) return false;

  // The three catalog references. An UNCLASSIFIED driver misses each of them for the reason the
  // whole block above misses a driver with no profile: «الوظيفة = سائق أ» is not a question about
  // somebody whose grade nobody has chosen, and answering it with them would put an unclassified
  // driver into a count of grade-A ones.
  if (query.jobId !== undefined && !sameRef(profile.jobId, query.jobId)) return false;
  if (
    query.specializationId !== undefined &&
    !sameRef(profile.specializationId, query.specializationId)
  ) {
    return false;
  }
  if (query.licenseTypeId !== undefined && !sameRef(profile.licenseTypeId, query.licenseTypeId)) {
    return false;
  }
  if (query.specialization !== undefined && profile.specialization !== query.specialization) {
    return false;
  }
  if (query.isActive !== undefined && profile.isActive !== query.isActive) return false;
  if (
    query.licenseExpiresBefore !== undefined &&
    profile.licenseExpiresAt.getTime() > query.licenseExpiresBefore.getTime()
  ) {
    return false;
  }
  if (query.search !== undefined && !contains(profile.licenseNumber, query.search)) return false;
  if (query.area !== undefined && !contains(profile.area, query.area)) return false;
  if (query.hasLicenseImage !== undefined) {
    const has = profile.licenseImage != null;
    if (has !== query.hasLicenseImage) return false;
  }
  return true;
};

/**
 * The registry's order.
 *
 * A row with NO profile has nothing to sort by, and it sorts LAST in either direction rather than
 * being treated as the smallest value. Ascending by expiry means "soonest to lapse first", and a
 * driver whose licence was never recorded is not the most urgent — they are a different problem,
 * and putting them at the top would bury the real one.
 */
export const sortDriverRows = <
  TProfile extends DriverProfileFacts,
  // The ROW, not `DriverRosterRow<TProfile>`: a caller's row carries more than the two fields
  // sorted on — the branch the registry filters by — and narrowing to the interface here would
  // hand that back stripped.
  TRow extends DriverRosterRow<TProfile>,
>(
  rows: readonly TRow[],
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' | undefined,
): TRow[] => {
  const dir = sortDir === 'asc' ? 1 : -1;
  const key = sortBy === 'licenseExpiresAt' ? 'licenseExpiresAt' : 'createdAt';
  return [...rows].sort((a, b) => {
    if (a.profile === null && b.profile === null) return a.employeeId.localeCompare(b.employeeId);
    if (a.profile === null) return 1;
    if (b.profile === null) return -1;
    const left = a.profile[key]?.getTime() ?? 0;
    const right = b.profile[key]?.getTime() ?? 0;
    return left === right ? a.employeeId.localeCompare(b.employeeId) : (left - right) * dir;
  });
};
