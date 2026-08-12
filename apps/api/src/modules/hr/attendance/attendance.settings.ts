// Attendance settings (v1.1 §9) — keyed `hr.attendance.*` per the platform convention (D-PR-01),
// declared at module load, before boot resolves any value. Each arrived with the code that reads
// it, never ahead of it: two with AT-1..3, `overtimeRequiresApproval` with the approval flow
// (AT-5), and `absenceNotify` with its sweep (AT-7) — a setting nothing reads would be a lie on
// the settings screen.
import { z } from 'zod';
import { HrAttendanceSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../../platform/settings';

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
};
