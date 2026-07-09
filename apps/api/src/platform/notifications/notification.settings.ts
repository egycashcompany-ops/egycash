// Notifications-owned configurable values (Sprint 3.3 plan §6/§8): an organization-wide
// email kill switch and the default state of the opt-in quiet-hours feature.
import { z } from 'zod';
import { SettingKeys } from '@ecms/contracts';
import { declareSetting } from '../settings';

export const registerNotificationSettings = (): void => {
  declareSetting({
    key: SettingKeys.NotificationsEmailEnabled,
    description: 'Organization-wide kill switch for the email notification channel',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization', 'branch', 'user'],
  });
  declareSetting({
    key: SettingKeys.NotificationsQuietHoursEnabledByDefault,
    description: 'Default state of quiet hours for a user with no quiet-hours row of their own',
    schema: z.boolean(),
    defaultValue: false,
    allowedScopes: ['organization'],
  });
};
