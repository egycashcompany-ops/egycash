// Stage 7 — HR / Recruitment: Electronic Employee File integration suite. Drives an applicant
// through the full pipeline to a hired employee with COMPLETED hiring documents, then assembles
// the electronic file: the completion gate, the linked recruitment history, the initial Employee
// Timeline built from the milestones, one-file-per-employee, the assembly notification, audit,
// permissions, and appending notes to the timeline.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EmployeeDto,
  type EmployeeFileDto,
  type HiringDocumentsDto,
  type InterviewDto,
  type JobOfferDto,
  type ScreeningDto,
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
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
const JOB_TITLE_ID = '64b1f0cccccccccccccccc01';
const DEPARTMENT_ID = '64b1f0cccccccccccccccc02';
const BRANCH_ID = '64b1f0cccccccccccccccc03';
const FUTURE = '2027-03-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
const REQUIRED_KEYS = ['nationalIdCopy', 'signedContract', 'personalPhoto'];
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let aliceToken: string;
let interviewerId: string; // interview panel + hiring manager
let interviewerToken: string;
let phoneCounter = 60_000_000;

const pdf = (): Buffer => Buffer.from('%PDF-1.4 hiring document');

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-empfile-test-${Date.now()}`;
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
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

const idByKey = async (path: string, key: string): Promise<string> => {
  const res = await request(app).get(`/api/v1/hr/${path}`).query({ pageSize: 50 }).set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find((s) => s.key === key);
  if (found === undefined) throw new Error(`${path}/${key} not seeded`);
  return found.id;
};

/** Register → screen → both interviews → offer accepted → employee. */
const hiredEmployee = async (): Promise<EmployeeDto> => {
  const sourceId = await idByKey('applicant-sources', 'internalHr');
  const applicant = (
    await request(app)
      .post('/api/v1/hr/applicants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        jobRequisitionId: REQUISITION_ID,
        sourceId,
        intakeChannel: 'internal',
        identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
      })
  ).body.data as ApplicantDto;

  const screening = (
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId: applicant.id })
  ).body.data as ScreeningDto;
  await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });

  for (const key of ['firstInterview', 'secondInterview']) {
    const stageId = await idByKey('interview-stages', key);
    const interview = (
      await request(app)
        .post('/api/v1/hr/interviews')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ applicantId: applicant.id, stageId, scheduledAt: FUTURE, interviewerIds: [interviewerId] })
    ).body.data as InterviewDto;
    const submitted = await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
      .set('Authorization', `Bearer ${interviewerToken}`)
      .send({ recommendation: 'recommend', version: interview.version });
    await request(app)
      .post(`/api/v1/hr/interviews/${interview.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'passed', version: (submitted.body.data as InterviewDto).version });
  }

  const draft = (
    await request(app)
      .post('/api/v1/hr/job-offers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        applicantId: applicant.id,
        terms: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          managerId: interviewerId,
          employmentType: 'fullTime',
          salary: { amount: 15000, currency: 'EGP' },
          allowances: [],
          benefits: [],
          probationMonths: 3,
          startDate: START_DATE,
          validUntil: FUTURE,
        },
      })
  ).body.data as JobOfferDto;
  const sent = await request(app).post(`/api/v1/hr/job-offers/${draft.id}/send`).set('Authorization', `Bearer ${adminToken}`).send({ version: draft.version });
  const accepted = await request(app)
    .post(`/api/v1/hr/job-offers/${draft.id}/accept`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: (sent.body.data as JobOfferDto).version });
  const emp = await request(app)
    .post('/api/v1/hr/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ jobOfferId: (accepted.body.data as JobOfferDto).id });
  expect(emp.status).toBe(201);
  return emp.body.data as EmployeeDto;
};

const uploadDoc = (hdId: string, typeId: string, version: number) =>
  request(app)
    .post(`/api/v1/hr/hiring-documents/${hdId}/documents`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('typeId', typeId)
    .field('version', String(version))
    .attach('file', pdf(), { filename: 'doc.pdf', contentType: 'application/pdf' });

/** Open the hiring-documents set, upload every required document, and complete it. */
const completedHiringDocs = async (employeeId: string): Promise<HiringDocumentsDto> => {
  const hd = (
    await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId })
  ).body.data as HiringDocumentsDto;
  let version = hd.version;
  for (const key of REQUIRED_KEYS) {
    const typeId = await idByKey('hiring-document-types', key);
    version = ((await uploadDoc(hd.id, typeId, version)).body.data as HiringDocumentsDto).version;
  }
  const completed = await request(app)
    .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version });
  expect(completed.status).toBe(200);
  return completed.body.data as HiringDocumentsDto;
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
  await mkUser('alice@ecms.local');

  const panelRole = await rbacService.createRole(
    { name: { en: 'Interviewer', ar: 'مُحاور' }, permissionKeys: ['interview.view', 'interview.evaluate'] },
    adminId,
  );
  interviewerId = await mkUser('interviewer@ecms.local');
  await rbacService.ensureAssignment(interviewerId, String(panelRole._id), 'organization');

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });

  adminToken = await login('admin@ecms.local');
  aliceToken = await login('alice@ecms.local');
  interviewerToken = await login('interviewer@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('electronic employee file — assembly gate', () => {
  it('refuses assembly until hiring documents are completed', async () => {
    const emp = await hiredEmployee();
    // No hiring-documents set at all.
    const early = await request(app)
      .post('/api/v1/hr/employee-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(early.status).toBe(422);

    // Set exists but is still in progress.
    await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId: emp.id });
    const stillOpen = await request(app)
      .post('/api/v1/hr/employee-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(stillOpen.status).toBe(422);
  });

  it('denies a user without employeeFile.create and requires auth', async () => {
    const emp = await hiredEmployee();
    await completedHiringDocs(emp.id);
    const denied = await request(app)
      .post('/api/v1/hr/employee-files')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ employeeId: emp.id });
    expect(denied.status).toBe(403);
    const anon = await request(app).get('/api/v1/hr/employee-files');
    expect(anon.status).toBe(401);
  });
});

describe('electronic employee file — assembly, links & timeline', () => {
  it('assembles the file: links all history and builds the initial Employee Timeline', async () => {
    const emp = await hiredEmployee();
    const hd = await completedHiringDocs(emp.id);

    const res = await request(app)
      .post('/api/v1/hr/employee-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(res.status).toBe(201);
    const file = res.body.data as EmployeeFileDto;

    expect(file.status).toBe('active');
    expect(file.employeeId).toBe(emp.id);
    expect(file.employeeCode).toBe(emp.code);
    expect(file.applicantId).toBe(emp.applicantId);

    // Links cover the whole recruitment history.
    expect(file.links.applicantId).toBe(emp.applicantId);
    expect(file.links.jobRequisitionId).toBe(emp.jobRequisitionId);
    expect(file.links.jobOfferId).toBe(emp.jobOfferId);
    expect(file.links.hiringDocumentsId).toBe(hd.id);
    expect(file.links.screeningId).not.toBeNull();
    expect(file.links.interviewIds).toHaveLength(2);

    // The initial Employee Timeline captures every milestone, oldest first.
    const types = file.timeline.map((t) => t.type);
    expect(types).toEqual([
      'applicantRegistered',
      'screeningAccepted',
      'interviewPassed',
      'interviewPassed',
      'offerAccepted',
      'employeeCreated',
      'hiringDocumentsCompleted',
      'fileOpened',
    ]);
    // Timeline is chronologically ordered.
    const ats = file.timeline.map((t) => new Date(t.at).getTime());
    expect([...ats]).toEqual([...ats].sort((a, b) => a - b));

    // Assembly is audited and notifies the reporting manager (interviewer).
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'employeeFile', pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'create')).toBe(true);
    const inbox = await request(app).get('/api/v1/platform/notifications').set('Authorization', `Bearer ${interviewerToken}`);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
  });

  it('is one-file-per-employee, listable, and readable by id', async () => {
    const emp = await hiredEmployee();
    await completedHiringDocs(emp.id);
    const file = (
      await request(app).post('/api/v1/hr/employee-files').set('Authorization', `Bearer ${adminToken}`).send({ employeeId: emp.id })
    ).body.data as EmployeeFileDto;

    const dup = await request(app)
      .post('/api/v1/hr/employee-files')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id });
    expect(dup.status).toBe(409);

    const byId = await request(app).get(`/api/v1/hr/employee-files/${file.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(byId.status).toBe(200);
    expect((byId.body.data as EmployeeFileDto).employeeCode).toBe(emp.code);

    const listed = await request(app)
      .get('/api/v1/hr/employee-files')
      .query({ employeeId: emp.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect((listed.body as { data: EmployeeFileDto[] }).data.some((f) => f.id === file.id)).toBe(true);
  });
});

describe('electronic employee file — timeline notes', () => {
  it('appends a note to the Employee Timeline (optimistic-concurrency guarded)', async () => {
    const emp = await hiredEmployee();
    await completedHiringDocs(emp.id);
    const file = (
      await request(app).post('/api/v1/hr/employee-files').set('Authorization', `Bearer ${adminToken}`).send({ employeeId: emp.id })
    ).body.data as EmployeeFileDto;
    const before = file.timeline.length;

    const noted = await request(app)
      .post(`/api/v1/hr/employee-files/${file.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Signed handbook received', version: file.version });
    expect(noted.status).toBe(200);
    const updated = noted.body.data as EmployeeFileDto;
    expect(updated.timeline).toHaveLength(before + 1);
    const last = updated.timeline[updated.timeline.length - 1];
    expect(last?.type).toBe('note');
    expect(last?.detail).toBe('Signed handbook received');
    expect(last?.by).not.toBeNull();

    // A stale version is rejected.
    const stale = await request(app)
      .post(`/api/v1/hr/employee-files/${file.id}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'second', version: file.version });
    expect(stale.status).toBe(409);
  });
});
