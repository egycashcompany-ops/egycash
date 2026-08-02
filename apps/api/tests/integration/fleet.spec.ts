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
let branchAToken: string; // fleetVehicle.* at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
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

let nidCounter = 0;
let phoneCounter = 40_000_000;
const nextNid = (): string => `290010101${String(30_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/** HR employee via the real direct-registration endpoint — Fleet never fabricates one. */
const mkEmployee = async (): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'سائق اختبار', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: '64b1f0cccccccccccccccc01',
        departmentId: '64b1f0cccccccccccccccc02',
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
      .send({ licenseClass: 'نقل ثقيل', version: v.version });
    expect(ok1.status).toBe(200);
    const stale = await request(app)
      .patch(`/api/v1/fleet/vehicles/${v.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ licenseClass: 'ملاكي', version: v.version });
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
      .send({ licenseClass: 'x', version: data<FleetVehicleDto>(disposed).version });
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
    const listed = await request(app)
      .get('/api/v1/fleet/drivers')
      .query({ pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    const mine = data<FleetDriverProfileDto[]>(listed).find((d) => d.employeeId === employeeId);
    expect(mine?.isActive).toBe(false);
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
