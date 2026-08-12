// Attendance settings (v1.1 §9) — keyed `hr.attendance.*` per the platform convention (D-PR-01),
// declared at module load, before boot resolves any value. Two of the four §9 settings ship with
// AT-1..3; `absenceNotify` arrives with its notification sweep (AT-7) and
// `overtimeRequiresApproval` with the approval flow (AT-5) — a setting nothing reads would be a
// lie on the settings screen.
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
};
