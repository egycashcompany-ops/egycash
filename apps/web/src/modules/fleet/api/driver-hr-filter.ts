// The PERSON half of the drivers filter bar.
//
// Three of the boxes on /fleet/drivers ask about facts HR owns — address, governorate, mobile
// number — and until now HR's own list endpoint filtered on them, in a two-step: ask HR for the
// matching employee ids, then ask Fleet for the page. That step needed `employee.view`, which is
// HR's whole directory: «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس ...
// لا انا عاوز الحركه يظهر الناس بتاعت الحركه بس».
//
// Fleet publishes its OWN roster now (`/fleet/people`), and these three facts travel on it. So the
// step is a filter over a list already in hand: one request instead of two, under Fleet's own
// grant, and the whole class of problems the two-step carried simply stops existing —
//
//   • THE CAP IS GONE. `/fleet/drivers?employeeIds=` takes one page of ids, so an HR match wider
//     than that had to report «narrow your filter» and filter nothing rather than hand over a
//     truncated list that looks complete. Measured, «الجيزة» matched 117 employees of whom 3 were
//     drivers. The roster IS the drivers, so there is nothing to overflow.
//   • THE SEATS ARE GONE with it. Step ① had to be narrowed to the job titles requiring a driving
//     test, under `jobTitle.view`, for exactly that reason. The roster is those seats.
//
// «الفرع» and «الوظيفة» are elsewhere and stay there: the branch rides the roster row and is
// filtered by the fleet list itself, and the grade is a Fleet catalog, not HR's job title.
import { useMemo } from 'react';
import { useFleetPeopleMap } from '../components/EmployeeName';

/** The HR-owned half of the filter bar, as the URL carries it. */
export interface DriverHrFilter {
  /**
   * Free text over the employee's name AND code — HR's `search` covers both in one parameter.
   *
   * The DRIVERS registry no longer sends it: naming people there is a multi-select that hands the
   * ids over directly, which is both exact and uncapped. Maintenance and Odometer still do — each
   * has a single «اسم السائق» box and one name to resolve.
   */
  search: string;
  /** «ابحث بالعنوان» — matched over the address as it is displayed, line and city alike. */
  address: string;
  governorate: string;
  phone: string;
}

const hasHrFilter = (filter: DriverHrFilter): boolean =>
  Object.values(filter).some((value) => value !== '');

export interface DriverHrFilterResult {
  /** Matching employee ids, or null when no HR filter is set (the fleet list is unnarrowed). */
  employeeIds: string[] | null;
  /** The HR match is wider than one page: NOTHING may be filtered, and the user must narrow. */
  tooMany: boolean;
  /** How many employees HR matched — what the "narrow your filter" message quotes. */
  matched: number;
  /** True while step ① is in flight, so the caller can hold step ② rather than run it unfiltered. */
  loading: boolean;
  /** HR refused or failed: the caller must not fall back to an unfiltered list. */
  failed: boolean;
}

/**
 * Resolve the HR half of the filter to employee ids.
 *
 * Returns `employeeIds: null` when there is no HR filter — the caller then queries Fleet exactly
 * as before. An empty array means "HR matched nobody", which is a real answer and must produce an
 * empty table, never an unfiltered one.
 */
export const useDriverHrFilter = (filter: DriverHrFilter): DriverHrFilterResult => {
  const roster = useFleetPeopleMap();
  const active = hasHrFilter(filter);
  const key = `${filter.search}|${filter.address}|${filter.governorate}|${filter.phone}`;

  const matches = useMemo(() => {
    if (!active) return null;
    const has = (haystack: string | null, needle: string): boolean =>
      needle === '' ||
      (haystack ?? '').toLocaleLowerCase().includes(needle.trim().toLocaleLowerCase());
    return [...roster.values()]
      .filter(
        (person) =>
          (filter.search === '' ||
            has(person.fullNameAr, filter.search) ||
            has(person.code, filter.search)) &&
          has(person.address, filter.address) &&
          has(person.governorate, filter.governorate) &&
          has(person.phone, filter.phone),
      )
      .map((person) => person.employeeId);
  }, [roster, active, key]);

  if (!active) {
    return { employeeIds: null, tooMany: false, matched: 0, loading: false, failed: false };
  }
  // An EMPTY roster while a filter is set is «not readable», not «matched nobody»: a reader
  // without the grant, or a list still on its way. Reporting it as a match would show an empty
  // table and call it an answer.
  if (roster.size === 0) {
    return { employeeIds: null, tooMany: false, matched: 0, loading: false, failed: true };
  }
  return {
    employeeIds: matches ?? [],
    // Nothing to overflow any more — the roster is the drivers, and the filter runs over it whole.
    tooMany: false,
    matched: (matches ?? []).length,
    loading: false,
    failed: false,
  };
};
