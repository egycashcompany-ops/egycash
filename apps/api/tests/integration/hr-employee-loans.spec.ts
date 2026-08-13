// Employee loans and advances over HTTP (P-HR-05, phase A).
//
// What this phase has to prove is a short list, and every item on it is one of the owner's frozen
// decisions made observable:
//
//   D2  — a request reaches nobody's money until a SECOND person decides it, and the submitter is
//         refused even when they hold both keys.
//   D3  — one live loan per employee, refused with 409.
//   D5  — the schedule appears at DISBURSEMENT, not before, and its instalments total the principal
//         to the piastre.
//   D6  — rescheduling moves instalments and never the debt.
//   D7  — an external settlement closes the balance and produces no payroll anything.
//   D10 — no interest, no fee, no ceiling: a loan is its principal.
//
// And one absence, which is the whole of phase A's boundary: none of this touches a payslip.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type CompensationEffectsDto,
  type EmployeeLoanDetailDto,
  type EmployeeLoanDto,
} from '@ecms/contracts';
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

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let approverToken = '';
let outsiderToken = '';
let employeeId = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-loans-test-${Date.now()}`;
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

const login = async (identifier: string): Promise<string> => {
  await getCache().delByPrefix('rl:');
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const mkOrgUnit = async (path: string, body: object): Promise<string> => {
  const res = await request(app)
    .post(`/api/v1/platform/${path}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

// ── The endpoints, once ──────────────────────────────────────────────────────
const record = (body: object, token = adminToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const submit = (id: string, version: number, token = adminToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ version });
const decide = (id: string, body: object, token = approverToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/decide`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const disburse = (id: string, body: object, token = approverToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/disburse`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const reschedule = (id: string, body: object, token = approverToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/reschedule`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const settle = (id: string, body: object, token = approverToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/settle-external`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const cancel = (id: string, body: object, token = adminToken) =>
  request(app)
    .post(`/api/v1/hr/employees/${employeeId}/loans/${id}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const getLoan = async (id: string): Promise<EmployeeLoanDetailDto> => {
  const res = await request(app)
    .get(`/api/v1/hr/employees/${employeeId}/loans/${id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as EmployeeLoanDetailDto;
};

/** Record → submit → approve, the whole way through, returning the loan. */
const approvedLoan = async (body: object): Promise<EmployeeLoanDto> => {
  const created = await record(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const row = created.body.data as EmployeeLoanDto;
  const sent = await submit(row.id, row.version);
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const decided = await decide(row.id, {
    decision: 'approved',
    version: (sent.body.data as EmployeeLoanDto).version,
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  return decided.body.data as EmployeeLoanDto;
};

/** …and out the far side: an `active` loan with a schedule. */
const activeLoan = async (body: object): Promise<EmployeeLoanDto> => {
  const approved = await approvedLoan(body);
  const paid = await disburse(approved.id, {
    disbursedAt: '2026-01-15',
    version: approved.version,
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return paid.body.data as EmployeeLoanDto;
};

/** Close whatever is live, so D3 does not make every test depend on the one before it. */
const clearLive = async (): Promise<void> => {
  const res = await request(app)
    .get(`/api/v1/hr/employees/${employeeId}/loans?page=1&pageSize=50`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  for (const loan of (res.body.data as EmployeeLoanDetailDto[]).filter((l) =>
    ['draft', 'pendingApproval', 'approved'].includes(l.status),
  )) {
    await cancel(loan.id, { reason: 'test teardown', version: loan.version });
  }
  for (const loan of (res.body.data as EmployeeLoanDetailDto[]).filter(
    (l) => l.status === 'active',
  )) {
    await settle(loan.id, {
      amount: loan.remaining,
      reason: 'test teardown',
      version: loan.version,
    });
  }
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
  adminToken = await login('admin@ecms.local');

  // D2 needs a SECOND person: the admin records, this one decides. Both hold the keys; the rule is
  // about who acted, not about who may.
  const approverId = await mkUser('approver@ecms.local');
  await rbacService.ensureAssignment(approverId, String(superAdmin._id), 'organization');
  approverToken = await login('approver@ecms.local');

  await mkUser('outsider@ecms.local');
  outsiderToken = await login('outsider@ecms.local');

  const branchId = await mkOrgUnit('branches', {
    code: 'LN1',
    name: { ar: 'فرع القروض', en: 'Loans Branch' },
  });
  const departmentId = await mkOrgUnit('departments', {
    code: 'DEP-LN',
    name: { ar: 'إدارة القروض', en: 'Loans Dept' },
    branchId,
  });
  const jobTitleId = await mkOrgUnit('job-titles', {
    code: 'JT-LN',
    name: { ar: 'محاسب', en: 'Accountant' },
    jobGrade: 'G7',
  });

  const employee = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف القروض',
          nationalId: '29001011590010',
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: '01174000021' },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2024-01-01T00:00:00.000Z',
        salary: { amount: 10_000, currency: 'EGP' },
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
      entryStatus: 'active',
    });
  expect(employee.status, JSON.stringify(employee.body)).toBe(201);
  employeeId = (employee.body as { data: { id: string } }).data.id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the request, and the second person (D2)', () => {
  it('records a draft with no schedule behind it', async () => {
    const created = await record({
      type: 'loan',
      principal: 6_000,
      currency: 'EGP',
      installmentCount: 6,
      firstPeriod: '2026-02',
      reason: 'house repairs',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const row = created.body.data as EmployeeLoanDto;
    expect(row.status).toBe('draft');
    // D5 — the schedule belongs to the disbursement, not to the request.
    expect((await getLoan(row.id)).installments).toEqual([]);
    // Nothing is owed by somebody who has been handed nothing… but the balance reads as the
    // principal, because that is what will be owed. The status is what says it has not happened.
    expect(row.remaining).toBe(6_000);

    const sent = await submit(row.id, row.version);
    expect(sent.status).toBe(200);
    expect((sent.body.data as EmployeeLoanDto).status).toBe('pendingApproval');

    const decided = await decide(row.id, {
      decision: 'approved',
      version: (sent.body.data as EmployeeLoanDto).version,
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect((decided.body.data as EmployeeLoanDto).status).toBe('approved');
    // Approved is the MIDDLE of this machine: still no schedule, because no money has moved.
    expect((await getLoan(row.id)).installments).toEqual([]);
    await clearLive();
  }, 120_000);

  it('refuses a decision by the person who submitted it', async () => {
    const created = await record({
      type: 'loan',
      principal: 1_000,
      currency: 'EGP',
      installmentCount: 2,
      firstPeriod: '2026-02',
      reason: 'self-approval attempt',
    });
    const row = created.body.data as EmployeeLoanDto;
    const sent = await submit(row.id, row.version);
    // The ADMIN submitted, and the admin holds every key in this suite — and is still refused.
    const refused = await decide(
      row.id,
      { decision: 'approved', version: (sent.body.data as EmployeeLoanDto).version },
      adminToken,
    );
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    await clearLive();
  }, 120_000);

  it('sends a rejected request back to draft so it can be fixed', async () => {
    const created = await record({
      type: 'advance',
      principal: 500,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: '2026-02',
      reason: 'rejected once',
    });
    const row = created.body.data as EmployeeLoanDto;
    const sent = await submit(row.id, row.version);
    const decided = await decide(row.id, {
      decision: 'rejected',
      note: 'not this month',
      version: (sent.body.data as EmployeeLoanDto).version,
    });
    expect(decided.status).toBe(200);
    expect((decided.body.data as EmployeeLoanDto).status).toBe('draft');
    await clearLive();
  }, 120_000);

  it('keeps every route behind its own key', async () => {
    const created = await record(
      {
        type: 'loan',
        principal: 1_000,
        currency: 'EGP',
        installmentCount: 1,
        firstPeriod: '2026-02',
        reason: 'permissions',
      },
      outsiderToken,
    );
    expect(created.status).toBe(403);

    const mine = await record({
      type: 'loan',
      principal: 1_000,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: '2026-02',
      reason: 'permissions',
    });
    const row = mine.body.data as EmployeeLoanDto;
    expect((await submit(row.id, row.version, outsiderToken)).status).toBe(403);
    expect(
      (await decide(row.id, { decision: 'approved', version: row.version }, outsiderToken)).status,
    ).toBe(403);
    await clearLive();
  }, 120_000);
});

describe('one live loan at a time (D3)', () => {
  it('refuses a second while one is on its way', async () => {
    const first = await record({
      type: 'loan',
      principal: 3_000,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: '2026-02',
      reason: 'first',
    });
    const row = first.body.data as EmployeeLoanDto;
    // A DRAFT does not reserve the employee — a forgotten one would otherwise lock them out.
    const whileDraft = await record({
      type: 'loan',
      principal: 1_000,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: '2026-02',
      reason: 'while draft',
    });
    expect(whileDraft.status).toBe(201);
    const second = whileDraft.body.data as EmployeeLoanDto;

    // Once one is submitted, it does.
    const sent = await submit(row.id, row.version);
    expect(sent.status).toBe(200);
    const third = await record({
      type: 'loan',
      principal: 1_000,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: '2026-02',
      reason: 'while pending',
    });
    expect(third.status, JSON.stringify(third.body)).toBe(409);
    // …and the draft that already existed cannot slip past by being submitted now.
    expect((await submit(second.id, second.version)).status).toBe(409);
    await clearLive();
  }, 120_000);
});

describe('a stale caller is refused before anything is written', () => {
  /**
   * The interesting half of a disbursement is the SCHEDULE, so a version check that only ran on
   * the final status update would hand back a 409 with the instalments already created — the one
   * outcome worse than either answer alone.
   */
  it('leaves no schedule behind when the version is stale', async () => {
    const approved = await approvedLoan({
      type: 'loan',
      principal: 900,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: '2026-02',
      reason: 'stale version',
    });
    const stale = await disburse(approved.id, {
      disbursedAt: '2026-01-15',
      version: approved.version + 5,
    });
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);

    const after = await getLoan(approved.id);
    expect(after.installments).toEqual([]);
    expect(after.status).toBe('approved');
    await clearLive();
  }, 120_000);
});

describe('disbursement creates the schedule (D5, D10)', () => {
  it('writes instalments that total the principal exactly', async () => {
    const loan = await activeLoan({
      type: 'loan',
      principal: 100,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: '2026-02',
      reason: 'a hundred over three',
    });
    expect(loan.status).toBe('active');
    expect(loan.disbursedAt).toBe('2026-01-15');

    const detail = await getLoan(loan.id);
    expect(detail.installments).toHaveLength(3);
    expect(detail.installments.map((i) => i.period)).toEqual(['2026-02', '2026-03', '2026-04']);
    // 33.33 + 33.33 + 33.34 — the remainder on the last, and the total to the piastre.
    expect(detail.installments.map((i) => i.amountMinor)).toEqual([3_333, 3_333, 3_334]);
    expect(detail.installments.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(
      detail.principalMinor,
    );
    expect(detail.installments.every((i) => i.status === 'planned')).toBe(true);
  }, 120_000);

  it('refuses a second disbursement of the same loan', async () => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/loans?status=active&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    const loan = (res.body.data as EmployeeLoanDetailDto[])[0] as EmployeeLoanDetailDto;
    const again = await disburse(loan.id, { disbursedAt: '2026-01-16', version: loan.version });
    expect(again.status, JSON.stringify(again.body)).toBe(422);
  }, 120_000);

  it('and refuses to cancel a loan whose money already moved', async () => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/loans?status=active&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    const loan = (res.body.data as EmployeeLoanDetailDto[])[0] as EmployeeLoanDetailDto;
    const refused = await cancel(loan.id, { reason: 'changed my mind', version: loan.version });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  }, 120_000);
});

describe('rescheduling moves instalments, not the debt (D6)', () => {
  it('replaces the tail and keeps the total to the piastre', async () => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/loans?status=active&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    const loan = (res.body.data as EmployeeLoanDetailDto[])[0] as EmployeeLoanDetailDto;
    const before = loan.installments
      .filter((i) => i.status === 'planned')
      .reduce((sum, i) => sum + i.amountMinor, 0);

    const done = await reschedule(loan.id, {
      installmentCount: 5,
      firstPeriod: '2026-06',
      reason: 'the employee asked for smaller instalments',
      version: loan.version,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const after = await getLoan(loan.id);
    const planned = after.installments.filter((i) => i.status === 'planned');
    expect(planned).toHaveLength(5);
    expect(planned.map((i) => i.period)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    // THE ASSERTION THIS TEST EXISTS FOR: the same money, over different months.
    expect(planned.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(before);
    // The rows it replaced are cancelled, not deleted — the schedule keeps its history.
    expect(after.installments.filter((i) => i.status === 'cancelled')).toHaveLength(3);
    expect(after.remaining).toBe(loan.remaining);
  }, 120_000);
});

describe('settling outside payroll closes it (D7-1)', () => {
  it('takes the balance, cancels what is left, and deducts nothing', async () => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/loans?status=active&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    const loan = (res.body.data as EmployeeLoanDetailDto[])[0] as EmployeeLoanDetailDto;

    // It closes the loan, so a partial amount is not a settlement — it is a different decision.
    const partial = await settle(loan.id, {
      amount: 1,
      reason: 'partial',
      version: loan.version,
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(422);

    const done = await settle(loan.id, {
      amount: loan.remaining,
      reason: 'paid in cash at the branch',
      version: loan.version,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const settled = done.body.data as EmployeeLoanDto;
    expect(settled.status).toBe('settled');
    expect(settled.remaining).toBe(0);
    expect(settled.externalSettlement?.reason).toBe('paid in cash at the branch');

    const after = await getLoan(loan.id);
    expect(after.installments.every((i) => i.status === 'cancelled')).toBe(true);
  }, 120_000);
});

describe('what a loan does NOT do in phase A', () => {
  it('changes no compensation figure at all', async () => {
    const loan = await activeLoan({
      type: 'loan',
      principal: 1_200,
      currency: 'EGP',
      installmentCount: 12,
      firstPeriod: '2026-02',
      reason: 'the boundary',
    });
    expect(loan.status).toBe('active');

    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/compensation?period=2026-02`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const effects = res.body.data as CompensationEffectsDto;
    // No line of any kind carries this loan, under any origin — phase A adds no payroll input.
    const origins = new Set(
      [...effects.earnings, ...effects.deductions, ...effects.deferred].map((l) => l.origin),
    );
    for (const origin of origins) {
      expect(['payItem', 'leaveSnapshot', 'adjustment']).toContain(origin);
    }
    expect(
      [...effects.earnings, ...effects.deductions].some((l) => l.code.toUpperCase().includes('LOAN')),
    ).toBe(false);
    await clearLive();
  }, 120_000);

  it('and imposes no ceiling on what may be lent (D4)', async () => {
    const huge = await record({
      type: 'loan',
      principal: 5_000_000,
      currency: 'EGP',
      installmentCount: 12,
      firstPeriod: '2026-02',
      reason: 'five hundred times the salary, and no rule says otherwise',
    });
    expect(huge.status, JSON.stringify(huge.body)).toBe(201);
    await clearLive();
  }, 120_000);
});

describe('what a loan refuses', () => {
  it('a currency the employee is not paid in', async () => {
    const refused = await record({
      type: 'loan',
      principal: 1_000,
      currency: 'USD',
      installmentCount: 2,
      firstPeriod: '2026-02',
      reason: 'wrong currency',
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  }, 120_000);

  it('a schedule with more instalments than the principal has piastres', async () => {
    const refused = await record({
      type: 'loan',
      principal: 0.5,
      currency: 'EGP',
      installmentCount: 60,
      firstPeriod: '2026-02',
      reason: 'fifty piastres over sixty months',
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  }, 120_000);

  it('and a shape the contract does not have — no interest, no fee, no cap (D10)', async () => {
    for (const extra of [{ interestRate: 5 }, { fee: 100 }, { maxAmount: 1_000 }]) {
      const refused = await record({
        type: 'loan',
        principal: 1_000,
        currency: 'EGP',
        installmentCount: 2,
        firstPeriod: '2026-02',
        reason: 'strict contract',
        ...extra,
      });
      expect(refused.status, JSON.stringify(extra)).toBe(400);
    }
  }, 120_000);
});
