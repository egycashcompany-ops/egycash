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
// The options are one page of HR's own search (`employee.view`), never a joined-against list: a
// company outgrows any page, and a picker that quietly stopped at its size would let a reader
// conclude that a driver does not exist.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { listEmployees } from '../../hr/employee-management/employees/api/employee-api';
import { driverPickerOptions, type DriverPickOption } from '../lib/driver-filter-selection';
import { useEmployeeRecords } from './EmployeeName';

/** How many people one search offers. Enough to pick from, small enough to stay one request. */
const SEARCH_SIZE = 25;

export const DriverPickerFilter = ({
  value,
  onChange,
  jobTitleIds = [],
  density,
  fullWidth = false,
  placeholder,
  className,
}: {
  /** The employee ids currently filtering, in the order they were picked. */
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * The seats this registry is about — the job titles that require a driving test.
   *
   * Offered people must be people the table can SHOW. Searching the whole payroll let a reader
   * tick three colleagues who are not drivers and get an empty table back, with the filter bar
   * insisting three people were selected: the picker had answered a question the list below could
   * not. Narrowing by the same seats the roster is built from makes every offer a real row.
   *
   * Empty means «do not narrow», which is what a caller without `jobTitle.view` gets — the same
   * degradation the rest of this screen makes wherever HR is involved.
   */
  jobTitleIds?: readonly string[];
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
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('employee.view');

  // HR's `search` covers the name AND the employee code in one parameter, which is exactly the
  // question this control asks — so it is one query, not two whose capped pages could intersect
  // to a wrong answer.
  const seats = jobTitleIds.join(',');
  const results = useQuery({
    queryKey: ['hr', 'employees', 'fleet-driver-picker', search, seats],
    queryFn: () =>
      listEmployees({
        ...(search.trim() === '' ? {} : { search: search.trim() }),
        employed: true,
        pageSize: SEARCH_SIZE,
        ...(seats === '' ? {} : { jobTitleId: seats }),
      }),
    // Runs with an EMPTY search too, so opening the control already lists drivers. It used to wait
    // for typing, which meant a reader who had picked three people opened the panel onto «no
    // results» with three chips above it — nothing to compare them against, and no way to discover
    // who else could be picked.
    enabled: allowed,
    staleTime: 30_000,
    retry: false,
  });

  // What is known about the people ALREADY picked — the same cached records the table's own
  // columns read, so a chip names a driver without costing a request of its own.
  const picked = useEmployeeRecords(value);
  const known = useMemo(() => {
    const map = new Map<string, DriverPickOption>();
    for (const id of value) {
      const employee = picked.get(id);
      if (employee === undefined) continue;
      map.set(id, { employeeId: id, name: employee.personal.fullNameAr, code: employee.code });
    }
    return map;
  }, [picked, value.join(',')]);

  const options = useMemo(
    () =>
      driverPickerOptions(
        (results.data?.items ?? []).map((employee) => ({
          employeeId: employee.id,
          name: employee.personal.fullNameAr,
          code: employee.code,
        })),
        value,
        known,
      ),
    [results.data, value.join(','), known],
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
      searching={results.isFetching}
      fullWidth={fullWidth}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
