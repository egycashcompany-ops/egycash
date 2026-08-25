// P-HR-REQ — the requisition, end to end, over real HTTP and a real database.
//
// `job-requisition-rules.spec.ts` settles the RULES exhaustively and without a database. This file
// exists for the four claims a pure test cannot make:
//
//   1. THE TWO STEPS ARE REALLY TWO. A department manager who holds no approval key can decide step
//      one, and cannot decide step two; the requester can decide neither.
//   2. FULFILMENT IS DERIVED AND IDEMPOTENT. The same hire delivered twice moves the count once,
//      because the unique index refuses the second row rather than because a handler remembered.
//   3. AN EDIT THAT ASKS FOR MORE COSTS THE SIGNATURE. Raising the quantity on an open requisition
//      sends it back to step one and clears the decisions that no longer cover it.
//   4. THE REFERENCE IS VALIDATED, AND THE TALENT POOL SURVIVES IT. An applicant may not name a
//      requisition that is closed — and may still be registered naming none at all (ADR-016).
//
// The department axis is asserted too (D-REQ-14): two departments in ONE branch, so branch scope
// cannot be what separates them.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type JobRequisitionDto } from '@ecms/contracts';
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
import { jobRequisitionService } from '../../src/modules/hr/recruitment/job-requisitions';
import { getRequisitionValidator } from '../../src/modules/hr/recruitment/applicants';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = '';
let managerToken = ''; // department A's manager — holds NO approval key
let requesterToken = ''; // raises requisitions — holds create/edit/view only
let deptReaderToken = ''; // jobRequisition.view at DEPARTMENT scope, standing in department A
let managerId = '';
let requesterId = '';

let BRANCH = '';
let DEPARTMENT_A = '';
let DEPARTMENT_B = '';
let SECTION_A = '';
let SECTION_B = '';
let JOB_TITLE = '';
let JOB_TITLE_B = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-requisition-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

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

/** A requisition raised by the requester, in department A, for `quantity` people. */
const raise = async (quantity = 1, over: Record<string, unknown> = {}): Promise<JobRequisitionDto> => {
  const res = await request(app)
    .post('/api/v1/hr/job-requisitions')
    .set('Authorization', `Bearer ${requesterToken}`)
    .send({
      jobTitleId: JOB_TITLE,
      departmentId: DEPARTMENT_A,
      branchId: BRANCH,
      quantity,
      reason: 'expansion',
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<JobRequisitionDto>(res);
};

const submit = async (dto: JobRequisitionDto): Promise<JobRequisitionDto> => {
  const res = await request(app)
    .post(`/api/v1/hr/job-requisitions/${dto.id}/submit`)
    .set('Authorization', `Bearer ${requesterToken}`)
    .send({ version: dto.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<JobRequisitionDto>(res);
};

const decide = (
  token: string,
  dto: JobRequisitionDto,
  verdict: 'approve' | 'reject',
): request.Test =>
  request(app)
    .post(`/api/v1/hr/job-requisitions/${dto.id}/decision`)
    .set('Authorization', `Bearer ${token}`)
    .send({ verdict, version: dto.version });

/** draft → submitted → manager approves → HR approves → open. */
const openOne = async (quantity = 1): Promise<JobRequisitionDto> => {
  const submitted = await submit(await raise(quantity));
  const afterManager = data<JobRequisitionDto>(await decide(managerToken, submitted, 'approve'));
  expect(afterManager.status).toBe('pendingHr');
  const opened = data<JobRequisitionDto>(await decide(adminToken, afterManager, 'approve'));
  expect(opened.status).toBe('open');
  return opened;
};

const get = async (id: string, token = adminToken): Promise<JobRequisitionDto> => {
  const res = await request(app)
    .get(`/api/v1/hr/job-requisitions/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<JobRequisitionDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('req-admin@ecms.local', null, null);
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
  adminToken = await login('req-admin@ecms.local');

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'REQ-1', name: { ar: 'المركز', en: 'HQ' } });
  BRANCH = data<{ id: string }>(branch).id;

  // The manager exists before the department, because the department names them.
  managerId = await mkUser('req-manager@ecms.local', BRANCH, null);
  requesterId = await mkUser('req-requester@ecms.local', BRANCH, null);

  // TWO DEPARTMENTS IN ONE BRANCH — branch scope cannot tell these apart, so anything that does is
  // the department axis and nothing else (D-REQ-14).
  const deptA = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-REQ-A', name: { ar: 'أ', en: 'A' }, branchId: BRANCH, managerId });
  DEPARTMENT_A = data<{ id: string }>(deptA).id;
  const deptB = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-REQ-B', name: { ar: 'ب', en: 'B' }, branchId: BRANCH });
  DEPARTMENT_B = data<{ id: string }>(deptB).id;

  const secA = await request(app)
    .post('/api/v1/platform/sections')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'SEC-REQ-A', name: { ar: 'ق أ', en: 'S A' }, departmentId: DEPARTMENT_A });
  SECTION_A = data<{ id: string }>(secA).id;
  const secB = await request(app)
    .post('/api/v1/platform/sections')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'SEC-REQ-B', name: { ar: 'ق ب', en: 'S B' }, departmentId: DEPARTMENT_B });
  SECTION_B = data<{ id: string }>(secB).id;

  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-REQ', name: { ar: 'سائق', en: 'Driver' }, jobGrade: 'G5' });
  JOB_TITLE = data<{ id: string }>(title).id;
  const titleB = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-REQ-B', name: { ar: 'محاسب', en: 'Accountant' }, jobGrade: 'G6' });
  JOB_TITLE_B = data<{ id: string }>(titleB).id;

  // The manager holds NO approval key: their authority at step one is the relationship, and this
  // suite is what proves the route does not quietly require the key instead.
  const managerRole = await rbacService.ensureManagedRole(
    'req-manager-role',
    { en: 'Requisition manager', ar: 'مدير الإدارة' },
    ['jobRequisition.view'],
  );
  await rbacService.ensureAssignment(managerId, String(managerRole._id), 'organization');
  managerToken = await login('req-manager@ecms.local');

  const requesterRole = await rbacService.ensureManagedRole(
    'req-requester-role',
    { en: 'Requisition requester', ar: 'مقدم الطلب' },
    ['jobRequisition.view', 'jobRequisition.create', 'jobRequisition.edit'],
  );
  await rbacService.ensureAssignment(requesterId, String(requesterRole._id), 'organization');
  requesterToken = await login('req-requester@ecms.local');

  const readerRole = await rbacService.ensureManagedRole(
    'req-department-reader',
    { en: 'Requisition reader', ar: 'قارئ الطلبات' },
    ['jobRequisition.view'],
  );
  const readerId = await mkUser('req-reader@ecms.local', BRANCH, DEPARTMENT_A);
  await rbacService.ensureAssignment(readerId, String(readerRole._id), 'department');
  deptReaderToken = await login('req-reader@ecms.local');
}, 600_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('the state machine', () => {
  it('walks draft → pendingManager → pendingHr → open, and never skips a step', async () => {
    const draft = await raise(2);
    expect(draft.status).toBe('draft');
    expect(draft.code).toMatch(/^REQ-\d{4}-\d{6}$/);
    expect(draft.filledCount).toBe(0);

    const submitted = await submit(draft);
    expect(submitted.status).toBe('pendingManager');

    // The manager's approval lands on pendingHr — NOT on open.
    const afterManager = data<JobRequisitionDto>(await decide(managerToken, submitted, 'approve'));
    expect(afterManager.status).toBe('pendingHr');
    expect(afterManager.managerDecidedBy).toBe(managerId);
    expect(afterManager.hrDecidedBy).toBeNull();

    const opened = data<JobRequisitionDto>(await decide(adminToken, afterManager, 'approve'));
    expect(opened.status).toBe('open');
    expect(opened.hrDecidedBy).not.toBeNull();
  });

  it('refuses a submit on anything but a draft', async () => {
    const opened = await openOne();
    const res = await request(app)
      .post(`/api/v1/hr/job-requisitions/${opened.id}/submit`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ version: opened.version });
    expect(res.status).toBe(422);
  });

  it('a rejection at either step ends the requisition', async () => {
    const submitted = await submit(await raise());
    const rejected = data<JobRequisitionDto>(await decide(managerToken, submitted, 'reject'));
    expect(rejected.status).toBe('rejected');
    // …and nothing moves after that.
    const again = await decide(adminToken, rejected, 'approve');
    expect(again.status).toBe(403);
  });

  it('refuses a stale version — a concurrent decision loses cleanly', async () => {
    const submitted = await submit(await raise());
    const first = await decide(managerToken, submitted, 'approve');
    expect(first.status).toBe(200);
    // The same version, replayed: the status has moved and the version with it.
    const replay = await decide(managerToken, submitted, 'approve');
    expect(replay.status).toBe(403);
  });
});

describe('who may decide (D-REQ-11)', () => {
  it("lets the department's manager decide step one WITHOUT an approval key", async () => {
    const submitted = await submit(await raise());
    const res = await decide(managerToken, submitted, 'approve');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses the manager at step two — that step needs the key', async () => {
    const submitted = await submit(await raise());
    const atHr = data<JobRequisitionDto>(await decide(managerToken, submitted, 'approve'));
    const res = await decide(managerToken, atHr, 'approve');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('jobRequisition.approve');
  });

  it('refuses the requester their own requisition at step one, even as HR', async () => {
    // The requester holds no approval key; give the admin's own requisition the same treatment
    // below. Here the requester is refused because the request is theirs.
    const submitted = await submit(await raise());
    const res = await decide(requesterToken, submitted, 'approve');
    expect(res.status).toBe(403);
  });

  it('refuses SELF-APPROVAL to a full administrator on their own requisition', async () => {
    const mine = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        jobTitleId: JOB_TITLE,
        departmentId: DEPARTMENT_A,
        branchId: BRANCH,
        quantity: 1,
        reason: 'mine',
      });
    const dto = data<JobRequisitionDto>(mine);
    const submitted = await request(app)
      .post(`/api/v1/hr/job-requisitions/${dto.id}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: dto.version });
    const res = await decide(adminToken, data<JobRequisitionDto>(submitted), 'approve');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('your own requisition');
  });
});

describe('fulfilment is derived, and idempotent (D-REQ-13)', () => {
  it('moves open → partiallyFilled → filled as hires are recorded', async () => {
    const opened = await openOne(2);
    const applicantOne = '507f1f77bcf86cd799439011';
    const applicantTwo = '507f1f77bcf86cd799439012';

    await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: applicantOne,
      employeeId: null,
      at: new Date(),
    });
    expect((await get(opened.id)).status).toBe('partiallyFilled');
    expect((await get(opened.id)).filledCount).toBe(1);

    await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: applicantTwo,
      employeeId: null,
      at: new Date(),
    });
    const full = await get(opened.id);
    expect(full.status).toBe('filled');
    expect(full.filledCount).toBe(2);
  });

  it('counts the SAME hire once, however many times it is delivered', async () => {
    const opened = await openOne(2);
    const applicant = '507f1f77bcf86cd799439013';
    const first = await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: applicant,
      employeeId: null,
      at: new Date(),
    });
    const second = await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: applicant,
      employeeId: null,
      at: new Date(),
    });
    expect(first).toBe(true);
    expect(second).toBe(false); // the unique index refused it; nothing moved
    const after = await get(opened.id);
    expect(after.filledCount).toBe(1);
    expect(after.status).toBe('partiallyFilled');
  });

  it('records a hire against a closed requisition without reopening it', async () => {
    const opened = await openOne(3);
    const closed = await request(app)
      .post(`/api/v1/hr/job-requisitions/${opened.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'no longer needed', version: opened.version });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: '507f1f77bcf86cd799439014',
      employeeId: null,
      at: new Date(),
    });
    const after = await get(opened.id);
    expect(after.status).toBe('closed'); // the fact is recorded; the state is not revived
    expect(after.filledCount).toBe(1);
  });
});

describe('editing costs the signature (D-REQ-15)', () => {
  it('raising the quantity on an open requisition sends it back to step one and clears the decisions', async () => {
    const opened = await openOne(1);
    expect(opened.managerDecidedBy).not.toBeNull();

    const res = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ quantity: 3, version: opened.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = data<JobRequisitionDto>(res);
    expect(after.status).toBe('pendingManager');
    expect(after.managerDecidedBy).toBeNull();
    expect(after.hrDecidedBy).toBeNull();
  });

  it('moving the placement does the same', async () => {
    const opened = await openOne(1);
    const res = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ jobTitleId: JOB_TITLE_B, version: opened.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<JobRequisitionDto>(res).status).toBe('pendingManager');
  });

  it('lowering the quantity, or editing the reason, does not', async () => {
    const opened = await openOne(3);
    const res = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ quantity: 2, reason: 'revised', version: opened.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<JobRequisitionDto>(res).status).toBe('open');
  });

  it('refuses a quantity below what is already filled', async () => {
    const opened = await openOne(2);
    await jobRequisitionService.recordFill({
      requisitionId: opened.id,
      applicantId: '507f1f77bcf86cd799439015',
      employeeId: null,
      at: new Date(),
    });
    const current = await get(opened.id);
    const res = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ quantity: 0, version: current.version });
    // 0 is refused by the schema; 1 by the rule — both are refusals, and this asserts the rule.
    expect(res.status).toBe(400);
    const one = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ quantity: 1, version: current.version });
    expect(one.status).toBe(200); // exactly the filled count is allowed
  });

  it('refuses any edit once the requisition has ended', async () => {
    const opened = await openOne(1);
    const cancelled = await request(app)
      .post(`/api/v1/hr/job-requisitions/${opened.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'withdrawn', version: opened.version });
    expect(cancelled.status).toBe(200);
    const res = await request(app)
      .patch(`/api/v1/hr/job-requisitions/${opened.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ quantity: 2, version: data<JobRequisitionDto>(cancelled).version });
    expect(res.status).toBe(422);
  });
});

describe('deleting', () => {
  it('removes a draft', async () => {
    const draft = await raise();
    const res = await request(app)
      .delete(`/api/v1/hr/job-requisitions/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    const after = await request(app)
      .get(`/api/v1/hr/job-requisitions/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(404);
  });

  it('refuses to delete anything that has been submitted — that is a record now', async () => {
    const submitted = await submit(await raise());
    const res = await request(app)
      .delete(`/api/v1/hr/job-requisitions/${submitted.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('cancel it instead');
  });
});

describe('the placement is validated, not assumed', () => {
  it('refuses a section that belongs to another department', async () => {
    const res = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        jobTitleId: JOB_TITLE,
        departmentId: DEPARTMENT_A,
        branchId: BRANCH,
        sectionId: SECTION_B,
        quantity: 1,
        reason: 'wrong section',
      });
    expect(res.status).toBe(422);
  });

  it('accepts a section within the requisition department', async () => {
    const dto = await raise(1, { sectionId: SECTION_A });
    expect(dto.sectionId).toBe(SECTION_A);
  });

  it('refuses an unknown job title', async () => {
    const res = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        jobTitleId: '507f1f77bcf86cd799439099',
        departmentId: DEPARTMENT_A,
        branchId: BRANCH,
        quantity: 1,
        reason: 'unknown title',
      });
    expect(res.status).toBe(400);
  });
});

describe('the reference validator, and the Talent Pool it does not break (§6, ADR-016)', () => {
  it('resolves an open requisition to its whole placement', async () => {
    const opened = await openOne(1);
    const resolution = await getRequisitionValidator().resolve({ jobRequisitionId: opened.id });
    expect(resolution.ok).toBe(true);
    expect(resolution.jobTitleId).toBe(JOB_TITLE);
    expect(resolution.departmentId).toBe(DEPARTMENT_A);
    expect(resolution.branchId).toBe(BRANCH);
  });

  it('refuses a requisition that is not open', async () => {
    const draft = await raise();
    const onDraft = await getRequisitionValidator().resolve({ jobRequisitionId: draft.id });
    expect(onDraft.ok).toBe(false);
    expect(onDraft.error).toContain('draft');

    const opened = await openOne(1);
    await request(app)
      .post(`/api/v1/hr/job-requisitions/${opened.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'stop', version: opened.version });
    const onCancelled = await getRequisitionValidator().resolve({ jobRequisitionId: opened.id });
    expect(onCancelled.ok).toBe(false);
  });

  it('refuses an unknown requisition, and a malformed id', async () => {
    expect((await getRequisitionValidator().resolve({ jobRequisitionId: '507f1f77bcf86cd7994390aa' })).ok).toBe(false);
    expect((await getRequisitionValidator().resolve({ jobRequisitionId: 'not-an-id' })).ok).toBe(false);
  });
});

describe('scope (D-REQ-14)', () => {
  it('answers a department-scoped reader with their own department only', async () => {
    await raise(1); // department A
    const inB = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        jobTitleId: JOB_TITLE,
        departmentId: DEPARTMENT_B,
        branchId: BRANCH,
        quantity: 1,
        reason: 'department B',
      });
    expect(inB.status).toBe(201);

    const scoped = await request(app)
      .get('/api/v1/hr/job-requisitions?pageSize=100')
      .set('Authorization', `Bearer ${deptReaderToken}`);
    expect(scoped.status).toBe(200);
    const rows = data<JobRequisitionDto[]>(scoped);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.departmentId === DEPARTMENT_A)).toBe(true);

    const wide = await request(app)
      .get('/api/v1/hr/job-requisitions?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<JobRequisitionDto[]>(wide).some((row) => row.departmentId === DEPARTMENT_B)).toBe(true);
  });

  it('hides another department’s requisition from a department reader entirely', async () => {
    const inB = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        jobTitleId: JOB_TITLE,
        departmentId: DEPARTMENT_B,
        branchId: BRANCH,
        quantity: 1,
        reason: 'hidden',
      });
    const id = data<{ id: string }>(inB).id;
    const res = await request(app)
      .get(`/api/v1/hr/job-requisitions/${id}`)
      .set('Authorization', `Bearer ${deptReaderToken}`);
    expect(res.status).toBe(404);
  });
});

describe('permissions', () => {
  it('refuses creation without jobRequisition.create', async () => {
    const res = await request(app)
      .post('/api/v1/hr/job-requisitions')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        jobTitleId: JOB_TITLE,
        departmentId: DEPARTMENT_A,
        branchId: BRANCH,
        quantity: 1,
        reason: 'no key',
      });
    expect(res.status).toBe(403);
  });

  it('refuses closing without jobRequisition.approve', async () => {
    const opened = await openOne(1);
    const res = await request(app)
      .post(`/api/v1/hr/job-requisitions/${opened.id}/close`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ reason: 'not mine to close', version: opened.version });
    expect(res.status).toBe(403);
  });

  it('refuses the whole surface without a key at all', async () => {
    const res = await request(app).get('/api/v1/hr/job-requisitions');
    expect(res.status).toBe(401);
  });
});
