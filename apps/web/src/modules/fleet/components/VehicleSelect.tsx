// Reusable vehicle select (filters + dialogs). Options come from the live registry, sorted by
// code. By default only ACTIVE vehicles are offered (the operational cases); `anyStatus` lifts
// that for screens recording HISTORICAL facts — an accident may reference a disposed vehicle
// (§4.6), unlike an odometer reading. `excludeInWorkshop` pre-trims cars the server would
// refuse anyway (FR-4/FR-5) — the server remains the authority, this only spares the user a
// guaranteed 409.
import { useT } from '../../../platform/localization/useT';
import { Select } from '../../../shared/ui/form';
import { useVehicles } from '../api/fleet-queries';

export const VehicleSelect = ({
  value,
  onChange,
  allLabel,
  excludeInWorkshop = false,
  anyStatus = false,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (vehicleId: string) => void;
  /** When set, an empty "all vehicles" option with this label is offered (filter mode). */
  allLabel?: string;
  excludeInWorkshop?: boolean;
  /** Offer the WHOLE registry (any lifecycle status) — for recording historical facts. */
  anyStatus?: boolean;
  id?: string;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const { data } = useVehicles({
    ...(anyStatus ? {} : { status: 'active' }),
    pageSize: 100,
    sortBy: 'code',
    sortDir: 'asc',
  });
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
