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
import { useEffect, useMemo, useState } from 'react';
import { vehicleCodeSearchQuery } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Combobox } from '../../../shared/ui/Combobox';
import { useVehicles } from '../api/fleet-queries';

/** How many matches one search offers — a shortlist to pick from, not a catalogue. */
const SEARCH_SIZE = 20;

export const VehicleCodeCombobox = ({
  value,
  onChange,
  density,
  testId,
  ariaLabel,
  anyStatus = false,
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
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  // The code of what is CHOSEN, held apart from the search: the next search will not contain it,
  // and the box must go on showing the chosen car rather than blanking as the clerk types.
  const [pickedCode, setPickedCode] = useState('');

  const vehicles = useVehicles({
    ...vehicleCodeSearchQuery(query),
    ...(anyStatus ? {} : { status: 'active' }),
    pageSize: SEARCH_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });

  const byCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.code, v.id);
    return map;
  }, [vehicles.data]);
  const options = useMemo(() => [...byCode.keys()], [byCode]);

  // A value handed in from outside — a row being edited, a car carried from another screen — names
  // a car whose code this control has not searched for. The id is known, the code is not, so the
  // registry is asked for it once and the box stops reading as empty.
  const known = useMemo(
    () => [...byCode.entries()].find(([, id]) => id === value)?.[0] ?? '',
    [byCode, value],
  );
  useEffect(() => {
    if (value === '') {
      setPickedCode('');
      return;
    }
    if (known !== '') setPickedCode(known);
  }, [value, known]);

  return (
    <Combobox
      value={pickedCode}
      options={options}
      // The typed text is a SEARCH, never a value: `Combobox` only ever commits an option, so a
      // code the registry does not carry cannot be stored.
      onSearch={setQuery}
      onChange={(code) => {
        setPickedCode(code);
        onChange(code === '' ? '' : (byCode.get(code) ?? ''));
      }}
      placeholder={t('common.select')}
      emptyText={t('common.noResults')}
      clearLabel={t('common.clear')}
      {...(density === undefined ? {} : { density })}
      {...(testId === undefined ? {} : { testId })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
    />
  );
};
