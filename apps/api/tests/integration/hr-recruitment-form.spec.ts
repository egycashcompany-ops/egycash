// The intake form's admin page, from a database that has never seen it.
//
// This suite exists because the feature shipped with no test at all and was broken from the first
// commit: the form document is created on first read, and the creation named its author with the
// string 'system'. `by` is written as an ObjectId, so the conversion threw, the read answered 500,
// and — because the throw happened BEFORE the insert — the document was never created. Every visit
// failed the same way, forever. The page showed "تعذّر التحميل / Unexpected error".
//
// So the first assertion here is the one nobody made: open it on a fresh install and see a form.
// The public path is exercised too, because it carried the identical placeholder one call deeper,
// in the context a candidate's submission runs under.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type RecruitmentFormDto,
  type RecruitmentFormSubmissionDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-recruitment-form-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string): Promise<string> => {
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

const getForm = async (): Promise<{ status: number; body: { data?: RecruitmentFormDto } }> => {
  const res = await request(app)
    .get('/api/v1/hr/recruitment-form')
    .set('Authorization', `Bearer ${adminToken}`);
  return { status: res.status, body: res.body as { data?: RecruitmentFormDto } };
};

const sourceId = async (key: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`${key} source not seeded`);
  return found.id;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
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
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@ecms.local', password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body as { data: { accessToken: string } }).data.accessToken;
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().quit?.();
  await replSet?.stop();
});

describe('the application form page', () => {
  it('loads on an install that has never opened it', async () => {
    // No fixture, no setup: this is the first request this database has ever seen for the form.
    const { status, body } = await getForm();
    expect(status).toBe(200);
    expect(body.data?.fields.length).toBeGreaterThan(0);
  });

  it('creates the form once, not once per visit', async () => {
    const first = await getForm();
    const second = await getForm();
    expect(second.status).toBe(200);
    expect(second.body.data?.id).toBe(first.body.data?.id);
  });

  it('lists every active source so each can be published, with or without a link yet', async () => {
    const { body } = await getForm();
    expect((body.data?.links ?? []).length).toBeGreaterThan(0);
    expect(body.data?.links.every((l) => l.token === null)).toBe(true);
  });

  it('records the internal source, which is what the applicant form asks for', async () => {
    const before = await getForm();
    const internal = await sourceId('internalHr');
    const res = await request(app)
      .patch('/api/v1/hr/recruitment-form')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ internalSourceId: internal, version: before.body.data?.version });
    expect(res.status).toBe(200);
    expect((res.body as { data: RecruitmentFormDto }).data.internalSourceId).toBe(internal);
  });
});

describe('the public application link', () => {
  it('takes a candidate submission from someone who is not signed in', async () => {
    // The submission runs under a context with no user at all. That is the same place the admin
    // read broke — an author has to be an id or nothing, never a word standing in for one.
    const source = await sourceId('walkIn');
    const published = await request(app)
      .post('/api/v1/hr/recruitment-form/links')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sourceId: source });
    expect(published.status).toBe(200);
    const link = (published.body as { data: RecruitmentFormDto }).data.links.find(
      (l) => l.sourceId === source,
    );
    expect(link?.token).not.toBeNull();

    const submit = await request(app)
      .post(`/api/v1/hr/public/apply/${link?.token ?? ''}`)
      .send({
        answers: {
          fullNameAr: 'أحمد محمد علي',
          primaryPhone: '01012345678',
        },
      });
    expect(submit.status).toBe(200);
    expect((submit.body as { data: RecruitmentFormSubmissionDto }).data.code).toMatch(/^APP-/);
  });
});
