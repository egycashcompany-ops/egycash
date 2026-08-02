// Reusable ACTIVE-vehicle select (filters + dialogs). Options come from the live registry,
// sorted by code; `excludeInWorkshop` pre-trims cars the server would refuse anyway (FR-4/FR-5)
// — the server remains the authority, this only spares the user a guaranteed 409.
import { useT } from '../../../platform/localization/useT';
import { Select } from '../../../shared/ui/form';
import { useVehicles } from '../api/fleet-queries';

export const VehicleSelect = ({
  value,
  onChange,
  allLabel,
  excludeInWorkshop = false,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (vehicleId: string) => void;
  /** When set, an empty "all vehicles" option with this label is offered (filter mode). */
  allLabel?: string;
  excludeInWorkshop?: boolean;
  id?: string;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const { data } = useVehicles({ status: 'active', pageSize: 100, sortBy: 'code', sortDir: 'asc' });
  const vehicles = (data?.items ?? []).filter(
    (v) => !excludeInWorkshop || !v.inWorkshop || v.id === value,
  );

  return (
    <Select
      id={id}
      aria-label={ariaLabel ?? t('fleet.vehicles.columns.code')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-auto"
    >
      <option value="">{allLabel ?? t('common.select')}</option>
      {vehicles.map((vehicle) => (
        <option key={vehicle.id} value={vehicle.id}>
          {vehicle.code} — {vehicle.plateNumber}
        </option>
      ))}
    </Select>
  );
};
