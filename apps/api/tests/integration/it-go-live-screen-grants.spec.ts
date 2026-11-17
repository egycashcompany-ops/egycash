// The IT screens' own grants handed to everyone who ran them, against a real mongo and real RBAC —
// «فى الصلاحيات مش لاقى حاجة لـ /consumables ولا /mobile-lines !! فى الـ IT ظبط صلاحيات الشاشات عشان
// أقدر أتحكم فيها».
//
// What a source-reading test cannot see: a role holding the asset grants gains exactly the matching
// screen grants and nothing else; the line receipt's national ID follows the asset receipt's; a role
// with no asset grant, a deleted role, super-admin and platform-admin are not written; a key already
// held is not added twice; a delegated grant is copied in its own unit; the version the role editor
// sends back has moved, so a form opened before the copy gets the usual conflict; the trail and the
// run row say what happened; the holder reaches the consumables and the lines with a fresh token —
// and none of it happens twice: a key an administrator removes after the run stays removed.
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
import { itPermissions } from '../../src/modules/it/it.module';
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
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import {
  IT_SCREEN_GRANTS_MARK,
  copyItScreenGrants,
} from '../../src/modules/it/go-live/screen-grants';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const SCREEN_KEY = /^(itConsumable|itMobileLine)\./u;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let superAdminId: string;
let platformAdminId: string;
let supportRoleId: string; // itAsset.view + itAsset.assign — the IT team's role
let nationalIdRoleId: string; // itAsset.viewNationalId alone
let helpDeskRoleId: string; // no asset grant at all
let alreadyRoleId: string; // itAsset.view, and already itConsumable.view
let deletedRoleId: string; // itAsset.edit, deleted before the deploy
let delegateId: string; // itAsset.view + itAsset.create DELEGATED over branch A (ADR-032)
let delegatedGrantId: string;
let branchAId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-screen-grants-test-${Date.now()}`;
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

  // Super-admin WITHOUT the two screens' keys, so that leaving it alone is something the step
  // decides rather than something it finds already done. (On a live database the catalog sync
  // gives it everything; this proves the step never writes it either way.)
  const adminKeys = [...platformPermissions, ...itPermissions]
    .map((permission) => permission.key)
    .filter((key) => !SCREEN_KEY.test(key));
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    adminKeys,
  );
  superAdminId = String(superAdmin._id);
  await RoleModel.updateOne(
    { _id: superAdmin._id },
    { $set: { permissionKeys: adminKeys } },
  ).exec();
  // Platform-admin holds the platform's keys only, by definition. One asset key is planted in it
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
    { $set: { permissionKeys: [...platformKeys, 'itAsset.view'] } },
  ).exec();

  const adminId = await mkUser('screen-grants-admin@ecms.local');
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
  adminToken = await login('screen-grants-admin@ecms.local');

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '93', name: { ar: 'فرع أ', en: 'Branch A' } });
  expect(branch.status).toBe(201);
  branchAId = (branch.body as { data: { id: string } }).data.id;

  const role = async (en: string, ar: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar }, permissionKeys }, adminId))._id);
  supportRoleId = await role('IT support', 'الدعم الفني', ['itAsset.view', 'itAsset.assign']);
  nationalIdRoleId = await role('Receipt printer', 'طباعة الإقرارات', ['itAsset.viewNationalId']);
  helpDeskRoleId = await role('Help desk', 'مكتب المساعدة', ['itTicket.view']);
  alreadyRoleId = await role('Store keeper', 'أمين المخزن', ['itAsset.view', 'itConsumable.view']);
  deletedRoleId = await role('Old asset editor', 'محرر الأصول القديم', ['itAsset.edit']);
  await rbacService.deleteRole(deletedRoleId, adminId);

  // The IT team's member: the support role at branch scope, placed in branch A.
  holderEmail = 'screen-grants-holder@ecms.local';
  const holderId = await mkUser(holderEmail, branchAId);
  await rbacService.ensureAssignment(holderId, supportRoleId, 'branch');

  // A deputy's shape (ADR-032): asset keys DELEGATED over branch A, no role.
  delegateId = await mkUser('screen-grants-delegate@ecms.local', branchAId);
  const delegated = await request(app)
    .put(`/api/v1/platform/delegations/users/${delegateId}/grants`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      branchId: branchAId,
      departmentId: null,
      permissionKeys: ['itAsset.view', 'itAsset.create'],
    });
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

describe('copying the screen grants', () => {
  it('before the copy, the asset grants no longer open the two screens', async () => {
    const token = await login(holderEmail);
    expect((await get('/it/assets', token)).status).toBe(200);
    expect((await get('/it/consumables', token)).status).toBe(403);
    expect((await get('/it/mobile-lines', token)).status).toBe(403);
  });

  it('gives each holder of an asset grant exactly the matching screen grants', async () => {
    const outcome = await copyItScreenGrants();
    expect(outcome.status).toBe('done');

    // The IT team's role: view and assign, on both screens — four keys, no more.
    const support = await roleDoc(supportRoleId);
    expect(sorted(support.permissionKeys)).toEqual([
      'itAsset.assign',
      'itAsset.view',
      'itConsumable.assign',
      'itConsumable.view',
      'itMobileLine.assign',
      'itMobileLine.view',
    ]);
    // The line receipt's national ID follows the asset receipt's — the lines only.
    expect(sorted((await roleDoc(nationalIdRoleId)).permissionKeys)).toEqual([
      'itAsset.viewNationalId',
      'itMobileLine.viewNationalId',
    ]);
    // A key already held is not added twice.
    const already = await roleDoc(alreadyRoleId);
    expect(already.permissionKeys).toHaveLength(3);
    expect(sorted(already.permissionKeys)).toEqual([
      'itAsset.view',
      'itConsumable.view',
      'itMobileLine.view',
    ]);
  });

  it('writes nothing into a role with no asset grant, a deleted role, super-admin or platform-admin', async () => {
    for (const id of [helpDeskRoleId, deletedRoleId, superAdminId, platformAdminId]) {
      const doc = await roleDoc(id);
      expect(doc.permissionKeys, id).toEqual(rolesBefore.get(id)?.keys);
      expect(doc.__v, id).toBe(rolesBefore.get(id)?.version);
    }
    expect((await roleDoc(superAdminId)).permissionKeys.some((k) => SCREEN_KEY.test(k))).toBe(
      false,
    );
  });

  it('moves the version the role editor checks — a form opened before the copy gets a conflict', async () => {
    const before = rolesBefore.get(supportRoleId)?.version as number;
    expect((await roleDoc(supportRoleId)).__v).toBe(before + 1);

    const stale = await request(app)
      .patch(`/api/v1/platform/roles/${supportRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKeys: ['itAsset.view', 'itAsset.assign'], version: before });
    expect(stale.status).toBe(409);
    // …and the copied keys are still there.
    expect((await roleDoc(supportRoleId)).permissionKeys).toContain('itConsumable.view');
  });

  it('copies a delegated grant the same, in its own unit, and moves its version', async () => {
    const grant = await grantDoc(delegatedGrantId);
    expect(sorted(grant.permissionKeys)).toEqual([
      'itAsset.create',
      'itAsset.view',
      'itConsumable.create',
      'itConsumable.view',
      'itMobileLine.create',
      'itMobileLine.view',
    ]);
    expect(String(grant.branchId)).toBe(branchAId);
    expect(grant.departmentId).toBeNull();
    expect(grant.__v).toBe(grantBefore.__v + 1);
  });

  it('records the run — counts and role names, no person — and leaves the trail', async () => {
    const run = await ItGoLiveRunModel.findOne({ key: IT_SCREEN_GRANTS_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ rolesChanged: 3, delegatedGrantsChanged: 1 });
    const roles = (
      run?.outcome as { roles: { id: string; name: { en: string }; added: string[] }[] }
    ).roles;
    expect(roles.map((r) => r.name.en).sort()).toEqual([
      'IT support',
      'Receipt printer',
      'Store keeper',
    ]);
    expect(roles.find((r) => r.id === nationalIdRoleId)?.added).toEqual([
      'itMobileLine.viewNationalId',
    ]);
    expect(JSON.stringify(run?.outcome)).not.toContain(delegateId);

    // One `update` row per changed role, with its keys before and after — the role editor's row.
    const supportAudit = await AuditLogModel.find({
      'entityRef.moduleId': 'platform',
      'entityRef.entityType': 'role',
      'entityRef.entityId': supportRoleId,
      action: 'update',
    })
      .lean()
      .exec();
    expect(supportAudit).toHaveLength(1);
    expect(supportAudit[0]?.changes.map((c) => c.field)).toEqual(['permissionKeys']);
    const helpDeskAudit = await AuditLogModel.countDocuments({
      'entityRef.entityType': 'role',
      'entityRef.entityId': helpDeskRoleId,
      action: 'update',
    }).exec();
    expect(helpDeskAudit).toBe(0);
    // The delegated grant's row on its holder, as a delegation write records one.
    const delegateAudit = await AuditLogModel.find({
      'entityRef.moduleId': 'platform',
      'entityRef.entityType': 'user',
      'entityRef.entityId': delegateId,
      action: 'roleAssigned',
    })
      .lean()
      .exec();
    const copied = delegateAudit.filter((row) =>
      row.changes.some(
        (change) =>
          change.field === 'delegation' && String(change.new).includes('itConsumable.view'),
      ),
    );
    expect(copied).toHaveLength(1);
  });

  it('opens the two screens to the holder, with a fresh token', async () => {
    const token = await login(holderEmail);
    expect((await get('/it/consumables', token)).status).toBe(200);
    expect((await get('/it/mobile-lines', token)).status).toBe(200);
    expect((await get('/it/assets', token)).status).toBe(200);
  });

  it('happens once: a later boot writes nothing, and a key removed since stays removed', async () => {
    // An administrator takes the lines away from the support role after the deploy.
    const current = await roleDoc(supportRoleId);
    const narrowed = await request(app)
      .patch(`/api/v1/platform/roles/${supportRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        permissionKeys: current.permissionKeys.filter((key) => !key.startsWith('itMobileLine.')),
        version: current.__v,
      });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);

    const roles = await snapshotRoles();
    const grant = await grantDoc(delegatedGrantId);

    expect((await copyItScreenGrants()).status).toBe('alreadyDone');

    expect(await snapshotRoles()).toEqual(roles);
    expect((await grantDoc(delegatedGrantId)).__v).toBe(grant.__v);
    expect((await roleDoc(supportRoleId)).permissionKeys).not.toContain('itMobileLine.view');
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_SCREEN_GRANTS_MARK }).exec()).toBe(1);
  });
});
