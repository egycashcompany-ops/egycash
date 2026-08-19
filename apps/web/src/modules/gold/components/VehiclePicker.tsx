// INTEGRATION 1 — the vehicle that carried the shipment.
//
// `vehicleNumber` used to be typed by hand on the receipt. It is now a Fleet vehicle, searched by
// plate or code, and the server stores the plate beside the id so an already-printed receipt keeps
// showing the number it was printed with even after the car leaves the fleet.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { useVehicleSearch } from '../api/gold-queries';

export const VehiclePicker = ({
  label,
  value,
  valueLabel,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  valueLabel: string;
  onChange: (vehicleId: string, plate: string) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('fleetVehicle.view');
  const results = useVehicleSearch(search, allowed && !disabled);

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="truncate text-brand-800 dark:text-brand-200" dir="ltr">
            {valueLabel}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onChange('', '');
              }}
              aria-label={t('gold.common.clear')}
              className="shrink-0 rounded p-0.5 text-brand-700 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-900"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {!disabled && value === '' && !allowed && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('gold.common.pickerNoAccess')}
        </p>
      )}
      {!disabled && value === '' && allowed && (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('gold.common.pickVehicle')}
          />
          {results.isFetching && <Spinner />}
          {search.trim() !== '' && !results.isFetching && (
            <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {results.data?.items.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  {t('gold.common.noResults')}
                </li>
              )}
              {results.data?.items.map((vehicle) => (
                <li key={vehicle.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(vehicle.id, vehicle.plateNumber);
                      setSearch('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-800 dark:text-slate-200" dir="ltr">
                      {vehicle.plateNumber}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-400" dir="ltr">
                      {vehicle.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
