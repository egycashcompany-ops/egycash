// The display side of the attendance surface — the two pure decisions the page makes.
//
// They live here rather than inline because both are the kind of mapping that goes wrong quietly:
// a status added to HR later must not fall through to a green badge, and a date must not shift a
// day because the browser is in a different timezone from the server.
import { type AttendanceDayStatus } from '@ecms/contracts';

/** `YYYY-MM-DD` in UTC — the day the server keys on, not the browser's local day. */
export const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

export type AttendanceTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Status → badge tone. The DEFAULT is neutral, never success: an unrecognized status is a status
 * this build does not understand, and painting it green would assert something nobody checked.
 */
export const attendanceTone = (status: AttendanceDayStatus): AttendanceTone => {
  switch (status) {
    case 'present':
      return 'success';
    case 'late':
    case 'earlyLeave':
    case 'lateAndEarly':
      // At work, but not cleanly — warning rather than success, because a planner reading this
      // page is deciding whether to count on somebody.
      return 'warning';
    case 'absent':
      return 'danger';
    case 'onLeave':
      return 'info';
    case 'weekend':
    case 'holiday':
    case 'dayOff':
      return 'neutral';
    default:
      return 'neutral';
  }
};
