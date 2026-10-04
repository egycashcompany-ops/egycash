// «كود العربية», TYPED or picked — one car, from the whole registry.
//
// This replaces a native `<select>` in the two violation entry rows, and it fixes two things at
// once.
//
// THE OWNER ASKED TO TYPE IT: «عاوز فى ادخال البيانات الشركه والسواقيين انه يقدر يكتب برضو وهتكون
// واحد بس». Scrolling a dropdown to find «213» is slower than typing three digits of it, and a
// clerk filing a statement is reading the code off a piece of paper.
//
// AND EVERY CAR IS IN THE LIST. «اكواد السيارات فى الادخال او الفلاتر لازم لازم تظهر كلها من شاشة
// السيارات فى اى شاشه من شاشات الحركه». The registry is loaded whole (`useAllVehicles`, every
// page) and narrowed HERE as the clerk types — codes that START with what was typed first. It used
// to ask the server for a twenty-car shortlist per keystroke, so clicking the box offered the first
// twenty codes and nothing past them; the accident form had already moved to the whole list, and
// now every caller has. `lib/vehicle-code-selectors.spec.ts` keeps it that way for new screens.
//
// It is `Combobox` rather than `VehicleCodeFilter` because the answer here is ONE car: `Combobox`
// commits exactly one value and can never commit something that is not an option, while the filter
// control is irreducibly multi — a list, checkbox rows, and a rule that takes several codes at once
// from one typed string.
//
// WHICH cars is the caller's, unchanged by any of this: `anyStatus` for a historical fact (every
// lifecycle status, as the vehicles screen lists), the active cars otherwise; `excludeInWorkshop`
// for the workshop check-in, which the server refuses for a car already inside.
import { useMemo, useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { Combobox } from '../../../shared/ui/Combobox';
import { asciiDigits } from '../../../shared/lib/format';
import { useAllVehicles, useVehicle } from '../api/fleet-queries';
import { vehicleCodeEntries } from '../lib/vehicle-code-options';
import { rankVehicleCodes } from '../lib/vehicle-code-rank';

export const VehicleCodeCombobox = ({
  value,
  onChange,
  density,
  testId,
  ariaLabel,
  anyStatus = false,
  excludeInWorkshop = false,
  placeholder,
  pendingCode = '',
  emptyText,
  extra,
}: {
  /** The chosen vehicle's id ('' = none). The box shows its CODE. */
  value: string;
  onChange: (vehicleId: string) => void;
  density?: 'default' | 'tight';
  testId?: string;
  ariaLabel?: string;
  /**
   * Offer the WHOLE registry, any lifecycle status — for recording historical facts. A statement
   * can name a car that has since been disposed of.
   */
  anyStatus?: boolean;
  /**
   * Leave out the cars already IN a workshop — the check-in's list. The car already chosen stays,
   * so an edit never blanks its own value.
   */
  excludeInWorkshop?: boolean;
  /** What the empty box says; «اختر…» unless given. */
  placeholder?: string;
  /**
   * A code the caller already KNOWS but has not turned into an id yet — carried in from a page
   * filtered to one car. Shown as the box's value from the first paint while nothing is chosen, so
   * the box never flashes empty before the registry answers.
   */
  pendingCode?: string;
  /** What an empty list says; «لا توجد نتائج» unless given. */
  emptyText?: string;
  /**
   * Places that are not cars but are picked like one — the fuel cards on no car («سفر 1»,
   * «تويوتا اللواء»), offered after the registry under their label, with the caller's own id.
   */
  extra?: readonly { id: string; code: string }[];
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  // What is CHOSEN here — its id with its code — held apart from the search: the next search will
  // not contain it, and the box must go on showing the chosen car rather than blanking as the
  // clerk types. The id is kept with the code so a value changed from OUTSIDE (the other entry
  // bar picking a car) is told apart from this box's own pick, and the old code is not shown
  // against the new id.
  const [picked, setPicked] = useState({ id: '', code: '' });

  const whole = useAllVehicles({ anyStatus });
  const items = whole.data?.items;

  const byCode = useMemo(() => {
    const entries = vehicleCodeEntries(items ?? [], { excludeInWorkshop, chosenId: value });
    if (extra === undefined || extra.length === 0) return entries;
    const merged = new Map(entries);
    for (const place of extra) if (!merged.has(place.code)) merged.set(place.code, place.id);
    return merged;
  }, [items, excludeInWorkshop, value, extra]);
  const options = useMemo(() => rankVehicleCodes([...byCode.keys()], query), [byCode, query]);

  // A value handed in from outside — a row being edited, a car carried from another screen — is an
  // id. The list is read first; a car it does not carry (another status, or the list not loaded
  // yet) is asked for by its id, so the box never reads as empty for a car it has.
  const known = useMemo(
    () => [...byCode.entries()].find(([, id]) => id === value)?.[0] ?? '',
    [byCode, value],
  );
  const lookup = useVehicle(value !== '' && known === '' && picked.id !== value ? value : '');
  const resolved = known !== '' ? known : lookup.data?.id === value ? lookup.data.code : '';
  // A carried-in code is named until the registry arrives, and while it names a car this box offers;
  // once the list is in and no such car is on it, the box is empty rather than showing a code that
  // cannot be saved.
  const pendingShown = pendingCode !== '' && (whole.isPending || byCode.has(pendingCode));
  const shownCode =
    value === '' ? (pendingShown ? pendingCode : '') : picked.id === value ? picked.code : resolved;

  return (
    <Combobox
      value={shownCode}
      options={options}
      // The typed text is a SEARCH, never a value: `Combobox` only ever commits an option, so a
      // code the registry does not carry cannot be stored.
      onSearch={(typed) => {
        // `Combobox` asks with '' every time it opens: a list loaded a while ago is asked again, so
        // a car registered since — by anyone — is on offer without reloading the page.
        if (typed === '' && whole.isStale) void whole.refetch();
        // A code pasted in Arabic-Indic digits («١٥٠») is the same code (150).
        setQuery(asciiDigits(typed));
      }}
      onChange={(code) => {
        const id = code === '' ? '' : (byCode.get(code) ?? '');
        setPicked({ id, code: id === '' ? '' : code });
        onChange(id);
      }}
      placeholder={placeholder ?? t('common.select')}
      emptyText={whole.isLoading ? t('common.loading') : (emptyText ?? t('common.noResults'))}
      clearLabel={t('common.clear')}
      tallList
      {...(density === undefined ? {} : { density })}
      {...(testId === undefined ? {} : { testId })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
    />
  );
};
