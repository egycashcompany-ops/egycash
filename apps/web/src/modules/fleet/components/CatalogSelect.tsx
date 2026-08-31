// Reusable fleet-catalog select (workshops, work types, mission/violation types…). Options are
// the live active items of one kind; an inactive current value stays visible so an edit form
// never silently loses a historical reference.
import { type FleetCatalogKind, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Select } from '../../../shared/ui/form';
import { localized } from '../../../shared/lib/format';
import { useFleetCatalog } from '../api/fleet-queries';

export const CatalogSelect = ({
  kind,
  value,
  onChange,
  allLabel,
  id,
  ariaLabel,
  disabled = false,
}: {
  kind: FleetCatalogKind;
  value: string;
  onChange: (itemId: string) => void;
  /** When set, an empty "all" option with this label is offered (filter mode). */
  allLabel?: string;
  id?: string;
  ariaLabel?: string;
  /**
   * Show the current value but refuse to change it.
   *
   * A DISABLED select, not a swap to plain text: the reader keeps seeing the same control in the
   * same place holding the same name, so a row whose value cannot be edited still reads as the
   * same kind of row. Replacing it with text would make an unchangeable value look like a
   * different sort of data, and would move everything beside it.
   */
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog(kind);
  const items = (data?.items ?? []).filter((item) => item.isActive || item.id === value);

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-auto"
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
