// The catalog filter that takes MORE THAN ONE answer — «اى فلتر ف الحركه زياده عن اتنين اختار ما
// بينهم اعملى multi selection».
//
// `CatalogSelect`'s twin, and deliberately only that: the same `useFleetCatalog(kind)` list, the
// same rule about an archived item that is still chosen, the same place in a filter bar. What
// differs is the question it asks — «أي فئة؟» instead of «فئة واحدة» — which is the whole request:
// a reader comparing «ملاكي» with «نقل» had to filter, read, change the filter and read again,
// holding the comparison in their head.
//
// A FORM still uses `CatalogSelect`. A row carries one class, one operation, one insurer, so the
// single-value control is right where a value is being CHOSEN and wrong where it is being ASKED
// about. Two components rather than one with a `multiple` flag, because the two have different
// types on `value` and a flag would make every caller's type depend on a boolean.
import { type FleetCatalogKind, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { localized } from '../../../shared/lib/format';
import { useFleetCatalog } from '../api/fleet-queries';

export const CatalogMultiSelect = ({
  kind,
  value,
  onChange,
  label,
  placeholder,
  density,
  className = 'w-auto',
  fullWidth = false,
}: {
  kind: FleetCatalogKind;
  value: readonly string[];
  onChange: (itemIds: string[]) => void;
  /** What the filter asks — the column's own name, as the bar prints it. */
  label: string;
  /** What the trigger says while nothing is chosen, where the bar writes the label above it. */
  placeholder?: string;
  density?: ControlDensity;
  className?: string;
  fullWidth?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog(kind);
  // An ARCHIVED item that is still selected stays on the list — the same rule the single select
  // keeps, for the same reason: a filter a reader set yesterday must still be readable and
  // removable today, and dropping the row would leave a filter that narrows the board with
  // nothing on the screen saying so.
  const items = (data?.items ?? []).filter((item) => item.isActive || value.includes(item.id));

  return (
    <MultiSelect
      label={label}
      {...(placeholder === undefined ? {} : { placeholder })}
      // The values are individually meaningful — WHICH classes, not how many — so the trigger
      // names them and the panel makes each one removable on its own.
      showSelectedValues
      chips
      options={items.map((item) => ({ value: item.id, label: localized(item.name, locale) }))}
      value={value}
      onChange={onChange}
      {...(density === undefined ? {} : { density })}
      fullWidth={fullWidth}
      className={className}
    />
  );
};
