// The registers the dashboard's «فتح» opens, against the figures it prints — the owner's order of
// 2026-11-17 («المعلومات اللى فيها هى هى اللى فى باقى الشاشه»), audit findings D03, D05, D10, D42
// and D51, pinned on real rows read through the real endpoints:
//
//   D03 — `GET /fleet/violations` carries `meta.outstandingAmount`: the owed amount over EVERY row
//         the list's filter finds. 130 owed drivers' fines are two pages, and the drivers' footer
//         still reads the dashboard's «قائمة على السائقين» 1,588 — not the 100 rows in hand.
//   D42 — « مجهول» written with a no-break space is «مجهول» on the register's filter
//         (`unknownDriver=true`) as on the dashboard: 4 · 119.00 on both.
//   D05 — «مصروفات التراخيص» under «لم تُسوَّ» / «النوع» sums the MATCHED memos only, so the
//         custody fund's «تنتظر التسوية» parts and the register they open agree: 760 over 4,
//         renewals 650 over 2, extensions 110 over 2; «عدد المذكرات» counts memos (a record holding
//         both is two) on the register and on the licences tab alike.
//   D10 — the notices screen's «ينقصها مرفق» (`missing=any`) lists exactly the open notices the
//         dashboard's «إخطارات مفتوحة ينقصها مرفق» counts — for the company and under a branch.
//   D51 — a three-decimal line (10.005 × 3) is 30.03 on the register's strip and on the dashboard.
//
// Clock pinned at 2026-10-31T23:30Z = Cairo 2026-11-01 01:30.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  CreateFleetCustodySettlementSchema,
  CreateFleetLicenseExpenseSchema,
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetCustodySettleCandidatesDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetLicenseExpenseTotalsDto,
  type FleetNoticesSummaryDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationDto,
  type FleetViolationsListMeta,
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
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { FleetNoticeModel } from '../../src/modules/fleet/notices/notice.model';
import { fleetLicenseExpenseService } from '../../src/modules/fleet/license-expenses/license-expense.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';

const NOW = new Date('2026-10-31T23:30:00.000Z'); // Cairo 2026-11-01 01:30
const TODAY = '2026-11-01';
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;
const OCT_DAYS = { from: '2026-10-01', to: '2026-10-31' } as const;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-registers-parity-${Date.now()}`;
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
/** The violations register's page: its rows and its page block, the owed figure included. */
const violations = async (query: Record<string, unknown>) => {
  const res = await get('/fleet/violations', { pageSize: 100, ...query });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const body = res.body as { data: FleetViolationDto[]; meta: FleetViolationsListMeta };
  return { rows: body.data, meta: body.meta };
};
const piastres = (n: number): number => Math.round(n * 100);

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
let T1: string;
let vA: FleetVehicleDto;
let vB: FleetVehicleDto;
let counter = 0;
const ids: Record<string, string> = {};

const mkCatalog = async (kind: string, ar: string, extra: Record<string, unknown> = {}) => {
  const seeded = ok<FleetCatalogItemDto[]>(
    await get('/fleet/catalog-items', { kind, pageSize: 100 }),
  ).find((item) => item.name.ar === ar);
  if (seeded !== undefined) return seeded.id;
  return ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', { kind, name: { ar, en: ar }, ...extra }),
    201,
  ).id;
};

const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await send('post', '/fleet/vehicles', {
      code: `${930 + counter}`,
      typeId: T1,
      plateNumber: `س ج ${counter}`,
      chassisNumber: `RCH-${counter}`,
      motorNumber: `RMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `RISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};

/** Old-book rows written straight to the store, as the go-live import writes them. */
const LEGACY = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
let DRIVER_TYPE: string;
let COMPANY_TYPE: string;
const driverFine = (f: {
  at: string;
  amount: number;
  name?: string | null;
  employee?: boolean;
  collected?: boolean;
  deleted?: boolean;
}) => ({
  ...LEGACY,
  isDeleted: f.deleted === true,
  kind: 'driver',
  vehicleId: new Types.ObjectId(vA.id),
  vehicleCode: null,
  violationTypeId: new Types.ObjectId(DRIVER_TYPE),
  amount: f.amount,
  year: null,
  count: null,
  unitValue: null,
  date: new Date(f.at),
  driverEmployeeId: f.employee === false ? null : new Types.ObjectId(),
  driverName: f.employee === false ? (f.name ?? null) : null,
  collected: f.collected === true,
  fromOldBook: true,
});
const statement = (s: { year: number; count: number; unit: number; collected: boolean }) => ({
  ...LEGACY,
  kind: 'vehicle',
  vehicleId: new Types.ObjectId(vA.id),
  vehicleCode: null,
  violationTypeId: new Types.ObjectId(COMPANY_TYPE),
  amount: s.count * s.unit,
  year: s.year,
  count: s.count,
  unitValue: s.unit,
  date: null,
  driverEmployeeId: null,
  driverName: null,
  collected: s.collected,
  fromOldBook: true,
});

const SIGNATURES = { agent: 'أ', director: 'ب', generalManager: 'ج' };
const half = (vehicleIds: string[], lines: [number, 'visa' | 'cash', number][]) => ({
  vehicles: vehicleIds.map((vehicleId) => ({ vehicleId, plate: '' })),
  items: lines.map(([amount, paidBy, count]) => ({
    itemId: null,
    label: 'بند',
    amount,
    count,
    paidBy,
    receipt: true,
  })),
});
const licence = async (date: string, renewal: unknown, extension: unknown) =>
  (
    await fleetLicenseExpenseService.create(
      CreateFleetLicenseExpenseSchema.parse({ date, renewal, extension, signatures: SIGNATURES }),
      adminId,
    )
  ).id;

const scan = () => ({
  fileId: new Types.ObjectId(),
  fileName: 'scan.jpg',
  mime: 'image/jpeg',
  size: 10,
  uploadedAt: new Date('2026-10-20T10:00:00.000Z'),
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
      email: 'registers-parity@ecms.local',
      firstName: { ar: 'م', en: 'R' },
      lastName: { ar: 'م', en: 'P' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
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
  B1 = await mkBranch('93', 'فرع السجلات ١');
  B2 = await mkBranch('94', 'فرع السجلات ٢');
  T1 = ok<FleetVehicleTypeDto>(
    await send('post', '/fleet/vehicle-types', {
      name: { ar: 'مصفحة السجلات', en: 'Registers armoured' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;
  vA = await mkVehicle({});
  vB = await mkVehicle({ branchId: B2 });

  // ── violations (D03, D42) ──
  DRIVER_TYPE = await mkCatalog('violationType', 'سرعة السجلات', { violationSide: 'driver' });
  COMPANY_TYPE = await mkCatalog('violationType', 'رسوم السجلات', { violationSide: 'company' });
  await FleetViolationModel.insertMany([
    // 126 attributed fines owed: 120 × 10 (2023, one a day) + 5 × 50 + 19 = 1,469.
    ...Array.from({ length: 120 }, (_, i) =>
      driverFine({ at: new Date(Date.UTC(2023, 0, 1 + i)).toISOString(), amount: 10 }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      driverFine({ at: new Date(Date.UTC(2025, 2, 1 + i)).toISOString(), amount: 50 }),
    ),
    driverFine({ at: '2026-10-05T00:00:00.000Z', amount: 19 }),
    // Collected, and deleted: never owed.
    driverFine({ at: '2026-10-06T00:00:00.000Z', amount: 500, collected: true }),
    driverFine({ at: '2026-10-07T00:00:00.000Z', amount: 999, deleted: true }),
    // The company's statements: 2 × 100 owed, 75 collected.
    statement({ year: 2026, count: 2, unit: 100, collected: false }),
    statement({ year: 2025, count: 1, unit: 75, collected: true }),
  ]);
  // Four fines on «مجهول», 119 in all — one of them with a NO-BREAK space before the word (D42).
  const unknowns = await FleetViolationModel.insertMany([
    driverFine({ at: '2026-10-08T00:00:00.000Z', amount: 25, employee: false, name: 'مجهول' }),
    driverFine({
      at: '2026-10-09T00:00:00.000Z',
      amount: 9,
      employee: false,
      name: ' مجهول',
    }),
    driverFine({ at: '2026-10-10T00:00:00.000Z', amount: 70, employee: false, name: null }),
    driverFine({ at: '2026-10-11T00:00:00.000Z', amount: 15, employee: false, name: '  مجهول ' }),
  ]);
  ids['nbsp'] = String(unknowns[1]?._id);

  // ── licence expenses (D05, D51) ──
  // L1: both memos waiting — renewal 100 × 2 by the card + 50 cash = 250, extension 30 cash.
  ids['L1'] = await licence(
    '2026-10-03',
    half(
      [vA.id, vB.id],
      [
        [100, 'visa', 2],
        [50, 'cash', 1],
      ],
    ),
    half([vB.id], [[30, 'cash', 1]]),
  );
  // L2: a renewal alone, 400 by the card.
  ids['L2'] = await licence('2026-10-10', half([vA.id], [[400, 'visa', 1]]), null);
  // L3: renewal 200 by the card — SETTLED below — and an extension of 80 cash still waiting.
  ids['L3'] = await licence(
    '2026-10-12',
    half([vB.id], [[200, 'visa', 1]]),
    half([vA.id, vB.id], [[80, 'cash', 1]]),
  );
  // September: a three-decimal line — only reachable through the API or an import (D51). Settled
  // with L3's renewal, so «تنتظر التسوية» is October's four memos alone.
  ids['L4'] = await licence('2026-09-10', half([vA.id], [[10.005, 'visa', 3]]), null);
  await fleetCustodyFundService.settle(
    CreateFleetCustodySettlementSchema.parse({
      date: '2026-10-29',
      parts: [
        { expenseId: ids['L3'], part: 'renewal' },
        { expenseId: ids['L4'], part: 'renewal' },
      ],
    }),
    adminId,
  );

  // ── notices (D10) ──
  // N1 (vA, B1): open, nothing attached — written through the screen.
  ok(
    await send('post', '/fleet/notices', {
      template: 'deltaInsurance',
      values: { driverName: 'سائق' },
      vehicleId: vA.id,
    }),
    201,
  );
  // The scans are uploads, so the rest are written straight to the store.
  await FleetNoticeModel.create([
    // N2 (vA): open, every attachment in — complete.
    {
      template: 'deltaInsurance',
      values: {},
      checks: {},
      vehicleId: new Types.ObjectId(vA.id),
      checkImage: scan(),
      vehicleLicenseImage: scan(),
      driverLicenseImage: scan(),
      completedAt: null,
    },
    // N3 (vB, B2): open, both licences in, the cheque missing.
    {
      template: 'deltaInsurance',
      values: {},
      checks: {},
      vehicleId: new Types.ObjectId(vB.id),
      checkImage: null,
      vehicleLicenseImage: scan(),
      driverLicenseImage: scan(),
      completedAt: null,
    },
    // N4 (vA): closed with «✓», missing everything — not the alert's.
    {
      template: 'deltaInsurance',
      values: {},
      checks: {},
      vehicleId: new Types.ObjectId(vA.id),
      checkImage: null,
      completedAt: new Date('2026-10-25T00:00:00.000Z'),
    },
  ]);
}, 300_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── D03 / D42 — «المخالفات» ────────────────────────────────────────────────────────────────────

describe('D03 — the drivers’ footer is the whole filter’s owed amount', () => {
  it('130 owed fines: «قائمة على السائقين» 1,588 = meta.outstandingAmount, a page of 100 in hand', async () => {
    const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    expect(now.today).toBe(TODAY);
    expect(now.violationsOpen?.drivers.total).toEqual({ amount: 1588, count: 130 });
    // «قائمة على السائقين» opens the drivers' half owed (`dset=false`).
    const { rows, meta } = await violations({ kind: 'driver', collected: 'false' });
    expect(rows).toHaveLength(100);
    expect(meta.totalItems).toBe(130);
    expect(meta.outstandingAmount).toBe(1588);
    expect(meta.outstandingAmount).toBe(now.violationsOpen?.drivers.total.amount);
    // The old footer — the rows in hand — fell short.
    expect(piastres(rows.reduce((sum, row) => sum + row.amount, 0))).toBeLessThan(piastres(1588));
    // The second page carries the same figure.
    const second = await violations({ kind: 'driver', collected: 'false', page: 2 });
    expect(second.rows).toHaveLength(30);
    expect(second.meta.outstandingAmount).toBe(1588);
  });

  it('follows the half the list asked: the company’s, both, and the collected (none owed)', async () => {
    const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    expect(now.violationsOpen?.company.amount).toBe(200);
    expect((await violations({ kind: 'vehicle', collected: 'false' })).meta.outstandingAmount).toBe(
      now.violationsOpen?.company.amount,
    );
    expect((await violations({ collected: 'false' })).meta.outstandingAmount).toBe(
      now.violationsOpen?.total.amount,
    );
    expect(now.violationsOpen?.total.amount).toBe(1788);
    expect((await violations({ collected: 'true' })).meta.outstandingAmount).toBe(0);
  });

  it('a period list adds its own days only — the drivers’ fines of October', async () => {
    // October: 19 + the four «مجهول» (119) owed; the collected 500 and the deleted 999 never.
    const { meta } = await violations({ kind: 'driver', ...OCT_DAYS });
    expect(meta.totalItems).toBe(6);
    expect(meta.outstandingAmount).toBe(138);
  });
});

describe('D42 — « مجهول» with a no-break space is «مجهول» on the register too', () => {
  it('«مجهول ←» (`unknownDriver=true`) finds the dashboard’s 4 · 119.00', async () => {
    const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    expect(now.violationsOpen?.drivers.unknown).toEqual({ amount: 119, count: 4 });
    const { rows, meta } = await violations({
      kind: 'driver',
      collected: 'false',
      unknownDriver: 'true',
    });
    expect({ amount: meta.outstandingAmount, count: meta.totalItems }).toEqual(
      now.violationsOpen?.drivers.unknown,
    );
    expect(rows.map((row) => row.id)).toContain(ids['nbsp']);
  });
});

// ── D05 / D51 — «مصروفات التراخيص» and «العهدة» ────────────────────────────────────────────────

describe('D05 — the licence register sums the memos its filter matched', () => {
  const strip = async (query: Record<string, unknown>) =>
    ok<FleetLicenseExpenseTotalsDto>(await get('/fleet/license-expenses/summary', query));
  const money = (totals: FleetLicenseExpenseTotalsDto) =>
    (piastres(totals.visaTotal) + piastres(totals.cashTotal)) / 100;

  it('«تنتظر التسوية» 760 over 4 = `status=waiting` — the settled renewal never in it', async () => {
    const settle = ok<FleetCustodySettleCandidatesDto>(
      await get('/fleet/custody/fund/settle/candidates'),
    );
    expect(settle.parts).toHaveLength(4);
    const waiting = await strip({ status: 'waiting' });
    expect(waiting.count).toBe(settle.parts.length);
    expect(money(waiting)).toBe(760);
    expect(piastres(money(waiting))).toBe(
      settle.parts.reduce((sum, part) => sum + piastres(part.total), 0),
    );
    // The table still lists the three RECORDS a waiting memo is on.
    expect(await total('/fleet/license-expenses', { status: 'waiting' })).toBe(3);
  });

  it('each kind’s «فتح» (`kind=<part>&status=waiting`) reads that kind’s parts: 650 / 2, 110 / 2', async () => {
    const settle = ok<FleetCustodySettleCandidatesDto>(
      await get('/fleet/custody/fund/settle/candidates'),
    );
    for (const [kind, amount] of [
      ['renewal', 650],
      ['extension', 110],
    ] as const) {
      const parts = settle.parts.filter((part) => part.part === kind);
      const register = await strip({ kind, status: 'waiting' });
      expect(register.count, kind).toBe(2);
      expect(register.count, kind).toBe(parts.length);
      expect(money(register), kind).toBe(amount);
      expect(register.cars, kind).toBe(parts.reduce((sum, part) => sum + part.cars, 0));
    }
  });

  it('«عدد المذكرات» counts memos on the licences tab and the register alike — five in three records', async () => {
    const period = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT));
    const register = await strip(OCT_DAYS);
    expect(period.licenceSpend?.count).toBe(5);
    expect(register.count).toBe(5);
    expect(period.licenceSpend).toMatchObject({
      count: register.count,
      cars: register.cars,
      visa: register.visaTotal,
      cash: register.cashTotal,
      total: 960,
    });
  });

  it('D51 — 10.005 × 3 is 30.03 on the register’s strip and on the dashboard', async () => {
    const SEPT = { from: '2026-09-01', to: '2026-09-30' } as const;
    const period = ok<FleetDashboardPeriodDto>(
      await get('/fleet/dashboard/period', { preset: 'custom', ...SEPT }),
    );
    const register = await strip(SEPT);
    expect(register.visaTotal).toBe(30.03);
    expect(period.licenceSpend?.visa).toBe(30.03);
    expect(period.licenceSpend?.total).toBe(30.03);
  });
});

// ── D10 — «الإخطارات» ──────────────────────────────────────────────────────────────────────────

describe('D10 — «ينقصها مرفق» lists the notices the dashboard counts', () => {
  it('company: «إخطارات مفتوحة ينقصها مرفق» = `status=open&missing=any` — never the complete one', async () => {
    const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    expect(now.notices?.missingAny).toBe(2);
    const query = { status: 'open', missing: 'any' };
    expect(await total('/fleet/notices', query)).toBe(now.notices?.missingAny);
    const summary = ok<FleetNoticesSummaryDto>(await get('/fleet/notices/summary', query));
    expect(summary.total).toBe(now.notices?.missingAny);
    expect(summary.open).toBe(now.notices?.missingAny);
    // Without the filter the open list holds the complete notice too.
    expect(await total('/fleet/notices', { status: 'open' })).toBe(3);
  });

  it('under a branch: the switcher’s count = the list the link opens with that branch', async () => {
    for (const [branch, count] of [
      [B1, 1],
      [B2, 1],
    ] as const) {
      const now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now', {}, branch));
      expect(now.notices?.missingAny).toBe(count);
      expect(
        await total(
          '/fleet/notices',
          { status: 'open', missing: 'any', branchIds: branch },
          branch,
        ),
      ).toBe(now.notices?.missingAny);
    }
  });

  it('refuses a value the filter does not know', async () => {
    expect((await get('/fleet/notices', { missing: 'all' })).status).toBe(400);
    expect((await get('/fleet/notices/summary', { missing: 'cheque' })).status).toBe(400);
  });
});
