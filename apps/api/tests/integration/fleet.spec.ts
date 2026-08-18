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
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDriverProfileDto,
  type FleetDriverUnavailabilityDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import {
  licenseExpirySweep,
  maintenanceAlarmSweep,
} from '../../src/modules/fleet/sweeps/fleet-sweeps';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { driverAvailabilityOn } from '../../src/modules/fleet/availability/driver-availability';
import { registerLeaveLookup } from '../../src/platform/directory';
import { emit, subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

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
      });
    expect(second.status).toBe(409);

    const visitDto = data<{ id: string; version: number }>(visit);
    const out = await request(app)
      .post(`/api/v1/fleet/maintenance/${visitDto.id}/check-out`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outDate: '2026-07-03', version: visitDto.version });
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
        }),
    );
    await request(app)
      .post(`/api/v1/fleet/maintenance/${visit.id}/check-out`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outDate: '2026-07-02', version: visit.version });

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

describe('daily duty roster (§4.5, FR-5/6/7 — FL-5)', () => {
  interface BoardDto {
    changedCount?: number;
    rows: {
      vehicleId: string;
      inMaintenance: boolean;
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
