// The in-app inbox is the source of truth (Sprint 3.3 plan §1/§3); append-mostly —
// mutated only by delivery-status transitions, mark-read, and archive. No BaseDocFields:
// same append-only shape as audit_logs/activity_logs, `archivedAt` is the one soft-hide.
import { Schema, model, type Types } from 'mongoose';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  type EntityRef,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationStatus,
} from '@ecms/contracts';

export interface NotificationChannelState {
  channel: NotificationChannel;
  status: NotificationStatus;
  statusHistory: { status: NotificationStatus; at: Date }[];
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  error: string | null;
}

export interface NotificationDoc {
  _id: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  entityRef: EntityRef;
  templateKey: string;
  templateVersion: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  data: Record<string, string>;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  channels: NotificationChannelState[];
  readAt: Date | null;
  archivedAt: Date | null;
  expiresAt: Date | null;
  idempotencyKey: string | null;
  attachments: Types.ObjectId[];
  createdAt: Date;
}

const channelStateSchema = new Schema<NotificationChannelState>(
  {
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: NOTIFICATION_STATUSES, required: true },
        at: { type: Date, required: true },
      },
    ],
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
);

const entityRefFields = {
  moduleId: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
} as const;

const notificationSchema = new Schema<NotificationDoc>(
  {
    recipientUserId: { type: Schema.Types.ObjectId, required: true },
    entityRef: entityRefFields,
    templateKey: { type: String, required: true },
    templateVersion: { type: Number, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    priority: { type: String, enum: NOTIFICATION_PRIORITIES, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    title: { ar: { type: String, required: true }, en: { type: String, required: true } },
    body: { ar: { type: String, required: true }, en: { type: String, required: true } },
    channels: { type: [channelStateSchema], default: [] },
    readAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    idempotencyKey: { type: String, default: null },
    attachments: { type: [Schema.Types.ObjectId], default: [] },
    createdAt: { type: Date, required: true },
  },
  { strict: true, versionKey: false },
);

notificationSchema.index({ recipientUserId: 1, createdAt: -1 }, { name: 'ix_recipient_createdAt' });
notificationSchema.index({ recipientUserId: 1, readAt: 1 }, { name: 'ix_recipient_readAt' });
notificationSchema.index(
  { 'entityRef.entityType': 1, 'entityRef.entityId': 1 },
  { name: 'ix_entityRef' },
);
notificationSchema.index({ recipientUserId: 1, category: 1 }, { name: 'ix_recipient_category' });
notificationSchema.index(
  { recipientUserId: 1, idempotencyKey: 1 },
  {
    name: 'ux_recipient_idempotencyKey',
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

export const NotificationModel = model<NotificationDoc>(
  'Notification',
  notificationSchema,
  'notifications',
);
