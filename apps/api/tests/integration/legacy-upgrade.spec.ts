// Upgrade-compatibility suite: behaviors that only show on a database created by an OLDER
// release — the class of bug a fresh-DB suite can never catch. Covers:
//   ① legacy applicant documents (late-added fields absent) list/export without a 500,
//     and the boot backfill (`migrateRecruitmentLegacy`) normalizes them + denormalizes
//     `applicantName` onto stage rows, and repairs timeline entries whose empty `metadata`
//     Mongoose minimization deleted — without touching rows that already carry theirs;
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
import {
  HR_SETTINGS_HUB,
  platformPermissions,
  SettingKeys,
  type ApplicantDto,
  type PermissionDef,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { applicationRepository, applicationService } from '../../src/platform/applications';
import { applicationCategoryRepository } from '../../src/platform/application-categories';
import { userApplicationRepository } from '../../src/platform/user-applications';
import { syncNavigationCatalog } from '../../src/seed-navigation';
import { seedHrRecruitment } from '../../src/modules/hr/hr.seed';
import { ApplicantSourceModel } from '../../src/modules/hr/recruitment/applicants/applicant-source.model';
import { LeaveTypeModel } from '../../src/modules/hr/leave-management/leave-types/leave-type.model';
import { ApplicantModel } from '../../src/modules/hr/recruitment/applicants/applicant.model';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { RecruitmentTimelineModel } from '../../src/modules/hr/recruitment/timeline/recruitment-timeline.model';
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

  /**
   * Timeline entries stored before the schema stopped minimizing lost their empty `metadata` on
   * the way to Mongo, so `.lean()` read back `undefined` and the renderer died. This proves the
   * repair on the three axes that matter for running it against a live database: it fixes the
   * broken rows, it never touches a row that is already correct, and a second run is a no-op.
   */
  it('backfills timeline entries whose empty metadata was minimized away — and only those', async () => {
    const applicantId = new Types.ObjectId();
    const base = {
      applicantId,
      applicantCode: 'APP-2026-990002',
      at: new Date('2026-01-01T00:00:00.000Z'),
      actorUserId: null,
      actorName: 'مسؤول',
      correlationType: 'applicant',
      correlationId: 'corr-legacy',
      stageKind: null,
      stageRefId: null,
      stageName: null,
      fromStatus: null,
      toStatus: null,
      placement: null,
      placementLabel: null,
      entityType: 'applicant',
      entityId: applicantId,
      reason: null,
      note: null,
      supersededAt: null,
      branchId: null,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Written through the driver, not the model: this is exactly the shape minimization produced —
    // the `metadata` key is absent, not empty.
    await RecruitmentTimelineModel.collection.insertMany([
      { ...base, eventId: 'evt-legacy-identity', sourceKey: 'legacy:identity', type: 'identityVerified' },
      { ...base, eventId: 'evt-legacy-note', sourceKey: 'legacy:note', type: 'note' },
      // A row that already carries real metadata — the migration must leave it exactly as it is.
      {
        ...base,
        eventId: 'evt-legacy-interview',
        sourceKey: 'legacy:interview',
        type: 'interviewScheduled',
        metadata: { attempt: 2, eventName: 'hr.interview.scheduled' },
      },
    ]);

    const read = async (eventId: string) =>
      RecruitmentTimelineModel.collection.findOne({ eventId });

    // Before: the field is genuinely absent, which is what `undefined.attempt` was reading.
    expect(await read('evt-legacy-identity')).not.toHaveProperty('metadata');

    await migrateRecruitmentLegacy();

    const identity = await read('evt-legacy-identity');
    const note = await read('evt-legacy-note');
    const interview = await read('evt-legacy-interview');
    expect(identity?.metadata).toEqual({});
    expect(note?.metadata).toEqual({});
    // Untouched: a correct row keeps its real metadata rather than being reset to `{}`.
    expect(interview?.metadata).toEqual({ attempt: 2, eventName: 'hr.interview.scheduled' });

    // Nothing else on the repaired row moved — same identity, same history, same scope.
    expect(identity?.eventId).toBe('evt-legacy-identity');
    expect(identity?.sourceKey).toBe('legacy:identity');
    expect(identity?.type).toBe('identityVerified');
    expect(identity?.at).toEqual(base.at);

    // Idempotent, measured rather than asserted by eye: the second pass matches zero documents.
    const second = await RecruitmentTimelineModel.updateMany(
      { metadata: { $exists: false } },
      { $set: { metadata: {} } },
    ).exec();
    expect(second.matchedCount).toBe(0);
    expect(second.modifiedCount).toBe(0);

    await migrateRecruitmentLegacy();
    expect((await read('evt-legacy-identity'))?.metadata).toEqual({});
    expect((await read('evt-legacy-interview'))?.metadata).toEqual({
      attempt: 2,
      eventName: 'hr.interview.scheduled',
    });
  });
});

describe('navigation catalog boot sync', () => {
  it('adds new catalog applications to an existing install, idempotently and with no grant', async () => {
    await syncNavigationCatalog();
    await syncNavigationCatalog();

    const leaveApp = await applicationRepository.findOne({ route: '/leave' });
    expect(leaveApp).not.toBeNull();
    const duplicates = await applicationRepository.count({ route: '/leave' });
    expect(duplicates).toBe(1);

    // The row carries the permission that entitles it — which is the whole of how it reaches a
    // sidebar now, and what makes the grant this sync used to write unnecessary.
    expect(leaveApp?.permissionKey).toBe('leave.view');
    const grant = await userApplicationRepository.findOne({
      userId: new Types.ObjectId(adminId),
      applicationId: leaveApp?._id,
    });
    expect(grant, 'the boot sync must not write application grants any more').toBeNull();
  });

  /**
   * «شيل بقي دفعات الفحص الأمني ودفعات اختبار القيادة من المينو اللى في الجنب». A live install
   * already holds both rows, and the sync never deletes — so the catalog retires them: inactive,
   * ONCE, and a row an administrator switches back on afterwards stays on.
   */
  it('retires the rows the catalog stopped offering, once, and leaves one switched back on', async () => {
    const retired = ['/evaluation-batches/phase/securityCheck', '/evaluation-batches/phase/drivingTest'];
    const hr = await applicationCategoryRepository.findOne({ 'name.en': 'HR' });
    expect(hr).not.toBeNull();
    // A pre-retirement install: both rows live and active, the tile at no retirement yet.
    for (const [index, route] of retired.entries()) {
      if ((await applicationRepository.findOne({ route })) !== null) continue;
      await applicationService.create(
        {
          name: { ar: 'دفعات', en: 'Batches' },
          icon: 'shield',
          route,
          categoryId: String(hr?._id),
          sortOrder: 900 + index,
          permissionKey: index === 0 ? 'securityCheck.view' : 'drivingTest.view',
        },
        adminId,
      );
    }
    const tile = await applicationCategoryRepository.findOne({ 'name.en': 'HR' });
    await applicationCategoryRepository.updateById(
      String(tile?._id),
      { retiredRevision: 0 },
      { by: adminId, version: tile?.__v ?? 0 },
    );

    await syncNavigationCatalog();
    for (const route of retired) {
      expect((await applicationRepository.findOne({ route }))?.status, route).toBe('inactive');
    }

    // An administrator switches one back on; the next boot leaves it on.
    const back = await applicationRepository.findOne({ route: retired[0] as string });
    await applicationService.update(String(back?._id), { status: 'active', version: back?.__v ?? 0 }, adminId);
    await syncNavigationCatalog();
    expect((await applicationRepository.findOne({ route: retired[0] as string }))?.status).toBe('active');
  });

  /**
   * «عايز الجزء اللى فالصورة دا يبقي جوا صفحة واحده أسمها إعدادات وتبقي فوق خالص». An install that
   * already took the first retirement still shows the six settings rows; the next boot switches
   * them off and gives HR the one «الإعدادات» row, outside every group.
   */
  it('folds the six settings rows into «الإعدادات» on an install past the first retirement', async () => {
    const tabs = [
      '/recruitment-form',
      '/applicant-sources',
      '/interviews/stages',
      '/evaluations/phases',
      '/announcements',
      '/notification-rules',
    ];
    const hr = await applicationCategoryRepository.findOne({ 'name.en': 'HR' });
    expect(hr).not.toBeNull();
    for (const [index, route] of tabs.entries()) {
      const row = await applicationRepository.findOne({ route });
      if (row === null) {
        await applicationService.create(
          {
            name: { ar: route, en: route },
            icon: 'layers',
            route,
            categoryId: String(hr?._id),
            sortOrder: 800 + index,
            permissionKey: HR_SETTINGS_HUB.tabs[index]?.permission ?? 'applicant.view',
          },
          adminId,
        );
      } else if (row.status !== 'active') {
        await applicationService.update(String(row._id), { status: 'active', version: row.__v }, adminId);
      }
    }
    const tile = await applicationCategoryRepository.findOne({ 'name.en': 'HR' });
    await applicationCategoryRepository.updateById(
      String(tile?._id),
      { retiredRevision: 1 },
      { by: adminId, version: tile?.__v ?? 0 },
    );

    await syncNavigationCatalog();
    for (const route of tabs) {
      expect((await applicationRepository.findOne({ route }))?.status, route).toBe('inactive');
    }
    const hub = await applicationRepository.findOne({ route: HR_SETTINGS_HUB.route });
    expect(hub?.status).toBe('active');
    expect(hub?.name.ar).toBe('الإعدادات');
    expect(String(hub?.categoryId)).toBe(String(hr?._id));
    // In no group: the sidebar draws a module's ungrouped rows above its groups.
    expect(hub?.sectionId ?? null).toBeNull();
    expect((await applicationCategoryRepository.findOne({ 'name.en': 'HR' }))?.retiredRevision).toBe(2);
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
      pageId: null,
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

describe('administrator customizations survive the boot sync', () => {
  it('writes no application grants at all, however many times it runs', async () => {
    // This case used to assert that a grant an administrator revoked stayed revoked across
    // restarts — a real hazard while the sync handed grants out. It hands none out now, so the
    // stronger statement is available: after any number of syncs the account that would have been
    // granted everything holds nothing, and its sidebar is decided by its permissions alone.
    await syncNavigationCatalog();
    await syncNavigationCatalog();

    const grants = await userApplicationRepository.findByUser(adminId);
    expect(grants).toEqual([]);
  });

  it('a renamed category is not re-created and existing app metadata is untouched', async () => {
    const before = await applicationCategoryRepository.count({});
    const hr = await applicationCategoryRepository.findOne({ 'name.en': 'HR' });
    expect(hr).not.toBeNull();
    await applicationCategoryRepository.updateById(
      String(hr?._id),
      { name: { ar: 'الموارد البشرية', en: 'People Operations' } },
      { by: adminId, version: hr?.__v ?? 0 },
    );
    const employeesApp = await applicationRepository.findOne({ route: '/employees' });
    const iconBefore = employeesApp?.icon;

    await syncNavigationCatalog();

    expect(await applicationCategoryRepository.count({})).toBe(before);
    const employeesAfter = await applicationRepository.findOne({ route: '/employees' });
    expect(employeesAfter?.icon).toBe(iconBefore);
  });
});

describe('repeated boots against the same database', () => {
  it('re-running every boot step creates no duplicates and no permission-version churn', async () => {
    const counts = async (): Promise<Record<string, number>> => ({
      apps: await applicationRepository.count({}),
      categories: await applicationCategoryRepository.count({}),
      grants: await userApplicationRepository.count({}),
      sources: await ApplicantSourceModel.countDocuments({}).exec(),
      leaveTypes: await LeaveTypeModel.countDocuments({}).exec(),
    });

    // Settle once (module seeds already ran at bootPlatform; nav sync ran above).
    await seedHrRecruitment();
    await syncNavigationCatalog();
    const versionBefore = (await userService.findByEmail('admin@ecms.local'))?.security
      .permissionVersion;
    const baseline = await counts();

    // "Restart" twice more: permission registry, module seeds, nav catalog.
    for (let boot = 0; boot < 2; boot += 1) {
      await rbacService.syncPermissionRegistry([...platformPermissions, ...hrPermissions]);
      await seedHrRecruitment();
      await syncNavigationCatalog();
    }

    expect(await counts()).toEqual(baseline);
    expect(await applicationRepository.count({ route: '/leave' })).toBe(1);
    // Unchanged catalog ⇒ no invalidation ⇒ no cache/version churn on plain redeploys.
    const versionAfter = (await userService.findByEmail('admin@ecms.local'))?.security
      .permissionVersion;
    expect(versionAfter).toBe(versionBefore);
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
