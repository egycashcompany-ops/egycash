// The HR half of the drivers filter bar.
//
// Three of the boxes on /fleet/drivers ask about facts HR owns — address, governorate, mobile
// number — and HR's own list endpoint is what filters on them. This hook is step ONE of a
// two-step, entirely server-side filter:
//
//   ① GET /hr/employees?address=…&governorate=…&phone=…   → employee ids
//   ② GET /fleet/drivers?employeeIds=<ids>&…              → the page
//
// Two independent queries, each answered by the module that owns its data, joined by id in the
// browser. That is already how the table reads HR names; nothing here lets Fleet see HR's
// collection, and nothing is filtered out of an already-fetched page.
//
// THE CAP IS THE WHOLE POINT. `/fleet/drivers?employeeIds=` accepts one HR page (100 ids). When
// the HR match is wider than that, this hook reports `tooMany` instead of handing over the first
// hundred: a truncated `$in` would render a short list that looks complete, which is the one
// outcome worse than no filter at all. The caller must then say so and filter nothing.
//
// SO THE QUESTION HAS TO BE THE ONE THE SCREEN IS ASKING. Step ① used to ask HR about EVERYBODY:
// «who lives in الجيزة» is answered by the whole payroll, so a company of a few hundred blew the
// cap on an ordinary governorate and the screen refused to filter — measured, «الجيزة» matched
// 117 employees of whom 3 were drivers. The registry is only people whose job title requires a
// driving test, so that is what step ① now asks about, and the answer is bounded by the driver
// count rather than the headcount. A caller that cannot name those titles (no `jobTitle.view`,
// or a screen that is not the registry) simply does not narrow, exactly as before.
//
// THE BRANCH IS NO LONGER ASKED HERE, and that is the fix rather than a tidy-up. «الفرع» was the
// one filter whose own subject overflowed the cap: a branch's employees are its whole payroll,
// drivers and everybody else, so every real branch matched more than one HR page and the screen
// answered «narrow your filter» and filtered NOTHING — a control that could not work at any size.
// Fleet's roster already carries each driver's branch from the directory seam, so the fleet list
// filters on it directly (`/fleet/drivers?branchId=`), with no page to overflow. The same is true
// of the driver PICKER: a ticked list of people is already ids, and needs no HR page at all.
//
// «الوظيفة» left too, in the other direction: it is a fleet `driverJob` catalog now — the grade
// the house runs a driver at — rather than HR's job title, so it is Fleet's own column to filter.
import { useQuery } from '@tanstack/react-query';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { listEmployees } from '../../hr/employee-management/employees/api/employee-api';

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
export const useDriverHrFilter = (
  filter: DriverHrFilter,
  /**
   * The seats the asking screen is about — the drivers registry passes the job titles that
   * require a driving test, which is exactly who its rows are.
   *
   * Omitted or empty means «ask about everybody», which is what Maintenance and Odometer want:
   * they resolve ONE typed driver name for a visit, and a name is narrow enough on its own.
   */
  jobTitleIds: readonly string[] = [],
): DriverHrFilterResult => {
  const can = useCan();
  const active = hasHrFilter(filter);
  // Reading HR is HR's permission. Without it the six HR columns are dashes anyway, so there is
  // nothing to filter on and the query never runs.
  const allowed = can('employee.view');

  const seats = jobTitleIds.join(',');
  const query = useQuery({
    queryKey: ['hr', 'employees', 'fleet-driver-filter', filter, seats],
    queryFn: () =>
      listEmployees({
        pageSize: MAX_PAGE_SIZE,
        employed: true,
        search: filter.search || undefined,
        address: filter.address || undefined,
        governorate: filter.governorate || undefined,
        phone: filter.phone || undefined,
        ...(seats === '' ? {} : { jobTitleId: seats }),
      }),
    enabled: active && allowed,
    staleTime: 30_000,
    retry: false,
  });

  if (!active) {
    return { employeeIds: null, tooMany: false, matched: 0, loading: false, failed: false };
  }
  if (!allowed || query.isError) {
    return { employeeIds: null, tooMany: false, matched: 0, loading: false, failed: true };
  }
  if (query.data === undefined) {
    return { employeeIds: null, tooMany: false, matched: 0, loading: true, failed: false };
  }
  const matched = query.data.meta.totalItems;
  if (matched > MAX_PAGE_SIZE) {
    return { employeeIds: null, tooMany: true, matched, loading: false, failed: false };
  }
  return {
    employeeIds: query.data.items.map((employee) => employee.id),
    tooMany: false,
    matched,
    loading: false,
    failed: false,
  };
};
