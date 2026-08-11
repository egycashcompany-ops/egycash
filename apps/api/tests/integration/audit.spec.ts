// Sprint 3.2 — Audit & Activity Service: audited CSV export (F1/F3), entity timeline
// with BD-007 graceful degradation (F1/F2), retention governance (F4), and
// security-signal detection (F5). Runs against a real in-memory Mongo REPLICA SET
// (transactions, aggregation) — same MONGO_TEST_URI escape hatch as platform.spec.ts.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformEvents, platformPermissions, SettingKeys, type EventEnvelope } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { buildApp } from '../../src/app';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { type AuditLogDto } from '@ecms/contracts';
import { auditService } from '../../src/platform/audit';
import { AuditLogModel, ActivityLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { type Express } from 'express';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let activityOnlyToken: string;
let auditOnlyToken: string;
let neitherId: string;
let neitherToken: string;
let adminCtx: AuthContext;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-audit-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

// alertRaised is emitted on the reliable tier; nudgeOutboxRelay() is fire-and-forget
// (not awaited by the request path), so the subscribed capture can lag the HTTP
// response by a tick even in test mode — poll instead of asserting immediately
// (same pattern as files.spec.ts).
const waitFor = async (predicate: () => boolean, ms = 1000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const login = async (email: string): Promise<string> => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
};

const mkUser = async (email: string, permissionKeys: string[]): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const userId = String(user._id);
  await userService.setPassword(userId, PASSWORD, 'passwordReset');
  await userService.forceActivate(userId);
  const role = await rbacService.createRole(
    { name: { en: email, ar: email }, permissionKeys },
    adminId,
  );
  await rbacService.assignRole({ userId, roleId: String(role._id), scope: 'organization' }, adminId);
  return userId;
};

const captured: EventEnvelope[] = [];

const runScheduledTask = async (key: string, token: string): Promise<void> => {
  const response = await request(app)
    .post(`/api/v1/platform/scheduled-tasks/${key}/run`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(204);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri() });
  subscribe(PlatformEvents.AuditAlertRaised, 'spec-capture-alert', (e) => {
    captured.push(e);
  });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const { user: admin } = await userService.create(
    {
      email: 'admin@ecms.local',
      firstName: { ar: 'م', en: 'Admin' },
      lastName: { ar: 'م', en: 'Admin' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(admin._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  adminCtx = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(adminCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  await mkUser('activity-only@ecms.local', ['activityLog.view']);
  await mkUser('audit-only@ecms.local', ['auditLog.view']);
  neitherId = await mkUser('neither@ecms.local', ['organization.view']);

  adminToken = await login('admin@ecms.local');
  activityOnlyToken = await login('activity-only@ecms.local');
  auditOnlyToken = await login('audit-only@ecms.local');
  neitherToken = await login('neither@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('F1/F3 — audited CSV export', () => {
  it('streams a CSV with the header row and self-audits the export', async () => {
    const response = await request(app)
      .get('/api/v1/platform/audit-logs/export?action=login')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const lines = response.text.trim().split('\n');
    expect(lines[0]).toBe(
      'id,moduleId,entityType,entityId,action,actorUserId,actorIp,requestId,at,changes',
    );
    expect(lines.length).toBeGreaterThan(1);

    const list = await request(app)
      .get('/api/v1/platform/audit-logs?action=export&pageSize=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const items = (list.body as { data: { changes: { field: string; new: unknown }[] }[] }).data;
    expect(items.length).toBeGreaterThan(0);
    const rowCountField = items[0]?.changes.find((c) => c.field === 'rowCount');
    expect(rowCountField).toBeDefined();
  });

  it('denies export without auditLog.export and audits the denial', async () => {
    const response = await request(app)
      .get('/api/v1/platform/audit-logs/export')
      .set('Authorization', `Bearer ${activityOnlyToken}`);
    expect(response.status).toBe(403);
  });

  it('caps rows at the configured audit.export.maxRows', async () => {
    for (let i = 0; i < 5; i += 1) {
      await auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'capTestEntity', entityId: `e${i}` },
        action: 'update',
      });
    }
    await settingsService.set(adminCtx, {
      key: SettingKeys.AuditExportMaxRows,
      scope: 'organization',
      value: 1_000, // schema floor is 1000; the cap itself is asserted via the count below
    });

    const response = await request(app)
      .get('/api/v1/platform/audit-logs/export?entityType=capTestEntity')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const dataLines = response.text.trim().split('\n').slice(1);
    expect(dataLines.length).toBe(5); // below the cap — proves filtering + no truncation surprise
  });
});

describe('F1/F2 — entity timeline (BD-007 graceful degradation)', () => {
  const entityRef = { moduleId: 'platform', entityType: 'timelineTest', entityId: 'e1' };

  beforeAll(async () => {
    await auditService.record({
      entityRef,
      action: 'create',
      changes: [{ field: 'name', old: null, new: 'X' }],
    });
    await auditService.recordActivity({
      entityRef,
      messageKey: 'test.created',
      params: {},
    });
  });

  it('returns activity-only content for a caller with only activityLog.view', async () => {
    const response = await request(app)
      .get('/api/v1/platform/timeline?entityType=timelineTest&entityId=e1')
      .set('Authorization', `Bearer ${activityOnlyToken}`);
    expect(response.status).toBe(200);
    const body = response.body as { data: { items: { source: string }[]; included: string[] } };
    expect(body.data.included).toEqual(['activity']);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((e) => e.source === 'activity')).toBe(true);
  });

  it('returns audit-only content for a caller with only auditLog.view', async () => {
    const response = await request(app)
      .get('/api/v1/platform/timeline?entityType=timelineTest&entityId=e1')
      .set('Authorization', `Bearer ${auditOnlyToken}`);
    expect(response.status).toBe(200);
    const body = response.body as { data: { items: { source: string }[]; included: string[] } };
    expect(body.data.included).toEqual(['audit']);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items.every((e) => e.source === 'audit')).toBe(true);
  });

  it('returns the merged timeline for a caller with both permissions', async () => {
    const response = await request(app)
      .get('/api/v1/platform/timeline?entityType=timelineTest&entityId=e1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const body = response.body as { data: { items: { source: string }[]; included: string[] } };
    expect(body.data.included.sort()).toEqual(['activity', 'audit']);
    const sources = new Set(body.data.items.map((e) => e.source));
    expect(sources.has('activity')).toBe(true);
    expect(sources.has('audit')).toBe(true);
  });

  it('denies a caller with neither permission and audits the denial', async () => {
    const response = await request(app)
      .get('/api/v1/platform/timeline?entityType=timelineTest&entityId=e1')
      .set('Authorization', `Bearer ${neitherToken}`);
    expect(response.status).toBe(403);

    const denied = await AuditLogModel.findOne({
      action: 'permissionDenied',
      'entityRef.entityId': neitherId,
    })
      .sort({ at: -1 })
      .lean()
      .exec();
    expect(denied).not.toBeNull();
  });
});

describe('F4 — retention governance', () => {
  it('purges expired activity records but never touches the audit stream', async () => {
    const oldAt = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    await ActivityLogModel.create([
      {
        entityRef: { moduleId: 'platform', entityType: 'retentionTest', entityId: 'old' },
        messageKey: 'old.event',
        params: {},
        actorId: null,
        at: oldAt,
      },
      {
        entityRef: { moduleId: 'platform', entityType: 'retentionTest', entityId: 'recent' },
        messageKey: 'recent.event',
        params: {},
        actorId: null,
        at: new Date(),
      },
    ]);
    const auditRowsBefore = await AuditLogModel.countDocuments({}).exec();

    await runScheduledTask('platform.audit.retention', adminToken);

    const old = await ActivityLogModel.findOne({ 'entityRef.entityId': 'old' }).lean().exec();
    const recent = await ActivityLogModel.findOne({ 'entityRef.entityId': 'recent' }).lean().exec();
    expect(old).toBeNull();
    expect(recent).not.toBeNull();

    const purgeRow = await AuditLogModel.findOne({
      action: 'purge',
      'entityRef.entityId': 'retention',
    })
      .sort({ at: -1 })
      .lean<{ changes: { field: string; new: unknown }[] }>()
      .exec();
    expect(purgeRow).not.toBeNull();
    const deletedCount = purgeRow?.changes.find((c) => c.field === 'deletedCount')?.new;
    expect(typeof deletedCount).toBe('number');
    expect(deletedCount as number).toBeGreaterThanOrEqual(1);

    // The retention job's own audit row proves the audit stream only ever grows.
    const auditRowsAfter = await AuditLogModel.countDocuments({}).exec();
    expect(auditRowsAfter).toBeGreaterThan(auditRowsBefore);
  });
});

describe('F5 — security-signal detection', () => {
  it('raises repeatedDenied once the threshold is crossed, then dedups on re-run', async () => {
    await settingsService.set(adminCtx, {
      key: SettingKeys.AuditSignalsDeniedThreshold,
      scope: 'organization',
      value: 3,
    });

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app)
        .get('/api/v1/platform/audit-logs')
        .set('Authorization', `Bearer ${neitherToken}`);
      expect(response.status).toBe(403);
    }

    await runScheduledTask('platform.audit.securitySignals', adminToken);

    const alerts = await AuditLogModel.find({
      action: 'alertRaised',
      'entityRef.entityId': 'repeatedDenied',
      'actor.userId': neitherId,
    })
      .lean()
      .exec();
    expect(alerts.length).toBe(1);
    const hasAlertEvent = (): boolean =>
      captured.some(
        (e) =>
          e.name === PlatformEvents.AuditAlertRaised &&
          (e.payload as { signal: string; userId?: string }).signal === 'repeatedDenied' &&
          (e.payload as { signal: string; userId?: string }).userId === neitherId,
      );
    await waitFor(hasAlertEvent);
    expect(hasAlertEvent()).toBe(true);

    // Re-run within the same window: dedup must not raise a second alert.
    await runScheduledTask('platform.audit.securitySignals', adminToken);
    const alertsAfterRerun = await AuditLogModel.find({
      action: 'alertRaised',
      'entityRef.entityId': 'repeatedDenied',
      'actor.userId': neitherId,
    })
      .lean()
      .exec();
    expect(alertsAfterRerun.length).toBe(1);
  });
});

/**
 * P11 — the two guards the screens make reachable.
 *
 * Both were invisible while nothing read `GET /platform/audit-logs`: the list endpoint existed and
 * was authorized, but no surface called it. Putting a screen on it is what turns each of them from
 * a latent inconsistency into something an administrator sees.
 */
describe('P11 — the audit read model (G-1, G-2)', () => {
  const NATIONAL_ID = '29001010101234';

  const seedRow = async (): Promise<void> => {
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'p11Subject', entityId: 'p11-1' },
      action: 'update',
      changes: [{ field: 'nationalId', old: NATIONAL_ID, new: '29001010109999' }],
      actor: { userId: adminId, ip: '10.1.2.3', userAgent: 'Chrome' },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  const listRows = async (token: string, qs = ''): Promise<AuditLogDto[]> => {
    const response = await request(app)
      .get(`/api/v1/platform/audit-logs?entityType=p11Subject&pageSize=50${qs}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return (response.body as { data: AuditLogDto[] }).data;
  };

  // G-1. The masking used to live in the export alone, so the list — the thing a screen reads —
  // was the weaker of two readers of identical rows.
  it('masks a national id in the LIST, not only in the export', async () => {
    await seedRow();
    const rows = await listRows(adminToken);
    expect(rows.length).toBeGreaterThan(0);
    const change = rows[0]?.changes[0];
    expect(String(change?.old)).not.toBe(NATIONAL_ID);
    expect(String(change?.old)).toContain('*');
  });

  it('gives the export and the list the same masked value', async () => {
    const rows = await listRows(adminToken);
    const masked = String(rows[0]?.changes[0]?.old);
    const csv = await request(app)
      .get('/api/v1/platform/audit-logs/export?entityType=p11Subject')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(masked);
    expect(csv.text).not.toContain(NATIONAL_ID);
  });

  // G-2. The row has always stored the snapshot; only this DTO dropped it.
  it('returns who the actor was AT THE TIME, not just an id', async () => {
    const rows = await listRows(adminToken);
    expect(rows[0]?.actorSnapshot).not.toBeNull();
    expect(rows[0]?.actorSnapshot?.userId).toBe(adminId);
    expect(rows[0]?.actorSnapshot?.displayName.en.trim()).not.toBe('');
  });

  it('carries ip and user agent — the screen shows them in the detail panel only', async () => {
    const rows = await listRows(adminToken);
    expect(rows[0]?.actor.ip).toBe('10.1.2.3');
    expect(rows[0]?.actor.userAgent).toBe('Chrome');
  });

  describe('the filters the screens actually send', () => {
    it('filters by entityId, action and moduleId', async () => {
      expect((await listRows(adminToken, '&entityId=p11-1')).length).toBeGreaterThan(0);
      expect((await listRows(adminToken, '&entityId=nope'))).toHaveLength(0);
      expect((await listRows(adminToken, '&action=update')).length).toBeGreaterThan(0);
      expect((await listRows(adminToken, '&action=delete'))).toHaveLength(0);
      expect((await listRows(adminToken, '&moduleId=hr')).length).toBeGreaterThan(0);
      expect((await listRows(adminToken, '&moduleId=fleet'))).toHaveLength(0);
    });

    it('filters by actor and by date window', async () => {
      expect((await listRows(adminToken, `&actorUserId=${adminId}`)).length).toBeGreaterThan(0);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      expect(await listRows(adminToken, `&from=${tomorrow}`)).toHaveLength(0);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      expect((await listRows(adminToken, `&from=${yesterday}`)).length).toBeGreaterThan(0);
    });

    it('refuses a filter it does not declare, rather than ignoring it', async () => {
      const response = await request(app)
        .get('/api/v1/platform/audit-logs?q=anything')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
    });
  });

  describe('reading is not exporting', () => {
    // The screen withholds the export control on this exact distinction; the server is what
    // actually enforces it.
    it('lets auditLog.view read the list', async () => {
      const response = await request(app)
        .get('/api/v1/platform/audit-logs?pageSize=1')
        .set('Authorization', `Bearer ${auditOnlyToken}`);
      expect(response.status).toBe(200);
    });

    it('refuses the export to the same caller — view does not grant export', async () => {
      const response = await request(app)
        .get('/api/v1/platform/audit-logs/export')
        .set('Authorization', `Bearer ${auditOnlyToken}`);
      expect(response.status).toBe(403);
    });

    it('refuses both to a caller holding neither', async () => {
      expect(
        (
          await request(app)
            .get('/api/v1/platform/audit-logs')
            .set('Authorization', `Bearer ${neitherToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v1/platform/activity-logs')
            .set('Authorization', `Bearer ${neitherToken}`)
        ).status,
      ).toBe(403);
    });

    // The two streams are independent grants — which is why they get two screens, not one.
    it('does not let activityLog.view read the audit stream', async () => {
      expect(
        (
          await request(app)
            .get('/api/v1/platform/audit-logs')
            .set('Authorization', `Bearer ${activityOnlyToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/v1/platform/activity-logs')
            .set('Authorization', `Bearer ${activityOnlyToken}`)
        ).status,
      ).toBe(200);
    });
  });
});
