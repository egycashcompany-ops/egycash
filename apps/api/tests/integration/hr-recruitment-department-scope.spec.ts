// F-REQ-1 — the department axis across recruitment, end to end.
//
// `department-scope-guards.spec.ts` settles the SHAPE by source: every collection stores the
// field, declares it, indexes it, and stamps it from the placement. It cannot settle whether a
// request is actually narrowed, because narrowing is a property of the whole path — the mirror
// written at registration, the field declared to the repository, the scope read off the token, and
// the filter `baseFilter` assembles from all three.
//
// So this file asserts the three things only a real database can show:
//
//   1. TWO DEPARTMENTS IN ONE BRANCH ARE SEPARATED. Branch scope cannot tell them apart; before
//      this axis existed, a department-scoped recruiter was answered with BOTH — silently, with
//      nothing failing, because an undeclared scope field widens to the whole organization.
//   2. THE CANDIDATE'S PIPELINE FOLLOWS THEM. Seeing the person and not their screening would be
//      a half-fix that looks like a whole one.
//   3. A REASSIGNMENT MOVES THE WHOLE SCOPE. After a transfer the new department sees them and
//      the old one does not — including the stage rows written before the move.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type ApplicantDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = '';
let readerToken = ''; // applicant.view at DEPARTMENT scope, standing in department A
let BRANCH = '';
let DEPARTMENT_A = '';
let DEPARTMENT_B = '';
let JOB_TITLE = '';
let APPLICANT_A = '';
let APPLICANT_B = '';
let APPLICANT_A_VERSION = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-req-scope-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/**
 * A READ's payload. A recruitment MUTATION answers with the I6 workflow envelope instead —
 * `{ data, workflow, timeline, counters }` under `body.data` — so registrations go through
 * `mutated` and only lists and details come through here.
 */
const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const mkUser = async (
  email: string,
  branchId: string | null,
  departmentId: string | null,
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (identifier: string): Promise<string> => {
  await getCache().delByPrefix('rl:');
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

let nid = 0;
const register = async (departmentId: string): Promise<ApplicantDto> => {
  const sources = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const sourceId = data<{ id: string; key: string }[]>(sources).find((s) => s.key === 'walkIn')?.id;
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      sourceId,
      intakeChannel: 'internal',
      identity: { nationalId: nextNationalId(), fullNameAr: 'مرشح النطاق', nationality: 'Egyptian' },
      contact: { primaryPhone: `0109900000${String(nid++)}` },
      placement: { jobTitleId: JOB_TITLE, departmentId, branchId: BRANCH },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return mutated<ApplicantDto>(res);
};

const listApplicants = (token: string) =>
  request(app)
    .get('/api/v1/hr/applicants')
    .query({ pageSize: 100 })
    .set('Authorization', `Bearer ${token}`);

const listScreenings = (token: string) =>
  request(app)
    .get('/api/v1/hr/screenings')
    .query({ pageSize: 100 })
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local', null, null);
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
  adminToken = await login('admin@ecms.local');

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'RSC-1', name: { ar: 'المركز', en: 'HQ' } });
  BRANCH = data<{ id: string }>(branch).id;

  // TWO DEPARTMENTS IN ONE BRANCH — the case branch scope cannot separate and this axis must.
  for (const [code, name] of [
    ['DEP-RSC-A', 'Ops A'],
    ['DEP-RSC-B', 'Ops B'],
  ] as const) {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: name, en: name }, branchId: BRANCH });
    const id = data<{ id: string }>(res).id;
    if (code === 'DEP-RSC-A') DEPARTMENT_A = id;
    else DEPARTMENT_B = id;
  }

  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-RSC', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  JOB_TITLE = data<{ id: string }>(title).id;

  const a = await register(DEPARTMENT_A);
  APPLICANT_A = a.id;
  APPLICANT_A_VERSION = a.version;
  APPLICANT_B = (await register(DEPARTMENT_B)).id;

  const role = await rbacService.ensureManagedRole(
    'rsc-department-reader',
    { en: 'Department reader', ar: 'قارئ الإدارة' },
    ['applicant.view', 'screening.view'],
  );
  const readerId = await mkUser('rsc-department@ecms.local', BRANCH, DEPARTMENT_A);
  await rbacService.ensureAssignment(readerId, String(role._id), 'department');
  readerToken = await login('rsc-department@ecms.local');
}, 600_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a department-scoped recruiter is answered with their own department', () => {
  it('the organization reader sees both candidates', async () => {
    const res = await listApplicants(adminToken);
    expect(res.status).toBe(200);
    const ids = data<ApplicantDto[]>(res).map((row) => row.id);
    expect(ids).toContain(APPLICANT_A);
    expect(ids).toContain(APPLICANT_B);
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. Before the axis was declared this returned BOTH — the
   * empty scope filter widened to the whole organization and `baseFilter` dropped it.
   */
  it('the department reader sees theirs and not the other department’s', async () => {
    const res = await listApplicants(readerToken);
    expect(res.status).toBe(200);
    const ids = data<ApplicantDto[]>(res).map((row) => row.id);
    expect(ids).toContain(APPLICANT_A);
    expect(ids).not.toContain(APPLICANT_B);
  });

  /** Reading one by id is the same question asked a different way, and must answer the same. */
  it('and cannot open the other department’s candidate by id', async () => {
    const mine = await request(app)
      .get(`/api/v1/hr/applicants/${APPLICANT_A}`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(mine.status).toBe(200);
    const theirs = await request(app)
      .get(`/api/v1/hr/applicants/${APPLICANT_B}`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(theirs.status).toBe(404);
  });

  /**
   * The pipeline follows the person. Registration materializes a screening row (I11); it carries
   * the same axis, so the reader sees their own candidate's screening and not the other's.
   */
  it('the candidate’s stage rows carry the same axis', async () => {
    const all = data<{ applicantId: string }[]>(await listScreenings(adminToken));
    expect(all.some((row) => row.applicantId === APPLICANT_A)).toBe(true);
    expect(all.some((row) => row.applicantId === APPLICANT_B)).toBe(true);

    const mine = data<{ applicantId: string }[]>(await listScreenings(readerToken));
    expect(mine.some((row) => row.applicantId === APPLICANT_A)).toBe(true);
    expect(mine.some((row) => row.applicantId === APPLICANT_B)).toBe(false);
  });
});

describe('a reassignment moves the whole scope, not half of it', () => {
  it('moves the candidate AND their stage rows to the new department', async () => {
    const moved = await request(app)
      .post(`/api/v1/hr/applicants/${APPLICANT_A}/reassign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        placement: { jobTitleId: JOB_TITLE, departmentId: DEPARTMENT_B, branchId: BRANCH },
        reason: 'the seat moved to Ops B',
        source: 'manual',
        version: APPLICANT_A_VERSION,
      });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    // Department A read them a moment ago. They are not theirs any more — and the screening row
    // written before the move went with them, which is the half a per-axis sync would have missed.
    const applicants = data<ApplicantDto[]>(await listApplicants(readerToken)).map((r) => r.id);
    expect(applicants).not.toContain(APPLICANT_A);
    const screenings = data<{ applicantId: string }[]>(await listScreenings(readerToken));
    expect(screenings.some((row) => row.applicantId === APPLICANT_A)).toBe(false);

    // And the organization reader still sees everything — narrowing one scope widens no other.
    const asAdmin = data<ApplicantDto[]>(await listApplicants(adminToken)).map((r) => r.id);
    expect(asAdmin).toContain(APPLICANT_A);
    expect(asAdmin).toContain(APPLICANT_B);
  });
});
