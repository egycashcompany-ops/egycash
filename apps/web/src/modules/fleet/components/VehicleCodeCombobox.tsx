// «كود العربية», TYPED or picked — one car, from the whole registry.
//
// This replaces a native `<select>` in the two violation entry rows, and it fixes two things at
// once.
//
// THE OWNER ASKED TO TYPE IT: «عاوز فى ادخال البيانات الشركه والسواقيين انه يقدر يكتب برضو وهتكون
// واحد بس». Scrolling a dropdown to find «213» is slower than typing three digits of it, and a
// clerk filing a statement is reading the code off a piece of paper.
//
// AND THE DROPDOWN COULD NOT SEE THE WHOLE FLEET. `VehicleSelect` fetches ONE page of the registry
// at `pageSize: MAX_PAGE_SIZE` — a hard server cap of 100 — sorted by code. On a fleet of more
// than a hundred cars, every car past the hundredth was simply not offerable, and a row already
// filed against one of them showed the empty «اختر…» row as though no car had been chosen. The
// search belongs on the SERVER, which is what `vehicleCodeSearchQuery` asks it.
//
// It is `Combobox` rather than `VehicleCodeFilter` because the answer here is ONE car: `Combobox`
// commits exactly one value and can never commit something that is not an option, while the filter
// control is irreducibly multi — a list, checkbox rows, and a rule that takes several codes at once
// from one typed string.
//
// `wholeRegistry` is the accident form's mode — «لما ادوس بس على كود السياره» every car is in the
// list, and typing narrows it, codes that START with what was typed first. The whole registry is
// loaded once (`useAllVehicles`) and filtered here, so clicking shows all of it rather than the
// twenty-car shortlist a server search answers with.
import { useMemo, useState } from 'react';
import { vehicleCodeSearchQuery } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Combobox } from '../../../shared/ui/Combobox';
import { useAllVehicles, useVehicle, useVehicles } from '../api/fleet-queries';
import { rankVehicleCodes } from '../lib/vehicle-code-rank';

/** How many matches one search offers — a shortlist to pick from, not a catalogue. */
const SEARCH_SIZE = 20;

export const VehicleCodeCombobox = ({
  value,
  onChange,
  density,
  testId,
  ariaLabel,
  anyStatus = false,
  wholeRegistry = false,
  placeholder,
}: {
  /** The chosen vehicle's id ('' = none). The box shows its CODE. */
  value: string;
  onChange: (vehicleId: string) => void;
  density?: 'default' | 'tight';
  testId?: string;
  ariaLabel?: string;
  /**
   * Offer the WHOLE registry, any lifecycle status — for recording historical facts. A statement
   * can name a car that has since been disposed of, the same reason `VehicleSelect` takes this.
   */
  anyStatus?: boolean;
  /** Offer EVERY car on opening and narrow as the clerk types — see the head of this file. */
  wholeRegistry?: boolean;
  /** What the empty box says; «اختر…» unless given. */
  placeholder?: string;
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  // What is CHOSEN here — its id with its code — held apart from the search: the next search will
  // not contain it, and the box must go on showing the chosen car rather than blanking as the
  // clerk types. The id is kept with the code so a value changed from OUTSIDE (the other entry
  // bar picking a car) is told apart from this box's own pick, and the old code is not shown
  // against the new id.
  const [picked, setPicked] = useState({ id: '', code: '' });

  const searched = useVehicles(
    {
      ...vehicleCodeSearchQuery(query),
      ...(anyStatus ? {} : { status: 'active' }),
      pageSize: SEARCH_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    },
    !wholeRegistry,
  );
  const whole = useAllVehicles({ anyStatus }, wholeRegistry);
  const items = (wholeRegistry ? whole.data : searched.data)?.items;

  const byCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of items ?? []) map.set(v.code, v.id);
    return map;
  }, [items]);
  const options = useMemo(
    () => (wholeRegistry ? rankVehicleCodes([...byCode.keys()], query) : [...byCode.keys()]),
    [byCode, query, wholeRegistry],
  );

  // A value handed in from outside — a row being edited, a car carried from another screen — names
  // a car whose code this control has not searched for. The id is known, the code is not: the
  // current list is read first, and a car it does not carry (past the twenty-car shortlist, or
  // not yet loaded) is asked for by its id, so the box never reads as empty for a car it has.
  const known = useMemo(
    () => [...byCode.entries()].find(([, id]) => id === value)?.[0] ?? '',
    [byCode, value],
  );
  const lookup = useVehicle(value !== '' && known === '' && picked.id !== value ? value : '');
  const resolved = known !== '' ? known : lookup.data?.id === value ? lookup.data.code : '';
  const shownCode = value === '' ? '' : picked.id === value ? picked.code : resolved;

  return (
    <Combobox
      value={shownCode}
      options={options}
      // The typed text is a SEARCH, never a value: `Combobox` only ever commits an option, so a
      // code the registry does not carry cannot be stored.
      onSearch={setQuery}
      onChange={(code) => {
        const id = code === '' ? '' : (byCode.get(code) ?? '');
        setPicked({ id, code: id === '' ? '' : code });
        onChange(id);
      }}
      placeholder={placeholder ?? t('common.select')}
      emptyText={t('common.noResults')}
      clearLabel={t('common.clear')}
      tallList={wholeRegistry}
      {...(density === undefined ? {} : { density })}
      {...(testId === undefined ? {} : { testId })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
    />
  );
};
