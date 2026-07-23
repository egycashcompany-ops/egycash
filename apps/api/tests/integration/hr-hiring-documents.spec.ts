// Stage 6 — HR / Recruitment: Hiring Documents integration suite. Drives an applicant through
// the full pipeline to a hired employee, then exercises hiring documents: the admin document-
// type catalog, opening the set, PDF uploads (with non-PDF rejection), the required-completion
// gate, replacement with version history (original preserved), immutability after completion
// except through the versioning workflow, the completion notification, and audit.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EmployeeDto,
  type EvaluationDto,
  type HiringDocumentTypeDto,
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
let BRANCH_ID = ''; // real branch created in beforeAll (employee code is BranchCode-based)
const FUTURE = '2027-03-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
const REQUIRED_KEYS = [
  'employmentContract',
  'employmentAcceptance',
  'socialStatusForm',
  'relativesDeclaration',
  'jobDescription',
];
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let aliceToken: string;
let interviewerId: string; // interview panel + hiring manager
let interviewerToken: string;
let phoneCounter = 50_000_000;

const pdf = (): Buffer => Buffer.from('%PDF-1.4 hiring document');

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-hiredocs-test-${Date.now()}`;
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

  // Clear the required evaluation phases (offer gate) before drafting the offer.
  for (const key of ['securityCheck', 'medicalExam']) {
    const phaseId = await idByKey('evaluation-phases', key);
    const opened = await request(app)
      .post('/api/v1/hr/evaluations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId: applicant.id, phaseId });
    const evaluation = opened.body.data as EvaluationDto;
    await request(app)
      .post(`/api/v1/hr/evaluations/${evaluation.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', version: evaluation.version });
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

const createSet = async (employeeId: string): Promise<HiringDocumentsDto> => {
  const res = await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId });
  expect(res.status).toBe(201);
  return res.body.data as HiringDocumentsDto;
};

const uploadDoc = (hdId: string, typeId: string, version: number, filename = 'doc.pdf', contentType = 'application/pdf') =>
  request(app)
    .post(`/api/v1/hr/hiring-documents/${hdId}/documents`)
    .set('Authorization', `Bearer ${adminToken}`)
    .field('typeId', typeId)
    .field('version', String(version))
    .attach('file', pdf(), { filename, contentType });

/** Upload all three required documents; returns the resulting aggregate version. */
const uploadAllRequired = async (hd: HiringDocumentsDto): Promise<number> => {
  let version = hd.version;
  for (const key of REQUIRED_KEYS) {
    const typeId = await idByKey('hiring-document-types', key);
    const res = await uploadDoc(hd.id, typeId, version);
    expect(res.status).toBe(200);
    version = (res.body.data as HiringDocumentsDto).version;
  }
  return version;
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
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });

  adminToken = await login('admin@ecms.local');
  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'الرئيسي', en: 'HQ' } });
  BRANCH_ID = (branchRes.body as { data: { id: string } }).data.id;
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

describe('hiring documents — types catalog & permissions', () => {
  it('seeds default document types (required + optional) and denies alice', async () => {
    const res = await request(app).get('/api/v1/hr/hiring-document-types').query({ pageSize: 50 }).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const types = (res.body as { data: HiringDocumentTypeDto[] }).data;
    const required = types.filter((t) => t.required).map((t) => t.key);
    expect(required).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    expect(types.some((t) => !t.required)).toBe(true);

    const denied = await request(app).get('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);

    const adminCreate = await request(app)
      .post('/api/v1/hr/hiring-document-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: 'medicalCheck', name: { ar: 'الكشف الطبي', en: 'Medical check' }, required: false });
    expect(adminCreate.status).toBe(201);
    const aliceCreate = await request(app)
      .post('/api/v1/hr/hiring-document-types')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ key: 'x', name: { ar: 'x', en: 'x' }, required: false });
    expect(aliceCreate.status).toBe(403);
  });
});

describe('hiring documents — create, upload, completion gate', () => {
  it('opens a set (one per employee) listing the missing required documents', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    expect(hd.status).toBe('inProgress');
    expect(hd.employeeCode).toBe(emp.code);
    expect(hd.missingRequired).toEqual(expect.arrayContaining(REQUIRED_KEYS));
    expect((await request(app).post('/api/v1/hr/hiring-documents').set('Authorization', `Bearer ${adminToken}`).send({ employeeId: emp.id })).status).toBe(409);
  });

  it('uploads a PDF (metadata + version tracked) and rejects a non-PDF', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');

    const ok = await uploadDoc(hd.id, typeId, hd.version, 'id.pdf');
    expect(ok.status).toBe(200);
    const dto = ok.body.data as HiringDocumentsDto;
    expect(dto.documents).toHaveLength(1);
    expect(dto.documents[0]).toMatchObject({ typeKey: 'employmentContract', fileVersion: 1, fileName: 'id.pdf' });
    expect(dto.missingRequired).not.toContain('employmentContract');

    // A duplicate upload for the same type must go through replace.
    expect((await uploadDoc(hd.id, typeId, dto.version)).status).toBe(409);

    // Non-PDF is rejected by the file category.
    const bad = await uploadDoc(hd.id, await idByKey('hiring-document-types', 'employmentAcceptance'), dto.version, 'x.txt', 'text/plain');
    expect(bad.status).toBe(422);
  });

  it('rejects an upload carrying a stale version (optimistic concurrency)', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');
    const stale = await uploadDoc(hd.id, typeId, hd.version + 5);
    expect(stale.status).toBe(409);
  });

  it('blocks completion while a required document is missing, then completes', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const blocked = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: hd.version });
    expect(blocked.status).toBe(422);

    const version = await uploadAllRequired(hd);
    const completed = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(completed.status).toBe(200);
    expect((completed.body.data as HiringDocumentsDto).status).toBe('completed');
    expect((completed.body.data as HiringDocumentsDto).missingRequired).toEqual([]);

    // Completion notifies the hiring manager and is audited.
    const inbox = await request(app).get('/api/v1/platform/notifications').set('Authorization', `Bearer ${interviewerToken}`);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'hiringDocuments', pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'statusChange')).toBe(true);
  });
});

describe('hiring documents — versioning & post-completion immutability', () => {
  it('replaces a document, preserving previous versions', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const typeId = await idByKey('hiring-document-types', 'employmentContract');
    const up = await uploadDoc(hd.id, typeId, hd.version, 'id-v1.pdf');
    const v1 = up.body.data as HiringDocumentsDto;

    const replaced = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/documents/${typeId}/replace`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(v1.version))
      .attach('file', pdf(), { filename: 'id-v2.pdf', contentType: 'application/pdf' });
    expect(replaced.status).toBe(200);
    const doc = (replaced.body.data as HiringDocumentsDto).documents.find((d) => d.typeKey === 'employmentContract');
    expect(doc?.fileVersion).toBe(2);

    // Both versions are retained (original preserved).
    const versions = await request(app)
      .get(`/api/v1/hr/hiring-documents/${hd.id}/documents/${typeId}/versions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(versions.status).toBe(200);
    expect((versions.body as { data: unknown[] }).data.length).toBe(2);
  });

  it('is immutable after completion except through the versioning workflow', async () => {
    const emp = await hiredEmployee();
    const hd = await createSet(emp.id);
    const version = await uploadAllRequired(hd);
    const completed = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version });
    expect(completed.status).toBe(200);
    const done = completed.body.data as HiringDocumentsDto;

    // Adding a NEW document type after completion is blocked.
    const optionalType = await idByKey('hiring-document-types', 'bankLetter');
    const blockedUpload = await uploadDoc(hd.id, optionalType, done.version);
    expect(blockedUpload.status).toBe(422);

    // Replacing (versioning) an existing document is still allowed.
    const contractType = await idByKey('hiring-document-types', 'employmentAcceptance');
    const replaced = await request(app)
      .post(`/api/v1/hr/hiring-documents/${hd.id}/documents/${contractType}/replace`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('version', String(done.version))
      .attach('file', pdf(), { filename: 'contract-v2.pdf', contentType: 'application/pdf' });
    expect(replaced.status).toBe(200);
    expect((replaced.body.data as HiringDocumentsDto).documents.find((d) => d.typeKey === 'employmentAcceptance')?.fileVersion).toBe(2);
  });
});
