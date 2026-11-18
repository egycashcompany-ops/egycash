// «في الورشة الآن» and «أكثر السيارات دخولًا للورشة» against the screens they open — the owner's
// order of 2026-11-17 («المعلومات اللى فيها هى هى اللى فى باقى الشاشه»), audit findings D06, D07
// and D20 (a), pinned on real rows written through the real endpoints:
//
//   D06 — the parts under «في الورشة الآن» add up to the headline: active + out of service +
//         «مكهنة» (a car disposed of while in the workshop) + «بلا سيارة في السجل» (a car deleted
//         while in the workshop, or an old-book visit with no registry car) = open, and open is the
//         maintenance list's `state=open&to=<today>`, for the company and for a branch.
//   D07 — a check-in recorded for TOMORROW is not in the workshop today: not counted, not a stay
//         («منذ -1 يومًا» never drawn), its car not «داخل الورشة» on the vehicles screen and ready
//         on the roster — one covering-day rule. A check-in dated Cairo today is in, though the UTC
//         day is still yesterday.
//   D20 — an old-book visit filed under a code a live car carries now is that car's in the ranking,
//         as the list's code filter shows it: «194» = 3 = `vehicleCodes=194`; a view narrowed by
//         a branch leaves the old book out on both sides and is unchanged.
//
// Clock pinned at 2026-10-31T23:30Z = Cairo 2026-11-01 01:30.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  FLEET_DASHBOARD_WORKSHOP_ROWS,
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowWorkshopDto,
  type FleetDashboardPeriodDto,
  type FleetMaintenanceVisitDto,
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
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { nextNationalId } from './helpers/national-id';

const NOW = new Date('2026-10-31T23:30:00.000Z'); // Cairo 2026-11-01 01:30
const TODAY = '2026-11-01';
const TOMORROW = '2026-11-02';
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;
/** «خرجت من الورشة» in October, as the ranking's «فتح» asks the list (EXIT day). */
const EXIT_OCT = { outFrom: '2026-10-01', outTo: '2026-10-31' } as const;
/** «في الورشة الآن» as its «فتح» asks the list: open, checked in by the end of today. */
const OPEN_TODAY = { open: true, to: TODAY } as const;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-workshop-parity-${Date.now()}`;
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
 * Pin the clock after the connection is up (see fleet-dashboard-parity.spec.ts): every heartbeat is
 * re-stamped with the real clock so the connection is never judged stale; the app reads the pin.
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
/** A list screen's `totalItems` for exactly these parameters. */
const total = async (path: string, query: Record<string, unknown>, branch?: string) => {
  const res = await get(path, { ...query, pageSize: 1 }, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
};
/** The maintenance list's rows for these parameters (one page holds them all here). */
const visits = async (query: Record<string, unknown>) =>
  ok<FleetMaintenanceVisitDto[]>(await get('/fleet/maintenance', { ...query, pageSize: 100 }));
/** The vehicles screen's registry — every status, as «الإحصائيات» reads it. */
const registry = async () =>
  ok<FleetVehicleDto[]>(
    await get('/fleet/vehicles', { page: 1, pageSize: 100, sortBy: 'code', sortDir: 'asc' }),
  );
const partsOf = (w: FleetDashboardNowWorkshopDto | null | undefined) => [
  w?.openActive,
  w?.openOutOfService,
  w?.openDisposed,
  w?.openNoCar,
];
const sumOfParts = (w: FleetDashboardNowWorkshopDto | null | undefined) =>
  (w?.openActive ?? 0) + (w?.openOutOfService ?? 0) + (w?.openDisposed ?? 0) + (w?.openNoCar ?? 0);

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
let T1: string;
let jobTitleId: string;
const departments = new Map<string, string>();
let W1: string;
let W2: string;
let WT1: string;
let WT2: string;
let driver: string;
let counter = 0;

const mkEmployee = async (branchId: string): Promise<string> => {
  counter += 1;
  const res = await send('post', '/hr/employees/direct', {
    personal: {
      identity: {
        fullNameAr: 'سائق الورشة',
        nationalId: nextNationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `012${String(72_000_000 + counter).padStart(8, '0')}` },
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
const mkCatalog = async (kind: string, ar: string) => {
  const seeded = ok<FleetCatalogItemDto[]>(
    await get('/fleet/catalog-items', { kind, pageSize: 100 }),
  ).find((item) => item.name.ar === ar);
  if (seeded !== undefined) return seeded.id;
  return ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', { kind, name: { ar, en: ar } }),
    201,
  ).id;
};
const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await send('post', '/fleet/vehicles', {
      code: `${900 + counter}`,
      typeId: T1,
      plateNumber: `و ر ${counter}`,
      chassisNumber: `WPCH-${counter}`,
      motorNumber: `WPMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `WPISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};
const checkIn = async (
  vehicleId: string,
  inDate: string,
  over: { workshopId?: string; workTypeId?: string } = {},
) =>
  ok<FleetMaintenanceVisitDto>(
    await send('post', '/fleet/maintenance', {
      vehicleId,
      inDate,
      workshopId: over.workshopId ?? W1,
      workTypeId: over.workTypeId ?? WT1,
      driverInEmployeeId: driver,
    }),
    201,
  );
const checkOut = async (visit: FleetMaintenanceVisitDto, outDate: string) =>
  ok(
    await send('post', `/fleet/maintenance/${visit.id}/check-out`, {
      outDate,
      version: visit.version,
      driverOutEmployeeId: driver,
    }),
  );
const setStatus = async (car: FleetVehicleDto, status: 'outOfService' | 'disposed') => {
  const current = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${car.id}`));
  ok(
    await send('post', `/fleet/vehicles/${car.id}/status`, {
      status,
      reason: 'عطل كبير',
      version: current.version,
    }),
  );
};
/** An old-book visit: no registry car, the code the book wrote. */
const bookVisit = async (
  code: string,
  inDate: string,
  outDate: string | null,
  workTypeId: string = WT1,
) =>
  FleetMaintenanceVisitModel.create({
    vehicleId: null,
    vehicleCode: code,
    inDate: new Date(`${inDate}T00:00:00.000Z`),
    outDate: outDate === null ? null : new Date(`${outDate}T00:00:00.000Z`),
    workshopId: new Types.ObjectId(W1),
    workTypeId: new Types.ObjectId(workTypeId),
    isDeleted: false,
    schemaVersion: 1,
    createdBy: null,
    updatedBy: null,
  });

let car194: FleetVehicleDto; // B1 — two exits of its own + one old-book exit under «194»
let car310: FleetVehicleDto; // B1 — no exit of its own; two old-book exits under «310»
let carB2: FleetVehicleDto; // B2 — one exit of its own + a LATER old-book exit under its code
let carOos: FleetVehicleDto; // B1 — in since 20 Oct, then out of service
let carDisp: FleetVehicleDto; // B1 — in since 22 Oct, then disposed of («مكهنة»)
let carAct: FleetVehicleDto; // B2 — in since 28 Oct, active
let carToday: FleetVehicleDto; // B1 — checked in TODAY (Cairo), the UTC day still yesterday
let carFut: FleetVehicleDto; // B1 — checked in for TOMORROW (accepted: 201)
let carDel: FleetVehicleDto; // B1 — in since 25 Oct, then DELETED from the registry (204)

let now: FleetDashboardNowDto;
let nowB1: FleetDashboardNowDto;
let nowB2: FleetDashboardNowDto;
let oct: FleetDashboardPeriodDto;
let octB1: FleetDashboardPeriodDto;
let octB2: FleetDashboardPeriodDto;

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
      email: 'workshop-parity@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
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
  B1 = await mkBranch('81', 'فرع الورشة أ');
  B2 = await mkBranch('82', 'فرع الورشة ب');
  for (const [branchId, code] of [
    [B1, 'WP-OPS-1'],
    [B2, 'WP-OPS-2'],
  ] as const) {
    departments.set(
      branchId,
      ok<{ id: string }>(
        await send('post', '/platform/departments', {
          code,
          name: { ar: 'الحركة', en: 'Operations' },
          branchId,
        }),
        201,
      ).id,
    );
  }
  jobTitleId = ok<{ id: string }>(
    await send('post', '/platform/job-titles', {
      code: 'WP-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  T1 = ok<FleetVehicleTypeDto>(
    await send('post', '/fleet/vehicle-types', {
      name: { ar: 'مصفحة الورشة', en: 'Workshop armoured' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;
  W1 = await mkCatalog('workshop', 'ورشة المطابقة');
  W2 = await mkCatalog('workshop', 'توكيل المطابقة');
  WT1 = await mkCatalog('workType', 'صيانة المطابقة');
  WT2 = await mkCatalog('workType', 'إصلاح المطابقة');
  driver = await mkEmployee(B1);
  ok(
    await send('post', '/fleet/drivers', {
      employeeId: driver,
      licenseNumber: 'WP-1',
      licenseExpiresAt: '2027-06-30',
    }),
    201,
  );

  // ── October exits ──
  // «194» (B1): two exits of its own; the old book filed a third under «194» (10-10 → 10-12).
  car194 = await mkVehicle({ code: '194' });
  await checkOut(await checkIn(car194.id, '2026-10-05'), '2026-10-07');
  await checkOut(
    await checkIn(car194.id, '2026-10-20', { workshopId: W2, workTypeId: WT2 }),
    '2026-10-20',
  );
  await bookVisit('194', '2026-10-10', '2026-10-12');
  // «310» (B1): no exit of its own in October; the old book has two under its code.
  car310 = await mkVehicle({ code: '310' });
  await bookVisit('310', '2026-10-03', '2026-10-04');
  await bookVisit('310', '2026-10-08', '2026-10-09');
  // B2: one exit of its own (in 15 Oct); the old book's LATER one under its code (in 27 Oct, «إصلاح»).
  carB2 = await mkVehicle({ branchId: B2 });
  await checkOut(await checkIn(carB2.id, '2026-10-15'), '2026-10-18');
  await bookVisit(carB2.code, '2026-10-27', '2026-10-28', WT2);
  // An old-book exit under a code no registry car carries.
  await bookVisit('دفتر 3', '2026-10-05', '2026-10-06');

  // ── open now ──
  carOos = await mkVehicle({});
  await checkIn(carOos.id, '2026-10-20');
  await setStatus(carOos, 'outOfService');
  carDisp = await mkVehicle({});
  await checkIn(carDisp.id, '2026-10-22');
  await setStatus(carDisp, 'disposed');
  carAct = await mkVehicle({ branchId: B2 });
  await checkIn(carAct.id, '2026-10-28');
  carToday = await mkVehicle({});
  await checkIn(carToday.id, TODAY);
  carFut = await mkVehicle({});
  // The API accepts a check-in recorded for a later day — no write is refused (read side only).
  await checkIn(carFut.id, TOMORROW);
  carDel = await mkVehicle({});
  await checkIn(carDel.id, '2026-10-25');
  expect((await send('delete', `/fleet/vehicles/${carDel.id}`)).status).toBe(204);
  // An old-book visit still open since 1 Sep («دفتر 7»).
  await bookVisit('دفتر 7', '2026-09-01', null);

  [now, nowB1, nowB2, oct, octB1, octB2] = await Promise.all([
    get('/fleet/dashboard/now').then((res) => ok<FleetDashboardNowDto>(res)),
    get('/fleet/dashboard/now', {}, B1).then((res) => ok<FleetDashboardNowDto>(res)),
    get('/fleet/dashboard/now', {}, B2).then((res) => ok<FleetDashboardNowDto>(res)),
    get('/fleet/dashboard/period', OCT).then((res) => ok<FleetDashboardPeriodDto>(res)),
    get('/fleet/dashboard/period', OCT, B1).then((res) => ok<FleetDashboardPeriodDto>(res)),
    get('/fleet/dashboard/period', OCT, B2).then((res) => ok<FleetDashboardPeriodDto>(res)),
  ]);
}, 300_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── D06 · the parts add up to the headline, and the headline is the list ─────────────────────

describe('«في الورشة الآن» — four parts that add up to the list (D06)', () => {
  it('company: open = /fleet/maintenance?state=open&to=<today>; the parts sum to it', async () => {
    const w = now.workshop;
    expect(w?.open).toBe(await total('/fleet/maintenance', OPEN_TODAY));
    // carOos, carDisp, carAct, carToday, carDel (deleted), «دفتر 7» (old book).
    expect(w?.open).toBe(6);
    // نشطة: carAct + carToday · خارج الخدمة: carOos · مكهنة: carDisp · بلا سيارة: carDel + «دفتر 7».
    expect(partsOf(w)).toEqual([2, 1, 1, 2]);
    expect(sumOfParts(w)).toBe(w?.open);
  });

  it('each branch: the same list narrowed by the branch, and the parts still add up', async () => {
    // B1 keeps the deleted car (its branch is still on file); the old book's visit has no branch.
    expect(nowB1.workshop?.open).toBe(
      await total('/fleet/maintenance', { ...OPEN_TODAY, branchIds: B1 }),
    );
    expect(partsOf(nowB1.workshop)).toEqual([1, 1, 1, 1]);
    expect(sumOfParts(nowB1.workshop)).toBe(nowB1.workshop?.open);
    expect(nowB2.workshop?.open).toBe(
      await total('/fleet/maintenance', { ...OPEN_TODAY, branchIds: B2 }),
    );
    expect(partsOf(nowB2.workshop)).toEqual([1, 0, 0, 0]);
    expect(sumOfParts(nowB2.workshop)).toBe(nowB2.workshop?.open);
  });

  it('every listed visit is in the part its car’s state on the vehicles screen names', async () => {
    // The list's rows, each placed by the registry the vehicles screen shows: a live car by its
    // status, a car the registry no longer serves — or none — under «بلا سيارة في السجل».
    const cars = new Map((await registry()).map((car) => [car.id, car]));
    const counted = { active: 0, outOfService: 0, disposed: 0, noCar: 0 };
    for (const row of await visits(OPEN_TODAY)) {
      const car = row.vehicleId === null ? undefined : cars.get(row.vehicleId);
      counted[car === undefined ? 'noCar' : car.status] += 1;
    }
    expect([counted.active, counted.outOfService, counted.disposed, counted.noCar]).toEqual(
      partsOf(now.workshop),
    );
    // The deleted car and the disposed car are where the owner was told they are.
    expect(cars.has(carDel.id)).toBe(false);
    expect(cars.get(carDisp.id)?.status).toBe('disposed');
  });

  it('«داخل الورشة» on the vehicles screen = the three parts that name a live car', async () => {
    const inWorkshop = (await registry()).filter((car) => car.inWorkshop).map((car) => car.code);
    expect(inWorkshop.sort()).toEqual(
      [carOos.code, carDisp.code, carAct.code, carToday.code].sort(),
    );
    const w = now.workshop;
    expect(inWorkshop).toHaveLength(
      (w?.openActive ?? 0) + (w?.openOutOfService ?? 0) + (w?.openDisposed ?? 0),
    );
  });
});

// ── D07 · a check-in recorded for tomorrow is not in the workshop today ──────────────────────

describe('a check-in dated tomorrow (D07)', () => {
  it('is not counted: the unbounded open list has it, the headline’s list does not', async () => {
    expect(await total('/fleet/maintenance', { open: true })).toBe((now.workshop?.open ?? 0) + 1);
    const listed = (await visits(OPEN_TODAY)).map((row) => row.vehicleId);
    expect(listed).not.toContain(carFut.id);
    expect(listed).toContain(carToday.id);
  });

  it('is not a stay: no «منذ -1 يومًا», and the stays are the list’s oldest check-ins', async () => {
    // Under B1 every open visit fits in the card: the future one would have been its last row.
    const stays = nowB1.workshop?.longest ?? [];
    expect(stays.length).toBeLessThanOrEqual(FLEET_DASHBOARD_WORKSHOP_ROWS);
    expect(stays.map((row) => row.vehicleId)).not.toContain(carFut.id);
    expect(stays.every((row) => row.days >= 0)).toBe(true);
    const listed = await visits({ ...OPEN_TODAY, branchIds: B1 });
    expect(stays.map((row) => row.visitId)).toEqual(
      [...listed]
        .sort((a, b) => a.inDate.localeCompare(b.inDate) || a.id.localeCompare(b.id))
        .slice(0, FLEET_DASHBOARD_WORKSHOP_ROWS)
        .map((row) => row.id),
    );
    // carToday checked in today: «منذ 0 يومًا» — and the company's oldest is the old book's.
    expect(stays.find((row) => row.vehicleId === carToday.id)?.days).toBe(0);
    expect(now.workshop?.oldest).toMatchObject({ code: 'دفتر 7', inDate: '2026-09-01', days: 61 });
  });

  it('its car is not «داخل الورشة»; a check-in dated Cairo today is, though UTC is a day behind', async () => {
    const fut = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${carFut.id}`));
    const today = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${carToday.id}`));
    expect([fut.inWorkshop, today.inWorkshop]).toEqual([false, true]);
    const listed = new Map((await registry()).map((car) => [car.id, car.inWorkshop]));
    expect([listed.get(carFut.id), listed.get(carToday.id)]).toEqual([false, true]);
  });

  it('the roster agrees: ready, not in the workshop — and «نشطة» = the readiness foot', async () => {
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }));
    const fut = board.rows.find((row) => row.vehicleId === carFut.id);
    expect(fut).toMatchObject({ inMaintenance: false, assignable: true });
    expect(board.rows.find((row) => row.vehicleId === carToday.id)?.inMaintenance).toBe(true);
    // One covering-day rule: the active cars the roster holds in the workshop are «نشطة».
    const rosterInWorkshop = board.rows.filter((row) => row.inMaintenance).length;
    expect(rosterInWorkshop).toBe(now.workshop?.openActive);
    expect(now.roster?.inWorkshop).toBe(now.workshop?.openActive);
  });
});

// ── D20 (a) · the old book under a live car's code, in «أكثر السيارات دخولًا للورشة» ──────────

describe('«أكثر السيارات دخولًا للورشة» — an old-book visit under a live car’s code (D20)', () => {
  const rowOf = (dto: FleetDashboardPeriodDto, car: FleetVehicleDto) =>
    dto.exits?.topVehicles.find((row) => row.vehicleId === car.id);

  it('company: «194» = 3 = /fleet/maintenance?outFrom&outTo&vehicleCodes=194', async () => {
    const row = rowOf(oct, car194);
    expect(row?.visits).toBe(3);
    expect(row?.visits).toBe(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: '194' }),
    );
    // Its latest check-in is its own (20 Oct, «إصلاح»): the book's 10 Oct is earlier.
    expect(row).toMatchObject({ lastInDate: '2026-10-20', lastWorkType: { ar: 'إصلاح المطابقة' } });
  });

  it('the book’s later check-in becomes the car’s latest: its day and its work type', async () => {
    const row = rowOf(oct, carB2);
    expect(row).toMatchObject({
      visits: 2,
      lastInDate: '2026-10-27',
      lastWorkType: { ar: 'إصلاح المطابقة' },
    });
    expect(row?.visits).toBe(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: carB2.code }),
    );
  });

  it('a live car whose October exits are all the book’s is ranked by them, as its «فتح» lists them', async () => {
    const row = rowOf(oct, car310);
    expect(row).toMatchObject({ code: '310', visits: 2, lastInDate: '2026-10-08' });
    expect(row?.visits).toBe(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: '310' }),
    );
  });

  it('every ranked row = its link; ranked + «غير مسجّلة» = every exit', async () => {
    const exits = oct.exits;
    for (const row of exits?.topVehicles ?? []) {
      expect(row.visits, row.code).toBe(
        await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: row.code }),
      );
    }
    expect(exits?.count).toBe(await total('/fleet/maintenance', EXIT_OCT));
    // Only «دفتر 3» names no live car; no deleted car left the workshop in October.
    expect(exits?.unregistered).toBe(1);
    expect(
      (exits?.topVehicles ?? []).reduce((sum, row) => sum + row.visits, 0) +
        (exits?.unregistered ?? 0),
    ).toBe(exits?.count);
  });

  it('a branch narrows the old book out on both sides: the ranking is unchanged', async () => {
    // B1: «194» = its own 2 = the list with the branch; «310» has no exit there, nor a row.
    const b1 = rowOf(octB1, car194);
    expect(b1?.visits).toBe(2);
    expect(b1?.visits).toBe(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: '194', branchIds: B1 }),
    );
    expect(rowOf(octB1, car310)).toBeUndefined();
    expect(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: '310', branchIds: B1 }),
    ).toBe(0);
    // B2: its car's own exit only, its own check-in day.
    expect(rowOf(octB2, carB2)).toMatchObject({ visits: 1, lastInDate: '2026-10-15' });
    expect(
      await total('/fleet/maintenance', { ...EXIT_OCT, vehicleCodes: carB2.code, branchIds: B2 }),
    ).toBe(1);
    expect([octB1.exits?.unregistered, octB2.exits?.unregistered]).toEqual([null, null]);
  });
});
