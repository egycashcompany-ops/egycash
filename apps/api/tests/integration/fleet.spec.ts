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
