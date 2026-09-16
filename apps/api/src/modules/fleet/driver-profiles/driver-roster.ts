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
  /**
   * The HR half of the row, for the columns the registry ORDERS by.
   *
   * «عاوز هنا يكون فيه سهم ... اسم السائق و كود الموظف و المحافظة رقم الموبايل تاريخ التعيين».
   * The screen SHOWS these through HR's own endpoint, one page at a time — which is fine for
   * showing and useless for ordering: the registry is paged in memory here, so a column it cannot
   * see at this point is a column whose arrow would order the fetched page and lie about the rest.
   * They arrive with the roster, from the directory seam that already named the driver.
   *
   * Optional, so every existing caller and every test that builds a row by hand is unchanged;
   * absent simply means there is nothing to order by, which sorts last like any missing value.
   */
  hr?: DriverHrFacts | undefined;
}

/** The five HR facts the registry can be ordered by — exactly the ones the seam answers. */
export interface DriverHrFacts {
  fullNameAr: string | null;
  code: string | null;
  governorate: string | null;
  phone: string | null;
  hiredAt: Date | null;
}

/** The profile fields the filters ask about — the shape, not the document. */
export interface DriverProfileFacts {
  licenseNumber: string | null;
  licenseExpiresAt: Date | null;
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

/**
 * Is the driver's reference one of the ones asked for?
 *
 * An ObjectId, a string, or nothing on the stored side — compared the one way that works for all
 * three. SEVERAL on the wanted side, ORed: «سائق أ أو سائق ب» is one question about the registry,
 * and asking it a grade at a time is what «اى فلتر ف الحركه زياده عن اتنين ... multi selection»
 * is about. One wanted value behaves exactly as the old equality did.
 *
 * Nothing stored is a MISS however many are asked for, for the reason the whole block below gives:
 * a driver nobody has classified is not a grade-A driver.
 */
const sameRef = (stored: unknown, wanted: readonly string[]): boolean =>
  stored != null && wanted.includes(String(stored));

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
  if (query.licenseExpiresBefore !== undefined) {
    // NO EXPIRY ON FILE IS NOT AN ANSWER to «whose licence runs out before X». It is not a licence
    // that runs out later either — it is a date nobody has given us, and a question about dates
    // cannot be answered for it. Excluding it keeps the filter's meaning exact; the driver still
    // shows up unfiltered, where the empty cell says what is actually missing.
    if (profile.licenseExpiresAt === null) return false;
    if (profile.licenseExpiresAt.getTime() > query.licenseExpiresBefore.getTime()) return false;
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
 * The columns the registry can be ordered by, and where each one's value comes from.
 *
 * TWO HALVES, because the row is a join across the FR-11 line: `licenseExpiresAt` and `createdAt`
 * are Fleet's, and the five below are HR's, arriving with the roster from the directory seam. The
 * KEY is what the browser puts in `?sort=`, so this table is also the list of arrows the screen
 * is allowed to draw.
 */
const SORT_VALUE: Record<
  string,
  <TProfile extends DriverProfileFacts>(
    row: DriverRosterRow<TProfile>,
  ) => string | number | null
> = {
  // Fleet's own, both dates — read as a number so one comparison serves every column.
  licenseExpiresAt: (row) => row.profile?.licenseExpiresAt?.getTime() ?? null,
  createdAt: (row) => row.profile?.createdAt?.getTime() ?? null,
  // HR's. A name and a governorate are WORDS, so they are compared as words — Arabic included,
  // which `localeCompare` gets right and `<` does not.
  driver: (row) => row.hr?.fullNameAr ?? null,
  employeeCode: (row) => row.hr?.code ?? null,
  governorate: (row) => row.hr?.governorate ?? null,
  phone: (row) => row.hr?.phone ?? null,
  hiredAt: (row) => row.hr?.hiredAt?.getTime() ?? null,
};

/** The columns a `?sort=` may name on this registry — the API's whitelist, published once. */
export const DRIVER_SORTABLE_COLUMNS = Object.keys(SORT_VALUE);

/** Two values of one column, in the order the reader asked for. `null` always sorts LAST. */
const compareValues = (left: string | number | null, right: string | number | null): number => {
  if (left === null && right === null) return 0;
  // Not «smallest»: a driver whose licence was never recorded is not the most urgent, and a
  // driver with no phone on file is not the first in the phone book. They are a different
  // problem, and floating them to the top of either order would bury the real one.
  if (left === null) return Number.POSITIVE_INFINITY;
  if (right === null) return Number.NEGATIVE_INFINITY;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'ar');
};

/**
 * The registry's order.
 *
 * A row with NO profile has nothing FLEET can sort by, and it sorts LAST in either direction
 * rather than being treated as the smallest value — but only for a FLEET column. Ordering by the
 * driver's name is a question HR answers, and a driver nobody has recorded a licence for still
 * has a name; sorting them last there would hide every new hire at the bottom of an alphabet.
 *
 * A profile that EXISTS but carries no expiry is the same problem wearing a different shape, and
 * gets the same answer. `?? 0` would have dated it to 1970 and floated it to the very top of the
 * "soonest to lapse" list — the loudest possible place for the one row that cannot lapse at all.
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
  /**
   * The rest of the reader's order, when they have clicked more than one column — the registry's
   * half of «انا عاوز اقدر اعمل الاتنين مع بعض». Omitted, the first two arguments are the whole
   * order, which is what every caller before the tables could hold two columns passed.
   */
  sorts: readonly { by: string; dir: 'asc' | 'desc' }[] = [],
): TRow[] => {
  const columns = (sorts.length > 0 ? sorts : [{ by: sortBy ?? '', dir: sortDir ?? 'desc' }])
    .map((entry) => ({
      // A column this registry cannot answer falls back to `createdAt`, which is what the
      // platform's own list contract does with an unknown `sortBy` — never a 400, and never a
      // silently unsorted page.
      value: SORT_VALUE[entry.by] ?? SORT_VALUE['createdAt'],
      dir: entry.dir === 'asc' ? 1 : -1,
    }));
  return [...rows].sort((a, b) => {
    // Column by column, in the order they were clicked; the first that separates the two rows
    // decides, and the employee id closes the tie so a page cannot reshuffle under a reader.
    for (const column of columns) {
      const verdict = compareValues(column.value?.(a) ?? null, column.value?.(b) ?? null);
      // A missing value sorts last in BOTH directions, so its verdict is not turned round with
      // the rest — which is why the infinities above carry the answer rather than a sign.
      if (verdict === Number.POSITIVE_INFINITY) return 1;
      if (verdict === Number.NEGATIVE_INFINITY) return -1;
      if (verdict !== 0) return verdict * column.dir;
    }
    return a.employeeId.localeCompare(b.employeeId);
  });
};
