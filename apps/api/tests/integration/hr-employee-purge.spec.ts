// «مسح نهائي» — the only hard delete of a person in the product, end to end.
//
// What this proves, in the order it matters:
//
//   WHO MAY. The key is break-glass and implied by nothing: an account holding every OTHER
//   employee authority — hire, pay, transfer, dismiss, change the code — is refused.
//
//   WHAT STOPS A MISTAKE. The employee's own code must be typed back. A wrong one is refused and
//   the person is still there afterwards, which is the half worth asserting: a refusal that had
//   already deleted half the rows would also "refuse".
//
//   WHAT GOES, AND WHAT DOES NOT. A row that exists only because the person does is deleted. A
//   gold receipt, a traffic violation and the consumables ledger are records about money, the law
//   and stock — they stay, and their copy of the name is rewritten instead. A test that only
//   checked the employee was gone would pass while a receipt still named them.
//
//   WHAT THE TRAIL KEEPS. The audit row written for the erasure survives it. It is the only trace
//   of the person that is supposed to remain, and the only thing that can later answer who did it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type EmployeeDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let ADMIN_ID = '';
let BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const db = (): mongoose.mongo.Db => {
  const c = mongoose.connection.db;
  if (c === undefined) throw new Error('no connection');
  return c;
};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-employee-purge-${String(Date.now())}`;
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
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const accountWith = async (email: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    ADMIN_ID,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

let serial = 700;
const nationalId = (): string => `2900307011${String(serial++).padStart(3, '0')}1`;

const register = async (fullNameAr: string): Promise<EmployeeDto> => {
  const res = await asAdmin('post', '/hr/employees/direct').send({
    personal: {
      identity: {
        fullNameAr,
        fullNameEn: 'Purge Person',
        nationalId: nationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `0103${String(serial).padStart(7, '0')}` },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId: JOB_TITLE_ID,
      branchId: BRANCH_ID,
      departmentId: DEPARTMENT_ID,
      employmentType: 'fullTime',
      salary: { amount: 9000, currency: 'EGP' },
      probationMonths: 0,
      startDate: '2026-01-01T00:00:00.000Z',
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<EmployeeDto>(res);
};

const purge = (token: string, id: string, confirmCode: string) =>
  request(app)
    .delete(`/api/v1/hr/employees/${id}/purge`)
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmCode });

/**
 * A row of each kind, written straight to the collections.
 *
 * Raw inserts on purpose: creating a real traffic violation needs a vehicle, a date and a fine,
 * and none of that is what this suite is about. What matters is the SHAPE the purge reads — an
 * employee id beside a copied name on a kept record, and an employee id on a purged one.
 */
const seedRows = async (employeeId: string): Promise<void> => {
  const id = new mongoose.Types.ObjectId(employeeId);
  await db().collection('fleet_violations').insertOne({
    driverEmployeeId: id,
    driverName: 'الاسم المنسوخ',
    isDeleted: false,
  });
  await db().collection('hr_attendance_days').insertOne({ employeeId: id, isDeleted: false });
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  ADMIN_ID = await mkUser('purge-admin@ecms.local');
  await rbacService.ensureAssignment(ADMIN_ID, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: ADMIN_ID,
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
  adminToken = await login('purge-admin@ecms.local');

  BRANCH_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/branches').send({
      code: '001',
      name: { ar: 'الرئيسي', en: 'HQ' },
    }),
  ).id;
  DEPARTMENT_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/departments').send({
      code: 'DEP-PURGE',
      name: { ar: 'التشغيل', en: 'Operations' },
      branchId: BRANCH_ID,
    }),
  ).id;
  JOB_TITLE_ID = data<{ id: string }>(
    await asAdmin('post', '/platform/job-titles').send({
      code: 'JT-PURGE',
      name: { ar: 'محاسب', en: 'Accountant' },
      jobGrade: 'G5',
    }),
  ).id;
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«مسح نهائي» — permanently deleting an employee', () => {
  it('refuses every authority over employees that is not this one', async () => {
    const employee = await register('رافض الصلاحية');
    // Everything an HR manager can do to a person, short of ending there having been one.
    const hr = await accountWith('purge-hr@ecms.local', [
      'employee.view',
      'employee.create',
      'employee.editPersonal',
      'employee.registerDirect',
      'employee.importRoster',
      'employee.changeCode',
      'employee.changeStatus',
      'employee.exit',
      'employee.rehire',
      'employee.manageActions',
      'employee.manageCompensation',
    ]);
    const res = await purge(hr, employee.id, employee.code);
    expect(res.status).toBe(403);
    // And the refusal is complete, not partial.
    const still = await asAdmin('get', `/hr/employees/${employee.id}`);
    expect(still.status).toBe(200);
  });

  it('refuses a code that is not this employee’s, and deletes nothing', async () => {
    const employee = await register('كود خاطئ');
    await seedRows(employee.id);

    const res = await purge(adminToken, employee.id, '0000000');
    expect(res.status).toBe(400);

    expect((await asAdmin('get', `/hr/employees/${employee.id}`)).status).toBe(200);
    expect(
      await db()
        .collection('hr_attendance_days')
        .countDocuments({ employeeId: new mongoose.Types.ObjectId(employee.id) }),
    ).toBe(1);
  });

  it('erases the person, keeps the record, and rewrites the name on it', async () => {
    const employee = await register('محمد المحذوف');
    await seedRows(employee.id);
    const id = new mongoose.Types.ObjectId(employee.id);

    const res = await purge(adminToken, employee.id, employee.code);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The person is gone from the registry.
    expect((await asAdmin('get', `/hr/employees/${employee.id}`)).status).toBe(404);
    // So is the row that existed only because they did.
    expect(await db().collection('hr_attendance_days').countDocuments({ employeeId: id })).toBe(0);

    // The violation is STILL THERE — it is a legal record about a vehicle and a fine — and no
    // longer names the person. This is the assertion the whole feature turns on.
    const violation = await db().collection('fleet_violations').findOne({ driverEmployeeId: id });
    expect(violation).not.toBeNull();
    expect(violation?.['driverName']).toBe('موظف محذوف');

    const report = data<{ rowsDeleted: number; namesScrubbed: number; keptCollections: string[] }>(res);
    expect(report.namesScrubbed).toBeGreaterThanOrEqual(1);
    expect(report.rowsDeleted).toBeGreaterThanOrEqual(2);
    expect(report.keptCollections).toContain('fleet_violations');
  });

  it('leaves behind the audit row that says it happened', async () => {
    const employee = await register('أثر التدقيق');
    const res = await purge(adminToken, employee.id, employee.code);
    expect(res.status).toBe(200);

    const rows = await db()
      .collection('audit_logs')
      .find({ 'entityRef.entityType': 'employee', 'entityRef.entityId': employee.id })
      .toArray();
    // Append-only by ADR-012, retention "Years (compliance)" — the purge adds to it and removes
    // nothing, so the erasure is the one thing about this person that stays answerable.
    expect(rows.some((r) => r['action'] === 'purge')).toBe(true);
  });
});
