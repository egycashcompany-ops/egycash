// Vehicle lifecycle badge (§4.1) + the DERIVED workshop flag (FR-12). The workshop badge is a
// separate pill because it is a different KIND of fact: status is an administrative decision,
// inWorkshop is where the car physically is right now.
import { type FleetVehicleStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge, StatusBadge, type Tone } from '../../../shared/ui/Badge';

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
