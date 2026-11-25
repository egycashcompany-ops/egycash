// «ساعات العمل» handed to everyone who manages the working day, against a real mongo and real RBAC
// — the owner's ruling of 22 November: "«ساعات العمل» replaces something HR already manages, so it
// must not disappear for them after the update."
//
// What a source-reading test cannot see: a role holding `attendance.manageShifts` ends up holding
// `attendance.manageWorkingHours` and nothing else; a role without the shift key, a deleted role,
// super-admin and platform-admin are not written; a key already held is not added twice; a
// delegated grant is copied in its own unit; the version the role editor sends back has moved; the
// trail and the run row say what happened; the holder actually reaches the screen with a fresh
// token — and none of it happens twice: a key an administrator removes after the run stays removed.
//
// Every role and account below is invented.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import { SettingKeys, platformPermissions } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { RoleModel, type RoleDoc } from '../../src/platform/rbac/role.model';
import {
  DelegatedGrantModel,
  type DelegatedGrantDoc,
} from '../../src/platform/rbac/delegation.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { HrGoLiveRunModel } from '../../src/modules/hr/go-live/go-live-run.model';
import {
  HR_WORKING_HOURS_GRANTS_MARK,
  copyHrWorkingHoursGrants,
} from '../../src/modules/hr/go-live/working-hours-grants';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const SHIFTS = 'attendance.manageShifts';
const HOURS = 'attendance.manageWorkingHours';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let superAdminId: string;
let platformAdminId: string;
let personnelRoleId: string; // attendance.manageShifts + attendance.view — HR's role today
let readerRoleId: string; // attendance.view alone — reads the sheet, sets no hours
let alreadyRoleId: string; // the shift key, and already the hours key
let deletedRoleId: string; // the shift key, deleted before the deploy
let delegateId: string; // the shift key DELEGATED over branch A (ADR-032)
let delegatedGrantId: string;
let branchAId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-working-hours-grants-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
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

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const get = (path: string, token: string): request.Test =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

const roleDoc = async (id: string): Promise<RoleDoc> => {
  const doc = await RoleModel.findById(id).lean<RoleDoc>().exec();
  expect(doc).not.toBeNull();
  return doc as RoleDoc;
};

const grantDoc = async (id: string): Promise<DelegatedGrantDoc> => {
  const doc = await DelegatedGrantModel.findById(id).lean<DelegatedGrantDoc>().exec();
  expect(doc).not.toBeNull();
  return doc as DelegatedGrantDoc;
};

const sorted = (keys: readonly string[]): string[] => [...keys].sort();

/** Every role's keys and version, by id — what "wrote nothing" is checked against. */
const snapshotRoles = async (): Promise<Map<string, { keys: string[]; version: number }>> => {
  const docs = await RoleModel.find().lean<RoleDoc[]>().exec();
  return new Map(
    docs.map((doc) => [String(doc._id), { keys: [...doc.permissionKeys], version: doc.__v }]),
  );
};

let holderEmail: string;
let rolesBefore: Map<string, { keys: string[]; version: number }>;
let grantBefore: DelegatedGrantDoc;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  // Super-admin WITHOUT the hours key, so that leaving it alone is something the step decides
  // rather than something it finds already done. (On a live database `attendance.migration.ts`
  // widens it; this proves the COPY never writes it either way.)
  const adminKeys = [...platformPermissions, ...hrPermissions]
    .map((permission) => permission.key)
    .filter((key) => key !== HOURS);
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    adminKeys,
  );
  superAdminId = String(superAdmin._id);
  await RoleModel.updateOne({ _id: superAdmin._id }, { $set: { permissionKeys: adminKeys } }).exec();
  // Platform-admin holds the platform's keys only, by definition. The shift key is planted in it
  // here, artificially, so that the step leaving it alone is proved rather than assumed.
  const platformKeys = platformPermissions.map((permission) => permission.key);
  const platformAdmin = await rbacService.ensureSystemRole(
    'platform-admin',
    { en: 'Platform Admin', ar: 'مدير المنصة' },
    platformKeys,
  );
  platformAdminId = String(platformAdmin._id);
  await RoleModel.updateOne(
    { _id: platformAdmin._id },
    { $set: { permissionKeys: [...platformKeys, SHIFTS] } },
  ).exec();

  const adminId = await mkUser('wh-grants-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, superAdminId, 'organization');
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
  adminToken = await login('wh-grants-admin@ecms.local');

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '94', name: { ar: 'فرع أ', en: 'Branch A' } });
  expect(branch.status).toBe(201);
  branchAId = (branch.body as { data: { id: string } }).data.id;

  const role = async (en: string, ar: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar }, permissionKeys }, adminId))._id);
  personnelRoleId = await role('Personnel', 'شؤون العاملين', [SHIFTS, 'attendance.view']);
  readerRoleId = await role('Attendance reader', 'قارئ الحضور', ['attendance.view']);
  alreadyRoleId = await role('Hours owner', 'مسؤول ساعات العمل', [SHIFTS, HOURS]);
  deletedRoleId = await role('Old shift editor', 'محرر الورديات القديم', [SHIFTS]);
  await rbacService.deleteRole(deletedRoleId, adminId);

  // HR's member: the personnel role at branch scope, placed in branch A.
  holderEmail = 'wh-grants-holder@ecms.local';
  const holderId = await mkUser(holderEmail, branchAId);
  await rbacService.ensureAssignment(holderId, personnelRoleId, 'branch');

  // A deputy's shape (ADR-032): the shift key DELEGATED over branch A, no role.
  delegateId = await mkUser('wh-grants-delegate@ecms.local', branchAId);
  const delegated = await request(app)
    .put(`/api/v1/platform/delegations/users/${delegateId}/grants`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ branchId: branchAId, departmentId: null, permissionKeys: [SHIFTS] });
  expect(delegated.status, JSON.stringify(delegated.body)).toBe(200);
  const grant = await DelegatedGrantModel.findOne({
    userId: new Types.ObjectId(delegateId),
    isDeleted: false,
  })
    .lean<DelegatedGrantDoc>()
    .exec();
  expect(grant).not.toBeNull();
  delegatedGrantId = String((grant as DelegatedGrantDoc)._id);

  rolesBefore = await snapshotRoles();
  grantBefore = await grantDoc(delegatedGrantId);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('copying the working-hours grant', () => {
  it('before the copy, the shift key does not open the working-hours screen', async () => {
    const token = await login(holderEmail);
    expect((await get('/hr/attendance/shifts', token)).status).toBe(200);
    expect((await get('/hr/attendance/working-hours', token)).status).toBe(403);
    expect((await get('/hr/attendance/working-hours/history', token)).status).toBe(403);
  });

  it('gives every holder of the shift grant the working-hours grant — and nothing else', async () => {
    const outcome = await copyHrWorkingHoursGrants();
    expect(outcome.status).toBe('done');

    // THE RULING: a role holding `attendance.manageShifts` now holds
    // `attendance.manageWorkingHours`. Its other keys are untouched.
    const personnel = await roleDoc(personnelRoleId);
    expect(personnel.permissionKeys).toContain(HOURS);
    expect(sorted(personnel.permissionKeys)).toEqual([HOURS, SHIFTS, 'attendance.view'].sort());

    // A key already held is not added twice.
    const already = await roleDoc(alreadyRoleId);
    expect(already.permissionKeys).toHaveLength(2);
    expect(sorted(already.permissionKeys)).toEqual([HOURS, SHIFTS].sort());
  });

  it('writes nothing into a role without the shift key, a deleted role, super-admin or platform-admin', async () => {
    for (const id of [readerRoleId, deletedRoleId, superAdminId, platformAdminId]) {
      const doc = await roleDoc(id);
      expect(doc.permissionKeys, id).toEqual(rolesBefore.get(id)?.keys);
      expect(doc.__v, id).toBe(rolesBefore.get(id)?.version);
      expect(doc.permissionKeys, id).not.toContain(HOURS);
    }
  });

  it('moves the version the role editor checks — a form opened before the copy gets a conflict', async () => {
    const before = rolesBefore.get(personnelRoleId)?.version as number;
    expect((await roleDoc(personnelRoleId)).__v).toBe(before + 1);

    const stale = await request(app)
      .patch(`/api/v1/platform/roles/${personnelRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: [SHIFTS, 'attendance.view'], version: before });
    expect(stale.status).toBe(409);
    expect((await roleDoc(personnelRoleId)).permissionKeys).toContain(HOURS);
  });

  it('copies a delegated grant the same, in its own unit, and moves its version', async () => {
    const grant = await grantDoc(delegatedGrantId);
    expect(sorted(grant.permissionKeys)).toEqual([HOURS, SHIFTS].sort());
    expect(String(grant.branchId)).toBe(branchAId);
    expect(grant.departmentId).toBeNull();
    expect(grant.__v).toBe(grantBefore.__v + 1);
  });

  it('records the run — counts and role names, no person — and leaves the trail', async () => {
    const run = await HrGoLiveRunModel.findOne({ key: HR_WORKING_HOURS_GRANTS_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ rolesChanged: 1, delegatedGrantsChanged: 1 });
    const roles = (
      run?.outcome as { roles: { id: string; name: { en: string }; added: string[] }[] }
    ).roles;
    expect(roles.map((r) => r.name.en)).toEqual(['Personnel']);
    expect(roles[0]?.added).toEqual([HOURS]);
    expect(JSON.stringify(run?.outcome)).not.toContain(delegateId);

    // One `update` row for the changed role, with its keys before and after — the role editor's row.
    const audit = await AuditLogModel.find({
      'entityRef.moduleId': 'platform',
      'entityRef.entityType': 'role',
      'entityRef.entityId': personnelRoleId,
      action: 'update',
    })
      .lean()
      .exec();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes.map((c) => c.field)).toEqual(['permissionKeys']);
    const untouched = await AuditLogModel.countDocuments({
      'entityRef.entityType': 'role',
      'entityRef.entityId': readerRoleId,
      action: 'update',
    }).exec();
    expect(untouched).toBe(0);
  });

  it('opens the working-hours screen to the holder, with a fresh token', async () => {
    const token = await login(holderEmail);
    expect((await get('/hr/attendance/working-hours', token)).status).toBe(200);
    expect((await get('/hr/attendance/working-hours/history', token)).status).toBe(200);
    expect((await get('/hr/attendance/shifts', token)).status).toBe(200);
  });

  it('happens once: a later boot writes nothing, and a key removed since stays removed', async () => {
    // An administrator takes the working hours away from the personnel role after the deploy.
    const current = await roleDoc(personnelRoleId);
    const narrowed = await request(app)
      .patch(`/api/v1/platform/roles/${personnelRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        permissionKeys: current.permissionKeys.filter((key) => key !== HOURS),
        version: current.__v,
      });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);

    const roles = await snapshotRoles();
    const grant = await grantDoc(delegatedGrantId);

    expect((await copyHrWorkingHoursGrants()).status).toBe('alreadyDone');

    expect(await snapshotRoles()).toEqual(roles);
    expect((await grantDoc(delegatedGrantId)).__v).toBe(grant.__v);
    expect((await roleDoc(personnelRoleId)).permissionKeys).not.toContain(HOURS);
    expect(
      await HrGoLiveRunModel.countDocuments({ key: HR_WORKING_HOURS_GRANTS_MARK }).exec(),
    ).toBe(1);
  });
});
