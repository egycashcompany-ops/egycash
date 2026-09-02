// "Which cars?" — asked the same way on all six screens that ask it.
//
// Maintenance, Odometer, Alarms, the vehicle registry, Accidents and Violations all filter by car.
// Before this they asked in four different vocabularies: two of them a `vehicleCodes` multi-select,
// one a substring text box, one a single dropdown, and Accidents BOTH of the last two at once —
// which let a reader pick car 215 and type 216 and get an empty page their own filter bar said was
// possible. This is the one control, and `vehicleCodes=215,216,217` is the one URL shape.
//
// TYPED AS WELL AS PICKED. An operator is usually reading codes off a message — `215 - 216 - 217`
// — so the search box doubles as the input, and it TAKES each code the moment its separator is
// typed. `215 - 216 - 217` ticks 215, then 216, and leaves 217 in the box as the live search.
//
// That is not a flourish; without it the box was unusable for the thing it is for. The whole text
// went to the registry as one search term, so the instant a separator was typed the term became
// `150 - ` — which names no car — and the list answered "no results" over a box the reader was
// halfway through filling. Reading the completed codes out and searching only on the fragment
// still being typed is what keeps the list answering the question actually being asked.
//
// A code cannot contain a space, so the space around a dash is what makes it a separator:
// `215 - 216` is two cars and `A-15` is one code, always, with no second reading.
//
// The options come from the registry a shortlist at a time (`onSearch`), never from one page of
// it: a fleet outgrows any page, and a joined-against list would silently stop at its size. Alarms
// is the exception and passes its own `options` — it already holds the whole board.
import { useMemo, useState } from 'react';
import { splitVehicleCodeList, vehicleCodeSearchQuery } from '@ecms/contracts';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useT } from '../../../platform/localization/useT';
import { useVehicles } from '../api/fleet-queries';
import { readTypedVehicleCodes } from '../lib/typed-vehicle-codes';
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
  // What is still being TYPED — the trailing fragment, after the completed codes have been taken
  // into the selection. It is both the registry's search term and the box's text.
  const [search, setSearch] = useState('');
  const remote = options === undefined;

  const add = (codes: readonly string[]): void => {
    if (codes.length === 0) return;
    const merged = [...value];
    for (const code of codes) if (!merged.includes(code)) merged.push(code);
    if (merged.length !== value.length) onChange(merged);
  };

  /** The rule, and why, live beside their own test in `readTypedVehicleCodes`. */
  const consume = (raw: string): void => {
    const { chosen, typing } = readTypedVehicleCodes(raw);
    add(chosen);
    setSearch(typing);
  };

  // Only asked when this control is sourcing its own options; the alarm board passes its own.
  // `code`, never `search`: this control is labelled with the code and offers what it matched, so
  // it has to match on the code. `search` spans plate, chassis and motor too — typing a plate here
  // used to offer whichever car carries it, listed under a code the reader never typed.
  const vehicles = useVehicles(
    {
      ...vehicleCodeSearchQuery(search),
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
      searchValue={search}
      onSearch={consume}
      {...(remote ? { searching: vehicles.isFetching } : {})}
      // Enter takes whatever is left in the box, separator or not — the last code of a list needs
      // no trailing punctuation to be meant.
      onCommitSearch={(raw) => {
        add(splitVehicleCodeList(raw));
        setSearch('');
      }}
      {...(className === undefined ? {} : { className })}
    />
  );
};
