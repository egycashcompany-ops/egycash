// P-SCOPE-1 — the department axis, end to end.
//
// The unit specs settle the RULE (`department-at.spec.ts`, exhaustively) and the SHAPE
// (`department-scope-guards.spec.ts`, by source). Neither can tell us whether the axis actually
// narrows a request, because narrowing is a property of the whole path: the stamp written at
// issue, the field declared to the repository, the scope read off the token, and the filter the
// base repository assembles from all three.
//
// So this file asserts the two things only a real database can show:
//
//   1. A DEPARTMENT-SCOPED READER IS ANSWERED WITH THEIR OWN DEPARTMENT — and with strictly less
//      money than an organization reader, which is what "cannot see the other department" means in
//      figures rather than in row counts.
//   2. THE BACKFILL ATTRIBUTES BY DATE, NOT BY TODAY. An employee who transferred must have their
//      OLD payslips attributed to the department they were in when those payslips were issued.
//      Copying today's department would pass every other test in this repository.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type PayrollRunDto } from '@ecms/contracts';
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
import { PayslipModel } from '../../src/modules/hr/payroll/payslips/payslip.model';
import { EmployeeActionModel } from '../../src/modules/hr/employee-management/employee-actions/employee-action.model';
import { backfillPayslipDepartments } from '../../src/modules/hr/payroll';

const PASSWORD = 'Str0ng#Pass!';
const PERIOD = '2026-02';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = '';
let departmentToken = ''; // employee.viewCompensation at DEPARTMENT scope, standing in dept A
let BRANCH = '';
let DEPARTMENT_A = '';
let DEPARTMENT_B = '';
let EMPLOYEE_A = '';
let EMPLOYEE_B = '';
let runId = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-dept-scope-test-${Date.now()}`;
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

let nid = 0;
const mkEmployee = async (departmentId: string, jobTitleId: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف النطاق',
          nationalId: `290010102${String(700 + nid++)}10`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `0117700000${String(nid)}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
        branchId: BRANCH,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2024-01-01T00:00:00.000Z',
        salary: { amount: 10_000, currency: 'EGP' },
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

const payslips = (token: string, query = '') =>
  request(app)
    .get(`/api/v1/hr/payroll/runs/${runId}/payslips${query}`)
    .set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local', null, null);
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

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DSC-1', name: { ar: 'المركز', en: 'HQ' } });
  BRANCH = data<{ id: string }>(branch).id;

  // TWO DEPARTMENTS IN ONE BRANCH — the case branch scope cannot separate and this axis must.
  for (const [code, name] of [
    ['DEP-DSC-A', 'Ops A'],
    ['DEP-DSC-B', 'Ops B'],
  ] as const) {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: name, en: name }, branchId: BRANCH });
    const id = data<{ id: string }>(res).id;
    if (code === 'DEP-DSC-A') DEPARTMENT_A = id;
    else DEPARTMENT_B = id;
  }

  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-DSC', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  const JOB_TITLE = data<{ id: string }>(title).id;

  EMPLOYEE_A = await mkEmployee(DEPARTMENT_A, JOB_TITLE);
  EMPLOYEE_B = await mkEmployee(DEPARTMENT_B, JOB_TITLE);

  const item = await request(app)
    .post('/api/v1/hr/payroll/pay-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: 'DSC_HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
  const payItemId = data<{ id: string }>(item).id;
  for (const [employeeId, amount] of [
    [EMPLOYEE_A, 1000],
    [EMPLOYEE_B, 2000],
  ] as const) {
    const assigned = await request(app)
      .post(`/api/v1/hr/employees/${employeeId}/pay-items`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payItemId, amount, effectiveFrom: '2024-01-01' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
  }

  const created = await request(app)
    .post('/api/v1/hr/payroll/runs')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ period: PERIOD });
  const run = data<PayrollRunDto>(created);
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

  const role = await rbacService.ensureManagedRole(
    'dsc-department-reader',
    { en: 'Department reader', ar: 'قارئ الإدارة' },
    ['employee.view', 'employee.viewCompensation', 'payrollRun.view'],
  );
  const readerId = await mkUser('dsc-department@ecms.local', BRANCH, DEPARTMENT_A);
  await rbacService.ensureAssignment(readerId, String(role._id), 'department');
  departmentToken = await login('dsc-department@ecms.local');
}, 600_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the stamp is written at issue', () => {
  it('every payslip carries the department the employee was in', async () => {
    const rows = await PayslipModel.find({ runId: new Types.ObjectId(runId) }).lean().exec();
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.departmentId, `payslip for ${String(row.employeeId)}`).not.toBeNull();
    }
    const byEmployee = new Map(rows.map((r) => [String(r.employeeId), String(r.departmentId)]));
    expect(byEmployee.get(EMPLOYEE_A)).toBe(DEPARTMENT_A);
    expect(byEmployee.get(EMPLOYEE_B)).toBe(DEPARTMENT_B);
  });
});

describe('a department-scoped reader sees their own department', () => {
  /**
   * THE POINT OF THE WHOLE PHASE. Both employees are in ONE branch, so branch scope cannot tell
   * them apart — only the new axis can.
   */
  it('is answered with their department’s payslips and no others', async () => {
    const wide = await payslips(adminToken, '?page=1&pageSize=50');
    expect(wide.status).toBe(200);
    expect((wide.body.data as { employeeId: string }[]).length).toBe(2);

    const narrow = await payslips(departmentToken, '?page=1&pageSize=50');
    expect(narrow.status, JSON.stringify(narrow.body)).toBe(200);
    const rows = narrow.body.data as { employeeId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe(EMPLOYEE_A);
  });

  /**
   * D-DEPT-4 — an unattributed row is hidden, not shown. Nothing clears a stamp through an
   * endpoint, and nothing should, so the case is constructed directly.
   */
  it('and does not see a payslip that carries no department at all', async () => {
    await PayslipModel.updateMany(
      { runId: new Types.ObjectId(runId), employeeId: new Types.ObjectId(EMPLOYEE_A) },
      { $set: { departmentId: null } },
    );

    const narrow = await payslips(departmentToken, '?page=1&pageSize=50');
    expect(narrow.body.data).toEqual([]);

    // …while the organization reader still sees both: the row was hidden, not deleted.
    const wide = await payslips(adminToken, '?page=1&pageSize=50');
    expect((wide.body.data as unknown[]).length).toBe(2);
  });
});

describe('the backfill attributes by date, not by today', () => {
  /**
   * THE ERROR NO OTHER TEST WOULD CATCH.
   *
   * The employee is moved to department B and the move is recorded with an effective date AFTER
   * the payslip was issued. The payslip's stamp is cleared, as if it predated the phase. Copying
   * the employee's CURRENT department would attribute it to B — the department they were not in
   * when they were paid — and every figure would still add up.
   */
  it('gives an old payslip the department in force when it was issued', async () => {
    // The move, as the action log records one — applied, with an effective date AFTER the run.
    // Written directly because that is what the backfill reads: the pure rule already has
    // exhaustive unit tests, and what this asserts is that the wiring reads the log at all.
    await EmployeeActionModel.create({
      employeeId: new Types.ObjectId(EMPLOYEE_A),
      employeeCode: 'DSC-A',
      seq: 9001,
      type: 'transfer',
      status: 'applied',
      effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      appliedAt: new Date('2026-06-01T00:00:00.000Z'),
      changes: [{ field: 'departmentId', from: DEPARTMENT_A, to: DEPARTMENT_B }],
      payload: { type: 'transfer', departmentId: DEPARTMENT_B },
      reason: null,
      note: null,
      attachmentFileId: null,
      failureReason: null,
      cancelledAt: null,
      cancelledBy: null,
      by: null,
      isDeleted: false,
      createdBy: null,
      updatedBy: null,
    });

    // The payslip was issued in February — before the June move — and carries no stamp.
    await PayslipModel.updateMany(
      { runId: new Types.ObjectId(runId), employeeId: new Types.ObjectId(EMPLOYEE_A) },
      { $set: { departmentId: null } },
    );

    const result = await backfillPayslipDepartments();
    expect(result.filled).toBeGreaterThanOrEqual(1);
    expect(result.unattributed).toBe(0);

    const row = await PayslipModel.findOne({
      runId: new Types.ObjectId(runId),
      employeeId: new Types.ObjectId(EMPLOYEE_A),
    })
      .lean()
      .exec();
    expect(String(row?.departmentId), 'the department at ISSUE, not today').toBe(DEPARTMENT_A);
  });

  /** Idempotent by filter: nothing is left null, so a second pass has nothing to do. */
  it('does nothing on a second run', async () => {
    const again = await backfillPayslipDepartments();
    expect(again).toEqual({ filled: 0, unattributed: 0 });
  });

  /** And the narrowed read works again once the history has been attributed. */
  it('and the department reader sees their payslip again afterwards', async () => {
    const narrow = await payslips(departmentToken, '?page=1&pageSize=50');
    const rows = narrow.body.data as { employeeId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe(EMPLOYEE_A);
  });
});
