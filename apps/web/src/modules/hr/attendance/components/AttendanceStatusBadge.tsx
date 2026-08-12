// The ten day statuses (§3) and the six regularization statuses (§7), toned the way Leave tones
// its own: a warning is something waiting on a human, a danger is a refusal or an absence, and a
// neutral is a day nobody owes anything for.
import {
  type AttendanceDayStatus,
  type AttendanceRegularizationStatus,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';

const DAY_TONE: Record<AttendanceDayStatus, Tone> = {
  present: 'success',
  late: 'warning',
  earlyLeave: 'warning',
  lateAndEarly: 'warning',
  absent: 'danger',
  onLeave: 'info',
  weekend: 'neutral',
  holiday: 'neutral',
  dayOff: 'neutral',
  // The one status that blocks a payroll calculation until a regularization fixes it (D6).
  incomplete: 'danger',
};

const REGULARIZATION_TONE: Record<AttendanceRegularizationStatus, Tone> = {
  draft: 'neutral',
  pendingManager: 'warning',
  pendingHr: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export const AttendanceDayStatusBadge = ({
  status,
}: {
  status: AttendanceDayStatus;
}): JSX.Element => {
  const t = useT();
  return <Badge tone={DAY_TONE[status]}>{t(`attendance.dayStatus.${status}`)}</Badge>;
};

export const RegularizationStatusBadge = ({
  status,
}: {
  status: AttendanceRegularizationStatus;
}): JSX.Element => {
  const t = useT();
  return (
    <Badge tone={REGULARIZATION_TONE[status]}>{t(`attendance.regStatus.${status}`)}</Badge>
  );
};
