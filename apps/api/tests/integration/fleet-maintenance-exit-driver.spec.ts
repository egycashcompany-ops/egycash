// «عاوز اقدر اعدل السواق التانى اللى هو سائق الخروج» — the workshop edit corrects «سائق الخروج».
//
// Before, the only way to fix a wrong exit driver was to reopen the visit (which also wipes the
// exit date, the exit counter and the custody) and check it out again. `PATCH /fleet/maintenance/:id`
// now takes `driverOutEmployeeId`, on a CLOSED visit only, as a correction and never a clear — the
// rule the entry driver already had. Against a real database, through the real endpoints:
//
//   1. a closed visit takes a new exit driver: stored, on the answer, and in the update's audit row;
//   2. an open visit refuses it (400 on `body.driverOutEmployeeId`) and nothing is written;
//   3. an unknown employee, `null`, a stale version (also one from before a reopen: 409, not 400)
//      and a missing `fleetMaintenance.edit` refuse it; `fleetMaintenance.edit` alone is enough;
//   4. HR is asked only when the value CHANGES: resending the stored driver after they left the
//      directory is accepted;
//   5. an old-book visit with only the book's spelling (`driverOutName`) gets an employee, and the
//      spelling is left as it was;
//   6. reopen still clears it, and check-out still requires it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetMaintenanceVisitDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminUserId: string;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-maintenance-exit-driver-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const get = (path: string, query: Record<string, unknown> = {}) =>
  request(app).get(`/api/v1${path}`).query(query).set('Authorization', `Bearer ${adminToken}`);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
const edit = (id: string, body: Record<string, unknown>, token = adminToken) =>
  request(app)
    .patch(`/api/v1/fleet/maintenance/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const errorDetails = (res: request.Response): { field: string; code: string }[] =>
  (res.body as { error: { details?: { field: string; code: string }[] } }).error.details ?? [];

/** The visit as stored — what a refused write must have left alone. */
const stored = async (id: string) =>
  FleetMaintenanceVisitModel.findById(id)
    .lean<{
      outDate: Date | null;
      exitOdometer: number | null;
      driverOutEmployeeId: Types.ObjectId | null;
      driverOutName: string | null;
      takenOutByEmployeeId: Types.ObjectId | null;
      __v: number;
    }>()
    .exec();

const updateAudits = (id: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'fleet',
    'entityRef.entityType': 'maintenanceVisit',
    'entityRef.entityId': id,
    action: 'update',
  })
    .lean()
    .exec();

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let branchId: string;
let departmentId: string;
let jobTitleId: string;
let typeId: string;
let workshopId: string;
let workTypeId: string;
/** Who drove the cars away at check-out. */
let firstDriver: string;
/** The driver the correction names. */
let secondDriver: string;

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

let phone = 1_299_000_000;
/** An HR employee in a driving seat, through the real direct-registration endpoint. */
const mkDriver = async (fullNameAr: string): Promise<string> =>
  ok<{ id: string }>(
    await post('/hr/employees/direct', {
      personal: {
        identity: { fullNameAr, nationalId: nextNationalId(), nationality: 'Egyptian' },
        contact: { primaryPhone: `0${(phone += 1)}` },
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
        startDate: '2026-01-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    }),
    201,
  ).id;

const mkCatalog = async (kind: string, ar: string): Promise<string> => {
  const seeded = ok<FleetCatalogItemDto[]>(
    await get('/fleet/catalog-items', { kind, pageSize: 100 }),
  ).find((item) => item.name.ar === ar);
  if (seeded !== undefined) return seeded.id;
  return ok<FleetCatalogItemDto>(
    await post('/fleet/catalog-items', { kind, name: { ar, en: ar } }),
    201,
  ).id;
};

let counter = 0;
const mkVehicle = async (): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await post('/fleet/vehicles', {
      code: `${700 + counter}`,
      typeId,
      branchId,
      plateNumber: `س خ ${counter}`,
      chassisNumber: `XDCH-${counter}`,
      motorNumber: `XDMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `XDISSI-${counter}` },
    }),
    201,
  );
};

/** A visit through the endpoints — still in the workshop. */
const openVisit = async (): Promise<FleetMaintenanceVisitDto> => {
  const car = await mkVehicle();
  return ok<FleetMaintenanceVisitDto>(
    await post('/fleet/maintenance', {
      vehicleId: car.id,
      inDate: '2026-10-01',
      workshopId,
      workTypeId,
      odometerAtService: 50_000,
      driverInEmployeeId: firstDriver,
    }),
    201,
  );
};

/** A visit through the endpoints, checked out by `firstDriver`. */
const closedVisit = async (): Promise<FleetMaintenanceVisitDto> => {
  const opened = await openVisit();
  return ok<FleetMaintenanceVisitDto>(
    await post(`/fleet/maintenance/${opened.id}/check-out`, {
      outDate: '2026-10-03',
      exitOdometer: 50_200,
      driverOutEmployeeId: firstDriver,
      version: opened.version,
    }),
  );
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  adminUserId = await mkUser('maintenance-exit-driver@ecms.local');
  await rbacService.ensureAssignment(adminUserId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminUserId,
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
  adminToken = await authService.signAccessToken(adminUserId, new Types.ObjectId().toString(), 0);
  await FleetMaintenanceVisitModel.createIndexes();

  branchId = ok<{ id: string }>(
    await post('/platform/branches', { code: '93', name: { ar: 'فرع الخروج', en: 'Exit' } }),
    201,
  ).id;
  departmentId = ok<{ id: string }>(
    await post('/platform/departments', {
      code: 'XD-OPS',
      name: { ar: 'الحركة', en: 'Operations' },
      branchId,
    }),
    201,
  ).id;
  jobTitleId = ok<{ id: string }>(
    await post('/platform/job-titles', {
      code: 'XD-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  typeId = ok<FleetVehicleTypeDto>(
    await post('/fleet/vehicle-types', {
      name: { ar: 'مصفحة الخروج', en: 'Exit van' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;
  workshopId = await mkCatalog('workshop', 'ورشة سائق الخروج');
  workTypeId = await mkCatalog('workType', 'صيانة سائق الخروج');
  firstDriver = await mkDriver('سائق الخروج الأول');
  secondDriver = await mkDriver('سائق الخروج البديل');
}, 300_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«سائق الخروج» in the workshop edit', () => {
  it('a CLOSED visit takes another exit driver — stored, answered, and audited', async () => {
    const visit = await closedVisit();
    expect(visit.driverOutEmployeeId).toBe(firstDriver);

    const res = await edit(visit.id, {
      driverOutEmployeeId: secondDriver,
      version: visit.version,
    });
    const dto = ok<FleetMaintenanceVisitDto>(res);
    expect(dto.driverOutEmployeeId).toBe(secondDriver);
    // A correction of one fact: the rest of the exit stays as it was.
    expect(dto.outDate).toBe(visit.outDate);
    expect(dto.exitOdometer).toBe(visit.exitOdometer);
    expect(dto.takenOutByEmployeeId).toBe(visit.takenOutByEmployeeId);
    expect(dto.driverInEmployeeId).toBe(firstDriver);
    expect(dto.version).toBe(visit.version + 1);
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(secondDriver);

    // The list reads it too — the screen's «سائق الخروج».
    const listed = ok<FleetMaintenanceVisitDto[]>(
      await get('/fleet/maintenance', { vehicleId: visit.vehicleId }),
    );
    expect(listed.find((row) => row.id === visit.id)?.driverOutEmployeeId).toBe(secondDriver);

    // Through the update's own audit row, old and new.
    const audits = await updateAudits(visit.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes).toContainEqual({
      field: 'driverOutEmployeeId',
      old: firstDriver,
      new: secondDriver,
    });
  });

  it('an OPEN visit refuses it — check-out sets it — and nothing is written', async () => {
    const visit = await openVisit();
    const res = await edit(visit.id, {
      driverOutEmployeeId: secondDriver,
      notes: 'لا تُكتب',
      version: visit.version,
    });
    expect(res.status).toBe(400);
    expect(errorDetails(res)).toContainEqual(
      expect.objectContaining({ field: 'body.driverOutEmployeeId', code: 'INVALID' }),
    );
    const after = await stored(visit.id);
    expect(after?.driverOutEmployeeId).toBeNull();
    expect(after?.outDate).toBeNull();
    expect(after?.__v).toBe(visit.version);
    expect(await updateAudits(visit.id)).toHaveLength(0);
  });

  it('refuses an id HR does not know, and leaves the stored driver alone', async () => {
    const visit = await closedVisit();
    const res = await edit(visit.id, {
      driverOutEmployeeId: String(new Types.ObjectId()),
      version: visit.version,
    });
    expect(res.status).toBe(400);
    expect(errorDetails(res)).toContainEqual(
      expect.objectContaining({ field: 'body.driverOutEmployeeId', code: 'UNKNOWN' }),
    );
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(firstDriver);
  });

  it('a correction, never a clear: null is refused', async () => {
    const visit = await closedVisit();
    const res = await edit(visit.id, { driverOutEmployeeId: null, version: visit.version });
    expect(res.status).toBe(400);
    expect(JSON.stringify(errorDetails(res))).toContain('driverOutEmployeeId');
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(firstDriver);
  });

  it('a stale version is a conflict, as on every edit', async () => {
    const visit = await closedVisit();
    ok(await edit(visit.id, { notes: 'تعديل سابق', version: visit.version }));
    const res = await edit(visit.id, { driverOutEmployeeId: secondDriver, version: visit.version });
    expect(res.status).toBe(409);
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(firstDriver);
  });

  it('a copy from before someone reopened the visit is stale (409), not a field to fix', async () => {
    const visit = await closedVisit();
    // Reopened elsewhere while «تعديل» was still showing the closed visit.
    const reopened = ok<FleetMaintenanceVisitDto>(
      await post(`/fleet/maintenance/${visit.id}/reopen`, { version: visit.version }),
    );
    const res = await edit(visit.id, { driverOutEmployeeId: secondDriver, version: visit.version });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('STALE_DOCUMENT');
    const after = await stored(visit.id);
    expect(after?.driverOutEmployeeId).toBeNull();
    expect(after?.__v).toBe(reopened.version);
    // With the copy reloaded, the open visit refuses it as before.
    const fresh = await edit(visit.id, {
      driverOutEmployeeId: secondDriver,
      version: reopened.version,
    });
    expect(fresh.status).toBe(400);
    expect(errorDetails(fresh)).toContainEqual(
      expect.objectContaining({ field: 'body.driverOutEmployeeId', code: 'INVALID' }),
    );
  });

  it('fleetMaintenance.edit is enough — no check-out grant is needed to correct it', async () => {
    const visit = await closedVisit();
    const role = await rbacService.createRole(
      {
        name: { en: 'Workshop editor', ar: 'محرر الورشة' },
        permissionKeys: ['fleetMaintenance.view', 'fleetMaintenance.edit'],
      },
      adminUserId,
    );
    const userId = await mkUser('maintenance-exit-driver-editor@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    const token = await authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);

    const dto = ok<FleetMaintenanceVisitDto>(
      await edit(visit.id, { driverOutEmployeeId: secondDriver, version: visit.version }, token),
    );
    expect(dto.driverOutEmployeeId).toBe(secondDriver);
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(secondDriver);
  });

  it('needs fleetMaintenance.edit, like the rest of the edit — check-out alone is not enough', async () => {
    const visit = await closedVisit();
    const role = await rbacService.createRole(
      {
        name: { en: 'Workshop door', ar: 'باب الورشة' },
        permissionKeys: [
          'fleetMaintenance.view',
          'fleetMaintenance.checkIn',
          'fleetMaintenance.checkOut',
        ],
      },
      adminUserId,
    );
    const userId = await mkUser('maintenance-exit-driver-door@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    const token = await authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);

    const res = await edit(
      visit.id,
      { driverOutEmployeeId: secondDriver, version: visit.version },
      token,
    );
    expect(res.status).toBe(403);
    expect(String((await stored(visit.id))?.driverOutEmployeeId)).toBe(firstDriver);
  });

  it('asks HR only when it CHANGES — the stored driver who has since left still saves', async () => {
    const leaving = await mkDriver('سائق غادر الدليل');
    const opened = await openVisit();
    const visit = ok<FleetMaintenanceVisitDto>(
      await post(`/fleet/maintenance/${opened.id}/check-out`, {
        outDate: '2026-10-03',
        exitOdometer: 50_100,
        driverOutEmployeeId: leaving,
        version: opened.version,
      }),
    );
    await EmployeeModel.updateOne(
      { _id: new Types.ObjectId(leaving) },
      { $set: { isDeleted: true } },
    );

    // The same id back — spelled in capitals too, which is the same id — is not re-asked.
    const same = await edit(visit.id, {
      driverOutEmployeeId: leaving.toUpperCase(),
      notes: 'تصحيح ملاحظة',
      version: visit.version,
    });
    const dto = ok<FleetMaintenanceVisitDto>(same);
    expect(dto.driverOutEmployeeId).toBe(leaving);
    expect(dto.notes).toBe('تصحيح ملاحظة');

    // …but choosing them on ANOTHER visit is a change, and HR no longer knows them.
    const other = await closedVisit();
    const refused = await edit(other.id, { driverOutEmployeeId: leaving, version: other.version });
    expect(refused.status).toBe(400);
    expect(errorDetails(refused)).toContainEqual(
      expect.objectContaining({ field: 'body.driverOutEmployeeId', code: 'UNKNOWN' }),
    );
  });

  it('an old-book visit with only the book’s spelling gets an employee; the spelling stays', async () => {
    const doc = await FleetMaintenanceVisitModel.create({
      isDeleted: false,
      schemaVersion: 1,
      createdBy: null,
      updatedBy: null,
      vehicleId: null,
      vehicleCode: 'كوستر الدفتر',
      inDate: new Date('2026-03-01T00:00:00.000Z'),
      outDate: new Date('2026-03-02T00:00:00.000Z'),
      workshopId: new Types.ObjectId(workshopId),
      workTypeId: new Types.ObjectId(workTypeId),
      spareParts: [],
      sparePartIds: [],
      odometerAtService: null,
      exitOdometer: null,
      driverInEmployeeId: null,
      driverOutEmployeeId: null,
      driverInName: 'سائق دخول الدفتر',
      driverOutName: 'سائق خروج الدفتر',
      takenInByEmployeeId: null,
      takenOutByEmployeeId: null,
      notes: null,
    });
    const id = String(doc._id);
    const res = await edit(id, { driverOutEmployeeId: secondDriver, version: doc.__v });
    const dto = ok<FleetMaintenanceVisitDto>(res);
    expect(dto.driverOutEmployeeId).toBe(secondDriver);
    // The employee now shows instead of the spelling; the spelling itself is not rewritten.
    expect(dto.driverOutName).toBe('سائق خروج الدفتر');
    expect(dto.driverInName).toBe('سائق دخول الدفتر');
    expect(dto.driverInEmployeeId).toBeNull();
    expect((await stored(id))?.driverOutName).toBe('سائق خروج الدفتر');
  });

  it('nothing else moved: reopen still clears it, and check-out still requires it', async () => {
    const visit = await closedVisit();
    const corrected = ok<FleetMaintenanceVisitDto>(
      await edit(visit.id, { driverOutEmployeeId: secondDriver, version: visit.version }),
    );
    const reopened = ok<FleetMaintenanceVisitDto>(
      await post(`/fleet/maintenance/${visit.id}/reopen`, { version: corrected.version }),
    );
    expect(reopened.outDate).toBeNull();
    expect(reopened.driverOutEmployeeId).toBeNull();

    const noDriver = await post(`/fleet/maintenance/${visit.id}/check-out`, {
      outDate: '2026-10-04',
      exitOdometer: 50_300,
      version: reopened.version,
    });
    expect(noDriver.status).toBe(400);
    // Refused by the schema for the missing driver, not by some other rule.
    expect(errorDetails(noDriver)).toContainEqual(
      expect.objectContaining({ field: 'body.driverOutEmployeeId' }),
    );
    expect((await stored(visit.id))?.outDate).toBeNull();
  });
});
