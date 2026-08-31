// Employee Management — Personnel Actions engine integration suite (frozen design
// docs/12-planning/employee-module-design.md). Drives applicants through the pipeline into
// employment, then exercises the engine end to end: probation decisions, transfers with F1
// propagation (code prefix + linked-user placement), compensation redaction, self-action
// rejection, typed exits (auto login suspension D3 + direct-reports settlement), rehire on the
// SAME employee number (D2 override), scheduled actions (create → cancel / apply-due), the
// pending-exit rule, Direct Registration (D4) with the person guard, personal-data edits, and
// the subordinates / rehire-check / timeline read APIs.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type EmployeeActionDto,
  type EmployeeDto,
  type EmployeeTimelineItemDto,
  type InterviewDto,
  type JobOfferDto,
  type RehireCheckResultDto,
  type ScreeningDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { employeeActionService } from '../../src/modules/hr/employee-management/employee-actions';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
let JOB_TITLE_ID = ''; // real job title (the engine validates org referents at application time)
let BRANCH_ID = '';
let BRANCH2_ID = '';
let DEPARTMENT_ID = '';
let DEPARTMENT2_ID = '';
const FUTURE_VALID = '2027-03-01T00:00:00.000Z';
const START_DATE = '2027-04-01T00:00:00.000Z';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // employee.view only — compensation must be redacted
let limitedRehireToken: string; // employee.view + rehire, NO override (D2)
let interviewerId: string;
let interviewerToken: string;
let phoneCounter = 60_000_000;
let nidCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-actions-test-${Date.now()}`;
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

/** Sign in by any enabled identifier (email or employee code) with the suite PASSWORD. */
const login = async (identifier: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/** Structurally-valid Egyptian national id: century 2 + 1990-01-01 + Cairo + unique serial. */
const nextNid = (): string => `290010101${String(10_000 + nidCounter++).padStart(5, '0')}`;

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
      sourceId,
      intakeChannel: 'internal',
      identity: { nationalId: nextNationalId(), fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  // Every recruitment step below answers with the workflow envelope (I6); Stage 5's own employee
  // endpoints are unchanged, so only the recruitment calls unwrap.
  return mutated<ApplicantDto>(res);
};

const acceptScreening = async (applicantId: string): Promise<void> => {
  const screening = mutated<ScreeningDto>(
    await request(app).post('/api/v1/hr/screenings').set('Authorization', `Bearer ${adminToken}`).send({ applicantId }),
  );
  const decided = await request(app)
    .post(`/api/v1/hr/screenings/${screening.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'accepted', version: screening.version });
  expect(decided.status).toBe(200);
};

const passStage = async (applicantId: string, stageKey: string): Promise<void> => {
  const stageId = await idByKey('interview-stages', stageKey);
  const interview = mutated<InterviewDto>(
    await request(app)
      .post('/api/v1/hr/interviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicantId, stageId, scheduledAt: FUTURE_VALID, interviewerIds: [interviewerId] }),
  );
  const submitted = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/evaluations`)
    .set('Authorization', `Bearer ${interviewerToken}`)
    .send({ recommendation: 'recommend', version: interview.version });
  expect(submitted.status).toBe(200);
  const decided = await request(app)
    .post(`/api/v1/hr/interviews/${interview.id}/decide`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ outcome: 'passed', version: mutated<InterviewDto>(submitted).version });
  expect(decided.status).toBe(200);
};

const moveToOffer = async (applicantId: string): Promise<void> => {
  const current = await request(app)
    .get(`/api/v1/hr/applicants/${applicantId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  const moved = await request(app)
    .post(`/api/v1/hr/applicants/${applicantId}/move-to-offer`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: (current.body.data as ApplicantDto).version }); // a read
  expect(moved.status).toBe(200);
};

const offerReadyApplicant = async (): Promise<ApplicantDto> => {
  const applicant = await registerApplicant();
  await acceptScreening(applicant.id);
  await passStage(applicant.id, 'firstInterview');
  await passStage(applicant.id, 'secondInterview');
  await moveToOffer(applicant.id);
  return applicant;
};

const acceptedOffer = async (applicantId: string, termsOver: Record<string, unknown> = {}): Promise<JobOfferDto> => {
  const draft = await request(app)
    .post('/api/v1/hr/job-offers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      applicantId,
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
        validUntil: FUTURE_VALID,
        ...termsOver,
      },
    });
  expect(draft.status).toBe(201);
  let offer = mutated<JobOfferDto>(draft);
  const sent = await request(app)
    .post(`/api/v1/hr/job-offers/${offer.id}/send`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: offer.version });
  expect(sent.status).toBe(200);
  offer = mutated<JobOfferDto>(sent);
  const accepted = await request(app)
    .post(`/api/v1/hr/job-offers/${offer.id}/accept`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: offer.version });
  expect(accepted.status).toBe(200);
  return mutated<JobOfferDto>(accepted);
};

const hire = async (termsOver: Record<string, unknown> = {}): Promise<EmployeeDto> => {
  const applicant = await offerReadyApplicant();
  const offer = await acceptedOffer(applicant.id, termsOver);
  const res = await request(app)
    .post('/api/v1/hr/employees')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ jobOfferId: offer.id });
  expect(res.status).toBe(201);
  return res.body.data as EmployeeDto;
};

const reread = async (id: string): Promise<EmployeeDto> =>
  (await request(app).get(`/api/v1/hr/employees/${id}`).set('Authorization', `Bearer ${adminToken}`)).body
    .data as EmployeeDto;

const action = (
  id: string,
  group: 'employment' | 'compensation' | 'exit' | 'rehire',
  body: Record<string, unknown>,
  token = adminToken,
) =>
  request(app)
    .post(`/api/v1/hr/employees/${id}/actions/${group}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

/**
 * Accounts are auto-provisioned with the employee (auth design D1) — return the user id.
 * Provisioned accounts are born `invited` awaiting the setup link (Rev 4), so the suite
 * activates them at the service level with its own PASSWORD instead of walking the link flow.
 */
const activateLogin = async (emp: EmployeeDto): Promise<string> => {
  const reread = await request(app)
    .get(`/api/v1/hr/employees/${emp.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  const userId = (reread.body.data as EmployeeDto).userId;
  expect(userId).not.toBeNull();
  await userService.setPassword(String(userId), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(userId));
  return String(userId);
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

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Employee viewer', ar: 'مطلع' }, permissionKeys: ['employee.view'] },
    adminId,
  );
  const viewerId = await mkUser('emp-viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'organization');

  // Rehire WITHOUT the override (D2): may rehire eligible ex-employees only.
  const rehireRole = await rbacService.createRole(
    { name: { en: 'Rehirer', ar: 'مُعيد تعيين' }, permissionKeys: ['employee.view', 'employee.rehire'] },
    adminId,
  );
  const rehirerId = await mkUser('emp-rehirer@ecms.local');
  await rbacService.ensureAssignment(rehirerId, String(rehireRole._id), 'organization');

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
  viewerToken = await login('emp-viewer@ecms.local');
  limitedRehireToken = await login('emp-rehirer@ecms.local');
  interviewerToken = await login('interviewer@ecms.local');

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  BRANCH_ID = await mkBranch('001', 'HQ');
  BRANCH2_ID = await mkBranch('002', 'Alex');
  const mkDepartment = async (branchId: string, code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ branchId, code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  DEPARTMENT_ID = await mkDepartment(BRANCH_ID, 'DEP-OPS-1', 'Ops');
  DEPARTMENT2_ID = await mkDepartment(BRANCH2_ID, 'DEP-OPS-2', 'Alex Ops');
  const titleRes = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-OPS-1', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  expect(titleRes.status).toBe(201);
  JOB_TITLE_ID = (titleRes.body as { data: { id: string } }).data.id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('personnel actions — transfer (F1 propagation)', () => {
  it('recomputes the employee code prefix and syncs the linked user placement on a branch transfer', async () => {
    const emp = await hire();
    const userId = await activateLogin(emp);
    const fresh = await reread(emp.id);

    const res = await action(emp.id, 'employment', {
      type: 'transfer',
      branchId: BRANCH2_ID,
      departmentId: DEPARTMENT2_ID,
      version: fresh.version,
    });
    expect(res.status).toBe(201);
    const after = await reread(emp.id);
    // Only the prefix changes; the Global Employee Number never does (ADR-017).
    expect(after.employeeNumber).toBe(emp.employeeNumber);
    expect(after.code).toBe(`002${emp.employeeNumber}`);
    expect(after.employment.branchId).toBe(BRANCH2_ID);
    expect(after.employment.departmentId).toBe(DEPARTMENT2_ID);

    // F1 — the linked user's placement (which drives data-scope authorization) followed.
    const user = await request(app)
      .get(`/api/v1/platform/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((user.body as { data: { organization: { branchId: string | null } } }).data.organization.branchId).toBe(
      BRANCH2_ID,
    );
  });

  it('refuses a transfer whose department does not belong to the target branch', async () => {
    const emp = await hire();
    const res = await action(emp.id, 'employment', {
      type: 'transfer',
      branchId: BRANCH2_ID,
      departmentId: DEPARTMENT_ID, // belongs to branch 001
      version: emp.version,
    });
    expect(res.status).toBe(422);
  });
});

describe('personnel actions — compensation split & redaction', () => {
  it('redacts salary for a viewer without employee.viewCompensation', async () => {
    const emp = await hire();
    const forViewer = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(forViewer.status).toBe(200);
    const dto = forViewer.body.data as EmployeeDto;
    expect(dto.compensationVisible).toBe(false);
    expect(dto.employment.salary).toBeNull();
    expect(dto.employment.allowances).toEqual([]);
    // The admin (viewCompensation) still sees it.
    expect((await reread(emp.id)).employment.salary?.amount).toBe(15000);
  });

  it('applies a salary change through the compensation group and records the action history', async () => {
    const emp = await hire();
    const res = await action(emp.id, 'compensation', {
      type: 'salaryChange',
      salary: { amount: 18000, currency: 'EGP' },
      reason: 'annual review',
      version: emp.version,
    });
    expect(res.status).toBe(201);
    expect((await reread(emp.id)).employment.salary?.amount).toBe(18000);

    const history = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/actions`)
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = (history.body as { data: EmployeeActionDto[] }).data;
    const change = rows.find((a) => a.type === 'salaryChange');
    expect(change?.status).toBe('applied');
    expect(change?.changes.some((c) => c.field === 'employment.salary')).toBe(true);
  });
});

describe('personnel actions — self-action rejection (I1)', () => {
  it('rejects an HR user acting on their OWN employee record', async () => {
    const emp = await hire();
    const userId = await activateLogin(emp);
    // Give the employee's own login full action rights — the guard must still refuse.
    const hrRole = await rbacService.createRole(
      { name: { en: `Self HR ${emp.code}`, ar: 'ذاتي' }, permissionKeys: ['employee.view', 'employee.manageActions'] },
      userId,
    );
    await rbacService.ensureAssignment(userId, String(hrRole._id), 'organization');
    const selfToken = await login(emp.code);
    const fresh = await reread(emp.id);
    const res = await action(emp.id, 'employment', { type: 'probationConfirm', version: fresh.version }, selfToken);
    expect(res.status).toBe(422);
  });
});

describe('personnel actions — typed exits (D3) + direct reports (F1)', () => {
  it('requires a reason for termination (schema) and an explicit rehire-eligibility decision', async () => {
    const emp = await hire();
    expect(
      (await action(emp.id, 'exit', { type: 'termination', eligibleForRehire: false, version: emp.version })).status,
    ).toBe(400);
  });

  it('exits the employee, AUTO-suspends the activated login, closes the period, and blocks further actions', async () => {
    const emp = await hire();
    await activateLogin(emp);
    const fresh = await reread(emp.id);

    const res = await action(emp.id, 'exit', {
      type: 'resignation',
      eligibleForRehire: true,
      version: fresh.version,
    });
    expect(res.status).toBe(201);
    const after = await reread(emp.id);
    expect(after.status).toBe('exited');
    expect(after.exit?.type).toBe('resignation');
    expect(after.employmentPeriods[0]?.exitedAt).not.toBeNull();

    // D3 — the login can no longer be used.
    const attempt = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `act-${emp.code}@ecms.local`, password: PASSWORD });
    expect(attempt.status).not.toBe(200);

    // The exited record accepts nothing but a rehire.
    expect(
      (await action(emp.id, 'employment', { type: 'leaveStart', version: after.version })).status,
    ).toBe(422);

    // The employed-view list excludes them; the exited view contains them.
    const employed = await request(app)
      .get('/api/v1/hr/employees')
      .query({ employed: true, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((employed.body as { data: EmployeeDto[] }).data.map((e) => e.id)).not.toContain(emp.id);
  });

  it('demands a direct-reports decision when the exiting employee manages others, then reassigns', async () => {
    const manager = await hire();
    const managerUserId = await activateLogin(manager);
    const report = await hire({ managerId: managerUserId });
    const newManager = await hire();
    const newManagerUserId = await activateLogin(newManager);

    const fresh = await reread(manager.id);
    // Without a decision → refused with the report count.
    const refused = await action(manager.id, 'exit', {
      type: 'resignation',
      eligibleForRehire: true,
      version: fresh.version,
    });
    expect(refused.status).toBe(422);

    // Reassign to another employee (resolved to their USER id).
    const ok = await action(manager.id, 'exit', {
      type: 'resignation',
      eligibleForRehire: true,
      directReports: { reassignToEmployeeId: newManager.id },
      version: (await reread(manager.id)).version,
    });
    expect(ok.status).toBe(201);
    expect((await reread(report.id)).employment.managerId).toBe(newManagerUserId);
  });
});

describe('personnel actions — rehire (same number, D2 override)', () => {
  const exited = async (eligibleForRehire: boolean): Promise<EmployeeDto> => {
    const emp = await hire();
    const res = await action(emp.id, 'exit', {
      type: 'termination',
      reason: 'restructuring',
      eligibleForRehire,
      version: emp.version,
    });
    expect(res.status).toBe(201);
    return reread(emp.id);
  };

  it('blocks rehiring a NOT-eligible ex-employee without the override permission (D2)', async () => {
    const emp = await exited(false);
    const denied = await action(
      emp.id,
      'rehire',
      {
        type: 'rehire',
        terms: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          employmentType: 'fullTime',
          probationMonths: 3,
          startDate: START_DATE,
        },
        version: emp.version,
      },
      limitedRehireToken,
    );
    expect(denied.status).toBe(403);
  });

  it('rehires on the SAME employee number: probation again, a second employment period, exit cleared', async () => {
    const emp = await exited(true);
    const res = await action(emp.id, 'rehire', {
      type: 'rehire',
      terms: {
        jobTitleId: JOB_TITLE_ID,
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_ID,
        employmentType: 'fullTime',
        probationMonths: 3,
        startDate: START_DATE,
      },
      version: emp.version,
    });
    expect(res.status).toBe(201);
    const after = await reread(emp.id);
    expect(after.employeeNumber).toBe(emp.employeeNumber);
    expect(after.status).toBe('probation');
    expect(after.exit).toBeNull();
    expect(after.employmentPeriods).toHaveLength(2);
    expect(after.employmentPeriods[1]?.exitedAt).toBeNull();
  });

  it('the rehire-check endpoint surfaces the exited match by national id', async () => {
    // Register directly with a NID, exit, then check.
    const nid = nextNid();
    const reg = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: { fullNameAr: 'موظف مباشر', nationalId: nid, nationality: 'Egyptian' },
          contact: { primaryPhone: nextPhone() },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: START_DATE,
        },
        entryStatus: 'active',
      });
    expect(reg.status).toBe(201);
    const emp = reg.body.data as EmployeeDto;
    await action(emp.id, 'exit', { type: 'resignation', eligibleForRehire: true, version: emp.version });

    const check = await request(app)
      .get('/api/v1/hr/employees/rehire-check')
      .query({ nationalId: nid })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.status).toBe(200);
    const match = check.body.data as RehireCheckResultDto | null;
    expect(match?.employeeId).toBe(emp.id);
    expect(match?.status).toBe('exited');
  });
});

describe('personnel actions — scheduling (effective dating)', () => {
  it('schedules a future action, refuses actions after a pending exit, cancels, then applies due work', async () => {
    const emp = await hire();
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const inFourDays = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

    // Schedule an exit two days out — the employee stays employed for now.
    const scheduled = await action(emp.id, 'exit', {
      type: 'resignation',
      eligibleForRehire: true,
      effectiveDate: inTwoDays,
      version: emp.version,
    });
    expect(scheduled.status).toBe(201);
    expect((scheduled.body.data as EmployeeActionDto).status).toBe('scheduled');
    let current = await reread(emp.id);
    expect(current.status).toBe('probation');

    // Pending-exit rule: nothing may take effect on/after the scheduled exit date.
    const late = await action(emp.id, 'employment', {
      type: 'probationExtend',
      newEndDate: inFourDays,
      effectiveDate: inFourDays,
      version: current.version,
    });
    expect(late.status).toBe(422);

    // Cancel the scheduled exit (append-only status flip).
    const actionId = (scheduled.body.data as EmployeeActionDto).id;
    const cancelled = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/${actionId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: current.version });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.data as EmployeeActionDto).status).toBe('cancelled');

    // Re-schedule a suspension and let the scheduler apply it once due.
    current = await reread(emp.id);
    const susp = await action(emp.id, 'employment', {
      type: 'suspend',
      reason: 'scheduled inquiry',
      effectiveDate: inTwoDays,
      version: current.version,
    });
    expect(susp.status).toBe(201);
    expect((susp.body.data as EmployeeActionDto).status).toBe('scheduled');
    expect((await reread(emp.id)).status).toBe('probation');

    const applied = await employeeActionService.applyDueScheduled(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(applied).toBeGreaterThanOrEqual(1);
    expect((await reread(emp.id)).status).toBe('suspended');
  });

  it("cancel requires the permission of the ACTION's group (F5)", async () => {
    const emp = await hire();
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const current = await reread(emp.id);
    const susp = await action(emp.id, 'employment', {
      type: 'suspend',
      reason: 'inquiry',
      effectiveDate: inTwoDays,
      version: current.version,
    });
    expect(susp.status).toBe(201);
    const actionId = (susp.body.data as EmployeeActionDto).id;

    // The rehire-only user passes the route gate (holds a group permission) but not the
    // employment group this action belongs to.
    const denied = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/${actionId}/cancel`)
      .set('Authorization', `Bearer ${limitedRehireToken}`)
      .send({ version: current.version });
    expect(denied.status).toBe(403);

    // A holder of the group permission cancels it.
    const cancelled = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/${actionId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: current.version });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.data as EmployeeActionDto).status).toBe('cancelled');
  });
});

describe('direct registration (D4) + person guard (F2/I6) + personal edits (I4)', () => {
  // Always carries an ID: direct registration requires one, so there is no longer a caller that
  // omits it. Kept as a plain field rather than a conditional spread — the spread is what hid the
  // omission from a payload-level scan when the requirement landed.
  const directBody = (nid: string): Record<string, unknown> => ({
    personal: {
      identity: {
        fullNameAr: 'موظف قديم',
        nationalId: nid,
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: nextPhone() },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId: JOB_TITLE_ID,
      departmentId: DEPARTMENT_ID,
      branchId: BRANCH_ID,
      employmentType: 'fullTime',
      probationMonths: 3,
      startDate: START_DATE,
    },
  });

  it('registers a direct employee: probation-first, null recruitment refs, branch-prefixed code', async () => {
    const res = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(directBody(nextNid()));
    expect(res.status).toBe(201);
    const emp = res.body.data as EmployeeDto;
    expect(emp.origin).toBe('direct');
    expect(emp.status).toBe('probation');
    expect(emp.applicantId).toBeNull();
    expect(emp.jobOfferId).toBeNull();
    expect(emp.code).toBe(`001${emp.employeeNumber}`);
  });

  it('blocks a second employee for the same national id (one person = one employee, forever)', async () => {
    const nid = nextNid();
    expect(
      (
        await request(app)
          .post('/api/v1/hr/employees/direct')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(directBody(nid))
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/v1/hr/employees/direct')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(directBody(nid))
      ).status,
    ).toBe(409);
  });

  it('edits owned personal data as a plain AUDITED update (not a personnel action)', async () => {
    const res = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(directBody(nextNid()));
    expect(res.status).toBe(201);
    const emp = res.body.data as EmployeeDto;
    const newPhone = nextPhone();
    const patched = await request(app)
      .patch(`/api/v1/hr/employees/${emp.id}/personal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ contact: { primaryPhone: newPhone }, version: emp.version });
    expect(patched.status).toBe(200);
    expect((patched.body.data as EmployeeDto).personal.contact.primaryPhone).toBe(newPhone);

    // Audited as `update`; NOT recorded as a personnel action.
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'employee', entityId: emp.id, action: 'update', pageSize: 5 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect((audit.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(1);
    const history = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/actions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      (history.body as { data: EmployeeActionDto[] }).data.every((a) => a.type !== 'dataCorrection'),
    ).toBe(true);
  });
});

describe('read APIs — subordinates & composed timeline', () => {
  it('lists employed direct reports of an employee', async () => {
    const manager = await hire();
    const managerUserId = await activateLogin(manager);
    const report = await hire({ managerId: managerUserId });
    const subs = await request(app)
      .get(`/api/v1/hr/employees/${manager.id}/subordinates`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(subs.status).toBe(200);
    expect((subs.body.data as EmployeeDto[]).map((e) => e.id)).toContain(report.id);
  });

  it('composes the timeline: personnel actions + audited personal edits, newest first', async () => {
    const emp = await hire();
    await action(emp.id, 'employment', { type: 'probationConfirm', version: emp.version });
    await request(app)
      .patch(`/api/v1/hr/employees/${emp.id}/personal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ contact: { primaryPhone: nextPhone() }, version: (await reread(emp.id)).version });

    const res = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const items = res.body.data as EmployeeTimelineItemDto[];
    expect(items.some((i) => i.source === 'action' && i.type === 'hire')).toBe(true);
    expect(items.some((i) => i.source === 'action' && i.type === 'probationConfirm')).toBe(true);
    expect(items.some((i) => i.source === 'personal')).toBe(true);
    const times = items.map((i) => i.at);
    expect([...times].sort((a, b) => (a < b ? 1 : -1))).toEqual(times);
  });
});

// ── HR3-A — a branch-code change reaches the codes derived from it ──────────
//
// The Employee Code is `<BranchCode><GlobalEmployeeNumber>` (ADR-017): derived, but STORED on the
// employee and denormalized onto the Employee File. Correcting a branch's code used to leave every
// employee in it carrying a code that derived from nothing.
//
// What must hold: the CURRENT value follows, the Global Employee Number never moves, and nothing
// that was already issued is rewritten.
describe('branch-code change propagation (HR3-A)', () => {
  it('re-derives the codes of everyone in the branch, keeping the global number', async () => {
    const employee = await hire();
    const before = await reread(employee.id);
    const branch = await request(app)
      .get(`/api/v1/platform/branches/${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(branch.status).toBe(200);
    const version = (branch.body as { data: { version: number } }).data.version;

    const changed = await request(app)
      .patch(`/api/v1/platform/branches/${BRANCH_ID}/code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '009', version });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    const after = await reread(employee.id);
    // The prefix moved…
    expect(after.code.startsWith('009')).toBe(true);
    expect(before.code.startsWith('009')).toBe(false);
    // …and the permanent identity did not.
    expect(after.code.slice(3)).toBe(before.code.slice(3));
    expect(after.employeeNumber).toBe(before.employeeNumber);
  }, 120_000);

  // The action log records what the code WAS when each action happened — it is history, not a
  // cache, so the propagation must leave it exactly where it stands.
  it('leaves the personnel-action history carrying the old code', async () => {
    const employee = await hire({ branchId: BRANCH2_ID });
    const history = await request(app)
      .get(`/api/v1/hr/employees/${employee.id}/actions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(history.status).toBe(200);
    const codes = (history.body as { data: { employeeCode: string }[] }).data.map((a) => a.employeeCode);
    expect(codes.length).toBeGreaterThan(0);
    // Hired into branch 002 — the hire action still says so whatever happens to branch 001.
    expect(codes.every((c) => c.startsWith('002'))).toBe(true);
  }, 120_000);

  it('does not touch an employee of another branch', async () => {
    const other = await hire({ branchId: BRANCH2_ID });
    const before = await reread(other.id);
    const branch = await request(app)
      .get(`/api/v1/platform/branches/${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const version = (branch.body as { data: { version: number } }).data.version;
    const changed = await request(app)
      .patch(`/api/v1/platform/branches/${BRANCH_ID}/code`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '010', version });
    expect(changed.status).toBe(200);
    expect((await reread(other.id)).code).toBe(before.code);
  }, 120_000);
});

// ── The overlap warning (C1) — HR3-B ────────────────────────────────────────
//
// The design's rule: *"creating an action touching fields a pending scheduled action also
// touches surfaces a warning; application order remains strict effective-date order."*
//
// Two things must hold, and the second matters more than the first: the warning must SEE a real
// collision, and it must never turn into a refusal. A scheduled raise and a promotion that also
// raises are both legitimate; the engine applies them in effective-date order and always did.
describe('personnel actions — overlap warning (C1)', () => {
  const overlaps = (id: string, type: string, token = adminToken) =>
    request(app)
      .get(`/api/v1/hr/employees/${id}/actions/overlaps?type=${type}`)
      .set('Authorization', `Bearer ${token}`);

  it('sees a scheduled salary change from a promotion, and not from an unrelated action', async () => {
    const emp = await hire();
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    // Nothing is scheduled yet — an employee with only its applied `hire` action collides with
    // nothing, which is what proves the answer is about SCHEDULED work.
    const quiet = await overlaps(emp.id, 'suspend');
    expect(quiet.status).toBe(200);
    expect(quiet.body.data).toEqual([]);

    const scheduled = await action(emp.id, 'compensation', {
      type: 'salaryChange',
      salary: { amount: 12_345, currency: 'EGP' },
      effectiveDate: inTwoDays,
      version: emp.version,
    });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    expect((scheduled.body.data as EmployeeActionDto).status).toBe('scheduled');

    // A promotion may carry a salary, so it meets the scheduled change on exactly that field.
    const seen = await overlaps(emp.id, 'promotion');
    expect(seen.status).toBe(200);
    const rows = seen.body.data as { actionId: string; type: string; fields: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actionId).toBe((scheduled.body.data as EmployeeActionDto).id);
    expect(rows[0]?.type).toBe('salaryChange');
    expect(rows[0]?.fields).toEqual(['employment.salary']);

    // A manager change writes nothing a salary change writes.
    const unrelated = await overlaps(emp.id, 'managerChange');
    expect(unrelated.status).toBe(200);
    expect(unrelated.body.data).toEqual([]);
  }, 120_000);

  // THE POINT OF THE PHASE. A warning that quietly became a gate would be a much bigger change
  // than the one the design asked for, so it is asserted rather than assumed.
  it('warns without refusing — the promotion still goes through', async () => {
    const emp = await hire();
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await action(emp.id, 'compensation', {
      type: 'salaryChange',
      salary: { amount: 9_000, currency: 'EGP' },
      effectiveDate: inTwoDays,
      version: emp.version,
    });
    expect(scheduled.status).toBe(201);
    expect((await overlaps(emp.id, 'promotion')).body.data).toHaveLength(1);

    const current = await reread(emp.id);
    const promoted = await action(emp.id, 'employment', {
      type: 'promotion',
      jobTitleId: JOB_TITLE_ID,
      version: current.version,
    });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(201);
    expect((promoted.body.data as EmployeeActionDto).status).toBe('applied');
    // And the scheduled one is untouched — still pending, still due on its own date.
    expect((await overlaps(emp.id, 'promotion')).body.data).toHaveLength(1);
  }, 120_000);

  it('stops warning once the scheduled action is cancelled', async () => {
    const emp = await hire();
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await action(emp.id, 'compensation', {
      type: 'salaryChange',
      salary: { amount: 7_500, currency: 'EGP' },
      effectiveDate: inTwoDays,
      version: emp.version,
    });
    expect(scheduled.status).toBe(201);
    const actionId = (scheduled.body.data as EmployeeActionDto).id;

    const current = await reread(emp.id);
    const cancelled = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/${actionId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: current.version });
    expect(cancelled.status).toBe(200);

    expect((await overlaps(emp.id, 'salaryChange')).body.data).toEqual([]);
  }, 120_000);

  // It reads the same scheduled actions the history endpoint already returns, so it follows the
  // same key and adds no permission of its own.
  it('is readable by a holder of employee.view, and validates the type', async () => {
    const emp = await hire();
    expect((await overlaps(emp.id, 'promotion', viewerToken)).status).toBe(200);
    expect((await overlaps(emp.id, 'notAnActionType')).status).toBe(400);
    const missing = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/actions/overlaps`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(400);
  }, 120_000);
});

// ── Supporting documents (HR3-C) ────────────────────────────────────────────
//
// The design lists `attachmentFileId` among an action's fields, with the files category
// `hr-employee-actions`. It was on the model and in the DTO, permanently null — nothing could set
// it.
//
// UPLOAD FIRST, CREATE SECOND, and that order is forced rather than chosen: an action is immutable
// once written (§3), so its document cannot be added afterwards; and the file cannot name the
// action as its owner, because the action does not exist yet. The EMPLOYEE owns it.
describe('personnel actions — supporting documents (HR3-C)', () => {
  const pdf = (): Buffer => Buffer.from('%PDF-1.4 personnel action document');

  const uploadDocument = (employeeId: string, token = adminToken) =>
    request(app)
      .post(`/api/v1/hr/employees/${employeeId}/actions/attachment`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf(), { filename: 'letter.pdf', contentType: 'application/pdf' });

  it('uploads a document and records it on the action it is created with', async () => {
    const emp = await hire();
    const uploaded = await uploadDocument(emp.id);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const fileId = (uploaded.body.data as { id: string }).id;

    const created = await action(emp.id, 'employment', {
      type: 'promotion',
      jobTitleId: JOB_TITLE_ID,
      attachmentFileId: fileId,
      version: emp.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((created.body.data as EmployeeActionDto).attachmentFileId).toBe(fileId);

    // And it is on the history, not just on the create response.
    const history = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/actions?type=promotion`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(history.status).toBe(200);
    const rows = history.body.data as EmployeeActionDto[];
    expect(rows[0]?.attachmentFileId).toBe(fileId);
  }, 120_000);

  /**
   * The check that matters most: one employee's document must not end up in another's history.
   *
   * The file id alone cannot say who it belongs to, which is why the service reads the row and
   * compares the entity reference rather than trusting the shape of the input.
   */
  it('refuses a document uploaded for a different employee', async () => {
    const mine = await hire();
    const theirs = await hire();
    const uploaded = await uploadDocument(theirs.id);
    expect(uploaded.status).toBe(201);

    const refused = await action(mine.id, 'employment', {
      type: 'promotion',
      jobTitleId: JOB_TITLE_ID,
      attachmentFileId: (uploaded.body.data as { id: string }).id,
      version: mine.version,
    });
    expect(refused.status).toBe(422);

    // …and the refusal happened BEFORE the sequence was allocated, so the history is untouched.
    const history = await request(app)
      .get(`/api/v1/hr/employees/${mine.id}/actions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((history.body.data as EmployeeActionDto[]).map((a) => a.type)).toEqual(['hire']);
  }, 120_000);

  it('refuses a file id that names nothing', async () => {
    const emp = await hire();
    const refused = await action(emp.id, 'employment', {
      type: 'promotion',
      jobTitleId: JOB_TITLE_ID,
      attachmentFileId: '64b1f0aaaaaaaaaaaaaaaabb',
      version: emp.version,
    });
    expect(refused.status).toBe(404);
  }, 120_000);

  // Uploading a document IS proposing a personnel action. Reading the history is not enough for
  // it — the viewer holds `employee.view` and nothing else.
  it('takes an action-group permission to upload, not merely employee.view', async () => {
    const emp = await hire();
    const denied = await uploadDocument(emp.id, viewerToken);
    expect(denied.status).toBe(403);
  }, 120_000);

  it('still creates an action with no document at all — it is optional', async () => {
    const emp = await hire();
    const created = await action(emp.id, 'employment', {
      type: 'promotion',
      jobTitleId: JOB_TITLE_ID,
      version: emp.version,
    });
    expect(created.status).toBe(201);
    expect((created.body.data as EmployeeActionDto).attachmentFileId).toBeNull();
  }, 120_000);
});
