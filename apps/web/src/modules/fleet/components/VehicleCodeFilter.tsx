// "Which cars?" — asked the same way on all six screens that ask it.
//
// Maintenance, Odometer, Alarms, the vehicle registry, Accidents and Violations all filter by car.
// Before this they asked in four different vocabularies: two of them a `vehicleCodes` multi-select,
// one a substring text box, one a single dropdown, and Accidents BOTH of the last two at once —
// which let a reader pick car 215 and type 216 and get an empty page their own filter bar said was
// possible. This is the one control, and `vehicleCodes=215,216,217` is the one URL shape.
//
// TYPED AS WELL AS PICKED. An operator is usually reading codes off a message — `215 - 216 - 217`
// — so the search box doubles as the input: Enter commits whatever is written, parsed by the
// shared `parseVehicleCodes`. The parser resolves the hyphen ambiguity against `known`, and the
// right reference is the search's own answer, because that search ran on the very text being
// parsed. Type `A-15` and the registry returns `A-15`, so it stays one code; paste `215-216-217`
// and the registry returns nothing, so it splits into three.
//
// The options come from the registry a shortlist at a time (`onSearch`), never from one page of
// it: a fleet outgrows any page, and a joined-against list would silently stop at its size. Alarms
// is the exception and passes its own `options` — it already holds the whole board.
import { useMemo, useState } from 'react';
import { parseVehicleCodes } from '@ecms/contracts';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useT } from '../../../platform/localization/useT';
import { useVehicles } from '../api/fleet-queries';
import { vehicleCodeOptions } from '../lib/vehicle-code-options';

/** How many cars one search offers. Enough to pick from, small enough to stay one request. */
const SEARCH_SIZE = 50;

export const VehicleCodeFilter = ({
  value,
  onChange,
  options,
  className,
}: {
  /** The codes currently filtering, in the order they were chosen. */
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * Options to offer INSTEAD of searching the registry — for a screen that already holds every
   * car it reports on (the alarm board). Omit it and the control asks the registry.
   */
  options?: MultiSelectOption[];
  className?: string;
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const remote = options === undefined;

  // Only asked when this control is sourcing its own options; the alarm board passes its own.
  const vehicles = useVehicles(
    {
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      pageSize: SEARCH_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    },
    remote,
  );

  const shown = useMemo(
    () => options ?? vehicleCodeOptions(vehicles.data?.items ?? [], value),
    [options, vehicles.data, value.join(',')],
  );

  return (
    <MultiSelect
      label={t('fleet.vehicles.fields.code')}
      options={shown}
      value={value}
      onChange={onChange}
      showSelectedValues
      chips
      // Always searchable, on all six screens. The component's default of 7 is right for a fixed
      // vocabulary — a handful of statuses is read, not searched — but a fleet is not that: its
      // length is whatever the registry holds today, and a control that grows a search box on
      // Tuesday and loses it on Wednesday teaches nobody where to type. It is also where the
      // codes are TYPED, so it cannot be conditional on how many happen to be offered.
      searchThreshold={0}
      {...(remote
        ? { onSearch: setSearch, searching: vehicles.isFetching }
        : {})}
      onCommitSearch={(raw) => {
        // The registry's answer to THIS text is what settles `A-15` against `215-216-217`.
        const known = shown.map((option) => option.value);
        const typed = parseVehicleCodes(raw, known);
        if (typed.length === 0) return;
        const merged = [...value];
        for (const code of typed) if (!merged.includes(code)) merged.push(code);
        onChange(merged);
      }}
      {...(className === undefined ? {} : { className })}
    />
  );
};
