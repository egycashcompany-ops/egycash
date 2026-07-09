// Sprint 3.1 — File Management Service integration suite: the full lifecycle
// (upload → download via signed URL → replace/versions → archive/restore →
// soft delete → permanent delete), category-driven validation, visibility
// authorization, the processor extension points, and the audit trail.
// Runs on the `local` storage provider (tmpdir) against an in-memory Mongo
// replica set (MONGO_TEST_URI overrides, as in platform.spec.ts).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PlatformEvents,
  platformPermissions,
  SettingKeys,
  type EventEnvelope,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { buildApp } from '../../src/app';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { registerFileProcessor } from '../../src/platform/files';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { type Express } from 'express';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let bobToken: string;
let categoryId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-files-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const waitFor = async (predicate: () => boolean, ms = 1000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const seedUsers = async (): Promise<void> => {
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const mk = async (email: string): Promise<string> => {
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
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));
    return String(user._id);
  };
  adminId = await mk('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  await mk('bob@ecms.local'); // no roles at all

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
};

const login = async (email: string): Promise<string> => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
};

const uploadPng = (
  token: string,
  options: { name?: string; content?: Buffer; mime?: string; entityId?: string } = {},
) =>
  request(app)
    .post('/api/v1/platform/files')
    .set('Authorization', `Bearer ${token}`)
    .field('moduleId', 'platform')
    .field('entityType', 'user')
    .field('entityId', options.entityId ?? adminId)
    .field('categoryId', categoryId)
    .field('tags', JSON.stringify(['test', 'id-scan']))
    .attach('file', options.content ?? Buffer.from('png-bytes-here'), {
      filename: options.name ?? 'id-front.png',
      contentType: options.mime ?? 'image/png',
    });

// Fake processors exercising the extension points (virus scan + thumbnail).
const captured: EventEnvelope[] = [];

beforeAll(async () => {
  registerFileProcessor({
    id: 'virusScan',
    handler: async (file) =>
      file.originalName.includes('eicar') ? { result: 'blocked' } : { result: 'ok' },
  });
  registerFileProcessor({
    id: 'thumbnail',
    handler: async () => ({ result: 'ok', detail: { width: 128 } }),
  });

  await bootPlatform({ mongoUri: await resolveMongoUri() });
  subscribe(PlatformEvents.VirusScanCompleted, 'spec-capture-scan', (e) => {
    captured.push(e);
  });
  subscribe(PlatformEvents.ThumbnailCreated, 'spec-capture-thumb', (e) => {
    captured.push(e);
  });
  subscribe(PlatformEvents.FileUploaded, 'spec-capture-upload', (e) => {
    captured.push(e);
  });
  app = buildApp();
  await seedUsers();
  adminToken = await login('admin@ecms.local');
  bobToken = await login('bob@ecms.local');

  const category = await request(app)
    .post('/api/v1/platform/file-categories')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      key: 'id-scans',
      name: { ar: 'مسح البطاقات', en: 'ID scans' },
      allowedMimeTypes: ['image/*', 'application/pdf'],
      maxSizeMb: 1,
      retentionDays: null,
    });
  expect(category.status).toBe(201);
  categoryId = (category.body as { data: { id: string } }).data.id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('upload with category-driven validation', () => {
  let fileId: string;

  it('uploads and records the full metadata set', async () => {
    const response = await uploadPng(adminToken);
    expect(response.status).toBe(201);
    const dto = (response.body as { data: Record<string, unknown> }).data;
    fileId = dto.id as string;

    expect(dto.originalName).toBe('id-front.png');
    expect(dto.storedName).toMatch(/^1-[0-9a-f-]{36}\.png$/);
    expect(dto.mime).toBe('image/png');
    expect(dto.extension).toBe('.png');
    expect(dto.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dto.size).toBeGreaterThan(0);
    expect(dto.fileVersion).toBe(1);
    expect(dto.isLatest).toBe(true);
    expect(dto.uploadedBy).toBe(adminId);
    expect(dto.entityRef).toEqual({ moduleId: 'platform', entityType: 'user', entityId: adminId });
    expect(dto.tags).toEqual(['test', 'id-scan']);
    expect(dto.visibility).toBe('private');
    expect(dto.storageDriver).toBe('local');
    // virusScan processor registered → pending, then resolved by the pipeline.
    await waitFor(() => captured.some((e) => e.name === PlatformEvents.VirusScanCompleted));
  });

  it('rejects a mime type outside the category allowlist', async () => {
    const response = await uploadPng(adminToken, { name: 'notes.txt', mime: 'text/plain' });
    expect(response.status).toBe(422);
    expect((response.body as { error: { code: string } }).error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a file above the category size limit', async () => {
    const big = Buffer.alloc(1.5 * 1024 * 1024, 1);
    const response = await uploadPng(adminToken, { content: big });
    expect(response.status).toBe(422);
    expect((response.body as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');
  });

  it('lists by entity reference and reads by id', async () => {
    const list = await request(app)
      .get('/api/v1/platform/files')
      .query({ entityType: 'user', entityId: adminId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect((list.body as { data: { id: string }[] }).data.some((f) => f.id === fileId)).toBe(true);

    const single = await request(app)
      .get(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(single.status).toBe(200);
  });

  it('denies listing without file.view (authorization checks)', async () => {
    const response = await request(app)
      .get('/api/v1/platform/files')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(response.status).toBe(403);
  });

  it('downloads through the signed-URL abstraction and rejects tampering', async () => {
    const ticket = await request(app)
      .get(`/api/v1/platform/files/${fileId}/download`)
      .query({ mode: 'ticket' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ticket.status).toBe(200);
    const { url } = (ticket.body as { data: { url: string } }).data;
    expect(url).toContain(`/api/v1/platform/files/signed/${fileId}`);

    const signedPath = url.replace('http://localhost:3000', '');
    const download = await request(app).get(signedPath);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.headers['content-disposition']).toContain('attachment');

    const tampered = signedPath.replace(/s=[0-9a-f]{10}/, 's=0000000000');
    const rejected = await request(app).get(tampered);
    expect(rejected.status).toBe(403);
    expect((rejected.body as { error: { code: string } }).error.code).toBe(
      'FILE_SIGNATURE_INVALID',
    );

    // Redirect flavour (API Standards §7).
    const redirect = await request(app)
      .get(`/api/v1/platform/files/${fileId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(redirect.status).toBe(302);
  });

  it('enforces private/public visibility on downloads', async () => {
    // Bob has NO file permissions: private → 403.
    const denied = await request(app)
      .get(`/api/v1/platform/files/${fileId}/download`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(denied.status).toBe(403);

    // Make it public → any authenticated user may download (still audited).
    const current = await request(app)
      .get(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const version = (current.body as { data: { version: number } }).data.version;
    const patched = await request(app)
      .patch(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visibility: 'public', version });
    expect(patched.status).toBe(200);

    const allowed = await request(app)
      .get(`/api/v1/platform/files/${fileId}/download`)
      .query({ mode: 'ticket' })
      .set('Authorization', `Bearer ${bobToken}`);
    expect(allowed.status).toBe(200);
  });

  it('replaces content as a new version; history stays retrievable', async () => {
    const response = await request(app)
      .post(`/api/v1/platform/files/${fileId}/replace`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('png-bytes-v2'), {
        filename: 'id-front-v2.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
    const dto = (response.body as { data: { id: string; fileVersion: number; isLatest: boolean } })
      .data;
    expect(dto.fileVersion).toBe(2);
    expect(dto.isLatest).toBe(true);

    const versions = await request(app)
      .get(`/api/v1/platform/files/${dto.id}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(versions.status).toBe(200);
    const list = (versions.body as { data: { fileVersion: number; isLatest: boolean }[] }).data;
    expect(list).toHaveLength(2);
    expect(list.find((v) => v.fileVersion === 1)?.isLatest).toBe(false);
    fileId = dto.id;
  });

  it('archives and restores', async () => {
    const archived = await request(app)
      .post(`/api/v1/platform/files/${fileId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(archived.status).toBe(200);
    expect((archived.body as { data: { status: string } }).data.status).toBe('archived');

    // Archived files leave the default listing…
    const activeList = await request(app)
      .get('/api/v1/platform/files')
      .query({ entityType: 'user', entityId: adminId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((activeList.body as { data: { id: string }[] }).data.some((f) => f.id === fileId)).toBe(
      false,
    );
    // …and appear under status=archived.
    const archivedList = await request(app)
      .get('/api/v1/platform/files')
      .query({ status: 'archived' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      (archivedList.body as { data: { id: string }[] }).data.some((f) => f.id === fileId),
    ).toBe(true);

    const restored = await request(app)
      .post(`/api/v1/platform/files/${fileId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restored.status).toBe(200);
    expect((restored.body as { data: { status: string } }).data.status).toBe('active');
  });

  it('soft deletes (default) and permanently deletes (break-glass)', async () => {
    const softDeleted = await request(app)
      .delete(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(softDeleted.status).toBe(204);
    const gone = await request(app)
      .get(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);

    const fresh = await uploadPng(adminToken, { name: 'purge-me.png' });
    const freshId = (fresh.body as { data: { id: string } }).data.id;
    const purged = await request(app)
      .delete(`/api/v1/platform/files/${freshId}/permanent`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(purged.status).toBe(204);
    const purgedGone = await request(app)
      .get(`/api/v1/platform/files/${freshId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(purgedGone.status).toBe(404);

    // Bob may not purge (file.purge is break-glass).
    const denied = await request(app)
      .delete(`/api/v1/platform/files/${fileId}/permanent`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('extension points (virus scan / thumbnail) and events', () => {
  it('blocks an infected upload and emits VirusScanCompleted', async () => {
    const response = await uploadPng(adminToken, { name: 'eicar-sample.png' });
    expect(response.status).toBe(201);
    const infectedId = (response.body as { data: { id: string } }).data.id;

    await waitFor(() =>
      captured.some(
        (e) =>
          e.name === PlatformEvents.VirusScanCompleted &&
          (e.payload as { fileId: string; result: string }).fileId === infectedId &&
          (e.payload as { result: string }).result === 'blocked',
      ),
    );
    const scanned = await request(app)
      .get(`/api/v1/platform/files/${infectedId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((scanned.body as { data: { scanStatus: string } }).data.scanStatus).toBe('blocked');

    const download = await request(app)
      .get(`/api/v1/platform/files/${infectedId}/download`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(download.status).toBe(422);
    expect((download.body as { error: { code: string } }).error.code).toBe('FILE_BLOCKED');
  });

  it('emits ThumbnailCreated and FileUploaded through the reliable tier', async () => {
    await waitFor(() => captured.some((e) => e.name === PlatformEvents.ThumbnailCreated));
    expect(captured.some((e) => e.name === PlatformEvents.ThumbnailCreated)).toBe(true);
    expect(captured.some((e) => e.name === PlatformEvents.FileUploaded)).toBe(true);
    const upload = captured.find((e) => e.name === PlatformEvents.FileUploaded);
    expect(upload?.schemaVersion).toBe(1);
  });
});

describe('audit trail (ADR-012)', () => {
  it('records create, download, archive, restore and purge actions', async () => {
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'file', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    const actions = new Set(
      (audit.body as { data: { action: string }[] }).data.map((row) => row.action),
    );
    for (const expected of ['create', 'download', 'archive', 'restore', 'delete', 'purge']) {
      expect(actions.has(expected)).toBe(true);
    }
  });
});
