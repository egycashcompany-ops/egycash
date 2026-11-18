// The thirteen day statuses (§3) and the six regularization statuses (§7), toned the way Leave
// tones its own: a warning is something waiting on a human, a danger is a refusal or an absence,
// and a neutral is a day nobody owes anything for.
//
// EACH DAY STATUS ALSO CARRIES AN ICON (stage 6). On a sheet of 1,300 rows the status column is
// scanned rather than read, and at a glance a tint alone is a poor signal: the amber of «متأخر»
// and the amber of «انصراف مبكر» are the same amber. The glyph is what separates them in the
// corner of the eye — and it is what carries the meaning for a reader who cannot separate the two
// tints at all, which is the whole reason colour is never the only carrier of state here.
import {
  type AttendanceDayStatus,
  type AttendanceRegularizationStatus,
} from '@ecms/contracts';
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Badge, type Tone } from '../../../../shared/ui';
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  CogIcon,
  FingerprintIcon,
  HistoryIcon,
  InboxIcon,
  MoonIcon,
  StarIcon,
} from '../../../../shared/ui/icons';

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
  // A GAP, and toned as one rather than as a rest day. It is neutral and not a danger because the
  // employee has done nothing wrong — the roster is incomplete — but the LABEL has to say which of
  // the two it is, because «يوم راحة» on a working day reads as a settled answer and this is an
  // open question for HR.
  noSchedule: 'neutral',
  // HISTORICAL. Nothing derives this any more — a single punch is `checkedIn` — so it appears only
  // on days computed before that ruling, and keeps the tone it had while it meant something.
  incomplete: 'danger',
  // NOT a danger, and that is the point of having it at all. «لا يوجد تسجيل» says ECMS has
  // concluded nothing about this date — most often because the imported history has not been
  // re-derived yet. Drawing it red would accuse two years of employees of not turning up; drawing
  // it as a rest day would hide the thing an operator has to act on. Muted, and labelled exactly.
  noRecord: 'neutral',
};

/**
 * One glyph per status, chosen so the three AMBER states and the three NEUTRAL ones are still
 * distinguishable from each other at a glance:
 *
 *   · a tick for a clean day, a fingerprint for one the device vouched for and nothing more;
 *   · an alert for the three that cost somebody minutes, a clock for the day still being waited on;
 *   · a calendar for leave, a moon for a rest day, a star for a public holiday;
 *   · a cog for «لا يوجد جدول», because it is the one state a person cannot fix by turning up —
 *     somebody has to go and configure the roster.
 */
const DAY_ICON: Record<AttendanceDayStatus, ComponentType<SVGProps<SVGSVGElement>>> = {
  present: CheckIcon,
  checkedIn: FingerprintIcon,
  late: AlertIcon,
  earlyLeave: AlertIcon,
  lateAndEarly: AlertIcon,
  pending: HistoryIcon,
  absent: CloseIcon,
  onLeave: CalendarIcon,
  weekend: MoonIcon,
  holiday: StarIcon,
  dayOff: MoonIcon,
  noSchedule: CogIcon,
  incomplete: AlertIcon,
  // An empty tray: nothing has been filed about this day. Deliberately NOT the moon a rest day
  // carries, and not the cog that means "go and configure the roster" — this one is answered by
  // running the backfill or linking a machine id, not by editing a schedule.
  noRecord: InboxIcon,
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
  size = 'md',
}: {
  status: AttendanceDayStatus;
  size?: 'sm' | 'md' | 'lg';
}): JSX.Element => {
  const t = useT();
  const Icon = DAY_ICON[status];
  return (
    <Badge tone={DAY_TONE[status]} size={size}>
      {/* Decorative: the label beside it already says what this is, so a screen reader that
          announced the glyph too would simply say it twice. */}
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(`attendance.dayStatus.${status}`)}
    </Badge>
  );
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
