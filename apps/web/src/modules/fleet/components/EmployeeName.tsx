// Resolves an employeeId to the person behind it, from FLEET's OWN people list.
//
// «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس ... عشان يظهر لازم اخش
// اديله من الاتش ار صفحه الموظفون ف بيعرض ... كل المواظفين بتوع الشركه لا انا عاوز الحركه يظهر
// الناس بتاعت الحركه بس».
//
// This used to read HR's employee endpoint with HR's own `employee.view`, one request per cell.
// That grant is the whole HR directory: to let a dispatcher see who drove car 150 yesterday,
// somebody had to hand them «الموظفون» — and every employee in the company with it.
//
// Now it reads `/fleet/people`, which answers under the DRIVERS' own view grant and carries
// exactly Fleet's roster (see `FleetPersonDto`). Two things follow, and both are improvements:
// a Fleet-only reader needs no HR permission at all, and a board of a hundred rows costs ONE
// request instead of a hundred — the list is shared by every cell on the screen.
//
// A person NOT on Fleet's roster resolves to nothing, and every consumer degrades to a dash or to
// the raw id exactly as it did without `employee.view`. That is the right answer rather than a
// gap: Fleet shows drivers, and somebody who is not one has no business being named here.
import { useMemo } from 'react';
import { type FleetPersonDto } from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { useFleetPeople } from '../api/fleet-queries';

/**
 * Fleet's people, by employee id — ONE query, however many cells ask.
 *
 * Gated on `fleetDriver.view` because that is what the endpoint authorizes: a reader without it
 * gets an empty map rather than a 403 on every row of every Fleet screen.
 */
export const useFleetPeopleMap = (): Map<string, FleetPersonDto> => {
  const can = useCan();
  const { data } = useFleetPeople(can('fleetDriver.view'));
  return useMemo(
    () => new Map((data ?? []).map((person) => [person.employeeId, person])),
    [data],
  );
};

/**
 * The person behind a fleet row, READ-ONLY.
 *
 * FR-11 is about ownership, not visibility: Fleet may not store or write a person's HR facts, but
 * a fleet screen may still SHOW them. `undefined` when the caller may not read the roster, when
 * the list has not landed, or when the id is not one of Fleet's people — and every consumer
 * degrades to a dash rather than inventing a value.
 */
export const useEmployeeRecord = (employeeId: string): FleetPersonDto | undefined =>
  useFleetPeopleMap().get(employeeId);

export const useEmployeeName = (
  employeeId: string,
): { name: string | null; code: string | null } => {
  const person = useEmployeeRecord(employeeId);
  return { name: person?.fullNameAr ?? null, code: person?.code ?? null };
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
 * A DRIVER cell on a fleet row: the person Fleet knows, or — where the row came from the old
 * books and HR has no employee for the spelling — the name as the book wrote it, kept as text.
 *
 * «عاوز يتحفظ كداتا زى ما يكون سواق كان موجود ومشى». The text name is set on such rows and on
 * nothing else, so a name here without an employee is exactly that case; it prints in the same
 * place, muted, with a title saying where it came from, and never pretends to be a link to HR.
 */
export const DriverName = ({
  employeeId,
  name,
}: {
  employeeId: string | null;
  name: string | null | undefined;
}): JSX.Element | string => {
  if (employeeId !== null) return <EmployeeName employeeId={employeeId} />;
  if (name != null && name !== '') {
    return (
      <span className="text-slate-600 dark:text-slate-300" data-legacy-name="true" title={name}>
        {name}
      </span>
    );
  }
  return '—';
};

/**
 * The same people, for a WHOLE list at once — what a search over the pool needs.
 *
 * It no longer fans out: the roster is one list and this is a lookup into it, so asking about a
 * hundred ids costs what asking about one does. The map holds only the ids that are Fleet's, so a
 * caller can still tell «not on the roster» from «not fetched yet» by whether the map is empty.
 */
export const useEmployeeRecords = (
  employeeIds: readonly string[],
): Map<string, FleetPersonDto> => {
  const all = useFleetPeopleMap();
  const key = employeeIds.join(',');
  return useMemo(() => {
    const found = new Map<string, FleetPersonDto>();
    for (const id of employeeIds) {
      const person = all.get(id);
      if (person !== undefined) found.set(id, person);
    }
    return found;
  }, [all, key]);
};
