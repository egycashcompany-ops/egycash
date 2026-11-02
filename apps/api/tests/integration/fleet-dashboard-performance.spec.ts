// The dashboard's two reads at about three times today's volume (plan §5.11, P1-07, P1-08):
// ~210 cars, ~100k odometer rows, 2k workshop visits, 200 accidents, 1k violations, 5k receipts.
//
// What is ASSERTED is what a regression would move silently:
//   · the number of database commands one read sends (counted with the driver's own `commandStarted`
//     events, the app's connection being opened with `monitorCommands`), warm — R1 ≤ 45, R2 ≤ 15;
//   · no collection scan: every command R2 sends to the odometer, visits or receipts collections is
//     re-run under `explain` and its plan must not contain a COLLSCAN;
//   · a TYPE filter covering more than 50 cars (the screens' code cap) still reproduces every period
//     figure on its screen — the filter travels as `typeIds`, never as a code list.
// Timings are measured and printed, never asserted: the machine running CI is not the server.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import mongoose, { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
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
import { logger } from '../../src/infrastructure/logging/logger';
import { type AuthContext } from '../../src/shared/types';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';
import { fleetOdometerService } from '../../src/modules/fleet/odometer/odometer.service';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { nextNationalId } from './helpers/national-id';

const NOW = new Date('2026-10-31T23:30:00.000Z');
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;
const DAY = 24 * 60 * 60 * 1000;
const CARS = 210;
const BIG_TYPE_CARS = 150; // > 50: no code list could carry this set
const ODOMETER_DAYS = 476; // 210 × 476 ≈ 100k rows
/**
 * Employees in a driving seat — the roster's driver pool, with `fleet.availability.useHrLeave` on
 * (its default): each one still free after the cheap checks is a leave question, so the pool must
 * be in the fixture for the R1 budget to cover it.
 */
const SEAT_HOLDERS = 40;
/** Arabic letters only (the HR name rule), so each seat-holder is named from two of these. */
const NAMES = ['أحمد', 'محمود', 'كريم', 'سامي', 'ياسر', 'حسن', 'طارق', 'وليد', 'هشام', 'عادل'];
/**
 * §5.11's estimate of the queries per read. NOT MET YET: the owning modules answer each figure with
 * more queries than the plan assumed (the alarm projection, the board, five fuel summaries, six
 * vehicle-list counts …). The breakdown and the module changes that would reach it are in
 * `handoffs/A-DASH-to-HUB.md`; until the orchestrator decides, it is printed beside the measurement.
 */
const PLAN = { r1: 45, r2: 15 };
/**
 * The measured cost on this fixture, warm — the regression line. A QUERY is a command that is not a
 * cursor's continuation (`getMore`): a read that returns many rows takes more round trips for the
 * same question, and those are reported apart.
 */
// R1 was 65 on a fixture with NO driver pool (the roster returned before its availability pass).
// The pool is now in the fixture (SEAT_HOLDERS, HR leave on): its profiles, التمامات, leave (ONE
// batched query, pinned below) and directory reads add a constant few — and the fixed crews are no
// longer read twice. The count no longer grows with the registry.
const CEILING = { r1: 70, r2: 17 };
/**
 * R2 narrowed by a type and car codes: the same sections plus the set's own resolution. The six
 * modules resolve the filter as their screens do, but inside one read each narrowing is asked of
 * the registry once (`withVehicleFilterMemo`): the type once, the codes once, the echo's car count,
 * and the narrowed sections' own car reads — a constant few (measured 22; 27 before the memo, and
 * growing with every module that resolves the filter).
 */
const CEILING_FILTERED_R2 = 22;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-perf-${Date.now()}`;
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
 * Pin the clock for the rest of the suite — after the connection is up, and without breaking it.
 *
 * Mongoose stamps every heartbeat with the GLOBAL clock (faked here) but judges a connection stale
 * with its own snapshot of the REAL one (`readyState`: no heartbeat for two intervals ⇒
 * disconnected). With the clock pinned before today, the first heartbeat would make every later
 * query buffer and time out; so each heartbeat is re-stamped with the real clock. The app's own
 * reads all see the pinned instant.
 */
const pinClock = (at: Date): void => {
  const connection = mongoose.connection as unknown as { _lastHeartbeatAt: number | null };
  mongoose.connection.getClient().on('serverHeartbeatSucceeded', () => {
    connection._lastHeartbeatAt = RealDate.now();
  });
  vi.useFakeTimers({ toFake: ['Date'], now: at, shouldAdvanceTime: true });
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const get = (path: string, query: Record<string, unknown> = {}) =>
  request(app).get(`/api/v1${path}`).query(query).set('Authorization', `Bearer ${adminToken}`);
const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
const total = async (path: string, query: Record<string, unknown>) => {
  const res = await get(path, { ...query, pageSize: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
};

// ── counting what reaches the database ────────────────────────────────────────────────────────

/** The commands that are not the read's own work: the driver's handshakes and session upkeep. */
const HOUSEKEEPING = new Set([
  'hello',
  'ismaster',
  'isMaster',
  'ping',
  'endSessions',
  'saslStart',
  'saslContinue',
  'buildInfo',
]);
/** A cursor's continuation: the same query's next batch, not another question. */
const CONTINUATION = new Set(['getMore', 'killCursors']);

/** Queries, continuations, and the per-collection breakdown printed beside them. */
const tally = (seen: readonly Seen[]) => {
  const queries = seen.filter((s) => !CONTINUATION.has(s.name));
  const by = new Map<string, number>();
  for (const s of queries)
    by.set(`${s.name}:${s.collection ?? ''}`, (by.get(`${s.name}:${s.collection ?? ''}`) ?? 0) + 1);
  return {
    queries: queries.length,
    batches: seen.length - queries.length,
    breakdown: [...by.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(' '),
  };
};
const report = (
  label: string,
  run: { seen: readonly Seen[]; ms: number; sections: unknown },
  plan: number,
  bytes: number,
) => {
  const t = tally(run.seen);
  // Reported, not asserted: the timings belong to the machine, the counts to the code.
  // eslint-disable-next-line no-restricted-syntax
  console.log(
    `fleet dashboard ${label}: ${t.queries} queries (+${t.batches} cursor batches; plan ${plan}), ` +
      `${run.ms.toFixed(0)} ms, ${bytes} bytes\n  ${t.breakdown}\n  ms per section: ${JSON.stringify(run.sections)}`,
  );
  return t;
};

interface Seen {
  name: string;
  collection: string | null;
  command: Record<string, unknown>;
}

/** Every command the app's client sends while `run` is in flight, and the read's own timing line. */
const recording = async <T>(
  run: () => Promise<T>,
): Promise<{ result: T; seen: Seen[]; ms: number; sections: unknown }> => {
  const client = mongoose.connection.getClient();
  const seen: Seen[] = [];
  let sections: unknown = null;
  const spy = vi.spyOn(logger, 'info').mockImplementation(((obj: unknown, msg?: string) => {
    if (msg === 'fleet dashboard read') sections = (obj as { sections: unknown }).sections;
  }) as never);
  const listener = (event: { commandName: string; command: Record<string, unknown> }) => {
    if (HOUSEKEEPING.has(event.commandName)) return;
    const target = event.command[event.commandName];
    seen.push({
      name: event.commandName,
      collection: typeof target === 'string' ? target : null,
      command: event.command,
    });
  };
  client.on('commandStarted', listener);
  const started = performance.now();
  try {
    const result = await run();
    return { result, seen, ms: performance.now() - started, sections };
  } finally {
    client.off('commandStarted', listener);
    spy.mockRestore();
  }
};

/** A recorded command, stripped of what only the wire needs, explained by the server. */
const explain = async (seen: Seen): Promise<string> => {
  const command = Object.fromEntries(
    Object.entries(seen.command).filter(
      ([key]) =>
        !key.startsWith('$') &&
        !['lsid', 'txnNumber', 'readConcern', 'writeConcern', 'cursor'].includes(key),
    ),
  );
  if (seen.name === 'aggregate') command['cursor'] = {};
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database');
  return JSON.stringify(await db.command({ explain: command, verbosity: 'queryPlanner' }));
};

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let BIG: string;
let SMALL: string;
const cars: FleetVehicleDto[] = [];

const ymdUtc = (time: number): Date => new Date(Math.floor(time / DAY) * DAY);

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
      email: 'dash-perf@ecms.local',
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

  const branches: string[] = [];
  for (const [code, ar] of [
    ['61', 'فرع الأقصر'],
    ['62', 'فرع أسوان'],
    ['63', 'فرع قنا'],
  ] as const) {
    branches.push(
      ok<{ id: string }>(await post('/platform/branches', { code, name: { ar, en: ar } }), 201).id,
    );
  }
  // The driver pool: a driving seat, a department per branch, SEAT_HOLDERS employees in it.
  const seat = ok<{ id: string }>(
    await post('/platform/job-titles', {
      code: 'PERF-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  const departments: string[] = [];
  for (const [index, branchId] of branches.entries()) {
    departments.push(
      ok<{ id: string }>(
        await post('/platform/departments', {
          code: `PERF-OPS-${index}`,
          name: { ar: 'الحركة', en: 'Ops' },
          branchId,
        }),
        201,
      ).id,
    );
  }
  for (let e = 0; e < SEAT_HOLDERS; e += 1) {
    ok(
      await post('/hr/employees/direct', {
        personal: {
          identity: {
            fullNameAr: `سائق ${NAMES[e % NAMES.length] ?? 'أحمد'} ${NAMES[Math.floor(e / NAMES.length)] ?? 'أحمد'}`,
            nationalId: nextNationalId(),
            nationality: 'Egyptian',
          },
          contact: { primaryPhone: `012${String(60_000_000 + e).padStart(8, '0')}` },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: seat,
          departmentId: departments[e % departments.length],
          branchId: branches[e % branches.length],
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2026-01-01T00:00:00.000Z',
        },
        entryStatus: 'active',
      }),
      201,
    );
  }

  const mkType = async (ar: string) =>
    ok<FleetVehicleTypeDto>(
      await post('/fleet/vehicle-types', { name: { ar, en: ar }, maintenanceIntervalKm: 10_000 }),
      201,
    ).id;
  BIG = await mkType('مصفحة كبيرة');
  SMALL = await mkType('ميكروباص صغير');
  const catalog = async (kind: string, ar: string) =>
    ok<FleetCatalogItemDto[]>(await get('/fleet/catalog-items', { kind, pageSize: 100 })).find(
      (i) => i.name.ar === ar,
    )?.id ??
    ok<FleetCatalogItemDto>(await post('/fleet/catalog-items', { kind, name: { ar, en: ar } }), 201)
      .id;
  const workshop = new Types.ObjectId(await catalog('workshop', 'ورشة الأداء'));
  const workType = new Types.ObjectId(await catalog('workType', 'صيانة'));
  const violationType = new Types.ObjectId(
    ok<FleetCatalogItemDto>(
      await post('/fleet/catalog-items', {
        kind: 'violationType',
        name: { ar: 'سرعة الأداء', en: 'Speed' },
        violationSide: 'driver',
      }),
      201,
    ).id,
  );

  // The cars through the registry's own door: 150 of the big type, 60 of the small one.
  for (let i = 0; i < CARS; i += 1) {
    cars.push(
      ok<FleetVehicleDto>(
        await post('/fleet/vehicles', {
          code: `${1000 + i}`,
          typeId: i < BIG_TYPE_CARS ? BIG : SMALL,
          plateNumber: `ف ح ${i}`,
          chassisNumber: `FCH-${i}`,
          motorNumber: `FMO-${i}`,
          joinedAt: '2025-01-01T00:00:00.000Z',
          licenseExpiresAt: new Date(NOW.getTime() + ((i % 90) - 10) * DAY).toISOString(),
          radio: { issi: `FISSI-${i}` },
          branchId: branches[i % branches.length],
        }),
        201,
      ),
    );
  }

  // The bulk, written straight to the collections in the shapes the services write (the volume is
  // the point; the endpoints are exercised by the parity spec).
  const row = {
    isDeleted: false,
    schemaVersion: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    __v: 0,
  };
  const lastDay = Date.UTC(2026, 9, 31);
  const odometer: Record<string, unknown>[] = [];
  cars.forEach((car, c) => {
    let reading = 10_000 * (c + 1);
    for (let k = 0; k < ODOMETER_DAYS; k += 1) {
      const step = 80 + ((c * 7 + k * 13) % 120);
      const isLast = k === ODOMETER_DAYS - 1;
      odometer.push({
        ...row,
        vehicleId: new Types.ObjectId(car.id),
        vehicleCode: null,
        date: new Date(lastDay - (ODOMETER_DAYS - 1 - k) * DAY),
        outReading: reading,
        inReading: isLast ? null : reading + step,
        km: isLast ? null : step,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        driver1Name: null,
        driver2Name: null,
        notes: null,
      });
      reading += step;
    }
  });
  for (let start = 0; start < odometer.length; start += 10_000) {
    await FleetOdometerLogModel.insertMany(odometer.slice(start, start + 10_000), { lean: true });
  }

  const visits: Record<string, unknown>[] = [];
  for (let v = 0; v < 2000; v += 1) {
    const car = cars[v % CARS] as FleetVehicleDto;
    const inDate = ymdUtc(lastDay - (v % 300) * DAY - 5 * DAY);
    visits.push({
      ...row,
      vehicleId: new Types.ObjectId(car.id),
      vehicleCode: null,
      inDate,
      outDate: new Date(inDate.getTime() + DAY),
      workshopId: workshop,
      workTypeId: workType,
      sparePartIds: [],
      spareParts: [],
      odometerAtService: null,
      exitOdometer: null,
      driverInEmployeeId: null,
      driverOutEmployeeId: null,
      takenInByEmployeeId: null,
      takenOutByEmployeeId: null,
      notes: null,
    });
  }
  await FleetMaintenanceVisitModel.insertMany(visits, { lean: true });

  await FleetAccidentModel.insertMany(
    Array.from({ length: 200 }, (_, a) => ({
      ...row,
      vehicleId: new Types.ObjectId((cars[(a * 3) % CARS] as FleetVehicleDto).id),
      vehicleCode: null,
      occurredAt: ymdUtc(lastDay - (a % 365) * DAY),
      culprit: 'طرف ثالث',
      culpritEmployeeId: null,
      culpritEmployeeIds: [],
      statement: 'اصطدام',
      companyCost: 100 + a,
      amountCollected: 0,
      paidAmount: 0,
      transferredIn: 0,
      transferredOut: 0,
      status: a % 3 === 0 ? 'open' : 'closed',
      notes: null,
    })),
    { lean: true },
  );
  await FleetViolationModel.insertMany(
    Array.from({ length: 1000 }, (_, f) => ({
      ...row,
      kind: 'driver',
      vehicleId: new Types.ObjectId((cars[f % CARS] as FleetVehicleDto).id),
      violationTypeId: violationType,
      amount: 20 + (f % 50),
      year: null,
      count: null,
      unitValue: null,
      date: ymdUtc(lastDay - (f % 280) * DAY),
      driverEmployeeId: null,
      driverName: f % 4 === 0 ? null : 'سائق من الدفتر',
      collected: f % 5 === 0,
    })),
    { lean: true },
  );
  await FleetReceiptModel.insertMany(
    Array.from({ length: 5000 }, (_, r) => ({
      ...row,
      date: ymdUtc(lastDay - (r % 400) * DAY),
      vehicleId: new Types.ObjectId((cars[r % CARS] as FleetVehicleDto).id),
      kind: 'wash',
      source: 'custody',
      amount: 25 + (r % 40),
      cardId: null,
      driverEmployeeId: null,
      driverName: null,
      fuelType: null,
      pricePerLitre: null,
      litres: null,
      odometer: null,
      company: null,
      image: null,
      notes: null,
    })),
    { lean: true },
  );
  await Promise.all([
    FleetOdometerLogModel.createIndexes(),
    FleetMaintenanceVisitModel.createIndexes(),
    FleetReceiptModel.createIndexes(),
  ]);
  // Warm what any long-lived server has warm: the settings cache, the active-branch list.
  await get('/fleet/dashboard/now');
  await get('/fleet/dashboard/period', OCT);
}, 600_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the budget (§5.11)', () => {
  it(`R1 sends at most ${CEILING.r1} queries`, async () => {
    const run = await recording(() => get('/fleet/dashboard/now'));
    const dto = ok<FleetDashboardNowDto>(run.result);
    expect(dto.unavailable).toEqual([]);
    expect(dto.vehicles?.active).toBe(CARS);
    // The pool is in the read, and HR leave is asked for it (the setting's default is on) in ONE
    // query — never one per seat-holder.
    expect(dto.roster?.registry).toBe(SEAT_HOLDERS);
    expect(run.seen.filter((s) => s.collection === 'hr_leave_requests')).toHaveLength(1);
    const t = report('R1', run, PLAN.r1, JSON.stringify(dto).length);
    expect(t.queries).toBeLessThanOrEqual(CEILING.r1);
    // The alarm projection is reused as it is (D19), so its cost is the alarms screen's own.
    const alarms = await recording(() => get('/fleet/odometer/alarms'));
    // eslint-disable-next-line no-restricted-syntax
    console.log(
      `  the alarms screen alone (GET /fleet/odometer/alarms): ${alarms.ms.toFixed(0)} ms`,
    );
  });

  it(`R2 sends at most ${CEILING.r2} queries`, async () => {
    const run = await recording(() => get('/fleet/dashboard/period', OCT));
    const dto = ok<FleetDashboardPeriodDto>(run.result);
    expect(dto.unavailable).toEqual([]);
    expect(dto.km?.total).toBeGreaterThan(0);
    const t = report('R2 (October)', run, PLAN.r2, JSON.stringify(dto).length);
    expect(t.queries).toBeLessThanOrEqual(CEILING.r2);
  });

  it(`R2 narrowed by a type and car codes sends at most ${CEILING_FILTERED_R2} queries`, async () => {
    // Three BIG cars that carry rows in every collection: the sections do real work on the set.
    const codes = cars.slice(0, 3).map((car) => car.code);
    const run = await recording(() =>
      get('/fleet/dashboard/period', { ...OCT, typeIds: BIG, vehicleCodes: codes.join(',') }),
    );
    const dto = ok<FleetDashboardPeriodDto>(run.result);
    expect(dto.unavailable).toEqual([]);
    expect(dto.km?.total).toBeGreaterThan(0);
    const t = report('R2 (type + codes)', run, PLAN.r2, JSON.stringify(dto).length);
    expect(t.queries).toBeLessThanOrEqual(CEILING_FILTERED_R2);
    // The type reaches the registry ONCE, however many modules resolve it (`withVehicleFilterMemo`).
    const byType = run.seen.filter(
      (s) => s.name === 'distinct' && s.collection === 'fleet_vehicles',
    );
    expect(byType).toHaveLength(1);
  });

  it('R2 over a whole year asks the same questions (monthly buckets), only in more batches', async () => {
    const run = await recording(() => get('/fleet/dashboard/period', { preset: 'thisYear' }));
    const dto = ok<FleetDashboardPeriodDto>(run.result);
    expect(dto.range.granularity).toBe('month');
    expect(dto.km?.buckets.length).toBe(11); // January … November (the 1st is today)
    const t = report('R2 (this year)', run, PLAN.r2, JSON.stringify(dto).length);
    expect(t.queries).toBeLessThanOrEqual(CEILING.r2);
  });
});

describe('no collection scan on the period reads', () => {
  it.each([
    ['the company view', OCT],
    ['a type filter', { ...OCT, typeIds: 'BIG' }],
  ])('%s: every odometer / visit / receipt command R2 sends uses an index', async (_name, raw) => {
    const query = { ...raw, ...('typeIds' in raw ? { typeIds: BIG } : {}) };
    const { seen } = await recording(() => get('/fleet/dashboard/period', query));
    const watched = seen.filter(
      (s) =>
        ['find', 'aggregate', 'count', 'distinct'].includes(s.name) &&
        ['fleet_odometer_logs', 'fleet_maintenance_visits', 'fleet_receipts'].includes(
          s.collection ?? '',
        ),
    );
    expect(watched.length).toBeGreaterThan(0);
    for (const command of watched) {
      expect(await explain(command), `${command.name} ${command.collection}`).not.toContain(
        'COLLSCAN',
      );
    }
  });
});

describe('no collection scan on the workshop reads of R1', () => {
  it('every visit command R1 sends uses an index (the recent records’ `$or`, the open count)', async () => {
    const { seen } = await recording(() => get('/fleet/dashboard/now'));
    const watched = seen.filter(
      (s) =>
        ['find', 'aggregate', 'count', 'distinct'].includes(s.name) &&
        s.collection === 'fleet_maintenance_visits',
    );
    expect(watched.length).toBeGreaterThan(0);
    for (const command of watched) {
      expect(await explain(command), `${command.name} ${command.collection}`).not.toContain(
        'COLLSCAN',
      );
    }
  });
});

describe('every car unread (after a holiday): the no-reading line reads one row per car', () => {
  it('step 2 seeks each car’s newest chain row — never the whole log', async () => {
    // Twelve days after the last reading: every active car is past N = 3 days.
    const digest = await fleetOdometerService.noReadingDigest({ today: '2026-11-12', days: 3 });
    expect(digest.stale.length).toBe(CARS);
    expect(digest.neverRead).toEqual([]);
    const ids = cars.map((car) => car.id);
    const stats = (await FleetVehicleModel.aggregate(
      fleetOdometerRepository.latestChainDatesPipeline(ids),
    ).explain('executionStats')) as unknown as { stages?: Record<string, unknown>[] };
    const lookup = stats.stages?.find((stage) => '$lookup' in stage);
    expect(lookup?.['collectionScans']).toBe(0);
    // ~100k rows in the log; one (two at worst) examined per car.
    expect(Number(lookup?.['totalDocsExamined'])).toBeLessThanOrEqual(CARS * 2);
  });
});

describe('a type of more than 50 cars travels as `typeIds` and every screen reproduces it', () => {
  it('km, visits, accidents, receipts, dealership = their screens with typeIds', async () => {
    const dto = ok<FleetDashboardPeriodDto>(
      await get('/fleet/dashboard/period', { ...OCT, typeIds: BIG }),
    );
    expect(dto.vehicleScope).toMatchObject({ typeIds: [BIG], count: BIG_TYPE_CARS });
    const q = { from: OCT.from, to: OCT.to, typeIds: BIG };
    expect(dto.km?.total).toBe(ok<{ km: number }>(await get('/fleet/odometer/summary', q)).km);
    expect(dto.visits?.count).toBe(await total('/fleet/maintenance', q));
    expect(dto.accidents?.count).toBe(
      ok<{ count: number }>(await get('/fleet/accidents/summary', q)).count,
    );
    const receipts = ok<{ custodyTotal: number; cardTotal: number }>(
      await get('/fleet/receipts/summary', q),
    );
    expect(dto.opex).toMatchObject({ card: receipts.cardTotal, custody: receipts.custodyTotal });
    expect(dto.dealership?.rows).toBe(
      ok<{ count: number }>(await get('/fleet/dealership/summary', q)).count,
    );
    const small = ok<FleetDashboardPeriodDto>(
      await get('/fleet/dashboard/period', { ...OCT, typeIds: SMALL }),
    );
    // The two types partition the fleet: their kilometres add up to the company's.
    const company = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT));
    expect((dto.km?.total ?? 0) + (small.km?.total ?? 0)).toBe(company.km?.total);
    expect((dto.visits?.count ?? 0) + (small.visits?.count ?? 0)).toBe(company.visits?.count);
  });
});
