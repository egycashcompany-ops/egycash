// Stage 5 — HR / Recruitment: Employee Creation integration suite. Boots the HR manifest and
// drives an applicant through the full pipeline (register → screening accepted → both
// interviews passed → offer sent → offer accepted), then exercises Employee Creation: the
// accepted-offer gate, reading employment terms exclusively from the immutable accepted
// snapshot, the unique employee number, preserved references (applicant / requisition /
// offer), the hiring date, duplicate-hire prevention, notification, and audit.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EmployeeDto,
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
const FUTURE_VALID = '2027-03-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
const HIRING_DATE = '2027-03-15T00:00:00.000Z';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let aliceToken: string;
let interviewerId: string; // interview panel + the offers' hiring manager
let interviewerToken: string;
let phoneCounter = 40_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-test-${Date.now()}`;
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

const registerApplicant = async (): Promise<ApplicantDto> => {
  const sourceId = await idByKey('applicant-sources', 'internalHr');
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      jobRequisitionId: REQUISITION_ID,
      sourceId,
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  return res.body.data as ApplicantDto;
};

const acceptScreening = async (applicantId: string): Promise<void> => {
  const screening = (
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId })
  ).body.data as ScreeningDto;
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status).toBe(200);
};

const passStage = async (applicantId: string, stageKey: string): Promise<void> => {
  const stageId = await idByKey('interview-stages', stageKey);
  const interview = (
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId, scheduledAt: FUTURE_VALID, interviewerIds: [interviewerId] })
  ).body.data as InterviewDto;
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: interview.version });
  expect(submitted.status).toBe(200);
  const decided = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'passed', version: (submitted.body.data as InterviewDto).version });
  expect(decided.status).toBe(200);
};

const offerReadyApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  await acceptScreening(applicant.id);
  await passStage(applicant.id, 'firstInterview');
  await passStage(applicant.id, 'secondInterview');
  return applicant;
};

const offerTerms = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobTitleId: JOB_TITLE_ID,
  departmentId: DEPARTMENT_ID,
  branchId: BRANCH_ID,
  managerId: interviewerId,
  employmentType: 'fullTime',
  salary: { amount: 15000, currency: 'EGP' },
  allowances: [{ name: 'transport', amount: 1000, currency: 'EGP' }],
  benefits: ['medical insurance'],
  probationMonths: 3,
  startDate: START_DATE,
  validUntil: FUTURE_VALID,
  ...over,
});

const draftFor = async (applicantId: string, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  const res = await request(app)
    .post('/api/v1/hr/job-offers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ applicantId, terms: offerTerms(termsOver) });
  expect(res.status).toBe(201);
  return res.body.data as JobOfferDto;
};

/** Drive an offer to Accepted, returning the accepted offer DTO. */
const acceptedOffer = async (applicantId: string, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  let offer = await draftFor(applicantId, termsOver);
  const sent = await request(app)
    .post(`/api/v1/hr/job-offers/${offer.id}/send`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: offer.version });
  expect(sent.status).toBe(200);
  offer = sent.body.data as JobOfferDto;
  const accepted = await request(app)
    .post(`/api/v1/hr/job-offers/${offer.id}/accept`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: offer.version });
  expect(accepted.status).toBe(200);
  return accepted.body.data as JobOfferDto;
};

const createEmployee = (jobOfferId: string, hiringDate?: string) =>
  request(app)
    .post('/api/v1/hr/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(hiringDate === undefined ? { jobOfferId } : { jobOfferId, hiringDate });

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

describe('employees — permissions & accepted-offer gate', () => {
  it('denies a user without employee permissions', async () => {
    const denied = await request(app).get('/api/v1/hr/employees').set('Authorization', `Bearer ${aliceToken}`);
    expect(denied.status).toBe(403);
  });

  it('refuses to create an employee from a non-accepted (draft) offer', async () => {
    const applicant = await offerReadyApplicant();
    const draft = await draftFor(applicant.id);
    const res = await createEmployee(draft.id);
    expect(res.status).toBe(422);
  });

  it('refuses to create an employee from an unknown offer', async () => {
    const res = await createEmployee('64b1f0dddddddddddddddd01');
    expect(res.status).toBe(422);
  });
});

describe('employees — creation from the accepted offer snapshot', () => {
  it('hires from an accepted offer: employee number, references, copied terms, hiring date', async () => {
    const applicant = await offerReadyApplicant();
    // Accept an offer whose package sets salary 20000 — this is what the snapshot freezes.
    const offer = await acceptedOffer(applicant.id, { salary: { amount: 20000, currency: 'EGP' } });
    expect(offer.acceptedSnapshot?.revisionNumber).toBe(1);

    const res = await createEmployee(offer.id, HIRING_DATE);
    expect(res.status).toBe(201);
    const emp = res.body.data as EmployeeDto;

    // Unique, human-readable employee number.
    expect(emp.code).toMatch(/^EMP-\d{4}-\d{6}$/);
    expect(emp.status).toBe('active');
    expect(emp.hiredAt).toBe(new Date(HIRING_DATE).toISOString());

    // Preserved references.
    expect(emp.applicantId).toBe(applicant.id);
    expect(emp.jobRequisitionId).toBe(REQUISITION_ID);
    expect(emp.jobOfferId).toBe(offer.id);
    expect(emp.offerCode).toBe(offer.code);

    // Employment terms copied from the accepted snapshot (not defaults).
    expect(emp.acceptedOfferRevision).toBe(offer.acceptedSnapshot?.revisionNumber);
    expect(emp.employment.salary.amount).toBe(20000);
    expect(emp.employment.employmentType).toBe('fullTime');
    expect(emp.employment.benefits).toEqual(['medical insurance']);
    expect(emp.employment.startDate).toBe(new Date(START_DATE).toISOString());

    // A hiring notification reached the reporting manager.
    const inbox = await request(app).get('/api/v1/platform/notifications').set('Authorization', `Bearer ${interviewerToken}`);
    expect((inbox.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);

    // Creation is audited.
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'employee', pageSize: 5 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'create')).toBe(true);
  });

  it('defaults the hiring date to now when omitted', async () => {
    const applicant = await offerReadyApplicant();
    const offer = await acceptedOffer(applicant.id);
    const before = Date.now();
    const res = await createEmployee(offer.id);
    expect(res.status).toBe(201);
    const hiredAt = new Date((res.body.data as EmployeeDto).hiredAt).getTime();
    expect(hiredAt).toBeGreaterThanOrEqual(before - 1000);
  });

  it('prevents a duplicate employee from the same accepted offer', async () => {
    const applicant = await offerReadyApplicant();
    const offer = await acceptedOffer(applicant.id);
    expect((await createEmployee(offer.id)).status).toBe(201);
    expect((await createEmployee(offer.id)).status).toBe(409);
  });

  it('lists and finds the employee by employee number', async () => {
    const applicant = await offerReadyApplicant();
    const offer = await acceptedOffer(applicant.id);
    const emp = (await createEmployee(offer.id)).body.data as EmployeeDto;
    const found = await request(app)
      .get('/api/v1/hr/employees')
      .query({ search: emp.code, pageSize: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    expect((found.body as { data: EmployeeDto[] }).data.map((e) => e.code)).toContain(emp.code);
  });
});
