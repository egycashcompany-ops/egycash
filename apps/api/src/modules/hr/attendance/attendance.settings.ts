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

  // The default working pattern. Six scalars rather than one object so HR can edit them in the
  // settings screen that already exists — see the contract's own note on why. Every one of them
  // takes a per-branch override; the organization value is the company default.
  //
  // IT SHIPPED INERT AND IS NOW ON, by the owner's ruling of 18 November: nine to five, eight
  // hours, no grace, company-wide. He had asked for it left unset a day earlier, on the grounds
  // that departments arrive anywhere between six and ten and one company-wide time would mark
  // honest people late — and then answered that objection himself rather than withdrawing it, with
  // the flexible rule in `deriveDay` step 8: an arrival after nine is only late if the eight hours
  // were not completed. The early-starting departments are therefore not marked late by this, and
  // the ones that genuinely owe time are. A branch whose hours differ still overrides every
  // scalar, and an employee with a real shift assignment is unaffected by all of it.
  declareSetting({
    key: HrAttendanceSettingKeys.DefaultPatternEnabled,
    description:
      'Apply the default working pattern (09:00–17:00) to employees with no shift assignment',
    schema: z.boolean(),
    defaultValue: true,
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
    // NO GRACE, by the owner's ruling: «Check-in at 09:00 or earlier = on time. 09:01 or later =
    // late.» The fifteen minutes this replaces were a guess made before anybody had ruled. The
    // flexibility the grace used to provide now comes from the eight-hour rule instead, which is
    // both more generous and more exact — a late arrival that is made up costs nothing at all.
    defaultValue: 0,
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
  // Stage 3. Seven days by the owner's ruling, and configurable because what counts as "recent"
  // differs by branch: beyond it a manager's decision is recorded but changes nothing until HR
  // approves it, because the older the day, the more likely the correction is reconstruction
  // rather than recollection. Zero would mean every decision needs HR, which is a legitimate
  // posture for a branch that wants it.
  // Stage 4. A PROMPT TO LOOK, not a limit: crossing it blocks nothing and undoes nothing. Twenty
  // a week is a starting point rather than a measured figure — a supervisor covering a branch
  // whose reader is broken will cross it legitimately, which is the week worth looking at. It is a
  // setting precisely so the number can be moved once there is a month of real traffic to judge by.
  declareSetting({
    key: HrAttendanceSettingKeys.DecisionWeeklyReviewThreshold,
    description:
      'Decisions by one manager in a week above which the review screen flags them for a look',
    schema: z.number().int().min(1).max(1000),
    defaultValue: 20,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.ImportMaxAgeDays,
    description:
      'How old a device scan may be and still be imported, in days — 0 means no limit (history backfill)',
    schema: z.number().int().min(0).max(3650),
    // NO LIMIT BY DEFAULT. The 90-day constant this replaces was not protecting anything the
    // future guard does not already protect; what it was doing was hiding two years of attendance
    // that the branch machines had been holding all along.
    defaultValue: 0,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.MinPunchGapMinutes,
    description:
      'How close two scans must be to count as one visit to the reader, in minutes — 0 pairs every scan',
    schema: z.number().int().min(0).max(240),
    // TEN MINUTES, and the number is chosen from both ends. A re-tap — a finger that read poorly,
    // presented again — is seconds to a minute or two apart, so ten covers even a stubborn one.
    // And no worked day is ten minutes long, so nothing real is collapsed by it.
    //
    // It is a setting rather than a constant because the right value belongs to whoever watches
    // the walls: a reader that double-logs every presentation wants it higher, and a site where
    // people genuinely sign in and out within the hour wants it lower.
    defaultValue: 10,
    allowedScopes: ['organization'],
  });
  // THE WORD FOR A WORKING DAY WITH NO SCAN, and it is the owner's to choose: «lateness only for
  // now», so it ships OFF and such a day reads «لا يوجد تسجيل» rather than «غائب».
  //
  // Off, nothing new reaches payroll's absent-day count, and the two years of history about to be
  // re-derived cannot mint absences for days whose scans may still be sitting in quarantine or
  // behind a reader that was down. On, the engine writes `absent` as it always did. A manager's
  // own `markAbsent` is unaffected either way: somebody looked, and that is evidence.
  declareSetting({
    key: HrAttendanceSettingKeys.CountAbsence,
    description:
      'Record a working day with no scan as an absence — off records it as «لا يوجد تسجيل» instead',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization', 'branch'],
  });
  declareSetting({
    key: HrAttendanceSettingKeys.DecisionApprovalAfterDays,
    description:
      'Days back a manager may decide an attendance day alone; older days wait for HR approval',
    schema: z.number().int().min(0).max(366),
    defaultValue: 7,
    allowedScopes: ['organization', 'branch'],
  });
};
