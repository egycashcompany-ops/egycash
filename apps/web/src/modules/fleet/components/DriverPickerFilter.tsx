// "Which drivers?" — asked the way the fleet already asks "which cars?".
//
// This is `VehicleCodeFilter`'s pattern with people in it: one `MultiSelect`, always searchable,
// chips in the panel, the selection merged back in front of the live results so a picked driver
// can always be un-picked. Nothing about the interaction is new, and that is deliberate — an
// operator who has used the vehicle-code filter on six screens already knows this one.
//
// What it does NOT do is parse. A vehicle code is a token an operator reads off a message, so that
// control takes each one the moment its separator is typed; a person's name is not, and splitting
// «محمد أحمد» into two searches would find neither of them. Here the typing is only ever a SEARCH,
// and the selection is made by picking — which is also why the ids travel as `employeeIds` rather
// than as a string the server has to interpret.
//
// The options are FLEET's OWN ROSTER, held as one list and searched in hand — never HR's employee
// search, whose grant is the whole directory. What follows from that: a
// company outgrows any page, and a picker that quietly stopped at its size would let a reader
// conclude that a driver does not exist.
import { useMemo, useState } from 'react';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { useT } from '../../../platform/localization/useT';
import { driverPickerOptions, type DriverPickOption } from '../lib/driver-filter-selection';
import { useEmployeeRecords, useFleetPeopleMap } from './EmployeeName';

/** How many people one search offers. Enough to pick from, small enough to stay one request. */
const SEARCH_SIZE = 25;

export const DriverPickerFilter = ({
  value,
  onChange,
  density,
  fullWidth = false,
  placeholder,
  className,
}: {
  /** The employee ids currently filtering, in the order they were picked. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Passed straight through, so this control matches the bar it is dropped into. */
  density?: ControlDensity;
  /** Fill the width this control was given — see `MultiSelect`. */
  fullWidth?: boolean;
  /**
   * What the EMPTY trigger says. A bar that writes each filter's name above its control wants the
   * short «الكل» here, because repeating «اسم/كود» inside would say the same thing twice and
   * spend the width that a chosen driver's NAME needs.
   */
  placeholder?: string;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');

  /**
   * SEARCHED OVER FLEET'S OWN ROSTER, in hand.
   *
   * It used to be a page of HR's employee search under `employee.view` — which is the grant this
   * whole change exists to stop asking for. Fleet's roster is the company's drivers, held as one
   * list, so the search is a filter over what the screen already has: no request per keystroke,
   * no cap to intersect wrongly with, and nothing offered that the table below cannot show.
   *
   * The seats no longer narrow anything because the roster IS the seats: every person on it holds
   * a job title that requires a driving test, which is what `jobTitleIds` was for.
   */
  const roster = useFleetPeopleMap();
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const all = [...roster.values()];
    const found =
      term === ''
        ? all
        : all.filter(
            (person) =>
              person.fullNameAr.toLocaleLowerCase().includes(term) ||
              person.code.toLocaleLowerCase().includes(term),
          );
    return found.slice(0, SEARCH_SIZE);
  }, [roster, search]);

  // What is known about the people ALREADY picked — the same cached records the table's own
  // columns read, so a chip names a driver without costing a request of its own.
  const picked = useEmployeeRecords(value);
  const known = useMemo(() => {
    const map = new Map<string, DriverPickOption>();
    for (const id of value) {
      const person = picked.get(id);
      if (person === undefined) continue;
      map.set(id, { employeeId: id, name: person.fullNameAr, code: person.code });
    }
    return map;
  }, [picked, value.join(',')]);

  const options = useMemo(
    () =>
      driverPickerOptions(
        matches.map((person) => ({
          employeeId: person.employeeId,
          name: person.fullNameAr,
          code: person.code,
        })),
        value,
        known,
      ),
    [matches, value.join(','), known],
  );

  return (
    <MultiSelect
      label={t('fleet.drivers.filters.employee')}
      // The trigger has ONE row and the question is a long one, so the row says the short form
      // and the full «اسم السائق أو كود الموظف» stays on `aria-label`, where the screen reader
      // and every test read it. Spelled out rather than truncated: a control whose own label is
      // cut off mid-word is a control nobody can identify, and in RTL the overflow runs off the
      // left edge of the page rather than tidily under an ellipsis.
      placeholder={placeholder ?? t('fleet.drivers.filters.employeeShort')}
      options={options}
      value={value}
      onChange={onChange}
      showSelectedValues
      chips
      // Always searchable: the list IS the search, and a control that grew a search box only once
      // enough people happened to match would teach nobody where to type.
      searchThreshold={0}
      searchValue={search}
      onSearch={setSearch}
      fullWidth={fullWidth}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
