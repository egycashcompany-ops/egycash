// «كود السيارة» on the phone form — one car, typed or picked, from EVERY active car.
//
// The shared `Combobox` in its phone size (`density="touch"`: 16px text so iOS does not zoom, 48px
// rows, a 40px ✕, a list that ends above the keyboard), driven the way Fleet's
// `VehicleCodeCombobox` drives it: the whole list is loaded (ADR-037 — «لازم لازم تظهر كلها»), and
// the typed text only narrows it, codes that START with it first (`rankVehicleCodes`), with
// Arabic-Indic digits read as Western ones. A code with a space («كورولا 1») is ONE car.
//
// The list is IT's own (`GET /it/vehicle-checks/vehicles`, under `itVehicleCheck.create`): the
// reporter needs no Fleet grant to see the cars. It is asked for again when the box opens on a
// list older than a minute, so a car activated since is on offer without reloading.
import { useMemo, useState } from 'react';
import { normalizeVehicleCode } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { asciiDigits } from '../../../shared/lib/format';
import { Combobox } from '../../../shared/ui/Combobox';
import { rankVehicleCodes } from '../../fleet/lib/vehicle-code-rank';
import { useItVehicleCheckCars } from '../api/it-queries';

export const VehicleCheckCarPicker = ({
  id,
  value,
  pendingCode,
  onChange,
  disabled = false,
}: {
  id: string;
  /** The chosen car's id; '' for none. The box shows its code. */
  value: string;
  /** The code a restored draft named, shown until the list arrives and names it itself. */
  pendingCode: string;
  onChange: (vehicleId: string, code: string) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  const cars = useItVehicleCheckCars();
  // Keyed by the code with its whitespace as one space, in the list's own order (Fleet's code
  // order, as the server sends it): «فورتشنر 2 » and «فورتشنر 2» are the same car.
  const byCode = useMemo(
    () => new Map((cars.data?.items ?? []).map((car) => [normalizeVehicleCode(car.code), car.id])),
    [cars.data],
  );
  const options = useMemo(() => rankVehicleCodes([...byCode.keys()], query), [byCode, query]);
  const known = useMemo(
    () => [...byCode.entries()].find(([, carId]) => carId === value)?.[0] ?? '',
    [byCode, value],
  );
  const shown = value === '' ? '' : known !== '' ? known : pendingCode;

  return (
    <Combobox
      id={id}
      value={shown}
      options={options}
      // The typed text is a SEARCH, never a value: `Combobox` only ever commits an option.
      onSearch={(typed) => {
        // `Combobox` asks with '' every time it opens: a list older than a minute is asked again.
        if (typed === '' && cars.isStale) void cars.refetch();
        // A code typed in Arabic-Indic digits («١٥٠») is the same code (150).
        setQuery(asciiDigits(typed));
      }}
      onChange={(code) => {
        const carId = code === '' ? '' : (byCode.get(code) ?? '');
        onChange(carId, carId === '' ? '' : code);
      }}
      placeholder={t('it.vehicleCheck.vehiclePlaceholder')}
      emptyText={cars.isLoading ? t('common.loading') : t('it.vehicleCheck.vehicleNotFound')}
      clearLabel={t('common.clear')}
      density="touch"
      disabled={disabled}
      testId="vehicle-check-car"
    />
  );
};
