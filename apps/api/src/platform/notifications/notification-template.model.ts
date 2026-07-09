// Versioned templates (Sprint 3.3 plan §3): every edit creates a new immutable row,
// mirroring the Files version-group pattern (Sprint 3.1) rather than mutating in
// place — history is retrievable and a past notification's rendering can never be
// retroactively changed by a later template edit.
import { Schema, model, type Types } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  TEMPLATE_STATUSES,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPriority,
  type TemplateStatus,
} from '@ecms/contracts';

export interface NotificationTemplateDoc {
  _id: Types.ObjectId;
  key: string;
  version: number;
  isLatest: boolean;
  category: NotificationCategory;
  priority: NotificationPriority;
  subject: { ar: string; en: string } | null;
  body: { ar: string; en: string };
  channels: NotificationChannel[];
  variables: string[];
  defaultExpiryHours: number | null;
  status: TemplateStatus;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
}

const notificationTemplateSchema = new Schema<NotificationTemplateDoc>(
  {
    key: { type: String, required: true },
    version: { type: Number, required: true },
    isLatest: { type: Boolean, required: true, default: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    priority: { type: String, enum: NOTIFICATION_PRIORITIES, required: true, default: 'normal' },
    subject: {
      type: new Schema({ ar: String, en: String }, { _id: false }),
      default: null,
    },
    body: { ar: { type: String, required: true }, en: { type: String, required: true } },
    channels: { type: [String], enum: NOTIFICATION_CHANNELS, required: true },
    variables: { type: [String], default: [] },
    defaultExpiryHours: { type: Number, default: null },
    status: { type: String, enum: TEMPLATE_STATUSES, required: true, default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, required: true },
  },
  { strict: true, versionKey: false },
);

notificationTemplateSchema.index({ key: 1, version: 1 }, { name: 'ux_key_version', unique: true });
notificationTemplateSchema.index(
  { key: 1, isLatest: 1 },
  {
    name: 'ux_key_isLatest',
    unique: true,
    partialFilterExpression: { isLatest: true },
  },
);
notificationTemplateSchema.index({ status: 1, category: 1 }, { name: 'ix_status_category' });

export const NotificationTemplateModel = model<NotificationTemplateDoc>(
  'NotificationTemplate',
  notificationTemplateSchema,
  'notification_templates',
);
