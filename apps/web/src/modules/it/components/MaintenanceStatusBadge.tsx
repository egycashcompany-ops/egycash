// Maintenance-order status pill. The status is a SERVER fact moved only by a named transition
// (§4.7) — this component picks a tone and a translated label and never infers one.
import { type ItMaintenanceOrderStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<ItMaintenanceOrderStatus, Tone>> = {
  open: 'info',
  inProgress: 'brand',
  completed: 'success',
  cancelled: 'neutral',
};

export const MaintenanceStatusBadge = ({
  status,
}: {
  status: ItMaintenanceOrderStatus;
}): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`it.maintenance.status.${status}`)} />;
};
