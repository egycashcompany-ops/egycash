// Versioned template catalog (Sprint 3.3 plan §3/§5/§6): every edit is a new version,
// audited; deactivation is a new version too (`status: inactive`) — never a hard delete.
import { Types } from 'mongoose';
import {
  templateContentDisagreement,
  type CreateNotificationTemplate,
  type ListNotificationTemplatesQuery,
  type Paginated,
  type RenderedTemplateDto,
  type UpdateNotificationTemplate,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../shared/errors';
import { isProtectedTemplateKey } from './notification.template-rules';
import { type AuthContext } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { notificationTemplateRepository } from './notification-template.repository';
import { renderTemplate, validateVariables } from './notification.rendering';
import { toRenderedDto } from './notification.mapper';
import { getChannelAdapter } from './channel-adapters/channel-adapter';
import { type NotificationTemplateDoc } from './notification-template.model';
import { type NotificationDoc } from './notification.model';

const entityRef = (key: string) => ({
  moduleId: 'platform',
  entityType: 'notificationTemplate',
  entityId: key,
});

const snapshot = (doc: NotificationTemplateDoc) => ({
  version: doc.version,
  category: doc.category,
  priority: doc.priority,
  subject: doc.subject,
  body: doc.body,
  channels: doc.channels,
  variables: doc.variables,
  defaultExpiryHours: doc.defaultExpiryHours,
  status: doc.status,
});

class NotificationTemplateService {
  async create(input: CreateNotificationTemplate, by: string | null): Promise<NotificationTemplateDoc> {
    const doc = await notificationTemplateRepository.createFirstVersion({
      key: input.key,
      category: input.category,
      priority: input.priority,
      subject: input.subject,
      body: input.body,
      channels: input.channels,
      variables: input.variables,
      defaultExpiryHours: input.defaultExpiryHours,
      status: 'active',
      createdBy: by === null ? null : new Types.ObjectId(by),
      createdAt: new Date(),
    });
    await auditService.record({
      entityRef: entityRef(doc.key),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /** Idempotent create-if-missing — mirrors `fileCategoryService.ensure` (boot-time seeding). */
  async ensure(input: CreateNotificationTemplate): Promise<NotificationTemplateDoc> {
    const existing = await notificationTemplateRepository.findLatestByKey(input.key);
    if (existing !== null) return existing;
    return this.create(input, null);
  }

  async getVersion(id: string): Promise<NotificationTemplateDoc> {
    const doc = await notificationTemplateRepository.findVersionById(id);
    if (doc === null) throw new NotFoundError();
    return doc;
  }

  async listVersions(id: string): Promise<NotificationTemplateDoc[]> {
    const current = await this.getVersion(id);
    return notificationTemplateRepository.listVersions(current.key);
  }

  async list(query: ListNotificationTemplatesQuery): Promise<Paginated<NotificationTemplateDoc>> {
    const { items, totalItems } = await notificationTemplateRepository.listLatest({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      category: query.category,
    });
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  /** Every edit publishes a new version (§3) — never mutates the current one in place. */
  async update(id: string, input: UpdateNotificationTemplate, by: string): Promise<NotificationTemplateDoc> {
    const before = await this.getVersion(id);
    if (input.status === 'inactive' && isProtectedTemplateKey(before.key)) {
      // G-1. `notify()` refuses an inactive template, so switching one of these off does not
      // "hide" it — it stops the thing that sends it, from a screen that gives no hint of that.
      // Wording stays editable; only the off switch is closed.
      throw new BusinessRuleError(
        `"${before.key}" is sent by the platform itself and cannot be deactivated — its wording can be edited, but switching it off would stop the notification it carries`,
      );
    }

    const merged = {
      category: input.category ?? before.category,
      priority: input.priority ?? before.priority,
      subject: input.subject === undefined ? before.subject : input.subject,
      body: input.body ?? before.body,
      channels: input.channels ?? before.channels,
      variables: input.variables ?? before.variables,
      defaultExpiryHours:
        input.defaultExpiryHours === undefined ? before.defaultExpiryHours : input.defaultExpiryHours,
      status: input.status ?? before.status,
    };
    // G-2 on the version about to be STORED. The schema checks what it was sent; a partial edit
    // names one half of the variables/text pair and the other is carried forward from `before`,
    // which the schema never sees. This is the only place the whole template exists.
    const disagreement = templateContentDisagreement({
      subject: merged.subject,
      body: merged.body,
      variables: merged.variables,
    });
    if (disagreement !== null) {
      throw new ValidationError([{ field: 'body', code: 'INVALID', message: disagreement }], disagreement);
    }

    const next = await notificationTemplateRepository.createNextVersion(before.key, {
      ...merged,
      createdBy: new Types.ObjectId(by),
      createdAt: new Date(),
    });
    await auditService.record({
      entityRef: entityRef(before.key),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(next)),
    });
    return next;
  }

  /** Deactivation is itself a new version (`status: inactive`) — never a hard delete. */
  async deactivate(id: string, by: string): Promise<NotificationTemplateDoc> {
    return this.update(id, { status: 'inactive' }, by);
  }

  async preview(id: string, data: Record<string, string>): Promise<RenderedTemplateDto> {
    const template = await this.getVersion(id);
    validateVariables(template.variables, data);
    return toRenderedDto(renderTemplate({ subject: template.subject, body: template.body }, data));
  }

  /** Sends a rendered preview to the caller only — never persisted as a real Notification. */
  async testSend(ctx: AuthContext, id: string, data: Record<string, string>, channel: string): Promise<void> {
    const template = await this.getVersion(id);
    if (!template.channels.includes(channel as (typeof template.channels)[number])) {
      throw new NotFoundError(`Template "${template.key}" does not support channel "${channel}"`);
    }
    validateVariables(template.variables, data);
    const rendered = renderTemplate({ subject: template.subject, body: template.body }, data);
    const adapter = getChannelAdapter(channel);
    if (adapter === undefined) throw new NotFoundError(`No adapter registered for channel "${channel}"`);

    const ephemeral: NotificationDoc = {
      _id: new Types.ObjectId(),
      recipientUserId: new Types.ObjectId(ctx.userId),
      entityRef: { moduleId: 'platform', entityType: 'notificationTemplate', entityId: template.key },
      templateKey: template.key,
      templateVersion: template.version,
      category: template.category,
      priority: template.priority,
      data,
      title: rendered.subject ?? rendered.body,
      body: rendered.body,
      channels: [],
      readAt: null,
      archivedAt: null,
      expiresAt: null,
      idempotencyKey: null,
      attachments: [],
      createdAt: new Date(),
    };
    const result = await adapter.send(ephemeral, rendered);
    // Recorded whether it succeeded or not, and BEFORE the failure is thrown, because the thing
    // worth recording is that a message left the system — a failed send may still have reached a
    // carrier. `create` and `update` are audited; this is the third act with an effect outside the
    // database, and it was the only one leaving no trace. The rendered body is deliberately not in
    // the entry: it is the caller's own preview, and a template may carry a one-time link.
    await auditService.record({
      entityRef: entityRef(template.key),
      action: 'update',
      changes: [
        { field: 'testSend.channel', old: null, new: channel },
        { field: 'testSend.version', old: null, new: template.version },
        { field: 'testSend.delivered', old: null, new: result.ok },
      ],
    });
    if (!result.ok) throw new NotFoundError(result.error ?? 'test send failed');
  }
}

export const notificationTemplateService = new NotificationTemplateService();
