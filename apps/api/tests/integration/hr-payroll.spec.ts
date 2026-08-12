// Payroll PY-1 — the pay-item catalog over HTTP.
//
// What this phase must prove is small and load-bearing: the code is a unique handle, what an item
// MEANS cannot be edited after creation, every route is behind its own key, and nothing statutory
// exists yet. The last one is a test about an ABSENCE, which is the only way a decision to not
// invent tax rules survives contact with a later contributor.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type CompensationEffectsDto,
  type EmployeePayItemDto,
  type PayItemDto,
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
import { addDays, cairoToday, dateOnlyIso } from '../../src/modules/hr/shared/business-date';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let outsiderToken = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-payroll-test-${Date.now()}`;
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

const post = (body: object, token = adminToken) =>
  request(app).post('/api/v1/hr/payroll/pay-items').set('Authorization', `Bearer ${token}`).send(body);
const patch = (id: string, body: object, token = adminToken) =>
  request(app)
    .patch(`/api/v1/hr/payroll/pay-items/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const get = (query = '', token = adminToken) =>
  request(app).get(`/api/v1/hr/payroll/pay-items${query}`).set('Authorization', `Bearer ${token}`);

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
  await mkUser('outsider@ecms.local');
  outsiderToken = await login('outsider@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the pay-item catalog', () => {
  let housing: PayItemDto;

  it('creates an item and normalizes its code', async () => {
    const created = await post({
      code: 'HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
    expect(created.status).toBe(201);
    housing = created.body.data as PayItemDto;
    expect(housing.code).toBe('HOUSING');
    expect(housing.status).toBe('active');
    // No amount lives on a definition — an amount belongs to an employee or a calculation.
    expect(housing).not.toHaveProperty('amount');
    expect(housing).not.toHaveProperty('taxable');
  });

  it('refuses a second live item with the same code', async () => {
    const clash = await post({
      code: 'HOUSING',
      name: { ar: 'آخر', en: 'Other' },
      kind: 'deduction',
      calcBasis: 'fixed',
    });
    expect(clash.status).toBe(409);
  });

  it('renames and re-orders, but refuses to change what the item means', async () => {
    const renamed = await patch(housing.id, {
      name: { ar: 'بدل السكن', en: 'Housing' },
      sortOrder: 50,
      version: housing.version,
    });
    expect(renamed.status).toBe(200);
    const after = renamed.body.data as PayItemDto;
    expect(after.name).toEqual({ ar: 'بدل السكن', en: 'Housing' });
    expect(after.sortOrder).toBe(50);
    housing = after;

    // The arithmetic is set once: a payslip line will cite this item, so changing its kind or
    // basis would restate history. The contract is `.strict()`, so these are 400s.
    for (const body of [{ kind: 'deduction' }, { calcBasis: 'perDay' }, { code: 'OTHER' }]) {
      const refused = await patch(housing.id, { ...body, version: housing.version });
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('archives rather than deletes, and archiving is reversible', async () => {
    const archived = await patch(housing.id, { status: 'archived', version: housing.version });
    expect(archived.status).toBe(200);
    housing = archived.body.data as PayItemDto;
    expect(housing.status).toBe('archived');

    // Still readable — history must keep naming something real.
    const listed = await get('?status=archived');
    expect((listed.body.data as PayItemDto[]).some((i) => i.id === housing.id)).toBe(true);

    const restored = await patch(housing.id, { status: 'active', version: housing.version });
    expect(restored.status).toBe(200);
    housing = restored.body.data as PayItemDto;
  });

  it('filters by kind and searches by code or name', async () => {
    await post({
      code: 'LATE_DEDUCTION',
      name: { ar: 'خصم تأخير', en: 'Late deduction' },
      kind: 'deduction',
      calcBasis: 'perMinute',
    });

    const earnings = await get('?kind=earning&status=active');
    expect(earnings.status).toBe(200);
    expect((earnings.body.data as PayItemDto[]).every((i) => i.kind === 'earning')).toBe(true);

    const searched = await get('?search=LATE');
    expect((searched.body.data as PayItemDto[]).map((i) => i.code)).toContain('LATE_DEDUCTION');
  });

  it('refuses every route to a caller without the key', async () => {
    expect((await get('', outsiderToken)).status).toBe(403);
    expect(
      (
        await post(
          { code: 'X_ITEM', name: { ar: 'س', en: 'X' }, kind: 'earning', calcBasis: 'fixed' },
          outsiderToken,
        )
      ).status,
    ).toBe(403);
    expect((await patch(housing.id, { sortOrder: 1, version: housing.version }, outsiderToken)).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .delete(`/api/v1/hr/payroll/pay-items/${housing.id}`)
          .set('Authorization', `Bearer ${outsiderToken}`)
      ).status,
    ).toBe(403);
  });

  it('rejects a malformed code rather than storing it', async () => {
    for (const code of ['housing', '1BAD', 'WITH SPACE']) {
      const refused = await post({
        code,
        name: { ar: 'س', en: 'X' },
        kind: 'earning',
        calcBasis: 'fixed',
      });
      expect(refused.status, code).toBe(400);
    }
  });

  // PY-1 ships no run, no payslip and no statutory endpoint. Asserting the absence is what keeps
  // "taxes are out of v1" a decision rather than an oversight somebody fills in quietly.
  it('exposes no run, payslip or statutory surface yet', async () => {
    for (const path of ['/hr/payroll/runs', '/hr/payroll/payslips', '/hr/payroll/tax-rules']) {
      const res = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, path).toBe(404);
    }
  });
});

// ── PY-2 — employee pay items ───────────────────────────────────────────────
//
// The assignment that gives a catalog item an amount for one employee over one dated interval.
// What has to hold here is mostly about REFUSAL: an archived item cannot start a new assignment,
// two intervals for the same employee × item may never overlap, an assignment that has already
// started is closed rather than deleted, and none of it is reachable outside the caller's
// existing compensation scope — because this feature was given no permission of its own.
describe('employee pay items', () => {
  let BRANCH_A = '';
  let BRANCH_B = '';
  let DEPARTMENT_ID = '';
  let JOB_TITLE_ID = '';
  let employeeId = '';
  let bonus: PayItemDto;
  let transport: PayItemDto;
  let retired: PayItemDto;
  let managerToken = '';
  let viewerToken = '';
  let otherBranchToken = '';
  let nidCounter = 0;

  const iso = (date: Date): string => dateOnlyIso(date);
  const today = (): Date => cairoToday();

  const items = (employee = employeeId, token = managerToken) =>
    request(app)
      .get(`/api/v1/hr/employees/${employee}/pay-items`)
      .set('Authorization', `Bearer ${token}`);
  const assign = (body: object, employee = employeeId, token = managerToken) =>
    request(app)
      .post(`/api/v1/hr/employees/${employee}/pay-items`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const unassign = (id: string, employee = employeeId, token = managerToken) =>
    request(app)
      .delete(`/api/v1/hr/employees/${employee}/pay-items/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const mkScopedUser = async (email: string, branchId: string | null): Promise<string> => {
    const { user } = await userService.create(
      {
        email,
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));
    return String(user._id);
  };

  beforeAll(async () => {
    const branchA = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PY2A', name: { ar: 'المركز', en: 'HQ' } });
    BRANCH_A = (branchA.body as { data: { id: string } }).data.id;
    const branchB = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PY2B', name: { ar: 'فرع', en: 'Branch' } });
    BRANCH_B = (branchB.body as { data: { id: string } }).data.id;
    const dep = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-PY2', name: { ar: 'إدارة', en: 'Ops' }, branchId: BRANCH_A });
    DEPARTMENT_ID = (dep.body as { data: { id: string } }).data.id;
    const title = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-PY2', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
    JOB_TITLE_ID = (title.body as { data: { id: string } }).data.id;

    const employee = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: {
            fullNameAr: 'موظف الرواتب',
            nationalId: `290010102${String(100 + nidCounter++)}10`,
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: '01170000001' },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_A,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
      });
    expect(employee.status).toBe(201);
    employeeId = (employee.body as { data: { id: string } }).data.id;

    // The two catalog rows this block works with — one live, one archived.
    bonus = (
      await post({
        code: 'BONUS',
        name: { ar: 'مكافأة', en: 'Bonus' },
        kind: 'earning',
        calcBasis: 'fixed',
      })
    ).body.data as PayItemDto;
    transport = (
      await post({
        code: 'TRANSPORT',
        name: { ar: 'بدل انتقال', en: 'Transport allowance' },
        kind: 'earning',
        calcBasis: 'fixed',
      })
    ).body.data as PayItemDto;
    retired = (
      await post({
        code: 'RETIRED_ITEM',
        name: { ar: 'بند ملغى', en: 'Retired item' },
        kind: 'earning',
        calcBasis: 'fixed',
      })
    ).body.data as PayItemDto;
    retired = (await patch(retired.id, { status: 'archived', version: retired.version })).body
      .data as PayItemDto;

    // Three callers, reusing the EXISTING compensation keys — PY-2 declares none of its own.
    const manageRole = await rbacService.ensureManagedRole(
      'py2-compensation-manager',
      { en: 'Compensation manager', ar: 'مسؤول الأجور' },
      // Deliberately WITHOUT `payItem.view`: the API needs only the compensation keys, and this
      // role is what proves it. (The Add dialog reads the catalog, which is a screen concern.)
      ['employee.view', 'employee.viewCompensation', 'employee.manageCompensation'],
    );
    const viewRole = await rbacService.ensureManagedRole(
      'py2-compensation-viewer',
      { en: 'Compensation viewer', ar: 'مطّلع على الأجور' },
      ['employee.view', 'employee.viewCompensation'],
    );

    const managerId = await mkScopedUser('py2-manager@ecms.local', BRANCH_A);
    await rbacService.ensureAssignment(managerId, String(manageRole._id), 'organization');
    managerToken = await login('py2-manager@ecms.local');

    const viewerId = await mkScopedUser('py2-viewer@ecms.local', BRANCH_A);
    await rbacService.ensureAssignment(viewerId, String(viewRole._id), 'organization');
    viewerToken = await login('py2-viewer@ecms.local');

    // Same role, BRANCH scope, standing in the other branch — the scope test's whole point.
    const strangerId = await mkScopedUser('py2-other-branch@ecms.local', BRANCH_B);
    await rbacService.ensureAssignment(strangerId, String(manageRole._id), 'branch');
    otherBranchToken = await login('py2-other-branch@ecms.local');
  }, 120_000);

  it('assigns an item to an employee over an open-ended interval', async () => {
    const created = await assign({
      payItemId: bonus.id,
      amount: 1500.25,
      effectiveFrom: '2026-03-01',
    });
    expect(created.status).toBe(201);
    const dto = created.body.data as EmployeePayItemDto;
    expect(dto.employeeId).toBe(employeeId);
    expect(dto.amount).toBe(1500.25);
    expect(dto.currency).toBe('EGP');
    expect(dto.effectiveTo).toBeNull();
    // The catalog row travels with the assignment so a screen can name it without a second read.
    expect(dto.payItem?.code).toBe('BONUS');
    // Payroll v1 has no statutory rule, and the place one would first appear is this payload.
    for (const forbidden of ['taxable', 'tax', 'socialInsurance', 'net', 'gross']) {
      expect(dto, forbidden).not.toHaveProperty(forbidden);
    }

    const listed = await items();
    expect(listed.status).toBe(200);
    expect((listed.body.data as EmployeePayItemDto[]).map((r) => r.id)).toContain(dto.id);
  });

  it('refuses an employee that does not exist', async () => {
    const missing = await assign(
      { payItemId: bonus.id, amount: 100, effectiveFrom: '2026-03-01' },
      '507f1f77bcf86cd799439099',
    );
    expect(missing.status).toBe(404);
    expect((await items('507f1f77bcf86cd799439099')).status).toBe(404);
  });

  it('refuses a pay item that does not exist', async () => {
    const missing = await assign({
      payItemId: '507f1f77bcf86cd799439099',
      amount: 100,
      effectiveFrom: '2026-03-01',
    });
    expect(missing.status).toBe(404);
  });

  // Archiving is how an organization says "we no longer pay this". If a new assignment could
  // still cite an archived item, the archive would be advisory.
  it('refuses an archived pay item for a NEW assignment', async () => {
    const refused = await assign({
      payItemId: retired.id,
      amount: 100,
      effectiveFrom: '2026-03-01',
    });
    expect(refused.status).toBe(422);
  });

  it('refuses an interval that overlaps one already recorded, and accepts one that does not', async () => {
    // BONUS is already assigned open-ended from 2026-03-01 — everything after it overlaps.
    for (const interval of [
      { effectiveFrom: '2026-03-01' },
      { effectiveFrom: '2026-06-01' },
      { effectiveFrom: '2026-01-01', effectiveTo: '2026-03-01' },
      // Inside employment (hired 2024-01-01) on purpose: PY-3's D3 rule refuses anything before
      // the hire date with a 422, which would stop this case ever reaching the overlap guard.
      { effectiveFrom: '2024-06-01' },
    ]) {
      const clash = await assign({ payItemId: bonus.id, amount: 200, ...interval });
      expect(clash.status, JSON.stringify(interval)).toBe(409);
    }

    // Strictly before it, ending the day before it starts: no overlap, so it is accepted.
    const earlier = await assign({
      payItemId: bonus.id,
      amount: 900,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-02-28',
    });
    expect(earlier.status).toBe(201);
  });

  // The dates decide what DELETE means, and history is never what leaves.
  it('removes a future assignment but only ENDS one that has already started', async () => {
    const future = await assign({
      payItemId: transport.id,
      amount: 300,
      effectiveFrom: iso(addDays(today(), 30)),
      effectiveTo: iso(addDays(today(), 60)),
    });
    expect(future.status).toBe(201);
    const futureId = (future.body.data as EmployeePayItemDto).id;
    const removed = await unassign(futureId);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ outcome: 'removed', item: null });
    expect((await items()).body.data as EmployeePayItemDto[]).not.toContainEqual(
      expect.objectContaining({ id: futureId }),
    );

    const started = await assign({
      payItemId: transport.id,
      amount: 400,
      effectiveFrom: iso(addDays(today(), -10)),
      effectiveTo: iso(addDays(today(), -5)),
    });
    expect(started.status).toBe(201);
    const startedId = (started.body.data as EmployeePayItemDto).id;
    // Already closed before today: nothing to do, and above all nothing removed.
    const past = await unassign(startedId);
    expect(past.status).toBe(200);
    expect((past.body.data as { outcome: string }).outcome).toBe('alreadyEnded');

    const live = await assign({
      payItemId: transport.id,
      amount: 500,
      effectiveFrom: iso(addDays(today(), -3)),
      effectiveTo: iso(addDays(today(), 30)),
    });
    expect(live.status).toBe(201);
    const liveId = (live.body.data as EmployeePayItemDto).id;
    const ended = await unassign(liveId);
    expect(ended.status).toBe(200);
    const result = ended.body.data as { outcome: string; item: EmployeePayItemDto };
    expect(result.outcome).toBe('ended');
    expect(result.item.effectiveTo).toBe(iso(today()));
    // The row STAYS — payroll will have to explain what it already paid.
    expect((await items()).body.data as EmployeePayItemDto[]).toContainEqual(
      expect.objectContaining({ id: liveId }),
    );
  });

  // PY-1 deferred this guard to the phase that created the first consumer. This is that phase.
  it('refuses to delete a catalog item that an employee is assigned', async () => {
    const refused = await request(app)
      .delete(`/api/v1/hr/payroll/pay-items/${bonus.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(refused.status).toBe(422);
  });

  it('reads with the view key and writes only with the manage key', async () => {
    expect((await items(employeeId, viewerToken)).status).toBe(200);
    const refused = await assign(
      { payItemId: bonus.id, amount: 100, effectiveFrom: '2030-01-01' },
      employeeId,
      viewerToken,
    );
    expect(refused.status).toBe(403);
  });

  it('refuses every route to a caller with neither compensation key', async () => {
    expect((await items(employeeId, outsiderToken)).status).toBe(403);
    expect(
      (
        await assign(
          { payItemId: bonus.id, amount: 100, effectiveFrom: '2030-01-01' },
          employeeId,
          outsiderToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await unassign('507f1f77bcf86cd799439011', employeeId, outsiderToken)).status,
    ).toBe(403);
  });

  // Holding the key is not the same as reaching the employee: the scope is spent on the subject,
  // so an out-of-branch caller is told the employee is not there, not that the item is.
  it('cannot reach an employee outside the caller’s compensation scope', async () => {
    expect((await items(employeeId, otherBranchToken)).status).toBe(404);
    expect(
      (
        await assign(
          { payItemId: bonus.id, amount: 100, effectiveFrom: '2030-01-01' },
          employeeId,
          otherBranchToken,
        )
      ).status,
    ).toBe(404);
  });
});

// ── PY-3 — compensation effects ─────────────────────────────────────────────
//
// The rules themselves are exercised without a database in `compensation-rules.spec.ts`; what has
// to be proven HERE is the wiring: that the calculation reads the employee, the assignments and
// the catalog through the caller's compensation scope, that its three refusals reach the client as
// refusals, and that D3's employment-period rule now guards the assignment path it was added to.
describe('compensation effects', () => {
  let BRANCH = '';
  let DEPARTMENT_ID = '';
  let JOB_TITLE_ID = '';
  let bonus: PayItemDto;
  let percentItem: PayItemDto;
  let perDayItem: PayItemDto;
  let loan: PayItemDto;
  let managerToken = '';
  let nid = 500;
  let phone = 71_000_000;

  const regEmployee = async (over: Record<string, unknown> = {}): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: {
            fullNameAr: 'موظف الحساب',
            nationalId: `290010103${String(nid++)}10`,
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: `011${String(phone++)}` },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
          salary: { amount: 10_000, currency: 'EGP' },
          ...(over.employment as object | undefined),
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
        entryStatus: 'active',
      });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };

  const assign = (employeeId: string, body: object, token = managerToken) =>
    request(app)
      .post(`/api/v1/hr/employees/${employeeId}/pay-items`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const effects = (employeeId: string, period = '2026-03', token = managerToken) =>
    request(app)
      .get(`/api/v1/hr/employees/${employeeId}/compensation?period=${period}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const branch = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'PY3A', name: { ar: 'المركز', en: 'HQ' } });
    BRANCH = (branch.body as { data: { id: string } }).data.id;
    const dep = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-PY3', name: { ar: 'إدارة', en: 'Ops' }, branchId: BRANCH });
    DEPARTMENT_ID = (dep.body as { data: { id: string } }).data.id;
    const title = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-PY3', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G6' });
    JOB_TITLE_ID = (title.body as { data: { id: string } }).data.id;

    const mkItem = async (body: object): Promise<PayItemDto> =>
      (await post(body)).body.data as PayItemDto;
    bonus = await mkItem({
      code: 'PY3_FIXED',
      name: { ar: 'بدل ثابت', en: 'Fixed allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
    percentItem = await mkItem({
      code: 'PY3_PERCENT',
      name: { ar: 'نسبة', en: 'Percentage' },
      kind: 'earning',
      calcBasis: 'percentOfBase',
    });
    perDayItem = await mkItem({
      code: 'PY3_PER_DAY',
      name: { ar: 'باليوم', en: 'Per day' },
      kind: 'earning',
      calcBasis: 'perDay',
    });
    loan = await mkItem({
      code: 'PY3_LOAN',
      name: { ar: 'قسط', en: 'Loan instalment' },
      kind: 'deduction',
      calcBasis: 'fixed',
    });

    // Same role shape as PY-2's: the compensation keys and nothing else.
    const role = await rbacService.ensureManagedRole('py2-compensation-manager', {
      en: 'Compensation manager',
      ar: 'مسؤول الأجور',
    }, ['employee.view', 'employee.viewCompensation', 'employee.manageCompensation']);
    const { user } = await userService.create(
      {
        email: 'py3-manager@ecms.local',
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId: BRANCH, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));
    await rbacService.ensureAssignment(String(user._id), String(role._id), 'organization');
    managerToken = await login('py3-manager@ecms.local');
  }, 120_000);

  it('prices a fixed item over a whole month', async () => {
    const employeeId = await regEmployee();
    expect(
      (await assign(employeeId, { payItemId: bonus.id, amount: 3000, effectiveFrom: '2026-03-01' }))
        .status,
    ).toBe(201);

    const res = await effects(employeeId);
    expect(res.status).toBe(200);
    const data = res.body.data as CompensationEffectsDto;
    expect(data.period).toBe('2026-03');
    expect(data.from).toBe('2026-03-01');
    expect(data.to).toBe('2026-03-31');
    expect(data.daysInPeriod).toBe(31);
    expect(data.currency).toBe('EGP');
    expect(data.basicSalary).toBe(10_000);
    expect(data.earnings).toHaveLength(1);
    expect(data.earnings[0]?.amount).toBe(3000);
    expect(data.earnings[0]?.prorationFactor).toBe(1);
    expect(data.net).toBe(3000);
    // Nothing statutory exists, so nothing statutory may appear in the payload.
    expect(JSON.stringify(data).toLowerCase()).not.toContain('tax');
    expect(JSON.stringify(data).toLowerCase()).not.toContain('insurance');
  });

  it('prorates by calendar days when the item starts mid-month', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: bonus.id, amount: 3000, effectiveFrom: '2026-03-16' });
    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.earnings[0]?.daysInForce).toBe(16);
    expect(data.earnings[0]?.amount).toBe(1548.39); // 3000 × 16/31
  });

  it('reads percentOfBase against the basic salary, and nets a deduction off the earnings', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: percentItem.id, amount: 10, effectiveFrom: '2026-03-01' });
    await assign(employeeId, { payItemId: loan.id, amount: 400, effectiveFrom: '2026-03-01' });

    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.earnings[0]?.amount).toBe(1000); // 10% of 10,000
    expect(data.deductions[0]?.code).toBe('PY3_LOAN');
    expect(data.totalEarnings).toBe(1000);
    expect(data.totalDeductions).toBe(400);
    expect(data.net).toBe(600);
  });

  it('shows a per-day item as pending and keeps it out of every total (D7)', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: perDayItem.id, amount: 250, effectiveFrom: '2026-03-01' });
    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.deferred).toHaveLength(1);
    expect(data.deferred[0]?.state).toBe('pendingQuantity');
    expect(data.deferred[0]?.amount).toBeNull();
    expect(data.earnings).toEqual([]);
    expect(data.totalEarnings).toBe(0);
  });

  it('warns that the older allowance list is not counted (D1)', async () => {
    const employeeId = await regEmployee({
      employment: { allowances: [{ name: 'Housing', amount: 500, currency: 'EGP' }] },
    });
    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.warnings).toContain('legacyAllowancesIgnored');
    expect(data.totalEarnings).toBe(0); // ignored, not added
  });

  it('reports a negative net rather than flooring it (D4)', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: loan.id, amount: 900, effectiveFrom: '2026-03-01' });
    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.net).toBe(-900);
    expect(data.warnings).toContain('netBelowZero');
  });

  it('refuses an employee with no basic salary rather than treating it as zero', async () => {
    const employeeId = await regEmployee({ employment: { salary: null } });
    expect((await effects(employeeId)).status).toBe(422);
  });

  it('refuses the whole calculation when an item is in another currency', async () => {
    const employeeId = await regEmployee();
    expect(
      (
        await assign(employeeId, {
          payItemId: bonus.id,
          amount: 100,
          currency: 'USD',
          effectiveFrom: '2026-03-01',
        })
      ).status,
    ).toBe(201);
    expect((await effects(employeeId)).status).toBe(422);
  });

  it('refuses a period that is not YYYY-MM', async () => {
    const employeeId = await regEmployee();
    for (const period of ['2026-13', '2026', 'March']) {
      expect((await effects(employeeId, period)).status, period).toBe(400);
    }
  });

  it('produces nothing for a period before the employee was hired', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: bonus.id, amount: 3000, effectiveFrom: '2024-01-01' });
    const data = (await effects(employeeId, '2023-06')).body.data as CompensationEffectsDto;
    expect(data.employmentDaysInPeriod).toBe(0);
    expect(data.earnings).toEqual([]);
    expect(data.net).toBe(0);
  });

  // D3 — the rule PY-3 added to the assignment path.
  it('refuses an assignment that starts before the hire date', async () => {
    const employeeId = await regEmployee();
    const refused = await assign(employeeId, {
      payItemId: bonus.id,
      amount: 100,
      effectiveFrom: '2023-01-01',
    });
    expect(refused.status).toBe(422);
  });

  // D2 + D3 together, on a real exit: the open span closes, so a new open-ended assignment is
  // refused, and an existing one is CLIPPED by the calculation without anything being rewritten.
  it('closes the span on exit — refusing new open assignments and clipping the running one', async () => {
    const employeeId = await regEmployee();
    await assign(employeeId, { payItemId: bonus.id, amount: 3100, effectiveFrom: '2026-03-01' });

    const before = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const exited = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/actions/exit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'resignation',
        eligibleForRehire: true,
        effectiveDate: '2026-03-10T00:00:00.000Z',
        version: (before.body.data as { version: number }).version,
      });
    expect(exited.status).toBe(201);

    // The calculation clips at the last employed day — 10 of 31 — and writes nothing to say so.
    const data = (await effects(employeeId)).body.data as CompensationEffectsDto;
    expect(data.employmentDaysInPeriod).toBe(10);
    expect(data.earnings[0]?.daysInForce).toBe(10);
    expect(data.earnings[0]?.amount).toBe(1000); // 3100 × 10/31

    const stillOpen = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/pay-items`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect((stillOpen.body.data as { effectiveTo: string | null }[])[0]?.effectiveTo).toBeNull();

    // …and a NEW open-ended assignment is refused, because employment no longer is.
    const refused = await assign(employeeId, {
      payItemId: loan.id,
      amount: 50,
      effectiveFrom: '2026-03-05',
    });
    expect(refused.status).toBe(422);
  });

  it('refuses a caller without the compensation key, and hides an employee out of scope', async () => {
    const employeeId = await regEmployee();
    expect((await effects(employeeId, '2026-03', outsiderToken)).status).toBe(403);
    expect((await effects('507f1f77bcf86cd799439099')).status).toBe(404);
  });
});
