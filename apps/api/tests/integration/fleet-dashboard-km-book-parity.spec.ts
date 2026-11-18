// «العدادات والكيلومترات» and «توزيع السيارات» against the odometer register (audit D20, D25, D33).
//
// One world, written through the real endpoints with the clock PINNED at 2026-10-31T23:30Z — Cairo's
// 2026-11-01. The period is October (custom 2026-10-01 … 2026-10-31). It carries what the audit found
// the km figures counting apart from the register:
//   · «790», registered AFTER the old book wrote two of its rows under that code (vehicleId null, one
//     of them stored «790 » with a trailing space): the register's code filter adds them to the car
//     (`/fleet/odometer/summary?vehicleCodes=790` = 200), so the ranking, «متوسط لكل سيارة» and
//     «غير مسجّلة» must too — while a type, operation or branch view (whose filter never reads the
//     old book) keeps them apart, and every km-by-branch column stays its register's figure (D20);
//   · «704», whose readings went backwards (50, then −100, then opened again): the car card's
//     «آخر قراءة عداد» is the NEWEST chain row — the day the dashboard's «آخر قراءة» and the register
//     name — beside the highest reading, the alarm's figure (D25);
//   · in September, a car whose branch was DELETED since: its km column keeps the branch id (its
//     register) and is named «—», never «بلا فرع» (D33); and the old book's «كوستر», a code no car of
//     the registry carries, still «غير مسجّلة».
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetOdometerLogDto,
  type FleetOdometerSummaryDto,
  type FleetVehicleDto,
  type FleetVehicleLatestReadingDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import mongoose, { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

/** Cairo's 2026-11-01, 01:30 — the UTC date is still the 31st (R-01). */
const NOW = new Date('2026-10-31T23:30:00.000Z');
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;
const SEP = { preset: 'custom', from: '2026-09-01', to: '2026-09-30' } as const;
const UNNAMED = { ar: '—', en: '—' };

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-km-book-${Date.now()}`;
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

/** The register's «إجمالي الكيلومترات» for a query, as OdometerPage sends it. */
const summary = async (
  query: Record<string, unknown>,
  branch?: string,
): Promise<FleetOdometerSummaryDto> =>
  ok<FleetOdometerSummaryDto>(await get('/fleet/odometer/summary', query, branch));
const period = async (
  query: Record<string, unknown>,
  branch?: string,
): Promise<FleetDashboardPeriodDto> =>
  ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', query, branch));
const kmOf = (dto: FleetDashboardPeriodDto) => {
  expect(dto.km).not.toBeNull();
  return dto.km as NonNullable<FleetDashboardPeriodDto['km']>;
};
/** The period's own days, as `periodLinks` carries them to the register. */
const days = (dto: FleetDashboardPeriodDto) => ({ from: dto.range.from, to: dto.range.to });

let B1: string;
let B2: string;
let B3: string;
let T1: string;
let T2: string;
let deleteB3Status = 0;
const cars: Record<string, FleetVehicleDto> = {};
let counter = 0;

const mkVehicle = async (code: string, over: Record<string, unknown> = {}) => {
  counter += 1;
  const car = ok<FleetVehicleDto>(
    await send('post', '/fleet/vehicles', {
      code,
      typeId: T1,
      plateNumber: `ك ب ${counter}`,
      chassisNumber: `KBCH-${counter}`,
      motorNumber: `KBMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `KBISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
  cars[code] = car;
  return car;
};
const read = async (vehicleId: string, date: string, reading: number) =>
  ok(await send('post', '/fleet/odometer', { vehicleId, date, reading }), 201);
const legacy = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
/** A row the API cannot write: the old book's (`vehicleId` null), or a chain that went backwards. */
const row = (
  vehicleId: string | null,
  vehicleCode: string | null,
  date: string,
  outReading: number,
  inReading: number | null,
) => ({
  ...legacy,
  vehicleId: vehicleId === null ? null : new Types.ObjectId(vehicleId),
  vehicleCode,
  date: new Date(date.length === 10 ? `${date}T00:00:00.000Z` : date),
  outReading,
  inReading,
  km: inReading === null ? null : inReading - outReading,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  driver1Name: null,
  driver2Name: null,
  notes: null,
});
const openVisit = async (vehicleId: string, inDate: string) =>
  FleetMaintenanceVisitModel.create({
    ...legacy,
    vehicleId: new Types.ObjectId(vehicleId),
    vehicleCode: null,
    inDate: new Date(`${inDate}T00:00:00.000Z`),
    outDate: null,
    workshopId: new Types.ObjectId(),
    workTypeId: new Types.ObjectId(),
  });

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
      email: 'km-book-parity@ecms.local',
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
  B1 = await mkBranch('81', 'فرع العدادات أ');
  B2 = await mkBranch('82', 'فرع العدادات ب');
  B3 = await mkBranch('83', 'فرع العدادات ج');
  const mkType = async (ar: string) =>
    ok<FleetVehicleTypeDto>(
      await send('post', '/fleet/vehicle-types', {
        name: { ar, en: ar },
        maintenanceIntervalKm: 10_000,
      }),
      201,
    ).id;
  T1 = await mkType('مصفحة الدفتر');
  T2 = await mkType('ميكروباص الدفتر');

  // ── October: the audit's world (zz-audit-km-links) ──────────────────────────────────────────
  // 701 (B1, T1): 5→6 single 100, 6→9 SPAN 300, 9→10 single 50, open on the 10th.
  const A = await mkVehicle('701');
  await read(A.id, '2026-10-05', 1000);
  await read(A.id, '2026-10-06', 1100);
  await read(A.id, '2026-10-09', 1400);
  await read(A.id, '2026-10-10', 1450);
  // 702 (B1, T2): 6→7 single 80, 7→30 SPAN 120, 30→31 single 50, open on the 31st.
  const B = await mkVehicle('702', { typeId: T2 });
  await read(B.id, '2026-10-06', 2000);
  await read(B.id, '2026-10-07', 2080);
  await read(B.id, '2026-10-30', 2200);
  await read(B.id, '2026-10-31', 2250);
  // «790» (B1, T1): 100 km on the registry's own rows, 100 km on the old book's (D20).
  const Z = await mkVehicle('790');
  await read(Z.id, '2026-10-20', 700);
  await read(Z.id, '2026-10-21', 760);
  await read(Z.id, '2026-10-22', 800);
  await FleetOdometerLogModel.create(row(null, '790', '2026-10-12', 500, 560));
  await FleetOdometerLogModel.create(row(null, '790 ', '2026-10-13', 560, 600));
  // 704 (B2, T1): a broken chain — the 14th valid 50, the 15th NEGATIVE −100, open on the 16th.
  const F = await mkVehicle('704', { branchId: B2 });
  await FleetOdometerLogModel.create(row(F.id, null, '2026-10-14', 4950, 5000));
  await FleetOdometerLogModel.create(row(F.id, null, '2026-10-15', 5000, 4900));
  await FleetOdometerLogModel.create(row(F.id, null, '2026-10-16', 4900, null));
  // 705 (B1): 10 km on the 2nd, in the workshop since the 25th.
  const D = await mkVehicle('705');
  await read(D.id, '2026-10-02', 300);
  await read(D.id, '2026-10-03', 310);
  await openVisit(D.id, '2026-10-25');
  // 706 never read; 707 never read and in the workshop since the 30th.
  await mkVehicle('706');
  const W = await mkVehicle('707');
  await openVisit(W.id, '2026-10-30');
  // 708 (B2, T2): out of service now, 50 km in October.
  const O = await mkVehicle('708', { branchId: B2, typeId: T2 });
  await read(O.id, '2026-10-08', 100);
  await read(O.id, '2026-10-09', 150);
  ok(
    await send('post', `/fleet/vehicles/${O.id}/status`, {
      status: 'outOfService',
      reason: 'عطل',
      version: ok<FleetVehicleDto>(await get(`/fleet/vehicles/${O.id}`)).version,
    }),
  );
  // 709 (B1): 300 km on the 11th, a NEGATIVE row on the 12th, then DELETED from the registry.
  const X = await mkVehicle('709');
  await FleetOdometerLogModel.create(row(X.id, null, '2026-10-11', 100, 400));
  await FleetOdometerLogModel.create(row(X.id, null, '2026-10-12', 400, 380));
  await FleetOdometerLogModel.create(row(X.id, null, '2026-10-13', 380, null));
  const del = await send('delete', `/fleet/vehicles/${X.id}`);
  expect([200, 204], JSON.stringify(del.body)).toContain(del.status);
  // 711 (B2): rows stamped off midnight around the period's edges — 2026-09-30T23:00Z (UTC Sep 30)
  // 10 km, 2026-10-31T22:30Z (UTC Oct 31) 30 km.
  const P = await mkVehicle('711', { branchId: B2 });
  await FleetOdometerLogModel.create(row(P.id, null, '2026-09-30T23:00:00.000Z', 990, 1000));
  await FleetOdometerLogModel.create(row(P.id, null, '2026-10-31T22:30:00.000Z', 1000, 1030));

  // ── September: a branch deleted since (D33), and a code no registry car carries ─────────────
  const K = await mkVehicle('712', { branchId: B3 });
  await read(K.id, '2026-09-03', 100);
  await read(K.id, '2026-09-04', 125);
  await FleetOdometerLogModel.create(row(null, 'كوستر', '2026-09-07', 500, 540));
  await FleetOdometerLogModel.create(row(null, 'كوستر', '2026-09-08', 540, null));
  deleteB3Status = (await send('delete', `/platform/branches/${B3}`)).status;
}, 300_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('D20 · the old book’s rows of «790» count for the registered car (nothing narrows)', () => {
  it('«790» = 200 = the register by its code, in «أعلى 5» and «أقل 5» — every ranked car = its `carKm`', async () => {
    const dto = await period(OCT);
    const km = kmOf(dto);
    expect(await summary({ vehicleCodes: '790', ...days(dto) })).toMatchObject({ km: 200 });
    expect(km.top5.find((r) => r.code === '790')?.km).toBe(200);
    expect(km.bottom5.find((r) => r.code === '790')?.km).toBe(200);
    // Each ranked row against the register its «فتح» opens (company view: the code and the days).
    for (const ranked of [...km.top5, ...km.bottom5]) {
      const register = await summary({ vehicleCodes: ranked.code, ...days(dto) });
      expect(ranked.km, ranked.code).toBe(register.km);
    }
  });

  it('the total = the register; «متوسط لكل سيارة» divides by the 8 cars that drove (not 9); no «غير مسجّلة»', async () => {
    const dto = await period(OCT);
    const km = kmOf(dto);
    expect(km.total).toBe(1340);
    expect(km.total).toBe((await summary(days(dto))).km);
    // 701, 702, 790, 704, 705, 708, 709 (deleted since) and 711 — «790» once.
    expect(km.perVehicleAvg).toBe(167.5);
    expect(km.unregistered).toBe(0);
    // The drawing: every column = the register over that day (confirmed + span).
    expect(km.buckets.reduce((sum, b) => sum + b.confirmedKm + b.spanKm, 0)).toBe(km.total);
  });

  it('«الكيلومترات حسب الفرع»: each column = the register with that branch; the folded book km sits in none', async () => {
    const dto = await period(OCT);
    const km = kmOf(dto);
    expect(km.byBranch.map((b) => [b.branchId, b.km])).toEqual([
      [B1, 1110],
      [B2, 130],
    ]);
    for (const column of km.byBranch) {
      expect(column.branchId).not.toBeNull();
      const register = await summary({ ...days(dto), branchIds: column.branchId as string });
      expect(column.km, String(column.branchId)).toBe(register.km);
    }
    // The register by branch never reads the old book: «790»'s 100 book km are the car's (above),
    // not B1's. Σ columns + «غير مسجّلة» = the total less those 100 km.
    const columns = km.byBranch.reduce((sum, b) => sum + b.km, 0);
    expect(columns + (km.unregistered ?? 0) + 100).toBe(km.total);
  });

  it('the book’s «790» rows are the car’s on the chart: the 13th’s span runs to the car’s next reading', async () => {
    const km = kmOf(await period(OCT));
    expect(km.buckets.find((b) => b.key === '2026-10-13')).toMatchObject({
      spanKm: 40,
      spanTo: '2026-10-20',
      spanVehicles: 1,
    });
  });

  it('picked by its code alone, «790» still carries its book rows: 200 = the register; nothing is «غير مسجّلة»', async () => {
    const dto = await period({ ...OCT, vehicleCodes: '790' });
    const km = kmOf(dto);
    expect(km.total).toBe(200);
    expect(km.total).toBe((await summary({ ...days(dto), vehicleCodes: '790' })).km);
    expect(km.top5.map((r) => [r.code, r.km])).toEqual([['790', 200]]);
    expect(km.perVehicleAvg).toBe(200);
    expect(km.unregistered).toBeNull();
  });
});

describe('D20 · a type, operation or branch view keeps the old book apart (its filter never reads it)', () => {
  it('under B1: «790» = 100 = the register with the code AND the branch (the narrowed `carKm`)', async () => {
    const dto = await period(OCT, B1);
    const km = kmOf(dto);
    expect(km.total).toBe(1110);
    expect(km.total).toBe((await summary({ ...days(dto), branchIds: B1 }, B1)).km);
    const ranked = km.top5.find((r) => r.code === '790');
    expect(ranked?.km).toBe(100);
    expect((await summary({ ...days(dto), vehicleCodes: '790', branchIds: B1 }, B1)).km).toBe(100);
    expect(km.unregistered).toBeNull();
    // By type under one branch: each column = the register with the type and the branch.
    for (const column of km.byType ?? []) {
      const register = await summary({ ...days(dto), typeIds: column.typeId, branchIds: B1 }, B1);
      expect(column.km, column.name.ar).toBe(register.km);
    }
  });

  it('by type T1: «790» = 100 = the register with the code AND the type', async () => {
    const dto = await period({ ...OCT, typeIds: T1 });
    const km = kmOf(dto);
    expect(km.top5.find((r) => r.code === '790')?.km).toBe(100);
    expect((await summary({ ...days(dto), vehicleCodes: '790', typeIds: T1 })).km).toBe(100);
    expect(km.total).toBe((await summary({ ...days(dto), typeIds: T1 })).km);
    expect(km.unregistered).toBeNull();
  });
});

describe('D25 · the car card’s «آخر قراءة عداد» is the newest chain row, beside the highest', () => {
  it('«704» went backwards: newest 4,900 on 16/10 beside the highest 5,000 on 15/10', async () => {
    const latest = ok<FleetVehicleLatestReadingDto[]>(await get('/fleet/odometer/latest-readings'));
    const f = cars['704'] as FleetVehicleDto;
    expect(latest.find((l) => l.vehicleId === f.id)).toEqual({
      vehicleId: f.id,
      latestReading: 5000,
      latestReadingAt: '2026-10-15T00:00:00.000Z',
      newest: { reading: 4900, date: '2026-10-16T00:00:00.000Z' },
    });
    // The register's newest chain row for the car — what «فتح» on its stale row opens first.
    const register = ok<FleetOdometerLogDto[]>(
      await get('/fleet/odometer', { vehicleCodes: '704', sort: 'date:desc', pageSize: 5 }),
    );
    const newestChain = register.find((r) => r.outReading !== null);
    expect([newestChain?.date.slice(0, 10), newestChain?.outReading]).toEqual(['2026-10-16', 4900]);
  });

  it('every «بلا قراءة حديثة» row’s «آخر قراءة» is its car card’s newest day', async () => {
    const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    const latest = ok<FleetVehicleLatestReadingDto[]>(await get('/fleet/odometer/latest-readings'));
    const rows = now.noReading?.staleRows ?? [];
    expect(rows.map((r) => r.code)).toContain('704');
    for (const stale of rows) {
      const card = latest.find((l) => l.vehicleId === stale.vehicleId);
      expect(card?.newest.date.slice(0, 10), stale.code).toBe(stale.lastDate);
    }
    // A healthy chain: the newest is the highest.
    const a = latest.find((l) => l.vehicleId === (cars['701'] as FleetVehicleDto).id);
    expect(a?.newest).toEqual({ reading: a?.latestReading, date: a?.latestReadingAt });
  });
});

describe('D33 · the km column of a branch deleted since', () => {
  it('keeps the branch id (its register) and is named «—»; «غير مسجّلة» keeps a code no car carries', async () => {
    expect([200, 204]).toContain(deleteB3Status);
    const dto = await period(SEP);
    const km = kmOf(dto);
    // 712 on B3 (deleted) 25 km; 711 on B2 10 km (its 2026-09-30T23:00Z row); «كوستر» 40 km.
    expect(km.total).toBe(75);
    expect(km.byBranch).toEqual([
      { branchId: B3, name: UNNAMED, km: 25 },
      { branchId: B2, name: { ar: 'فرع العدادات ب', en: 'فرع العدادات ب' }, km: 10 },
    ]);
    expect((await summary({ ...days(dto), branchIds: B3 })).km).toBe(25);
    expect(km.unregistered).toBe(40);
    expect(km.byBranch.reduce((sum, b) => sum + b.km, 0) + (km.unregistered ?? 0)).toBe(km.total);
  });
});
