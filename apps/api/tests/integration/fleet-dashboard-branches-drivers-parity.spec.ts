// «توزيع السيارات» and «الحركة اليوم» against the screens, on the branches and the drivers (audit
// D11, D12, D13, D19, D36).
//
// One world, written through the real endpoints with the clock PINNED at 2026-10-31T23:30Z — Cairo's
// 2026-11-01. It carries what the audit found the dashboard counting apart from the screens:
//   · a branch DELETED while one of its cars stays active (B4), a branch CLOSED while it holds an
//     active car (B5), an open branch with no car (B3) and a closed branch with no car (B6) — every
//     active car must be drawn in a column (the deleted branch's named «—», as the vehicles list
//     prints its «الفرع»), and a closed, empty branch is no card;
//   · drivers classified by the catalog, by the old enum only («cashTransport», «both») and not at
//     all — the cash / ATM figures are the drivers list `?specializationId=` opens, and the old enum
//     is counted apart;
//   · a driver on ANOTHER branch's standing crew (dF on the B2 car 911) — he is on that car in the
//     company view, under B1 and under B2 alike, so «بلا سيارة» does not move with the branch;
//   · an absent driver whose standing car went OUT OF SERVICE (dL, 917) — «الغائبون اليوم» names no
//     car the «الطقم الثابت» board does not list — beside one whose standing car is active (dM, 914).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardNowDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import mongoose, { Types } from 'mongoose';
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
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetDriverProfileModel } from '../../src/modules/fleet/driver-profiles/driver-profile.model';
import { nextNationalId } from './helpers/national-id';

/** Cairo's 2026-11-01, 01:30 — the UTC date is still the 31st (R-01). */
const NOW = new Date('2026-10-31T23:30:00.000Z');
const TODAY = '2026-11-01';
const UNNAMED = { ar: '—', en: '—' };

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-branches-drivers-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** The real clock, captured before the fake one is installed. */
const RealDate = globalThis.Date;

/**
 * Pin the clock after the connection is up, re-stamping each heartbeat with the real clock so the
 * connection is never judged stale (see fleet-dashboard-parity.spec.ts).
 */
const pinClock = (at: Date): void => {
  const connection = mongoose.connection as unknown as { _lastHeartbeatAt: number | null };
  mongoose.connection.getClient().on('serverHeartbeatSucceeded', () => {
    connection._lastHeartbeatAt = RealDate.now();
  });
  vi.useFakeTimers({ toFake: ['Date'], now: at, shouldAdvanceTime: true });
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const get = (path: string, query: Record<string, unknown> = {}, branch?: string) => {
  const req = request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Authorization', `Bearer ${adminToken}`);
  return branch === undefined ? req : req.set('X-Active-Branch', branch);
};
const send = (
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
/** A list screen's `meta.totalItems` for the link's own query. */
const total = async (path: string, query: Record<string, unknown>, branch?: string) => {
  const res = await get(path, { ...query, pageSize: 1 }, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
};
const csv = (ids: readonly string[]) => ids.join(',');

let B1: string;
let B2: string;
let B3: string;
let B4: string;
let B5: string;
let B6: string;
let T1: string;
let T2: string;
let jobTitleId: string;
const departments = new Map<string, string>();
let counter = 0;
const NAMES = ['أحمد', 'محمود', 'كريم', 'سامي', 'ياسر', 'حسن', 'طارق', 'وليد', 'هشام', 'عادل'];

let dF: string;
let dL: string;
let dM: string;
let v911: FleetVehicleDto;
let v914: FleetVehicleDto;
let v917: FleetVehicleDto;
let deleteB4Status = 0;

const mkCatalog = async (kind: string, ar: string): Promise<string> => {
  const seeded = ok<FleetCatalogItemDto[]>(
    await get('/fleet/catalog-items', { kind, pageSize: 100 }),
  ).find((item) => item.name.ar === ar);
  if (seeded !== undefined) return seeded.id;
  return ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', { kind, name: { ar, en: ar } }),
    201,
  ).id;
};

const mkVehicle = async (code: string, over: Record<string, unknown> = {}) => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await send('post', '/fleet/vehicles', {
      code,
      typeId: T1,
      plateNumber: `ف ر ${counter}`,
      chassisNumber: `BDCH-${counter}`,
      motorNumber: `BDMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `BDISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};

const outOfService = async (car: FleetVehicleDto) => {
  const now = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${car.id}`));
  ok(
    await send('post', `/fleet/vehicles/${car.id}/status`, {
      status: 'outOfService',
      reason: 'عطل',
      version: now.version,
    }),
  );
};

const mkEmployee = async (branchId: string): Promise<string> => {
  counter += 1;
  const res = await send('post', '/hr/employees/direct', {
    personal: {
      identity: {
        fullNameAr: `سائق ${NAMES[counter % NAMES.length] ?? 'أحمد'} ${NAMES[(counter + 3) % NAMES.length] ?? 'حسن'}`,
        nationalId: nextNationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `012${String(70_000_000 + counter).padStart(8, '0')}` },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId,
      departmentId: departments.get(branchId),
      branchId,
      employmentType: 'fullTime',
      probationMonths: 0,
      startDate: '2026-01-01T00:00:00.000Z',
    },
    entryStatus: 'active',
  });
  return ok<{ id: string }>(res, 201).id;
};

/** A seat-holder in `branchId` (HR), with a profile unless `profile` is null. */
const mkDriver = async (
  branchId: string,
  profile: { specializationId?: string } | null = {},
): Promise<string> => {
  const employeeId = await mkEmployee(branchId);
  if (profile !== null) {
    counter += 1;
    ok(
      await send('post', '/fleet/drivers', {
        employeeId,
        licenseNumber: `BD-${counter}`,
        licenseExpiresAt: '2027-06-30',
        ...profile,
      }),
      201,
    );
  }
  return employeeId;
};

/** A profile classified by the OLD enum only (the go-live migration leaves `both` like this). */
const legacyOnly = (employeeId: string, specialization: 'cashTransport' | 'atm' | 'both') =>
  FleetDriverProfileModel.updateOne(
    { employeeId: new Types.ObjectId(employeeId) },
    { $set: { specializationId: null, specialization } },
  );

const closeBranch = async (id: string): Promise<void> => {
  const current = ok<{ version: number }>(await get(`/platform/branches/${id}`));
  ok(
    await send('patch', `/platform/branches/${id}`, {
      status: 'inactive',
      version: current.version,
    }),
  );
};

const nowOf = async (branch?: string) =>
  ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now', {}, branch));
const boardOf = async (branch?: string) =>
  ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }, branch));

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  pinClock(NOW);
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'fleet-dash-branches-drivers@ecms.local',
      firstName: { ar: 'مدير', en: 'Admin' },
      lastName: { ar: 'الحركة', en: 'Fleet' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const adminId = String(user._id);
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
  adminToken = await authService.signAccessToken(adminId, new Types.ObjectId().toString(), 0);

  const mkBranch = async (code: string, ar: string) =>
    ok<{ id: string }>(
      await send('post', '/platform/branches', { code, name: { ar, en: ar } }),
      201,
    ).id;
  B1 = await mkBranch('91', 'فرع أ');
  B2 = await mkBranch('92', 'فرع ب');
  B3 = await mkBranch('93', 'فرع ج');
  B4 = await mkBranch('94', 'فرع د');
  B5 = await mkBranch('95', 'فرع هـ');
  B6 = await mkBranch('96', 'فرع و');
  // Departments only where people work: a branch with one cannot be deleted.
  for (const [branchId, code] of [
    [B1, 'BD-OPS-1'],
    [B2, 'BD-OPS-2'],
  ] as const) {
    departments.set(
      branchId,
      ok<{ id: string }>(
        await send('post', '/platform/departments', {
          code,
          name: { ar: 'الحركة', en: 'Ops' },
          branchId,
        }),
        201,
      ).id,
    );
  }
  jobTitleId = ok<{ id: string }>(
    await send('post', '/platform/job-titles', {
      code: 'BD-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  const mkType = async (ar: string) =>
    ok<FleetVehicleTypeDto>(
      await send('post', '/fleet/vehicle-types', {
        name: { ar, en: ar },
        maintenanceIntervalKm: 10_000,
      }),
      201,
    ).id;
  T1 = await mkType('مصفحة');
  T2 = await mkType('ميكروباص');
  const opCash = await mkCatalog('operation', 'نقل أموال');
  const opAtm = await mkCatalog('operation', 'ATM');
  const specCash = await mkCatalog('driverSpecialization', 'نقل اموال');
  const specAtm = await mkCatalog('driverSpecialization', 'ATM');

  // ── Drivers (D13): the catalog, the old enum only, and no profile at all ───────────────────────
  await mkDriver(B1, { specializationId: specCash }); // dC1
  await mkDriver(B2, { specializationId: specCash }); // dC2
  await mkDriver(B1, { specializationId: specAtm }); // dA
  await legacyOnly(await mkDriver(B1), 'cashTransport'); // dL1 — old enum only
  await legacyOnly(await mkDriver(B2), 'both'); // dLB — old enum «both»
  await mkDriver(B1, null); // dN — a seat-holder with no profile

  // ── Cars (D11, D12) ───────────────────────────────────────────────────────────────────────────
  await mkVehicle('901', { operationId: opCash });
  await mkVehicle('902', { typeId: T2, operationId: opAtm });
  await mkVehicle('903', { branchId: B2, operationId: opCash });
  await mkVehicle('904', { branchId: B4 }); // B4 is deleted below, the car stays active
  await mkVehicle('905', { typeId: T2, branchId: B5, operationId: opCash }); // B5 closed below
  const v906 = await mkVehicle('906', { typeId: T2 });
  await FleetVehicleModel.updateOne(
    { _id: new Types.ObjectId(v906.id) },
    { $set: { branchId: null } },
  ); // an old row with no branch: «بلا فرع»
  await outOfService(await mkVehicle('907')); // not an active car: no figure here counts it

  // ── «الحركة اليوم» (D19, D36) ─────────────────────────────────────────────────────────────────
  // dF (B2) is the STANDING crew of the B2 car 911 — nobody planned the day. dP (B1) is planned on
  // the B1 car 912. dG (B1) is free; 913 (B1) is empty.
  dF = await mkDriver(B2);
  const dP = await mkDriver(B1);
  await mkDriver(B1); // dG
  v911 = await mkVehicle('911', { branchId: B2 });
  const v912 = await mkVehicle('912');
  await mkVehicle('913');
  // dL (B2) and dM (B1) are on «تمام: غير متاح» today; dL's standing car 917 goes out of service,
  // dM's 914 stays active.
  dL = await mkDriver(B2);
  dM = await mkDriver(B1);
  v914 = await mkVehicle('914');
  v917 = await mkVehicle('917', { branchId: B2 });
  ok(
    await send('post', '/fleet/fixed-roster', {
      rows: [
        { vehicleId: v911.id, driver1EmployeeId: dF, driver2EmployeeId: null },
        { vehicleId: v914.id, driver1EmployeeId: dM, driver2EmployeeId: null },
        { vehicleId: v917.id, driver1EmployeeId: dL, driver2EmployeeId: null },
      ],
    }),
  );
  ok(
    await send('post', '/fleet/roster', {
      date: TODAY,
      rows: [{ vehicleId: v912.id, driver1EmployeeId: dP, driver2EmployeeId: null }],
    }),
  );
  for (const employeeId of [dL, dM]) {
    ok(
      await send('post', '/fleet/availability', {
        employeeId,
        from: TODAY,
        to: TODAY,
        reason: 'مأمورية',
      }),
      201,
    );
  }
  await outOfService(v917);

  // ── The branches' fates (D11, D12) ────────────────────────────────────────────────────────────
  deleteB4Status = (await send('delete', `/platform/branches/${B4}`)).status;
  await closeBranch(B5);
  await closeBranch(B6);
}, 300_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«توزيع السيارات» — every active car is drawn in a column (D11, D12)', () => {
  it('the world holds what the audit found: B4 deleted with its car, B5 and B6 closed', async () => {
    expect([200, 204]).toContain(deleteB4Status);
    const live = ok<{ id: string; status: string }[]>(
      await get('/platform/branches', { pageSize: 100 }),
    );
    expect(live.some((b) => b.id === B4)).toBe(false);
    expect(live.find((b) => b.id === B5)?.status).toBe('inactive');
    // The deleted branch's car is still an active car the vehicles list counts under its id.
    expect(await total('/fleet/vehicles', { status: 'active', branchId: B4 })).toBe(1);
  });

  it('grand total = Σ drawn columns + «بلا فرع» = /fleet/vehicles?status=active', async () => {
    const dist = (await nowOf()).distributionVehicles!;
    const drawn = (counts: Record<string, number>): number =>
      dist.branches.reduce((sum, b) => sum + (counts[b.id] ?? 0), 0);
    // 901 902 912 913 914 (B1) · 903 911 (B2) · 904 (deleted B4) · 905 (closed B5) · 906 (none).
    expect(dist.totals.total).toBe(10);
    expect(dist.totals.total).toBe(await total('/fleet/vehicles', { status: 'active' }));
    expect(drawn(dist.totals.counts) + dist.totals.noBranch).toBe(dist.totals.total);
    for (const row of dist.rows) {
      expect(drawn(row.counts) + row.noBranch, row.name.ar).toBe(row.total);
    }
    // Card 1's legend «أخرى» = the cards' «أخرى» + «بلا فرع»'s: no car hides outside a card.
    const others = dist.branches.reduce((sum, b) => sum + (dist.kinds[b.id]?.other ?? 0), 0);
    expect(others + dist.noBranchKinds.other).toBe(dist.other.vehicles);
  });

  it('the deleted branch is a column and a card named «—»; its link finds its car', async () => {
    const dist = (await nowOf()).distributionVehicles!;
    const b4 = dist.branches.find((b) => b.id === B4);
    expect(b4?.name).toEqual(UNNAMED);
    expect(dist.totals.counts[B4]).toBe(1);
    expect(dist.kinds[B4]).toEqual({ cash: 0, atm: 0, other: 1 });
    expect(dist.totals.counts[B4]).toBe(
      await total('/fleet/vehicles', { status: 'active', branchId: B4 }),
    );
  });

  it('a closed branch with a car keeps its card and name; a closed, empty one has none; an open, empty one keeps «0»', async () => {
    const dist = (await nowOf()).distributionVehicles!;
    const byId = new Map(dist.branches.map((b) => [b.id, b]));
    expect(byId.get(B5)?.name.ar).toBe('فرع هـ');
    expect(dist.totals.counts[B5]).toBe(
      await total('/fleet/vehicles', { status: 'active', branchId: B5 }),
    );
    expect(byId.has(B6)).toBe(false);
    expect(Object.keys(dist.kinds)).not.toContain(B6);
    expect(byId.has(B3)).toBe(true);
    expect(dist.totals.counts[B3] ?? 0).toBe(0);
    // The overview's «فروع بها سيارات نشطة»: the drawn columns that hold a car — B1, B2, B4, B5.
    expect(dist.branchCount).toBe(
      dist.branches.filter((b) => (dist.totals.counts[b.id] ?? 0) > 0).length,
    );
    expect(dist.branchCount).toBe(4);
  });

  it('every drawn column equals its link: /fleet/vehicles?status=active&branchId=<column>', async () => {
    const dist = (await nowOf()).distributionVehicles!;
    for (const branch of dist.branches) {
      expect(dist.totals.counts[branch.id] ?? 0, branch.name.ar).toBe(
        await total('/fleet/vehicles', { status: 'active', branchId: branch.id }),
      );
    }
  });

  it('under the B1 switcher: B1 alone, every one of its cars drawn', async () => {
    const dist = (await nowOf(B1)).distributionVehicles!;
    expect(dist.branches.map((b) => b.id)).toEqual([B1]);
    expect(dist.totals.total).toBe(dist.totals.counts[B1]);
    expect(dist.totals.total).toBe(await total('/fleet/vehicles', { status: 'active' }, B1));
  });
});

describe('«نقل الأموال» / «ATM» drivers = the drivers list `?specializationId=` (D13)', () => {
  it('the company: the catalog alone; the old enum counted apart, never added in', async () => {
    const drv = (await nowOf()).distributionDrivers!;
    expect(drv.cash.drivers).toBe(
      await total('/fleet/drivers', { specializationId: csv(drv.cash.specializationIds) }),
    );
    expect(drv.atm.drivers).toBe(
      await total('/fleet/drivers', { specializationId: csv(drv.atm.specializationIds) }),
    );
    // dC1 + dC2 cash, dA ATM; the old enum: dL1 (cash) and dLB («both», on each card's line).
    expect(drv.cash).toMatchObject({ drivers: 2, legacy: 2 });
    expect(drv.atm).toMatchObject({ drivers: 1, legacy: 1 });
  });

  it('a `both` profile is on neither card: the two figures are the catalog drivers only', async () => {
    const drv = (await nowOf()).distributionDrivers!;
    const listed = ok<{ employeeId: string }[]>(
      await get('/fleet/drivers', {
        specializationId: csv([...drv.cash.specializationIds, ...drv.atm.specializationIds]),
        pageSize: 100,
      }),
    );
    expect(drv.cash.drivers + drv.atm.drivers).toBe(listed.length);
  });

  it('under B1: the figures are the list with `branchId=B1`', async () => {
    const drv = (await nowOf(B1)).distributionDrivers!;
    expect(drv.cash.drivers).toBe(
      await total('/fleet/drivers', {
        specializationId: csv(drv.cash.specializationIds),
        branchId: B1,
      }),
    );
    expect(drv.atm.drivers).toBe(
      await total('/fleet/drivers', {
        specializationId: csv(drv.atm.specializationIds),
        branchId: B1,
      }),
    );
    expect(drv.cash).toMatchObject({ drivers: 1, legacy: 1 });
    expect(drv.atm).toMatchObject({ drivers: 1, legacy: 0 });
  });
});

describe('«الحركة اليوم» — a driver on another branch’s standing crew (D19)', () => {
  it('dF sits on the B2 car 911 in the company view, under B1 and under B2', async () => {
    for (const branch of [undefined, B1, B2]) {
      const board = await boardOf(branch);
      const fd = board.availableDrivers.find((d) => d.employeeId === dF);
      expect(fd?.assignedVehicleId, branch ?? 'company').toBe(v911.id);
    }
    // The rows stay the reader's: B1's board does not list the B2 car it names.
    expect((await boardOf(B1)).rows.some((row) => row.vehicleId === v911.id)).toBe(false);
    const b2Row = (await boardOf(B2)).rows.find((row) => row.vehicleId === v911.id);
    expect(b2Row?.driver1EmployeeId).toBe(dF);
    expect(b2Row?.manned).toBe(true);
  });

  it('«بلا سيارة» is one number in every view, and the board’s own count of it', async () => {
    const seen = new Map<string, number>();
    for (const [name, branch] of [
      ['company', undefined],
      ['B1', B1],
      ['B2', B2],
    ] as const) {
      const roster = (await nowOf(branch)).roster!;
      const board = await boardOf(branch);
      const free = board.availableDrivers.filter(
        (d) => d.licence !== 'expired' && d.assignedVehicleId === null,
      ).length;
      expect(roster.availableWithoutVehicle, name).toBe(free);
      seen.set(name, roster.availableWithoutVehicle);
    }
    expect(new Set(seen.values()).size).toBe(1);
  });
});

describe('«الغائبون اليوم» — the standing car named is one the fixed board lists (D36)', () => {
  it('dL’s standing car went out of service: no car is named; dM’s active car is', async () => {
    const roster = (await nowOf()).roster!;
    const fixed = ok<{ rows: { vehicleId: string; code: string }[] }>(
      await get('/fleet/fixed-roster'),
    );
    const listed = new Set(fixed.rows.map((row) => row.vehicleId));
    expect(listed.has(v917.id)).toBe(false);
    const absentL = roster.absentDrivers.find((d) => d.employeeId === dL);
    const absentM = roster.absentDrivers.find((d) => d.employeeId === dM);
    expect(absentL).toBeDefined();
    expect(absentL?.crewVehicle).toBeNull();
    expect(absentM?.crewVehicle).toEqual({ vehicleId: v914.id, code: '914' });
    // Every car the list names is a row of the fixed board.
    for (const row of roster.absentDrivers) {
      if (row.crewVehicle !== null) expect(listed.has(row.crewVehicle.vehicleId)).toBe(true);
    }
  });
});
