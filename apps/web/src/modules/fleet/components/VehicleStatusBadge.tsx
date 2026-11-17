// Vehicle lifecycle badge (§4.1) + the DERIVED workshop flag (FR-12). The workshop badge is a
// separate pill because it is a different KIND of fact: status is an administrative decision,
// inWorkshop is where the car physically is right now.
import { type FleetVehicleStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Badge, StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { type ExpiryState } from './FuelCardBoard';

const TONES: Record<FleetVehicleStatus, Tone> = {
  active: 'success',
  outOfService: 'warning',
  disposed: 'neutral',
};

export const VehicleStatusBadge = ({ status }: { status: FleetVehicleStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`fleet.vehicles.status.${status}`)} />;
};

export const InWorkshopBadge = ({ inWorkshop }: { inWorkshop: boolean }): JSX.Element | null => {
  const t = useT();
  if (!inWorkshop) return null;
  return <Badge tone="info">{t('fleet.vehicles.inWorkshop')}</Badge>;
};

/**
 * «ساري» / «ينتهي قريباً» / «منتهي» beside a licence's expiry date — the vehicles board's tag, here
 * beside the car's other badges so the car card (`VehicleHoverCard`) says it the same way.
 */
export const LicenceTag = ({ state }: { state: ExpiryState }): JSX.Element | null => {
  const t = useT();
  if (state === 'unknown') return null;
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded border px-1 py-0 text-[10px] font-medium leading-4',
        state === 'valid' &&
          'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400',
        state === 'soon' &&
          'border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400',
        state === 'expired' &&
          'border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400',
      )}
    >
      {t(`fleet.fuelCards.expiry.${state}`)}
    </span>
  );
};
