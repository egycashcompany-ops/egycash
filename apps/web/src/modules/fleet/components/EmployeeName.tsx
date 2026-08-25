// Resolves an employeeId to the person's name + code, sharing the HR employees detail cache
// (same query key), so a name fetched here is free on the HR profile and vice versa. The HR
// directory is its own permission: without `employee.view` the component degrades to the raw
// id — honest, and the fleet screens stay usable for operators without directory access.
import { useQueries, useQuery } from '@tanstack/react-query';
import { type EmployeeDto } from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { detailKey } from '../../../shared/lib/query-keys';
import { getEmployee } from '../../hr/employee-management/employees/api/employee-api';

/**
 * The HR employee record behind a fleet row, READ-ONLY.
 *
 * FR-11 is about ownership, not visibility: Fleet may not store or write a person's HR facts, but
 * a fleet screen may still SHOW them — and this is how, by asking HR's own endpoint with HR's own
 * permission and keeping nothing. `undefined` when the caller lacks `employee.view` or the fetch
 * has not landed, and every consumer degrades to a dash rather than inventing a value.
 *
 * One query key per employee, shared with the HR profile page and with every other cell on the
 * same row, so a row costs one request no matter how many HR columns it renders.
 */
export const useEmployeeRecord = (employeeId: string): EmployeeDto | undefined => {
  const can = useCan();
  const { data } = useQuery({
    queryKey: detailKey('hr', 'employees', employeeId),
    queryFn: () => getEmployee(employeeId),
    enabled: employeeId !== '' && can('employee.view'),
    staleTime: 5 * 60_000,
  });
  return data;
};

export const useEmployeeName = (
  employeeId: string,
): { name: string | null; code: string | null } => {
  const data = useEmployeeRecord(employeeId);
  return { name: data?.personal.fullNameAr ?? null, code: data?.code ?? null };
};

export const EmployeeName = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { name, code } = useEmployeeName(employeeId);
  if (name === null) {
    return (
      <span className="font-mono text-xs text-slate-400" dir="ltr">
        {employeeId.slice(-8)}
      </span>
    );
  }
  return (
    <span>
      {name}
      {code !== null && (
        <span className="ms-2 font-mono text-xs text-slate-500" dir="ltr">
          {code}
        </span>
      )}
    </span>
  );
};

/**
 * The same records, for a WHOLE list at once — what a search over the pool needs.
 *
 * `useEmployeeRecord` is a hook, so a list cannot call it in a loop. `useQueries` can, and it
 * uses the SAME key, fetcher and staleTime as the single-employee hook — so these are the very
 * cache entries the driver cards already populate, not a second copy. A pool whose cards are
 * rendered has already paid for every request this subscribes to; nothing extra goes out.
 *
 * Degrades exactly as the single hook does: without `employee.view` nothing is fetched and the
 * map comes back empty, leaving the caller to search by id alone.
 */
export const useEmployeeRecords = (employeeIds: readonly string[]): Map<string, EmployeeDto> => {
  const can = useCan();
  const allowed = can('employee.view');
  const results = useQueries({
    queries: employeeIds.map((employeeId) => ({
      queryKey: detailKey('hr', 'employees', employeeId),
      queryFn: () => getEmployee(employeeId),
      enabled: allowed && employeeId !== '',
      staleTime: 5 * 60_000,
    })),
  });
  const found = new Map<string, EmployeeDto>();
  for (const [i, result] of results.entries()) {
    const id = employeeIds[i];
    if (id !== undefined && result.data !== undefined) found.set(id, result.data);
  }
  return found;
};
