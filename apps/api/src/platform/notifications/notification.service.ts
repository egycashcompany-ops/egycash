// notify() — the one platform-wide entry point (Sprint 3.3 plan §1/§2): an in-process
// function call, never an HTTP endpoint. Delivery is always asynchronous for real
// (network) channels and never blocks or fails the caller's business operation — the
// Notification row existing (in-app, created synchronously) IS the guarantee.
import { Types, type ClientSession } from 'mongoose';
import {
  PlatformEvents,
  SettingKeys,
  type EntityRef,
  type ListNotificationsQuery,
  type NotificationDto,
  type NotificationStatus,
  type Paginated,
} from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { enqueue } from '../../infrastructure/queue/jobs';
import { NotFoundError } from '../../shared/errors';
import { auditService } from '../audit';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { rbacService } from '../rbac';
import { settingsService } from '../settings';
import { notificationRepository } from './notification.repository';
import { notificationTemplateRepository } from './notification-template.repository';
import { notificationPreferenceRepository } from './notification-preference.repository';
import { renderTemplate, validateVariables } from './notification.rendering';
import { resolveExpiresAt, isExpired, computeScheduleDelayMs } from './notification.expiry';
import { computeQuietHoursDeferralMs } from './notification.quiet-hours';
import { emitNotificationRead, inAppChannelAdapter } from './channel-adapters/in-app.adapter';
import { toNotificationDto } from './notification.mapper';
import { type NotificationDoc, type NotificationChannelState } from './notification.model';
import { type NotificationTemplateDoc } from './notification-template.model';

export type NotifyRecipients =
  | { userId: string }
  | { userIds: string[] }
  | { permission: string; scope: 'organization' }
  | { permission: string; scope: 'branch'; branchId: string };

export interface NotifyInput {
  template: string;
  to: NotifyRecipients;
  data: Record<string, string>;
  entityRef: EntityRef;
  attachments?: string[];
  expiresAt?: Date;
}

export interface NotifyOptions {
  session?: ClientSession;
  idempotencyKey?: string;
  sendAt?: Date;
}

export const DELIVER_JOB = 'notifications.deliver';
export const SCHEDULED_SEND_JOB = 'notifications.scheduledSend';
export const MAX_DELIVERY_ATTEMPTS = 5;
export const DELIVERY_BACKOFF_BASE_MS = 2_000;

/** Exponential backoff matching the platform's own queue default (2s base — ADR-009). */
export const computeDeliveryBackoffMs = (attempt: number): number =>
  DELIVERY_BACKOFF_BASE_MS * 2 ** (attempt - 1);

const resolveRecipientUserIds = async (to: NotifyRecipients): Promise<string[]> => {
  if ('userId' in to) return [to.userId];
  if ('userIds' in to) return [...new Set(to.userIds)];
  if (to.scope === 'organization') {
    return rbacService.listUserIdsWithPermission(to.permission, 'organization');
  }
  return rbacService.listUserIdsWithPermission(to.permission, 'branch', to.branchId);
};

interface ScheduledSendPayload {
  input: {
    template: string;
    to: NotifyRecipients;
    data: Record<string, string>;
    entityRef: EntityRef;
    attachments?: string[];
    expiresAt?: string;
  };
  idempotencyKey?: string;
}

class NotificationsService {
  /** The platform-wide notify() entry point. Returns the created rows (empty if none). */
  async notify(input: NotifyInput, options: NotifyOptions = {}): Promise<NotificationDoc[]> {
    if (options.sendAt !== undefined) {
      const now = new Date();
      const delay = computeScheduleDelayMs(options.sendAt, now);
      if (delay > 0) {
        const payload: ScheduledSendPayload = {
          input: {
            template: input.template,
            to: input.to,
            data: input.data,
            entityRef: input.entityRef,
            ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
            ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt.toISOString() }),
          },
          ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
        };
        await enqueue('notifications', SCHEDULED_SEND_JOB, payload, { delay });
        return [];
      }
      // `sendAt` already due — fall through to the send-now path below.
    }

    const template = await notificationTemplateRepository.findLatestByKey(input.template);
    if (template === null || template.status !== 'active') {
      throw new NotFoundError(`Unknown or inactive notification template "${input.template}"`);
    }
    validateVariables(template.variables, input.data);

    const now = new Date();
    const expiresAt = resolveExpiresAt(input.expiresAt, template.defaultExpiryHours, now);
    if (isExpired(expiresAt, now)) return []; // §2d: an already-past expiry is a full no-op

    const recipientUserIds = await resolveRecipientUserIds(input.to);
    const rendered = renderTemplate({ subject: template.subject, body: template.body }, input.data);
    const title = rendered.subject ?? rendered.body;
    const attachmentIds = (input.attachments ?? []).filter((id) => Types.ObjectId.isValid(id));

    const created: NotificationDoc[] = [];
    for (const recipientUserId of recipientUserIds) {
      const doc = await this.createForRecipient({
        recipientUserId,
        template,
        title,
        body: rendered.body,
        data: input.data,
        entityRef: input.entityRef,
        attachmentIds,
        expiresAt,
        idempotencyKey: options.idempotencyKey ?? null,
        now,
      });
      created.push(doc);
    }
    return created;
  }

  private async isChannelEnabled(userId: string, category: string, channel: string): Promise<boolean> {
    const pref = await notificationPreferenceRepository.findOne(userId, category, channel);
    if (pref !== null) return pref.enabled;
    if (channel === 'email') {
      return settingsService.resolve<boolean>(SettingKeys.NotificationsEmailEnabled, {
        userId,
        branchId: null,
      });
    }
    return true;
  }

  private async buildInitialChannels(
    recipientUserId: string,
    template: NotificationTemplateDoc,
    now: Date,
  ): Promise<NotificationChannelState[]> {
    const channels: NotificationChannelState[] = [];
    for (const channelId of template.channels) {
      if (channelId === 'inApp') {
        channels.push({
          channel: 'inApp',
          status: 'sent',
          statusHistory: [{ status: 'sent', at: now }],
          sentAt: now,
          deliveredAt: null,
          readAt: null,
          error: null,
        });
        continue;
      }
      const enabled = await this.isChannelEnabled(recipientUserId, template.category, channelId);
      if (!enabled) continue; // opted out entirely — no channel entry at all
      channels.push({
        channel: channelId,
        status: 'queued',
        statusHistory: [{ status: 'queued', at: now }],
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        error: null,
      });
    }
    return channels;
  }

  private async createForRecipient(params: {
    recipientUserId: string;
    template: NotificationTemplateDoc;
    title: { ar: string; en: string };
    body: { ar: string; en: string };
    data: Record<string, string>;
    entityRef: EntityRef;
    attachmentIds: string[];
    expiresAt: Date | null;
    idempotencyKey: string | null;
    now: Date;
  }): Promise<NotificationDoc> {
    if (params.idempotencyKey !== null) {
      const existing = await notificationRepository.findByIdempotencyKey(
        params.recipientUserId,
        params.idempotencyKey,
      );
      if (existing !== null) return existing; // §2a: second logical call for the same key is a no-op
    }

    const channels = await this.buildInitialChannels(params.recipientUserId, params.template, params.now);
    const doc = await notificationRepository.create({
      recipientUserId: new Types.ObjectId(params.recipientUserId),
      entityRef: params.entityRef,
      templateKey: params.template.key,
      templateVersion: params.template.version,
      category: params.template.category,
      priority: params.template.priority,
      data: params.data,
      title: params.title,
      body: params.body,
      channels,
      readAt: null,
      archivedAt: null,
      expiresAt: params.expiresAt,
      idempotencyKey: params.idempotencyKey,
      attachments: params.attachmentIds.map((id) => new Types.ObjectId(id)),
      createdAt: params.now,
    });

    for (const channel of doc.channels) {
      await this.auditChannelTransition(doc._id, channel.channel, null, channel.status);
    }

    await emit(PlatformEvents.NotificationCreated, {
      notificationId: String(doc._id),
      recipientUserId: params.recipientUserId,
      templateKey: doc.templateKey,
    });

    try {
      await inAppChannelAdapter.send(doc, { subject: doc.title, body: doc.body });
    } catch (error) {
      logger.warn(
        { err: error, notificationId: String(doc._id) },
        'in-app live push failed (best-effort — inbox is the delivery guarantee)',
      );
    }

    for (const channel of doc.channels) {
      if (channel.channel === 'inApp') continue;
      try {
        await this.enqueueDelivery(doc, channel.channel, 1, params.now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, notificationId: String(doc._id), channel: channel.channel },
          'failed to enqueue delivery — marking failed',
        );
        await this.transitionChannel(doc._id, channel.channel, 'failed', new Date(), { error: message });
        await this.emitDeliveryFailed(doc, channel.channel, message);
      }
    }

    return doc;
  }

  /**
   * `retryDelayMs` is the backoff for a re-attempt after a failed send (§3d); quiet
   * hours (§3c) is layered independently on top — whichever wait is longer wins,
   * since both conditions must be satisfied before the channel actually sends.
   */
  async enqueueDelivery(
    doc: NotificationDoc,
    channel: string,
    attempt: number,
    now: Date,
    retryDelayMs = 0,
  ): Promise<void> {
    let quietHoursDelayMs = 0;
    if (doc.priority !== 'critical') {
      const quietHours = await notificationPreferenceRepository.getQuietHours(
        String(doc.recipientUserId),
      );
      if (quietHours !== null) {
        const deferral = computeQuietHoursDeferralMs(now, quietHours);
        if (deferral !== null) quietHoursDelayMs = deferral;
      }
    }
    const delayMs = Math.max(quietHoursDelayMs, retryDelayMs);
    const payload = { notificationId: String(doc._id), channel, attempt };
    await enqueue('notifications', DELIVER_JOB, payload, delayMs > 0 ? { delay: delayMs } : undefined);
  }

  async transitionChannel(
    notificationId: Types.ObjectId,
    channel: string,
    status: NotificationStatus,
    at: Date,
    extra?: { sentAt?: Date; error?: string | null },
  ): Promise<void> {
    const before = await notificationRepository.findAnyById(String(notificationId));
    const previous = before?.channels.find((c) => c.channel === channel)?.status ?? null;
    await notificationRepository.setChannelStatus(notificationId, channel, status, at, extra);
    await this.auditChannelTransition(notificationId, channel, previous, status);
  }

  async auditChannelTransition(
    notificationId: Types.ObjectId,
    channel: string,
    oldStatus: string | null,
    newStatus: string,
  ): Promise<void> {
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'notification', entityId: String(notificationId) },
      action: 'statusChange',
      changes: [{ field: `channels.${channel}.status`, old: oldStatus, new: newStatus }],
    });
  }

  async emitDeliveryFailed(doc: NotificationDoc, channel: string, error: string): Promise<void> {
    await emit(
      PlatformEvents.NotificationDeliveryFailed,
      {
        notificationId: String(doc._id),
        recipientUserId: String(doc.recipientUserId),
        channel,
        templateKey: doc.templateKey,
        error,
      },
      { reliable: true },
    );
    nudgeOutboxRelay();
  }

  // ── Inbox (self-scoped — no permission, ownership by identity, §5) ─────────

  async listMine(userId: string, query: ListNotificationsQuery): Promise<Paginated<NotificationDoc>> {
    return notificationRepository.list({
      recipientUserId: userId,
      unreadOnly: query.unreadOnly,
      entityType: query.entityType,
      entityId: query.entityId,
      category: query.category,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return notificationRepository.unreadCount(userId);
  }

  /** First-read-wins (§6): a second call on an already-read notification is a no-op. */
  async markRead(userId: string, id: string): Promise<NotificationDoc> {
    const marked = await notificationRepository.markReadIfUnread(id, userId, new Date());
    if (marked !== null) {
      await this.auditChannelTransition(marked._id, 'inApp', 'sent', 'read');
      // Multi-tab sync (§6): sibling tabs update their badge without polling.
      emitNotificationRead(userId, String(marked._id));
      return marked;
    }
    const existing = await notificationRepository.findOwnedById(id, userId);
    if (existing === null) throw new NotFoundError();
    return existing; // already read — idempotent no-op
  }

  async markAllRead(userId: string): Promise<number> {
    return notificationRepository.markAllRead(userId, new Date());
  }

  async archive(userId: string, id: string): Promise<NotificationDoc> {
    const archived = await notificationRepository.archive(id, userId, new Date());
    if (archived === null) throw new NotFoundError();
    return archived;
  }

  toDto(doc: NotificationDoc): NotificationDto {
    return toNotificationDto(doc);
  }
}

export const notificationsService = new NotificationsService();

/** Called by the scheduled-send job handler (`notification.delivery.ts`). */
export const deserializeScheduledPayload = (
  data: unknown,
): { input: NotifyInput; options: NotifyOptions } => {
  const payload = data as ScheduledSendPayload;
  return {
    input: {
      template: payload.input.template,
      to: payload.input.to,
      data: payload.input.data,
      entityRef: payload.input.entityRef,
      ...(payload.input.attachments === undefined ? {} : { attachments: payload.input.attachments }),
      ...(payload.input.expiresAt === undefined
        ? {}
        : { expiresAt: new Date(payload.input.expiresAt) }),
    },
    options: payload.idempotencyKey === undefined ? {} : { idempotencyKey: payload.idempotencyKey },
  };
};
