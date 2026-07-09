// Per-user preferences, keyed on category (Sprint 3.3 plan §3 — supersedes the
// original templateKey-keyed draft) plus one small quiet-hours sub-document "alongside
// their per-category rows, same collection" (plan §3c) — two document shapes sharing
// one physical collection, distinguished by `kind` so queries never cross-match.
import { Schema, model, type Types } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@ecms/contracts';

export interface NotificationPreferenceDoc {
  _id: Types.ObjectId;
  kind: 'preference';
  userId: Types.ObjectId;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

const notificationPreferenceSchema = new Schema<NotificationPreferenceDoc>(
  {
    kind: { type: String, enum: ['preference'], required: true, default: 'preference' },
    userId: { type: Schema.Types.ObjectId, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    enabled: { type: Boolean, required: true },
  },
  { strict: true, versionKey: false },
);

notificationPreferenceSchema.index(
  { userId: 1, category: 1, channel: 1 },
  {
    name: 'ux_userId_category_channel',
    unique: true,
    partialFilterExpression: { kind: 'preference' },
  },
);

export const NotificationPreferenceModel = model<NotificationPreferenceDoc>(
  'NotificationPreference',
  notificationPreferenceSchema,
  'notification_preferences',
);

export interface QuietHoursDoc {
  _id: Types.ObjectId;
  kind: 'quietHours';
  userId: Types.ObjectId;
  enabled: boolean;
  start: string;
  end: string;
}

const quietHoursSchema = new Schema<QuietHoursDoc>(
  {
    kind: { type: String, enum: ['quietHours'], required: true, default: 'quietHours' },
    userId: { type: Schema.Types.ObjectId, required: true },
    enabled: { type: Boolean, required: true, default: false },
    start: { type: String, required: true, default: '22:00' },
    end: { type: String, required: true, default: '07:00' },
  },
  { strict: true, versionKey: false },
);

quietHoursSchema.index(
  { userId: 1 },
  { name: 'ux_userId_quietHours', unique: true, partialFilterExpression: { kind: 'quietHours' } },
);

export const QuietHoursModel = model<QuietHoursDoc>(
  'NotificationQuietHours',
  quietHoursSchema,
  'notification_preferences',
);
