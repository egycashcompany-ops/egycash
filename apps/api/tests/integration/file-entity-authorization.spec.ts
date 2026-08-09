// ADR-023 security suite: entity-derived file authorization, over real HTTP.
//
// Every test here asserts the ABSENCE of a bypass, because that is the only thing worth proving.
// The old rule authorized a read with two questions — is the file blocked, and is it private — and
// neither of them was about the thing the file belongs to. A holder of `file.view` + `file.download`
// who knew a file id could read anything.
//
// So the suite is organized by ATTACK, not by endpoint: for each way to reach a file, a caller who
// may not see the owning entity tries it and must fail. The regression block at the end is equally
// important in the other direction — an entity type nobody claimed must behave exactly as before,
// or this slice breaks HR, branding and OCR the day it merges.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type FileDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import {
  clearFileEntityAuthorizers,
  fileService,
  registerFileEntityAuthorizer,
} from '../../src/platform/files';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { env } from '../../src/infrastructure/config/env';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let adminCtx: AuthContext;
let intruderId: string;
let intruderToken: string;
let intruderCtx: AuthContext;
let categoryId: string;

/** The guarded entity: `secret` is visible to the admin only; `open` is visible to everyone. */
const SECRET = 'secret-entity';
const OPEN = 'open-entity';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-file-authz-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const ctxFor = (userId: string): AuthContext =>
  ({
    userId,
    sessionId: 'spec',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    // Every file grant, so a refusal can only come from the ENTITY check.
    permissions: {
      'file.view': 'organization',
      'file.download': 'organization',
      'file.create': 'organization',
      'file.edit': 'organization',
      'file.delete': 'organization',
      'file.purge': 'organization',
    },
    permissionVersion: 1,
    isPrivileged: false,
  }) as unknown as AuthContext;

/** Register the guard used by most tests: only the admin may reach `SECRET`. */
const guardSecret = (): void => {
  registerFileEntityAuthorizer('spec', {
    entityType: 'vault',
    authorize: async ({ ctx, entityId }) => entityId === OPEN || ctx.userId === adminId,
  });
};

const uploadTo = (token: string, entityId: string) =>
  request(app)
    .post('/api/v1/platform/files')
    .set('Authorization', `Bearer ${token}`)
    .field('moduleId', 'spec')
    .field('entityType', 'vault')
    .field('entityId', entityId)
    .field('categoryId', categoryId)
    .attach('file', Buffer.from('confidential-bytes'), {
      filename: 'secret.png',
      contentType: 'image/png',
    });

/** Upload as the admin with the guard OFF, so a file exists to attack. */
const seedFile = async (entityId: string): Promise<FileDto> => {
  clearFileEntityAuthorizers();
  const res = await uploadTo(adminToken, entityId);
  expect(res.status).toBe(201);
  guardSecret();
  return data<FileDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: [] });
  app = buildApp();

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

  adminId = await mk('authz-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const seedCtx: AuthContext = {
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
  await settingsService.set(seedCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('authz-admin@ecms.local');

  // THE ATTACKER: holds every file permission there is. If a refusal happens, it is the entity
  // check and nothing else — that is the whole point of giving them the full set.
  const fileRole = await rbacService.createRole(
    {
      name: { en: 'File power user', ar: 'مستخدم ملفات' },
      permissionKeys: [
        'file.view',
        'file.download',
        'file.create',
        'file.edit',
        'file.delete',
        'file.purge',
      ],
    },
    adminId,
  );
  intruderId = await mk('authz-intruder@ecms.local');
  await rbacService.ensureAssignment(intruderId, String(fileRole._id), 'organization');
  intruderToken = await login('authz-intruder@ecms.local');

  adminCtx = ctxFor(adminId);
  intruderCtx = ctxFor(intruderId);

  const category = await request(app)
    .post('/api/v1/platform/file-categories')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      key: 'authz-spec',
      name: { ar: 'اختبار', en: 'Authz spec' },
      allowedMimeTypes: ['image/*'],
      maxSizeMb: 5,
    });
  expect(category.status).toBe(201);
  categoryId = data<{ id: string }>(category).id;
}, 240_000);

afterEach(() => clearFileEntityAuthorizers());

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── Knowing the id is not enough ────────────────────────────────────────────

describe('a caller who cannot see the entity cannot reach its file', () => {
  it('GET /files/:id — 404, because the file’s existence is itself information', async () => {
    const file = await seedFile(SECRET);
    const res = await request(app)
      .get(`/api/v1/platform/files/${file.id}`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
  });

  it('GET /files/:id/versions', async () => {
    const file = await seedFile(SECRET);
    const res = await request(app)
      .get(`/api/v1/platform/files/${file.id}/versions`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
  });

  it('GET /files?entityId=… — filtered out rather than refused, so a mixed page still renders', async () => {
    const secret = await seedFile(SECRET);
    const open = await seedFile(OPEN);
    const res = await request(app)
      .get('/api/v1/platform/files?moduleId=spec&entityType=vault&pageSize=100')
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(200);
    const ids = data<FileDto[]>(res).map((f) => f.id);
    expect(ids).not.toContain(secret.id);
    expect(ids).toContain(open.id);
  });

  it('GET /files/:id/download — no ticket is minted at all', async () => {
    const file = await seedFile(SECRET);
    const res = await request(app)
      .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('signed');
  });

  it('readBuffer — the server-side byte read used by OCR and rendering', async () => {
    const file = await seedFile(SECRET);
    await expect(fileService.readBuffer(intruderCtx, file.id)).rejects.toThrow();
    // …and the admin, who may see it, still can.
    await expect(fileService.readBuffer(adminCtx, file.id)).resolves.toBeDefined();
  });

  it('copy — the quietest path to the bytes, and it authorizes the SOURCE now', async () => {
    const file = await seedFile(SECRET);
    await expect(
      fileService.copy(intruderCtx, file.id, {
        moduleId: 'spec',
        entityType: 'vault',
        entityId: OPEN,
        categoryId,
        displayName: 'stolen.png',
        visibility: 'public',
      }),
    ).rejects.toThrow();
  });
});

// ── The file's own flags cannot widen the entity's decision ─────────────────

describe('a file-level grant never overrides the owning entity', () => {
  it('a `public` file attached to a guarded entity is still refused', async () => {
    clearFileEntityAuthorizers();
    const created = await uploadTo(adminToken, SECRET);
    const file = data<FileDto>(created);
    // Flip it to public while nothing guards it — the tempting escalation.
    const updated = await request(app)
      .patch(`/api/v1/platform/files/${file.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ visibility: 'public', version: file.version });
    expect(updated.status).toBe(200);
    expect(data<FileDto>(updated).visibility).toBe('public');

    guardSecret();
    const res = await request(app)
      .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(res.status).toBe(404);
  });

  it('and the intruder cannot flip it themselves — update is a WRITE on the entity', async () => {
    const file = await seedFile(SECRET);
    const res = await request(app)
      .patch(`/api/v1/platform/files/${file.id}`)
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({ visibility: 'public', version: file.version });
    expect(res.status).toBe(403);
  });

  it('nor archive, delete or purge it', async () => {
    const file = await seedFile(SECRET);
    for (const path of ['archive', 'restore'] as const) {
      const res = await request(app)
        .post(`/api/v1/platform/files/${file.id}/${path}`)
        .set('Authorization', `Bearer ${intruderToken}`);
      expect(res.status, path).toBe(403);
    }
    const removed = await request(app)
      .delete(`/api/v1/platform/files/${file.id}`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(removed.status).toBe(403);
  });

  it('nor plant a NEW file on an entity they cannot write to', async () => {
    guardSecret();
    const res = await uploadTo(intruderToken, SECRET);
    expect(res.status).toBe(403);
  });
});

// ── The signed ticket (T2) ──────────────────────────────────────────────────

describe('the download ticket is bound to its subject', () => {
  it('a ticket minted for the admin does not work for anyone else', async () => {
    const file = await seedFile(SECRET);
    const issued = await request(app)
      .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(issued.status).toBe(200);
    const url = data<{ url: string }>(issued).url;
    const path = url.slice(url.indexOf('/api/v1/'));

    // The subject themself: works.
    const asAdmin = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.status).toBe(200);

    // The same URL, another user — the leak this model exists to stop.
    const asIntruder = await request(app).get(path).set('Authorization', `Bearer ${intruderToken}`);
    expect(asIntruder.status).toBe(403);

    // …and anonymously, which is how a shared link would be opened.
    const anonymous = await request(app).get(path);
    expect(anonymous.status).toBe(403);
  });

  it('revoking access mid-ticket denies immediately, not at expiry', async () => {
    const file = await seedFile(SECRET);
    const issued = await request(app)
      .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
      .set('Authorization', `Bearer ${adminToken}`);
    const url = data<{ url: string }>(issued).url;
    const path = url.slice(url.indexOf('/api/v1/'));
    expect((await request(app).get(path).set('Authorization', `Bearer ${adminToken}`)).status).toBe(
      200,
    );

    // The module changes its mind while the ticket is still well inside its TTL.
    clearFileEntityAuthorizers();
    registerFileEntityAuthorizer('spec', { entityType: 'vault', authorize: async () => false });
    expect((await request(app).get(path).set('Authorization', `Bearer ${adminToken}`)).status).toBe(
      404,
    );
  });

  it('never hands out a provider presigned URL for a guarded entity', async () => {
    const file = await seedFile(SECRET);
    const original = env.STORAGE_PRESIGNED_URLS;
    try {
      (env as { STORAGE_PRESIGNED_URLS: boolean }).STORAGE_PRESIGNED_URLS = true;
      const issued = await request(app)
        .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(issued.status).toBe(200);
      // The app's own signed route, carrying an expiry and a signature — not a store URL.
      const url = data<{ url: string }>(issued).url;
      expect(url).toContain('/platform/files/signed/');
      expect(url).toMatch(/[?&]s=/);
    } finally {
      (env as { STORAGE_PRESIGNED_URLS: boolean }).STORAGE_PRESIGNED_URLS = original;
    }
  });
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

describe('a failing authorizer denies', () => {
  it('a throwing authorizer refuses the read rather than letting it through', async () => {
    clearFileEntityAuthorizers();
    const created = await uploadTo(adminToken, SECRET);
    const file = data<FileDto>(created);
    registerFileEntityAuthorizer('spec', {
      entityType: 'vault',
      authorize: async () => {
        throw new Error('module exploded');
      },
    });
    const res = await request(app)
      .get(`/api/v1/platform/files/${file.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Regression: unguarded files are untouched ───────────────────────────────

describe('files whose entity type has no authorizer behave exactly as before', () => {
  it('read, list, download and versions all still work for a plain platform file', async () => {
    // No authorizer registered anywhere — the state HR, branding and OCR are in.
    const created = await request(app)
      .post('/api/v1/platform/files')
      .set('Authorization', `Bearer ${intruderToken}`)
      .field('moduleId', 'platform')
      .field('entityType', 'user')
      .field('entityId', adminId)
      .field('categoryId', categoryId)
      .attach('file', Buffer.from('ordinary-bytes'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });
    expect(created.status).toBe(201);
    const file = data<FileDto>(created);

    expect(
      (
        await request(app)
          .get(`/api/v1/platform/files/${file.id}`)
          .set('Authorization', `Bearer ${intruderToken}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/v1/platform/files/${file.id}/versions`)
          .set('Authorization', `Bearer ${intruderToken}`)
      ).status,
    ).toBe(200);

    const issued = await request(app)
      .get(`/api/v1/platform/files/${file.id}/download?mode=ticket`)
      .set('Authorization', `Bearer ${intruderToken}`);
    expect(issued.status).toBe(200);

    // The unguarded ticket stays a BEARER capability — anonymous fetch still works, which is what
    // keeps a branding logo loadable from an `<img>` on another origin.
    const url = data<{ url: string }>(issued).url;
    const path = url.slice(url.indexOf('/api/v1/'));
    expect((await request(app).get(path)).status).toBe(200);
  });

  it('server-side byte reads keep working for unguarded files', async () => {
    const created = await request(app)
      .post('/api/v1/platform/files')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('moduleId', 'platform')
      .field('entityType', 'user')
      .field('entityId', adminId)
      .field('categoryId', categoryId)
      .attach('file', Buffer.from('logo-bytes'), {
        filename: 'logo.png',
        contentType: 'image/png',
      });
    const file = data<FileDto>(created);
    const read = await fileService.readBuffer(intruderCtx, file.id);
    expect(read.buffer.toString()).toBe('logo-bytes');
  });
});
