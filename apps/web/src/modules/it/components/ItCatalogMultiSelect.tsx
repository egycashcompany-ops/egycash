// The IT catalog filter that takes MORE THAN ONE answer — «وعايز الأتنين دول يبقوا Multiselect»:
// the asset register's and the custody register's «الفئة».
//
// `ItCatalogSelect`'s twin, and deliberately only that: the same `useItCatalog(kind)` list, the
// same rule about an archived row that is still chosen. A FORM still uses `ItCatalogSelect` — an
// asset has one category, so the single-value control is right where a value is being CHOSEN and
// wrong where it is being ASKED about (Fleet draws the same line: `CatalogMultiSelect`).
import { type ItCatalogKind, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { localized } from '../../../shared/lib/format';
import { useItCatalog } from '../api/it-queries';

export const ItCatalogMultiSelect = ({
  kind,
  value,
  onChange,
  label,
  placeholder,
  density,
  className,
  fullWidth = false,
}: {
  kind: ItCatalogKind;
  value: readonly string[];
  onChange: (itemIds: string[]) => void;
  /** What the filter asks — the column's own name. */
  label: string;
  /** What the trigger says while nothing is chosen, where the bar writes the label above it. */
  placeholder?: string;
  density?: ControlDensity;
  className?: string;
  fullWidth?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isPending } = useItCatalog(kind);
  // An ARCHIVED row that is still chosen stays on the list — a filter set yesterday must still be
  // readable and removable today; dropping the row would leave a filter that narrows the register
  // with nothing on the screen saying so.
  const items = (data?.items ?? []).filter((item) => item.isActive || value.includes(item.id));

  return (
    <MultiSelect
      clearable
      label={label}
      {...(placeholder === undefined ? {} : { placeholder })}
      // The values are individually meaningful — WHICH categories, not how many — so the trigger
      // names them and the panel makes each one removable on its own.
      showSelectedValues
      chips
      searching={isPending}
      options={items.map((item) => ({ value: item.id, label: localized(item.name, locale) }))}
      value={value}
      onChange={onChange}
      {...(density === undefined ? {} : { density })}
      fullWidth={fullWidth}
      {...(className === undefined ? {} : { className })}
    />
  );
};
