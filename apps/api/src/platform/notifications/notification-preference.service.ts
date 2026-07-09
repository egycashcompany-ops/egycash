// Self-scoped preference + quiet-hours management (Sprint 3.3 plan §3c/§6) — identity-
// owned, no permission required, never audited (only templates and delivery-status
// transitions are, per §12).
import {
  SettingKeys,
  type NotificationPreferencesDto,
  type QuietHoursDto,
  type UpsertNotificationPreference,
  type UpsertQuietHours,
} from '@ecms/contracts';
import { settingsService } from '../settings';
import { notificationPreferenceRepository } from './notification-preference.repository';
import { toPreferenceDto } from './notification.mapper';

const DEFAULT_QUIET_HOURS_START = '22:00';
const DEFAULT_QUIET_HOURS_END = '07:00';

class NotificationPreferenceService {
  async getMine(userId: string): Promise<NotificationPreferencesDto> {
    const [rows, quietHours] = await Promise.all([
      notificationPreferenceRepository.listForUser(userId),
      notificationPreferenceRepository.getQuietHours(userId),
    ]);
    return {
      preferences: rows.map(toPreferenceDto),
      quietHours: await this.resolveQuietHoursDto(userId, quietHours),
    };
  }

  async upsertPreference(userId: string, input: UpsertNotificationPreference): Promise<void> {
    await notificationPreferenceRepository.upsert(userId, input.category, input.channel, input.enabled);
  }

  async upsertQuietHours(userId: string, input: UpsertQuietHours): Promise<QuietHoursDto> {
    await notificationPreferenceRepository.upsertQuietHours(userId, input);
    return input;
  }

  private async resolveQuietHoursDto(
    userId: string,
    doc: { enabled: boolean; start: string; end: string } | null,
  ): Promise<QuietHoursDto> {
    if (doc !== null) return { enabled: doc.enabled, start: doc.start, end: doc.end };
    const enabled = await settingsService.resolve<boolean>(
      SettingKeys.NotificationsQuietHoursEnabledByDefault,
      { userId, branchId: null },
    );
    return { enabled, start: DEFAULT_QUIET_HOURS_START, end: DEFAULT_QUIET_HOURS_END };
  }
}

export const notificationPreferenceService = new NotificationPreferenceService();
