// Reusable IT catalog select (asset categories today; ticket categories when IT-3 needs them).
// Options are the live ACTIVE rows of one kind — with one exception that matters: an archived
// row stays visible while it is the current value, so editing an old asset never silently drops
// its category (FR-11 archives rows precisely because history still points at them).
import { type ItCatalogKind, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Select } from '../../../shared/ui/form';
import { localized } from '../../../shared/lib/format';
import { useItCatalog } from '../api/it-queries';

export const ItCatalogSelect = ({
  kind,
  value,
  onChange,
  allLabel,
  id,
  ariaLabel,
  className,
}: {
  kind: ItCatalogKind;
  value: string;
  onChange: (itemId: string) => void;
  /** When set, an empty "all" option with this label is offered (filter mode). */
  allLabel?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useItCatalog(kind);
  const items = (data?.items ?? []).filter((item) => item.isActive || item.id === value);

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-auto'}
    >
      <option value="">{allLabel ?? t('common.select')}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {localized(item.name, locale)}
        </option>
      ))}
    </Select>
  );
};
