// Sprint 3.3 — Notifications Service integration suite: notify() → in-app inbox +
// email delivery, template versioning (with the snapshot invariant), preferences +
// quiet hours + settings defaults, Socket.IO live push, both wired-up event
// subscriptions, idempotency, scheduling/expiration, retry/final-failure, branch-scoped
// fan-out, and the delivery-status audit trail. Runs on the `local`-equivalent test
// transports (jsonTransport SMTP, in-process Socket.IO) against an in-memory Mongo
// replica set (MONGO_TEST_URI overrides, as in files.spec.ts/platform.spec.ts).
import { createServer, type Server as HttpServer } from 'node:http';
import { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  PlatformEvents,
  platformPermissions,
  SettingKeys,
  type EventEnvelope,
  type NotificationDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { emit, nudgeOutboxRelay, subscribe } from '../../src/platform/kernel/event-bus';
import { buildApp } from '../../src/app';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getJobHandler } from '../../src/infrastructure/queue/jobs';
import { closeSocketServer } from '../../src/infrastructure/realtime/socket-server';
import {
  attachNotificationSocket,
  notificationsService,
  registerBuiltinChannelAdapters,
  type NotifyInput,
} from '../../src/platform/notifications';
import { notificationRepository } from '../../src/platform/notifications/notification.repository';
import { DELIVER_JOB } from '../../src/platform/notifications/notification.service';
import {
  clearChannelAdapters,
  registerChannelAdapter,
  type ChannelAdapter,
} from '../../src/platform/notifications/channel-adapters/channel-adapter';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let httpServer: HttpServer | undefined;
let baseUrl: string;
let adminId: string;
let adminToken: string;
let aliceId: string;
let aliceToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-notifications-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  ms = 2000,
): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await predicate()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
};

const settingCtx: AuthContext = {
  userId: '',
  sessionId: 'seed',
  branchId: null,
  locale: 'en',
  permissions: { 'setting.edit': 'organization' },
  permissionVersion: 1,
  isPrivileged: true,
};

// Fake channel adapters exercising the retry/final-failure path deterministically.
const captured: EventEnvelope[] = [];

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri() });

  subscribe(PlatformEvents.NotificationDeliveryFailed, 'spec-capture-deliveryFailed', (e) => {
    captured.push(e);
  });
  subscribe(PlatformEvents.NotificationCreated, 'spec-capture-created', (e) => {
    captured.push(e);
  });

  app = buildApp();
  const server = createServer(app);
  httpServer = server;
  attachNotificationSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  aliceId = await mkUser('alice@ecms.local'); // no roles — self-service surfaces only

  settingCtx.userId = adminId;
  await settingsService.set(settingCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  adminToken = await login('admin@ecms.local');
  aliceToken = await login('alice@ecms.local');
}, 180_000);

afterAll(async () => {
  if (httpServer !== undefined) {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  }
  await closeSocketServer();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// notify()'s returned NotificationDoc[] is a creation-time snapshot (the return value
// captured before any queued-channel delivery runs) — it never reflects a later
// delivery outcome, even though test-mode's inline dispatch has, by the time notify()
// resolves, already updated the real document in the database. Re-fetch through the
// REST API (as any real caller checking delivery status would) rather than trusting
// the returned snapshot for anything beyond creation-time fields.
const fetchNotification = async (token: string, id: string): Promise<NotificationDto> => {
  const list = await request(app)
    .get('/api/v1/platform/notifications')
    .set('Authorization', `Bearer ${token}`);
  const found = (list.body as { data: NotificationDto[] }).data.find((n) => n.id === id);
  if (found === undefined) throw new Error(`notification ${id} not found in inbox`);
  return found;
};

const createTemplate = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await request(app)
    .post('/api/v1/platform/notification-templates')
    .set('Authorization', `Bearer ${token}`)
    .send({
      key: `test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      category: 'workflow',
      priority: 'normal',
      subject: { ar: 'موضوع {{name}}', en: 'Subject {{name}}' },
      body: { ar: 'النص {{name}}', en: 'Body {{name}}' },
      channels: ['inApp', 'email'],
      variables: ['name'],
      defaultExpiryHours: null,
      ...overrides,
    });
  return { status: response.status, body: response.body as Record<string, unknown> };
};

describe('template catalog (admin, permission-gated + audited)', () => {
  it('creates version 1, audited, and rejects a duplicate key', async () => {
    const created = await createTemplate(adminToken, { key: 'test.dup' });
    expect(created.status).toBe(201);
    const dto = created.body.data as { key: string; version: number; isLatest: boolean };
    expect(dto.version).toBe(1);
    expect(dto.isLatest).toBe(true);

    const dupe = await createTemplate(adminToken, { key: 'test.dup' });
    expect(dupe.status).toBe(409);

    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'notificationTemplate', entityId: 'test.dup', pageSize: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    const actions = (audit.body as { data: { action: string }[] }).data.map((r) => r.action);
    expect(actions).toContain('create');
  });

  it('denies template creation without notificationTemplate.create', async () => {
    const response = await createTemplate(aliceToken, { key: 'test.denied' });
    expect(response.status).toBe(403);
  });

  it('edit creates a new version; history is retrievable; existing notifications keep their snapshot', async () => {
    const created = await createTemplate(adminToken, {
      key: 'test.versioning',
      body: { ar: 'نسخة أولى {{name}}', en: 'v1 body {{name}}' },
    });
    const templateId = (created.body.data as { id: string }).id;

    const notified = await notificationsService.notify({
      template: 'test.versioning',
      to: { userId: aliceId },
      data: { name: 'Alice' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'v1' },
    });
    expect(notified).toHaveLength(1);
    const notificationId = String(notified[0]?._id);
    expect(notified[0]?.body.en).toBe('v1 body Alice');
    expect(notified[0]?.templateVersion).toBe(1);

    const updated = await request(app)
      .patch(`/api/v1/platform/notification-templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: { ar: 'نسخة ثانية {{name}}', en: 'v2 body {{name}}' } });
    expect(updated.status).toBe(200);
    const v2 = updated.body.data as { id: string; version: number; isLatest: boolean };
    expect(v2.version).toBe(2);
    expect(v2.isLatest).toBe(true);

    const versions = await request(app)
      .get(`/api/v1/platform/notification-templates/${templateId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(versions.status).toBe(200);
    const versionList = (versions.body as { data: { version: number; isLatest: boolean }[] }).data;
    expect(versionList).toHaveLength(2);
    expect(versionList.find((v) => v.version === 1)?.isLatest).toBe(false);
    expect(versionList.find((v) => v.version === 2)?.isLatest).toBe(true);

    // Snapshot invariant: the already-created notification is unaffected by the edit.
    const inbox = await request(app)
      .get('/api/v1/platform/notifications')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${aliceToken}`);
    const stillV1 = (inbox.body as { data: NotificationDto[] }).data.find(
      (n) => n.id === notificationId,
    );
    expect(stillV1?.body.en).toBe('v1 body Alice');
    expect(stillV1?.templateVersion).toBe(1);

    // Deactivation is also a new version, and a deactivated template can't be notified.
    // Uses v2's id (not the original templateId) — PATCH/DELETE act on the specific
    // version id given, carrying its (already-edited) fields forward.
    const deactivated = await request(app)
      .delete(`/api/v1/platform/notification-templates/${v2.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivated.status).toBe(200);
    expect((deactivated.body.data as { status: string; version: number }).status).toBe('inactive');
    expect((deactivated.body.data as { version: number }).version).toBe(3);

    await expect(
      notificationsService.notify({
        template: 'test.versioning',
        to: { userId: aliceId },
        data: { name: 'Alice' },
        entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'v3' },
      }),
    ).rejects.toThrow(/Unknown or inactive/);
  });

  it('preview renders without sending or persisting anything', async () => {
    const created = await createTemplate(adminToken, { key: 'test.preview' });
    const templateId = (created.body.data as { id: string }).id;
    const before = await request(app)
      .get('/api/v1/platform/notifications/unread-count')
      .set('Authorization', `Bearer ${adminToken}`);

    const preview = await request(app)
      .post(`/api/v1/platform/notification-templates/${templateId}/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data: { name: 'Preview' } });
    expect(preview.status).toBe(200);
    expect((preview.body.data as { body: { en: string } }).body.en).toBe('Body Preview');

    const after = await request(app)
      .get('/api/v1/platform/notifications/unread-count')
      .set('Authorization', `Bearer ${adminToken}`);
    expect((after.body as { data: { count: number } }).data.count).toBe(
      (before.body as { data: { count: number } }).data.count,
    );
  });

  it('test-send delivers a rendered preview to the caller only (permission-gated)', async () => {
    const created = await createTemplate(adminToken, { key: 'test.testsend' });
    const templateId = (created.body.data as { id: string }).id;

    const denied = await request(app)
      .post(`/api/v1/platform/notification-templates/${templateId}/test`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ data: { name: 'X' }, channel: 'email' });
    expect(denied.status).toBe(403);

    const sent = await request(app)
      .post(`/api/v1/platform/notification-templates/${templateId}/test`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data: { name: 'X' }, channel: 'email' });
    expect(sent.status).toBe(204);
  });
});

describe('notify() → in-app inbox (self-scoped, no permission required)', () => {
  let notificationId: string;

  it('creates a bilingual, entity-referenced notification synchronously', async () => {
    await createTemplate(adminToken, {
      key: 'test.inbox',
      channels: ['inApp'],
      subject: null,
    });
    const doc = await notificationsService.notify({
      template: 'test.inbox',
      to: { userId: aliceId },
      data: { name: 'Alice' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'inbox-1' },
    });
    expect(doc).toHaveLength(1);
    notificationId = String(doc[0]?._id);
    expect(doc[0]?.title).toEqual({ ar: 'النص Alice', en: 'Body Alice' });
    expect(doc[0]?.channels).toHaveLength(1);
    expect(doc[0]?.channels[0]).toMatchObject({ channel: 'inApp', status: 'sent' });
  });

  it('lists mine, filters unreadOnly, and reports a live unread count', async () => {
    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(list.status).toBe(200);
    expect((list.body as { data: NotificationDto[] }).data.some((n) => n.id === notificationId)).toBe(
      true,
    );

    const count = await request(app)
      .get('/api/v1/platform/notifications/unread-count')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect((count.body as { data: { count: number } }).data.count).toBeGreaterThanOrEqual(1);
  });

  it('another user cannot see or act on someone else\'s notification (identity ownership)', async () => {
    const asAdmin = await request(app)
      .post(`/api/v1/platform/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(404);
  });

  it('first-read-wins: a second mark-read call does not change readAt', async () => {
    const first = await request(app)
      .post(`/api/v1/platform/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(first.status).toBe(200);
    const readAt = (first.body.data as { readAt: string }).readAt;
    expect(readAt).not.toBeNull();

    const second = await request(app)
      .post(`/api/v1/platform/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(second.status).toBe(200);
    expect((second.body.data as { readAt: string }).readAt).toBe(readAt);
  });

  it('mark-all-read and archive', async () => {
    await notificationsService.notify({
      template: 'test.inbox',
      to: { userId: aliceId },
      data: { name: 'Second' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'inbox-2' },
    });
    const markAll = await request(app)
      .post('/api/v1/platform/notifications/read-all')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(markAll.status).toBe(200);
    expect((markAll.body as { data: { count: number } }).data.count).toBeGreaterThanOrEqual(1);

    const countAfter = await request(app)
      .get('/api/v1/platform/notifications/unread-count')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect((countAfter.body as { data: { count: number } }).data.count).toBe(0);

    const archived = await request(app)
      .delete(`/api/v1/platform/notifications/${notificationId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(archived.status).toBe(204);

    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect((list.body as { data: NotificationDto[] }).data.some((n) => n.id === notificationId)).toBe(
      false,
    );
  });

  it('round-trips attachments (file references only)', async () => {
    const doc = await notificationsService.notify({
      template: 'test.inbox',
      to: { userId: aliceId },
      data: { name: 'Attach' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'inbox-attach' },
      attachments: ['64b1f0aaaaaaaaaaaaaaaaaa'],
    });
    expect(doc[0]?.attachments.map(String)).toEqual(['64b1f0aaaaaaaaaaaaaaaaaa']);
  });
});

describe('email delivery via the channel-adapter/queue path', () => {
  it('delivers successfully and every status transition is audited (§3b)', async () => {
    await createTemplate(adminToken, { key: 'test.email.ok', category: 'contracts' });
    const doc = await notificationsService.notify({
      template: 'test.email.ok',
      to: { userId: aliceId },
      data: { name: 'Mail' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'email-ok' },
    });
    const notificationId = String(doc[0]?._id);

    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${aliceToken}`);
    const dto = (list.body as { data: NotificationDto[] }).data.find((n) => n.id === notificationId);
    const email = dto?.channels.find((c) => c.channel === 'email');
    expect(email?.status).toBe('sent');
    expect(email?.sentAt).not.toBeNull();

    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'notification', entityId: notificationId, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    // The API returns newest-first (`{at: -1}`, hardcoded) — sort back to
    // chronological order before reading off the transition sequence.
    const rows = (
      audit.body as { data: { action: string; at: string; changes: { field: string; new: unknown }[] }[] }
    ).data
      .filter((r) => r.action === 'statusChange')
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .map((r) => r.changes[0]);
    const emailTransitions = rows
      .filter((c) => c?.field === 'channels.email.status')
      .map((c) => c?.new);
    expect(emailTransitions).toEqual(['queued', 'processing', 'sent']);
    expect(rows.some((c) => c?.field === 'channels.inApp.status' && c.new === 'sent')).toBe(true);

    // Idempotency layer 3 (§2a): re-running the delivery job for an already-sent
    // channel is a no-op — no new audit row is produced.
    const handler = getJobHandler('notifications', DELIVER_JOB);
    expect(handler).toBeDefined();
    await handler?.({ notificationId, channel: 'email', attempt: 1 }, DELIVER_JOB);
    const auditAfter = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'notification', entityId: notificationId, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((auditAfter.body as { data: unknown[] }).data).toHaveLength(
      (audit.body as { data: unknown[] }).data.length,
    );
  });

  it('retries on failure and records final failure + platform.notification.deliveryFailed', async () => {
    const failingEmail: ChannelAdapter = { id: 'email', send: () => Promise.resolve({ ok: false, error: 'boom' }) };
    clearChannelAdapters();
    registerChannelAdapter({ id: 'inApp', send: () => Promise.resolve({ ok: true }) });
    registerChannelAdapter(failingEmail);
    try {
      await createTemplate(adminToken, { key: 'test.email.fail', category: 'contracts' });
      const doc = await notificationsService.notify({
        template: 'test.email.fail',
        to: { userId: aliceId },
        data: { name: 'Fail' },
        entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'email-fail' },
      });
      const notificationId = String(doc[0]?._id);

      await waitFor(() =>
        captured.some(
          (e) =>
            e.name === PlatformEvents.NotificationDeliveryFailed &&
            (e.payload as { notificationId: string }).notificationId === notificationId,
        ),
      );
      const failedEvent = captured.find(
        (e) =>
          e.name === PlatformEvents.NotificationDeliveryFailed &&
          (e.payload as { notificationId: string }).notificationId === notificationId,
      );
      expect((failedEvent?.payload as { error: string }).error).toBe('boom');

      const list = await request(app)
        .get('/api/v1/platform/notifications')
        .set('Authorization', `Bearer ${aliceToken}`);
      const dto = (list.body as { data: NotificationDto[] }).data.find((n) => n.id === notificationId);
      const email = dto?.channels.find((c) => c.channel === 'email');
      expect(email?.status).toBe('failed');
      expect(email?.error).toBe('boom');
    } finally {
      clearChannelAdapters();
      registerBuiltinChannelAdapters();
    }
  });

  it('cancels a still-queued channel that expires before its turn', async () => {
    // Constructed directly (rather than via a live notify() → delivery round trip):
    // test-mode's inline job runner delivers synchronously, so there is no real
    // window in which a queued channel can "expire before its turn" — this exercises
    // the same handler a real (delayed) BullMQ job would invoke in production.
    const doc = await notificationRepository.create({
      recipientUserId: new Types.ObjectId(aliceId),
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'expiring' },
      templateKey: 'test.email.ok',
      templateVersion: 1,
      category: 'contracts',
      priority: 'normal',
      data: {},
      title: { ar: 'ط', en: 't' },
      body: { ar: 'ن', en: 'b' },
      channels: [
        {
          channel: 'email',
          status: 'queued',
          statusHistory: [{ status: 'queued', at: new Date() }],
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          error: null,
        },
      ],
      readAt: null,
      archivedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      idempotencyKey: null,
      attachments: [],
      createdAt: new Date(),
    });

    const handler = getJobHandler('notifications', DELIVER_JOB);
    await handler?.({ notificationId: String(doc._id), channel: 'email', attempt: 1 }, DELIVER_JOB);

    const after = await notificationRepository.findAnyById(String(doc._id));
    expect(after?.channels[0]?.status).toBe('cancelled');
  });
});

describe('preferences, settings defaults, and quiet hours (§3c)', () => {
  it('opting out suppresses the channel entirely (category-level, no channel entry at all)', async () => {
    await createTemplate(adminToken, { key: 'test.pref.optout', category: 'system' });
    const optOut = await request(app)
      .put('/api/v1/platform/notification-preferences')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ category: 'system', channel: 'email', enabled: false });
    expect(optOut.status).toBe(200);

    const mine = await request(app)
      .get('/api/v1/platform/notification-preferences')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(
      (mine.body.data as { preferences: { category: string; channel: string; enabled: boolean }[] })
        .preferences,
    ).toContainEqual({ category: 'system', channel: 'email', enabled: false });

    const doc = await notificationsService.notify({
      template: 'test.pref.optout',
      to: { userId: aliceId },
      data: { name: 'Opt' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'optout' },
    });
    expect(doc[0]?.channels.some((c) => c.channel === 'email')).toBe(false);
    expect(doc[0]?.channels.some((c) => c.channel === 'inApp')).toBe(true);
  });

  it('the settings-driven default applies when no preference row exists', async () => {
    await createTemplate(adminToken, { key: 'test.pref.default', category: 'finance' });
    settingCtx.userId = adminId;
    await settingsService.set(settingCtx, {
      key: SettingKeys.NotificationsEmailEnabled,
      scope: 'organization',
      value: false,
    });
    try {
      const doc = await notificationsService.notify({
        template: 'test.pref.default',
        to: { userId: aliceId },
        data: { name: 'Def' },
        entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'default-off' },
      });
      expect(doc[0]?.channels.some((c) => c.channel === 'email')).toBe(false);
    } finally {
      await settingsService.set(settingCtx, {
        key: SettingKeys.NotificationsEmailEnabled,
        scope: 'organization',
        value: true,
      });
    }
  });

  it('quiet hours outside the current window do not defer delivery', async () => {
    // A window guaranteed not to include "now" (a 1-minute slice far from now's HH:mm).
    const farStart = new Date(Date.now() + 6 * 60 * 60_000);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const start = `${pad(farStart.getUTCHours())}:${pad(farStart.getUTCMinutes())}`;
    const endDate = new Date(farStart.getTime() + 60_000);
    const end = `${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}`;

    const qh = await request(app)
      .put('/api/v1/platform/notification-preferences/quiet-hours')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ enabled: true, start, end });
    expect(qh.status).toBe(200);

    await createTemplate(adminToken, { key: 'test.pref.quiethours', category: 'atm' });
    const doc = await notificationsService.notify({
      template: 'test.pref.quiethours',
      to: { userId: aliceId },
      data: { name: 'QH' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'qh-outside' },
    });
    const fetched = await fetchNotification(aliceToken, String(doc[0]?._id));
    const email = fetched.channels.find((c) => c.channel === 'email');
    expect(email?.status).toBe('sent');

    // Disable again so it doesn't leak into later tests.
    await request(app)
      .put('/api/v1/platform/notification-preferences/quiet-hours')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ enabled: false, start, end });
  });

  it('critical priority bypasses quiet hours even when the window covers now', async () => {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const start = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
    const end = `${pad(new Date(now.getTime() + 30 * 60_000).getUTCHours())}:${pad(
      new Date(now.getTime() + 30 * 60_000).getUTCMinutes(),
    )}`;
    await request(app)
      .put('/api/v1/platform/notification-preferences/quiet-hours')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ enabled: true, start, end });

    await createTemplate(adminToken, {
      key: 'test.pref.critical',
      category: 'approval',
      priority: 'critical',
    });
    const doc = await notificationsService.notify({
      template: 'test.pref.critical',
      to: { userId: aliceId },
      data: { name: 'Crit' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'critical-bypass' },
    });
    const fetched = await fetchNotification(aliceToken, String(doc[0]?._id));
    const email = fetched.channels.find((c) => c.channel === 'email');
    expect(email?.status).toBe('sent'); // never deferred, despite the active quiet-hours window

    await request(app)
      .put('/api/v1/platform/notification-preferences/quiet-hours')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ enabled: false, start, end });
  });
});

describe('idempotency, scheduling, and expiration (§2a/§2c/§2d)', () => {
  it('a repeated idempotencyKey never creates a second notification', async () => {
    await createTemplate(adminToken, { key: 'test.idem', channels: ['inApp'], subject: null, category: 'fleet' });
    const input: NotifyInput = {
      template: 'test.idem',
      to: { userId: aliceId },
      data: { name: 'Idem' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'idem-1' },
    };
    const first = await notificationsService.notify(input, { idempotencyKey: 'idem-key-1' });
    const second = await notificationsService.notify(input, { idempotencyKey: 'idem-key-1' });
    expect(String(first[0]?._id)).toBe(String(second[0]?._id));
  });

  it('an already-past expiresAt is a full no-op (nothing created on any channel)', async () => {
    await createTemplate(adminToken, { key: 'test.expired', category: 'vault' });
    const before = await notificationRepository.unreadCount(aliceId);
    const doc = await notificationsService.notify({
      template: 'test.expired',
      to: { userId: aliceId },
      data: { name: 'Exp' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'expired-1' },
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(doc).toEqual([]);
    const after = await notificationRepository.unreadCount(aliceId);
    expect(after).toBe(before);
  });

  it('sendAt creates nothing before it fires, and the scheduled job creates it when it does', async () => {
    await createTemplate(adminToken, { key: 'test.scheduled', channels: ['inApp'], subject: null, category: 'vault' });
    const returned = await notificationsService.notify(
      {
        template: 'test.scheduled',
        to: { userId: aliceId },
        data: { name: 'Sched' },
        entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'scheduled-1' },
      },
      { sendAt: new Date(Date.now() + 60_000) },
    );
    // notify() itself always returns [] on the scheduled path (nothing created yet at
    // call time); in the test-mode inline job runner the scheduled job has, by this
    // point, already executed synchronously — so the notification now exists.
    expect(returned).toEqual([]);
    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .query({ entityType: 'test', entityId: 'scheduled-1', pageSize: 10 })
      .set('Authorization', `Bearer ${aliceToken}`);
    expect((list.body as { data: NotificationDto[] }).data).toHaveLength(1);
  });
});

describe('branch-scoped fan-out (§1, permission-based recipients)', () => {
  it('reaches only the targeted branch\'s qualifying users; organization scope is unaffected', async () => {
    const branchA = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-A', name: { ar: 'فرع أ', en: 'Branch A' } });
    expect(branchA.status).toBe(201);
    const branchAId = (branchA.body.data as { id: string }).id;

    const branchB = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-B', name: { ar: 'فرع ب', en: 'Branch B' } });
    const branchBId = (branchB.body.data as { id: string }).id;

    const role = await rbacService.createRole(
      { name: { ar: 'مشاهد الفرع', en: 'Branch viewer' }, permissionKeys: ['auditLog.view'] },
      adminId,
    );
    // Branch-scoped assignments always mirror the user's own home branch (2.1
    // simplification — no multi-branch grants yet), so each user must be seeded
    // with that branch as their home branch before the assignment.
    const userBranchA = await mkUser('branch-a@ecms.local', branchAId);
    const userBranchB = await mkUser('branch-b@ecms.local', branchBId);
    await rbacService.assignRole(
      { userId: userBranchA, roleId: String(role._id), scope: 'branch' },
      adminId,
    );
    await rbacService.assignRole(
      { userId: userBranchB, roleId: String(role._id), scope: 'branch' },
      adminId,
    );

    await createTemplate(adminToken, { key: 'test.branch.fanout', channels: ['inApp'], subject: null, category: 'hr' });

    const branchScoped = await notificationsService.notify({
      template: 'test.branch.fanout',
      to: { permission: 'auditLog.view', scope: 'branch', branchId: branchAId },
      data: { name: 'Branch' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'branch-a' },
    });
    const branchRecipients = branchScoped.map((n) => String(n.recipientUserId));
    expect(branchRecipients).toContain(adminId); // organization-scope always qualifies
    expect(branchRecipients).toContain(userBranchA);
    expect(branchRecipients).not.toContain(userBranchB);

    const orgScoped = await notificationsService.notify({
      template: 'test.branch.fanout',
      to: { permission: 'auditLog.view', scope: 'organization' },
      data: { name: 'Org' },
      entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'branch-org' },
    });
    const orgRecipients = orgScoped.map((n) => String(n.recipientUserId));
    expect(orgRecipients).toContain(adminId);
    expect(orgRecipients).not.toContain(userBranchA);
    expect(orgRecipients).not.toContain(userBranchB);
  });
});

describe('Socket.IO live push (§2/§6)', () => {
  it('rejects a connection without a valid token', async () => {
    const socket = ioClient(baseUrl, { auth: {}, transports: ['websocket'], forceNew: true });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect_error', () => resolve());
      socket.on('connect', () => reject(new Error('should not have connected')));
      setTimeout(() => reject(new Error('timed out waiting for connect_error')), 5000);
    });
    socket.close();
  });

  it('an authenticated connect joins exactly the caller\'s own room and receives notification:new', async () => {
    const socket: ClientSocket = ioClient(baseUrl, {
      auth: { token: aliceToken },
      transports: ['websocket'],
      forceNew: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
        setTimeout(() => reject(new Error('timed out waiting for connect')), 5000);
      });

      const eventPromise = new Promise<NotificationDto>((resolve, reject) => {
        socket.once('notification:new', (payload: NotificationDto) => resolve(payload));
        setTimeout(() => reject(new Error('timed out waiting for notification:new')), 5000);
      });

      await createTemplate(adminToken, { key: 'test.socket', channels: ['inApp'], subject: null, category: 'system' });
      await notificationsService.notify({
        template: 'test.socket',
        to: { userId: aliceId },
        data: { name: 'Socket' },
        entityRef: { moduleId: 'platform', entityType: 'test', entityId: 'socket-1' },
      });

      const payload = await eventPromise;
      expect(payload.templateKey).toBe('test.socket');
      expect(payload.title.en).toBe('Body Socket');
    } finally {
      socket.close();
    }
  });
});

describe('event subscriptions end-to-end (§4)', () => {
  it('platform.roleAssignment.changed notifies the affected user', async () => {
    const role = await rbacService.createRole(
      { name: { ar: 'دور تجريبي', en: 'Test role' }, permissionKeys: ['auditLog.view'] },
      adminId,
    );
    const before = await notificationRepository.unreadCount(aliceId);

    const response = await request(app)
      .post('/api/v1/platform/role-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: aliceId, roleId: String(role._id), scope: 'organization' });
    expect(response.status).toBe(201);

    await waitFor(async () => (await notificationRepository.unreadCount(aliceId)) > before);
    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(
      (list.body as { data: NotificationDto[] }).data.some(
        (n) => n.templateKey === 'platform.roleAssignmentChanged',
      ),
    ).toBe(true);
  });

  it('platform.audit.alertRaised notifies everyone holding auditLog.view @ organization', async () => {
    const before = await notificationRepository.unreadCount(adminId);
    await emit(
      PlatformEvents.AuditAlertRaised,
      { signal: 'test.signal', count: 7, windowMinutes: 60 },
      { reliable: true },
    );
    nudgeOutboxRelay();

    await waitFor(async () => (await notificationRepository.unreadCount(adminId)) > before);
    const list = await request(app)
      .get('/api/v1/platform/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    const match = (list.body as { data: NotificationDto[] }).data.find(
      (n) => n.templateKey === 'platform.securityAlertRaised',
    );
    expect(match).toBeDefined();
    expect(match?.title.en).toContain('test.signal');
  });
});
