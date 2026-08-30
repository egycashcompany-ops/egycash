// Fleet integration suite (FL-2 + FL-3): vehicle types, catalogs, the vehicle registry and its
// lifecycle, driver profiles as HR-employee extensions (directory seam), and the availability
// overlay (التمامات) with its layered seam. Exercises §4.1 (disposed terminal, reasons required),
// FR-1 uniqueness, FR-11 (no HR duplication), RBAC + data scopes, version-aware updates, and the
// five promoted fleet.* events reaching the bus.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  FleetEvents,
  FleetSettingKeys,
  MAX_PAGE_SIZE,
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDriverProfileDto,
  type FleetDriverUnavailabilityDto,
  type FleetMaintenanceVisitDto,
  type FleetOdometerLogDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type PageMeta,
  SaveFleetFixedRosterSchema,
} from '@ecms/contracts';
import mongoose, { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { migrateFixedCrewIndex } from '../../src/modules/fleet/fleet.migration';
import {
  inspectLegacyWorkTypes,
  retireLegacyWorkTypes,
} from '../../src/modules/fleet/fixed-roster/legacy-work-type-retirement';
import { fleetRosterService } from '../../src/modules/fleet/roster/roster.service';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import {
  licenseExpirySweep,
  maintenanceAlarmSweep,
} from '../../src/modules/fleet/sweeps/fleet-sweeps';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { driverAvailabilityOn } from '../../src/modules/fleet/availability/driver-availability';
import { registerLeaveLookup } from '../../src/platform/directory';
import { emit, subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext, type ScopeSelector } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminUserId: string; // a REAL user id — settings writes stamp updatedBy as an ObjectId
let branchAToken: string; // fleetVehicle.* at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
let departmentAId: string; // real org rows — direct registration validates the referents
let jobTitleAId: string;
let typeId: string;
const seenEvents: { name: string; payload: unknown }[] = [];
let vehicleCounter = 100;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-test-${Date.now()}`;
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

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

// In-process events fan out fire-and-forget (`dispatchInProcess`), so `await emit(...)` returns
// before the subscriber has touched the database — asserting immediately is a race that only
// loses under load. Poll instead, the same way files/audit/notifications specs do.
const waitFor = async (predicate: () => boolean | Promise<boolean>, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await predicate()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

let nidCounter = 0;
let phoneCounter = 40_000_000;
const nextNid = (): string => `290010101${String(30_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/** HR employee via the real direct-registration endpoint — Fleet never fabricates one. */
const mkEmployee = async (
  over: { fullNameAr?: string; phone?: string; governorate?: string } = {},
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: over.fullNameAr ?? 'سائق اختبار',
          nationalId: nextNid(),
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: over.phone ?? nextPhone() },
        ...(over.governorate === undefined
          ? {}
          : {
              officialAddress: {
                line1: 'شارع الاختبار',
                city: 'مدينة الاختبار',
                governorate: over.governorate,
              },
            }),
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: jobTitleAId,
        departmentId: departmentAId,
        branchId: branchAId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

/**
 * One driver employee, made on first use and reused.
 *
 * Check-in and check-out both REQUIRE a driver now, so every maintenance call needs one. The
 * tests that are about something else take this; the tests that are about the driver make their
 * own so they can tell people apart.
 */
let sharedDriverId: string | null = null;
const someDriver = async (): Promise<string> => {
  if (sharedDriverId === null) sharedDriverId = await mkEmployee({ fullNameAr: 'سائق افتراضي' });
  return sharedDriverId;
};

/** Drops keys explicitly set to `undefined`, so a test can omit a field on purpose. */
const withoutUndefined = (body: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));

const mkDriverProfile = async (employeeId: string): Promise<FleetDriverProfileDto> => {
  const res = await request(app)
    .post('/api/v1/fleet/drivers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      employeeId,
      licenseNumber: `LIC-${nidCounter}`,
      licenseExpiresAt: '2028-01-01T00:00:00.000Z',
      specialization: 'cashTransport',
    });
  expect(res.status).toBe(201);
  return data<FleetDriverProfileDto>(res);
};

const createVehicle = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> => {
  const n = vehicleCounter++;
  return request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      code: `V${n}`,
      typeId,
      plateNumber: `س ص ${n}`,
      chassisNumber: `CH-${n}`,
      motorNumber: `MO-${n}`,
      joinedAt: '2024-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-01-01T00:00:00.000Z',
      radio: { issi: `ISSI-${n}` },
      branchId: branchAId,
      ...overrides,
    });
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
  adminUserId = adminId;
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
  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('90', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('91', 'فرع ب', 'Branch B');

  // Direct registration verifies the department belongs to the branch and the title is active,
  // so the drivers this suite hires need REAL org rows, not fabricated ids.
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: 'FL-OPS',
      name: { ar: 'إدارة الحركة', en: 'Fleet Operations' },
      branchId: branchAId,
    });
  expect(dept.status).toBe(201);
  departmentAId = (dept.body as { data: { id: string } }).data.id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'FL-DRV', name: { ar: 'سائق', en: 'Driver' }, jobGrade: 'G1' });
  expect(title.status).toBe(201);
  jobTitleAId = (title.body as { data: { id: string } }).data.id;

  // Branch-scoped fleet operator: full vehicle actions, scope = branch, placed in branch A.
  const branchRole = await rbacService.createRole(
    {
      name: { en: 'Fleet operator', ar: 'مشرف حركة' },
      permissionKeys: [
        'fleetVehicle.view',
        'fleetVehicle.create',
        'fleetVehicle.edit',
        'fleetVehicle.changeStatus',
        'fleetVehicle.delete',
      ],
    },
    adminId,
  );
  const branchUserId = await mkUser('fleet-a@ecms.local', branchAId);
  await rbacService.ensureAssignment(branchUserId, String(branchRole._id), 'branch');

  for (const name of [
    FleetEvents.VehicleCreated,
    FleetEvents.VehicleUpdated,
    FleetEvents.VehicleStatusChanged,
    FleetEvents.VehicleLicenseImageUploaded,
    FleetEvents.VehicleLicenseImageDeleted,
    FleetEvents.DriverLicenseImageUploaded,
    FleetEvents.DriverLicenseImageDeleted,
    FleetEvents.UnavailabilityRecorded,
    FleetEvents.UnavailabilityEnded,
    FleetEvents.OdometerRecorded,
    FleetEvents.OdometerCorrected,
    FleetEvents.MaintenanceCheckedIn,
    FleetEvents.MaintenanceCheckedOut,
    FleetEvents.MaintenanceReopened,
    FleetEvents.MaintenanceAlarmRaised,
    FleetEvents.VehicleLicenseExpiring,
    FleetEvents.DriverLicenseExpired,
    FleetEvents.RosterPlanned,
    FleetEvents.AssignmentChanged,
    FleetEvents.AccidentRecorded,
    FleetEvents.AccidentClosed,
    FleetEvents.AccidentReopened,
    FleetEvents.ViolationRecorded,
    FleetEvents.GrievanceApplied,
  ]) {
    subscribe(name, `fleet-test-${name}`, (envelope) => {
      seenEvents.push({ name: envelope.name, payload: envelope.payload });
    });
  }

  branchAToken = await login('fleet-a@ecms.local');

  const typeRes = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'غزالة مصفحة', en: 'Armored Gazelle' }, maintenanceIntervalKm: 10_000 });
  expect(typeRes.status).toBe(201);
  typeId = data<FleetVehicleTypeDto>(typeRes).id;
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('vehicle types + catalogs', () => {
  it('rejects a duplicate type name and lists the seeded catalogs', async () => {
    const dup = await request(app)
      .post('/api/v1/fleet/vehicle-types')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'غزالة مصفحة', en: 'Duplicate' }, maintenanceIntervalKm: 5000 });
    expect(dup.status).toBe(409);

    const catalogs = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(catalogs.status).toBe(200);
    const items = data<FleetCatalogItemDto[]>(catalogs);
    const maint = items.find((i) => i.name.ar === 'صيانة');
    expect(maint?.countsForAlarm).toBe(true);
  });

  it('refuses countsForAlarm on anything but a workType', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        kind: 'workshop',
        name: { ar: 'ورشة النصر', en: 'Nasr shop' },
        countsForAlarm: true,
      });
    expect(res.status).toBe(400);
  });

  it('catalog mutations need fleetCatalog.manage — the branch operator lacks it', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${branchAToken}`)
      .send({ kind: 'workshop', name: { ar: 'ورشة', en: 'Shop' } });
    expect(res.status).toBe(403);
  });
});

describe('vehicle registry (FR-1, §4.1)', () => {
  it('creates a vehicle, derives inWorkshop=false, and publishes fleet.vehicle.created', async () => {
    const res = await createVehicle(adminToken);
    expect(res.status).toBe(201);
    const dto = data<FleetVehicleDto>(res);
    expect(dto.status).toBe('active');
    expect(dto.inWorkshop).toBe(false);
    expect(seenEvents.some((e) => e.name === FleetEvents.VehicleCreated)).toBe(true);
  });

  it('enforces the four unique identifiers among non-deleted vehicles', async () => {
    const first = data<FleetVehicleDto>(await createVehicle(adminToken));
    const dupCode = await createVehicle(adminToken, { code: first.code });
    expect(dupCode.status).toBe(409);
    const dupPlate = await createVehicle(adminToken, { plateNumber: first.plateNumber });
    expect(dupPlate.status).toBe(409);
  });

  it('updates are version-aware — a stale version is refused', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const ok1 = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      // The field is incidental — this test is about the VERSION. `licenseClassId` replaced the
      // free-text `licenseClass` in the catalogs slice, and clearing it is a valid, collision-free
      // edit (unlike the unique identifiers).
      .send({ licenseClassId: null, version: v.version });
    expect(ok1.status).toBe(200);
    const stale = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ licenseClassId: null, version: v.version });
    expect(stale.status).toBe(409);
  });

  it('walks the lifecycle: reason required, disposed terminal, reason cleared on return', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));

    const out = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'outOfService', reason: 'عطل جسيم', version: v.version });
    expect(out.status).toBe(200);
    expect(data<FleetVehicleDto>(out).statusReason).toBe('عطل جسيم');
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.VehicleStatusChanged &&
          (e.payload as { to: string }).to === 'outOfService',
      ),
    ).toBe(true);

    const back = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active', version: data<FleetVehicleDto>(out).version });
    expect(back.status).toBe(200);
    expect(data<FleetVehicleDto>(back).statusReason).toBeNull();

    const disposed = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'disposed', reason: 'تكهين', version: data<FleetVehicleDto>(back).version });
    expect(disposed.status).toBe(200);

    // Terminal: no way out, and no edits.
    const revive = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active', version: data<FleetVehicleDto>(disposed).version });
    expect(revive.status).toBe(409);
    const edit = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ licenseClassId: null, version: data<FleetVehicleDto>(disposed).version });
    expect(edit.status).toBe(409);
  });

  it('a missing reason on leaving active is a validation error', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'outOfService', version: v.version });
    expect(res.status).toBe(400);
  });

  it('soft delete frees the code for a new vehicle (partial unique indexes)', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const del = await request(app)
      .delete(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    const reuse = await createVehicle(adminToken, {
      code: v.code,
      plateNumber: v.plateNumber,
      chassisNumber: v.chassisNumber,
      motorNumber: v.motorNumber,
    });
    expect(reuse.status).toBe(201);
  });

  it('rejects an unknown or inactive vehicle type', async () => {
    const res = await createVehicle(adminToken, { typeId: '64b1f0aaaaaaaaaaaaaaaaaa' });
    expect(res.status).toBe(400);
  });
});

describe('data scopes (§7 — the roster branch hardcode became scope)', () => {
  it('a branch-scoped operator sees their branch only; the other branch 404s', async () => {
    const inA = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchAId }));
    const inB = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchBId }));

    const list = await request(app)
      .get('/api/v1/fleet/vehicles')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${branchAToken}`);
    expect(list.status).toBe(200);
    const ids = data<FleetVehicleDto[]>(list).map((x) => x.id);
    expect(ids).toContain(inA.id);
    expect(ids).not.toContain(inB.id);

    const cross = await request(app)
      .get(`/api/v1/fleet/vehicles/${inB.id}`)
      .set('Authorization', `Bearer ${branchAToken}`);
    expect(cross.status).toBe(404);
  });

  it('unauthenticated and unauthorized callers are refused', async () => {
    expect((await request(app).get('/api/v1/fleet/vehicles')).status).toBe(401);
    const aliceId = await mkUser('noperm@ecms.local');
    void aliceId;
    const token = await login('noperm@ecms.local');
    const res = await request(app)
      .get('/api/v1/fleet/vehicles')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('driver profiles (FL-3 — FR-11, the HR extension)', () => {
  it('refuses a profile for an unknown employee (directory seam, fail-closed)', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/drivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId: '64b1f0dddddddddddddddd01',
        licenseNumber: 'X-1',
        licenseExpiresAt: '2028-01-01T00:00:00.000Z',
        specialization: 'atm',
      });
    expect(res.status).toBe(400);
  });

  it('creates one profile per employee and refuses a second', async () => {
    const employeeId = await mkEmployee();
    const profile = await mkDriverProfile(employeeId);
    expect(profile.employeeId).toBe(employeeId);
    expect(profile.isActive).toBe(true);

    const dup = await request(app)
      .post('/api/v1/fleet/drivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId,
        licenseNumber: 'X-2',
        licenseExpiresAt: '2028-01-01T00:00:00.000Z',
        specialization: 'atm',
      });
    expect(dup.status).toBe(409);
  });

  it('profile mutations need fleetDriver.manage — the branch operator lacks it', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/drivers')
      .set('Authorization', `Bearer ${branchAToken}`)
      .send({
        employeeId: '64b1f0dddddddddddddddd02',
        licenseNumber: 'X-3',
        licenseExpiresAt: '2028-01-01T00:00:00.000Z',
        specialization: 'both',
      });
    expect(res.status).toBe(403);
  });

  it('hr.employee.exited deactivates the profile (event-driven, no HR import)', async () => {
    const employeeId = await mkEmployee();
    await mkDriverProfile(employeeId);
    await emit('hr.employee.exited', { employeeId, code: '000999', exitType: 'resignation' });
    const readProfile = async (): Promise<FleetDriverProfileDto | undefined> => {
      const listed = await request(app)
        .get('/api/v1/fleet/drivers')
        .query({ pageSize: 100 })
        .set('Authorization', `Bearer ${adminToken}`);
      return data<FleetDriverProfileDto[]>(listed).find((d) => d.employeeId === employeeId);
    };
    await waitFor(async () => (await readProfile())?.isActive === false);
    expect((await readProfile())?.isActive).toBe(false);
  });
});

describe('driver unavailability — التمامات (FL-3)', () => {
  it('requires a driver profile, records with an event, and answers coversDate', async () => {
    const employeeId = await mkEmployee();

    const noProfile = await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId, from: '2026-09-01', to: '2026-09-03', reason: 'مأمورية' });
    expect(noProfile.status).toBe(400);

    await mkDriverProfile(employeeId);
    const created = await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId, from: '2026-09-01', to: '2026-09-03', reason: 'مأمورية' });
    expect(created.status).toBe(201);
    expect(seenEvents.some((e) => e.name === FleetEvents.UnavailabilityRecorded)).toBe(true);

    const covering = await request(app)
      .get('/api/v1/fleet/availability')
      .query({ coversDate: '2026-09-02', employeeId, pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetDriverUnavailabilityDto[]>(covering).length).toBe(1);
    const outside = await request(app)
      .get('/api/v1/fleet/availability')
      .query({ coversDate: '2026-09-10', employeeId, pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetDriverUnavailabilityDto[]>(outside).length).toBe(0);
  });

  it('cancellation soft-deletes and publishes .ended', async () => {
    const employeeId = await mkEmployee();
    await mkDriverProfile(employeeId);
    const created = await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId, from: '2026-10-01', to: '2026-10-05', reason: 'عهدة خارجية' });
    const id = data<FleetDriverUnavailabilityDto>(created).id;

    const del = await request(app)
      .delete(`/api/v1/fleet/availability/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    expect(seenEvents.some((e) => e.name === FleetEvents.UnavailabilityEnded)).toBe(true);
  });

  it('the availability seam layers profile, overlay, and HR leave (owner Q1)', async () => {
    const employeeId = await mkEmployee();
    expect(await driverAvailabilityOn(employeeId, new Date('2026-09-02'))).toEqual({
      available: false,
      reason: 'noProfile',
    });

    await mkDriverProfile(employeeId);
    await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId, from: '2026-09-01', to: '2026-09-03', reason: 'مأمورية' });

    expect((await driverAvailabilityOn(employeeId, new Date('2026-09-02'))).reason).toBe(
      'fleetUnavailability',
    );
    expect((await driverAvailabilityOn(employeeId, new Date('2026-09-10'))).available).toBe(true);

    // HR leave through the seam: the platform allows overriding the lookup (last wins), so the
    // fleet-side layering is tested without fabricating HR leave rows.
    registerLeaveLookup(async (id) => id === employeeId);
    expect((await driverAvailabilityOn(employeeId, new Date('2026-09-10'))).reason).toBe('hrLeave');
    registerLeaveLookup(async () => false);
  });
});

describe('odometer continuity (FR-2, §4.3 — FL-4)', () => {
  const record = (vehicleId: string, reading: number, date: string) =>
    request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId, reading, date });

  it('one reading closes the previous period and opens the next, km server-derived', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect((await record(v.id, 1000, '2026-07-10')).status).toBe(201);
    expect((await record(v.id, 1500, '2026-07-11')).status).toBe(201);

    const logs = await request(app)
      .get('/api/v1/fleet/odometer')
      .query({ vehicleId: v.id, pageSize: 10, sortBy: 'outReading', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = data<{ outReading: number; inReading: number | null; km: number | null }[]>(logs);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ outReading: 1000, inReading: 1500, km: 500 });
    expect(rows[1]).toMatchObject({ outReading: 1500, inReading: null, km: null });
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.OdometerRecorded &&
          (e.payload as { closedKm: number | null }).closedKm === 500,
      ),
    ).toBe(true);

    const expected = await request(app)
      .get('/api/v1/fleet/odometer/expected')
      .query({ vehicleId: v.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<{ expectedReading: number }>(expected).expectedReading).toBe(1500);
  });

  it('the odometer never runs backwards — a lower reading is refused (FR-2)', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 5000, '2026-07-10');
    expect((await record(v.id, 4900, '2026-07-11')).status).toBe(409);
  });

  it('correcting a shared reading rewrites BOTH rows and keeps the chain whole', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 1000, '2026-07-10');
    await record(v.id, 1500, '2026-07-11');
    await record(v.id, 2200, '2026-07-12');

    const logs = data<{ id: string; outReading: number; version: number }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer')
        .query({ vehicleId: v.id, pageSize: 10, sortBy: 'outReading', sortDir: 'asc' })
        .set('Authorization', `Bearer ${adminToken}`),
    );
    const middle = logs.find((l) => l.outReading === 1500);

    const corrected = await request(app)
      .patch(`/api/v1/fleet/odometer/${middle?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outReading: 1400, version: middle?.version });
    expect(corrected.status).toBe(200);

    const after = data<
      {
        id: string;
        outReading: number;
        inReading: number | null;
        km: number | null;
        version: number;
      }[]
    >(
      await request(app)
        .get('/api/v1/fleet/odometer')
        .query({ vehicleId: v.id, pageSize: 10, sortBy: 'outReading', sortDir: 'asc' })
        .set('Authorization', `Bearer ${adminToken}`),
    );
    // The previous period's CLOSING reading moved with it — one physical fact, two rows.
    expect(after[0]).toMatchObject({ outReading: 1000, inReading: 1400, km: 400 });
    expect(after[1]).toMatchObject({ outReading: 1400, inReading: 2200, km: 800 });
    expect(seenEvents.some((e) => e.name === FleetEvents.OdometerCorrected)).toBe(true);

    // A correction that breaks the chain order is refused.
    const bad = await request(app)
      .patch(`/api/v1/fleet/odometer/${after[1]?.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outReading: 900, version: after[1]?.version });
    expect([400, 409]).toContain(bad.status);
  });

  it('recording and correcting are separate grants — the branch operator holds neither', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${branchAToken}`)
      .send({ vehicleId: v.id, reading: 10, date: '2026-07-10' });
    expect(res.status).toBe(403);
  });
});

describe('a vehicle records on as many days as it runs (legacy cars_log)', () => {
  const record = (vehicleId: string, reading: number, date: string) =>
    request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId, reading, date });

  const logsFor = async (vehicleId: string) =>
    data<FleetOdometerLogDto[]>(
      await request(app)
        .get('/api/v1/fleet/odometer')
        // By DATE, not by reading: a standing day repeats the reading, and sorting on a tied
        // column leaves the order to the database — which would make these assertions flaky.
        .query({ vehicleId, pageSize: 50, sortBy: 'date', sortDir: 'asc' })
        .set('Authorization', `Bearer ${adminToken}`),
    );

  it('records the same vehicle on a later day, closing the first period and opening the second', async () => {
    // The behaviour the legacy had and the one an operator relies on daily: a previous reading is
    // not a reason to refuse the next one. `ux_open_period` bounds how many periods may be OPEN at
    // once (one), never how many readings a vehicle may have.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const other = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(other.id, 500, '2026-11-01');

    // 1. the first reading
    expect((await record(v.id, 10_000, '2026-11-18')).status).toBe(201);
    // 2. a second reading, same vehicle, a later day
    expect((await record(v.id, 10_250, '2026-11-19')).status).toBe(201);

    // 3. both are there
    const rows = await logsFor(v.id);
    expect(rows).toHaveLength(2);

    // 4. the first was closed BY the second, with km derived from the pair
    expect(rows[0]).toMatchObject({ outReading: 10_000, inReading: 10_250, km: 250 });

    // 5. the second is the open period
    expect(rows[1]).toMatchObject({ outReading: 10_250, inReading: null, km: null });

    // 6. the other vehicle is untouched — still its own single open period
    const otherRows = await logsFor(other.id);
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0]).toMatchObject({ outReading: 500, inReading: null, km: null });
  });

  it('keeps going for a third and fourth day — the chain has no ceiling', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    for (const [reading, date] of [
      [1000, '2026-11-01'],
      [1200, '2026-11-02'],
      [1500, '2026-11-03'],
      [1500, '2026-11-04'],
    ] as const) {
      expect((await record(v.id, reading, date)).status, `${date} accepted`).toBe(201);
    }
    const rows = await logsFor(v.id);
    expect(rows).toHaveLength(4);
    // Each closed period's km is the step to the next reading; a standing day is a real 0.
    expect(rows.map((r) => r.km)).toEqual([200, 300, 0, null]);
    // Exactly ONE open period survives, and it is the last.
    expect(rows.filter((r) => r.inReading === null)).toHaveLength(1);
    expect(rows[3]?.inReading).toBeNull();
  });

  it('refuses only a reading that runs the odometer BACKWARDS, never a repeat visit', async () => {
    // The one refusal FR-2 makes, and the one an operator can mistake for "this car is already
    // recorded": a lower reading on a later day. The same day's second reading is fine as long as
    // the number does not go down.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 8000, '2026-12-01');
    const backwards = await record(v.id, 7900, '2026-12-02');
    expect(backwards.status).toBe(409);
    expect(JSON.stringify(backwards.body)).toContain('FR-2');
    // …and the forward reading right after it still lands, so the refusal blocked the number and
    // not the vehicle.
    expect((await record(v.id, 8100, '2026-12-02')).status).toBe(201);
    expect(await logsFor(v.id)).toHaveLength(2);
  });

  it('never stores two open periods for one vehicle, however many days it runs', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    for (let day = 1; day <= 5; day += 1) {
      await record(v.id, 2000 + day * 100, `2026-12-1${day}`);
    }
    const rows = await logsFor(v.id);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.inReading === null)).toHaveLength(1);
  });
});

describe('the odometer registry filters SERVER-side', () => {
  const record = (vehicleId: string, reading: number, date: string, drivers = {}) =>
    request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId, reading, date, ...drivers });

  const list = (query: Record<string, unknown>) =>
    request(app)
      .get('/api/v1/fleet/odometer')
      .query({ pageSize: 100, ...query })
      .set('Authorization', `Bearer ${adminToken}`);

  it('narrows to several vehicles at once, BY CODE', async () => {
    const a = data<FleetVehicleDto>(await createVehicle(adminToken));
    const b = data<FleetVehicleDto>(await createVehicle(adminToken));
    const c = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(a.id, 100, '2026-09-01');
    await record(b.id, 200, '2026-09-01');
    await record(c.id, 300, '2026-09-01');

    const res = await list({ vehicleCodes: `${a.code},${b.code}` });
    expect(res.status).toBe(200);
    const ids = new Set(data<{ vehicleId: string }[]>(res).map((r) => r.vehicleId));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(c.id), 'a vehicle outside the filter is excluded').toBe(false);
  });

  it('a code that matches no vehicle returns NOTHING, not everything', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 100, '2026-09-02');
    const res = await list({ vehicleCodes: 'NO-SUCH-CODE' });
    expect(res.status).toBe(200);
    expect(data<unknown[]>(res)).toHaveLength(0);
  });

  it('matches a driver in EITHER slot', async () => {
    const morning = await mkEmployee();
    const evening = await mkEmployee();
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 100, '2026-09-03', { driver1EmployeeId: morning });
    await record(v.id, 200, '2026-09-04', { driver2EmployeeId: evening });

    const asMorning = await list({ vehicleCodes: v.code, driverEmployeeIds: morning });
    expect(data<unknown[]>(asMorning)).toHaveLength(1);
    const asEvening = await list({ vehicleCodes: v.code, driverEmployeeIds: evening });
    expect(data<unknown[]>(asEvening)).toHaveLength(1);
    // Both at once is the union of the two slots, not their intersection.
    const both = await list({
      vehicleCodes: v.code,
      driverEmployeeIds: `${morning},${evening}`,
    });
    expect(data<unknown[]>(both)).toHaveLength(2);
  });

  it('a single day means the WHOLE day, however the reading was stamped', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    // Stamped mid-afternoon: `$lte` against a bare date would have stopped at midnight and
    // missed it, which is what made the single-day filter look broken.
    await record(v.id, 100, '2026-09-05T14:30:00.000Z');
    const sameDay = await list({ vehicleCodes: v.code, from: '2026-09-05', to: '2026-09-05' });
    expect(data<unknown[]>(sameDay)).toHaveLength(1);
    const dayBefore = await list({ vehicleCodes: v.code, from: '2026-09-04', to: '2026-09-04' });
    expect(data<unknown[]>(dayBefore)).toHaveLength(0);
  });

  it('a range spans its bounds inclusively', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 100, '2026-09-10');
    await record(v.id, 200, '2026-09-11');
    await record(v.id, 300, '2026-09-12');
    const res = await list({ vehicleCodes: v.code, from: '2026-09-10', to: '2026-09-12' });
    expect(data<unknown[]>(res)).toHaveLength(3);
  });

  it('filters on the DERIVED alarm level, and pages the filtered result', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await record(v.id, 100, '2026-09-20');
    // A vehicle with no maintenance rule or baseline is 'none' — never a false alarm.
    const none = await list({ vehicleCodes: v.code, alerts: 'none' });
    expect(none.status).toBe(200);
    expect(data<unknown[]>(none).length).toBeGreaterThan(0);
    // …and asking only for the alarmed levels excludes it.
    const alarmed = await list({ vehicleCodes: v.code, alerts: 'yellow,red' });
    expect(alarmed.status).toBe(200);
    expect(data<unknown[]>(alarmed)).toHaveLength(0);
  });

  it('refuses a level that is not a level, rather than ignoring the filter', async () => {
    expect((await list({ alerts: 'purple' })).status).toBe(400);
  });

  it('page 2 is page 2 OF THE FILTERED result', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const other = data<FleetVehicleDto>(await createVehicle(adminToken));
    for (let i = 1; i <= 3; i += 1) await record(v.id, i * 100, `2026-10-0${i}`);
    for (let i = 1; i <= 3; i += 1) await record(other.id, i * 100, `2026-10-0${i}`);

    const first = await list({
      vehicleCodes: v.code,
      pageSize: 2,
      page: 1,
      sortBy: 'outReading',
      sortDir: 'asc',
    });
    const second = await list({
      vehicleCodes: v.code,
      pageSize: 2,
      page: 2,
      sortBy: 'outReading',
      sortDir: 'asc',
    });
    expect(data<unknown[]>(first)).toHaveLength(2);
    expect(data<unknown[]>(second)).toHaveLength(1);
    // Every row on both pages belongs to the filtered vehicle — the filter is not applied after
    // the page was cut.
    for (const row of [
      ...data<{ vehicleId: string }[]>(first),
      ...data<{ vehicleId: string }[]>(second),
    ]) {
      expect(row.vehicleId).toBe(v.id);
    }
  });

  it('counts the WHOLE filtered set, and returns only the page asked for', async () => {
    // The point of server-side paging: the total describes everything the filters match, while
    // the payload carries only one page of it. A client that computed the total from the rows in
    // hand would report 2 instead of 7, and one that were handed everything would defeat the
    // purpose on a log this size.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    for (let day = 1; day <= 7; day += 1) {
      await record(v.id, day * 100, `2026-12-0${day}`);
    }
    // One reading OUTSIDE the window, to prove the date bound is applied before the count.
    await record(v.id, 5000, '2027-01-15');

    const meta = (res: request.Response) => (res.body as { meta: PageMeta }).meta;

    const first = await list({
      vehicleCodes: v.code,
      from: '2026-12-01',
      to: '2026-12-07',
      pageSize: 2,
      page: 1,
    });
    expect(first.status).toBe(200);
    expect(data<unknown[]>(first), 'only the page asked for').toHaveLength(2);
    expect(meta(first).totalItems, 'every row the filters match, not the two returned').toBe(7);
    expect(meta(first).totalPages).toBe(4);
    expect(meta(first).page).toBe(1);
    expect(meta(first).pageSize).toBe(2);

    // The last page is short, and the totals do not move with it.
    const last = await list({
      vehicleCodes: v.code,
      from: '2026-12-01',
      to: '2026-12-07',
      pageSize: 2,
      page: 4,
    });
    expect(data<unknown[]>(last)).toHaveLength(1);
    expect(meta(last).totalItems).toBe(7);

    // Every page is a DIFFERENT slice — the same rows twice would mean the skip never applied.
    const second = await list({
      vehicleCodes: v.code,
      from: '2026-12-01',
      to: '2026-12-07',
      pageSize: 2,
      page: 2,
    });
    const ids = (res: request.Response) => data<{ id: string }[]>(res).map((r) => r.id);
    expect(
      ids(first).some((id) => ids(second).includes(id)),
      'pages do not overlap',
    ).toBe(false);

    // Narrowing the window narrows the TOTAL, not just the page.
    const narrowed = await list({
      vehicleCodes: v.code,
      from: '2026-12-01',
      to: '2026-12-03',
      pageSize: 2,
    });
    expect(meta(narrowed).totalItems, 'the count follows the filters').toBe(3);
  });

  it('reading the registry needs fleetOdometer.view', async () => {
    const token = await login('noperm@ecms.local');
    expect(
      (await request(app).get('/api/v1/fleet/odometer').set('Authorization', `Bearer ${token}`))
        .status,
    ).toBe(403);
  });
});

// A registry bigger than any one listing of it. The client used to read ONE page of vehicles and
// join the code onto each odometer row in the browser, which quietly bounded the answer at
// `MAX_PAGE_SIZE`: a car past that page had no code to show, could not be found in the code
// filter, and — worst — could not be picked to record a reading against at all.
//
// The codes here sort after every other code in the registry (`ZZ…` against the `V…` the rest of
// the file makes), so the last of them is provably past the first page however many vehicles the
// earlier tests left behind. Each is created WITHOUT readings, so no other test's counts move.
describe('a fleet larger than one page of the registry', () => {
  const BEYOND = MAX_PAGE_SIZE + 5;
  let farVehicle: FleetVehicleDto;

  beforeAll(async () => {
    let last: FleetVehicleDto | undefined;
    for (let i = 0; i < BEYOND; i += 1) {
      const code = `ZZ${String(i).padStart(4, '0')}`;
      const res = await createVehicle(adminToken, { code });
      expect(res.status, `vehicle ${code} created`).toBe(201);
      last = data<FleetVehicleDto>(res);
    }
    // The LAST of them: `ZZ…` sorts after every other code in the registry, so this one sits past
    // position `BEYOND` however many vehicles the earlier tests happened to leave behind.
    farVehicle = last as FleetVehicleDto;
  });

  /** The one full page of the registry the old client used to read. */
  const firstPage = async (): Promise<FleetVehicleDto[]> => {
    const res = await request(app)
      .get('/api/v1/fleet/vehicles')
      .query({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return data<FleetVehicleDto[]>(res);
  };

  it('the far vehicle is genuinely OFF the first page — the premise of the rest', async () => {
    const page = await firstPage();
    expect(page, 'the page is full, so there is a beyond').toHaveLength(MAX_PAGE_SIZE);
    expect(
      page.map((v) => v.code),
      'the far vehicle is not on it',
    ).not.toContain(farVehicle.code);
  });

  it('a reading can be RECORDED for a vehicle past the first page', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: farVehicle.id, reading: 500, date: '2026-11-01' });
    expect(res.status, 'recording is not bounded by the registry page').toBe(201);
    expect(data<FleetOdometerLogDto>(res).vehicleCode).toBe(farVehicle.code);
  });

  it('its odometer row carries its own CODE, not a blank', async () => {
    await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: farVehicle.id, reading: 900, date: '2026-11-02' });

    const res = await request(app)
      .get('/api/v1/fleet/odometer')
      .query({ vehicleCodes: farVehicle.code, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = data<FleetOdometerLogDto[]>(res);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.vehicleCode, 'every row names its vehicle').toBe(farVehicle.code);
      expect(row.vehicleId).toBe(farVehicle.id);
    }
  });

  it('a SEARCH by that code finds it, though a page of the registry does not', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/vehicles')
      .query({ search: farVehicle.code, pageSize: 20 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = data<FleetVehicleDto[]>(res);
    expect(
      found.map((v) => v.id),
      'the search answers with the right car',
    ).toContain(farVehicle.id);
  });

  it('filtering the odometer BY that code returns its rows and no others', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/odometer')
      .query({ vehicleCodes: farVehicle.code, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = data<FleetOdometerLogDto[]>(res);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.vehicleId))).toEqual(new Set([farVehicle.id]));
  });

  it('a vehicle ON the first page is unchanged — no regression', async () => {
    // Taken from the page itself, so this holds whatever the earlier tests left in the registry.
    const [onPage] = await firstPage();
    const near = onPage as FleetVehicleDto;
    const before = await request(app)
      .get('/api/v1/fleet/odometer/expected')
      .query({ vehicleId: near.id })
      .set('Authorization', `Bearer ${adminToken}`);
    const floor = data<{ expectedReading: number | null }>(before).expectedReading ?? 0;

    const recorded = await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: near.id, reading: floor + 10, date: '2026-11-03' });
    expect(recorded.status).toBe(201);
    expect(data<FleetOdometerLogDto>(recorded).vehicleCode).toBe(near.code);

    const res = await request(app)
      .get('/api/v1/fleet/odometer')
      .query({ vehicleCodes: near.code, pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = data<FleetOdometerLogDto[]>(res);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.vehicleCode).toBe(near.code);
  });

  it('a CORRECTION answers with the code too, so the row never loses its name', async () => {
    const created = data<FleetOdometerLogDto>(
      await request(app)
        .post('/api/v1/fleet/odometer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vehicleId: farVehicle.id, reading: 1500, date: '2026-11-04' }),
    );
    const res = await request(app)
      .patch(`/api/v1/fleet/odometer/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outReading: 1600, version: created.version });
    expect(res.status).toBe(200);
    expect(data<FleetOdometerLogDto>(res).vehicleCode).toBe(farVehicle.code);
  });
});

describe('maintenance visits + derived alarm + idempotent sweeps (FL-4)', () => {
  const workTypeIdByName = async (name: string): Promise<string> => {
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const item = data<FleetCatalogItemDto[]>(res).find((i) => i.name.ar === name);
    if (item === undefined) throw new Error(`workType ${name} not found`);
    return item.id;
  };
  const mkWorkshop = async (): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        kind: 'workshop',
        name: { ar: `ورشة ${vehicleCounter}`, en: `Shop ${vehicleCounter}` },
      });
    return data<FleetCatalogItemDto>(res).id;
  };

  it('walks check-in → derived inWorkshop → one-open-visit → check-out → reopen', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const workshopId = await mkWorkshop();
    const workTypeId = await workTypeIdByName('صيانة');

    const visit = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        inDate: '2026-07-01',
        workshopId,
        workTypeId,
        odometerAtService: 90_000,
        driverInEmployeeId: await someDriver(),
      });
    expect(visit.status).toBe(201);
    expect(seenEvents.some((e) => e.name === FleetEvents.MaintenanceCheckedIn)).toBe(true);

    // FR-12 — inWorkshop is DERIVED, and now real.
    const during = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetVehicleDto>(during).inWorkshop).toBe(true);

    // FR-4 — one open visit per vehicle.
    const second = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        inDate: '2026-07-02',
        workshopId,
        workTypeId,
        odometerAtService: 90_001,
        driverInEmployeeId: await someDriver(),
      });
    expect(second.status).toBe(409);

    const visitDto = data<{ id: string; version: number }>(visit);
    const out = await request(app)
      .post(`/api/v1/fleet/maintenance/${visitDto.id}/check-out`)
      .set('Authorization', `Bearer ${adminToken}`)
      // The exit reading is required now — it becomes the baseline the next service counts from.
      .send({
        outDate: '2026-07-03',
        exitOdometer: 90_200,
        driverOutEmployeeId: await someDriver(),
        version: visitDto.version,
      });
    expect(out.status).toBe(200);
    expect(seenEvents.some((e) => e.name === FleetEvents.MaintenanceCheckedOut)).toBe(true);

    const afterOut = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetVehicleDto>(afterOut).inWorkshop).toBe(false);

    const reopened = await request(app)
      .post(`/api/v1/fleet/maintenance/${visitDto.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: data<{ version: number }>(out).version });
    expect(reopened.status).toBe(200);
    expect(seenEvents.some((e) => e.name === FleetEvents.MaintenanceReopened)).toBe(true);
  });

  it('derives the alarm from readings vs the counting-service baseline (FR-3, owner point 5)', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const workshopId = await mkWorkshop();
    const countingId = await workTypeIdByName('صيانة');

    // Baseline: closed COUNTING visit at 95,000 km, out 2026-07-02. Interval on the type: 10,000.
    const visit = data<{ id: string; version: number }>(
      await request(app)
        .post('/api/v1/fleet/maintenance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vehicleId: v.id,
          inDate: '2026-07-01',
          workshopId,
          workTypeId: countingId,
          odometerAtService: 95_000,
          driverInEmployeeId: await someDriver(),
        }),
    );
    await request(app)
      .post(`/api/v1/fleet/maintenance/${visit.id}/check-out`)
      .set('Authorization', `Bearer ${adminToken}`)
      // Out on the same reading it came in on, so this test's arithmetic is unchanged by the
      // baseline moving to the exit reading — what the baseline IS is proven separately below.
      .send({
        outDate: '2026-07-02',
        exitOdometer: 95_000,
        driverOutEmployeeId: await someDriver(),
        version: visit.version,
      });

    const record = (reading: number, date: string) =>
      request(app)
        .post('/api/v1/fleet/odometer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vehicleId: v.id, reading, date });
    await record(104_200, '2026-07-20'); // since 9,200 → remaining 800 → yellow (≤1000)

    const alarms = data<{ code: string; level: string; remainingKm: number | null }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer/alarms')
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(alarms.find((a) => a.code === v.code)).toMatchObject({
      level: 'yellow',
      remainingKm: 800,
    });

    await record(109_800, '2026-07-25'); // since 14,800 → overdue → red
    const alarms2 = data<{ code: string; level: string }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer/alarms')
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(alarms2.find((a) => a.code === v.code)?.level).toBe('red');

    // The sweep announces the crossing ONCE per (vehicle, level, baseline) — owner point 4.
    const countRaised = () =>
      seenEvents.filter(
        (e) =>
          e.name === FleetEvents.MaintenanceAlarmRaised &&
          (e.payload as { code: string }).code === v.code,
      ).length;
    await maintenanceAlarmSweep();
    const afterFirst = countRaised();
    expect(afterFirst).toBeGreaterThan(0);
    await maintenanceAlarmSweep();
    expect(countRaised()).toBe(afterFirst);
  });

  it('license sweep announces once per (subject, expiry date) — rerunnable (FR-14)', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const v = data<FleetVehicleDto>(await createVehicle(adminToken, { licenseExpiresAt: soon }));

    const employeeId = await mkEmployee();
    await request(app)
      .post('/api/v1/fleet/drivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId,
        licenseNumber: `EXP-${vehicleCounter}`,
        licenseExpiresAt: '2026-01-01T00:00:00.000Z',
        specialization: 'cashTransport',
      });

    const countFor = (name: string, subjectId: string) =>
      seenEvents.filter(
        (e) => e.name === name && (e.payload as { subjectId: string }).subjectId === subjectId,
      ).length;

    await licenseExpirySweep();
    expect(countFor(FleetEvents.VehicleLicenseExpiring, v.id)).toBe(1);
    expect(countFor(FleetEvents.DriverLicenseExpired, employeeId)).toBe(1);
    await licenseExpirySweep();
    expect(countFor(FleetEvents.VehicleLicenseExpiring, v.id)).toBe(1);
    expect(countFor(FleetEvents.DriverLicenseExpired, employeeId)).toBe(1);
  });
});

describe('workshop entry/exit — exit odometer, custody, catalog parts, filters', () => {
  // `ux_kind_name_ar` is UNIQUE per (kind, Arabic name), so every catalog item this block creates
  // needs its own name — a helper that reused one would 409 on its second call.
  let catalogCounter = 0;
  const mkCatalog = async (kind: string, ar: string): Promise<string> => {
    const n = (catalogCounter += 1);
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind, name: { ar: `${ar} ${n}`, en: `${kind}-${n}` } });
    expect(res.status).toBe(201);
    return data<FleetCatalogItemDto>(res).id;
  };
  const countingWorkTypeId = async (): Promise<string> => {
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const item = data<FleetCatalogItemDto[]>(res).find((i) => i.name.ar === 'صيانة');
    if (item === undefined) throw new Error('workType صيانة not found');
    return item.id;
  };
  /**
   * Check-in, with a driver filled in unless the caller names one — including naming it
   * `undefined`, which is how the "a driver is required" tests omit it deliberately.
   */
  const checkIn = async (body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        'driverInEmployeeId' in body
          ? withoutUndefined(body)
          : { ...body, driverInEmployeeId: await someDriver() },
      );
  const checkOut = async (id: string, body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/fleet/maintenance/${id}/check-out`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        'driverOutEmployeeId' in body
          ? withoutUndefined(body)
          : { ...body, driverOutEmployeeId: await someDriver() },
      );
  /**
   * The list, over the WHOLE filtered set by default.
   *
   * The endpoint pages at 25, and these tests assert "is this visit among the matches" against a
   * filter that legitimately matches other tests' visits too — `open: true` matches every open
   * visit in the suite. Reading only the first page would turn "the filter dropped it" and "it sat
   * on page 2" into the same observation. A test that names a page passes its own `pageSize` and
   * overrides this.
   */
  const listVisits = (query: Record<string, unknown>) =>
    request(app)
      .get('/api/v1/fleet/maintenance')
      .query({ pageSize: MAX_PAGE_SIZE, ...query })
      .set('Authorization', `Bearer ${adminToken}`);
  const ids = (res: request.Response): string[] =>
    data<FleetMaintenanceVisitDto[]>(res).map((v) => v.id);

  /** A closed visit on a fresh vehicle, in one call — the fixture most of these tests want. */
  const closedVisit = async (
    over: {
      odometerAtService?: number;
      exitOdometer?: number;
      inDate?: string;
      outDate?: string;
      sparePartIds?: string[];
      notes?: string;
    } = {},
  ): Promise<{ vehicle: FleetVehicleDto; visit: FleetMaintenanceVisitDto }> => {
    const vehicle = data<FleetVehicleDto>(await createVehicle(adminToken));
    const opened = await checkIn({
      vehicleId: vehicle.id,
      inDate: over.inDate ?? '2026-09-01',
      workshopId: await mkCatalog('workshop', 'ورشة الخروج'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: over.odometerAtService ?? 120_000,
      ...(over.sparePartIds === undefined ? {} : { sparePartIds: over.sparePartIds }),
      ...(over.notes === undefined ? {} : { notes: over.notes }),
    });
    expect(opened.status).toBe(201);
    const open = data<FleetMaintenanceVisitDto>(opened);
    const out = await checkOut(open.id, {
      outDate: over.outDate ?? '2026-09-03',
      exitOdometer: over.exitOdometer ?? 120_850,
      version: open.version,
    });
    expect(out.status).toBe(200);
    return { vehicle, visit: data<FleetMaintenanceVisitDto>(out) };
  };

  it('stores the exit reading and refuses one below the reading it came in on', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const opened = data<FleetMaintenanceVisitDto>(
      await checkIn({
        vehicleId: v.id,
        inDate: '2026-09-01',
        workshopId: await mkCatalog('workshop', 'ورشة القراءة'),
        workTypeId: await countingWorkTypeId(),
        odometerAtService: 120_000,
      }),
    );
    // Open: there is no exit reading yet, and the field says so rather than guessing one.
    expect(opened.exitOdometer).toBeNull();

    const tooLow = await checkOut(opened.id, {
      outDate: '2026-09-03',
      exitOdometer: 119_999,
      version: opened.version,
    });
    expect(tooLow.status).toBe(400);

    // Required, not optional: a check-out without it cannot silently leave the baseline behind.
    const missing = await checkOut(opened.id, {
      outDate: '2026-09-03',
      version: opened.version,
    });
    expect(missing.status).toBe(400);

    const out = await checkOut(opened.id, {
      outDate: '2026-09-03',
      exitOdometer: 120_850,
      version: opened.version,
    });
    expect(out.status).toBe(200);
    expect(data<FleetMaintenanceVisitDto>(out).exitOdometer).toBe(120_850);

    // …and it is PERSISTED, not merely echoed by the write.
    const reread = await listVisits({ vehicleId: v.id });
    expect(data<FleetMaintenanceVisitDto[]>(reread)[0]?.exitOdometer).toBe(120_850);
  });

  it('a closed visit measures the next service from the EXIT reading, not the entry one', async () => {
    // In on 120,000 and out on 120,850: the 850 the workshop drove is not distance since the
    // service, and counting it would bring the next service forward by exactly that much.
    const { vehicle } = await closedVisit({ odometerAtService: 120_000, exitOdometer: 120_850 });
    await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: vehicle.id, reading: 124_850, date: '2026-09-20' });

    const alarms = data<{ code: string; sinceServiceKm: number | null }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer/alarms')
        .set('Authorization', `Bearer ${adminToken}`),
    );
    // 124,850 − 120,850 = 4,000. From the entry reading it would have read 4,850.
    expect(alarms.find((a) => a.code === vehicle.code)?.sinceServiceKm).toBe(4000);
  });

  it('a visit closed before the exit reading existed still reads, and still baselines', async () => {
    const { vehicle, visit } = await closedVisit({
      odometerAtService: 120_000,
      exitOdometer: 120_850,
    });
    // Exactly the shape of a row written before the field existed: the KEY is absent, not null —
    // a mongoose `default` applies on write and never reached the rows already there.
    await FleetMaintenanceVisitModel.collection.updateOne(
      { _id: new Types.ObjectId(visit.id) },
      { $unset: { exitOdometer: '' } },
    );

    const reread = data<FleetMaintenanceVisitDto[]>(await listVisits({ vehicleId: vehicle.id }));
    expect(reread[0]?.exitOdometer).toBeNull();

    await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: vehicle.id, reading: 124_850, date: '2026-09-20' });
    const alarms = data<{ code: string; sinceServiceKm: number | null }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer/alarms')
        .set('Authorization', `Bearer ${adminToken}`),
    );
    // Falls back to the entry reading: 124,850 − 120,000.
    expect(alarms.find((a) => a.code === vehicle.code)?.sinceServiceKm).toBe(4850);
  });

  it('an OPEN visit is never a baseline — the alarm waits for the car to come out', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const opened = await checkIn({
      vehicleId: v.id,
      inDate: '2026-09-01',
      workshopId: await mkCatalog('workshop', 'ورشة المفتوحة'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 120_000,
    });
    expect(opened.status).toBe(201);
    await request(app)
      .post('/api/v1/fleet/odometer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: v.id, reading: 124_000, date: '2026-09-20' });

    const alarms = data<{ code: string; sinceServiceKm: number | null; level: string }[]>(
      await request(app)
        .get('/api/v1/fleet/odometer/alarms')
        .set('Authorization', `Bearer ${adminToken}`),
    );
    // A car still in the workshop has not been serviced yet — there is no baseline to count from,
    // and inventing one from the arrival reading would start the next cycle early. Unchanged by
    // the exit reading landing on the row: the projection only ever reads CLOSED visits.
    const row = alarms.find((a) => a.code === v.code);
    expect(row?.sinceServiceKm).toBeNull();
    expect(row?.level).toBe('none');
  });

  it('reads a visit written before the driver fields existed without breaking', async () => {
    // Exactly the shape of a legacy row: the KEYS are absent, not null — a mongoose `default`
    // applies on write and never reached the documents already in the collection.
    const { vehicle, visit } = await closedVisit();
    await FleetMaintenanceVisitModel.collection.updateOne(
      { _id: new Types.ObjectId(visit.id) },
      { $unset: { driverInEmployeeId: '', driverOutEmployeeId: '' } },
    );
    const reread = data<FleetMaintenanceVisitDto[]>(await listVisits({ vehicleId: vehicle.id }));
    expect(reread[0]?.driverInEmployeeId).toBeNull();
    expect(reread[0]?.driverOutEmployeeId).toBeNull();
    // …and the row is still listed, not dropped by the read.
    expect(reread).toHaveLength(1);
  });

  it('reopening a visit takes the exit reading back with it', async () => {
    const { visit } = await closedVisit();
    const reopened = await request(app)
      .post(`/api/v1/fleet/maintenance/${visit.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: visit.version });
    expect(reopened.status).toBe(200);
    const dto = data<FleetMaintenanceVisitDto>(reopened);
    expect(dto.outDate).toBeNull();
    expect(dto.exitOdometer).toBeNull();
  });

  it('records the custody from the LOGIN, and admits it is nobody when the login is not staff', async () => {
    // The seeded administrator is a platform account with no employee behind it — the seam
    // answers null, and the field says null rather than inventing somebody.
    const anonymous = await closedVisit();
    expect(anonymous.visit.takenInByEmployeeId).toBeNull();
    expect(anonymous.visit.takenOutByEmployeeId).toBeNull();

    // Now the same login IS an employee. Nothing about the request changes — no employee field is
    // sent — and both custody facts are recorded from the account that made the call.
    //
    // Direct registration provisions each employee its OWN login, so this repoints the seam at the
    // account the request is actually made with. The original back-reference is captured and put
    // back afterwards — nulling it would leave a real employee detached from its real login for
    // every test that follows.
    const employeeId = await mkEmployee({ fullNameAr: 'أمين العهدة' });
    const before = await EmployeeModel.findById(employeeId).lean<{ userId: unknown }>().exec();
    const originalUserId = before?.userId ?? null;
    await EmployeeModel.updateOne(
      { _id: new Types.ObjectId(employeeId) },
      { $set: { userId: new Types.ObjectId(adminUserId) } },
    );
    try {
      const { visit } = await closedVisit();
      expect(visit.takenInByEmployeeId).toBe(employeeId);
      expect(visit.takenOutByEmployeeId).toBe(employeeId);
    } finally {
      await EmployeeModel.updateOne(
        { _id: new Types.ObjectId(employeeId) },
        { $set: { userId: originalUserId } },
      );
    }
  });

  it('spare parts are catalog references, and an unknown one is refused', async () => {
    const partA = await mkCatalog('sparePart', 'فلتر زيت');
    const partB = await mkCatalog('sparePart', 'طقم فرامل');
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const body = {
      vehicleId: v.id,
      inDate: '2026-09-01',
      workshopId: await mkCatalog('workshop', 'ورشة القطع'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 10_000,
    };

    const refused = await checkIn({ ...body, sparePartIds: [String(new Types.ObjectId())] });
    expect(refused.status).toBe(400);

    const accepted = await checkIn({ ...body, sparePartIds: [partA, partB] });
    expect(accepted.status).toBe(201);
    expect(data<FleetMaintenanceVisitDto>(accepted).sparePartIds).toEqual([partA, partB]);
    // The legacy free-text field is untouched by a catalog write — nothing migrated, nothing lost.
    expect(data<FleetMaintenanceVisitDto>(accepted).spareParts).toEqual([]);
  });

  it('still accepts the DEPRECATED free text, and never turns it into a catalog id', async () => {
    // A caller written before the catalog existed is not refused. Its words are stored verbatim in
    // the legacy field: matching them to a catalog item by name is the silent, lossy conversion
    // this whole change exists to avoid.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await checkIn({
      vehicleId: v.id,
      inDate: '2026-09-01',
      workshopId: await mkCatalog('workshop', 'ورشة النص القديم'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 10_000,
      spareParts: ['فلتر زيت', 'قطعة لا يعرفها الكتالوج'],
    });
    expect(res.status).toBe(201);
    const dto = data<FleetMaintenanceVisitDto>(res);
    expect(dto.spareParts).toEqual(['فلتر زيت', 'قطعة لا يعرفها الكتالوج']);
    expect(dto.sparePartIds, 'no string was silently resolved to an id').toEqual([]);
  });

  it('filters server-side on every axis the screen offers', async () => {
    const part = await mkCatalog('sparePart', 'مساحات');
    const workshopId = await mkCatalog('workshop', 'ورشة الفلاتر');
    const workTypeId = await countingWorkTypeId();
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const opened = data<FleetMaintenanceVisitDto>(
      await checkIn({
        vehicleId: v.id,
        inDate: '2026-10-05',
        workshopId,
        workTypeId,
        odometerAtService: 55_000,
        sparePartIds: [part],
        notes: 'تغيير المساحات',
      }),
    );
    // The vehicle CODE is a server fact on the row now, not a client join against one page.
    expect(opened.vehicleCode).toBe(v.code);

    const matches = async (query: Record<string, unknown>): Promise<boolean> =>
      ids(await listVisits(query)).includes(opened.id);

    expect(await matches({ vehicleCodes: v.code })).toBe(true);
    expect(await matches({ vehicleCodes: `${v.code}-nope` })).toBe(false);
    expect(await matches({ workshopIds: workshopId })).toBe(true);
    expect(await matches({ workshopIds: String(new Types.ObjectId()) })).toBe(false);
    expect(await matches({ workTypeIds: workTypeId })).toBe(true);
    expect(await matches({ sparePartIds: part })).toBe(true);
    expect(await matches({ sparePartIds: String(new Types.ObjectId()) })).toBe(false);
    expect(await matches({ notes: 'المساحات' })).toBe(true);
    expect(await matches({ notes: 'الفرامل' })).toBe(false);
    expect(await matches({ odometerFrom: 55_000, odometerTo: 55_000 })).toBe(true);
    expect(await matches({ odometerFrom: 55_001 })).toBe(false);
    // The single-day case: `to` covers the whole of the day it names, whatever time is stamped.
    expect(await matches({ from: '2026-10-05', to: '2026-10-05' })).toBe(true);
    expect(await matches({ from: '2026-10-06' })).toBe(false);
    // Still in the workshop — so it is in the open list and out of the closed one, and it has no
    // check-out date to fall inside an out-date window.
    expect(await matches({ open: true })).toBe(true);
    expect(await matches({ open: false })).toBe(false);
    expect(await matches({ outFrom: '2026-01-01', outTo: '2027-01-01' })).toBe(false);

    const out = await checkOut(opened.id, {
      outDate: '2026-10-09',
      exitOdometer: 55_400,
      version: opened.version,
    });
    expect(out.status).toBe(200);
    expect(await matches({ open: false })).toBe(true);
    expect(await matches({ open: true })).toBe(false);
    expect(await matches({ outFrom: '2026-10-09', outTo: '2026-10-09' })).toBe(true);
    expect(await matches({ outFrom: '2026-10-10' })).toBe(false);
  });

  it('stores the driver at each end, and filters on EITHER of them', async () => {
    const driverIn = await mkEmployee({ fullNameAr: 'سائق الدخول' });
    const driverOut = await mkEmployee({ fullNameAr: 'سائق الخروج' });
    const other = await mkEmployee({ fullNameAr: 'سائق آخر' });
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));

    const opened = data<FleetMaintenanceVisitDto>(
      await checkIn({
        vehicleId: v.id,
        inDate: '2026-10-12',
        workshopId: await mkCatalog('workshop', 'ورشة السائق'),
        workTypeId: await countingWorkTypeId(),
        odometerAtService: 70_000,
        driverInEmployeeId: driverIn,
      }),
    );
    // Stored on the visit, not derived from a roster that can be re-planned afterwards.
    expect(opened.driverInEmployeeId).toBe(driverIn);
    expect(opened.driverOutEmployeeId, 'nobody has driven it away yet').toBeNull();
    expect(ids(await listVisits({ driverEmployeeIds: driverIn }))).toContain(opened.id);
    expect(ids(await listVisits({ driverEmployeeIds: driverOut }))).not.toContain(opened.id);

    const out = await checkOut(opened.id, {
      outDate: '2026-10-14',
      exitOdometer: 70_400,
      driverOutEmployeeId: driverOut,
      version: opened.version,
    });
    expect(out.status).toBe(200);
    expect(data<FleetMaintenanceVisitDto>(out).driverOutEmployeeId).toBe(driverOut);
    // The one who drove it in is untouched by the check-out.
    expect(data<FleetMaintenanceVisitDto>(out).driverInEmployeeId).toBe(driverIn);

    // EITHER end matches now.
    expect(ids(await listVisits({ driverEmployeeIds: driverIn }))).toContain(opened.id);
    expect(ids(await listVisits({ driverEmployeeIds: driverOut }))).toContain(opened.id);
    expect(ids(await listVisits({ driverEmployeeIds: other }))).not.toContain(opened.id);
  });

  it('refuses a check-in with no driver, and a check-out with no driver', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const body = {
      vehicleId: v.id,
      inDate: '2026-10-18',
      workshopId: await mkCatalog('workshop', 'ورشة الإلزام'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 80_000,
    };
    // Omitted on the wire, not sent as null: the field is required, so the schema refuses it.
    const noDriver = await checkIn({ ...body, driverInEmployeeId: undefined });
    expect(noDriver.status).toBe(400);

    const opened = data<FleetMaintenanceVisitDto>(await checkIn(body));
    expect(opened.driverInEmployeeId, 'the driver that WAS sent is stored').not.toBeNull();

    const noExitDriver = await checkOut(opened.id, {
      outDate: '2026-10-19',
      exitOdometer: 80_100,
      driverOutEmployeeId: undefined,
      version: opened.version,
    });
    expect(noExitDriver.status).toBe(400);

    // …and the visit is still open: a refused check-out changes nothing.
    const reread = data<FleetMaintenanceVisitDto[]>(await listVisits({ vehicleId: v.id }));
    expect(reread[0]?.outDate).toBeNull();
    expect(reread[0]?.driverOutEmployeeId).toBeNull();
  });

  it('refuses a driver id that is not an employee, at every end that takes one', async () => {
    // Existence only — the directory seam answers "is this an employee", and nothing here asks
    // whether they hold a driver profile. A workshop visit records who brought the car in.
    const ghost = String(new Types.ObjectId());
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const body = {
      vehicleId: v.id,
      inDate: '2026-10-22',
      workshopId: await mkCatalog('workshop', 'ورشة التحقق'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 90_000,
    };

    const badIn = await checkIn({ ...body, driverInEmployeeId: ghost });
    expect(badIn.status).toBe(400);

    const opened = data<FleetMaintenanceVisitDto>(await checkIn(body));

    // …the same check on the correction path.
    const badEdit = await request(app)
      .patch(`/api/v1/fleet/maintenance/${opened.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driverInEmployeeId: ghost, version: opened.version });
    expect(badEdit.status).toBe(400);

    // …and on the way out.
    const badOut = await checkOut(opened.id, {
      outDate: '2026-10-23',
      exitOdometer: 90_100,
      driverOutEmployeeId: ghost,
      version: opened.version,
    });
    expect(badOut.status).toBe(400);

    // Nothing was written by any of the three refusals.
    const reread = data<FleetMaintenanceVisitDto[]>(await listVisits({ vehicleId: v.id }));
    expect(reread[0]?.outDate).toBeNull();
    expect(reread[0]?.driverInEmployeeId).toBe(await someDriver());
  });

  it('accepts a real employee as the corrected check-in driver', async () => {
    const replacement = await mkEmployee({ fullNameAr: 'سائق بديل' });
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const opened = data<FleetMaintenanceVisitDto>(
      await checkIn({
        vehicleId: v.id,
        inDate: '2026-10-24',
        workshopId: await mkCatalog('workshop', 'ورشة التصحيح'),
        workTypeId: await countingWorkTypeId(),
        odometerAtService: 91_000,
      }),
    );
    const edited = await request(app)
      .patch(`/api/v1/fleet/maintenance/${opened.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driverInEmployeeId: replacement, version: opened.version });
    expect(edited.status).toBe(200);
    expect(data<FleetMaintenanceVisitDto>(edited).driverInEmployeeId).toBe(replacement);
  });

  it('reopening a visit takes the exit DRIVER back with the rest of the exit', async () => {
    const { visit } = await closedVisit();
    expect(visit.driverOutEmployeeId, 'a closed visit has one').not.toBeNull();
    const reopened = await request(app)
      .post(`/api/v1/fleet/maintenance/${visit.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: visit.version });
    expect(reopened.status).toBe(200);
    const dto = data<FleetMaintenanceVisitDto>(reopened);
    expect(dto.driverOutEmployeeId).toBeNull();
    // The check-in driver survives — reopening undoes the exit, not the arrival.
    expect(dto.driverInEmployeeId).not.toBeNull();
  });

  it('refuses to re-crew a car that is already in the workshop (FR-5 is unchanged)', async () => {
    // The rule this slice must not bend: once a visit is open over a date, the roster will not
    // assign that vehicle for it. The maintenance screen no longer reads the roster at all, so
    // this is pinned precisely because nothing else here would notice if it were relaxed.
    const driver = await mkEmployee({ fullNameAr: 'سائق مرفوض' });
    await mkDriverProfile(driver);
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const inDate = '2026-10-14';
    const opened = await checkIn({
      vehicleId: v.id,
      inDate,
      workshopId: await mkCatalog('workshop', 'ورشة الرفض'),
      workTypeId: await countingWorkTypeId(),
      odometerAtService: 71_000,
    });
    expect(opened.status).toBe(201);

    const refused = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: inDate, rows: [{ vehicleId: v.id, driver1EmployeeId: driver }] });
    expect(refused.status).toBe(409);
  });

  it('pagination and sorting survive the filters', async () => {
    const workshopId = await mkCatalog('workshop', 'ورشة الصفحات');
    const workTypeId = await countingWorkTypeId();
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03'];
    for (const inDate of dates) {
      const v = data<FleetVehicleDto>(await createVehicle(adminToken));
      const res = await checkIn({
        vehicleId: v.id,
        inDate,
        workshopId,
        workTypeId,
        odometerAtService: 1000,
      });
      expect(res.status).toBe(201);
    }

    const first = await listVisits({
      workshopIds: workshopId,
      pageSize: 2,
      sortBy: 'inDate',
      sortDir: 'asc',
    });
    const meta = (first.body as { meta: PageMeta }).meta;
    // The total describes the FILTERED set, and it is the server's count — never a page length.
    expect(meta.totalItems).toBe(3);
    expect(meta.totalPages).toBe(2);
    expect(data<FleetMaintenanceVisitDto[]>(first)).toHaveLength(2);
    expect(data<FleetMaintenanceVisitDto[]>(first)[0]?.inDate.slice(0, 10)).toBe('2026-11-01');

    const second = await listVisits({
      workshopIds: workshopId,
      pageSize: 2,
      page: 2,
      sortBy: 'inDate',
      sortDir: 'asc',
    });
    expect(data<FleetMaintenanceVisitDto[]>(second)).toHaveLength(1);
    expect(data<FleetMaintenanceVisitDto[]>(second)[0]?.inDate.slice(0, 10)).toBe('2026-11-03');
  });
});

describe('daily duty roster (§4.5, FR-5/6/7 — FL-5)', () => {
  interface BoardDto {
    changedCount?: number;
    rows: {
      vehicleId: string;
      inMaintenance: boolean;
      /** Does a duty document exist for the pair — i.e. is this row stored or projected? */
      planned: boolean;
      missionTypeId: string | null;
      driver1EmployeeId: string | null;
      driver2EmployeeId: string | null;
    }[];
    availableDrivers: { employeeId: string; assignedVehicleId: string | null }[];
    unavailableDrivers: { employeeId: string; reason: string }[];
  }

  const missionTypeIdSeeded = async (): Promise<string> => {
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'missionType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const item = data<FleetCatalogItemDto[]>(res).find((i) => i.name.ar === 'نقل أموال (يومي)');
    if (item === undefined) throw new Error('seeded mission type not found');
    return item.id;
  };
  /** A mission type created for one test, so two tests cannot fight over the same catalog row. */
  const missionTypeId = async (nameAr: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'missionType', name: { ar: nameAr, en: nameAr } });
    return data<FleetCatalogItemDto>(res).id;
  };
  /**
   * The DUTY DOCUMENT itself, read straight from the collection.
   *
   * Asserted against the database rather than the board, because the board would answer from the
   * standing crew even when nothing was stored — which is precisely the failure these tests
   * exist to catch. `operations/crew-board` iterates these documents, so their existence IS the
   * thing that decides whether the operation reached Operations.
   */
  const dutyDoc = async (
    vehicleId: string,
    date: string,
  ): Promise<{ missionTypeId: unknown } | null> =>
    (await mongoose.connection.collection('fleet_duty_assignments').findOne({
      vehicleId: new mongoose.Types.ObjectId(vehicleId),
      date: new Date(`${date}T00:00:00.000Z`),
    })) as { missionTypeId: unknown } | null;
  const mkDriver = async (): Promise<string> => {
    const employeeId = await mkEmployee();
    await mkDriverProfile(employeeId);
    return employeeId;
  };
  const savePlan = (date: string, rows: unknown[]) =>
    request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date, rows });
  const getBoard = (date: string) =>
    request(app)
      .get('/api/v1/fleet/roster')
      .query({ date })
      .set('Authorization', `Bearer ${adminToken}`);
  const changedFor = (vehicleId: string): number =>
    seenEvents.filter(
      (e) =>
        e.name === FleetEvents.AssignmentChanged &&
        (e.payload as { vehicleId: string }).vehicleId === vehicleId,
    ).length;

  it('plans a day (upsert per vehicle+date), publishes both events, and a re-save is a no-op', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const missionTypeId = await missionTypeIdSeeded();
    const date = '2026-11-01';

    const save = await savePlan(date, [
      { vehicleId: v.id, missionTypeId, driver1EmployeeId: driver },
    ]);
    expect(save.status).toBe(200);
    const board = data<BoardDto>(save);
    expect(board.changedCount).toBe(1);
    expect(board.rows.find((r) => r.vehicleId === v.id)).toMatchObject({
      missionTypeId,
      driver1EmployeeId: driver,
      inMaintenance: false,
    });
    expect(board.availableDrivers.find((d) => d.employeeId === driver)?.assignedVehicleId).toBe(
      v.id,
    );
    expect(changedFor(v.id)).toBe(1);
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.RosterPlanned &&
          (e.payload as { changedCount: number }).changedCount === 1,
      ),
    ).toBe(true);

    // Same payload again: nothing changed, nothing written, nothing emitted per-row.
    const again = await savePlan(date, [
      { vehicleId: v.id, missionTypeId, driver1EmployeeId: driver },
    ]);
    expect(data<BoardDto>(again).changedCount).toBe(0);
    expect(changedFor(v.id)).toBe(1);
  });

  it('FR-7 — one vehicle per driver per date; a move must carry the releasing row too', async () => {
    const vA = data<FleetVehicleDto>(await createVehicle(adminToken));
    const vB = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const date = '2026-11-02';

    expect((await savePlan(date, [{ vehicleId: vA.id, driver1EmployeeId: driver }])).status).toBe(
      200,
    );
    // Taking the driver on B while A still holds them is refused…
    const steal = await savePlan(date, [{ vehicleId: vB.id, driver1EmployeeId: driver }]);
    expect(steal.status).toBe(409);
    // …but the drag shape — both rows in one save — moves them atomically.
    const move = await savePlan(date, [
      { vehicleId: vA.id },
      { vehicleId: vB.id, driver1EmployeeId: driver },
    ]);
    expect(move.status).toBe(200);
    const rows = data<BoardDto>(move).rows;
    expect(rows.find((r) => r.vehicleId === vA.id)?.driver1EmployeeId).toBeNull();
    expect(rows.find((r) => r.vehicleId === vB.id)?.driver1EmployeeId).toBe(driver);
  });

  it('FR-5 — an in-workshop vehicle is flagged and unassignable; clearing it stays allowed', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const date = '2026-11-03';

    const workshop = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'workshop', name: { ar: `ورشة التعيين`, en: `Roster shop` } });
    const workTypes = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const checkIn = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        inDate: '2026-10-30',
        workshopId: data<FleetCatalogItemDto>(workshop).id,
        workTypeId: data<FleetCatalogItemDto[]>(workTypes).find((i) => i.name.ar === 'صيانة')?.id,
        odometerAtService: 50_000,
        driverInEmployeeId: await someDriver(),
      });
    expect(checkIn.status).toBe(201);

    const assign = await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: driver }]);
    expect(assign.status).toBe(409);

    const board = data<BoardDto>(await getBoard(date));
    expect(board.rows.find((r) => r.vehicleId === v.id)?.inMaintenance).toBe(true);

    // A row with nothing to assign is a clear, not an assignment — FR-5 does not block it.
    const clear = await savePlan(date, [{ vehicleId: v.id }]);
    expect(clear.status).toBe(200);
    expect(data<BoardDto>(clear).changedCount).toBe(0);
  });

  it('FR-6 — the availability seam is the only authority, and the pool names the reason', async () => {
    const driver = await mkDriver();
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const date = '2026-11-04';

    await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: driver, from: date, to: date, reason: 'مأمورية' });

    const refused = await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: driver }]);
    expect(refused.status).toBe(409);

    const board = data<BoardDto>(await getBoard(date));
    expect(board.unavailableDrivers.find((d) => d.employeeId === driver)?.reason).toBe(
      'fleetUnavailability',
    );
    expect(board.availableDrivers.some((d) => d.employeeId === driver)).toBe(false);
  });

  it('schema guards — the same person in both slots, or a vehicle twice, never reach the service', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const twoSlots = await savePlan('2026-11-05', [
      { vehicleId: v.id, driver1EmployeeId: driver, driver2EmployeeId: driver },
    ]);
    expect(twoSlots.status).toBe(400);
    const twice = await savePlan('2026-11-05', [{ vehicleId: v.id }, { vehicleId: v.id }]);
    expect(twice.status).toBe(400);
  });

  // ── id SPELLING: one vehicle, however it is written ──────────────────────
  //
  // Every key the service builds from a document is `String(doc.field)`, which mongo renders
  // lowercase, while the payload's ids arrive as the caller typed them. An uppercase-hex id is
  // the SAME id to the database and a DIFFERENT string to a Map or a Set — so the existing-row
  // lookup, the FR-5 workshop guard and the FR-7 occupancy check all answer as though the row
  // were not there. These run against a real database, at the endpoint, in both spellings.

  it('SPELLING — an UPPERCASE vehicleId edits the existing row, it does not add a second', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const date = '2026-11-20';
    expect((await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: d1 }])).status).toBe(200);

    // The same car, spelled the other way.
    const again = await savePlan(date, [{ vehicleId: v.id.toUpperCase(), driver1EmployeeId: d2 }]);
    expect(again.status, 'an ordinary edit, not a conflict').toBe(200);
    expect(data<BoardDto>(again).changedCount).toBe(1);

    const board = data<BoardDto>(await getBoard(date));
    expect(board.rows.filter((r) => r.vehicleId === v.id)).toHaveLength(1);
    expect(board.rows.find((r) => r.vehicleId === v.id)?.driver1EmployeeId).toBe(d2);
    // The driver it replaced is free again — the row was edited, not duplicated beside.
    expect(board.availableDrivers.find((d) => d.employeeId === d1)?.assignedVehicleId).toBeNull();
  });

  it('SPELLING — FR-5 still refuses an in-workshop vehicle written in UPPERCASE', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const date = '2026-11-21';
    const workshop = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'workshop', name: { ar: `ورشة الهجاء`, en: `Spelling shop` } });
    const workTypes = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const checkIn = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        inDate: date,
        workshopId: data<FleetCatalogItemDto>(workshop).id,
        workTypeId: data<FleetCatalogItemDto[]>(workTypes).find((i) => i.name.ar === 'صيانة')?.id,
        odometerAtService: 1000,
        driverInEmployeeId: await someDriver(),
      });
    expect(checkIn.status).toBe(201);

    // The workshop set is built from documents, so it holds the canonical spelling only.
    const refused = await savePlan(date, [
      { vehicleId: v.id.toUpperCase(), driver1EmployeeId: driver },
    ]);
    expect(refused.status, 'FR-5 must not be bypassed by a spelling').toBe(409);
    expect(
      data<BoardDto>(await getBoard(date)).rows.find((r) => r.vehicleId === v.id)
        ?.driver1EmployeeId,
    ).toBeNull();
  });

  it('SPELLING — FR-7 still catches a driver another vehicle holds, written in UPPERCASE', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const driver = await mkDriver();
    const date = '2026-11-22';
    expect((await savePlan(date, [{ vehicleId: a.id, driver1EmployeeId: driver }])).status).toBe(
      200,
    );

    // Only the receiving row, and the driver spelled the other way — the occupancy check reads
    // the holder's slot as `String(doc.driver1EmployeeId)`, so it must still match.
    const refused = await savePlan(date, [
      { vehicleId: b.id, driver1EmployeeId: driver.toUpperCase() },
    ]);
    expect(refused.status, 'one driver, one vehicle per date').toBe(409);

    const board = data<BoardDto>(await getBoard(date));
    expect(board.rows.find((r) => r.vehicleId === a.id)?.driver1EmployeeId).toBe(driver);
    expect(board.rows.find((r) => r.vehicleId === b.id)?.driver1EmployeeId).toBeNull();
  });

  it('SPELLING — a MOVE with both sides in UPPERCASE still moves, and releases', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const driver = await mkDriver();
    const date = '2026-11-23';
    expect((await savePlan(date, [{ vehicleId: a.id, driver1EmployeeId: driver }])).status).toBe(
      200,
    );

    const moved = await savePlan(date, [
      { vehicleId: a.id.toUpperCase(), driver1EmployeeId: null },
      { vehicleId: b.id.toUpperCase(), driver1EmployeeId: driver.toUpperCase() },
    ]);
    expect(moved.status, 'both sides travelled, so the move is legal').toBe(200);

    const board = data<BoardDto>(await getBoard(date));
    expect(board.rows.find((r) => r.vehicleId === a.id)?.driver1EmployeeId).toBeNull();
    expect(board.rows.find((r) => r.vehicleId === b.id)?.driver1EmployeeId).toBe(driver);
    expect(board.availableDrivers.find((d) => d.employeeId === driver)?.assignedVehicleId).toBe(
      b.id,
    );
  });

  it('SPELLING — ordinary lowercase planning is completely unchanged', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const date = '2026-11-24';
    const first = await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: driver }]);
    expect(first.status).toBe(200);
    expect(data<BoardDto>(first).changedCount).toBe(1);
    // A re-save of the same facts is still a no-op.
    expect(
      data<BoardDto>(await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: driver }]))
        .changedCount,
    ).toBe(0);
    expect(
      data<BoardDto>(await getBoard(date)).rows.find((r) => r.vehicleId === v.id)
        ?.driver1EmployeeId,
    ).toBe(driver);
  });

  it('SPELLING — the fix writes nothing outside fleet_duty_assignments', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const date = '2026-11-25';
    const counts = async () => ({
      drivers: await mongoose.connection.collection('fleet_driver_profiles').countDocuments({}),
      vehicles: await mongoose.connection.collection('fleet_vehicles').countDocuments({}),
      fixed: await mongoose.connection.collection('fleet_fixed_crews').countDocuments({}),
      visits: await mongoose.connection.collection('fleet_maintenance_visits').countDocuments({}),
    });
    const before = await counts();
    const driverDocBefore = await mongoose.connection
      .collection('fleet_driver_profiles')
      .findOne({ employeeId: new Types.ObjectId(driver) });

    expect(
      (await savePlan(date, [{ vehicleId: v.id.toUpperCase(), driver1EmployeeId: driver }])).status,
    ).toBe(200);

    expect(await counts(), 'no other collection gained or lost a document').toEqual(before);
    expect(
      await mongoose.connection
        .collection('fleet_driver_profiles')
        .findOne({ employeeId: new Types.ObjectId(driver) }),
      'and the driver profile is byte-identical',
    ).toEqual(driverDocBefore);
  });

  it('SPELLING — the SERVICE settles the spelling too, for a caller that skips the schema', async () => {
    // The schema normalizes at the HTTP boundary, so an endpoint test can never reach the
    // service with an uppercase id. Another service could. This calls `plan` directly.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const date = new Date('2026-11-26T00:00:00.000Z');
    // The selector the HTTP path hands an admin, spelled out rather than cast: `scopeSelector`
    // builds this from the request context, and an `organization` grant makes `scopeFilter`
    // return `{}` — no narrowing — which is the condition this test means to reproduce.
    //
    // It is TYPED, not `as unknown as`. A cast here previously let a `{ branchIds: null }` shape
    // past the compiler; at runtime it had neither `scope` nor `userId`, so the repository fell
    // through to its `own` branch, built `new Types.ObjectId(undefined)` — a fresh random id —
    // and the vehicle lookup 404'd. The type is what stops that reaching CI again.
    const scope: ScopeSelector = {
      scope: 'organization',
      userId: adminUserId,
      branchId: null,
      departmentId: null,
      sectionId: null,
    };

    await fleetRosterService.plan(
      { date, rows: [{ vehicleId: v.id, driver1EmployeeId: d1 }] },
      adminUserId,
      scope,
    );
    // Same car, spelled the other way, straight at the service.
    const again = await fleetRosterService.plan(
      { date, rows: [{ vehicleId: v.id.toUpperCase(), driver1EmployeeId: d2 }] },
      adminUserId,
      scope,
    );
    expect(again.changedCount, 'an edit of the existing row').toBe(1);

    const rows = await mongoose.connection
      .collection('fleet_duty_assignments')
      .find({ vehicleId: new Types.ObjectId(v.id), isDeleted: false })
      .toArray();
    expect(rows, 'ONE row for the vehicle-day, not two').toHaveLength(1);
    expect(String(rows[0]?.driver1EmployeeId)).toBe(d2);
  });

  it('planning is its own grant — the branch operator can neither view nor plan', async () => {
    expect(
      (
        await request(app)
          .get('/api/v1/fleet/roster')
          .query({ date: '2026-11-06' })
          .set('Authorization', `Bearer ${branchAToken}`)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/fleet/roster')
          .set('Authorization', `Bearer ${branchAToken}`)
          .send({ date: '2026-11-06', rows: [{ vehicleId: '64b1f0cccccccccccccccc99' }] })
      ).status,
    ).toBe(403);
  });

  // ── the daily board's TWO sources of truth ───────────────────────────────
  //
  // A day is either PLANNED (a `fleet_duty_assignment` exists for the pair) or UNPLANNED (none
  // does). Planned days are the stored document, verbatim. Unplanned days start from the standing
  // crew, §2.7b. Which one speaks is decided by the DOCUMENT'S EXISTENCE, never by whether its
  // drivers happen to be null — that difference is what lets a dispatcher clear a crew for one
  // day and have it stay cleared.

  const saveFixedCrew = (rows: unknown[]) =>
    request(app)
      .post('/api/v1/fleet/fixed-roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rows });
  const fixedBoard = () =>
    request(app).get('/api/v1/fleet/fixed-roster').set('Authorization', `Bearer ${adminToken}`);
  const dayRow = (board: BoardDto, vehicleId: string) =>
    board.rows.find((r) => r.vehicleId === vehicleId);
  const putInWorkshop = async (vehicleId: string, inDate: string): Promise<void> => {
    const workshop = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'workshop', name: { ar: `ورشة ${inDate}`, en: `Shop ${inDate}` } });
    const workTypes = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId,
        inDate,
        workshopId: data<FleetCatalogItemDto>(workshop).id,
        workTypeId: data<FleetCatalogItemDto[]>(workTypes).find((i) => i.name.ar === 'صيانة')?.id,
        odometerAtService: 1000,
        driverInEmployeeId: await someDriver(),
      });
    expect(res.status, 'the vehicle is in the workshop').toBe(201);
  };

  it('A — an UNPLANNED day starts from the standing crew', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b] = [await mkDriver(), await mkDriver()];
    const missionTypeId = await missionTypeIdSeeded();
    expect(
      (
        await saveFixedCrew([
          { vehicleId: v.id, missionTypeId, driver1EmployeeId: a, driver2EmployeeId: b },
        ])
      ).status,
    ).toBe(200);

    const row = dayRow(data<BoardDto>(await getBoard('2026-12-01')), v.id);
    expect(row?.driver1EmployeeId, 'the standing crew is where the day starts').toBe(a);
    expect(row?.driver2EmployeeId).toBe(b);
    expect(row?.missionTypeId, 'and its mission comes with it').toBe(missionTypeId);
    // …and the pool says so, rather than offering somebody already visibly seated.
    const board = data<BoardDto>(await getBoard('2026-12-01'));
    expect(board.availableDrivers.find((d) => d.employeeId === a)?.assignedVehicleId).toBe(v.id);
  });

  it('B — a PLANNED day that was deliberately emptied STAYS empty', async () => {
    // The trap this rule exists for: if the overlay keyed off "drivers are null" instead of "no
    // document", clearing a crew for one day would be impossible — every reload would put the
    // standing crew back, silently undoing the dispatcher.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b] = [await mkDriver(), await mkDriver()];
    await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a, driver2EmployeeId: b }]);
    const date = '2026-12-02';

    // Plan the day with somebody, then clear it — that leaves a document with null drivers.
    expect((await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: a }])).status).toBe(200);
    expect(
      (
        await savePlan(date, [
          { vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: null },
        ])
      ).status,
    ).toBe(200);

    const row = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect(row?.driver1EmployeeId, 'cleared means cleared').toBeNull();
    expect(row?.driver2EmployeeId, 'the standing crew is NOT resurrected').toBeNull();
  });

  it('C — a PLANNED day keeps its own crew; the standing one does not substitute', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b, c] = [await mkDriver(), await mkDriver(), await mkDriver()];
    await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a, driver2EmployeeId: b }]);
    const date = '2026-12-03';
    expect((await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: c }])).status).toBe(200);

    const row = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect(row?.driver1EmployeeId, 'the day says C').toBe(c);
    expect(row?.driver2EmployeeId, 'and B is not quietly added beside them').toBeNull();
  });

  it('D — an UNPLANNED day drops the standing crew of a vehicle in the workshop', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b] = [await mkDriver(), await mkDriver()];
    await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a, driver2EmployeeId: b }]);
    const date = '2026-12-04';
    await putInWorkshop(v.id, date);

    const board = data<BoardDto>(await getBoard(date));
    const row = dayRow(board, v.id);
    expect(row, 'the vehicle is still ON the board — visible, not hidden').toBeDefined();
    expect(row?.inMaintenance, 'and it reads as unassignable').toBe(true);
    expect(row?.driver1EmployeeId, 'nobody is on duty on a car in the workshop').toBeNull();
    expect(row?.driver2EmployeeId).toBeNull();
    // The crew is free that day, not stranded on a car that cannot move.
    expect(board.availableDrivers.find((d) => d.employeeId === a)?.assignedVehicleId).toBeNull();
    // …and the server still refuses to WRITE them onto it (FR-5, unchanged).
    expect((await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: a }])).status).toBe(409);
  });

  /**
   * A day this far ahead of TODAY.
   *
   * Relative, not a literal like the dates above it: the plan endpoint refuses a date in the
   * past (`PAST_DATE`), so a hardcoded future date is a test with an expiry — `operations.spec.ts`
   * had three and they took the suite down when they went stale. The offsets are large and unique
   * to this block so these days cannot collide with a day another test plans.
   */
  const futureDay = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // ── the inheritance contract, stated as the sequence a dispatcher performs ──
  //
  // An unsaved day is a PROJECTION of the standing crew as it is right now; a saved day is a
  // FACT, and stops listening. Both halves matter, and the second is the one that is easy to
  // lose: a day that kept re-reading the fixed board would silently rewrite a plan somebody
  // already committed to.
  //
  // The existing model expresses this with nothing added: a `fleet_duty_assignments` document
  // keyed (vehicle, date) IS the override, and its existence IS `planned`.

  it('CONTRACT — an unsaved day follows Fixed; a saved day stops, and other days do not', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b, c] = [await mkDriver(), await mkDriver(), await mkDriver()];
    const day1 = futureDay(40);
    const day2 = futureDay(41);

    // 1–2. Fixed = A → the unsaved day shows A.
    expect((await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a }])).status).toBe(200);
    const first = dayRow(data<BoardDto>(await getBoard(day1)), v.id);
    expect(first?.driver1EmployeeId, 'day 1 inherits A').toBe(a);
    expect(first?.planned, 'and nothing is stored for it yet').toBe(false);

    // 3–4. Fixed becomes B → the STILL-unsaved day follows it.
    expect((await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: b }])).status).toBe(200);
    expect(
      dayRow(data<BoardDto>(await getBoard(day1)), v.id)?.driver1EmployeeId,
      'an unsaved day tracks the CURRENT standing crew, not the one it first showed',
    ).toBe(b);

    // 5. Save day 1 — as the board does: the inherited row is materialised as it stands.
    expect((await savePlan(day1, [{ vehicleId: v.id, driver1EmployeeId: b }])).status).toBe(200);
    const saved = dayRow(data<BoardDto>(await getBoard(day1)), v.id);
    expect(saved?.planned, 'the day is now a stored fact').toBe(true);
    expect(saved?.driver1EmployeeId).toBe(b);

    // 6–7. Fixed becomes C → day 1 does NOT move. This is the whole point.
    expect((await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: c }])).status).toBe(200);
    expect(
      dayRow(data<BoardDto>(await getBoard(day1)), v.id)?.driver1EmployeeId,
      'a saved day is independent of every later change to the standing crew',
    ).toBe(b);

    // 8. …while a day nobody saved still follows the latest Fixed.
    const other = dayRow(data<BoardDto>(await getBoard(day2)), v.id);
    expect(other?.driver1EmployeeId, 'day 2 inherits the CURRENT fixed crew').toBe(c);
    expect(other?.planned, 'and remains unstored').toBe(false);

    // …and reading day 2 did not plan it, nor disturb day 1.
    expect(dayRow(data<BoardDto>(await getBoard(day2)), v.id)?.planned).toBe(false);
    expect(dayRow(data<BoardDto>(await getBoard(day1)), v.id)?.driver1EmployeeId).toBe(b);
  });

  it('CONTRACT — saving one day writes NOTHING for any other date', async () => {
    // No cross-date leakage, asserted at the collection rather than through the board.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b] = [await mkDriver(), await mkDriver()];
    const day1 = futureDay(50);
    const day2 = futureDay(51);
    expect((await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a }])).status).toBe(200);
    expect((await savePlan(day1, [{ vehicleId: v.id, driver1EmployeeId: b }])).status).toBe(200);

    const stored = await mongoose.connection
      .collection('fleet_duty_assignments')
      .find({ vehicleId: new Types.ObjectId(v.id), isDeleted: false })
      .toArray();
    expect(stored, 'exactly one duty row — for the day that was saved').toHaveLength(1);
    expect((stored[0]?.date as Date).toISOString().slice(0, 10)).toBe(day1);
    expect(dayRow(data<BoardDto>(await getBoard(day2)), v.id)?.planned).toBe(false);
  });

  it('CONTRACT — merely READING an unsaved day never creates an override', async () => {
    // What a browser refresh does: GET the board, repeatedly. A read that planned the day would
    // freeze it against a Fixed Roster the dispatcher had not finished editing.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const a = await mkDriver();
    const day = futureDay(60);
    expect((await saveFixedCrew([{ vehicleId: v.id, driver1EmployeeId: a }])).status).toBe(200);

    for (let i = 0; i < 3; i += 1) {
      expect(dayRow(data<BoardDto>(await getBoard(day)), v.id)?.planned).toBe(false);
    }
    const stored = await mongoose.connection
      .collection('fleet_duty_assignments')
      .countDocuments({ vehicleId: new Types.ObjectId(v.id), isDeleted: false });
    expect(stored, 'three reads, no writes').toBe(0);
  });

  it('E — none of that touches the standing configuration', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [a, b] = [await mkDriver(), await mkDriver()];
    const missionTypeId = await missionTypeIdSeeded();
    await saveFixedCrew([
      { vehicleId: v.id, missionTypeId, driver1EmployeeId: a, driver2EmployeeId: b },
    ]);
    const before = await mongoose.connection
      .collection('fleet_fixed_crews')
      .findOne({ vehicleId: new Types.ObjectId(v.id) });

    // Read a day, plan a day, put the car in the workshop, read the day again.
    await getBoard('2026-12-05');
    await savePlan('2026-12-05', [{ vehicleId: v.id, driver1EmployeeId: a }]);
    await putInWorkshop(v.id, '2026-12-06');
    await getBoard('2026-12-06');

    expect(
      await mongoose.connection
        .collection('fleet_fixed_crews')
        .findOne({ vehicleId: new Types.ObjectId(v.id) }),
      'the standing crew row is byte-identical after all of it',
    ).toEqual(before);
    const fixed = data<{ rows: { vehicleId: string; driver1EmployeeId: string | null }[] }>(
      await fixedBoard(),
    ).rows.find((r) => r.vehicleId === v.id);
    expect(fixed?.driver1EmployeeId, 'and the fixed board still reads the same').toBe(a);
  });

  // ── a roster is a PLAN: the past is not plannable ────────────────────────

  const shift = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it('refuses to plan a date in the PAST, and accepts today and after', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    const row = [{ vehicleId: v.id, driver1EmployeeId: driver }];

    expect((await savePlan(shift(-1), row)).status, 'yesterday').toBe(400);
    expect((await savePlan(shift(-30), row)).status, 'last month').toBe(400);
    // The boundary: today is the floor, not the ceiling — the current day's plan is the one
    // operations is living in, and it is edited all morning.
    expect((await savePlan(shift(0), row)).status, 'today').toBe(200);
    expect((await savePlan(shift(1), row)).status, 'tomorrow').toBe(200);
    expect((await savePlan(shift(45), row)).status, 'well into the future').toBe(200);
  });

  it('names the past-date refusal so a client can act on it', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await savePlan(shift(-2), [{ vehicleId: v.id }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('PAST_DATE');
  });

  // ── التشغيله reaches Operations whether or not it was touched ────────────
  //
  // `operations/crew-board` builds its day by iterating `fleet_duty_assignments`. A vehicle whose
  // operation was only ever PROJECTED from the standing crew has no such document, so it is not
  // on that board at all and its operation never arrives. `planned` is what lets the roster
  // screen tell the two apart and offer to materialise the projection.

  it('FLOW — a derived row says it is NOT planned; a stored one says it is', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const mission = await missionTypeId('تشغيلة يومية');
    await saveFixedCrew([{ vehicleId: v.id, missionTypeId: mission }]);
    const date = shift(9);

    const derived = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect(derived?.planned, 'nothing is stored for this vehicle on this date').toBe(false);
    expect(derived?.missionTypeId, 'but the standing operation is projected onto it').toBe(
      mission,
    );

    expect((await savePlan(date, [{ vehicleId: v.id, missionTypeId: mission }])).status).toBe(200);
    const stored = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect(stored?.planned, 'now it is a real day').toBe(true);
    expect(stored?.missionTypeId).toBe(mission);
  });

  it('FLOW CASE 1 — an operation inherited and NOT changed is still written to the day', async () => {
    // The defect: saving only what the dispatcher edited meant an unchanged operation never
    // became a duty row, so Operations never saw the vehicle.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const mission = await missionTypeId('تشغيلة موروثة');
    await saveFixedCrew([{ vehicleId: v.id, missionTypeId: mission }]);
    const date = shift(10);

    // The board projects it; the client sends it back verbatim, which is what «حفظ» now does.
    const projected = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect((await savePlan(date, [
      { vehicleId: v.id, missionTypeId: projected?.missionTypeId ?? null },
    ])).status).toBe(200);

    const duty = await dutyDoc(v.id, date);
    expect(duty, 'a duty row now exists for the pair').not.toBeNull();
    expect(String(duty?.missionTypeId), 'carrying the INHERITED operation').toBe(mission);
  });

  it('FLOW CASE 2 — an operation the dispatcher CHANGED is written as the new value', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [standing, chosen] = [
      await missionTypeId('تشغيلة قياسية'),
      await missionTypeId('تشغيلة بديلة'),
    ];
    await saveFixedCrew([{ vehicleId: v.id, missionTypeId: standing }]);
    const date = shift(11);

    expect((await savePlan(date, [{ vehicleId: v.id, missionTypeId: chosen }])).status).toBe(200);

    const duty = await dutyDoc(v.id, date);
    expect(String(duty?.missionTypeId), 'the new value, not the standing one').toBe(chosen);
    expect(dayRow(data<BoardDto>(await getBoard(date)), v.id)?.missionTypeId).toBe(chosen);
    // …and the standing configuration is untouched by either case.
    const fixed = data<{ rows: { vehicleId: string; missionTypeId: string | null }[] }>(
      await fixedBoard(),
    ).rows.find((r) => r.vehicleId === v.id);
    expect(fixed?.missionTypeId, 'the fixed roster still says what it always said').toBe(standing);
  });

  // ── a second driver needs a first, on the DAY ────────────────────────────

  it('DRIVER ORDER — refuses a second driver with no first', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d2 = await mkDriver();
    const res = await savePlan(shift(12), [{ vehicleId: v.id, driver2EmployeeId: d2 }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('driver2EmployeeId');
  });

  it('DRIVER ORDER — refuses it with driver 1 spelled as an explicit null', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d2 = await mkDriver();
    expect(
      (
        await savePlan(shift(13), [
          { vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: d2 },
        ])
      ).status,
    ).toBe(400);
  });

  it('DRIVER ORDER — accepts driver 1 alone', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    expect((await savePlan(shift(14), [{ vehicleId: v.id, driver1EmployeeId: d1 }])).status).toBe(
      200,
    );
  });

  it('DRIVER ORDER — accepts driver 1 AND driver 2', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const date = shift(15);
    expect(
      (await savePlan(date, [
        { vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 },
      ])).status,
    ).toBe(200);
    expect(dayRow(data<BoardDto>(await getBoard(date)), v.id)).toMatchObject({
      driver1EmployeeId: d1,
      driver2EmployeeId: d2,
    });
  });

  // ── FR-5 governs MATERIALISATION, not only drops ─────────────────────────
  //
  // The regression these exist for. The board projects a standing mission onto a vehicle the
  // workshop holds (the mission is a fact about the vehicle; the CREW is what the day withdraws),
  // and `assigns()` counts a mission-only row as an ASSIGNMENT — so committing that projection
  // asked the server for exactly the write FR-5 refuses, and `plan()` throws before its
  // transaction, taking the whole day's save with it.

  it('FR-5 — refuses an EXPLICIT assignment to a vehicle the workshop holds, mission alone', async () => {
    // The rule itself, reachable and unchanged. A mission with no drivers is still an assignment.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const mission = await missionTypeId('تشغيلة أثناء الصيانة');
    const date = shift(17);
    await putInWorkshop(v.id, date);

    const res = await savePlan(date, [{ vehicleId: v.id, missionTypeId: mission }]);
    expect(res.status, 'a mission-only row is an assignment').toBe(409);
    expect(JSON.stringify(res.body)).toContain('FR-5');
    expect(await dutyDoc(v.id, date), 'and nothing was written').toBeNull();
  });

  it('FR-5 — the board still SHOWS the standing mission on an in-workshop vehicle', async () => {
    // Deliberately unchanged: the projection is worth reading. What must not happen is the save
    // proposing it. `inMaintenance` is what tells the client which rows those are.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const mission = await missionTypeId('تشغيلة معروضة');
    const date = shift(18);
    await saveFixedCrew([{ vehicleId: v.id, missionTypeId: mission }]);
    await putInWorkshop(v.id, date);

    const shown = dayRow(data<BoardDto>(await getBoard(date)), v.id);
    expect(shown?.inMaintenance, 'flagged for the client').toBe(true);
    expect(shown?.missionTypeId, 'and the standing mission is still readable').toBe(mission);
    expect(shown?.planned, 'while nothing is stored for it').toBe(false);
  });

  it('FR-5 — an in-workshop vehicle does not stop the REST of the day being saved', async () => {
    // The payload the fixed client now sends: the assignable vehicles, without the workshop one.
    // Proven end to end, because the failure was that the server rejected the whole batch.
    const [ok1, shopped, ok2] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const mission = await missionTypeId('تشغيلة الأسطول');
    const date = shift(19);
    await putInWorkshop(shopped.id, date);

    const res = await savePlan(date, [
      { vehicleId: ok1.id, missionTypeId: mission },
      { vehicleId: ok2.id, missionTypeId: mission },
    ]);
    expect(res.status).toBe(200);
    expect(await dutyDoc(ok1.id, date), 'the assignable vehicles are planned').not.toBeNull();
    expect(await dutyDoc(ok2.id, date)).not.toBeNull();
    expect(await dutyDoc(shopped.id, date), 'the workshop one is simply absent').toBeNull();
  });

  it('FR-5 — sending the whole batch INCLUDING the workshop vehicle still fails it all', async () => {
    // The existing business rule, asserted so the fix cannot be mistaken for a server change:
    // `plan()` throws on the first offending row, before the transaction. That is exactly why
    // the client must not put such a row in the payload.
    const [ok1, shopped] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const mission = await missionTypeId('تشغيلة مرفوضة');
    const date = shift(20);
    await putInWorkshop(shopped.id, date);

    const res = await savePlan(date, [
      { vehicleId: ok1.id, missionTypeId: mission },
      { vehicleId: shopped.id, missionTypeId: mission },
    ]);
    expect(res.status).toBe(409);
    expect(await dutyDoc(ok1.id, date), 'the good row did not land either').toBeNull();
  });

  it('FR-5 — CLEARING an in-workshop vehicle stays allowed', async () => {
    // A car can go into the workshop after its day was planned, and that day must be emptiable.
    // A row that only clears is not an assignment, so the rule lets it through.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    const date = shift(21);
    expect((await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: d1 }])).status).toBe(200);
    await putInWorkshop(v.id, date);

    expect(
      (
        await savePlan(date, [
          {
            vehicleId: v.id,
            missionTypeId: null,
            driver1EmployeeId: null,
            driver2EmployeeId: null,
          },
        ])
      ).status,
      'emptying a workshop day is legal',
    ).toBe(200);
  });

  it('FR-5 — the same vehicle IS plannable on a date the visit does not cover', async () => {
    // An OPEN visit covers its `inDate` and every day after it — "a car that enters the workshop
    // AFTER day D was not in the workshop ON day D". So the free day is one BEFORE the visit
    // starts, not one after it. The exclusion is about the DAY, not about the vehicle.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const mission = await missionTypeId('تشغيلة قبل الصيانة');
    const before = shift(22);
    await putInWorkshop(v.id, shift(23));

    expect(dayRow(data<BoardDto>(await getBoard(before)), v.id)?.inMaintenance).toBe(false);
    expect(
      (await savePlan(before, [{ vehicleId: v.id, missionTypeId: mission }])).status,
    ).toBe(200);
    expect(await dutyDoc(v.id, before)).not.toBeNull();
  });

  it('DRIVER ORDER — clearing a day stays legal; the rule is about ORDER, not presence', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    const date = shift(16);
    await savePlan(date, [{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    expect(
      (
        await savePlan(date, [
          { vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: null },
        ])
      ).status,
    ).toBe(200);
  });
});

// NOTE ON ORDER: this block sits AFTER the daily roster's, deliberately.
//
// `seenEvents` is one array for the whole file, and the roster's own test asserts that a
// `fleet.roster.planned` with `changedCount: 1` appears in it. Some tests below plan a real day
// to prove the two boards stay independent — which emits exactly that event. Declared FIRST,
// they would pre-satisfy the roster's assertion, and it would stay green even if the emit were
// deleted. Declared after, it still proves what it was written to prove.
describe('fixed crew (الطقم الثابت) — the standing crew, with no date in it', () => {
  interface FixedBoardDto {
    changedCount?: number;
    rows: {
      vehicleId: string;
      code: string;
      inMaintenance: boolean;
      missionTypeId: string | null;
      driver1EmployeeId: string | null;
      driver2EmployeeId: string | null;
      notes: string | null;
    }[];
    drivers: { employeeId: string; assignedVehicleId: string | null }[];
  }

  const mkDriver = async (): Promise<string> => {
    const employeeId = await mkEmployee();
    await mkDriverProfile(employeeId);
    return employeeId;
  };
  const saveCrews = (rows: unknown[], token = adminToken) =>
    request(app)
      .post('/api/v1/fleet/fixed-roster')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows });
  const getCrews = (token = adminToken) =>
    request(app).get('/api/v1/fleet/fixed-roster').set('Authorization', `Bearer ${token}`);
  const rowFor = (board: FixedBoardDto, vehicleId: string) =>
    board.rows.find((r) => r.vehicleId === vehicleId);

  // ── the work type and the note: added after the collection shipped ───────
  //
  // Both are nullable, so the first claim is a compatibility one — a crew written before these
  // existed must still read and save. The rest is that a reference behaves like a reference:
  // stored by id, validated against the catalog it belongs to, and refused when it is neither.

  it('EDIT — stores work type, both drivers and a note together, and reads them back', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const missionType = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'missionType', name: { ar: 'نقل نقدية', en: 'Cash run' } }),
    );

    const save = await saveCrews([
      {
        vehicleId: v.id,
        missionTypeId: missionType.id,
        driver1EmployeeId: d1,
        driver2EmployeeId: d2,
        notes: 'يبدأ من المخزن',
      },
    ]);
    expect(save.status).toBe(200);
    expect(data<FixedBoardDto>(save).changedCount).toBe(1);

    // A fresh request — the four values survived the round trip, not just the response.
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      missionTypeId: missionType.id,
      driver1EmployeeId: d1,
      driver2EmployeeId: d2,
      notes: 'يبدأ من المخزن',
    });
  });

  it('EDIT — a row that carries neither still saves, and reads back as null', async () => {
    // The backward-compatibility claim: every crew written before these fields existed.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d = await mkDriver();
    expect((await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d }])).status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      missionTypeId: null,
      notes: null,
    });
  });

  // ── a row written before the field existed: the KEY IS ABSENT ────────────
  //
  // The test above saves through the API, so mongoose applies `default: null` and the key IS
  // there. That is why it passed while the board was broken: the real pre-existing row has no
  // such key at all, and `.lean()` applies no defaults, so it arrives as `undefined`.
  //
  // The mapper tested `=== null`, so `undefined` went to `String(undefined)` — the STRING
  // `"undefined"`. It reached the board, came back in the next save payload untouched, and the
  // contract refused the whole save of a row nobody had edited:
  //
  //   must be a 24-hex-char ObjectId (body.rows.1.missionTypeId)
  //
  // These write the document the way the database actually holds it — straight to the
  // collection, bypassing the schema — because that is the only way to have the field absent.

  /** A crew row as it was stored before `missionTypeId`/`notes` existed. No such keys. */
  const insertLegacyCrew = async (
    vehicleId: string,
    fields: Record<string, unknown> = {},
  ): Promise<void> => {
    await mongoose.connection.collection('fleet_fixed_crews').insertOne({
      vehicleId: new Types.ObjectId(vehicleId),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
      ...fields,
    });
  };

  it('LEGACY — an absent mission type reads as null, never the string "undefined"', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await insertLegacyCrew(v.id);

    const row = rowFor(data<FixedBoardDto>(await getCrews()), v.id);
    expect(row, 'the vehicle is on the board').toBeDefined();
    expect(row?.missionTypeId, 'the defect, in one assertion').not.toBe('undefined');
    expect(row?.missionTypeId).toBeNull();
    expect(row?.notes).toBeNull();
  });

  it('LEGACY — an absent driver reads as null too', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await insertLegacyCrew(v.id, { driver1EmployeeId: undefined, driver2EmployeeId: undefined });

    const row = rowFor(data<FixedBoardDto>(await getCrews()), v.id);
    expect(row?.driver1EmployeeId).toBeNull();
    expect(row?.driver2EmployeeId).toBeNull();
    expect(row?.driver1EmployeeId).not.toBe('undefined');
  });

  it('LEGACY — the board can be SAVED again with such a row on it', async () => {
    // The user-visible bug: «حفظ» refused the whole board because of an untouched legacy row.
    // The board is read and sent back exactly as a client does, legacy row included.
    const legacy = data<FleetVehicleDto>(await createVehicle(adminToken));
    const edited = data<FleetVehicleDto>(await createVehicle(adminToken));
    await insertLegacyCrew(legacy.id);
    const driver = await mkDriver();

    const board = data<FixedBoardDto>(await getCrews());
    const rows = [legacy.id, edited.id].map((vehicleId) => {
      const row = rowFor(board, vehicleId);
      return {
        vehicleId,
        missionTypeId: row?.missionTypeId ?? null,
        driver1EmployeeId: vehicleId === edited.id ? driver : (row?.driver1EmployeeId ?? null),
        driver2EmployeeId: row?.driver2EmployeeId ?? null,
        notes: row?.notes ?? null,
      };
    });

    const save = await saveCrews(rows);
    expect(save.status, JSON.stringify(save.body?.error ?? {})).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), edited.id)?.driver1EmployeeId).toBe(
      driver,
    );
  });

  // ── and the contract is NOT relaxed by any of that ───────────────────────

  it('REFUSES the string "undefined" as a mission type — the fix is upstream, not here', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await saveCrews([{ vehicleId: v.id, missionTypeId: 'undefined' }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('24-hex-char ObjectId');
  });

  it('REFUSES an empty string as a mission type', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect((await saveCrews([{ vehicleId: v.id, missionTypeId: '' }])).status).toBe(400);
  });

  it('REFUSES a non-hex id of the right length, and any other junk', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    for (const bad of ['zzzzzzzzzzzzzzzzzzzzzzzz', '123', 'null', '   ']) {
      expect((await saveCrews([{ vehicleId: v.id, missionTypeId: bad }])).status, bad).toBe(400);
    }
  });

  it('ACCEPTS an explicit null — "no mission" is still expressible', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect((await saveCrews([{ vehicleId: v.id, missionTypeId: null }])).status).toBe(200);
  });

  it('EDIT — a work type alone is a change; no driver need be involved', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const missionType = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'missionType', name: { ar: 'نقل أموال يومي', en: 'Daily cash run' } }),
    );
    const save = await saveCrews([{ vehicleId: v.id, missionTypeId: missionType.id }]);
    expect(save.status).toBe(200);
    expect(data<FixedBoardDto>(save).changedCount, 'a crewless row that says something').toBe(1);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.missionTypeId).toBe(missionType.id);
  });

  it('EDIT — re-saving the same four values is a no-op, so nothing is rewritten', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d = await mkDriver();
    const rows = [{ vehicleId: v.id, driver1EmployeeId: d, notes: 'ثابت' }];
    expect(data<FixedBoardDto>(await saveCrews(rows)).changedCount).toBe(1);
    expect(
      data<FixedBoardDto>(await saveCrews(rows)).changedCount,
      'change detection compares all four facts',
    ).toBe(0);
  });

  it('EDIT — clearing a note stores null, not an empty string', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect((await saveCrews([{ vehicleId: v.id, notes: 'مؤقتة' }])).status).toBe(200);
    expect((await saveCrews([{ vehicleId: v.id, notes: null }])).status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.notes).toBeNull();
    // The empty string is refused outright — "cleared" has one spelling.
    expect((await saveCrews([{ vehicleId: v.id, notes: '' }])).status).toBe(400);
  });

  it('EDIT — refuses a mission type that is not a missionType, workType included', async () => {
    // A `workshop` id is a real catalog item of the WRONG kind: well-formed, live, and still
    // somebody else's vocabulary. Storing it would render as another module's label.
    //
    // `workType` (أنواع الأعمال) gets its own assertion because it is not a hypothetical wrong
    // kind — it is the one this column actually pointed at for a release, so a regression would
    // look exactly like the bug that was fixed. The workshop's vocabulary is not a mission.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const kindId = async (kind: string, ar: string): Promise<string> =>
      data<FleetCatalogItemDto>(
        await request(app)
          .post('/api/v1/fleet/catalog-items')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ kind, name: { ar, en: ar } }),
      ).id;

    expect(
      (
        await saveCrews([
          { vehicleId: v.id, missionTypeId: await kindId('workshop', 'ورشة الطقم') },
        ])
      ).status,
      'a workshop is not a mission',
    ).toBe(400);
    expect(
      (
        await saveCrews([
          { vehicleId: v.id, missionTypeId: await kindId('workType', 'صيانة دورية') },
        ])
      ).status,
      'and neither is a WORK type — the very kind this column used to read',
    ).toBe(400);
    expect(
      (await saveCrews([{ vehicleId: v.id, missionTypeId: new Types.ObjectId().toString() }]))
        .status,
      'and a dangling reference too',
    ).toBe(400);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.missionTypeId).toBeNull();
  });

  it('EDIT — an archived mission type is refused; only a LIVE one may be seated', async () => {
    // `findActiveOfKind` is the check, so archiving must actually close the door. Otherwise the
    // catalog's archive-not-delete rule would be advisory on this column.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const item = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'missionType', name: { ar: 'مهمة مؤرشفة', en: 'Archived mission' } }),
    );
    expect((await saveCrews([{ vehicleId: v.id, missionTypeId: item.id }])).status).toBe(200);
    await request(app)
      .patch(`/api/v1/fleet/catalog-items/${item.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: 0 });
    expect(
      (await saveCrews([{ vehicleId: v.id, missionTypeId: item.id, notes: 'تغيير' }])).status,
      'archived is not seatable',
    ).toBe(400);
  });

  it('EDIT — the driver rules still hold when the edit comes as one row', async () => {
    // The dialog saves exactly this shape. It must not be a way around exclusivity.
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const d = await mkDriver();
    expect((await saveCrews([{ vehicleId: a.id, driver1EmployeeId: d }])).status).toBe(200);
    // Only the receiving row — the releasing row is missing, so the server refuses.
    expect(
      (await saveCrews([{ vehicleId: b.id, driver1EmployeeId: d, notes: 'من التعديل' }])).status,
      'one driver, one fixed crew',
    ).toBe(409);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), a.id)?.driver1EmployeeId).toBe(d);
    expect(
      rowFor(data<FixedBoardDto>(await getCrews()), b.id)?.notes,
      'the refusal wrote nothing',
    ).toBeNull();
  });

  it('EDIT — writes nothing outside fleet_fixed_crews', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d = await mkDriver();
    const missionType = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'missionType', name: { ar: 'مهمة', en: 'Task' } }),
    );
    const counts = async () => ({
      drivers: await mongoose.connection.collection('fleet_driver_profiles').countDocuments({}),
      vehicles: await mongoose.connection.collection('fleet_vehicles').countDocuments({}),
      duty: await mongoose.connection.collection('fleet_duty_assignments').countDocuments({}),
      visits: await mongoose.connection.collection('fleet_maintenance_visits').countDocuments({}),
      catalog: await mongoose.connection.collection('fleet_catalog_items').countDocuments({}),
    });
    const before = await counts();
    const vehicleBefore = await mongoose.connection
      .collection('fleet_vehicles')
      .findOne({ _id: new Types.ObjectId(v.id) });

    expect(
      (
        await saveCrews([
          { vehicleId: v.id, missionTypeId: missionType.id, driver1EmployeeId: d, notes: 'ملاحظة' },
        ])
      ).status,
    ).toBe(200);

    expect(await counts(), 'no other collection gained or lost a document').toEqual(before);
    expect(
      await mongoose.connection
        .collection('fleet_vehicles')
        .findOne({ _id: new Types.ObjectId(v.id) }),
      'the vehicle row is byte-identical',
    ).toEqual(vehicleBefore);
  });

  // ── persistence: the whole point of the screen ────────────────────────────

  it('stores a crew and answers with it on a FRESH read — not just in the save response', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];

    const save = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 },
    ]);
    expect(save.status).toBe(200);
    expect(data<FixedBoardDto>(save).changedCount).toBe(1);

    // A second, independent request — this is what a page reload does.
    const reload = await getCrews();
    expect(reload.status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(reload), v.id)).toMatchObject({
      driver1EmployeeId: d1,
      driver2EmployeeId: d2,
    });
  });

  it('carries no date anywhere — not in the query, not in the row', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    const board = data<FixedBoardDto>(await getCrews());
    expect(Object.keys(board)).toEqual(expect.arrayContaining(['rows', 'drivers']));
    expect(Object.keys(board)).not.toContain('date');
    expect(Object.keys(rowFor(board, v.id) as object)).not.toContain('date');
    // And a date sent anyway is refused rather than quietly stored.
    const withDate = await request(app)
      .post('/api/v1/fleet/fixed-roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-11-01', rows: [{ vehicleId: v.id }] });
    expect(withDate.status).toBe(400);
  });

  it('replaces the previous crew rather than appending to it', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d2 }]);

    const board = data<FixedBoardDto>(await getCrews());
    expect(rowFor(board, v.id)).toMatchObject({ driver1EmployeeId: d2, driver2EmployeeId: null });
    // The one replaced is free again, and says so.
    expect(board.drivers.find((d) => d.employeeId === d1)?.assignedVehicleId).toBeNull();
    expect(board.drivers.find((d) => d.employeeId === d2)?.assignedVehicleId).toBe(v.id);
  });

  it('clears a crew, and the cleared row survives as an empty one', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    const cleared = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: null },
    ]);
    expect(data<FixedBoardDto>(cleared).changedCount).toBe(1);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      driver1EmployeeId: null,
      driver2EmployeeId: null,
    });
  });

  it('treats an unchanged save as a no-op', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    const again = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    expect(data<FixedBoardDto>(again).changedCount).toBe(0);
  });

  it('never writes a row for a vehicle whose crew was empty to begin with', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await saveCrews([{ vehicleId: v.id }]);
    expect(data<FixedBoardDto>(res).changedCount).toBe(0);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      driver1EmployeeId: null,
    });
  });

  // ── integrity: the same two rules the daily plan enforces ─────────────────

  it('refuses the same person in BOTH slots of one vehicle', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    const res = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d1 },
    ]);
    expect(res.status).toBe(400);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.driver1EmployeeId).toBeNull();
  });

  it('refuses one driver in two crews within a single save', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const d1 = await mkDriver();
    const res = await saveCrews([
      { vehicleId: a.id, driver1EmployeeId: d1 },
      { vehicleId: b.id, driver1EmployeeId: d1 },
    ]);
    expect(res.status).toBe(400);
  });

  it('refuses to seat a driver another vehicle still holds, naming the row to release', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: a.id, driver1EmployeeId: d1 }]);
    // Only the receiving row — the releasing one was forgotten.
    const res = await saveCrews([{ vehicleId: b.id, driver1EmployeeId: d1 }]);
    expect(res.status).toBe(409);
    // Nothing moved.
    const board = data<FixedBoardDto>(await getCrews());
    expect(rowFor(board, a.id)?.driver1EmployeeId).toBe(d1);
    expect(rowFor(board, b.id)?.driver1EmployeeId).toBeNull();
  });

  it('MOVES a driver when both sides of the move travel together', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: a.id, driver1EmployeeId: d1 }]);
    const moved = await saveCrews([
      { vehicleId: a.id, driver1EmployeeId: null },
      { vehicleId: b.id, driver1EmployeeId: d1 },
    ]);
    expect(moved.status).toBe(200);
    const board = data<FixedBoardDto>(await getCrews());
    expect(rowFor(board, a.id)?.driver1EmployeeId).toBeNull();
    expect(rowFor(board, b.id)?.driver1EmployeeId).toBe(d1);
    expect(board.drivers.find((d) => d.employeeId === d1)?.assignedVehicleId).toBe(b.id);
  });

  it('refuses an employee who is not an active driver', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const plainEmployee = await mkEmployee();
    const res = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: plainEmployee }]);
    expect(res.status).toBe(400);
  });

  // ── DESTRUCTIVE-BEHAVIOUR AUDIT: what a save actually mutates ─────────────
  //
  // Read against a REAL database, not inferred from the UI. A fixed crew is a REFERENCE to a
  // driver, and the fear these tests answer is that setting or moving that reference does
  // something to the driver themselves. Every one counts and identifies the driver population
  // before and after, so "the driver is gone" and "the driver is no longer in this slot" can
  // never be confused for each other.

  /** Every driver profile the fleet has, by employeeId — the population under audit. */
  const driverPopulation = async (): Promise<{ ids: string[]; active: string[] }> => {
    const res = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ pageSize: MAX_PAGE_SIZE })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = data<FleetDriverProfileDto[]>(res);
    return {
      ids: rows.map((d) => d.employeeId).sort(),
      active: rows
        .filter((d) => d.isActive)
        .map((d) => d.employeeId)
        .sort(),
    };
  };

  it('AUDIT — saving a fixed crew deletes no driver and deactivates none', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const before = await driverPopulation();

    const save = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 },
    ]);
    expect(save.status).toBe(200);

    const after = await driverPopulation();
    expect(after.ids, 'the exact same driver profiles exist').toEqual(before.ids);
    expect(after.active, 'and every one of them is still active').toEqual(before.active);
    expect(after.ids).toContain(d1);
    expect(after.ids).toContain(d2);
  });

  it('AUDIT — MOVING a driver between vehicles deletes nobody', async () => {
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: a.id, driver1EmployeeId: d1 }]);
    const before = await driverPopulation();

    const moved = await saveCrews([
      { vehicleId: a.id, driver1EmployeeId: null },
      { vehicleId: b.id, driver1EmployeeId: d1 },
    ]);
    expect(moved.status).toBe(200);

    const after = await driverPopulation();
    expect(after.ids).toEqual(before.ids);
    expect(after.active).toEqual(before.active);
    // The reference moved; that is the ONLY thing that moved.
    const board = data<FixedBoardDto>(await getCrews());
    expect(rowFor(board, a.id)?.driver1EmployeeId).toBeNull();
    expect(rowFor(board, b.id)?.driver1EmployeeId).toBe(d1);
  });

  it('AUDIT — moving between the two SLOTS of one vehicle deletes nobody', async () => {
    // A SWAP, because that is the only slot move a crew can make: a lone driver may not be sent
    // to seat two, since a second driver with no first is not a crew the record may hold.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 }]);
    const before = await driverPopulation();

    const moved = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d2, driver2EmployeeId: d1 },
    ]);
    expect(moved.status).toBe(200);
    expect(await driverPopulation()).toEqual(before);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      driver1EmployeeId: d2,
      driver2EmployeeId: d1,
    });
  });

  it('AUDIT — REMOVING a driver from a crew clears the reference and nothing else', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    const before = await driverPopulation();

    const cleared = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: null }]);
    expect(cleared.status).toBe(200);

    // The population is untouched...
    expect(await driverPopulation()).toEqual(before);
    // ...and the profile itself is intact, field by field, not merely present.
    const listed = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ pageSize: MAX_PAGE_SIZE })
      .set('Authorization', `Bearer ${adminToken}`);
    const profile = data<FleetDriverProfileDto[]>(listed).find((d) => d.employeeId === d1);
    expect(profile, 'the driver profile still exists').toBeDefined();
    expect(profile?.isActive, 'and is still active').toBe(true);
    expect(profile?.licenseNumber, 'with its licence untouched').toBeTruthy();
  });

  it('AUDIT — a driver removed from a fixed crew is still assignable on the DAILY roster', async () => {
    // The point of the whole audit in one test: leaving a fixed crew costs the driver nothing.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: null }]);

    const date = '2026-12-11';
    const dayBoard = await request(app)
      .get('/api/v1/fleet/roster')
      .query({ date })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dayBoard.status).toBe(200);
    const day = data<{
      availableDrivers: { employeeId: string }[];
      unavailableDrivers: { employeeId: string; reason: string }[];
    }>(dayBoard);
    expect(
      day.availableDrivers.some((d) => d.employeeId === d1),
      'still in the AVAILABLE pool',
    ).toBe(true);
    expect(day.unavailableDrivers.some((d) => d.employeeId === d1)).toBe(false);

    // And can actually be planned for a day.
    const plan = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date, rows: [{ vehicleId: v.id, driver1EmployeeId: d1 }] });
    expect(plan.status).toBe(200);
  });

  it('AUDIT — the daily roster’s own rows are untouched by any fixed-crew save', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [daily, fixed] = [await mkDriver(), await mkDriver()];
    const date = '2026-12-12';

    const plan = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date, rows: [{ vehicleId: v.id, driver1EmployeeId: daily }] });
    expect(plan.status).toBe(200);

    const dayBefore = async () =>
      data<{ rows: { vehicleId: string; driver1EmployeeId: string | null }[] }>(
        await request(app)
          .get('/api/v1/fleet/roster')
          .query({ date })
          .set('Authorization', `Bearer ${adminToken}`),
      ).rows.find((r) => r.vehicleId === v.id);
    const before = await dayBefore();

    // Set, reseat and clear a fixed crew on the SAME vehicle. The middle step is a swap rather
    // than a slide into seat two: a crew may not hold a second driver with no first.
    const second = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: fixed, driver2EmployeeId: second }]);
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: second, driver2EmployeeId: fixed }]);
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: null }]);

    expect(await dayBefore(), 'the day row is byte-identical').toEqual(before);
  });

  it('AUDIT — an id spelled in UPPERCASE hex is the same vehicle, not a second one', () => {
    // An ObjectId is a number written in hex and `objectId()` accepts either case, but every
    // lookup keys off `String(doc.field)`, which mongo renders lowercase. Left unsettled, the
    // uppercase spelling misses the "does this vehicle already have a crew" map and takes the
    // INSERT branch — a second live row for one vehicle, the older one invisible thereafter
    // while still pinning its driver. The schema settles the spelling at the boundary.
    const v = '64b1f0abcdefabcdefabcdef';
    const d = '64b1f0abcdefabcdefabcd01';
    const parsed = SaveFleetFixedRosterSchema.parse({
      rows: [{ vehicleId: v.toUpperCase(), driver1EmployeeId: d.toUpperCase() }],
    });
    expect(parsed.rows[0]?.vehicleId).toBe(v);
    expect(parsed.rows[0]?.driver1EmployeeId).toBe(d);
    // And one vehicle spelled two ways is still one vehicle.
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: v }, { vehicleId: v.toUpperCase() }],
      }).success,
    ).toBe(false);
  });

  it('AUDIT — an UPPERCASE vehicleId edits the existing crew row, it does not add a second', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);

    const upper = await saveCrews([{ vehicleId: v.id.toUpperCase(), driver1EmployeeId: d2 }]);
    expect(upper.status).toBe(200);

    const board = data<FixedBoardDto>(await getCrews());
    // ONE row for the vehicle, carrying the new driver — not two rows, and not a stranded one.
    expect(board.rows.filter((r) => r.vehicleId === v.id)).toHaveLength(1);
    expect(rowFor(board, v.id)?.driver1EmployeeId).toBe(d2);
    // And the driver it replaced is free again rather than pinned by an invisible row.
    expect(board.drivers.find((x) => x.employeeId === d1)?.assignedVehicleId).toBeNull();
  });

  // ── the pool: every active driver, undivided ─────────────────────────────

  it('lists every active driver in ONE pool, with no availability verdict attached', async () => {
    const d1 = await mkDriver();
    const board = data<FixedBoardDto>(await getCrews());
    const entry = board.drivers.find((d) => d.employeeId === d1);
    expect(entry, 'the driver is in the pool').toBeDefined();
    expect(Object.keys(entry as object).sort()).toEqual(['assignedVehicleId', 'employeeId']);
    expect(Object.keys(board)).not.toContain('availableDrivers');
    expect(Object.keys(board)).not.toContain('unavailableDrivers');
  });

  // ── the unique index: the rule as a DATABASE fact ────────────────────────
  //
  // The service checks exclusivity against the end state of the board, but that check runs in
  // application code: two concurrent saves can both read a board without the row and both decide
  // to insert. `ux_fixed_vehicle` is what makes the second one lose. `autoIndex` is off outside
  // development, so production builds it from `runFleetMigrations`; these run against a real
  // database and assert the built index, not the declared one.

  const fixedCrewIndexes = async (): Promise<Record<string, unknown>[]> =>
    (await mongoose.connection.collection('fleet_fixed_crews').indexes()) as unknown as Record<
      string,
      unknown
    >[];

  it('INDEX — ux_fixed_vehicle exists on the collection, unique and partial on live rows', async () => {
    // Make sure the collection exists before asking about its indexes.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    await migrateFixedCrewIndex();

    const ix = (await fixedCrewIndexes()).find((i) => i.name === 'ux_fixed_vehicle');
    expect(ix, 'the index is built').toBeDefined();
    expect(ix?.key).toEqual({ vehicleId: 1 });
    expect(ix?.unique, 'unique').toBe(true);
    expect(ix?.partialFilterExpression).toEqual({ isDeleted: false });
  });

  it('INDEX — the MIGRATION is what builds it, and building twice is a no-op', async () => {
    // `autoIndex` is on in tests and off in production, so an "index exists" assertion would
    // pass here even with the migration deleted. Dropping it first is what makes this test about
    // the deploy step rather than about mongoose.
    const crews = mongoose.connection.collection('fleet_fixed_crews');
    await crews.dropIndex('ux_fixed_vehicle').catch(() => undefined);
    expect(
      (await fixedCrewIndexes()).some((i) => i.name === 'ux_fixed_vehicle'),
      'gone, as a production database would have it before the deploy step',
    ).toBe(false);

    const first = await migrateFixedCrewIndex();
    expect(first.created, 'the migration built it').toBe(true);
    expect((await fixedCrewIndexes()).some((i) => i.name === 'ux_fixed_vehicle')).toBe(true);

    const second = await migrateFixedCrewIndex();
    expect(second.created, 'idempotent — every boot after the first is a no-op').toBe(true);
    expect(second.duplicateVehicles).toBe(0);
    expect(
      (await fixedCrewIndexes()).filter((i) => i.name === 'ux_fixed_vehicle'),
      'and there is still exactly one of it',
    ).toHaveLength(1);
  });

  it('INDEX — the DATABASE refuses a second live crew row for one vehicle', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    await migrateFixedCrewIndex();

    // Straight at the collection, bypassing every application-level check — the only way to ask
    // whether the DATABASE is the one holding the line.
    const insertSecond = mongoose.connection.collection('fleet_fixed_crews').insertOne({
      vehicleId: new Types.ObjectId(v.id),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    await expect(insertSecond).rejects.toMatchObject({ code: 11000 });

    // Nothing was added.
    const rows = await mongoose.connection
      .collection('fleet_fixed_crews')
      .countDocuments({ vehicleId: new Types.ObjectId(v.id), isDeleted: false });
    expect(rows).toBe(1);
  });

  it('INDEX — a SOFT-DELETED row does not hold a live vehicle’s slot', async () => {
    // The partial filter is the reason: without it, an archived crew would block the car forever.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await migrateFixedCrewIndex();
    const crews = mongoose.connection.collection('fleet_fixed_crews');
    await crews.insertOne({
      vehicleId: new Types.ObjectId(v.id),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      isDeleted: true,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    const live = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    expect(live.status, 'a live crew is still allowed beside the deleted row').toBe(200);
  });

  it('INDEX — ordinary create and update still work with it in place', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await migrateFixedCrewIndex();

    const created = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }]);
    expect(created.status).toBe(200);
    const updated = await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d2 }]);
    expect(updated.status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.driver1EmployeeId).toBe(d2);
    // One row throughout — the update edited it rather than adding beside it.
    expect(
      await mongoose.connection
        .collection('fleet_fixed_crews')
        .countDocuments({ vehicleId: new Types.ObjectId(v.id), isDeleted: false }),
    ).toBe(1);
  });

  it('INDEX — duplicates are REPORTED and the index withheld, never deleted or merged', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const crews = mongoose.connection.collection('fleet_fixed_crews');
    // Drop the index so the duplicate can exist at all — this is the shape of a database that
    // ran an older build.
    await crews.dropIndex('ux_fixed_vehicle').catch(() => undefined);
    const row = () => ({
      vehicleId: new Types.ObjectId(v.id),
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      isDeleted: false,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    await crews.insertMany([row(), row()]);

    const outcome = await migrateFixedCrewIndex();
    expect(outcome.created, 'the index is withheld').toBe(false);
    expect(outcome.duplicateVehicles).toBe(1);
    expect(
      (await fixedCrewIndexes()).some((i) => i.name === 'ux_fixed_vehicle'),
      'and really was not built',
    ).toBe(false);
    // BOTH rows survive — resolving them is an operator's decision, not a migration's.
    expect(
      await crews.countDocuments({ vehicleId: new Types.ObjectId(v.id), isDeleted: false }),
    ).toBe(2);

    // Clean up so the rest of the suite sees a healthy collection again.
    await crews.deleteMany({ vehicleId: new Types.ObjectId(v.id) });
    expect((await migrateFixedCrewIndex()).created).toBe(true);
  });

  it('INDEX — no other collection gains, loses or changes an index', async () => {
    const names = async (collection: string): Promise<string[]> =>
      (await mongoose.connection.collection(collection).indexes())
        .map((i) => String((i as { name?: string }).name))
        .sort();
    const before = {
      drivers: await names('fleet_driver_profiles'),
      duty: await names('fleet_duty_assignments'),
      vehicles: await names('fleet_vehicles'),
    };
    // And the driver population is untouched by an index build.
    const driversBefore = await mongoose.connection
      .collection('fleet_driver_profiles')
      .countDocuments({});

    await migrateFixedCrewIndex();

    expect(await names('fleet_driver_profiles')).toEqual(before.drivers);
    expect(await names('fleet_duty_assignments')).toEqual(before.duty);
    expect(await names('fleet_vehicles')).toEqual(before.vehicles);
    expect(await mongoose.connection.collection('fleet_driver_profiles').countDocuments({})).toBe(
      driversBefore,
    );
  });

  // ── permissions: the daily board's grants, not new ones ──────────────────

  it('rides the roster grants — the branch operator, who has neither, is refused both', async () => {
    // No new permission was declared for this board: §7 gives one view grant and one planning
    // grant for the whole assignment surface, and the branch operator holds neither, exactly as
    // on the daily roster.
    expect((await getCrews(branchAToken)).status).toBe(403);
    expect(
      (await saveCrews([{ vehicleId: '64b1f0cccccccccccccccc99' }], branchAToken)).status,
    ).toBe(403);
  });

  // ── and the DAILY roster is untouched by all of it ───────────────────────

  it('does not disturb the daily roster — the two boards are separate rows', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [fixed, daily] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: fixed }]);

    const date = '2026-12-09';
    const plan = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date, rows: [{ vehicleId: v.id, driver1EmployeeId: daily }] });
    expect(plan.status).toBe(200);

    // The day says one thing, the standing crew still says the other.
    const day = await request(app)
      .get('/api/v1/fleet/roster')
      .query({ date })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      (
        data<{ rows: { vehicleId: string; driver1EmployeeId: string | null }[] }>(day).rows.find(
          (r) => r.vehicleId === v.id,
        ) ?? {}
      ).driver1EmployeeId,
    ).toBe(daily);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.driver1EmployeeId).toBe(fixed);
  });

  // ── retiring the legacy `workTypeId` ─────────────────────────────────────
  //
  // The column stored `workTypeId` for one release, validated against the WORKSHOP's catalog.
  // These run against real MongoDB because the whole risk is in the write: a dry run that
  // quietly writes, a commit that invents a mission, or an `updateMany` whose filter is loose
  // enough to reach another collection. None of that is visible in source alone.

  const legacyRow = async (vehicleId: string, workTypeId: Types.ObjectId): Promise<void> => {
    // Written through the raw collection: `workTypeId` is no longer in the schema, so a strict
    // Mongoose model would silently drop it — which is exactly the state a real legacy row is in.
    await mongoose.connection
      .collection('fleet_fixed_crews')
      .updateOne(
        { vehicleId: new Types.ObjectId(vehicleId) },
        { $set: { workTypeId } },
        { upsert: false },
      );
  };

  it('MIGRATION dry run — reports the legacy rows and writes absolutely nothing', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    const workType = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'workType', name: { ar: 'صيانة قديمة', en: 'Legacy maintenance' } }),
    );
    await legacyRow(v.id, new Types.ObjectId(workType.id));

    const before = await mongoose.connection
      .collection('fleet_fixed_crews')
      .findOne({ vehicleId: new Types.ObjectId(v.id) });

    const report = await inspectLegacyWorkTypes();
    expect(report.rowsWithLegacyValue, 'the row is seen').toBeGreaterThanOrEqual(1);
    const seen = report.distinct.find((d) => d.workTypeId === workType.id);
    expect(seen?.rows).toBe(1);
    // …and it reports WHAT the id actually is, which is the whole point of reading before writing.
    expect(seen?.catalog).toMatchObject({ kind: 'workType', nameAr: 'صيانة قديمة' });

    expect(
      await mongoose.connection
        .collection('fleet_fixed_crews')
        .findOne({ vehicleId: new Types.ObjectId(v.id) }),
      'the row is byte-identical after a dry run',
    ).toEqual(before);
  });

  it('MIGRATION commit — unsets the legacy field and invents no mission type', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const driver = await mkDriver();
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: driver, notes: 'ملاحظة قائمة' }]);
    const workType = data<FleetCatalogItemDto>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'workType', name: { ar: 'غسيل', en: 'Wash' } }),
    );
    await legacyRow(v.id, new Types.ObjectId(workType.id));

    await retireLegacyWorkTypes();

    const raw = await mongoose.connection
      .collection('fleet_fixed_crews')
      .findOne({ vehicleId: new Types.ObjectId(v.id) });
    expect(raw, 'the retired field is gone from the document').not.toHaveProperty('workTypeId');
    expect(raw?.missionTypeId ?? null, 'and NOTHING was put in its place').toBeNull();
    // The rest of the row is untouched — this retires a field, it does not rewrite crews.
    expect(String(raw?.driver1EmployeeId)).toBe(driver);
    expect(raw?.notes).toBe('ملاحظة قائمة');

    // The board reads cleanly afterwards: no mission type, and no crash on the missing field.
    const row = rowFor(data<FixedBoardDto>(await getCrews()), v.id);
    expect(row?.missionTypeId).toBeNull();
    expect(row?.driver1EmployeeId).toBe(driver);

    // Idempotent: running it twice is not an error and changes nothing further.
    const again = await retireLegacyWorkTypes();
    expect(again.modified).toBe(0);
  });

  it('MIGRATION never touches a maintenance document — they have a workTypeId too', async () => {
    // `fleet_maintenance_visits.workTypeId` is a DIFFERENT field on a DIFFERENT collection, and
    // it is correct. A migration filtered by field name rather than by collection would strip it.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const before = await FleetMaintenanceVisitModel.find({}).lean().exec();
    const withType = before.filter((visit) => visit.workTypeId != null).length;
    expect(withType, 'the fixture has maintenance visits to protect').toBeGreaterThan(0);

    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    await retireLegacyWorkTypes();

    const after = await FleetMaintenanceVisitModel.find({}).lean().exec();
    expect(after.filter((visit) => visit.workTypeId != null).length).toBe(withType);
    expect(
      after.map((visit) => String(visit.workTypeId)).sort(),
      'every maintenance work type survives byte for byte',
    ).toEqual(before.map((visit) => String(visit.workTypeId)).sort());
  });

  it('MIGRATION leaves the audit trail alone — history is not rewritten', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: await mkDriver() }]);
    const audits = mongoose.connection.collection('audit_logs');
    const before = await audits.countDocuments({});
    // Without this the whole test passes on an empty collection — 0 === 0 proves nothing, and a
    // wrong collection name would look exactly like a clean bill of health.
    expect(before, 'there IS history to protect').toBeGreaterThan(0);
    const sample = await audits.find({}).sort({ _id: -1 }).limit(5).toArray();
    expect(sample.length, 'and a sample to compare byte for byte').toBeGreaterThan(0);

    await retireLegacyWorkTypes();

    expect(await audits.countDocuments({}), 'no audit row added or removed').toBe(before);
    expect(
      await audits
        .find({ _id: { $in: sample.map((doc) => doc._id) } })
        .sort({ _id: -1 })
        .toArray(),
      'and the existing entries are byte-identical',
    ).toEqual(sample);
  });

  // ── a second driver needs a first ────────────────────────────────────────
  //
  // The slots are ORDERED: slot 1 is the crew's driver, slot 2 the second man beside them. A row
  // holding only a second driver reads as a crewless car on every screen that shows "the driver"
  // while a real person is committed to it. The board refuses to propose it; these prove the
  // SERVER refuses to store it, so the rule is not UI-only.

  it('DRIVER ORDER — refuses a second driver with no first', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d2 = await mkDriver();
    const res = await saveCrews([{ vehicleId: v.id, driver2EmployeeId: d2 }]);
    expect(res.status, 'a crew whose only member sits in seat two').toBe(400);
    expect(
      rowFor(data<FixedBoardDto>(await getCrews()), v.id)?.driver2EmployeeId ?? null,
      'and nothing was written',
    ).toBeNull();
  });

  it('DRIVER ORDER — refuses it with driver 1 spelled as an explicit null', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d2 = await mkDriver();
    expect(
      (await saveCrews([{ vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: d2 }]))
        .status,
    ).toBe(400);
  });

  it('DRIVER ORDER — accepts the pair when the first driver is there', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const res = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 },
    ]);
    expect(res.status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      driver1EmployeeId: d1,
      driver2EmployeeId: d2,
    });
  });

  it('DRIVER ORDER — a lone FIRST driver is a crew, and clearing one stays legal', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const d1 = await mkDriver();
    expect((await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1 }])).status).toBe(200);
    // The rule is about ORDER, not presence — emptying a vehicle must remain expressible.
    expect(
      (await saveCrews([{ vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: null }]))
        .status,
    ).toBe(200);
  });

  it('DRIVER ORDER — clearing driver 1 while driver 2 remains is REFUSED, not silently kept', async () => {
    // The board promotes the second driver into the vacated seat rather than sending this, so a
    // dispatcher never meets the refusal. A client that sends it anyway gets a 400 — and the
    // stored crew is left exactly as it was.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 }]);

    const res = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: null, driver2EmployeeId: d2 },
    ]);
    expect(res.status).toBe(400);
    expect(
      rowFor(data<FixedBoardDto>(await getCrews()), v.id),
      'the crew that was already there is untouched',
    ).toMatchObject({ driver1EmployeeId: d1, driver2EmployeeId: d2 });
  });

  it('DRIVER ORDER — the promotion the board sends IS accepted', async () => {
    // The other half of the previous test: what the UI actually produces when driver 1 is
    // cleared is a promotion, and that must go through.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 }]);

    const res = await saveCrews([
      { vehicleId: v.id, driver1EmployeeId: d2, driver2EmployeeId: null },
    ]);
    expect(res.status).toBe(200);
    expect(rowFor(data<FixedBoardDto>(await getCrews()), v.id)).toMatchObject({
      driver1EmployeeId: d2,
      driver2EmployeeId: null,
    });
  });

  it('DRIVER ORDER — refuses the bad row even when a GOOD row travels beside it', async () => {
    // Saves are batched: a move sends both sides. One invalid row must fail the whole payload
    // rather than being quietly dropped from it.
    const [a, b] = [
      data<FleetVehicleDto>(await createVehicle(adminToken)),
      data<FleetVehicleDto>(await createVehicle(adminToken)),
    ];
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    const res = await saveCrews([
      { vehicleId: a.id, driver1EmployeeId: d1 },
      { vehicleId: b.id, driver2EmployeeId: d2 },
    ]);
    expect(res.status).toBe(400);
    const board = data<FixedBoardDto>(await getCrews());
    expect(rowFor(board, a.id)?.driver1EmployeeId ?? null, 'the good row did not land').toBeNull();
  });

  it('DRIVER ORDER — a crew stored before the rule still READS and re-saves', async () => {
    // Existing valid rows remain valid: nothing re-validates on read, and a legal crew written
    // yesterday can be saved again today unchanged.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const [d1, d2] = [await mkDriver(), await mkDriver()];
    await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 }]);
    expect((await getCrews()).status).toBe(200);
    expect(
      (
        await saveCrews([{ vehicleId: v.id, driver1EmployeeId: d1, driver2EmployeeId: d2 }])
      ).status,
    ).toBe(200);
  });
});

describe('accidents + violations + grievances (§4.6/§4.7, FR-9/FR-10 — FL-6)', () => {
  const violationTypeIdByName = async (name: string): Promise<string> => {
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'violationType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const item = data<FleetCatalogItemDto[]>(res).find((i) => i.name.ar === name);
    if (item === undefined) throw new Error(`violationType ${name} not found`);
    return item.id;
  };

  it('walks the accident lifecycle: record → close → reopen, no-ops refused, all published', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const createRes = await request(app)
      .post('/api/v1/fleet/accidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        occurredAt: '2026-06-15',
        culprit: 'طرف ثالث',
        statement: 'اصطدام أثناء الانتظار أمام الفرع',
        companyCost: 1500,
        amountCollected: 0,
        paidAmount: 0,
      });
    expect(createRes.status).toBe(201);
    const accident = data<{ id: string; status: string; version: number }>(createRes);
    expect(accident.status).toBe('open');
    expect(seenEvents.some((e) => e.name === FleetEvents.AccidentRecorded)).toBe(true);

    const close = await request(app)
      .post(`/api/v1/fleet/accidents/${accident.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'closed', version: accident.version });
    expect(close.status).toBe(200);
    expect(seenEvents.some((e) => e.name === FleetEvents.AccidentClosed)).toBe(true);

    // FR-10 refuses a no-op flip — every published event is a real change.
    const noop = await request(app)
      .post(`/api/v1/fleet/accidents/${accident.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'closed', version: data<{ version: number }>(close).version });
    expect(noop.status).toBe(409);

    const reopen = await request(app)
      .post(`/api/v1/fleet/accidents/${accident.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'open', version: data<{ version: number }>(close).version });
    expect(reopen.status).toBe(200);
    expect(seenEvents.some((e) => e.name === FleetEvents.AccidentReopened)).toBe(true);

    // Facts edit is version-aware and publishes nothing (§8 lists no accident.updated).
    const edit = await request(app)
      .patch(`/api/v1/fleet/accidents/${accident.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amountCollected: 750, version: data<{ version: number }>(reopen).version });
    expect(edit.status).toBe(200);
    expect(data<{ amountCollected: number }>(edit).amountCollected).toBe(750);
  });

  it('FR-9 — a vehicle statement row derives its amount; the client cannot send one', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const typeId6 = await violationTypeIdByName('الانتظار في الممنوع');

    const smuggled = await request(app)
      .post('/api/v1/fleet/violations/vehicle')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        year: 2026,
        violationTypeId: typeId6,
        count: 4,
        unitValue: 200,
        amount: 1,
      });
    expect(smuggled.status).toBe(400); // strict schema — no amount field exists to send

    const res = await request(app)
      .post('/api/v1/fleet/violations/vehicle')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: v.id, year: 2026, violationTypeId: typeId6, count: 4, unitValue: 200 });
    expect(res.status).toBe(201);
    const row = data<{ id: string; amount: number; version: number }>(res);
    expect(row.amount).toBe(800);
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.ViolationRecorded &&
          (e.payload as { kind: string; amount: number }).amount === 800,
      ),
    ).toBe(true);

    // Editing a factor recomputes the amount; driver fields on a vehicle row are refused.
    const edited = await request(app)
      .patch(`/api/v1/fleet/violations/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ count: 6, version: row.version });
    expect(data<{ amount: number }>(edited).amount).toBe(1200);
    const wrongShape = await request(app)
      .patch(`/api/v1/fleet/violations/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-03-01', version: data<{ version: number }>(edited).version });
    expect(wrongShape.status).toBe(400);
  });

  it('a driver violation needs a driver profile, records as entered, and edits stay in shape', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const typeId6 = await violationTypeIdByName('حزام');
    const employeeId = await mkEmployee();

    const noProfile = await request(app)
      .post('/api/v1/fleet/violations/driver')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        date: '2026-05-10',
        driverEmployeeId: employeeId,
        violationTypeId: typeId6,
        amount: 250,
      });
    expect(noProfile.status).toBe(400);

    await mkDriverProfile(employeeId);
    const res = await request(app)
      .post('/api/v1/fleet/violations/driver')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        date: '2026-05-10',
        driverEmployeeId: employeeId,
        violationTypeId: typeId6,
        amount: 250,
      });
    expect(res.status).toBe(201);
    const row = data<{ id: string; kind: string; amount: number; version: number }>(res);
    expect(row.kind).toBe('driver');
    expect(row.amount).toBe(250);

    // Statement fields on a driver row are refused (§2.9 — two shapes, one collection).
    const wrongShape = await request(app)
      .patch(`/api/v1/fleet/violations/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ count: 2, version: row.version });
    expect(wrongShape.status).toBe(400);
  });

  it('the grievance is ONE figure per (vehicle, year), and the rollup merges everything', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const vehicleType = await violationTypeIdByName('رسوم خدمة');
    const driverType = await violationTypeIdByName('تليفون');
    const employeeId = await mkEmployee();
    await mkDriverProfile(employeeId);

    // Vehicle statement: 3 × 100 in 2027; driver event: 150 dated inside 2027.
    await request(app)
      .post('/api/v1/fleet/violations/vehicle')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        year: 2027,
        violationTypeId: vehicleType,
        count: 3,
        unitValue: 100,
      });
    await request(app)
      .post('/api/v1/fleet/violations/driver')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: v.id,
        date: '2027-04-01',
        driverEmployeeId: employeeId,
        violationTypeId: driverType,
        amount: 150,
      });

    // Set, then OVERWRITE the grievance — the second call updates the same single row.
    const first = await request(app)
      .put('/api/v1/fleet/violations/grievance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: v.id, year: 2027, totalBeforeGrievance: 900 });
    expect(first.status).toBe(200);
    const second = await request(app)
      .put('/api/v1/fleet/violations/grievance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ vehicleId: v.id, year: 2027, totalBeforeGrievance: 600 });
    expect(second.status).toBe(200);
    expect(data<{ id: string }>(second).id).toBe(data<{ id: string }>(first).id);
    expect(
      seenEvents.filter(
        (e) =>
          e.name === FleetEvents.GrievanceApplied &&
          (e.payload as { vehicleId: string }).vehicleId === v.id,
      ).length,
    ).toBe(2);

    const rollup = await request(app)
      .get('/api/v1/fleet/violations/rollup')
      .query({ year: 2027, vehicleId: v.id })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(rollup.status).toBe(200);
    expect(data<unknown[]>(rollup)).toEqual([
      {
        vehicleId: v.id,
        code: v.code,
        year: 2027,
        vehicleCount: 3,
        vehicleAmount: 300,
        driverCount: 1,
        driverAmount: 150,
        totalCount: 4,
        totalAmount: 450,
        totalBeforeGrievance: 600,
      },
    ]);
  });

  // ── The accident list's filters, and the figures under it ────────────────────
  //
  // Every rule here is a rule about what the SERVER returns, so every one of them is asserted over
  // HTTP against a real collection. The two that matter most cannot be checked any other way: that
  // a code search and a vehicle pick applied together INTERSECT, and that the totals describe the
  // whole filtered set rather than the page — which only means anything once there is more than
  // one page of it.
  describe('filtering and totals (§4.6 list)', () => {
    interface Filed {
      code: string;
      vehicleId: string;
    }
    const filed: Record<string, Filed> = {};
    const sum = { collected: 0, company: 0, paid: 0 };

    const file = async (
      code: string,
      culprit: string,
      money: { collected: number; company: number; paid: number },
      occurredAt: string,
    ): Promise<void> => {
      const v = data<FleetVehicleDto>(await createVehicle(adminToken, { code }));
      const res = await request(app)
        .post('/api/v1/fleet/accidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vehicleId: v.id,
          occurredAt,
          culprit,
          statement: `بيان ${code}`,
          companyCost: money.company,
          amountCollected: money.collected,
          paidAmount: money.paid,
        });
      expect(res.status).toBe(201);
      filed[code] = { code, vehicleId: v.id };
      sum.collected += money.collected;
      sum.company += money.company;
      sum.paid += money.paid;
    };

    const list = async (query: Record<string, unknown>): Promise<request.Response> =>
      request(app)
        .get('/api/v1/fleet/accidents')
        .query(query)
        .set('Authorization', `Bearer ${adminToken}`);

    const summary = async (query: Record<string, unknown>): Promise<request.Response> =>
      request(app)
        .get('/api/v1/fleet/accidents/summary')
        .query(query)
        .set('Authorization', `Bearer ${adminToken}`);

    /** The vehicle codes behind one filtered page, in the order the server returned them. */
    const codesOn = async (query: Record<string, unknown>): Promise<string[]> => {
      const res = await list(query);
      expect(res.status).toBe(200);
      const byId = new Map(Object.values(filed).map((f) => [f.vehicleId, f.code]));
      return data<{ vehicleId: string }[]>(res).map((a) => byId.get(a.vehicleId) ?? a.vehicleId);
    };

    beforeAll(async () => {
      // Codes chosen so "FLT21" is a strict prefix of two of them and matches nothing else, and
      // so one code carries regex punctuation.
      await file('FLT210', 'اشرف نصحى', { collected: 0, company: 350, paid: 350 }, '2026-06-08');
      await file('FLT211', 'مصطفى عثمان', { collected: 500, company: 0, paid: 0 }, '2026-03-03');
      await file('FLT350', 'اشرف نصحى', { collected: 1500, company: 0, paid: 1500 }, '2025-02-01');
      await file('FLT.99', 'احمد السيد', { collected: 400, company: 500, paid: 900 }, '2026-05-10');
    });

    it('searches by part of a CODE, which the accident itself does not store', async () => {
      expect((await codesOn({ code: 'FLT21' })).sort()).toEqual(['FLT210', 'FLT211']);
      expect(await codesOn({ code: 'FLT350' })).toEqual(['FLT350']);
    });

    it('narrows to NOTHING for a code no vehicle carries — the filter is never dropped', async () => {
      const res = await list({ code: 'NO-SUCH-CODE' });
      expect(res.status).toBe(200);
      expect(data<unknown[]>(res)).toEqual([]);
      expect((res.body as { meta: PageMeta }).meta.totalItems).toBe(0);
    });

    it('treats regex characters as TEXT — `.` is a dot, not "any character"', async () => {
      // Unescaped, `FLT.99` would also match `FLT099`-shaped codes, and `.*` would match all.
      expect(await codesOn({ code: 'FLT.99' })).toEqual(['FLT.99']);
      expect(await codesOn({ code: '.*' })).toEqual([]);
      expect(await codesOn({ code: 'FLT2.0' })).toEqual([]);
    });

    it('applies the code search and the vehicle pick TOGETHER — an AND, not a choice', async () => {
      const pinned = filed['FLT210'] as Filed;
      // Inside the swept set: the pick survives the sweep.
      expect(await codesOn({ code: 'FLT21', vehicleId: pinned.vehicleId })).toEqual(['FLT210']);
      // Outside it: two filters that cannot both hold, and the honest answer is nothing.
      expect(await codesOn({ code: 'FLT350', vehicleId: pinned.vehicleId })).toEqual([]);
      // Neither of which is what either filter alone would have said.
      expect((await codesOn({ code: 'FLT21' })).length).toBe(2);
      expect(await codesOn({ vehicleId: pinned.vehicleId })).toEqual(['FLT210']);
    });

    it('searches by part of the culprit’s name', async () => {
      expect((await codesOn({ culprit: 'اشرف' })).sort()).toEqual(['FLT210', 'FLT350']);
      expect(await codesOn({ culprit: 'احمد' })).toEqual(['FLT.99']);
      expect(await codesOn({ culprit: 'لا أحد بهذا الاسم' })).toEqual([]);
    });

    it('narrows by status and by the date range', async () => {
      expect((await codesOn({ status: 'open' })).length).toBeGreaterThanOrEqual(4);
      expect(await codesOn({ status: 'closed', culprit: 'اشرف' })).toEqual([]);
      expect((await codesOn({ from: '2026-01-01', culprit: 'اشرف' })).sort()).toEqual(['FLT210']);
      expect((await codesOn({ to: '2025-12-31', culprit: 'اشرف' })).sort()).toEqual(['FLT350']);
    });

    it('combines every filter at once, each one still narrowing', async () => {
      expect(
        await codesOn({
          code: 'FLT21',
          vehicleId: (filed['FLT210'] as Filed).vehicleId,
          culprit: 'اشرف',
          status: 'open',
          from: '2026-01-01',
          to: '2026-12-31',
        }),
      ).toEqual(['FLT210']);
    });

    it('sums the WHOLE filtered set — and pagination cannot move the figures', async () => {
      // The claim the strip makes. Asked for three different pages of the same search, and the
      // third asks for a page that does not exist at all.
      const scope = { culprit: 'اشرف' };
      const totals = data<{
        count: number;
        amountCollected: number;
        companyCost: number;
        paidAmount: number;
        remaining: number;
      }>(await summary(scope));
      expect(totals.count).toBe(2);
      expect(totals.amountCollected).toBe(1500);
      expect(totals.companyCost).toBe(350);
      expect(totals.paidAmount).toBe(1850);
      expect(totals.remaining).toBe(0);

      // The page really is smaller than the set — otherwise this proves nothing.
      const firstPage = await list({ ...scope, page: 1, pageSize: 1 });
      expect(data<unknown[]>(firstPage)).toHaveLength(1);
      expect((firstPage.body as { meta: PageMeta }).meta.totalItems).toBe(2);

      for (const paging of [{ page: 1, pageSize: 1 }, { page: 2, pageSize: 1 }, { page: 9 }]) {
        await list({ ...scope, ...paging });
        expect(data<unknown>(await summary(scope)), JSON.stringify(paging)).toEqual(totals);
      }
    });

    it('moves the figures when the FILTERS move', async () => {
      const wide = data<{ count: number }>(await summary({}));
      const narrow = data<{ count: number }>(await summary({ culprit: 'اشرف' }));
      expect(wide.count).toBeGreaterThan(narrow.count);
      expect(narrow.count).toBe(2);
    });

    it('REFUSES a paged summary — the sums have nowhere to put a page number', async () => {
      expect((await summary({ page: 2 })).status).toBe(400);
      expect((await summary({ pageSize: 1 })).status).toBe(400);
    });

    it('computes remaining as collected + company − paid, over the whole set', async () => {
      const all = data<{
        amountCollected: number;
        companyCost: number;
        paidAmount: number;
        remaining: number;
      }>(await summary({}));
      expect(all.remaining).toBe(all.amountCollected + all.companyCost - all.paidAmount);
      expect(Object.is(all.remaining, -0)).toBe(false);
    });

    it('needs the same grant the list needs', async () => {
      expect((await request(app).get('/api/v1/fleet/accidents/summary')).status).toBe(401);
      expect(
        (
          await request(app)
            .get('/api/v1/fleet/accidents/summary')
            .set('Authorization', `Bearer ${branchAToken}`)
        ).status,
      ).toBe(403);
    });
  });

  it('accidents and violations are their own grants — the branch operator holds none', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/accidents')
      .set('Authorization', `Bearer ${branchAToken}`);
    expect(res.status).toBe(403);
    const res2 = await request(app)
      .put('/api/v1/fleet/violations/grievance')
      .set('Authorization', `Bearer ${branchAToken}`)
      .send({ vehicleId: '64b1f0cccccccccccccccc99', year: 2026, totalBeforeGrievance: 1 });
    expect(res2.status).toBe(403);
  });
});

// ── Catalogs slice: the three new kinds, typed vehicle references, required branch,
//    the license image, and the server-side filters ─────────────────────────────────
//
// Everything below asserts the RULES, not the plumbing: that a reference must name a live item of
// the RIGHT KIND, that no path anywhere creates a branchless vehicle, that the license image obeys
// the vehicle's own grants and the file category's intake rules, and that each new filter narrows
// server-side (which is the only way a filter stays correct across pages).

/** A catalog item of one of the three new kinds, created through the real endpoint. */
const mkCatalogItem = async (
  kind: 'licenseClass' | 'operation' | 'insuranceCompany',
  ar: string,
  en: string,
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/fleet/catalog-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ kind, name: { ar, en } });
  expect(res.status).toBe(201);
  return data<FleetCatalogItemDto>(res).id;
};

/** A 1×1 PNG — a real image, so the category's mime check passes on its true bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('fleet catalogs — licence class, operation, insurance company', () => {
  it('accepts all three kinds and refuses a duplicate name within a kind', async () => {
    const created: string[] = [];
    for (const kind of ['licenseClass', 'operation', 'insuranceCompany'] as const) {
      created.push(await mkCatalogItem(kind, `${kind}-ar`, `${kind}-en`));
    }
    expect(new Set(created).size).toBe(3);

    const duplicate = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'operation', name: { ar: 'operation-ar', en: 'other' } });
    expect(duplicate.status).toBe(409);
  });

  it('the same name in a DIFFERENT kind is not a duplicate — kinds are separate vocabularies', async () => {
    await mkCatalogItem('operation', 'مشترك', 'Shared');
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'insuranceCompany', name: { ar: 'مشترك', en: 'Shared' } });
    expect(res.status).toBe(201);
  });

  it('lists each kind on its own, which is what the tabs and the selects read', async () => {
    const id = await mkCatalogItem('licenseClass', 'الثالثة', 'Third');
    const res = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'licenseClass', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const items = data<FleetCatalogItemDto[]>(res);
    expect(items.map((i) => i.id)).toContain(id);
    expect(items.every((i) => i.kind === 'licenseClass')).toBe(true);
  });

  it('archives instead of deleting — history keeps referencing the item', async () => {
    const id = await mkCatalogItem('operation', 'تشغيل قديم', 'Legacy operation');
    const res = await request(app)
      .patch(`/api/v1/fleet/catalog-items/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: 0 });
    expect(res.status).toBe(200);
    expect(data<FleetCatalogItemDto>(res).isActive).toBe(false);
  });

  it('only a workType may count for the alarm — the new kinds cannot claim it', async () => {
    const res = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'licenseClass', name: { ar: 'خطأ', en: 'Wrong' }, countsForAlarm: true });
    expect(res.status).toBe(400);
  });

  it('creating one needs fleetCatalog.manage — the branch operator holds none of the three', async () => {
    for (const kind of ['licenseClass', 'operation', 'insuranceCompany'] as const) {
      const res = await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${branchAToken}`)
        .send({ kind, name: { ar: 'ممنوع', en: 'Denied' } });
      expect(res.status, kind).toBe(403);
    }
  });
});

describe('the vehicle registry references the catalogs and always has a branch', () => {
  let licenseClassId: string;
  let operationId: string;
  let insuranceCompanyId: string;

  beforeAll(async () => {
    licenseClassId = await mkCatalogItem('licenseClass', 'الأولى', 'First');
    operationId = await mkCatalogItem('operation', 'تشغيل القاهرة', 'Cairo');
    insuranceCompanyId = await mkCatalogItem('insuranceCompany', 'مصر للتأمين', 'Misr');
  });

  it('stores all three as references and returns them on the DTO', async () => {
    const res = await createVehicle(adminToken, {
      licenseClassId,
      operationId,
      insuranceCompanyId,
    });
    expect(res.status).toBe(201);
    const v = data<FleetVehicleDto>(res);
    expect(v.licenseClassId).toBe(licenseClassId);
    expect(v.operationId).toBe(operationId);
    expect(v.insuranceCompanyId).toBe(insuranceCompanyId);
    // The legacy free-text field is gone from the wire entirely.
    expect(v).not.toHaveProperty('licenseClass');
  });

  it('refuses a reference of the WRONG KIND, even though the id is a real catalog item', async () => {
    const res = await createVehicle(adminToken, { licenseClassId: operationId });
    expect(res.status).toBe(400);
  });

  it('refuses a reference to an ARCHIVED item', async () => {
    const archived = await mkCatalogItem('insuranceCompany', 'شركة منتهية', 'Closed insurer');
    await request(app)
      .patch(`/api/v1/fleet/catalog-items/${archived}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: 0 });
    const res = await createVehicle(adminToken, { insuranceCompanyId: archived });
    expect(res.status).toBe(400);
  });

  it('refuses a reference to an id that names nothing', async () => {
    const res = await createVehicle(adminToken, {
      operationId: '64b1f0cccccccccccccccc01',
    });
    expect(res.status).toBe(400);
  });

  it('leaves all three null when they are not supplied — they are optional facts', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect(v.licenseClassId).toBeNull();
    expect(v.operationId).toBeNull();
    expect(v.insuranceCompanyId).toBeNull();
  });

  it('clears a reference when it is explicitly sent as null', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken, { operationId }));
    const res = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ operationId: null, version: v.version });
    expect(res.status).toBe(200);
    expect(data<FleetVehicleDto>(res).operationId).toBeNull();
  });

  it('REFUSES a vehicle with no branch — the API, not just the form', async () => {
    const n = vehicleCounter++;
    const res = await request(app)
      .post('/api/v1/fleet/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `V${n}`,
        typeId,
        plateNumber: `س ص ${n}`,
        chassisNumber: `CH-${n}`,
        motorNumber: `MO-${n}`,
        joinedAt: '2024-01-01T00:00:00.000Z',
        licenseExpiresAt: '2027-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('refuses an explicit null branch just as firmly', async () => {
    const res = await createVehicle(adminToken, { branchId: null });
    expect(res.status).toBe(400);
  });

  it('refuses a branch id that names no branch', async () => {
    const res = await createVehicle(adminToken, { branchId: '64b1f0cccccccccccccccc02' });
    expect(res.status).toBe(400);
  });

  it('refuses to null a branch on UPDATE — a vehicle cannot become branchless later', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ branchId: null, version: v.version });
    expect(res.status).toBe(400);
  });

  it('answers the create form with the default branch, resolved by NAME from live data', async () => {
    // The setting's default is «المهندسين»; this environment has no such branch, so the honest
    // answer is null plus the name that was looked for — never a guessed id.
    const res = await request(app)
      .get('/api/v1/fleet/vehicles/default-branch')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const before = data<{ branchId: string | null; configuredName: string }>(res);
    expect(before.configuredName).toBe('المهندسين');
    expect(before.branchId).toBeNull();

    // Point the setting at a branch that DOES exist, and the same endpoint resolves it.
    // A REAL user id: the settings write stamps `updatedBy` as an ObjectId, so a placeholder
    // string fails inside BSON rather than in anything this test is about.
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
      key: FleetSettingKeys.DefaultBranchName,
      scope: 'organization',
      value: 'Branch A',
    });
    const after = await request(app)
      .get('/api/v1/fleet/vehicles/default-branch')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<{ branchId: string | null }>(after).branchId).toBe(branchAId);

    // Put it back: this is an ORGANIZATION setting, so leaving it pointed at Branch A would make
    // every later test in this file depend on the order this one happened to run in.
    await settingsService.set(ctx, {
      key: FleetSettingKeys.DefaultBranchName,
      scope: 'organization',
      value: 'المهندسين',
    });
  });
});

describe('the vehicle license image', () => {
  const upload = (vehicleId: string, token: string, body: Buffer, name = 'license.png') =>
    request(app)
      .post(`/api/v1/fleet/vehicles/${vehicleId}/license-image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, name);

  it('uploads, links the file to the vehicle, and publishes the fact', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await upload(v.id, adminToken, PNG);
    expect(res.status).toBe(200);
    const updated = data<FleetVehicleDto>(res);
    expect(updated.licenseImage).not.toBeNull();
    expect(updated.licenseImage?.mime).toBe('image/png');
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.VehicleLicenseImageUploaded &&
          (e.payload as { vehicleId: string }).vehicleId === v.id,
      ),
    );
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.VehicleLicenseImageUploaded &&
          (e.payload as { vehicleId: string }).vehicleId === v.id,
      ),
    ).toBe(true);
  });

  it('serves the bytes with the stored content type', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await upload(v.id, adminToken, PNG);
    const res = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Private document: no shared cache may keep it.
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('404s for a vehicle that has no image — absent is absent, not an empty body', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('REJECTS a non-image: the file category is the authority, and it allows images only', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('%PDF-1.4 not an image'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(422);
    const after = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetVehicleDto>(after).licenseImage).toBeNull();
  });

  it('REJECTS an oversized image — the category caps it at 10 MB', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 1), {
        filename: 'huge.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(422);
  });

  it('refuses an upload with no file part instead of crashing on it', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .post(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('a second upload REPLACES the scan — one current licence per vehicle', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const first = data<FleetVehicleDto>(await upload(v.id, adminToken, PNG));
    const second = data<FleetVehicleDto>(await upload(v.id, adminToken, PNG, 'newer.png'));
    expect(second.licenseImage).not.toBeNull();
    expect(second.licenseImage?.fileName).toBe('newer.png');
    // Same file GROUP (replace, not a new attachment), so the previous version is retrievable.
    expect(first.licenseImage?.fileId).toBeDefined();
  });

  it('deletes the image, keeps the VEHICLE, and publishes the removal', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    await upload(v.id, adminToken, PNG);
    const res = await request(app)
      .delete(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetVehicleDto>(res).licenseImage).toBeNull();

    const still = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(still.status).toBe(200);
    expect(data<FleetVehicleDto>(still).code).toBe(v.code);

    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.VehicleLicenseImageDeleted &&
          (e.payload as { vehicleId: string }).vehicleId === v.id,
      ),
    );
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.VehicleLicenseImageDeleted &&
          (e.payload as { vehicleId: string }).vehicleId === v.id,
      ),
    ).toBe(true);
  });

  it('refuses to delete when there is nothing to delete', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    const res = await request(app)
      .delete(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('the FLEET grants alone are enough to read it — no platform file permission needed (§13)', async () => {
    // The branch operator holds the five fleetVehicle.* grants and NOTHING from the platform file
    // surface — no `file.view`, no `file.download`. That is the shape a real fleet role has, and
    // it must be able to see the image of a vehicle it owns; going through the generic download
    // path would 403 here for exactly the people the document belongs to.
    const v = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchAId }));
    await upload(v.id, adminToken, PNG);
    const res = await request(app)
      .get(`/api/v1/fleet/vehicles/${v.id}/license-image`)
      .set('Authorization', `Bearer ${branchAToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it('a reader may see the image but not change it — the vehicle grants govern (§13)', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchAId }));
    await upload(v.id, adminToken, PNG);
    // The branch operator holds fleetVehicle.view AND .edit, so it may do both here…
    expect((await upload(v.id, branchAToken, PNG)).status).toBe(200);
    // …but a vehicle OUTSIDE its branch scope is unreachable by either verb.
    const other = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchBId }));
    await upload(other.id, adminToken, PNG);
    expect(
      (
        await request(app)
          .get(`/api/v1/fleet/vehicles/${other.id}/license-image`)
          .set('Authorization', `Bearer ${branchAToken}`)
      ).status,
    ).toBe(404);
    expect((await upload(other.id, branchAToken, PNG)).status).toBe(404);
  });

  it('the platform file endpoints stay guarded — an out-of-scope caller cannot go around Fleet', async () => {
    // ADR-023 defence in depth: knowing the FILE id must be no better than knowing the vehicle id.
    const other = data<FleetVehicleDto>(await createVehicle(adminToken, { branchId: branchBId }));
    const withImage = data<FleetVehicleDto>(await upload(other.id, adminToken, PNG));
    const fileId = withImage.licenseImage?.fileId ?? '';
    expect(fileId).not.toBe('');
    for (const path of [
      `/api/v1/platform/files/${fileId}`,
      `/api/v1/platform/files/${fileId}/download`,
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${branchAToken}`);
      expect([403, 404], path).toContain(res.status);
    }
  });

  it('is refused outright without a session', async () => {
    const v = data<FleetVehicleDto>(await createVehicle(adminToken));
    expect((await request(app).get(`/api/v1/fleet/vehicles/${v.id}/license-image`)).status).toBe(
      401,
    );
  });
});

describe('the driver license image', () => {
  const upload = (driverId: string, token: string, body: Buffer, name = 'license.png') =>
    request(app)
      .post(`/api/v1/fleet/drivers/${driverId}/license-image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, name);

  const mkDriver = async (): Promise<FleetDriverProfileDto> => mkDriverProfile(await mkEmployee());

  it('uploads, links the file to the profile, and publishes the fact', async () => {
    const d = await mkDriver();
    const res = await upload(d.id, adminToken, PNG);
    expect(res.status).toBe(200);
    const updated = data<FleetDriverProfileDto>(res);
    expect(updated.licenseImage).not.toBeNull();
    expect(updated.licenseImage?.mime).toBe('image/png');
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.DriverLicenseImageUploaded &&
          (e.payload as { driverProfileId: string }).driverProfileId === d.id,
      ),
    );
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.DriverLicenseImageUploaded &&
          (e.payload as { employeeId: string }).employeeId === d.employeeId,
      ),
    ).toBe(true);
  });

  it('serves the bytes with the stored content type', async () => {
    const d = await mkDriver();
    await upload(d.id, adminToken, PNG);
    const res = await request(app)
      .get(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Private document: no shared cache may keep it.
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('404s for a driver that has no image — absent is absent, not an empty body', async () => {
    const d = await mkDriver();
    const res = await request(app)
      .get(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('REJECTS a non-image: the file category is the authority, and it allows images only', async () => {
    const d = await mkDriver();
    const res = await request(app)
      .post(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('%PDF-1.4 not an image'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(422);
    const after = await request(app)
      .get(`/api/v1/fleet/drivers/${d.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<FleetDriverProfileDto>(after).licenseImage).toBeNull();
  });

  it('refuses an upload with no file part instead of crashing on it', async () => {
    const d = await mkDriver();
    const res = await request(app)
      .post(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('REPLACES rather than accumulating — the profile points at ONE current scan', async () => {
    const d = await mkDriver();
    const first = data<FleetDriverProfileDto>(await upload(d.id, adminToken, PNG));
    const second = data<FleetDriverProfileDto>(await upload(d.id, adminToken, PNG));
    expect(second.licenseImage).not.toBeNull();
    // `fileService.replace` adds version n+1 to the SAME file group and hands back that new
    // version's id — so the link moves forward while the earlier scan survives as history. The
    // profile still holds exactly one reference, which is the invariant that matters here.
    expect(second.licenseImage?.fileId).not.toBe(first.licenseImage?.fileId);
    expect(
      (
        await request(app)
          .get(`/api/v1/fleet/drivers/${d.id}/license-image`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(200);
  });

  it('deletes the link, publishes the fact, and then has nothing to serve', async () => {
    const d = await mkDriver();
    await upload(d.id, adminToken, PNG);
    const res = await request(app)
      .delete(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetDriverProfileDto>(res).licenseImage).toBeNull();
    expect(
      (
        await request(app)
          .get(`/api/v1/fleet/drivers/${d.id}/license-image`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(404);
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.DriverLicenseImageDeleted &&
          (e.payload as { driverProfileId: string }).driverProfileId === d.id,
      ),
    );
    expect(
      seenEvents.some(
        (e) =>
          e.name === FleetEvents.DriverLicenseImageDeleted &&
          (e.payload as { fileId: string | null }).fileId === null,
      ),
    ).toBe(true);
  });

  it('refuses to delete when there is nothing to delete', async () => {
    const d = await mkDriver();
    const res = await request(app)
      .delete(`/api/v1/fleet/drivers/${d.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('leaves the licence FACTS alone when the scan goes', async () => {
    const d = await mkDriver();
    await upload(d.id, adminToken, PNG);
    const after = data<FleetDriverProfileDto>(
      await request(app)
        .delete(`/api/v1/fleet/drivers/${d.id}/license-image`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(after.licenseNumber).toBe(d.licenseNumber);
    expect(after.licenseExpiresAt).toBe(d.licenseExpiresAt);
    expect(after.specialization).toBe(d.specialization);
  });

  it('managing the scan needs fleetDriver.manage — the vehicle grants do not carry over', async () => {
    // The branch operator holds the five fleetVehicle.* grants and nothing from the driver
    // surface. Being trusted with cars is not being trusted with a person's identity document.
    const d = await mkDriver();
    expect((await upload(d.id, branchAToken, PNG)).status).toBe(403);
    await upload(d.id, adminToken, PNG);
    expect(
      (
        await request(app)
          .delete(`/api/v1/fleet/drivers/${d.id}/license-image`)
          .set('Authorization', `Bearer ${branchAToken}`)
      ).status,
    ).toBe(403);
  });

  it('the platform file endpoints stay guarded — nobody goes around Fleet (ADR-023)', async () => {
    // Knowing the FILE id must be no better than knowing the driver id: the fleet authorizer is
    // asked again on the platform's own file routes, and a caller with no fleet grant is refused.
    const d = await mkDriver();
    const withImage = data<FleetDriverProfileDto>(await upload(d.id, adminToken, PNG));
    const fileId = withImage.licenseImage?.fileId ?? '';
    expect(fileId).not.toBe('');
    const noPermToken = await login('noperm@ecms.local');
    for (const path of [
      `/api/v1/platform/files/${fileId}`,
      `/api/v1/platform/files/${fileId}/download`,
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${noPermToken}`);
      expect([403, 404], path).toContain(res.status);
    }
  });

  it('is refused outright without a session', async () => {
    const d = await mkDriver();
    expect((await request(app).get(`/api/v1/fleet/drivers/${d.id}/license-image`)).status).toBe(
      401,
    );
  });
});

describe('the drivers list filters narrow SERVER-side', () => {
  it('filters on the fleet-owned area, and on whether a scan is on file', async () => {
    const withScan = await mkDriverProfile(await mkEmployee());
    const withoutScan = await mkDriverProfile(await mkEmployee());
    const area = `AREA-${withScan.id.slice(-6)}`;
    await request(app)
      .patch(`/api/v1/fleet/drivers/${withScan.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ area, version: withScan.version });
    await request(app)
      .post(`/api/v1/fleet/drivers/${withScan.id}/license-image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, 'license.png');

    const byArea = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ area, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byArea.status).toBe(200);
    const areaIds = data<FleetDriverProfileDto[]>(byArea).map((d) => d.id);
    expect(areaIds).toContain(withScan.id);
    expect(areaIds).not.toContain(withoutScan.id);

    const withImage = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ hasLicenseImage: 'true', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    const withImageIds = data<FleetDriverProfileDto[]>(withImage).map((d) => d.id);
    expect(withImageIds).toContain(withScan.id);
    expect(withImageIds).not.toContain(withoutScan.id);

    // `$ne: null` rather than `$exists`, so a profile stored before the field existed (no key at
    // all) lands in this bucket alongside one explicitly set to null, instead of vanishing from
    // both answers. Every row here is API-created, so this asserts the null half; the absent half
    // is covered by the mapper's unit test, where a keyless row can actually be constructed.
    const withoutImage = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ hasLicenseImage: 'false', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    const withoutImageIds = data<FleetDriverProfileDto[]>(withoutImage).map((d) => d.id);
    expect(withoutImageIds).toContain(withoutScan.id);
    expect(withoutImageIds).not.toContain(withScan.id);
  });

  it('refuses a filter the list does not implement rather than ignoring it', async () => {
    // `governorate` is HR's fact. The fleet list says so with a 400 instead of accepting the
    // parameter and returning an unfiltered page — the browser is expected to ask HR and come
    // back with `employeeIds`, which is the test below.
    const res = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ governorate: 'الجيزة' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('the HR half of the drivers filter — two server-side queries, joined by id', () => {
  it('HR filters on governorate and phone, and Fleet narrows on the ids it returns', async () => {
    const marker = `G${Date.now().toString().slice(-6)}`;
    const phone = `0109${String(nidCounter).padStart(7, '0')}`;
    const targetEmployee = await mkEmployee({ governorate: marker, phone });
    const otherEmployee = await mkEmployee({ governorate: `${marker}-other` });
    const target = await mkDriverProfile(targetEmployee);
    const other = await mkDriverProfile(otherEmployee);

    // ① HR answers the HR question, on HR's own endpoint, with HR's own permission.
    const byGovernorate = await request(app)
      .get('/api/v1/hr/employees')
      .query({ governorate: marker, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byGovernorate.status).toBe(200);
    const govIds = data<{ id: string }[]>(byGovernorate).map((e) => e.id);
    expect(govIds).toContain(targetEmployee);
    // The regex is a substring match, so the deliberately-similar `${marker}-other` is included —
    // what matters is that a governorate NOT matching the term is out.
    expect(govIds).not.toContain(await mkEmployee({ governorate: 'محافظة أخرى تماما' }));

    const byPhone = await request(app)
      .get('/api/v1/hr/employees')
      .query({ phone, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byPhone.status).toBe(200);
    const phoneIds = data<{ id: string }[]>(byPhone).map((e) => e.id);
    expect(phoneIds).toEqual([targetEmployee]);

    // ② Fleet narrows on its OWN column using those ids — no query into HR anywhere.
    const drivers = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ employeeIds: targetEmployee, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(drivers.status).toBe(200);
    const ids = data<FleetDriverProfileDto[]>(drivers).map((d) => d.id);
    expect(ids).toEqual([target.id]);
    expect(ids).not.toContain(other.id);
  });

  it('HR still filters on name, code, job title and branch — nothing was reinvented', async () => {
    // Arabic LETTERS only, with no counter spliced in: `fullNameAr` is validated by `arabicName`,
    // which rejects an ASCII digit and an Arabic-Indic one alike. Every other employee in this
    // file is 'سائق اختبار', so this name is distinctive without needing to be generated.
    const name = 'سائق فريد للبحث';
    const employeeId = await mkEmployee({ fullNameAr: name });
    const byName = await request(app)
      .get('/api/v1/hr/employees')
      .query({ search: name, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<{ id: string }[]>(byName).map((e) => e.id)).toContain(employeeId);

    const byBranchAndTitle = await request(app)
      .get('/api/v1/hr/employees')
      .query({ branchId: branchAId, jobTitleId: jobTitleAId, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byBranchAndTitle.status).toBe(200);
    expect(data<{ id: string }[]>(byBranchAndTitle).map((e) => e.id)).toContain(employeeId);
  });

  it('REFUSES more ids than one HR page rather than silently keeping the first 100', async () => {
    const ids = (n: number): string =>
      Array.from({ length: n }, (_, i) => `64b1f0dddddddddddd${String(i).padStart(6, '0')}`).join(
        ',',
      );
    const ok = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ employeeIds: ids(100), pageSize: 25 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    // 101 is a 400, not a truncated `$in`: a filter that quietly drops ids returns a short list
    // that looks complete, which is the one outcome worse than refusing.
    const tooMany = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ employeeIds: ids(101), pageSize: 25 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tooMany.status).toBe(400);
  });

  it('an employeeIds filter matching nobody returns nothing, not everything', async () => {
    const res = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ employeeIds: '64b1f0dddddddddddddddd99', pageSize: 25 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetDriverProfileDto[]>(res)).toHaveLength(0);
  });
});

describe('the registry filters narrow SERVER-side', () => {
  let licenseClassId: string;
  let operationId: string;
  let insuranceCompanyId: string;
  let target: FleetVehicleDto;

  beforeAll(async () => {
    licenseClassId = await mkCatalogItem('licenseClass', 'فئة الفلترة', 'Filter class');
    operationId = await mkCatalogItem('operation', 'تشغيل الفلترة', 'Filter operation');
    insuranceCompanyId = await mkCatalogItem('insuranceCompany', 'تأمين الفلترة', 'Filter insurer');
    target = data<FleetVehicleDto>(
      await createVehicle(adminToken, {
        licenseClassId,
        operationId,
        insuranceCompanyId,
        branchId: branchBId,
      }),
    );
    // A decoy carrying none of them, so a filter that does nothing would fail below.
    await createVehicle(adminToken, { branchId: branchBId });
  });

  const list = async (query: Record<string, string>): Promise<FleetVehicleDto[]> => {
    const res = await request(app)
      .get('/api/v1/fleet/vehicles')
      .query({ pageSize: 100, ...query })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return data<FleetVehicleDto[]>(res);
  };

  it('filters by each catalog reference', async () => {
    for (const [key, value] of [
      ['licenseClassId', licenseClassId],
      ['operationId', operationId],
      ['insuranceCompanyId', insuranceCompanyId],
    ] as const) {
      const items = await list({ [key]: value });
      expect(
        items.map((v) => v.id),
        key,
      ).toEqual([target.id]);
    }
  });

  it('filters by each identifier on its own', async () => {
    for (const [key, value] of [
      ['code', target.code],
      ['plateNumber', target.plateNumber],
      ['chassisNumber', target.chassisNumber],
      ['motorNumber', target.motorNumber],
    ] as const) {
      const items = await list({ [key]: value });
      expect(
        items.map((v) => v.id),
        key,
      ).toEqual([target.id]);
    }
  });

  it('ANDs the identifier filters — two conditions narrow further, they do not widen', async () => {
    expect(
      (await list({ code: target.code, chassisNumber: target.chassisNumber })).map((v) => v.id),
    ).toEqual([target.id]);
    // A real code with someone else's chassis matches nothing, which `search` could never express.
    expect(await list({ code: target.code, chassisNumber: 'CH-NOT-A-MATCH' })).toEqual([]);
  });

  it('combines a catalog filter with a branch filter', async () => {
    expect((await list({ operationId, branchId: branchBId })).map((v) => v.id)).toEqual([
      target.id,
    ]);
    expect(await list({ operationId, branchId: branchAId })).toEqual([]);
  });

  it('treats a filter term as TEXT, not as a pattern', async () => {
    // A regex metacharacter must match literally; escaping it is what stops `.*` listing the fleet.
    expect(await list({ code: '.*' })).toEqual([]);
  });
});
