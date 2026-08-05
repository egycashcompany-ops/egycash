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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const getSource = async (key: string): Promise<{ id: string; kind: string }> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string; kind: string }[] }).data.find(
    (s) => s.key === key,
  );
  if (found === undefined) throw new Error(`${key} source not seeded`);
  return { id: found.id, kind: found.kind };
};

const sourceId = async (key: string): Promise<string> => (await getSource(key)).id;

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
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  // The public endpoints are rate-limited per IP; every test here shares one.
  await getCache().delByPrefix('rl:');
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

  it('classifies a source by what it IS, and leaves that classification alone', async () => {
    // `kind` describes the platform, not whether it has a link. Pinned here because the pressure to
    // edit it comes from the wrong direction: a screen that wants to show something for one kind
    // and not another. Nothing in this service reads it, so a reclassification would silently
    // rewrite domain data to satisfy a UI condition.
    const res = await request(app)
      .get('/api/v1/hr/applicant-sources')
      .query({ pageSize: 50, sortBy: 'key', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (res.body as { data: { key: string; kind: string }[] }).data.map((s) => [s.key, s.kind]),
    );
    expect(byKey).toMatchObject({
      companyWebsite: 'publicForm',
      mobileApp: 'publicForm',
      linkedin: 'integration',
      wuzzuf: 'integration',
      forasna: 'integration',
      facebook: 'manual',
      internalHr: 'manual',
      referral: 'manual',
      walkIn: 'manual',
      agency: 'manual',
    });
  });

  // Kept last in this block: publishing links changes what the listing test above asserts.
  it('publishes a link for any active platform, whatever its kind says', async () => {
    // Three of these are `integration`, one is `manual`, two are `publicForm` — and all six get a
    // link, which is the whole point. Publishing asks one question: is the source active. An admin
    // never has to retype a platform to make its link appear.
    const kinds = new Set<string>();
    for (const key of ['companyWebsite', 'mobileApp', 'wuzzuf', 'linkedin', 'forasna', 'facebook']) {
      const source = await getSource(key);
      kinds.add(source.kind);
      const published = await request(app)
        .post('/api/v1/hr/recruitment-form/links')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sourceId: source.id });
      expect(published.status, `${key} (${source.kind}) could not be published to`).toBe(200);
      const link = (published.body as { data: RecruitmentFormDto }).data.links.find(
        (l) => l.sourceId === source.id,
      );
      // One form, one token per platform: the URL differs, what it opens does not.
      expect(link?.url, `${key} has no application URL`).toMatch(/\/apply\/[0-9a-f]{32}$/);
    }
    // If a future seed made them all one kind, the loop above would stop proving anything.
    expect([...kinds].sort()).toEqual(['integration', 'manual', 'publicForm']);
  });
});

// Every step a candidate's application goes through, each one its own assertion, so a green run
// names what was proven rather than hiding it behind one tick. This suite runs on REAL MongoDB —
// a downloaded server in CI, or MONGO_TEST_URI — which matters for the last step: the submission
// counter uses the positional `$` operator, and the stand-in database used for local browser work
// does not implement it.
describe('a candidate applies through a published link, signed in to nothing', () => {
  let token = '';
  let submitStatus = 0;
  let envelope: { success?: boolean; error?: unknown; data?: RecruitmentFormSubmissionDto } = {};
  let code = '';
  let publishedSource = '';

  it('publishes a link with a fresh, uncounted token', async () => {
    publishedSource = await sourceId('walkIn');
    const published = await request(app)
      .post('/api/v1/hr/recruitment-form/links')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sourceId: publishedSource });
    expect(published.status).toBe(200);
    const link = (published.body as { data: RecruitmentFormDto }).data.links.find(
      (l) => l.sourceId === publishedSource,
    );
    expect(link?.token).not.toBeNull();
    expect(link?.submissions).toBe(0);
    token = link?.token ?? '';
  });

  it('opens the public application page — HTTP 200, four questions', async () => {
    const publicForm = await request(app).get(`/api/v1/hr/public/apply/${token}`);
    expect(publicForm.status).toBe(200);
    expect((publicForm.body as { data: { fields: unknown[] } }).data.fields.length).toBe(4);
  });

  it('accepts the submission — HTTP 200', async () => {
    const submit = await request(app)
      .post(`/api/v1/hr/public/apply/${token}`)
      .send({
        // Every question the default form asks, all four required — a partial answer is a 400
        // about the missing ones, which is the form working, not the bug this suite guards.
        answers: {
          fullNameAr: 'أحمد محمد علي',
          nationalId: '28805152101234',
          primaryPhone: '01012345678',
          educationLevel: 'bachelor',
        },
      });
    submitStatus = submit.status;
    envelope = submit.body as typeof envelope;
    expect(submitStatus).toBe(200);
  });

  it('answers with a success envelope, not the error the page showed as "Unexpected error"', () => {
    expect(envelope.error).toBeUndefined();
    expect(envelope.success).toBe(true);
    code = envelope.data?.code ?? '';
    expect(code).toMatch(/^APP-\d{4}-\d+$/);
  });

  it('creates the applicant, findable by the code the candidate was given', async () => {
    const found = await request(app)
      .get('/api/v1/hr/applicants')
      .query({ search: code, pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    const rows = (found.body as { data: { code: string; fullNameAr: string; intakeChannel: string }[] }).data;
    expect(rows.map((r) => r.code)).toEqual([code]);
    expect(rows[0]?.fullNameAr).toBe('أحمد محمد علي');
    expect(rows[0]?.intakeChannel).toBe('web');
  });

  it('increments the link submission counter from 0 to 1', async () => {
    const after = await getForm();
    const counted = after.body.data?.links.find((l) => l.sourceId === publishedSource);
    expect(counted?.submissions).toBe(1);
  });
});
