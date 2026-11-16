// «مسح نهائي» for a candidate — erasing somebody from the recruitment cycle, end to end.
//
// The sibling of `hr-employee-purge.spec.ts`, and it guards one rule that has no counterpart
// there: A CANDIDATE WHO WAS HIRED CANNOT BE ERASED FROM THE PIPELINE. They are an employee now,
// `hr_employees.applicantId` still points back at this record, and the applicant rule purges job
// offers — so going ahead would delete the offer that records a live hiring and leave the employee
// pointing at an applicant that is gone. The refusal names the employee instead.
//
// The rest is what the feature claims: the candidate goes, every stage they reached goes with
// them, a wrong code does nothing at all, and the audit row outlives them.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type ApplicantDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let ADMIN_ID = '';
let SOURCE_ID = '';

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const db = (): mongoose.mongo.Db => {
  const c = mongoose.connection.db;
  if (c === undefined) throw new Error('no connection');
  return c;
};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-applicant-purge-${String(Date.now())}`;
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

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const accountWith = async (email: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    ADMIN_ID,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

let serial = 100;
const nationalId = (): string => `2900307011${String(serial++).padStart(3, '0')}1`;

const register = async (fullNameAr: string): Promise<ApplicantDto> => {
  const res = await asAdmin('post', '/hr/applicants').send({
    sourceId: SOURCE_ID,
    intakeChannel: 'internal',
    identity: { fullNameAr, nationality: 'Egyptian', nationalId: nationalId() },
    contact: { primaryPhone: `0104${String(serial).padStart(7, '0')}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  // Registration is a workflow act (I6): the body is an envelope and the candidate is inside it.
  return mutated<ApplicantDto>(res);
};

const purge = (token: string, id: string, confirmCode: string) =>
  request(app)
    .delete(`/api/v1/hr/applicants/${id}/purge`)
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmCode });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  ADMIN_ID = await mkUser('applicant-purge-admin@ecms.local');
  await rbacService.ensureAssignment(ADMIN_ID, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: ADMIN_ID,
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
  adminToken = await login('applicant-purge-admin@ecms.local');

  // The module seeds its ten sources at boot; creating an eleventh would just collide.
  const sources = data<{ id: string; key: string }[]>(
    await asAdmin('get', '/hr/applicant-sources').query({ pageSize: 50 }),
  );
  const internal = sources.find((x) => x.key === 'internalHr');
  if (internal === undefined) throw new Error('internalHr source not seeded');
  SOURCE_ID = internal.id;
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«مسح نهائي» — permanently deleting an applicant', () => {
  it('refuses every other authority over candidates', async () => {
    const applicant = await register('رافض الصلاحية');
    // Everything HR does to a candidate, including the SOFT delete, short of erasing them.
    const hr = await accountWith('applicant-purge-hr@ecms.local', [
      'applicant.view',
      'applicant.create',
      'applicant.edit',
      'applicant.delete',
      'applicant.export',
      'applicant.verifyIdentity',
      'applicant.moveToOffer',
      'applicant.returnToStage',
    ]);
    expect((await purge(hr, applicant.id, applicant.code)).status).toBe(403);
    expect((await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe(200);
  });

  it('refuses a code that is not this candidate’s, and deletes nothing', async () => {
    const applicant = await register('كود خاطئ');
    const res = await purge(adminToken, applicant.id, 'APP-0000-000000');
    expect(res.status).toBe(400);
    expect((await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe(200);
  });

  it('erases the candidate and the screening that registration opened for them', async () => {
    const applicant = await register('محمد المحذوف');
    const id = new mongoose.Types.ObjectId(applicant.id);
    // Registration materializes a screening row (I11), so there is a stage to lose without
    // inventing one.
    expect(await db().collection('hr_screenings').countDocuments({ applicantId: id })).toBe(1);

    const res = await purge(adminToken, applicant.id, applicant.code);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe(404);
    expect(await db().collection('hr_screenings').countDocuments({ applicantId: id })).toBe(0);
    expect(await db().collection('hr_recruitment_timeline').countDocuments({ applicantId: id })).toBe(0);

    const report = data<{ rowsDeleted: number }>(res);
    expect(report.rowsDeleted).toBeGreaterThanOrEqual(2);
  });

  it('refuses a candidate who was hired, and names the employee instead', async () => {
    const applicant = await register('متقدم معيَّن');
    // The fact that makes them un-erasable is an EMPLOYEE row pointing back here, not a status
    // somebody could correct by hand — so that is what the fixture creates.
    await db()
      .collection('hr_employees')
      .insertOne({
        applicantId: new mongoose.Types.ObjectId(applicant.id),
        code: '0100099',
        isDeleted: false,
      });

    const res = await purge(adminToken, applicant.id, applicant.code);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('0100099');
    // And nothing was taken on the way to refusing.
    expect((await asAdmin('get', `/hr/applicants/${applicant.id}`)).status).toBe(200);
  });

  it('leaves behind the audit row that says it happened', async () => {
    const applicant = await register('أثر التدقيق');
    expect((await purge(adminToken, applicant.id, applicant.code)).status).toBe(200);
    const rows = await db()
      .collection('audit_logs')
      .find({ 'entityRef.entityType': 'applicant', 'entityRef.entityId': applicant.id })
      .toArray();
    expect(rows.some((r) => r['action'] === 'purge')).toBe(true);
  });
});
