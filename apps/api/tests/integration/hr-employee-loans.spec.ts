// Employee loans and advances over HTTP (P-HR-05).
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
// P-HR-05-B adds the payroll side at the bottom of this file: a payslip takes an instalment, the
// ledger records that it happened, and running the batch again costs the employee nothing.
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
  type GeneratePayslipsResultDto,
  type PayrollRunDto,
  type PayslipDto,
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
let branchId = '';
let departmentId = '';
let jobTitleId = '';

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

/**
 * Wait for an in-process event handler to have run.
 *
 * `dispatchInProcess` fires tier-1 consumers WITHOUT awaiting them (`Promise.resolve().then(...)`),
 * so the HTTP response can return before a subscriber has reacted. Asserting the reaction the
 * instant the request resolves is therefore a race, not a test — the same shape `files.spec.ts`
 * and `audit.spec.ts` already use for the same reason.
 */
const waitFor = async (predicate: () => Promise<boolean>, ms = 5_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** One more employee, for a block that needs a person of its own. */
const mkEmployee = async (
  fullNameAr: string,
  nationalId: string,
  phone: string,
  salary = 10_000,
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr, nationalId, nationality: 'Egyptian' },
        contact: { primaryPhone: phone },
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
        salary: { amount: salary, currency: 'EGP' },
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

// ── The endpoints, for any employee ─────────────────────────────────────────
const loanRoute = (employee: string, id = '', suffix = ''): string =>
  `/api/v1/hr/employees/${employee}/loans${id === '' ? '' : `/${id}`}${suffix}`;

/** Record → submit → approve → disburse, for an employee that is not the default one. */
const activeLoanFor = async (employee: string, body: object): Promise<EmployeeLoanDto> => {
  const created = await request(app)
    .post(loanRoute(employee))
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const row = created.body.data as EmployeeLoanDto;

  const sent = await request(app)
    .post(loanRoute(employee, row.id, '/submit'))
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ version: row.version });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);

  const decided = await request(app)
    .post(loanRoute(employee, row.id, '/decide'))
    .set('Authorization', `Bearer ${approverToken}`)
    .send({ decision: 'approved', version: (sent.body.data as EmployeeLoanDto).version });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);

  const paid = await request(app)
    .post(loanRoute(employee, row.id, '/disburse'))
    .set('Authorization', `Bearer ${approverToken}`)
    .send({
      disbursedAt: '2024-06-01',
      version: (decided.body.data as EmployeeLoanDto).version,
    });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return paid.body.data as EmployeeLoanDto;
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

  branchId = await mkOrgUnit('branches', {
    code: 'LN1',
    name: { ar: 'فرع القروض', en: 'Loans Branch' },
  });
  departmentId = await mkOrgUnit('departments', {
    code: 'DEP-LN',
    name: { ar: 'إدارة القروض', en: 'Loans Dept' },
    branchId,
  });
  jobTitleId = await mkOrgUnit('job-titles', {
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

describe('a loan costs a month nothing until it costs it something', () => {
  /**
   * Written for phase A as "a loan changes no compensation figure at all", which stopped being
   * true the moment P-HR-05-B shipped the port. What still needs guarding is the QUALIFIER: a
   * figure moves only once the money has actually been handed over, and stops moving the moment
   * nothing is owed.
   *
   * Both halves are cases the brief names — an inactive loan deducts nothing, and a cancelled
   * instalment deducts nothing — and they are only observable end to end.
   */
  it('deducts nothing before disbursement, and nothing after settlement', async () => {
    const deductionsIn = async (): Promise<CompensationEffectsDto['deductions']> => {
      const res = await request(app)
        .get(`/api/v1/hr/employees/${employeeId}/compensation?period=2026-02`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as CompensationEffectsDto).deductions.filter(
        (l) => l.origin === 'loanInstallment',
      );
    };

    // APPROVED is not paid out: there is no schedule yet, so there is nothing to deduct.
    const approved = await approvedLoan({
      type: 'loan',
      principal: 1_200,
      currency: 'EGP',
      installmentCount: 12,
      firstPeriod: '2026-02',
      reason: 'the boundary',
    });
    expect(await deductionsIn()).toEqual([]);

    // …and the moment the money changes hands, the month costs something.
    const paid = await disburse(approved.id, {
      disbursedAt: '2026-01-15',
      version: approved.version,
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    const active = paid.body.data as EmployeeLoanDto;
    const lines = await deductionsIn();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amount).toBe(100);
    expect(lines[0]?.prorationFactor).toBeNull();

    // A cancelled instalment deducts nothing: settling externally withdraws every planned row.
    const settled = await settle(active.id, {
      amount: active.remaining,
      reason: 'paid in cash instead',
      version: active.version,
    });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);
    expect(await deductionsIn()).toEqual([]);
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

// ── P-HR-05-B: the payroll side ─────────────────────────────────────────────
//
// Everything above is a promise about a schedule. Everything below is the promise being kept: a
// payslip takes an instalment, the ledger records that it happened, and nothing about running the
// batch again costs the employee a second one.
//
// The month is a PAST one, because a run can only be frozen once its last day has passed — which
// is also the only state a payslip may be issued from.
describe('an instalment reaches a payslip (P-HR-05-B)', () => {
  const PERIOD = '2025-06';
  let borrowerId = '';
  let runId = '';

  const loansOf = async (employee: string): Promise<EmployeeLoanDetailDto[]> => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employee}/loans?page=1&pageSize=20`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as EmployeeLoanDetailDto[];
  };

  const effectsOf = async (employee: string, period = PERIOD): Promise<CompensationEffectsDto> => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employee}/compensation?period=${period}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as CompensationEffectsDto;
  };

  const issue = async (): Promise<GeneratePayslipsResultDto> => {
    const res = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/payslips`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as GeneratePayslipsResultDto;
  };

  const slipOf = async (employee: string): Promise<PayslipDto | undefined> => {
    const res = await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}/payslips?employeeId=${employee}&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data as PayslipDto[])[0];
  };

  beforeAll(async () => {
    borrowerId = await mkEmployee('موظف الخصم', '29001011690010', '01174000022');

    // Disbursed BEFORE the month is frozen: a schedule may not be written into a priced month.
    await activeLoanFor(borrowerId, {
      type: 'loan',
      principal: 300,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: PERIOD,
      reason: 'the payroll side',
    });

    const created = await request(app)
      .post('/api/v1/hr/payroll/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: PERIOD });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = created.body.data as PayrollRunDto;
    runId = run.id;
    const frozen = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: run.version });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);
  }, 240_000);

  it('shows up as a deduction with its own origin, never prorated', async () => {
    const effects = await effectsOf(borrowerId);
    const line = effects.deductions.find((l) => l.origin === 'loanInstallment');
    expect(line, JSON.stringify(effects.deductions)).toBeDefined();
    expect(line?.kind).toBe('deduction');
    expect(line?.amount).toBe(100);
    // NOT prorated — a debt does not care which day of the month the payslip is cut on.
    expect(line?.prorationFactor).toBeNull();
    expect(line?.code).toBe('LOAN_INSTALLMENT');
    // And no deferred line: the payslip must stay issuable.
    expect(effects.deferred.filter((l) => l.origin === 'loanInstallment')).toEqual([]);
  }, 120_000);

  it('and only for ITS month — a later instalment does not leak into this one', async () => {
    const lines = (await effectsOf(borrowerId)).deductions.filter(
      (l) => l.origin === 'loanInstallment',
    );
    expect(lines).toHaveLength(1);
    // The next month's instalment is priced against the next month, not against this one.
    const next = (await effectsOf(borrowerId, '2025-07')).deductions.filter(
      (l) => l.origin === 'loanInstallment',
    );
    expect(next).toHaveLength(1);
  }, 120_000);

  /**
   * The payslip is the receipt, so issuing is what turns an intention into a fact — and issuing
   * AGAIN must not turn it into two.
   */
  it('records the repayment once, however many times the batch runs', async () => {
    const first = await issue();
    expect(first.created).toBeGreaterThan(0);

    const slip = await slipOf(borrowerId);
    expect(slip?.deductions.some((l) => l.origin === 'loanInstallment')).toBe(true);
    const netAfterIssue = slip?.net;

    const [loan] = await loansOf(borrowerId);
    expect(loan?.repayments).toHaveLength(1);
    expect(loan?.repayments[0]?.period).toBe(PERIOD);
    expect(loan?.repayments[0]?.amount).toBe(100);
    // The ledger cites documents that already existed rather than an identity it minted.
    expect(loan?.repayments[0]?.runId).toBe(runId);
    expect(loan?.repayments[0]?.payslipId).toBe(slip?.id);
    // The balance is DERIVED: 300 lent, 100 taken.
    expect(loan?.repaid).toBe(100);
    expect(loan?.remaining).toBe(200);
    expect(loan?.installments.filter((i) => i.status === 'deducted')).toHaveLength(1);

    // Run the whole pass again — the normal case, not the exception.
    const again = await issue();
    expect(again.created).toBe(0);
    expect(again.existing).toBeGreaterThan(0);

    const [reread] = await loansOf(borrowerId);
    expect(reread?.repayments).toHaveLength(1);
    expect(reread?.repaid).toBe(100);
    expect(reread?.remaining).toBe(200);
    // …and the issued document did not move either.
    expect((await slipOf(borrowerId))?.net).toBe(netAfterIssue);
  }, 240_000);

  /**
   * A SECOND run over the same month cannot take the instalment twice.
   *
   * The first run is cancelled so the period is free again — the same forward path PY-6 allows —
   * and the new run issues its own payslips. The unique `(loanId, period)` key is what makes the
   * second attempt free.
   */
  it('and a second run over the same month cannot take it again', async () => {
    const before = (await loansOf(borrowerId))[0];
    expect(before?.repaid).toBe(100);

    const cancelled = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'recalculating the month', version: 1 });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const created = await request(app)
      .post('/api/v1/hr/payroll/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: PERIOD });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = created.body.data as PayrollRunDto;
    runId = run.id;
    const frozen = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: run.version });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);
    await issue();

    const after = (await loansOf(borrowerId))[0];
    expect(after?.repayments).toHaveLength(1);
    expect(after?.repaid).toBe(100);
    expect(after?.remaining).toBe(200);

    /**
     * And the RECALCULATED payslip still shows the deduction.
     *
     * This is the half that is easy to get wrong: if the month's compensation only counted rows
     * that were still `planned`, a re-priced month would quietly come out bigger than the one the
     * employee was actually paid — the ledger saying 100 was taken while the new slip showed
     * nothing. The month costs what the month cost.
     */
    const reissued = await slipOf(borrowerId);
    const line = reissued?.deductions.find((l) => l.origin === 'loanInstallment');
    expect(line, 'the re-priced month must still carry the instalment').toBeDefined();
    expect(line?.amount).toBe(100);
  }, 240_000);

  // The instalment a payslip took is history: a reschedule may not move it.
  it('leaves a deducted instalment where it is', async () => {
    const [loan] = await loansOf(borrowerId);
    const deducted = loan?.installments.find((i) => i.status === 'deducted');
    expect(deducted?.period).toBe(PERIOD);

    const moved = await request(app)
      .post(loanRoute(borrowerId, loan?.id ?? '', '/reschedule'))
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        installmentCount: 4,
        firstPeriod: '2026-09',
        reason: 'spread what is left',
        version: loan?.version ?? 0,
      });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const [after] = await loansOf(borrowerId);
    // Still exactly one deducted row, still in its own month, still worth what it was.
    const kept = after?.installments.filter((i) => i.status === 'deducted') ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0]?.period).toBe(PERIOD);
    expect(kept[0]?.amount).toBe(100);
    // And the reschedule moved only what was left.
    expect(after?.remaining).toBe(200);
    expect(
      (after?.installments.filter((i) => i.status === 'planned') ?? []).reduce(
        (sum, i) => sum + i.amountMinor,
        0,
      ),
    ).toBe(20_000);
  }, 120_000);
});

/**
 * D9, D7 and D8 over HTTP — the three places where a wrong answer would show up on somebody's pay.
 *
 * A month of its own, so nothing here depends on the block above having left the world in a
 * particular state.
 */
describe('what payroll does, and refuses to do, with a debt (P-HR-05-B)', () => {
  const PERIOD = '2025-09';
  let poorId = '';
  let externalId = '';
  let leaverId = '';
  let acceleratorId = '';
  let runId = '';

  const loansOf = async (employee: string): Promise<EmployeeLoanDetailDto[]> => {
    const res = await request(app)
      .get(loanRoute(employee) + '?page=1&pageSize=20')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as EmployeeLoanDetailDto[];
  };

  const effectsOf = async (employee: string): Promise<CompensationEffectsDto> => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employee}/compensation?period=${PERIOD}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as CompensationEffectsDto;
  };

  beforeAll(async () => {
    poorId = await mkEmployee('موظف الصافي السالب', '29001011790010', '01174000023');
    externalId = await mkEmployee('موظف التسوية', '29001011890010', '01174000024');
    leaverId = await mkEmployee('موظف الخروج', '29001011990010', '01174000025');
    acceleratorId = await mkEmployee('موظف التعجيل', '29001012190010', '01174000026');

    // An instalment far bigger than anything this month earns — D9's case, on purpose.
    await activeLoanFor(poorId, {
      type: 'loan',
      principal: 5_000,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: PERIOD,
      reason: 'more than the month can pay',
    });
    await activeLoanFor(externalId, {
      type: 'loan',
      principal: 600,
      currency: 'EGP',
      installmentCount: 6,
      firstPeriod: PERIOD,
      reason: 'settled in cash instead',
    });
    await activeLoanFor(leaverId, {
      type: 'loan',
      principal: 1_200,
      currency: 'EGP',
      installmentCount: 12,
      firstPeriod: PERIOD,
      reason: 'still owing when they left',
    });
    await activeLoanFor(acceleratorId, {
      type: 'loan',
      principal: 1_200,
      currency: 'EGP',
      installmentCount: 12,
      firstPeriod: PERIOD,
      reason: 'wants to finish early',
    });
  }, 240_000);

  /**
   * D9 — the instalment is taken IN FULL, the net goes negative, the existing warning is raised,
   * and THE PAYSLIP IS STILL ISSUED. No floor, no partial deduction, no carry-forward, and above
   * all no deferred line: one would have stopped the document from existing at all.
   */
  it('takes the whole instalment, warns, and still issues the payslip', async () => {
    const effects = await effectsOf(poorId);
    const line = effects.deductions.find((l) => l.origin === 'loanInstallment');
    expect(line?.amount).toBe(5_000);
    expect(effects.netMinor).toBeLessThan(0);
    expect(effects.warnings).toContain('netBelowZero');
    expect(effects.deferred.filter((l) => l.origin === 'loanInstallment')).toEqual([]);

    const created = await request(app)
      .post('/api/v1/hr/payroll/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: PERIOD });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = created.body.data as PayrollRunDto;
    runId = run.id;
    const frozen = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: run.version });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);

    const issued = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/payslips`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    const result = issued.body.data as GeneratePayslipsResultDto;
    // Nobody was skipped for a pending line — an unpayable instalment is not a pending one.
    expect(result.skipped.filter((s) => s.reason === 'pendingLine')).toEqual([]);

    const slips = await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}/payslips?employeeId=${poorId}&page=1&pageSize=5`)
      .set('Authorization', `Bearer ${adminToken}`);
    const slip = (slips.body.data as PayslipDto[])[0];
    expect(slip, 'a payslip must exist even with a negative net').toBeDefined();
    expect(slip?.netMinor).toBeLessThan(0);
    expect(slip?.warnings).toContain('netBelowZero');
    // …and it was recorded as repaid, because it really was taken.
    expect((await loansOf(poorId))[0]?.repaid).toBe(5_000);
  }, 240_000);

  // D7-1 — money that arrived some other way produces NO payroll line, in the month it happened
  // or in any other.
  it('an external settlement deducts nothing from any salary', async () => {
    const [loan] = await loansOf(externalId);
    expect(loan?.remaining).toBe(500); // 600 lent, 100 taken by the run above

    const done = await request(app)
      .post(loanRoute(externalId, loan?.id ?? '', '/settle-external'))
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        amount: loan?.remaining ?? 0,
        reason: 'paid in cash at the branch',
        version: loan?.version ?? 0,
      });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const [after] = await loansOf(externalId);
    expect(after?.status).toBe('settled');
    expect(after?.remaining).toBe(0);
    // The ledger holds ONLY what payroll took: the cash never pretends to be a deduction.
    expect(after?.repayments).toHaveLength(1);
    expect(after?.repaid).toBe(100);
    expect(after?.installments.filter((i) => i.status === 'planned')).toEqual([]);

    // And no future month carries a line for it.
    const next = await request(app)
      .get(`/api/v1/hr/employees/${externalId}/compensation?period=2025-10`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(next.status).toBe(200);
    expect(
      (next.body.data as CompensationEffectsDto).deductions.filter(
        (l) => l.origin === 'loanInstallment',
      ),
    ).toEqual([]);
  }, 240_000);

  /**
   * D7-2 — an extra amount through payroll, taken ONCE.
   *
   * The instalment for the named month grows, the last months disappear, and the total does not
   * move: an acceleration repays faster, never more.
   */
  it('an acceleration takes the extra once and shortens the schedule', async () => {
    const [loan] = await loansOf(acceleratorId);
    const plannedBefore = loan?.installments.filter((i) => i.status === 'planned') ?? [];
    const owedBefore = plannedBefore.reduce((sum, i) => sum + i.amountMinor, 0);

    const target = plannedBefore[0]?.period ?? '';
    const done = await request(app)
      .post(loanRoute(acceleratorId, loan?.id ?? '', '/accelerate'))
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        period: target,
        extraAmount: 300,
        reason: 'a bonus arrived, so pay it down',
        version: loan?.version ?? 0,
      });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const [after] = await loansOf(acceleratorId);
    const plannedAfter = after?.installments.filter((i) => i.status === 'planned') ?? [];
    // The named month now carries its instalment plus the extra…
    expect(plannedAfter[0]?.period).toBe(target);
    expect(plannedAfter[0]?.amount).toBe(400);
    // …the months at the end are gone…
    expect(plannedAfter.length).toBeLessThan(plannedBefore.length);
    // …and the debt did not move.
    expect(plannedAfter.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(owedBefore);
    expect(after?.remaining).toBe(loan?.remaining);
  }, 240_000);

  it('and refuses an acceleration bigger than what is left after that month', async () => {
    const [loan] = await loansOf(acceleratorId);
    const target =
      loan?.installments.find((i) => i.status === 'planned')?.period ?? '';
    const refused = await request(app)
      .post(loanRoute(acceleratorId, loan?.id ?? '', '/accelerate'))
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        period: target,
        extraAmount: 999_999,
        reason: 'more than is owed',
        version: loan?.version ?? 0,
      });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  }, 120_000);

  it('and keeps acceleration behind the approve key', async () => {
    const [loan] = await loansOf(acceleratorId);
    const target = loan?.installments.find((i) => i.status === 'planned')?.period ?? '';
    const refused = await request(app)
      .post(loanRoute(acceleratorId, loan?.id ?? '', '/accelerate'))
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ period: target, extraAmount: 10, reason: 'no key', version: loan?.version ?? 0 });
    expect(refused.status).toBe(403);
  }, 120_000);

  /**
   * D8 — the employee left owing money.
   *
   * The instalments after the exit are withdrawn (payroll would never have priced them anyway),
   * and the loan says `outstandingAtExit`. NOTHING is taken from a final salary, and nothing is
   * written off: the balance stays exactly what it was, readable, for a decision made elsewhere.
   */
  it('an exit withdraws the future instalments and states the balance', async () => {
    const before = (await loansOf(leaverId))[0];
    expect(before?.status).toBe('active');
    const owedBefore = before?.remaining;

    const employee = await request(app)
      .get(`/api/v1/hr/employees/${leaverId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(employee.status).toBe(200);
    const exited = await request(app)
      .post(`/api/v1/hr/employees/${leaverId}/actions/exit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        // `type` on an exit action IS the exit type — resignation, termination — and a past
        // `effectiveDate` applies immediately, which is what makes the cancelled months exact.
        type: 'resignation',
        effectiveDate: '2025-10-31',
        reason: 'left with a loan outstanding',
        eligibleForRehire: true,
        version: (employee.body as { data: { version: number } }).data.version,
      });
    expect(exited.status, JSON.stringify(exited.body)).toBe(201);

    await waitFor(async () => (await loansOf(leaverId))[0]?.status === 'outstandingAtExit');
    const after = (await loansOf(leaverId))[0];
    expect(after?.status).toBe('outstandingAtExit');
    // The balance did not move: no final-salary deduction, and no write-off.
    expect(after?.remaining).toBe(owedBefore);
    // Every month after the exit was withdrawn…
    expect(
      (after?.installments ?? []).filter((i) => i.status === 'planned' && i.period > '2025-10'),
    ).toEqual([]);
    // …and what a payslip already took is untouched.
    expect(after?.repaid).toBe(100);
    expect((after?.installments ?? []).filter((i) => i.status === 'deducted')).toHaveLength(1);
  }, 240_000);

  // A loan that was already repaid is not something an exit has an opinion about.
  it('and leaves a settled loan alone', async () => {
    const settledBefore = (await loansOf(externalId))[0];
    expect(settledBefore?.status).toBe('settled');

    const employee = await request(app)
      .get(`/api/v1/hr/employees/${externalId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const exited = await request(app)
      .post(`/api/v1/hr/employees/${externalId}/actions/exit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'resignation',
        effectiveDate: '2025-10-31',
        reason: 'left with nothing owing',
        eligibleForRehire: true,
        version: (employee.body as { data: { version: number } }).data.version,
      });
    expect(exited.status, JSON.stringify(exited.body)).toBe(201);

    // Nothing should change, so there is no state to wait FOR — give the subscriber a moment to
    // run and then assert it left the loan alone.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = (await loansOf(externalId))[0];
    expect(after?.status).toBe('settled');
    expect(after?.remaining).toBe(0);
  }, 240_000);
});

/**
 * The organization-wide list, and the labels on it (P-HR-06 / D7).
 *
 * `/hr/employee-loans` shipped with phase A and has had no caller since; the loans admin screen is
 * P-HR-06-B. What lands here now is the READ half: the same helper the adjustments queue uses puts
 * a name and a code on each row, so the list is legible to somebody who is not standing on one
 * employee's file. Nothing is stored — a corrected name corrects every list at once.
 */
describe('the organization-wide loans list (P-HR-06)', () => {
  it('carries the employee label, which the employee-scoped read deliberately does not', async () => {
    // D3 lets one loan be live at a time, so start from a clean employee rather than from whatever
    // the block above left behind.
    await clearLive();
    const loan = await approvedLoan({
      type: 'loan',
      principal: 1_200,
      currency: 'EGP',
      installmentCount: 2,
      firstPeriod: '2026-02',
      reason: 'the admin list reads this one',
    });

    const all = await request(app)
      .get('/api/v1/hr/employee-loans?page=1&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const row = (all.body.data as EmployeeLoanDto[]).find((l) => l.id === loan.id);
    expect(row?.employeeName).toBe('موظف القروض');
    expect(row?.employeeCode).toBeTruthy();

    // The tab is already on somebody's file, so it is not told again whose loans these are.
    const scoped = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/loans?page=1&pageSize=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(scoped.status).toBe(200);
    for (const each of scoped.body.data as EmployeeLoanDto[]) {
      expect(each.employeeName).toBeUndefined();
      expect(each.employeeCode).toBeUndefined();
    }

    // No new key: the same `employeeLoan.view` the tab needs, and the outsider still holds none.
    const refused = await request(app)
      .get('/api/v1/hr/employee-loans')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(refused.status).toBe(403);

    await clearLive();
  }, 240_000);
});

/**
 * A debt announces itself (P-HR-07).
 *
 * P-HR-05 built the whole obligation and told nobody about any of it: not the person who could
 * approve it, and not the employee whose salary the instalments would come out of. These cases
 * assert the three moments this phase publishes, and — the part that matters — that a refused
 * repeat cannot produce a second notice, because it cannot produce a second transition.
 */
describe('the decision notices (P-HR-07)', () => {
  const inboxCount = async (token: string): Promise<number> => {
    const res = await request(app)
      .get('/api/v1/platform/notifications')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as { data: unknown[] }).data.length;
  };

  it('tells whoever can approve that a request is waiting, and only on submit', async () => {
    await clearLive();
    const before = await inboxCount(approverToken);

    const created = await record({
      type: 'loan',
      principal: 900,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: '2026-02',
      reason: 'the notice reads this one',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const row = created.body.data as EmployeeLoanDto;

    // A draft is a proposal nobody is waiting on — it must not reach anybody's inbox.
    expect(await inboxCount(approverToken)).toBe(before);

    const sent = await submit(row.id, row.version);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(await inboxCount(approverToken)).toBeGreaterThan(before);

    await clearLive();
  }, 240_000);

  /**
   * The transition is the guard, and this proves it from both sides: a stale version is refused by
   * the optimistic-lock filter, and a fresh one by the status check. Neither can emit twice.
   */
  it('and a refused repeat adds nothing to the inbox', async () => {
    await clearLive();
    const created = await record({
      type: 'advance',
      principal: 600,
      currency: 'EGP',
      installmentCount: 1,
      firstPeriod: '2026-03',
      reason: 'no duplicate notices',
    });
    const row = created.body.data as EmployeeLoanDto;
    const sent = await submit(row.id, row.version);
    expect(sent.status).toBe(200);
    const after = await inboxCount(approverToken);

    expect((await submit(row.id, row.version)).status).toBe(409);
    expect((await submit(row.id, (sent.body.data as EmployeeLoanDto).version)).status).toBe(422);

    expect(await inboxCount(approverToken)).toBe(after);
    await clearLive();
  }, 240_000);
});
