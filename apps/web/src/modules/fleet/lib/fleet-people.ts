// The NAMES behind the employee ids on a Fleet sheet — for an export, which has no cells.
//
// A Fleet table resolves a person one cell at a time through `useEmployeeRecord`, a hook that
// runs per rendered row. An export has no rows to hang hooks off — it holds a thousand records
// the screen never drew — so it asks imperatively instead.
//
// IT ASKS THE SAME QUERY. One roster, one key, the freshness the hook uses: the list the screen
// already fetched costs nothing here, and a second key would double the request and then disagree
// with the screen about a renamed driver.
//
// FLEET'S OWN PEOPLE, not HR's directory. «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده
// موديول الحركه بس» — this used to fetch HR's employee record per id, in batches of ten, under
// `employee.view`; the roster is one list under Fleet's own grant, so the batching, the per-id
// failure handling and the HR permission all go with it.
import { type QueryClient } from '@tanstack/react-query';
import { listFleetPeople } from '../api/fleet-api';

/** The one key this list lives under — the same one `useFleetPeople` subscribes to. */
export const FLEET_PEOPLE_KEY = ['fleet', 'people'] as const;

/**
 * Names for Fleet's people, keyed by employee id.
 *
 * A roster that cannot be read answers EMPTY rather than throwing: a reader without
 * `fleetDriver.view` is not a failed export, and the caller falls back to whatever the screen's
 * own cell falls back to — which is the id's tail, never an invented name.
 *
 * It takes no ids. There is one list and it is the answer; asking for a subset would only invite
 * a second request for the rest.
 */
export const fetchEmployeeNames = async (
  queryClient: QueryClient,
  _employeeIds: readonly string[] = [],
): Promise<Map<string, string>> => {
  try {
    const roster = await queryClient.fetchQuery({
      queryKey: FLEET_PEOPLE_KEY,
      queryFn: listFleetPeople,
      staleTime: 5 * 60_000,
    });
    return new Map(roster.map((person) => [person.employeeId, person.fullNameAr]));
  } catch {
    // Not readable is not a failed export — the person columns land blank, as the cells do.
    return new Map();
  }
};

/**
 * What a person's cell says on a sheet: their name, the name the old book wrote, or the id tail.
 *
 * The same fallback order `DriverName` draws on screen — a driver Fleet knows, else the spelling a
 * legacy row carried, else the last eight of the id, which is what the cell shows when the roster
 * cannot be read. Written once so the sheet and the screen cannot come to different answers.
 */
export const personCell = (
  employeeId: string | null,
  legacyName: string | null | undefined,
  names: Map<string, string>,
): string => {
  if (employeeId === null) return legacyName ?? '';
  return names.get(employeeId) ?? employeeId.slice(-8);
};
