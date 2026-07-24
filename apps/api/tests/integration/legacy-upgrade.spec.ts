// Upgrade-compatibility suite: behaviors that only show on a database created by an OLDER
// release — the class of bug a fresh-DB suite can never catch. Covers:
//   ① legacy applicant documents (late-added fields absent) list/export without a 500,
//     and the boot backfill (`migrateRecruitmentLegacy`) normalizes them + denormalizes
//     `applicantName` onto stage rows;
//   ② the navigation-catalog boot sync (`syncNavigationCatalog`) adds newly shipped
//     applications (e.g. `/leave`) to an existing install, grants them to super-admins,
//     and stays idempotent;
//   ③ `syncPermissionRegistry` invalidates system-role holders' cached permission
//     snapshots when the catalog changes (new-module permissions apply immediately);
//   ④ numeric org-unit codes (`01`) are accepted.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type ApplicantDto, type PermissionDef } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { applicationRepository } from '../../src/platform/applications';
import { userApplicationRepository } from '../../src/platform/user-applications';
import { syncNavigationCatalog } from '../../src/seed-navigation';
import { ApplicantModel } from '../../src/modules/hr/recruitment/applicants/applicant.model';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { migrateRecruitmentLegacy } from '../../src/modules/hr/recruitment/recruitment.migration';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { Types } from 'mongoose';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-legacy-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'admin@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
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

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@ecms.local', password: PASSWORD });
  expect(res.status).toBe(200);
  adminToken = (res.body as { data: { accessToken: string } }).data.accessToken;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

describe('legacy applicant documents (pre-upgrade shape)', () => {
  const legacyId = new Types.ObjectId();

  it('raw first-release document neither 500s the list nor the migration', async () => {
    const sourceId = new Types.ObjectId();
    // Bypass the schema deliberately: this is the stored shape of the first release —
    // no intakeChannel, no religion, no movedToOfferAt, no arrays.
    await ApplicantModel.collection.insertOne({
      _id: legacyId,
      code: 'APP-2026-990001',
      status: 'new',
      sourceId,
      fullNameAr: 'محمد قديم',
      searchName: 'محمد قديم',
      nationality: 'Egyptian',
      contact: { primaryPhone: '01099999999', secondaryPhone: null, email: null, preferredContactChannel: null },
      isDeleted: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      __v: 0,
    });
    await ScreeningModel.collection.insertOne({
      applicantId: legacyId,
      applicantCode: 'APP-2026-990001',
      branchId: null,
      status: 'pending',
      notes: [],
      decision: null,
      isDeleted: false,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      __v: 0,
    });

    // BEFORE the migration the hardened mapper alone must keep the list alive.
    const before = await request(app)
      .get('/api/v1/hr/applicants')
      .query({ pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    const legacyRow = (before.body as { data: ApplicantDto[] }).data.find(
      (a) => a.code === 'APP-2026-990001',
    );
    expect(legacyRow).toBeDefined();
    expect(legacyRow?.movedToOfferAt).toBeNull();
    expect(legacyRow?.intakeChannel).toBe('internal');

    // The boot backfill then normalizes storage and denormalizes the display name.
    await migrateRecruitmentLegacy();
    const migrated = await ApplicantModel.findById(legacyId).lean().exec();
    expect(migrated?.movedToOfferAt).toBeNull();
    expect(migrated?.experience).toEqual([]);
    const screening = await ScreeningModel.findOne({ applicantId: legacyId }).lean().exec();
    expect(screening?.applicantName).toBe('محمد قديم');

    // Idempotent: a second run changes nothing.
    await migrateRecruitmentLegacy();
    const again = await ScreeningModel.findOne({ applicantId: legacyId }).lean().exec();
    expect(again?.applicantName).toBe('محمد قديم');
  });
});

describe('navigation catalog boot sync', () => {
  it('adds new catalog applications to an existing install, granted to super-admins, idempotently', async () => {
    await syncNavigationCatalog();
    await syncNavigationCatalog();

    const leaveApp = await applicationRepository.findOne({ route: '/leave' });
    expect(leaveApp).not.toBeNull();
    const duplicates = await applicationRepository.count({ route: '/leave' });
    expect(duplicates).toBe(1);

    const grant = await userApplicationRepository.findOne({
      userId: new Types.ObjectId(adminId),
      applicationId: leaveApp?._id,
    });
    expect(grant).not.toBeNull();
  });
});

describe('permission registry sync invalidates system-role holders', () => {
  it('a newly registered module permission is effective immediately (no stale cache window)', async () => {
    const catalog: PermissionDef[] = [...platformPermissions, ...hrPermissions];
    const extra: PermissionDef = {
      key: 'zztest.view',
      resource: 'zztest',
      action: 'view',
      moduleId: 'hr',
      name: { en: 'upgrade probe', ar: 'فحص الترقية' },
    };

    const before = await userService.findByEmail('admin@ecms.local');
    expect(before).not.toBeNull();

    await rbacService.syncPermissionRegistry([...catalog, extra]);
    const after = await userService.findByEmail('admin@ecms.local');
    // The role changed ⇒ holders were invalidated (permissionVersion bumped)…
    expect(after?.security.permissionVersion).toBeGreaterThan(
      before?.security.permissionVersion ?? Number.NaN,
    );
    // …and the freshly resolved snapshot carries the new key at the assignment's scope.
    const effective = await rbacService.getEffectivePermissions(
      adminId,
      after?.security.permissionVersion ?? 0,
    );
    expect(effective.permissions['zztest.view']).toBe('organization');

    // Restore the real catalog for any later assertions.
    await rbacService.syncPermissionRegistry(catalog);
  });
});

describe('numeric org-unit codes', () => {
  it('accepts a purely numeric branch code (01)', async () => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '01', name: { ar: 'فرع واحد', en: 'Branch 01' } });
    expect(res.status).toBe(201);
    expect((res.body as { data: { code: string } }).data.code).toBe('01');
  });
});
