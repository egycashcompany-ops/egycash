// WORKING HOURS PER DEPARTMENT — the owner's ruling of 19 November: not everybody owes the same
// day. IT works eight hours, security can work twenty-four, and HR sets it per department in
// Attendance › Working hours. Departments nobody configured use the company default pattern.
//
// Pure: the service reads the settings, this decides what they mean. The result is an ordinary
// `EngineShift`, so the flexible-hours rule in `deriveDay` step 8 applies unchanged — a security
// guard on a 24-hour day who scans out after 20 hours has a 4-hour shortfall and left early.
import { type DepartmentHoursRule } from '@ecms/contracts';
import { type EngineShift } from './derive-day';

const minutesOfDay = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const clock = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * The expectation a department's hours describe. `base` is the branch's default pattern (may be
 * null when switched off); its break and graces carry over, and its start time is used when the
 * department did not set its own. `fallbackStart` is the company start-time setting, used when the
 * pattern itself is off.
 *
 * The day's END is start + hours + break, so the required minutes (span − break) equal the hours.
 * Twenty-four hours ends at the same wall time the next day, which `crossesMidnight` expresses.
 */
export const patternForDepartment = (
  rule: DepartmentHoursRule,
  base: EngineShift | null,
  fallbackStart: string,
): EngineShift => {
  const startTime = rule.startTime ?? base?.startTime ?? fallbackStart;
  const breakMinutes = base?.breakMinutes ?? 0;
  const start = minutesOfDay(startTime);
  const endAbs = start + Math.round(rule.hours * 60) + breakMinutes;
  return {
    startTime,
    endTime: clock(endAbs),
    crossesMidnight: endAbs >= 1440,
    breakMinutes,
    graceInMinutes: base?.graceInMinutes ?? 0,
    graceOutMinutes: base?.graceOutMinutes ?? 0,
  };
};
