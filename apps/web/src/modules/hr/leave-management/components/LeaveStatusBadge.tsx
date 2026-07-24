import { type LeaveRequestStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const TONE: Record<LeaveRequestStatus, Tone> = {
  pendingManager: 'warning',
  pendingHr: 'warning',
  approved: 'info',
  active: 'success',
  completed: 'neutral',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const LeaveStatusBadge = ({ status }: { status: LeaveRequestStatus }): JSX.Element => {
  const t = useT();
  return <Badge tone={TONE[status]}>{t(`leave.status.${status}`)}</Badge>;
};
