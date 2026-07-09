import { z } from 'zod';
import { PaginationQuerySchema } from '../common/index.js';

// Notification Service contracts (Sprint 3.3 plan: docs/12-planning/sprint-3.3-plan.md).
// In-app inbox is the source of truth; email is the second required channel;
// SMS/push/WhatsApp are declared, not implemented (§1/§2 of the plan).

export const NOTIFICATION_CATEGORIES = [
  'security',
  'hr',
  'workflow',
  'approval',
  'system',
  'contracts',
  'fleet',
  'vault',
  'atm',
  'finance',
] as const;
export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export const NotificationPrioritySchema = z.enum(NOTIFICATION_PRIORITIES);
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

/** Channels a template/notification may declare — only the two built adapters this sprint. */
export const NOTIFICATION_CHANNELS = ['inApp', 'email'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NOTIFICATION_STATUSES = [
  'queued',
  'processing',
  'sent',
  'delivered',
  'read',
  'failed',
  'cancelled',
] as const;
export const NotificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const TEMPLATE_STATUSES = ['active', 'inactive'] as const;
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

// ── Templates (versioned) ────────────────────────────────────────────────

const localizedBody = z.object({ ar: z.string().min(1), en: z.string().min(1) });

export const CreateNotificationTemplateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,99}$/),
    category: NotificationCategorySchema,
    priority: NotificationPrioritySchema.default('normal'),
    subject: localizedBody.nullable().default(null),
    body: localizedBody,
    channels: z.array(NotificationChannelSchema).min(1),
    variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).default([]),
    defaultExpiryHours: z.number().int().min(1).max(8760).nullable().default(null),
  })
  .strict()
  .refine((v) => !v.channels.includes('email') || v.subject !== null, {
    message: 'subject is required when the email channel is declared',
    path: ['subject'],
  });
export type CreateNotificationTemplate = z.infer<typeof CreateNotificationTemplateSchema>;

/** Every edit creates a new version — this is the shape of that new version's content. */
export const UpdateNotificationTemplateSchema = z
  .object({
    category: NotificationCategorySchema.optional(),
    priority: NotificationPrioritySchema.optional(),
    subject: localizedBody.nullable().optional(),
    body: localizedBody.optional(),
    channels: z.array(NotificationChannelSchema).min(1).optional(),
    variables: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).optional(),
    defaultExpiryHours: z.number().int().min(1).max(8760).nullable().optional(),
    status: TemplateStatusSchema.optional(),
  })
  .strict();
export type UpdateNotificationTemplate = z.infer<typeof UpdateNotificationTemplateSchema>;

export const ListNotificationTemplatesQuerySchema = PaginationQuerySchema.extend({
  status: TemplateStatusSchema.optional(),
  category: NotificationCategorySchema.optional(),
}).strict();
export type ListNotificationTemplatesQuery = z.infer<typeof ListNotificationTemplatesQuerySchema>;

export const PreviewNotificationTemplateSchema = z
  .object({ data: z.record(z.string(), z.string()).default({}) })
  .strict();
export type PreviewNotificationTemplate = z.infer<typeof PreviewNotificationTemplateSchema>;

export const TestSendNotificationTemplateSchema = z
  .object({
    data: z.record(z.string(), z.string()).default({}),
    channel: NotificationChannelSchema,
  })
  .strict();
export type TestSendNotificationTemplate = z.infer<typeof TestSendNotificationTemplateSchema>;

export interface NotificationTemplateDto {
  id: string;
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
  createdBy: string | null;
  createdAt: string;
}

export interface RenderedTemplateDto {
  subject: { ar: string; en: string } | null;
  body: { ar: string; en: string };
}

// ── Notifications (inbox) ────────────────────────────────────────────────

export const ListNotificationsQuerySchema = PaginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  category: NotificationCategorySchema.optional(),
}).strict();
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export interface NotificationChannelStateDto {
  channel: NotificationChannel;
  status: NotificationStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  error: string | null;
}

export interface NotificationDto {
  id: string;
  entityRef: { moduleId: string; entityType: string; entityId: string };
  templateKey: string;
  templateVersion: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  channels: NotificationChannelStateDto[];
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  attachments: string[];
  createdAt: string;
}

// ── Preferences ───────────────────────────────────────────────────────────

export const UpsertNotificationPreferenceSchema = z
  .object({
    category: NotificationCategorySchema,
    channel: NotificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict();
export type UpsertNotificationPreference = z.infer<typeof UpsertNotificationPreferenceSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');
export const UpsertQuietHoursSchema = z
  .object({ enabled: z.boolean(), start: hhmm, end: hhmm })
  .strict();
export type UpsertQuietHours = z.infer<typeof UpsertQuietHoursSchema>;

export interface NotificationPreferenceDto {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface QuietHoursDto {
  enabled: boolean;
  start: string;
  end: string;
}

export interface NotificationPreferencesDto {
  preferences: NotificationPreferenceDto[];
  quietHours: QuietHoursDto;
}
