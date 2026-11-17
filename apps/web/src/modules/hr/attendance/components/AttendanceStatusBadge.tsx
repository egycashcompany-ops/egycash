// The twelve day statuses (§3) and the six regularization statuses (§7), toned the way Leave tones
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
  // A presence, and toned as one. Most of the workforce scans on arrival and never scans out, so
  // this is the commonest good day on the sheet — drawing it as a problem (which is what
  // `incomplete` did to it) put a warning beside almost every name every morning, and a warning
  // that appears beside almost every name stops being read at all.
  checkedIn: 'success',
  late: 'warning',
  earlyLeave: 'warning',
  lateAndEarly: 'warning',
  // NOT a danger, and keeping it out of danger is the entire reason this status exists. «لم يحضر
  // بعد» is a day still being lived: the person is expected later today and nothing has gone
  // wrong yet. Toning it red would put an alarm beside every name every morning until each one
  // scanned, which is both false and the fastest way to teach people to ignore the colour.
  // Neutral by this file's own rule — nobody owes anything for it YET.
  pending: 'neutral',
  absent: 'danger',
  onLeave: 'info',
  weekend: 'neutral',
  holiday: 'neutral',
  dayOff: 'neutral',
  // HISTORICAL. Nothing derives this any more — a single punch is `checkedIn` — so it appears only
  // on days computed before that ruling, and keeps the tone it had while it meant something.
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
