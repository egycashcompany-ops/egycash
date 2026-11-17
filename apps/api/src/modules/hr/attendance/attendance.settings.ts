// Attendance settings (v1.1 §9) — keyed `hr.attendance.*` per the platform convention (D-PR-01),
// declared at module load, before boot resolves any value. Each arrived with the code that reads
// it, never ahead of it: two with AT-1..3, `overtimeRequiresApproval` with the approval flow
// (AT-5), and `absenceNotify` with its sweep (AT-7) — a setting nothing reads would be a lie on
// the settings screen.
import { z } from 'zod';
import { HrAttendanceSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../../platform/settings';

/**
 * `HH:mm`, 24-hour — the same shape `ShiftConfigSchema` uses for a real shift's times.
 *
 * Declared as a plain `ZodString` with a check rather than anything cleverer, because the
 * settings screen reads the editor off the schema's type name: a string gets a text box, and a
 * refinement or a transform would make it unreachable there.
 */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

export const registerHrAttendanceSettings = (): void => {
  declareSetting({
    key: HrAttendanceSettingKeys.SelfPunchEnabled,
    description: 'Allow employees to record their own web punches (D1 — default OFF)',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.AutoComputeHour,
    description: 'Cairo hour (0–23) at which the nightly compute derives the previous day',
    schema: z.number().int().min(0).max(23),
    defaultValue: 2,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.OvertimeRequiresApproval,
    description: 'Derived overtime waits for explicit approval before reaching the payroll feed (D5)',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.AbsenceNotify,
    description: 'Notify an employee the morning after a day is recorded as an absence (§9)',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });

  // The default working pattern (stage 1b). Six scalars rather than one object so HR can edit
  // them in the settings screen that already exists — see the contract's own note on why. Every
  // one of them takes a per-branch override; the organization value is the company default.
  //
  // IT SHIPS INERT. `enabled` is false until somebody fills in the hours and turns it on, and
  // while it is false `computeDay` does not even read the other five.
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternEnabled,
    description:
      'Apply the default working pattern to employees with no shift assignment — off until the hours are set (stage 1b)',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternStartTime,
    description: 'Default working pattern: start time, Cairo wall clock, HH:mm',
    schema: timeOfDay,
    defaultValue: '09:00',
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternEndTime,
    description:
      'Default working pattern: end time, Cairo wall clock, HH:mm. At or before the start means the pattern crosses midnight.',
    schema: timeOfDay,
    defaultValue: '17:00',
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternBreakMinutes,
    description: 'Default working pattern: unpaid break in minutes, subtracted from worked time',
    schema: z.number().int().min(0).max(480),
    defaultValue: 0,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternGraceInMinutes,
    description: 'Default working pattern: minutes after the start that are not counted as late',
    schema: z.number().int().min(0).max(240),
    defaultValue: 15,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternGraceOutMinutes,
    description:
      'Default working pattern: minutes before the end that are not counted as leaving early',
    schema: z.number().int().min(0).max(240),
    defaultValue: 0,
    allowedScopes: ['organization', 'branch'],
  });
};
