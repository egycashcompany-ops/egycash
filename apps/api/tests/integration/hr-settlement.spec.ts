// The final settlement summary over HTTP (P-HR-11).
//
// What this phase has to prove is unusual, because most of its design is a list of things that
// already worked and a list of things it deliberately does NOT do:
//
//   * the exit month's pay is QUOTED from the compensation engine, not recomputed here — asserted
//     by reading both and requiring them to be the same object;
//   * the loan balance is quoted from the loans feature, in all three of its shapes: still owing,
//     already settled, never disbursed;
//   * the leave the exit expired is reported from the LEDGER, because the exit zeroes the balance;
//   * an undecided adjustment on the exit month is surfaced, and an approved one is not repeated —
//     it is already a line in the month's compensation;
//   * and the three amounts nobody has a rule for — gratuity, encashment, notice — come back NAMED
//     AND ABSENT, never as a zero and never as a number this system invented.
//
// The last one is the reason several assertions below are about what is missing. A settlement that
// silently reported 0 EGP of severance would look complete and be wrong.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type CompensationEffectsDto,
  type EmployeeLoanDto,
  type EmployeeSettlementDto,
  type PayrollAdjustmentDto,
  type PayrollRunDto,
  type SettlementQueueRowDto,
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
let branchId = '';
let departmentId = '';
let jobTitleId = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-settlement-test-${Date.now()}`;
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
 * Wait for an in-process handler to have run.
 *
 * `hr.employee.exited` is dispatched without being awaited, so the exit request can return before
 * the loans and leave subscribers have reacted. Asserting the reaction the instant the response
 * resolves would be a race rather than a test — the same shape the loans suite uses.
 */
const waitFor = async (predicate: () => Promise<boolean>, ms = 8_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

let nationalSeq = 0;
let phoneSeq = 0;

/** A hired employee. The annual grant lands by itself, which is what the exit later expires. */
const mkEmployee = async (fullNameAr: string, salary = 10_000): Promise<string> => {
  nationalSeq += 1;
  phoneSeq += 1;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `2900101159${String(1000 + nationalSeq)}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `0117400${String(1000 + phoneSeq)}` },
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

const versionOf = async (employeeId: string): Promise<number> => {
  const res = await request(app)
    .get(`/api/v1/hr/employees/${employeeId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: { version: number } }).data.version;
};

const exitEmployee = async (
  employeeId: string,
  effectiveDate: string,
  type = 'resignation',
): Promise<void> => {
  const res = await request(app)
    .post(`/api/v1/hr/employees/${employeeId}/actions/exit`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      type,
      effectiveDate,
      reason: 'settlement suite',
      eligibleForRehire: true,
      version: await versionOf(employeeId),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
};

// ── loans, the three shapes a settlement has to tell apart ───────────────────
const loanRoute = (employee: string, id = '', suffix = ''): string =>
  `/api/v1/hr/employees/${employee}/loans${id === '' ? '' : `/${id}`}${suffix}`;

/** Record → submit → approve. Stops there: `approved` is money not yet handed over. */
const approvedLoan = async (employee: string, body: object): Promise<EmployeeLoanDto> => {
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
  return decided.body.data as EmployeeLoanDto;
};

/** …and out the far side: disbursed, so there is a schedule and a real balance. */
const activeLoan = async (employee: string, body: object): Promise<EmployeeLoanDto> => {
  const approved = await approvedLoan(employee, body);
  const paid = await request(app)
    .post(loanRoute(employee, approved.id, '/disburse'))
    .set('Authorization', `Bearer ${approverToken}`)
    .send({ disbursedAt: '2025-06-01', version: approved.version });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return paid.body.data as EmployeeLoanDto;
};

// ── the endpoint under test ──────────────────────────────────────────────────
const settlementRes = (employeeId: string, token = adminToken) =>
  request(app)
    .get(`/api/v1/hr/employees/${employeeId}/settlement`)
    .set('Authorization', `Bearer ${token}`);

const settlement = async (employeeId: string): Promise<EmployeeSettlementDto> => {
  const res = await settlementRes(employeeId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as EmployeeSettlementDto;
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

  // A second person, because a loan and an adjustment both need one to be decided.
  const approverId = await mkUser('approver@ecms.local');
  await rbacService.ensureAssignment(approverId, String(superAdmin._id), 'organization');
  approverToken = await login('approver@ecms.local');

  /**
   * Somebody who may READ an employee and may not read their pay.
   *
   * This is the whole permission story of the phase: the summary added no key of its own, so the
   * question "who may see a leaver's settlement?" has to be answered by `employee.viewCompensation`
   * alone. A role holding `employee.view` and nothing else is what makes that observable.
   */
  const viewerRole = await rbacService.createRole(
    { name: { en: 'Employee viewer', ar: 'مطالع الموظفين' }, permissionKeys: ['employee.view'] },
    adminId,
  );
  const outsiderId = await mkUser('outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(viewerRole._id), 'organization');
  outsiderToken = await login('outsider@ecms.local');

  branchId = await mkOrgUnit('branches', {
    code: 'ST1',
    name: { ar: 'فرع التسويات', en: 'Settlement Branch' },
  });
  departmentId = await mkOrgUnit('departments', {
    code: 'DEP-ST',
    name: { ar: 'إدارة التسويات', en: 'Settlement Dept' },
    branchId,
  });
  jobTitleId = await mkOrgUnit('job-titles', {
    code: 'JT-ST',
    name: { ar: 'محاسب', en: 'Accountant' },
    jobGrade: 'G7',
  });
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

/**
 * The whole summary, for the case it exists to serve: somebody who left owing money.
 */
describe('a leaver who still owes money', () => {
  let employeeId = '';
  let loan: EmployeeLoanDto | null = null;

  beforeAll(async () => {
    employeeId = await mkEmployee('موظف التسوية', 12_000);
    loan = await activeLoan(employeeId, {
      type: 'loan',
      principal: 6_000,
      currency: 'EGP',
      installmentCount: 6,
      firstPeriod: '2025-07',
      reason: 'settlement suite — outstanding at exit',
    });
    await exitEmployee(employeeId, '2025-10-31');
    // The loans subscriber has to have run, or the balance below is read mid-flight.
    await waitFor(async () => (await settlement(employeeId)).outstandingLoan !== null);
  }, 240_000);

  it('states the exit facts and the month they fall in', async () => {
    const summary = await settlement(employeeId);
    expect(summary.employeeId).toBe(employeeId);
    expect(summary.employeeName).toBe('موظف التسوية');
    expect(summary.employeeCode.length).toBeGreaterThan(0);
    expect(summary.exitType).toBe('resignation');
    expect(summary.effectiveDate).toBe('2025-10-31');
    expect(summary.exitPeriod).toBe('2025-10');
  }, 120_000);

  /**
   * THE assertion of the phase.
   *
   * The exit month's pay is not recomputed here — it is the compensation engine's own answer for
   * that period, read through the endpoint that already served it. Deep equality is the point: if
   * the summary ever grew arithmetic of its own, these two would drift and this test would say so.
   */
  it('quotes the compensation engine for the exit month, byte for byte', async () => {
    const summary = await settlement(employeeId);
    const direct = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/compensation?period=2025-10`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(direct.status, JSON.stringify(direct.body)).toBe(200);
    expect(summary.finalPeriod).toEqual(direct.body.data as CompensationEffectsDto);
  }, 120_000);

  /** The balance is the loans feature's derived number, not a second opinion about the debt. */
  it('quotes the outstanding balance the loans feature derives', async () => {
    const summary = await settlement(employeeId);
    expect(summary.outstandingLoan).not.toBeNull();
    expect(summary.outstandingLoan?.status).toBe('outstandingAtExit');
    expect(summary.outstandingLoan?.loanId).toBe(loan?.id);
    expect(summary.outstandingLoan?.remaining).toBe(loan?.remaining);
    expect(summary.outstandingLoan?.currency).toBe('EGP');
  }, 120_000);

  /**
   * The leave the exit took away, read from the ledger.
   *
   * Not from the balance: `expireAllFor` zeroes it, so by the time anybody settles, the balance
   * says nothing was lost. The ledger entries are the only surviving record — and this is exactly
   * the question `leaveEncashment` is unresolved about.
   */
  it('reports the leave the exit expired, from the ledger the balance no longer shows', async () => {
    await waitFor(async () => (await settlement(employeeId)).expiredLeave.length > 0);
    const summary = await settlement(employeeId);
    expect(summary.expiredLeave.length).toBeGreaterThan(0);
    for (const row of summary.expiredLeave) {
      expect(row.expiredDays).toBeGreaterThan(0);
      expect(row.typeId.length).toBeGreaterThan(0);
      /**
       * The year is the BALANCE's, not the exit's — and pinning a literal here would be wrong
       * twice over. `expireAllFor` stamps each entry with the year the days belonged to, and the
       * hire-time grant lands for whatever year the suite runs in, so `2025` (this leaver's exit
       * year) is not it. Asserting only that it is a real year at or after the hire year is the
       * strongest claim that stays true whenever this suite is run.
       */
      expect(row.year).toBeGreaterThanOrEqual(2024);
    }

    // …and the balance really is zero, which is why the ledger had to be read.
    const balances = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/leave-balances?year=2025`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(balances.status, JSON.stringify(balances.body)).toBe(200);
    for (const balance of balances.body.data as { remaining: number }[]) {
      expect(balance.remaining).toBe(0);
    }
  }, 120_000);

  /**
   * NO AMOUNT for the three that have no rule (design §5).
   *
   * Named, so whoever settles can see what is still missing, and absent, so nobody mistakes an
   * incomplete settlement for a complete one. A zero here would be the worst of both.
   */
  it('names the three unresolved amounts and states none of them', async () => {
    const summary = await settlement(employeeId);
    expect([...summary.unresolved].sort()).toEqual(
      ['endOfServiceGratuity', 'leaveEncashment', 'noticePeriod'].sort(),
    );
    // Nothing anywhere in the payload offers a figure for them, under any spelling.
    const body = JSON.stringify(summary).toLowerCase();
    for (const word of ['severance', 'gratuityamount', 'noticepay', 'encashmentamount']) {
      expect(body, word).not.toContain(word);
    }
  }, 120_000);
});

/** The other two shapes of loan, each of which must NOT be reported as owing. */
describe('a leaver who owes nothing', () => {
  it('reports no loan when the balance was settled before the exit', async () => {
    const employeeId = await mkEmployee('موظف سدد قرضه');
    const loan = await activeLoan(employeeId, {
      type: 'loan',
      principal: 3_000,
      currency: 'EGP',
      installmentCount: 3,
      firstPeriod: '2025-07',
      reason: 'settlement suite — settled before exit',
    });
    const settled = await request(app)
      .post(loanRoute(employeeId, loan.id, '/settle-external'))
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ amount: loan.remaining, reason: 'paid in cash', version: loan.version });
    expect(settled.status, JSON.stringify(settled.body)).toBe(200);

    await exitEmployee(employeeId, '2025-09-30');
    // Nothing should change about the loan, so there is no state to wait FOR — give the subscriber
    // a moment and then assert it left a settled loan alone.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await settlement(employeeId)).outstandingLoan).toBeNull();
  }, 240_000);

  /** Approved but never disbursed: the exit CANCELS it, because there is no debt behind it. */
  it('reports no loan when the money was never handed over', async () => {
    const employeeId = await mkEmployee('موظف لم يستلم');
    await approvedLoan(employeeId, {
      type: 'loan',
      principal: 4_000,
      currency: 'EGP',
      installmentCount: 4,
      firstPeriod: '2025-11',
      reason: 'settlement suite — approved, never disbursed',
    });

    await exitEmployee(employeeId, '2025-09-30');
    await waitFor(async () => {
      const loans = await request(app)
        .get(loanRoute(employeeId) + '?page=1&pageSize=10')
        .set('Authorization', `Bearer ${adminToken}`);
      return (loans.body.data as EmployeeLoanDto[])[0]?.status === 'cancelled';
    });
    expect((await settlement(employeeId)).outstandingLoan).toBeNull();
  }, 240_000);
});

/**
 * Adjustments on the exit month — the undecided ones, and only those.
 *
 * An approved adjustment is already priced into the month's compensation as a line, so repeating
 * it here would put the same money on the screen twice.
 */
describe('undecided money about the exit month', () => {
  let employeeId = '';
  let pendingId = '';

  beforeAll(async () => {
    employeeId = await mkEmployee('موظف له تسويات');
    const mkAdjustment = async (reason: string): Promise<PayrollAdjustmentDto> => {
      const created = await request(app)
        .post(`/api/v1/hr/employees/${employeeId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ period: '2025-08', kind: 'bonus', amount: 500, currency: 'EGP', reason });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const row = created.body.data as PayrollAdjustmentDto;
      const sent = await request(app)
        .post(`/api/v1/hr/employees/${employeeId}/adjustments/${row.id}/submit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ version: row.version });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      return sent.body.data as PayrollAdjustmentDto;
    };

    const pending = await mkAdjustment('settlement suite — still in the queue');
    pendingId = pending.id;
    const approved = await mkAdjustment('settlement suite — already decided');
    const decided = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/adjustments/${approved.id}/decide`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ decision: 'approved', version: approved.version });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);

    await exitEmployee(employeeId, '2025-08-31');
  }, 240_000);

  it('lists the one nobody has decided', async () => {
    const summary = await settlement(employeeId);
    expect(summary.pendingAdjustments.map((row) => row.adjustmentId)).toEqual([pendingId]);
    expect(summary.pendingAdjustments[0]?.status).toBe('pendingApproval');
    expect(summary.pendingAdjustments[0]?.amount).toBe(500);
    expect(summary.pendingAdjustments[0]?.kind).toBe('bonus');
  }, 120_000);

  /** …and does not repeat the approved one, which the month's compensation already carries. */
  it('and leaves the approved one to the compensation it is already part of', async () => {
    const summary = await settlement(employeeId);
    expect(summary.pendingAdjustments).toHaveLength(1);
    // The approved one is where it belongs: an earning line the compensation engine priced.
    expect(summary.finalPeriod.earnings.filter((line) => line.origin === 'adjustment')).toHaveLength(
      1,
    );
  }, 120_000);
});

/** Whether the exit month is settled or still moving — a fact about the run, quoted. */
describe('the exit month, frozen', () => {
  it('says so once that month is frozen, and still reads', async () => {
    const employeeId = await mkEmployee('موظف شهره مجمد');
    await exitEmployee(employeeId, '2025-12-31');
    expect((await settlement(employeeId)).finalPeriodFrozen).toBe(false);

    const created = await request(app)
      .post('/api/v1/hr/payroll/runs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ period: '2025-12' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = created.body.data as PayrollRunDto;
    const frozen = await request(app)
      .post(`/api/v1/hr/payroll/runs/${run.id}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: run.version });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);

    // The read is unaffected by the freeze — it writes nothing, so there is nothing to refuse.
    const summary = await settlement(employeeId);
    expect(summary.finalPeriodFrozen).toBe(true);
    expect(summary.exitPeriod).toBe('2025-12');
  }, 240_000);
});

describe('who may read it, and who has nothing to settle', () => {
  /**
   * Somebody still employed has no settlement — refused as a FACT, not as a permission.
   *
   * 422 rather than 404: the employee exists and the caller may see them. What does not exist is
   * an exit, and without one there is no "exit month" to state, so inventing one would be the
   * system making up a period nobody left in.
   */
  it('refuses an employee who has not exited', async () => {
    const employeeId = await mkEmployee('موظف على رأس العمل');
    const res = await settlementRes(employeeId);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(JSON.stringify(res.body)).toContain('exited');
  }, 120_000);

  /** Reading a leaver's money is reading pay: `employee.view` alone is not enough. */
  it('refuses a caller who may see the employee but not their pay', async () => {
    const employeeId = await mkEmployee('موظف محجوب راتبه');
    await exitEmployee(employeeId, '2025-09-30');

    const visible = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(visible.status).toBe(200);

    const refused = await settlementRes(employeeId, outsiderToken);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
  }, 240_000);

  it('and refuses an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/hr/employees/000000000000000000000000/settlement');
    expect(res.status).toBe(401);
  }, 60_000);
});

/**
 * The queue (P-HR-17) — the opposite question to the summary above.
 *
 * The summary needs a name to start from; this produces the names. What these cases pin is that it
 * lists LEAVERS and only leavers, that each row says why it is there without restating a single
 * amount, and that it sits behind the same compensation key rather than a new one.
 */
describe('the settlement queue', () => {
  const queue = (params: Record<string, string | number> = {}, token = adminToken) =>
    request(app)
      .get('/api/v1/hr/employees/settlement-queue')
      .query({ page: 1, pageSize: 50, ...params })
      .set('Authorization', `Bearer ${token}`);

  const rowsOf = async (params: Record<string, string | number> = {}): Promise<SettlementQueueRowDto[]> => {
    const res = await queue(params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as SettlementQueueRowDto[];
  };

  /**
   * The path is one segment, so `GET /:id` on the employees router would otherwise swallow it and
   * try to read an employee whose id is the word "settlement-queue". Proving it resolves to the
   * queue is proving the mount order holds.
   */
  it('resolves as its own route rather than as an employee id', async () => {
    const res = await queue();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
  }, 120_000);

  it('lists the leavers, with their exit facts', async () => {
    const employeeId = await mkEmployee('موظف الطابور');
    await exitEmployee(employeeId, '2025-07-31', 'termination');

    const row = (await rowsOf()).find((r) => r.employeeId === employeeId);
    expect(row).toBeDefined();
    expect(row?.exitType).toBe('termination');
    expect(row?.effectiveDate).toBe('2025-07-31');
    expect(row?.exitPeriod).toBe('2025-07');
    expect(row?.employeeCode.length).toBeGreaterThan(0);
  }, 240_000);

  /** Somebody still employed has nothing to settle, so they are not in a queue about settling. */
  it('and never lists somebody who is still employed', async () => {
    const employeeId = await mkEmployee('موظف مستمر بالعمل');
    expect((await rowsOf()).some((r) => r.employeeId === employeeId)).toBe(false);
    // …not even when the search names them directly.
    expect((await rowsOf({ search: 'موظف مستمر بالعمل' })).length).toBe(0);
  }, 240_000);

  /** The reason a row is open, quoted from the loans feature — never recomputed here. */
  it('flags the leaver who left owing money, and not the one who did not', async () => {
    const owing = await mkEmployee('موظف مدين للطابور');
    const loan = await activeLoan(owing, {
      type: 'loan',
      principal: 2_000,
      currency: 'EGP',
      installmentCount: 2,
      firstPeriod: '2025-07',
      reason: 'queue — outstanding at exit',
    });
    expect(loan.id.length).toBeGreaterThan(0);
    await exitEmployee(owing, '2025-06-30');
    await waitFor(async () => {
      const row = (await rowsOf()).find((r) => r.employeeId === owing);
      return row?.hasOutstandingLoan === true;
    });

    const clear = await mkEmployee('موظف غير مدين للطابور');
    await exitEmployee(clear, '2025-06-30');

    const rows = await rowsOf();
    expect(rows.find((r) => r.employeeId === owing)?.hasOutstandingLoan).toBe(true);
    expect(rows.find((r) => r.employeeId === clear)?.hasOutstandingLoan).toBe(false);
  }, 240_000);

  /**
   * NO AMOUNT REACHES THIS LIST.
   *
   * Asserted over the payload itself rather than over the DTO's type, because the risk is a field
   * arriving at runtime that the screen then shows — a balance on a queue row would be a second
   * place for the same money to be read, and one that could disagree with the settlement screen.
   */
  it('and states no figure of any kind', async () => {
    const body = JSON.stringify(await rowsOf()).toLowerCase();
    for (const word of ['remaining', 'minor', 'amount', 'total', 'salary', 'currency']) {
      expect(body, word).not.toContain(word);
    }
  }, 120_000);

  /** Reading a leaver's settlement is reading pay — the queue is behind the same key, not a new one. */
  it('refuses a caller who may see employees but not their pay', async () => {
    expect((await queue({}, outsiderToken)).status).toBe(403);
  }, 120_000);

  it('and refuses an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/hr/employees/settlement-queue');
    expect(res.status).toBe(401);
  }, 60_000);
});
