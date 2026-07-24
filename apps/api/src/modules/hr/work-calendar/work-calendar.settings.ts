// HR business-calendar settings (Leave design C2) — declared at module load, before boot
// resolves any value. Org-level only: the calendar is a company-wide fact (branch-specific
// calendars are a recorded deferral).
import { z } from 'zod';
import { HrLeaveSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../../platform/settings';

export const registerHrWorkCalendarSettings = (): void => {
  declareSetting({
    key: HrLeaveSettingKeys.WeekendDays,
    description: 'Weekly rest days (ISO weekday numbers, Mon=1 … Sun=7)',
    schema: z.array(z.number().int().min(1).max(7)).min(0).max(6),
    defaultValue: [5, 6],
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrLeaveSettingKeys.ApprovalReminderDays,
    description: 'Days a leave request may sit pending before the daily reminder nudges its approver',
    schema: z.number().int().min(1).max(30),
    defaultValue: 3,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrLeaveSettingKeys.ServiceAcrossPeriods,
    description: 'Count total employed service across employment periods for entitlement steps',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
};
