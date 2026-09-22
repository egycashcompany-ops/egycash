// The NAMES behind the employee ids on a Fleet sheet — for an export, which has no cells.
//
// A Fleet table resolves a person one cell at a time: `useEmployeeRecord` is a hook, it runs per
// rendered row, and it is why a driver's name appears without the screen assembling a directory.
// An export has no rows to hang hooks off — it holds a thousand records the screen never drew —
// so it asks imperatively instead.
//
// IT ASKS THE SAME CACHE. Identical key, fetcher and staleTime as `useEmployeeRecord`, so the
// records already on screen cost nothing and the ones fetched here are waiting for the cells that
// scroll into view next. A second cache with its own key would double the requests and then
// disagree with the screen about a renamed employee.
//
// Kept in one place because three screens wanted it at once, and because the two decisions in it
// — how many at a time, and what a failed lookup does — are the kind that drift apart when they
// are written three times.
import { type QueryClient } from '@tanstack/react-query';
import { detailKey } from '../../../shared/lib/query-keys';
import { getEmployee } from '../../hr/employee-management/employees/api/employee-api';

/**
 * How many HR records are asked for at once.
 *
 * Not one-by-one, which would take a minute over a wide filter, and not all at once, which would
 * put a thousand requests on the wire and have the browser queue them anyway. Ten is enough to
 * keep the connection busy without the export becoming the reason something else is slow.
 */
export const HR_LOOKUP_BATCH = 10;

/**
 * Names for as many of these employees as HR will give up, keyed by id.
 *
 * A lookup that fails is LEFT OUT rather than throwing: one unreadable record is not a failed
 * export, and the caller falls back to whatever the screen's own cell falls back to. Without
 * `employee.view` every lookup is refused and the map comes back empty — which is the same thing
 * the screen does, where those cells render the id rather than inventing a name.
 */
export const fetchEmployeeNames = async (
  queryClient: QueryClient,
  employeeIds: readonly string[],
): Promise<Map<string, string>> => {
  const names = new Map<string, string>();
  const ids = [...new Set(employeeIds.filter((id) => id !== ''))];
  for (let from = 0; from < ids.length; from += HR_LOOKUP_BATCH) {
    await Promise.all(
      ids.slice(from, from + HR_LOOKUP_BATCH).map(async (id) => {
        try {
          const employee = await queryClient.fetchQuery({
            queryKey: detailKey('hr', 'employees', id),
            queryFn: () => getEmployee(id),
            staleTime: 5 * 60_000,
          });
          names.set(id, employee.personal.fullNameAr);
        } catch {
          // One unreadable record is not a failed export.
        }
      }),
    );
  }
  return names;
};

/**
 * What a person's cell says on a sheet: their name, the name the old book wrote, or the id tail.
 *
 * The same fallback order `DriverName` draws on screen — an employee HR knows, else the spelling a
 * legacy row carried, else the last eight of the id, which is what the cell shows when HR cannot
 * be asked. Written once so the sheet and the screen cannot come to different answers.
 */
export const personCell = (
  employeeId: string | null,
  legacyName: string | null | undefined,
  names: Map<string, string>,
): string => {
  if (employeeId === null) return legacyName ?? '';
  return names.get(employeeId) ?? employeeId.slice(-8);
};
