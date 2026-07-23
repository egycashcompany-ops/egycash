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
  type EvaluationDto,
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

const clearEvaluations = async (applicantId: string): Promise<void> => {
  for (const key of ['securityCheck', 'medicalExam']) {
    const phaseId = await idByKey('evaluation-phases', key);
    const opened = await request(app)
      .post('/api/v1/hr/evaluations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, phaseId });
    const evaluation = opened.body.data as EvaluationDto;
    await request(app)
      .patch(`/api/v1/hr/evaluations/${evaluation.id}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', version: evaluation.version });
  }
};

const offerReadyApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  await acceptScreening(applicant.id);
  await passStage(applicant.id, 'firstInterview');
  await passStage(applicant.id, 'secondInterview');
  await clearEvaluations(applicant.id);
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
    // Permanent Global Employee Number + derived code <CurrentBranchCode><employeeNumber>.
    expect(emp.employeeNumber).toMatch(/^\d{6,}$/);
    expect(emp.code).toBe(`001${emp.employeeNumber}`);
    expect(emp.status).toBe('active');
    expect(emp.hiredAt).toBe(new Date(HIRING_DATE).toISOString());

    // Preserved references.
    expect(emp.applicantId).toBe(applicant.id);
    expect(emp.jobRequisitionId).toBe(REQUISITION_ID);
    expect(emp.jobOfferId).toBe(offer.id);
    expect(emp.offerCode).toBe(offer.code);

    // Employment terms copied from the accepted snapshot (not defaults).
    expect(emp.acceptedOfferRevision).toBe(offer.acceptedSnapshot?.revisionNumber);
    expect(emp.employment.salary?.amount).toBe(20000);
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

describe('platform identity (ADR-017) — branch code, global sequence, login account', () => {
  const hire = async (): Promise<EmployeeDto> => {
    const applicant = await offerReadyApplicant();
    const offer = await acceptedOffer(applicant.id);
    return (await createEmployee(offer.id)).body.data as EmployeeDto;
  };

  it('assigns a permanent Global Employee Number from a single GLOBAL counter; code = branch + number', async () => {
    const first = await hire();
    const second = await hire();
    // Global Employee Number is 6+ digits and strictly increases (never repeats).
    expect(first.employeeNumber).toMatch(/^\d{6,}$/);
    expect(second.employeeNumber).toMatch(/^\d{6,}$/);
    expect(Number(second.employeeNumber)).toBeGreaterThan(Number(first.employeeNumber));
    // The displayed code is the current branch code prefixed onto the permanent number.
    expect(first.code).toBe(`001${first.employeeNumber}`);
    expect(second.code).toBe(`001${second.employeeNumber}`);
  });

  it('creates a login for an employee (username defaults to the code) and logs in by username OR email', async () => {
    const emp = await hire();
    expect(emp.userId).toBeNull();

    const email = `emp-${emp.code}@ecms.local`;
    const loginRes = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/login`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, firstName: { ar: 'موظف', en: 'Emp' }, lastName: { ar: 'جديد', en: 'New' } });
    expect(loginRes.status).toBe(201);
    const account = loginRes.body.data as {
      user: { id: string; username: string | null; employeeId: string | null };
      activationToken: string;
      employeeCode: string;
    };
    expect(account.user.username).toBe(emp.code); // defaulted to the Employee Code
    expect(account.user.employeeId).toBe(emp.id);
    expect(account.employeeCode).toBe(emp.code);

    // The employee now back-references the account.
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((reread.body.data as EmployeeDto).userId).toBe(account.user.id);

    // A second login for the same employee is rejected (one account per employee).
    const dup = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/login`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `dup-${emp.code}@ecms.local`, firstName: { ar: 'x', en: 'x' }, lastName: { ar: 'y', en: 'y' } });
    expect(dup.status).toBe(409);

    // Activate the invited account, then log in BY USERNAME (the Employee Code)…
    const activated = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token: account.activationToken, password: PASSWORD });
    expect(activated.status).toBe(204);
    const byUsername = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(byUsername.status).toBe(200);
    expect(byUsername.body.data?.me?.id).toBe(account.user.id);

    // …and the email still works as a login identifier (email support is not removed).
    const byEmail = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data?.me?.id).toBe(account.user.id);
  });

  it('lets a super-admin correct an otherwise-immutable branch code, but forbids ordinary editors', async () => {
    const branch = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-TMP-9', name: { ar: 'مؤقت', en: 'Temp' } });
    expect(branch.status).toBe(201);
    const branchId = (branch.body as { data: { id: string; version: number } }).data.id;
    const version = (branch.body as { data: { version: number } }).data.version;

    // A super-admin (privileged) may change it.
    const ok = await request(app)
      .patch(`/api/v1/platform/branches/${branchId}/code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-TMP-8', version });
    expect(ok.status).toBe(200);
    expect((ok.body as { data: { code: string } }).data.code).toBe('BR-TMP-8');
  });
});

describe('employees — lifecycle (status transitions)', () => {
  const hire = async (): Promise<EmployeeDto> => {
    const applicant = await offerReadyApplicant();
    const offer = await acceptedOffer(applicant.id);
    return (await createEmployee(offer.id)).body.data as EmployeeDto;
  };
  const changeStatus = (id: string, body: Record<string, unknown>, token = adminToken) =>
    request(app).patch(`/api/v1/hr/employees/${id}/status`).set('Authorization', `Bearer ${token}`).send(body);
  const last = (e: EmployeeDto): EmployeeDto['statusHistory'][number] | undefined =>
    e.statusHistory[e.statusHistory.length - 1];

  it('records the hire as the first status-history entry', async () => {
    const emp = await hire();
    expect(emp.statusHistory).toHaveLength(1);
    expect(emp.statusHistory[0]).toMatchObject({ from: null, to: 'active' });
  });

  it('moves active → onLeave → active, appending an auditable trail', async () => {
    const emp = await hire();
    const onLeave = await changeStatus(emp.id, { status: 'onLeave', version: emp.version });
    expect(onLeave.status).toBe(200);
    const afterLeave = onLeave.body.data as EmployeeDto;
    expect(afterLeave.status).toBe('onLeave');
    expect(last(afterLeave)).toMatchObject({ from: 'active', to: 'onLeave' });

    const back = await changeStatus(emp.id, { status: 'active', version: afterLeave.version });
    expect(back.status).toBe(200);
    expect((back.body.data as EmployeeDto).status).toBe('active');

    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'employee', pageSize: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: { action: string }[] }).data.some((r) => r.action === 'statusChange')).toBe(true);
  });

  it('requires a reason to suspend or terminate, then treats terminated as terminal', async () => {
    const emp = await hire();
    // Missing reason → request-schema validation failure (Zod refine → 400), distinct from the
    // service-level business-rule rejections (422) exercised below.
    expect((await changeStatus(emp.id, { status: 'suspended', version: emp.version })).status).toBe(400);

    const suspended = await changeStatus(emp.id, { status: 'suspended', reason: 'investigation', version: emp.version });
    expect(suspended.status).toBe(200);
    const s = suspended.body.data as EmployeeDto;
    expect(s.status).toBe('suspended');
    expect(last(s)).toMatchObject({ from: 'active', to: 'suspended', reason: 'investigation' });

    const terminated = await changeStatus(emp.id, { status: 'terminated', reason: 'end of contract', version: s.version });
    expect(terminated.status).toBe(200);
    const term = terminated.body.data as EmployeeDto;
    expect(term.status).toBe('terminated');
    // Terminal: any further transition is rejected by the matrix.
    expect((await changeStatus(emp.id, { status: 'active', version: term.version })).status).toBe(422);
  });

  it('rejects a no-op and an illegal transition', async () => {
    const emp = await hire();
    // No-op (same status).
    expect((await changeStatus(emp.id, { status: 'active', version: emp.version })).status).toBe(422);
    // suspended → onLeave is illegal (must reinstate to active first).
    const suspended = (await changeStatus(emp.id, { status: 'suspended', reason: 'x', version: emp.version }))
      .body.data as EmployeeDto;
    expect((await changeStatus(emp.id, { status: 'onLeave', version: suspended.version })).status).toBe(422);
  });

  it('enforces optimistic concurrency (stale version → 409)', async () => {
    const emp = await hire();
    expect((await changeStatus(emp.id, { status: 'onLeave', version: emp.version })).status).toBe(200);
    // Reusing the now-stale original version fails.
    expect((await changeStatus(emp.id, { status: 'active', version: emp.version })).status).toBe(409);
  });

  it('denies a user without employee.changeStatus', async () => {
    const emp = await hire();
    const denied = await changeStatus(emp.id, { status: 'onLeave', version: emp.version }, aliceToken);
    expect(denied.status).toBe(403);
  });
});
