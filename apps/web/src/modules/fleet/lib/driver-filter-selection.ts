// The drivers registry's «الاسم / كود الموظف» filter, as rules rather than as JSX.
//
// The control is the vehicle-code picker's shape — search, tick, chips, un-tick — applied to
// people instead of cars, and it is a MULTI-select for the same reason that one is: a dispatcher
// asking about three drivers has three drivers in mind, not a string. The box it replaced sent
// whatever was typed to HR as ONE search term, so «١٥٠ ١٥١» named nobody and the list answered
// «no results» over a filter bar that said two people were selected.
//
// Two rules live here, and both are the kind that goes quietly wrong inside a component:
//
//   • A PICKED driver must stay pickable. The options are a live HR search, so the driver chosen
//     a moment ago drops out of the answer as soon as the search moves on — and with them the row
//     that un-ticks them. The selection is merged back in front of the results, exactly as
//     `vehicleCodeOptions` does for a code, so a filter you can set stays one you can unset.
//   • Two ways of naming people INTERSECT. The picked ids and the ids HR matched for the address /
//     governorate / phone boxes are two different questions about the same list, and «أحمد, in
//     Maadi» means both. Unioning them, or letting the last one win, would widen a filter the
//     reader narrowed.
//
// Kept out of the component because a closed popover renders no options at all, so this is the
// half a node-environment test can actually reach.

/** What the picker knows about one employee — whatever the HR search handed back. */
export interface DriverPickOption {
  employeeId: string;
  /** The name as HR spells it. Empty when the record has not loaded yet. */
  name: string;
  /** The employee code — the other thing people search by, and what disambiguates two «محمد»s. */
  code: string;
}

/** One row of the picker, in `MultiSelect`'s own shape. */
export interface DriverPickerOption {
  value: string;
  label: string;
  shortLabel: string;
}

/**
 * How a driver reads in the list: «محمد أحمد — 0100004».
 *
 * Both, because either alone fails somewhere real: names repeat inside one branch, and a code on
 * its own is not a person anybody recognises. A record that has not loaded yet is named by the
 * only thing known about it rather than by an empty string, so a chip never renders blank.
 */
export const driverPickLabel = (option: DriverPickOption): string => {
  const name = option.name.trim();
  const code = option.code.trim();
  if (name !== '' && code !== '') return `${name} — ${code}`;
  return name !== '' ? name : code !== '' ? code : option.employeeId;
};

/** The trigger has one row for the whole selection, so a chip says the shortest true thing. */
export const driverPickShortLabel = (option: DriverPickOption): string => {
  const name = option.name.trim();
  return name !== '' ? name : option.code.trim() !== '' ? option.code.trim() : option.employeeId;
};

/**
 * The search's answer, with everyone already picked kept in front of it.
 *
 * Order puts the selection first so the people you can turn OFF are never below a scroll — the
 * same promise `vehicleCodeOptions` makes, for the same reason.
 */
export const driverPickerOptions = (
  matched: readonly DriverPickOption[],
  selected: readonly string[],
  /** What is known about the picked ids — the cached employee records the table already reads. */
  known: ReadonlyMap<string, DriverPickOption>,
): DriverPickerOption[] => {
  const row = (option: DriverPickOption): DriverPickerOption => ({
    value: option.employeeId,
    label: driverPickLabel(option),
    shortLabel: driverPickShortLabel(option),
  });
  const found = matched.map(row);
  const shown = new Set(found.map((option) => option.value));
  const kept = selected
    .filter((id) => !shown.has(id))
    // A person can only be picked once, however many times the URL repeats them.
    .filter((id, at, all) => all.indexOf(id) === at)
    .map((id) => row(known.get(id) ?? { employeeId: id, name: '', code: '' }));
  return [...kept, ...found];
};

/**
 * The one `employeeIds` the fleet list is asked for, from the two ways this bar names people.
 *
 * `null` means «no such filter» and leaves the list unnarrowed. An EMPTY ARRAY is a real answer —
 * "nobody matches both" — and must stay expressible, because dropping it would answer a filtered
 * question with an unfiltered list.
 *
 * @param picked ids ticked in the multi-select, in the order they were chosen.
 * @param hrMatched ids HR returned for the address / governorate / phone boxes, or `null` when
 *   none of those is set.
 */
export const driverIdFilter = (
  picked: readonly string[],
  hrMatched: readonly string[] | null,
): string[] | null => {
  if (picked.length === 0) return hrMatched === null ? null : [...hrMatched];
  if (hrMatched === null) return [...picked];
  const allowed = new Set(hrMatched);
  return picked.filter((id) => allowed.has(id));
};
