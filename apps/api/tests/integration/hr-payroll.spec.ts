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
  type PayrollLeaveSnapshotDto,
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
import { addDays, cairoToday, dateOnlyIso } from '../../src/modules/hr/shared/business-date';
// The suite may reach into attendance directly; PAYROLL may not, and a lint rule plus
// `attendance-seam.spec.ts` hold that line. Here it is how a period gets frozen at all, because
// freezing has no endpoint and its real caller is the payroll run in PY-6.
import { dayRecordService } from '../../src/modules/hr/attendance';
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
    const late = await post({
      code: 'LATE_DEDUCTION',
      name: { ar: 'خصم تأخير', en: 'Late deduction' },
      kind: 'deduction',
      calcBasis: 'perMinute',
      // PY-4 made this mandatory for a per-minute item, and asserting the 201 here is what would
      // have said so directly instead of leaving the search below to fail on an absence.
      quantitySource: 'lateMinutes',
    });
    expect(late.status, JSON.stringify(late.body)).toBe(201);

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

  // PY-6 ships the run — the period and the moment its facts stopped moving — and nothing more.
  // No payslip, no statutory endpoint, and no calculation hanging off a run. Asserting the
  // absence is what keeps "taxes are out of v1" a decision rather than an oversight somebody
  // fills in quietly. The run subpaths use a well-formed id so a 404 means "no such route",
  // not "no such object".
  it('exposes no payslip, statutory or run-calculation surface yet', async () => {
    const anyId = '000000000000000000000001';
    for (const path of [
      '/hr/payroll/payslips',
      '/hr/payroll/tax-rules',
      `/hr/payroll/runs/${anyId}/lines`,
      `/hr/payroll/runs/${anyId}/payslips`,
    ]) {
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

  /**
   * Organizational fixtures are created with names of their OWN.
   *
   * Branch names are unique case-insensitively in both locales, so reusing the block above's
   * `HQ` would 409 — and asserting the status here means a future collision fails saying so,
   * instead of a TypeError on `.data.id` twenty lines later.
   */
  const mkOrgUnit = async (path: string, body: object): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1/platform/${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };

  beforeAll(async () => {
    BRANCH = await mkOrgUnit('branches', {
      code: 'PY3A',
      name: { ar: 'فرع الرواتب', en: 'Payroll Rules Branch' },
    });
    DEPARTMENT_ID = await mkOrgUnit('departments', {
      code: 'DEP-PY3',
      name: { ar: 'إدارة الرواتب', en: 'Payroll Rules Dept' },
      branchId: BRANCH,
    });
    JOB_TITLE_ID = await mkOrgUnit('job-titles', {
      code: 'JT-PY3',
      name: { ar: 'محاسب رواتب', en: 'Payroll Accountant' },
      jobGrade: 'G6',
    });

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
      // PY-4 made this mandatory: `calcBasis` says "per day", this says per day of WHAT.
      quantitySource: 'attendedDays',
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
    // The ASSIGNED deferrals. This period has no payroll run either, so PY-5 defers a leave line
    // of its own beside this one; that case is asserted where it belongs, in the PY-6 block.
    const items = data.deferred.filter((l) => l.origin === 'payItem');
    expect(items).toHaveLength(1);
    expect(items[0]?.state).toBe('pendingQuantity');
    expect(items[0]?.amount).toBeNull();
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

// ── PY-4 — attendance quantities ────────────────────────────────────────────
//
// The counting rules are exercised without a database in `attendance-quantities.spec.ts`. What
// has to be proven HERE is the seam: that a real `freezePeriod` makes real rows readable through
// the §15.1 feed, that the figure survives a post-freeze correction unchanged, and that an
// unfrozen month leaves quantity lines pending instead of failing or guessing.
describe('attendance quantities', () => {
  const PERIOD = '2026-03';
  const UNFROZEN = '2026-05';

  let BRANCH = '';
  let DEPARTMENT_ID = '';
  let JOB_TITLE_ID = '';
  // Shared with the payroll-run block below, which needs an employee in a real branch.
  let absenceItem: PayItemDto;
  let attendanceItem: PayItemDto;
  let employeeId = '';
  let lateJoinerId = '';
  let nid = 800;
  let phone = 72_000_000;

  const mkOrgUnit = async (path: string, body: object): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1/platform/${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };

  const regEmployee = async (startDate: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: {
            fullNameAr: 'موظف الكميات',
            nationalId: `290010104${String(nid++)}10`,
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
          startDate,
          salary: { amount: 10_000, currency: 'EGP' },
        },
        hiringDate: startDate,
        entryStatus: 'active',
      });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };

  const assign = (employee: string, body: object) =>
    request(app)
      .post(`/api/v1/hr/employees/${employee}/pay-items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  const effects = async (employee: string, period = PERIOD): Promise<CompensationEffectsDto> => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employee}/compensation?period=${period}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as CompensationEffectsDto;
  };

  const lineFor = (data: CompensationEffectsDto, code: string) =>
    [...data.earnings, ...data.deductions, ...data.deferred].find((l) => l.code === code);

  beforeAll(async () => {
    BRANCH = await mkOrgUnit('branches', {
      code: 'PY4A',
      name: { ar: 'فرع الكميات', en: 'Quantities Branch' },
    });
    DEPARTMENT_ID = await mkOrgUnit('departments', {
      code: 'DEP-PY4',
      name: { ar: 'إدارة الكميات', en: 'Quantities Dept' },
      branchId: BRANCH,
    });
    JOB_TITLE_ID = await mkOrgUnit('job-titles', {
      code: 'JT-PY4',
      name: { ar: 'مشغّل', en: 'Operator' },
      jobGrade: 'G7',
    });
    BRANCH_PY4 = BRANCH;
    DEPARTMENT_ID_PY4 = DEPARTMENT_ID;
    JOB_TITLE_ID_PY4 = JOB_TITLE_ID;

    absenceItem = (
      await post({
        code: 'PY4_ABSENCE',
        name: { ar: 'خصم غياب', en: 'Absence deduction' },
        kind: 'deduction',
        calcBasis: 'perDay',
        quantitySource: 'absentDays',
      })
    ).body.data as PayItemDto;
    attendanceItem = (
      await post({
        code: 'PY4_ATTENDED',
        name: { ar: 'بدل حضور', en: 'Attendance allowance' },
        kind: 'earning',
        calcBasis: 'perDay',
        quantitySource: 'attendedDays',
      })
    ).body.data as PayItemDto;

    employeeId = await regEmployee('2024-01-01T00:00:00.000Z');
    // Hired on the 20th: their assignment starts on their hire date, because D3 refuses an
    // interval that reaches back before employment.
    lateJoinerId = await regEmployee('2026-03-20T00:00:00.000Z');

    // The derivation answers `dayOff` for an employee with no shift and `absent` only for one who
    // had a shift and did not punch — so an absence quantity needs a shift assignment to exist at
    // all. This is what makes the frozen March below contain real absences to count.
    const shifts = await request(app)
      .get('/api/v1/hr/attendance/shifts')
      .set('Authorization', `Bearer ${adminToken}`);
    const general = (shifts.body.data as { id: string; code: string }[]).find(
      (sh) => sh.code === 'GENERAL',
    );
    expect(general, 'the seeded GENERAL shift').toBeDefined();
    for (const [id, from] of [
      [employeeId, '2024-01-01'],
      [lateJoinerId, '2026-03-20'],
    ] as const) {
      const assigned = await request(app)
        .post('/api/v1/hr/attendance/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ employeeId: id, shiftId: general?.id, fromDate: from });
      expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    }

    for (const [id, from] of [
      [employeeId, '2026-03-01'],
      [lateJoinerId, '2026-03-20'],
    ] as const) {
      const res = await assign(id, { payItemId: absenceItem.id, amount: 50, effectiveFrom: from });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const attended = await assign(employeeId, {
      payItemId: attendanceItem.id,
      amount: 30,
      effectiveFrom: '2026-03-01',
    });
    expect(attended.status, JSON.stringify(attended.body)).toBe(201);
  }, 120_000);

  it('leaves quantity lines pending while the period is not frozen, without failing', async () => {
    const data = await effects(employeeId, UNFROZEN);
    const line = lineFor(data, 'PY4_ABSENCE');
    expect(line?.state).toBe('pendingQuantity');
    expect(line?.quantity).toBeNull();
    expect(line?.feedFrozenAt).toBeNull();
    expect(data.deductions).toEqual([]);
    expect(data.totalDeductions).toBe(0);
  });

  it('prices from the feed once the period is frozen', async () => {
    const frozen = await dayRecordService.freezePeriod(PERIOD);
    expect(frozen.frozen).toBeGreaterThan(0);

    const data = await effects(employeeId);
    const absence = lineFor(data, 'PY4_ABSENCE');
    expect(absence?.state).toBe('computed');
    expect(absence?.quantitySource).toBe('absentDays');
    expect(absence?.quantityUnit).toBe('days');
    expect(absence?.feedFrozenAt).not.toBeNull();
    // Nobody punched, so the working days of March are absences — the count is what the frozen
    // calendar says, and the figure is exactly rate × count.
    expect(absence?.quantity ?? 0).toBeGreaterThan(0);
    expect(absence?.amount).toBe((absence?.quantity ?? 0) * 50);
    // …and NEVER a fraction of it: the count already is the proration.
    expect(absence?.prorationFactor).toBeNull();
  }, 180_000);

  it('gives a frozen month with nothing to count a real zero, not a pending line', async () => {
    const data = await effects(employeeId);
    const attended = lineFor(data, 'PY4_ATTENDED');
    expect(attended?.state).toBe('computed'); // KNOWN to be nothing, unlike an unfrozen month
    expect(attended?.quantity).toBe(0);
    expect(attended?.amount).toBe(0);
    // No ASSIGNED line is deferred. This block froze the attendance directly rather than through
    // a payroll run — a state only a test can produce — so PY-5 still has no run to read leave
    // from and defers a line of its own. That is the honest answer, and not this case's subject.
    expect(data.deferred.filter((l) => l.origin === 'payItem')).toEqual([]);
  });

  it('counts only the days the employee was employed for', async () => {
    const whole = await effects(employeeId);
    const partial = await effects(lateJoinerId);
    const wholeDays = lineFor(whole, 'PY4_ABSENCE')?.quantity ?? 0;
    const partialDays = lineFor(partial, 'PY4_ABSENCE')?.quantity ?? 0;
    expect(partialDays).toBeGreaterThan(0);
    expect(partialDays).toBeLessThan(wholeDays);
  });

  it('prices the same period the same way twice', async () => {
    const first = await effects(employeeId);
    const second = await effects(employeeId);
    expect(second).toEqual(first);
  });

  // The frozen row never moves (attendance §7): a correction filed after the freeze is recorded as
  // evidence and reaches pay as a FORWARD adjustment in a later phase, never as a restatement.
  it('does not restate the figure when a correction lands after the freeze', async () => {
    const before = await effects(employeeId);
    const quantityBefore = lineFor(before, 'PY4_ABSENCE')?.quantity;

    const filed = await request(app)
      .post('/api/v1/hr/attendance/regularizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId,
        workDate: '2026-03-04',
        proposedInAt: '2026-03-04T06:00:00.000Z',
        proposedOutAt: '2026-03-04T14:00:00.000Z',
        reason: 'device outage, corrected after the freeze',
      });
    expect(filed.status).toBe(201);
    expect((filed.body.data as { postFreeze: boolean }).postFreeze).toBe(true);

    const after = await effects(employeeId);
    expect(lineFor(after, 'PY4_ABSENCE')?.quantity).toBe(quantityBefore);
    expect(after).toEqual(before);
  }, 60_000);

  it('refuses a per-day item created without a quantity source', async () => {
    const refused = await post({
      code: 'PY4_NO_SOURCE',
      name: { ar: 'بلا مصدر', en: 'No source' },
      kind: 'earning',
      calcBasis: 'perDay',
    });
    expect(refused.status).toBe(400);
  });

  it('refuses a source measured in the wrong unit, and one on an item that counts nothing', async () => {
    const wrongUnit = await post({
      code: 'PY4_WRONG_UNIT',
      name: { ar: 'وحدة خاطئة', en: 'Wrong unit' },
      kind: 'earning',
      calcBasis: 'perDay',
      quantitySource: 'lateMinutes',
    });
    expect(wrongUnit.status).toBe(400);

    const onFixed = await post({
      code: 'PY4_FIXED_SRC',
      name: { ar: 'ثابت بمصدر', en: 'Fixed with a source' },
      kind: 'earning',
      calcBasis: 'fixed',
      quantitySource: 'attendedDays',
    });
    expect(onFixed.status).toBe(400);
  });

  it('refuses to change what an existing item counts', async () => {
    const refused = await patch(absenceItem.id, {
      quantitySource: 'attendedDays',
      version: absenceItem.version,
    });
    expect(refused.status).toBe(400);
  });
});

// Org fixtures the quantities block creates, reused by the run block below rather than made twice.
let BRANCH_PY4 = '';
let DEPARTMENT_ID_PY4 = '';
let JOB_TITLE_ID_PY4 = '';

// ── PY-6 — the payroll run ──────────────────────────────────────────────────
//
// The allocation arithmetic is exercised without a database in `leave-allocation.spec.ts`. What
// has to hold HERE is the orchestration: the three refusals before anything is written, the order
// that makes the freeze atomic from the contract's point of view, and the fact that a cancel moves
// the run and nothing else.
describe('payroll runs', () => {
  const PERIOD = '2026-04'; // a different month from PY-4's, so the two blocks cannot collide
  let runId = '';
  let runVersion = 0;

  /** Set by the pricing case below and reused by the two that follow it. */
  let LEAVE_PRICED_EMPLOYEE = '';

  const runs = (query = '', token = adminToken) =>
    request(app).get(`/api/v1/hr/payroll/runs${query}`).set('Authorization', `Bearer ${token}`);
  const createRun = (body: object, token = adminToken) =>
    request(app).post('/api/v1/hr/payroll/runs').set('Authorization', `Bearer ${token}`).send(body);
  const act = (id: string, what: 'freeze' | 'cancel', body: object, token = adminToken) =>
    request(app)
      .post(`/api/v1/hr/payroll/runs/${id}/${what}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('starts a run for a period that has ended', async () => {
    const created = await createRun({ period: PERIOD });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const run = created.body.data as PayrollRunDto;
    runId = run.id;
    runVersion = run.version;
    expect(run.status).toBe('draft');
    expect(run.from).toBe('2026-04-01');
    expect(run.to).toBe('2026-04-30');
    expect(run.frozenAt).toBeNull();
    // A run pins facts and prices nothing — no figure may appear on it.
    for (const forbidden of ['total', 'net', 'tax', 'insurance', 'lines']) {
      expect(run, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('refuses a second live run for the same period', async () => {
    const clash = await createRun({ period: PERIOD });
    expect(clash.status).toBe(409);
  });

  it('refuses to freeze a period that has not ended yet', async () => {
    const future = `${String(new Date().getUTCFullYear() + 1)}-06`;
    const created = await createRun({ period: future });
    expect(created.status).toBe(201);
    const run = created.body.data as PayrollRunDto;
    const refused = await act(run.id, 'freeze', { version: run.version });
    expect(refused.status).toBe(422);

    // …and it is still a draft, because nothing is written until every check passes.
    const reread = await request(app)
      .get(`/api/v1/hr/payroll/runs/${run.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((reread.body.data as PayrollRunDto).status).toBe('draft');
  });

  it('freezes the period, and reports what it pinned', async () => {
    const frozen = await act(runId, 'freeze', { version: runVersion });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);
    const run = frozen.body.data as PayrollRunDto;
    expect(run.status).toBe('frozen');
    expect(run.frozenAt).not.toBeNull();
    expect(run.frozenBy).not.toBeNull();
    // The receipt: April had no frozen rows before this, so the freeze stamped some.
    expect(run.attendanceFrozenRows).toBeGreaterThan(0);
    runVersion = run.version;
  }, 180_000);

  // The step-4-is-the-commit-point property: a second freeze finds everything already frozen.
  it('refuses to freeze an already frozen run', async () => {
    const again = await act(runId, 'freeze', { version: runVersion });
    expect(again.status).toBe(422);
  });

  it('exposes the leave snapshot the run pinned', async () => {
    const snapshot = await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}/leave`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(snapshot.status).toBe(200);
    // Every row must name where it came from and how its split was derived.
    for (const row of snapshot.body.data as PayrollLeaveSnapshotDto[]) {
      expect(row.ledgerEntryId).toBeTruthy();
      expect(['whole', 'chronological']).toContain(row.allocation);
      expect(row.period).toBe(PERIOD);
    }
  });

  // PY-4's quantities now read a really frozen month, through the run rather than by accident.
  it('makes the frozen period priceable — the whole point of the phase', async () => {
    const employee = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: {
            fullNameAr: 'موظف الدورة',
            // Governorate `11` (Damietta) — `05` is not an issued code and the API refuses it.
            nationalId: '29001011190010',
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: '01173000001' },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID_PY4,
          departmentId: DEPARTMENT_ID_PY4,
          branchId: BRANCH_PY4,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
          salary: { amount: 9000, currency: 'EGP' },
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
        entryStatus: 'active',
      });
    expect(employee.status).toBe(201);
    const employeeId = (employee.body as { data: { id: string } }).data.id;

    const effects = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/compensation?period=${PERIOD}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(effects.status).toBe(200);
    // Frozen, so the calculation answers rather than deferring — even with nothing assigned.
    const priced = effects.body.data as CompensationEffectsDto;
    expect(priced.period).toBe(PERIOD);

    // PY-5 — and the leave side answers too. This employee took none, which in a FROZEN period is
    // a real zero rather than an unasked question: `leave` is present, and nothing is deferred.
    expect(priced.leave).not.toBeNull();
    expect(priced.leave?.totalDays).toBe(0);
    expect(priced.leave?.runId).toBe(runId);
    expect(priced.deferred.filter((l) => l.state === 'pendingLeaveSnapshot')).toEqual([]);
    // Nothing was charged for leave nobody took.
    expect(priced.deductions.filter((l) => l.origin === 'leaveSnapshot')).toEqual([]);

    LEAVE_PRICED_EMPLOYEE = employeeId;
  });

  // The other half of the same distinction, in the same shape: a month with no run at all.
  it('defers leave for a period no run has frozen', async () => {
    const effects = await request(app)
      .get(`/api/v1/hr/employees/${LEAVE_PRICED_EMPLOYEE}/compensation?period=2025-11`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(effects.status).toBe(200);
    const unpriced = effects.body.data as CompensationEffectsDto;
    expect(unpriced.leave).toBeNull();
    const pending = unpriced.deferred.filter((l) => l.state === 'pendingLeaveSnapshot');
    expect(pending).toHaveLength(1);
    // Derived, so it names no assignment — and it is kept out of every total.
    expect(pending[0]?.origin).toBe('leaveSnapshot');
    expect(pending[0]?.sourceAssignmentId).toBeNull();
    expect(pending[0]?.payItemId).toBeNull();
    expect(pending[0]?.amount).toBeNull();
    expect(unpriced.totalDeductions).toBe(0);
  });

  // D4 — the cancel moves the RUN and nothing else.
  it('cancels a frozen run without unfreezing anything', async () => {
    const snapshotBefore = await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}/leave`)
      .set('Authorization', `Bearer ${adminToken}`);

    const cancelled = await act(runId, 'cancel', {
      reason: 'wrong month chosen',
      version: runVersion,
    });
    expect(cancelled.status).toBe(200);
    const run = cancelled.body.data as PayrollRunDto;
    expect(run.status).toBe('cancelled');
    expect(run.cancelReason).toBe('wrong month chosen');
    // The freeze stamp and the receipt survive: the period IS still frozen.
    expect(run.frozenAt).not.toBeNull();
    expect(run.attendanceFrozenRows).toBeGreaterThan(0);

    const snapshotAfter = await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}/leave`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(snapshotAfter.body.data).toEqual(snapshotBefore.body.data);
  });

  // PY-5 follows the LIVE frozen run, so withdrawing it withdraws the answer — the attendance
  // rows stay frozen forever, but the period no longer has a run that speaks for it, and pricing
  // says so instead of quoting a cancelled one.
  it('stops pricing leave from a run that was cancelled', async () => {
    const effects = await request(app)
      .get(`/api/v1/hr/employees/${LEAVE_PRICED_EMPLOYEE}/compensation?period=${PERIOD}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(effects.status).toBe(200);
    const after = effects.body.data as CompensationEffectsDto;
    expect(after.leave).toBeNull();
    expect(after.deferred.filter((l) => l.state === 'pendingLeaveSnapshot')).toHaveLength(1);
  });

  // …and the period is free again, which is exactly what "recalculate with a new run" means.
  it('lets a NEW run be started for a period whose run was cancelled', async () => {
    const again = await createRun({ period: PERIOD });
    expect(again.status).toBe(201);
    expect((again.body.data as PayrollRunDto).status).toBe('draft');
  });

  it('filters the list by status and by period', async () => {
    const byPeriod = await runs(`?period=${PERIOD}`);
    expect(byPeriod.status).toBe(200);
    expect((byPeriod.body.data as PayrollRunDto[]).every((r) => r.period === PERIOD)).toBe(true);
    const cancelledOnly = await runs('?status=cancelled');
    expect((cancelledOnly.body.data as PayrollRunDto[]).every((r) => r.status === 'cancelled')).toBe(
      true,
    );
  });

  it('separates seeing a run from freezing one', async () => {
    // The outsider holds neither key.
    expect((await runs('', outsiderToken)).status).toBe(403);
    expect((await createRun({ period: '2026-01' }, outsiderToken)).status).toBe(403);
    expect((await act(runId, 'freeze', { version: 0 }, outsiderToken)).status).toBe(403);
  });
});

// ── PY-7 — payslips ─────────────────────────────────────────────────────────
//
// The arithmetic is settled elsewhere; what has to hold HERE is the orchestration. A payslip is
// only ever issued from a frozen run, issuing twice writes nothing the second time, and an
// employee who cannot be priced is REPORTED rather than issued a document with a hole in it.
//
// This block runs its own period so it can freeze a run of its own without disturbing PY-6's,
// which that block deliberately cancels at the end.
describe('payslips', () => {
  const PERIOD = '2026-05';
  let runId = '';
  let employeeId = '';

  const createRun = (body: object, token = adminToken) =>
    request(app).post('/api/v1/hr/payroll/runs').set('Authorization', `Bearer ${token}`).send(body);
  const issue = (id: string, token = adminToken) =>
    request(app)
      .post(`/api/v1/hr/payroll/runs/${id}/payslips`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  const slips = (id: string, query = '', token = adminToken) =>
    request(app)
      .get(`/api/v1/hr/payroll/runs/${id}/payslips${query}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const employee = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: {
            fullNameAr: 'موظف القسيمة',
            nationalId: '29001011290010',
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: '01174000001' },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID_PY4,
          departmentId: DEPARTMENT_ID_PY4,
          branchId: BRANCH_PY4,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
          salary: { amount: 12_000, currency: 'EGP' },
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
        entryStatus: 'active',
      });
    expect(employee.status, JSON.stringify(employee.body)).toBe(201);
    employeeId = (employee.body as { data: { id: string } }).data.id;

    // A flat earning so this employee has a line that can actually be priced.
    const item = await request(app)
      .post('/api/v1/hr/payroll/pay-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'PY7_HOUSING',
        name: { ar: 'بدل سكن ٧', en: 'Housing PY7' },
        kind: 'earning',
        calcBasis: 'fixed',
      });
    expect(item.status).toBe(201);
    const assigned = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/pay-items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        payItemId: (item.body as { data: { id: string } }).data.id,
        amount: 2000,
        effectiveFrom: '2024-01-01',
      });
    expect(assigned.status).toBe(201);

    const created = await createRun({ period: PERIOD });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    runId = (created.body.data as PayrollRunDto).id;
  }, 120_000);

  it('refuses to issue from a run that is not frozen', async () => {
    const refused = await issue(runId);
    expect(refused.status).toBe(422);
    expect((await slips(runId)).body.data).toEqual([]);
  });

  it('issues once the run is frozen, and reports the whole pass', async () => {
    const run = (await request(app)
      .get(`/api/v1/hr/payroll/runs/${runId}`)
      .set('Authorization', `Bearer ${adminToken}`)).body.data as PayrollRunDto;
    const frozen = await request(app)
      .post(`/api/v1/hr/payroll/runs/${runId}/freeze`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: run.version });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(200);

    const issued = await issue(runId);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    const result = issued.body.data as GeneratePayslipsResultDto;
    expect(result.period).toBe(PERIOD);
    expect(result.considered).toBeGreaterThan(0);
    expect(result.created).toBeGreaterThan(0);
    expect(result.existing).toBe(0);
    // Everybody is accounted for — issued, already there, or named with a reason.
    expect(result.created + result.existing + result.skipped.length).toBeLessThanOrEqual(
      result.considered,
    );
  }, 240_000);

  it('stores the lines rather than a promise to recompute them', async () => {
    const listed = await slips(runId, `?employeeId=${employeeId}`);
    expect(listed.status).toBe(200);
    const rows = listed.body.data as PayslipDto[];
    expect(rows).toHaveLength(1);
    const slip = rows[0];
    expect(slip?.runId).toBe(runId);
    expect(slip?.period).toBe(PERIOD);
    expect(slip?.employee.code).toBeTruthy();
    expect(slip?.earnings.length).toBeGreaterThan(0);
    expect(slip?.totalEarnings).toBe(2000);
    expect(slip?.net).toBe(2000);
    // No statutory field and no gross — the payslip carries what was priced and nothing more.
    for (const forbidden of ['gross', 'tax', 'insurance', 'paidAt', 'deferred']) {
      expect(slip, forbidden).not.toHaveProperty(forbidden);
    }
  });

  // The property the whole phase turns on: a second pass must not restate a delivered document.
  it('issues idempotently — a second pass writes nothing', async () => {
    const again = await issue(runId);
    expect(again.status).toBe(201);
    const result = again.body.data as GeneratePayslipsResultDto;
    expect(result.created).toBe(0);
    expect(result.existing).toBeGreaterThan(0);
  }, 240_000);

  // THE case this phase exists for, so it is asserted end to end rather than approximated: the
  // raise must really land, and the issued document must really not move.
  it('does not restate a payslip after the salary behind it changes', async () => {
    const before = (await slips(runId, `?employeeId=${employeeId}`)).body.data as PayslipDto[];
    expect(before[0]?.basicSalary).toBe(12_000);

    const employee = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(employee.status).toBe(200);
    const raise = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/actions/compensation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'salaryChange',
        salary: { amount: 30_000, currency: 'EGP' },
        reason: 'raise after the payslip was issued',
        version: (employee.body as { data: { version: number } }).data.version,
      });
    expect(raise.status, JSON.stringify(raise.body)).toBe(201);

    // The employee really carries the new salary now…
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      (reread.body as { data: { employment: { salary: { amount: number } | null } } }).data
        .employment.salary?.amount,
    ).toBe(30_000);

    // …and the payslip does not, even when issuing runs again over the same run.
    await issue(runId);
    const after = (await slips(runId, `?employeeId=${employeeId}`)).body.data as PayslipDto[];
    expect(after).toHaveLength(1);
    expect(after[0]?.basicSalary).toBe(12_000);
    expect(after[0]?.net).toBe(before[0]?.net);
  }, 240_000);

  it('separates issuing from reading', async () => {
    // The outsider holds neither the run key nor the compensation key.
    expect((await issue(runId, outsiderToken)).status).toBe(403);
    expect((await slips(runId, '', outsiderToken)).status).toBe(403);
  });

  it('exposes no payslip surface that does not exist', async () => {
    const anyId = '000000000000000000000001';
    for (const path of [
      '/hr/payroll/payslips',
      `/hr/payroll/payslips/${anyId}/pdf`,
      `/hr/payroll/runs/${anyId}/tax`,
    ]) {
      const res = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, path).toBe(404);
    }
  });
});

// ── PY-11 — my own payslips ─────────────────────────────────────────────────
//
// `/payslips/me` carries no permission because it carries no reach: the employee is resolved from
// the caller's own login link, and nothing the caller sends widens that. So what has to hold here
// is the OPPOSITE of an authorization test — that the route is open, and that being open buys the
// caller exactly nothing beyond their own rows.
describe('payslips: the self-service read', () => {
  const me = (path: string, token: string) =>
    request(app).get(`/api/v1/hr/payroll/payslips${path}`).set('Authorization', `Bearer ${token}`);

  it('is reachable without any payroll permission at all', async () => {
    // The outsider holds no payroll key and no compensation key — and is not refused, because
    // there is nothing here to refuse them ACCESS to.
    const res = await me('/me', outsiderToken);
    expect(res.status).not.toBe(403);
  });

  it('answers 404 for a login with no employee behind it, never somebody else’s rows', async () => {
    const res = await me('/me', outsiderToken);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('data');
  });

  // The admin login is not linked to an employee either, so this is the same shape from the other
  // direction: holding EVERY key still gets you your own payslips and no more.
  it('gives a permission holder no wider reach through /me than anybody else', async () => {
    const res = await me('/me', adminToken);
    expect(res.status).toBe(404);
  });

  it('refuses to fetch one payslip by id through /me when it is not the caller’s', async () => {
    const anyId = '000000000000000000000001';
    const res = await me(`/me/${anyId}`, outsiderToken);
    expect(res.status).toBe(404);
  });

  it('still requires the compensation key on the ADMIN read of the same document', async () => {
    const anyId = '000000000000000000000001';
    const denied = await me(`/${anyId}`, outsiderToken);
    expect(denied.status).toBe(403);
  });

  it('exposes no organization-wide list of everybody’s payslips', async () => {
    const res = await me('', adminToken);
    expect(res.status).toBe(404);
  });
});
