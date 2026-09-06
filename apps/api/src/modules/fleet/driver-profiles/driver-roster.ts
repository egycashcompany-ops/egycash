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
  specialization: string;
  area: string | null;
  isActive: boolean;
  licenseImage: unknown | null;
  createdAt?: Date;
}

const contains = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

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
    'specialization' | 'isActive' | 'licenseExpiresBefore' | 'search' | 'area' | 'hasLicenseImage'
  >,
): boolean => {
  const asked =
    query.specialization !== undefined ||
    query.isActive !== undefined ||
    query.licenseExpiresBefore !== undefined ||
    query.search !== undefined ||
    query.area !== undefined ||
    query.hasLicenseImage !== undefined;
  if (!asked) return true;
  if (profile === null) return false;

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
export const sortDriverRows = <T extends DriverProfileFacts>(
  rows: readonly DriverRosterRow<T>[],
  sortBy: string | undefined,
  sortDir: 'asc' | 'desc' | undefined,
): DriverRosterRow<T>[] => {
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
