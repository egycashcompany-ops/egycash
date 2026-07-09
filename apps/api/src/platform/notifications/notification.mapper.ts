// DTO mapping, split out from the service so the channel adapters (which need to
// build a `NotificationDto` for the socket push) don't import `notification.service.ts`
// and create a cycle (service → registry → adapters → service).
import {
  type NotificationChannelStateDto,
  type NotificationDto,
  type NotificationPreferenceDto,
  type NotificationTemplateDto,
  type RenderedTemplateDto,
} from '@ecms/contracts';
import { type NotificationDoc } from './notification.model';
import { type NotificationTemplateDoc } from './notification-template.model';
import { type NotificationPreferenceDoc } from './notification-preference.model';
import { type RenderedTemplate } from './notification.rendering';

export const toNotificationDto = (doc: NotificationDoc): NotificationDto => ({
  id: String(doc._id),
  entityRef: doc.entityRef,
  templateKey: doc.templateKey,
  templateVersion: doc.templateVersion,
  category: doc.category,
  priority: doc.priority,
  title: doc.title,
  body: doc.body,
  channels: doc.channels.map(
    (c): NotificationChannelStateDto => ({
      channel: c.channel,
      status: c.status,
      sentAt: c.sentAt === null ? null : c.sentAt.toISOString(),
      deliveredAt: c.deliveredAt === null ? null : c.deliveredAt.toISOString(),
      readAt: c.readAt === null ? null : c.readAt.toISOString(),
      error: c.error,
    }),
  ),
  readAt: doc.readAt === null ? null : doc.readAt.toISOString(),
  archivedAt: doc.archivedAt === null ? null : doc.archivedAt.toISOString(),
  expiresAt: doc.expiresAt === null ? null : doc.expiresAt.toISOString(),
  attachments: doc.attachments.map(String),
  createdAt: doc.createdAt.toISOString(),
});

export const toTemplateDto = (doc: NotificationTemplateDoc): NotificationTemplateDto => ({
  id: String(doc._id),
  key: doc.key,
  version: doc.version,
  isLatest: doc.isLatest,
  category: doc.category,
  priority: doc.priority,
  subject: doc.subject,
  body: doc.body,
  channels: doc.channels,
  variables: doc.variables,
  defaultExpiryHours: doc.defaultExpiryHours,
  status: doc.status,
  createdBy: doc.createdBy === null ? null : String(doc.createdBy),
  createdAt: doc.createdAt.toISOString(),
});

export const toRenderedDto = (rendered: RenderedTemplate): RenderedTemplateDto => ({
  subject: rendered.subject,
  body: rendered.body,
});

export const toPreferenceDto = (doc: NotificationPreferenceDoc): NotificationPreferenceDto => ({
  category: doc.category,
  channel: doc.channel,
  enabled: doc.enabled,
});
