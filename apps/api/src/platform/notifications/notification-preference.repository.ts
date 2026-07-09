// Data access for preferences + quiet hours (Sprint 3.3 plan §3/§3c).
import { Types } from 'mongoose';
import {
  NotificationPreferenceModel,
  QuietHoursModel,
  type NotificationPreferenceDoc,
  type QuietHoursDoc,
} from './notification-preference.model';

class NotificationPreferenceRepository {
  async listForUser(userId: string): Promise<NotificationPreferenceDoc[]> {
    return NotificationPreferenceModel.find({ kind: 'preference', userId: new Types.ObjectId(userId) })
      .lean<NotificationPreferenceDoc[]>()
      .exec();
  }

  async findOne(
    userId: string,
    category: string,
    channel: string,
  ): Promise<NotificationPreferenceDoc | null> {
    return NotificationPreferenceModel.findOne({
      kind: 'preference',
      userId: new Types.ObjectId(userId),
      category,
      channel,
    })
      .lean<NotificationPreferenceDoc>()
      .exec();
  }

  async upsert(userId: string, category: string, channel: string, enabled: boolean): Promise<void> {
    await NotificationPreferenceModel.updateOne(
      { kind: 'preference', userId: new Types.ObjectId(userId), category, channel },
      { $set: { enabled } },
      { upsert: true },
    ).exec();
  }

  async getQuietHours(userId: string): Promise<QuietHoursDoc | null> {
    return QuietHoursModel.findOne({ kind: 'quietHours', userId: new Types.ObjectId(userId) })
      .lean<QuietHoursDoc>()
      .exec();
  }

  async upsertQuietHours(
    userId: string,
    input: { enabled: boolean; start: string; end: string },
  ): Promise<void> {
    await QuietHoursModel.updateOne(
      { kind: 'quietHours', userId: new Types.ObjectId(userId) },
      { $set: input },
      { upsert: true },
    ).exec();
  }
}

export const notificationPreferenceRepository = new NotificationPreferenceRepository();
