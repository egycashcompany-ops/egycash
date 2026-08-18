// The HR half of the drivers filter bar.
//
// Six of the columns on /fleet/drivers are HR's facts — name, employee code, job title,
// governorate, mobile number, branch — and HR's own list endpoint is what filters on them. This
// hook is step ONE of a two-step, entirely server-side filter:
//
//   ① GET /hr/employees?search=…&jobTitleId=…&branchId=…&governorate=…&phone=…   → employee ids
//   ② GET /fleet/drivers?employeeIds=<ids>&…                                     → the page
//
// Two independent queries, each answered by the module that owns its data, joined by id in the
// browser. That is already how the table reads HR names; nothing here lets Fleet see HR's
// collection, and nothing is filtered out of an already-fetched page.
//
// THE CAP IS THE WHOLE POINT. `/fleet/drivers?employeeIds=` accepts one HR page (100 ids). When
// the HR match is wider than that, this hook reports `tooMany` instead of handing over the first
// hundred: a truncated `$in` would render a short list that looks complete, which is the one
// outcome worse than no filter at all. The caller must then say so and filter nothing.
import { useQuery } from '@tanstack/react-query';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { listEmployees } from '../../hr/employee-management/employees/api/employee-api';

/** The HR-owned half of the filter bar, as the URL carries it. */
export interface DriverHrFilter {
  /** Free text over the employee's name AND code — HR's `search` covers both in one parameter. */
  search: string;
  jobTitleId: string;
  branchId: string;
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
  const can = useCan();
  const active = hasHrFilter(filter);
  // Reading HR is HR's permission. Without it the six HR columns are dashes anyway, so there is
  // nothing to filter on and the query never runs.
  const allowed = can('employee.view');

  const query = useQuery({
    queryKey: ['hr', 'employees', 'fleet-driver-filter', filter],
    queryFn: () =>
      listEmployees({
        pageSize: MAX_PAGE_SIZE,
        employed: true,
        search: filter.search || undefined,
        jobTitleId: filter.jobTitleId || undefined,
        branchId: filter.branchId || undefined,
        governorate: filter.governorate || undefined,
        phone: filter.phone || undefined,
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
