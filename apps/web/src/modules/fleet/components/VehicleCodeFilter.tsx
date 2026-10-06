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
// EVERY CAR IS ON OFFER. «اكواد السيارات فى الادخال او الفلاتر لازم لازم تظهر كلها من شاشة
// السيارات». The options are the WHOLE registry (`useAllVehicles`, every page, every lifecycle
// status — what the vehicles screen lists), narrowed here as the reader types. They used to come
// from a server search capped at fifty, so opening the box offered the first fifty codes and no
// way to scroll to the rest. A board that already holds every car it reports on (alarms,
// licensing, both rosters) passes its own `options` instead, and is narrowed the same way.
// `lib/vehicle-code-selectors.spec.ts` keeps new screens on this control.
import { useMemo, useState } from 'react';
import { splitVehicleCodeList } from '@ecms/contracts';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { useT } from '../../../platform/localization/useT';
import { asciiDigits } from '../../../shared/lib/format';
import { useAllVehicles } from '../api/fleet-queries';
import { readTypedVehicleCodes } from '../lib/typed-vehicle-codes';
import { narrowVehicleCodeOptions, registryVehicleCodeOptions } from '../lib/vehicle-code-options';

export const VehicleCodeFilter = ({
  value,
  onChange,
  options,
  className,
  placeholder,
  density,
  fullWidth = false,
  plainSearch = false,
}: {
  /** The codes currently filtering, in the order they were chosen. */
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * Options to offer INSTEAD of the whole registry — for a board that already holds every car it
   * reports on (alarms, licensing, both rosters). Omit it and every car is offered.
   */
  options?: MultiSelectOption[];
  className?: string;
  /**
   * What the EMPTY trigger says, for a bar that writes the question ABOVE the control.
   *
   * Unset everywhere the question is only askable inside the box, which is every screen that
   * existed before `FilterField`: the trigger then says «كود السيارة» exactly as it always has.
   */
  placeholder?: string;
  /** Passed straight through — a bar sizing its controls to one rhythm asks for `tight`. */
  density?: ControlDensity;
  /** Fill the width this control was given — see `MultiSelect`. */
  fullWidth?: boolean;
  /**
   * Search the offered names as they are written, spaces and all — for a list that holds labels
   * («سفر 1», «تويوتا اللواء») besides codes, where a space is part of the name and not the end of a
   * code. Enter takes the one offered name typed in full; nothing typed becomes a pick by itself.
   */
  plainSearch?: boolean;
}): JSX.Element => {
  const t = useT();
  // What is still being TYPED — the trailing fragment, after the completed codes have been taken
  // into the selection. It narrows the list and is the box's text.
  const [search, setSearch] = useState('');
  const remote = options === undefined;

  // The whole registry, only when this control sources its own options; a board passes its own.
  // Every lifecycle status, as the vehicles screen lists them: a filter asks about history too.
  const vehicles = useAllVehicles({ anyStatus: true }, remote);

  const add = (codes: readonly string[]): void => {
    if (codes.length === 0) return;
    const merged = [...value];
    for (const code of codes) if (!merged.includes(code)) merged.push(code);
    if (merged.length !== value.length) onChange(merged);
  };

  /** The rule, and why, live beside their own test in `readTypedVehicleCodes`. */
  const consume = (raw: string): void => {
    if (plainSearch) {
      setSearch(raw);
      return;
    }
    // `MultiSelect` asks with '' every time it opens: a list loaded a while ago is asked again, so a
    // car registered since — by anyone — is on offer without reloading the page.
    if (raw === '' && remote && vehicles.isStale) void vehicles.refetch();
    // A code pasted in Arabic-Indic digits («١٥٠») is the same code (150).
    const { chosen, typing } = readTypedVehicleCodes(asciiDigits(raw));
    add(chosen);
    setSearch(typing);
  };

  // Either way the fragment narrows the list HERE, by CODE alone — `MultiSelect` treats an
  // `onSearch` handler as proof that somebody else is filtering, and this control passes one on
  // every screen because that is how a typed code is taken into the selection.
  const shown = useMemo(
    () =>
      options === undefined
        ? registryVehicleCodeOptions(vehicles.data?.items ?? [], search, value)
        : plainSearch
          ? options.filter(
              (option) =>
                value.includes(option.value) ||
                option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
            )
          : narrowVehicleCodeOptions(options, search, value),
    [options, vehicles.data, search, value.join(','), plainSearch],
  );

  return (
    <MultiSelect
      clearable
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
      {...(remote ? { searching: vehicles.isLoading } : {})}
      // Enter takes whatever is left in the box, separator or not — the last code of a list needs
      // no trailing punctuation to be meant.
      onCommitSearch={(raw) => {
        if (plainSearch) {
          const typed = raw.trim();
          const exact = (options ?? []).find(
            (option) => option.value === typed || option.label === typed,
          );
          if (exact !== undefined) add([exact.value]);
        } else {
          add(splitVehicleCodeList(raw));
        }
        setSearch('');
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      fullWidth={fullWidth}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
