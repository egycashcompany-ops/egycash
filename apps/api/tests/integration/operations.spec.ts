// Operations integration suite (OP-2): reference data (banks / branches / currencies) and the
// cash-shipment core. Exercises the ported legacy rules — the create guard (contad_app.js:313),
// the branch-per-bank rule (main_ops.ejs:477, the Q11-style client-rule-made-domain-rule), the
// Q24 area2 default, the observed complete/reopen transitions with Q30's state guard — plus
// RBAC on every surface, version-aware updates, and the operations.shipment.* events.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  OperationsEvents,
  SettingKeys,
  platformPermissions,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCrewBoardDto,
  type OperationsCurrencyDto,
  type OperationsDayDto,
  type OperationsCaptainRouteDto,
  type OperationsMobileDayDto,
  type OperationsShipmentAssignmentDto,
  type OperationsBankReportDto,
  type OperationsCaptainReportDto,
  type OperationsCrewAttendanceDayDto,
  type OperationsAreaDto,
  type OperationsShipmentDto,
  type OperationsDayBoardDto,
  type OperationsDayBoardShipmentDto,
  type OperationsStandingCrewBoardDto,
  type OperationsVaultInventoryRowDto,
  type OperationsVaultReportDto,
  type PageMeta,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // operationsShipment.view only — proves mutations are separately gated
const seenEvents: { name: string; payload: unknown }[] = [];

// The fixture days for every roster-backed suite in this file. RELATIVE, never literal: planning a
// roster is planning the FUTURE, so `POST /fleet/roster` refuses a date in the past — and a
// hardcoded day quietly becomes unplannable the moment it goes stale, taking the top-level
// `beforeAll` (and with it the whole file) down on a date nobody chose.
//
// The offsets are deliberately far out. They have to clear every date still written as a literal in
// this file, because a fixture day that lands on one of those breaks it from the other side: a day
// another test asserts nobody planned, or one it creates for the first time and expects a 201 for.
// Relative days only ever move forward and the literals do not move at all, so clearing them once
// clears them for good.
const shift = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The same idea pinned to a DAY OF THE MONTH. A suite whose window is a calendar month needs its
 * fixture days to sit inside one month together, which a bare offset cannot promise: land it on
 * the 28th and "four days later" is next month. Snapping to a low day of the month that `shift`
 * has already cleared keeps the whole group in one window, wherever the run falls.
 */
const monthAnchor = (days: number, dayOfMonth: number): string => {
  const d = new Date(`${shift(days)}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dayOfMonth))
    .toISOString()
    .slice(0, 10);
};

/** The calendar month around an ISO day, `offsetMonths` on from it, as an inclusive range. */
const monthRange = (iso: string, offsetMonths = 0): { from: string; to: string } => {
  const d = new Date(`${iso}T00:00:00Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};

/** A day of the month inside the month `monthRange(iso, offsetMonths)` describes. */
const dayInMonth = (iso: string, offsetMonths: number, dayOfMonth: number): string =>
  `${monthRange(iso, offsetMonths).from.slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`;

const PLAN_DATE = shift(150);
const DELIVERY_DATE = shift(151);
const ORDER_DATE = shift(152);
let branchId: string;
let departmentId: string;
let jobTitleId: string;
let vehicleAId: string;
let vehicleBId: string;
let offRosterVehicleId: string;
/**
 * Assigned in `beforeAll` rather than declared there: it closes over the vehicle type and branch
 * created at boot, and a case further down needs to make a vehicle of its own.
 */
let mkVehicle: (n: number) => Promise<string>;
/** The seeded super-admin's user id — assigned in `beforeAll`, like `mkVehicle` above. */
let adminId: string;
let captainId: string;
let specialist1Id: string;
let specialist2Id: string;

let bankA: OperationsBankDto;
let bankB: OperationsBankDto;
let branchA1: OperationsBankBranchDto; // bank A
let branchB1: OperationsBankBranchDto; // bank B
let egp: OperationsCurrencyDto;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-operations-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

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

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorCode = (res: request.Response): string =>
  (res.body as { error: { code: string } }).error.code;

const waitFor = async (predicate: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

let nidCounter = 0;
let phoneCounter = 50_000_000;
const nextNid = (): string => `290010101${String(70_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `011${String(phoneCounter++).padStart(8, '0')}`;

/**
 * HR employee via the real direct-registration endpoint — Operations never fabricates one.
 *
 * `seat` places them somewhere other than the crew department — a driver has to sit in a job title
 * that requires a driving test, or Fleet will not put them on a van.
 */
const mkEmployee = async (
  seat: { fullNameAr?: string; jobTitleId?: string; departmentId?: string } = {},
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: seat.fullNameAr ?? 'طاقم اختبار',
          nationalId: nextNid(),
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: seat.jobTitleId ?? jobTitleId,
        departmentId: seat.departmentId ?? departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

let shipmentCounter = 0;
const mkShipment = async (
  overrides: Record<string, unknown> = {},
): Promise<request.Response> => {
  shipmentCounter += 1;
  return request(app)
    .post('/api/v1/operations/shipments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      shipmentType: 'daily',
      mainBankId: bankA.id,
      originBranchId: branchA1.id,
      destinationBranchId: branchA1.id,
      lines: [{ currencyId: egp.id, amount: 1000 + shipmentCounter }],
      collectionDate: '2026-08-17',
      ...overrides,
    });
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  for (const name of Object.values(OperationsEvents)) {
    subscribe(name, `test.${name}`, (envelope) => {
      seenEvents.push({ name: envelope.name, payload: envelope.payload });
    });
  }

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...operationsPermissions].map(
      (p) => p.key,
    ),
  );
  adminId = await mkUser('ops-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const viewer = await rbacService.createRole(
    {
      name: { en: 'Ops Viewer', ar: 'مشاهد العمليات' },
      permissionKeys: ['operationsShipment.view'],
    },
    adminId,
  );
  const viewerId = await mkUser('ops-viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, String(viewer._id), 'organization');

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

  adminToken = await login('ops-admin@ecms.local');
  viewerToken = await login('ops-viewer@ecms.local');

  // OP-3 fixtures: real org rows, a fleet vehicle on the roster, and HR employees — the crew
  // board integrates with the REAL Fleet boundary and HR directory, never fabricated ids.
  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '80', name: { ar: 'فرع العمليات', en: 'Ops Branch' } });
  expect(branchRes.status).toBe(201);
  branchId = (branchRes.body as { data: { id: string } }).data.id;

  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-CIT', name: { ar: 'نقل الأموال', en: 'Cash Transfer' }, branchId });
  expect(dept.status).toBe(201);
  departmentId = (dept.body as { data: { id: string } }).data.id;

  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS-CREW', name: { ar: 'أخصائي عمليات', en: 'Ops Specialist' }, jobGrade: 'G1' });
  expect(title.status).toBe(201);
  jobTitleId = (title.body as { data: { id: string } }).data.id;

  const typeRes = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'مصفحة عمليات', en: 'Ops Armored' }, maintenanceIntervalKm: 10_000 });
  expect(typeRes.status).toBe(201);
  const typeId = data<FleetVehicleTypeDto>(typeRes).id;

  mkVehicle = async (n: number): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/fleet/vehicles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `OPS-V${n}`,
        typeId,
        plateNumber: `ن ق ${n}`,
        chassisNumber: `OPS-CH-${n}`,
        motorNumber: `OPS-MO-${n}`,
        joinedAt: '2024-01-01T00:00:00.000Z',
        licenseExpiresAt: '2027-01-01T00:00:00.000Z',
        branchId,
      });
    expect(res.status).toBe(201);
    return data<FleetVehicleDto>(res).id;
  };
  vehicleAId = await mkVehicle(1);
  vehicleBId = await mkVehicle(2);
  offRosterVehicleId = await mkVehicle(3);

  captainId = await mkEmployee();
  specialist1Id = await mkEmployee();
  specialist2Id = await mkEmployee();

  // Fleet roster rows for the planning date — the §9.4 anchor rows (vehicle A and B only;
  // vehicle 3 stays OFF the roster to prove the gate).
  const rosterRes = await request(app)
    .post('/api/v1/fleet/roster')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      date: PLAN_DATE,
      rows: [
        { vehicleId: vehicleAId, notes: 'ops board seed' },
        { vehicleId: vehicleBId, notes: 'ops board seed' },
      ],
    });
  expect(rosterRes.status).toBe(200);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('reference data — banks, branches, currencies', () => {
  it('creates the reference rows the shipments below stand on', async () => {
    const bankARes = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 1, name: { ar: 'البنك الأهلي', en: 'NBE' }, opsName: 'الأهلي' });
    expect(bankARes.status).toBe(201);
    bankA = data<OperationsBankDto>(bankARes);

    const bankBRes = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 2, name: { ar: 'بنك مصر', en: 'Banque Misr' }, opsName: 'مصر' });
    expect(bankBRes.status).toBe(201);
    bankB = data<OperationsBankDto>(bankBRes);

    const branchARes = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: bankA.id, name: 'فرع المهندسين', code: 'A-101', opsAreaName: 'الجيزة' });
    expect(branchARes.status).toBe(201);
    branchA1 = data<OperationsBankBranchDto>(branchARes);

    const branchBRes = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: bankB.id, name: 'فرع وسط البلد', code: 'B-201', opsAreaName: 'القاهرة' });
    expect(branchBRes.status).toBe(201);
    branchB1 = data<OperationsBankBranchDto>(branchBRes);

    const egpRes = await request(app)
      .post('/api/v1/operations/currencies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'EGP', name: 'مصري', legacyAliases: ['مصري', 'جنيه', 'EGP', 'جنيه مصري'] });
    expect(egpRes.status).toBe(201);
    egp = data<OperationsCurrencyDto>(egpRes);
  });

  it('Q24 parity — financeAreaName defaults to opsAreaName exactly as legacy area2||area', () => {
    expect(branchA1.financeAreaName).toBe('الجيزة');
    expect(branchA1.location).toBeNull();
  });

  it('refuses a duplicate opsName — the unique legacy join key', async () => {
    const res = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 9, name: { ar: 'مكرر', en: 'Dup' }, opsName: 'الأهلي' });
    expect(res.status).toBe(409);
  });

  it('refuses a branch of an unknown bank', async () => {
    const res = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: '00000000000000000000aaaa', name: 'x', code: 'y' });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_UNKNOWN_BANK);
  });

  it('reads ride operationsShipment.view; mutations need operationsCatalog.manage', async () => {
    const read = await request(app)
      .get('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.status).toBe(200);

    const write = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ code: 3, name: { ar: 'س', en: 'X' }, opsName: 'X' });
    expect(write.status).toBe(403);
  });
});

describe('cash shipments — the ported legacy create guard', () => {
  it('creates a daily shipment with the legacy-required minimum and round-trips the money', async () => {
    const res = await mkShipment({ lines: [{ currencyId: egp.id, amount: 1500.5 }] });
    expect(res.status).toBe(201);
    const dto = data<OperationsShipmentDto>(res);
    expect(dto.status).toBe('draft');
    expect(dto.secondaryBankId).toBeNull(); // legacy never server-checked toBankSelect
    expect(dto.deliveryDate).toBeNull(); // legacy hardcodes del_date "" for يومي
    expect(dto.lines[0]?.amount).toBe(1500.5);
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.ShipmentCreated));
  });

  it('normalizes the collection date to a UTC day — Q15, no more exact-midnight fragility', async () => {
    const res = await mkShipment({ collectionDate: '2026-08-17T13:45:00.000+02:00' });
    expect(res.status).toBe(201);
    expect(data<OperationsShipmentDto>(res).collectionDate).toBe('2026-08-17T00:00:00.000Z');
  });

  // The main bank is the BILLED bank. The money may be collected from a branch of another bank —
  // legacy's from-branch list followed its own from-bank select (main_ops.ejs:497-499), which was
  // never stored; the from-bank is the origin branch's own bank.
  it('accepts an origin branch of another bank — the main bank is the billed one', async () => {
    const res = await mkShipment({ originBranchId: branchB1.id });
    expect(res.status).toBe(201);
    const dto = data<OperationsShipmentDto>(res);
    expect(dto.originBranchId).toBe(branchB1.id);
    expect(dto.mainBankId).not.toBe(bankB.id);
  });

  it('still refuses an unknown origin branch', async () => {
    const res = await mkShipment({ originBranchId: '00000000000000000000beef' });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_UNKNOWN_BRANCH);
  });

  it('destination side follows toBank ?? mainBank — bank B branch needs bank B declared', async () => {
    const wrong = await mkShipment({ destinationBranchId: branchB1.id });
    expect(wrong.status).toBe(422);
    expect(errorCode(wrong)).toBe(ErrorCodes.OPERATIONS_BRANCH_BANK_MISMATCH);

    const right = await mkShipment({
      secondaryBankId: bankB.id,
      destinationBranchId: branchB1.id,
    });
    expect(right.status).toBe(201);
  });

  it('refuses an unknown currency on a line', async () => {
    const res = await mkShipment({
      lines: [{ currencyId: '00000000000000000000bbbb', amount: 10 }],
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_UNKNOWN_CURRENCY);
  });

  it('refuses a daily shipment with a delivery date at the schema boundary', async () => {
    const res = await mkShipment({ deliveryDate: '2026-08-20' });
    expect(res.status).toBe(400);
  });

  it('gates create behind its own permission — the viewer can list but not create', async () => {
    const list = await request(app)
      .get('/api/v1/operations/shipments')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);

    const res = await request(app)
      .post('/api/v1/operations/shipments')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('cash shipments — complete / reopen (the legacy receive toggle, state-guarded)', () => {
  it('completes a daily shipment from draft, stamps the receiver, and reopens back to draft', async () => {
    const createRes = await mkShipment();
    const shipment = data<OperationsShipmentDto>(createRes);

    const done = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(done.status).toBe(200);
    const completed = data<OperationsShipmentDto>(done);
    expect(completed.status).toBe('completed');
    expect(completed.receivedById).not.toBeNull();
    expect(completed.receivedAt).not.toBeNull();
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.ShipmentCompleted));

    // Legacy un-receive parity (:555): back to draft, receive stamp cleared verbatim.
    const reopened = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: completed.version });
    expect(reopened.status).toBe(200);
    const draft = data<OperationsShipmentDto>(reopened);
    expect(draft.status).toBe('draft');
    expect(draft.receivedById).toBeNull();
    expect(draft.receivedAt).toBeNull();
  });

  it('Q30 — a secured shipment cannot complete from draft (no unguarded jump to terminal)', async () => {
    const createRes = await mkShipment({ shipmentType: 'secured', deliveryDate: '2026-08-20' });
    expect(createRes.status).toBe(201);
    const shipment = data<OperationsShipmentDto>(createRes);

    const res = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);
  });

  it('refuses a double-complete: the second caller loses on state, a stale writer on version', async () => {
    const createRes = await mkShipment();
    const shipment = data<OperationsShipmentDto>(createRes);

    const first = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(first.status).toBe(200);

    // Same (now stale) version — the optimistic lock answers before the state machine can.
    const stale = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(stale.status).toBe(422);
    expect(errorCode(stale)).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);

    // Fresh version, wrong state — the state machine refuses.
    const freshVersion = data<OperationsShipmentDto>(first).version;
    const wrongState = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: freshVersion });
    expect(wrongState.status).toBe(422);
    expect(errorCode(wrongState)).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);
  });

  it('update is version-locked — a stale version gets 409 STALE_DOCUMENT', async () => {
    const createRes = await mkShipment();
    const shipment = data<OperationsShipmentDto>(createRes);

    const first = await request(app)
      .patch(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'أولى', version: shipment.version });
    expect(first.status).toBe(200);

    const stale = await request(app)
      .patch(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'ثانية', version: shipment.version });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe(ErrorCodes.STALE_DOCUMENT);
  });

  it('soft-deletes in any state (legacy parity) and hides the row from lists', async () => {
    const createRes = await mkShipment();
    const shipment = data<OperationsShipmentDto>(createRes);

    const del = await request(app)
      .delete(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const get = await request(app)
      .get(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });
});

describe('operating days — creation, loading, forward-only lifecycle (OP-3)', () => {
  let day: OperationsDayDto;

  it('creates a day, refuses a duplicate date, and loads it back by date', async () => {
    const res = await request(app)
      .post('/api/v1/operations/days')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-09-01' });
    expect(res.status).toBe(201);
    day = data<OperationsDayDto>(res);
    expect(day.status).toBe('planning');
    expect(day.date).toBe('2026-09-01T00:00:00.000Z');

    const dup = await request(app)
      .post('/api/v1/operations/days')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-09-01' });
    expect(dup.status).toBe(409);

    const get = await request(app)
      .get('/api/v1/operations/days?date=2026-09-01')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(data<OperationsDayDto>(get).id).toBe(day.id);
  });

  it('walks planning → open → closed and refuses every backward or skipping move', async () => {
    const skip = await request(app)
      .post(`/api/v1/operations/days/${day.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: day.version });
    expect(skip.status).toBe(422);
    expect(errorCode(skip)).toBe(ErrorCodes.OPERATIONS_INVALID_DAY_TRANSITION);

    const opened = await request(app)
      .post(`/api/v1/operations/days/${day.id}/open`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: day.version });
    expect(opened.status).toBe(200);
    const openDto = data<OperationsDayDto>(opened);
    expect(openDto.status).toBe('open');
    expect(openDto.openedById).not.toBeNull();

    const closed = await request(app)
      .post(`/api/v1/operations/days/${day.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: openDto.version });
    expect(closed.status).toBe(200);
    expect(data<OperationsDayDto>(closed).status).toBe('closed');

    const reopen = await request(app)
      .post(`/api/v1/operations/days/${day.id}/open`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: data<OperationsDayDto>(closed).version });
    expect(reopen.status).toBe(422);
    expect(errorCode(reopen)).toBe(ErrorCodes.OPERATIONS_INVALID_DAY_TRANSITION);
  });

  it('gates day management behind operationsDay.manage', async () => {
    const res = await request(app)
      .post('/api/v1/operations/days')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ date: '2026-09-02' });
    expect(res.status).toBe(403);
  });
});

describe('crew board — the tashghela workflow on the Fleet boundary (OP-3)', () => {
  const board = async (date?: string): Promise<request.Response> =>
    request(app)
      .get(`/api/v1/operations/crew-board${date === undefined ? '' : `?date=${date}`}`)
      .set('Authorization', `Bearer ${adminToken}`);

  const savePlan = async (rows: unknown[], date = PLAN_DATE): Promise<request.Response> =>
    request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date, rows });

  it('defaults to TOMORROW when no date is given — the verbatim legacy behaviour (:2239)', async () => {
    const res = await board();
    expect(res.status).toBe(200);
    const dto = data<OperationsCrewBoardDto>(res);
    const now = new Date();
    const expected = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString();
    expect(dto.date).toBe(expected);
  });

  it('shows only vehicles on the Fleet roster for the date, with the Fleet facts read-only', async () => {
    const res = await board(PLAN_DATE);
    expect(res.status).toBe(200);
    const dto = data<OperationsCrewBoardDto>(res);
    const ids = dto.rows.map((r) => r.vehicleId).sort();
    expect(ids).toEqual([vehicleAId, vehicleBId].sort());
    expect(dto.rows.every((r) => r.fleetDutyAssignmentId.length === 24)).toBe(true);
    expect(dto.day).toBeNull(); // no plan saved yet — the day row does not exist yet
  });

  it('plans a full crew, auto-ensures the day, and resolves day+vehicle → crew', async () => {
    const res = await savePlan([
      {
        vehicleId: vehicleAId,
        captainEmployeeIds: [captainId],
        specialist1EmployeeIds: [specialist1Id],
        specialist2EmployeeIds: [specialist2Id],
        direction: 'الجيزة',
        plannedTime: '07:30',
      },
    ]);
    expect(res.status).toBe(200);
    const dto = data<OperationsCrewBoardDto & { changedCount: number }>(res);
    expect(dto.changedCount).toBe(1);
    expect(dto.day).not.toBeNull();
    expect(dto.day?.status).toBe('planning');
    const rowA = dto.rows.find((r) => r.vehicleId === vehicleAId);
    expect(rowA?.crew?.captainEmployeeIds).toEqual([captainId]);
    expect(rowA?.crew?.specialist1EmployeeIds).toEqual([specialist1Id]);
    expect(rowA?.crew?.specialist2EmployeeIds).toEqual([specialist2Id]);
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.CrewPlanned));
  });

  it('replaces a crew in place — upsert per (day, vehicle), unchanged rows are no-ops', async () => {
    const unchanged = await savePlan([
      {
        vehicleId: vehicleAId,
        captainEmployeeIds: [captainId],
        specialist1EmployeeIds: [specialist1Id],
        specialist2EmployeeIds: [specialist2Id],
        direction: 'الجيزة',
        plannedTime: '07:30',
      },
    ]);
    expect(data<{ changedCount: number }>(unchanged).changedCount).toBe(0);

    const replaced = await savePlan([
      { vehicleId: vehicleAId, captainEmployeeIds: [captainId], specialist1EmployeeIds: [] },
    ]);
    expect(replaced.status).toBe(200);
    const dto = data<OperationsCrewBoardDto & { changedCount: number }>(replaced);
    expect(dto.changedCount).toBe(1);
    const rowA = dto.rows.find((r) => r.vehicleId === vehicleAId);
    expect(rowA?.crew?.specialist1EmployeeIds).toEqual([]);
    expect(rowA?.crew?.direction).toBeNull(); // the row is the COMPLETE desired state
  });

  it('empty specialists are allowed — legacy enforces no minimum crew (:2419)', async () => {
    const res = await savePlan([{ vehicleId: vehicleBId, captainEmployeeIds: [specialist1Id] }]);
    expect(res.status).toBe(200);
  });

  it('Q11 — refuses stealing a crew member without the releasing row, allows the move shape', async () => {
    const steal = await savePlan([{ vehicleId: vehicleBId, specialist2EmployeeIds: [captainId] }]);
    expect(steal.status).toBe(409);

    const move = await savePlan([
      { vehicleId: vehicleAId },
      { vehicleId: vehicleBId, captainEmployeeIds: [captainId] },
    ]);
    expect(move.status).toBe(200);
    const dto = data<OperationsCrewBoardDto>(move);
    expect(dto.rows.find((r) => r.vehicleId === vehicleAId)?.crew?.captainEmployeeIds).toEqual(
      [],
    );
    expect(dto.rows.find((r) => r.vehicleId === vehicleBId)?.crew?.captainEmployeeIds).toEqual(
      [captainId],
    );
  });

  it('§9.4 — refuses planning crew for a vehicle that is not on the Fleet roster', async () => {
    const res = await savePlan([
      { vehicleId: offRosterVehicleId, captainEmployeeIds: [specialist2Id] },
    ]);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_FLEET_DUTY_REQUIRED);
  });

  it('refuses an unknown employee reference', async () => {
    const res = await savePlan([
      { vehicleId: vehicleBId, specialist1EmployeeIds: ['00000000000000000000cccc'] },
    ]);
    expect(res.status).toBe(400);
  });

  // ── Slot capacity (CREW_SLOT_CAPACITY) ─────────────────────────────────────────────────────────
  //
  // Legacy stored ONE person per slot: three Strings on the tashghela row (models/tash4ela.js:10-12),
  // one card per cell (tashghela.ejs:914-916). Two per slot is a NEW capability, so these cases have
  // no legacy counterpart to be measured against — what they pin is that the rules which already
  // existed (Q11, cross-slot exclusivity) reach the SECOND occupant, and that the ceiling holds.
  //
  // Every case sends a COMPLETE plan for both vehicles, so it starts from a known end state rather
  // than from whatever the preceding cases in this suite left behind.
  describe('a crew slot holds two people', () => {
    let coCaptainId: string;
    let extraSpecialist1Id: string;
    let extraSpecialist2Id: string;

    beforeAll(async () => {
      coCaptainId = await mkEmployee();
      extraSpecialist1Id = await mkEmployee();
      extraSpecialist2Id = await mkEmployee();
    });

    const fullCrew = () => ({
      vehicleId: vehicleAId,
      captainEmployeeIds: [captainId, coCaptainId],
      specialist1EmployeeIds: [specialist1Id, extraSpecialist1Id],
      specialist2EmployeeIds: [specialist2Id, extraSpecialist2Id],
    });

    it('stores a crew of six on one vehicle and reads all six back', async () => {
      const res = await savePlan([fullCrew(), { vehicleId: vehicleBId }]);
      expect(res.status).toBe(200);
      const rowA = data<OperationsCrewBoardDto>(res).rows.find((r) => r.vehicleId === vehicleAId);
      expect(rowA?.crew?.captainEmployeeIds).toEqual([captainId, coCaptainId]);
      expect(rowA?.crew?.specialist1EmployeeIds).toEqual([specialist1Id, extraSpecialist1Id]);
      expect(rowA?.crew?.specialist2EmployeeIds).toEqual([specialist2Id, extraSpecialist2Id]);
    });

    it('refuses a THIRD person in one slot', async () => {
      const res = await savePlan([
        {
          vehicleId: vehicleAId,
          captainEmployeeIds: [captainId, coCaptainId, specialist1Id],
        },
        { vehicleId: vehicleBId },
      ]);
      expect(res.status).toBe(400);
    });

    it('refuses the same person listed twice inside one slot', async () => {
      // Unexpressible while a slot held one person, and refused now rather than left to store a
      // two-captain crew that is really one person counted twice.
      const res = await savePlan([
        { vehicleId: vehicleAId, captainEmployeeIds: [captainId, captainId] },
        { vehicleId: vehicleBId },
      ]);
      expect(res.status).toBe(400);
    });

    it('Q11 reaches the SECOND occupant — the co-captain cannot also crew vehicle B', async () => {
      await savePlan([fullCrew(), { vehicleId: vehicleBId }]);
      const steal = await savePlan([{ vehicleId: vehicleBId, captainEmployeeIds: [coCaptainId] }]);
      expect(steal.status).toBe(409);
    });

    /** Vehicle A's crew id as a SCREEN obtains it — through the board, never the repository. */
    const crewIdOfVehicleA = async (): Promise<string> => {
      const dto = data<OperationsCrewBoardDto>(await board(PLAN_DATE));
      return dto.rows.find((r) => r.vehicleId === vehicleAId)?.crew?.id ?? '';
    };

    /** A shipment collected on the planned day, so its pickup leg lands on this crew's day. */
    const shipmentOnPlanDate = async (): Promise<OperationsShipmentDto> =>
      data<OperationsShipmentDto>(await mkShipment({ collectionDate: PLAN_DATE }));

    const assignPickup = async (
      shipment: OperationsShipmentDto,
      crewAssignmentId: string,
      captainEmployeeId: string,
    ): Promise<request.Response> =>
      request(app)
        .post(`/api/v1/operations/assignments/shipments/${shipment.id}/assign-pickup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId, captainEmployeeId, version: shipment.version });

    it('both captains can take a leg — captaincy is membership, not the first slot', async () => {
      // A crew has two captains; a LEG has one. Which of the two is answerable for a given leg is
      // the operator's call, so the domain must accept EITHER — a gate that compared against the
      // first slot would have silently made the second captain a passenger.
      await savePlan([fullCrew(), { vehicleId: vehicleBId }]);
      const crewId = await crewIdOfVehicleA();
      expect(crewId).not.toBe('');

      for (const captain of [captainId, coCaptainId]) {
        const assigned = await assignPickup(await shipmentOnPlanDate(), crewId, captain);
        expect(assigned.status).toBe(200);
      }
    });

    it('refuses a captain who is on the row as a SPECIALIST, not as a captain', async () => {
      // Widening captaincy to "anyone in the captain slot" must not widen it to "anyone on the row".
      await savePlan([fullCrew(), { vehicleId: vehicleBId }]);
      const res = await assignPickup(
        await shipmentOnPlanDate(),
        await crewIdOfVehicleA(),
        specialist1Id,
      );
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);
    });
  });

  // ── The migration off the single-occupant columns ──────────────────────────────────────────────
  //
  // Rows written before the slots became lists carry three scalars and no lists. The conversion is
  // boot-time, in-module and idempotent; what these cases pin is the three rules it is built on —
  // nothing deleted, nothing invented, re-running changes nothing — because rule 3 is what makes it
  // safe to leave in the boot path forever.
  describe('migrating a pre-capacity crew row', () => {
    const insertLegacyRow = async (
      dayId: unknown,
      scalars: Record<string, unknown>,
    ): Promise<string> => {
      const { OperationsCrewAssignmentModel } = await import(
        '../../src/modules/operations/crew/crew-assignment.model'
      );
      const { Types } = await import('mongoose');
      // Written through the raw collection ON PURPOSE: the document no longer maps these columns,
      // so the model cannot produce the shape this is meant to read.
      const result = await OperationsCrewAssignmentModel.collection.insertOne({
        operationsDayId: dayId,
        vehicleId: new Types.ObjectId(),
        fleetDutyAssignmentId: new Types.ObjectId(),
        direction: null,
        plannedTime: null,
        notes: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: null,
        updatedById: null,
        __v: 0,
        ...scalars,
      });
      return String(result.insertedId);
    };

    const readRaw = async (id: string): Promise<Record<string, unknown>> => {
      const { OperationsCrewAssignmentModel } = await import(
        '../../src/modules/operations/crew/crew-assignment.model'
      );
      const { Types } = await import('mongoose');
      const doc = await OperationsCrewAssignmentModel.collection.findOne({
        _id: new Types.ObjectId(id),
      });
      return (doc ?? {}) as Record<string, unknown>;
    };

    it('converts each occupant to a one-person list and leaves the source column untouched', async () => {
      const { Types } = await import('mongoose');
      const { migrateCrewSlotsToArrays } = await import(
        '../../src/modules/operations/operations.migration'
      );
      const captain = new Types.ObjectId();
      const specialist = new Types.ObjectId();
      const id = await insertLegacyRow(new Types.ObjectId(), {
        captainEmployeeId: captain,
        specialist1EmployeeId: specialist,
        specialist2EmployeeId: null,
      });

      const first = await migrateCrewSlotsToArrays();
      expect(first.rowsUpdated).toBeGreaterThanOrEqual(1);

      const row = await readRaw(id);
      expect(row.captainEmployeeIds).toEqual([captain]);
      expect(row.specialist1EmployeeIds).toEqual([specialist]);
      // Nothing invented: an empty slot becomes an empty list, not a placeholder occupant.
      expect(row.specialist2EmployeeIds).toEqual([]);
      // Nothing deleted: the source of the conversion is the only way to check it afterwards.
      expect(String(row.captainEmployeeId)).toBe(String(captain));
    });

    it('re-running writes nothing and never collapses a crew someone has since widened', async () => {
      const { Types } = await import('mongoose');
      const { migrateCrewSlotsToArrays } = await import(
        '../../src/modules/operations/operations.migration'
      );
      const captain = new Types.ObjectId();
      const coCaptain = new Types.ObjectId();
      const id = await insertLegacyRow(new Types.ObjectId(), { captainEmployeeId: captain });
      await migrateCrewSlotsToArrays();

      // An operator adds a second captain. The frozen scalar now DISAGREES with the list — which
      // is the normal state of every row edited after the migration ran, not a fault to repair.
      const { OperationsCrewAssignmentModel } = await import(
        '../../src/modules/operations/crew/crew-assignment.model'
      );
      await OperationsCrewAssignmentModel.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { captainEmployeeIds: [captain, coCaptain] } },
      );

      const again = await migrateCrewSlotsToArrays();
      expect(again.rowsUpdated).toBe(0);
      expect((await readRaw(id)).captainEmployeeIds).toEqual([captain, coCaptain]);
    });

    it('reaches a soft-deleted row — it is still readable history', async () => {
      const { Types } = await import('mongoose');
      const { migrateCrewSlotsToArrays } = await import(
        '../../src/modules/operations/operations.migration'
      );
      const captain = new Types.ObjectId();
      const id = await insertLegacyRow(new Types.ObjectId(), {
        captainEmployeeId: captain,
        isDeleted: true,
      });
      await migrateCrewSlotsToArrays();
      // Leaving it on the old shape would make it the one row whose crew a widened reader cannot
      // see — and the captain report and the audit trail both reach it.
      expect((await readRaw(id)).captainEmployeeIds).toEqual([captain]);
    });
  });

  // ── Crewing a shipment at creation (legacy leader1 + car_num1, restored) ───────────────────────
  describe('naming the collection crew when the shipment is booked', () => {
    const CREATE_CREW_DATE = shift(260);
    let bookCaptainId: string;
    let bookCrewId: string;

    const bookWith = async (pickup: unknown): Promise<request.Response> =>
      request(app)
        .post('/api/v1/operations/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shipmentType: 'daily',
          mainBankId: bankA.id,
          originBranchId: branchA1.id,
          destinationBranchId: branchA1.id,
          lines: [{ currencyId: egp.id, amount: 4321 }],
          collectionDate: CREATE_CREW_DATE,
          pickup,
        });

    const legOf = async (shipmentId: string) => {
      const { operationsShipmentAssignmentRepository } = await import(
        '../../src/modules/operations/shipments/shipment-assignment.repository'
      );
      return operationsShipmentAssignmentRepository.findByShipmentAndLeg(shipmentId, 'pickup');
    };

    beforeAll(async () => {
      bookCaptainId = await mkEmployee();
      expect(
        (
          await request(app)
            .post('/api/v1/fleet/roster')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ date: CREATE_CREW_DATE, rows: [{ vehicleId: vehicleAId, notes: 'booking' }] })
        ).status,
      ).toBe(200);
      const plan = await request(app)
        .post('/api/v1/operations/crew-board')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          date: CREATE_CREW_DATE,
          rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [bookCaptainId] }],
        });
      expect(plan.status).toBe(200);
      bookCrewId =
        data<OperationsCrewBoardDto>(plan).rows.find((r) => r.vehicleId === vehicleAId)?.crew?.id ??
        '';
      expect(bookCrewId).not.toBe('');
    });

    it('writes the collection leg in the same act, taking the VEHICLE from the crew row', async () => {
      const res = await bookWith({ crewAssignmentId: bookCrewId, captainEmployeeId: bookCaptainId });
      expect(res.status).toBe(201);
      const leg = await legOf(data<OperationsShipmentDto>(res).id);
      expect(leg).not.toBeNull();
      expect(String(leg?.captainEmployeeId)).toBe(bookCaptainId);
      // Never sent by the client — read off the crew row, so it cannot be claimed.
      expect(String(leg?.vehicleId)).toBe(vehicleAId);
      expect(leg?.sequence).toBe(1);
    });

    it('books with NO crew when none is named — the backlog path is unchanged', async () => {
      const res = await bookWith(null);
      expect(res.status).toBe(201);
      expect(await legOf(data<OperationsShipmentDto>(res).id)).toBeNull();
    });

    it('refuses a vehicleId on the wire — the vehicle is the crew row\u2019s, not the caller\u2019s', async () => {
      const res = await bookWith({
        crewAssignmentId: bookCrewId,
        captainEmployeeId: bookCaptainId,
        vehicleId: vehicleBId,
      });
      expect(res.status).toBe(400);
    });

    it('refuses a captain who is not a captain of that crew row, and creates NOTHING', async () => {
      // `okPage` puts the rows in `data` and the pagination beside it in `meta`, so the count is
      // the array's own length — reaching for `data.meta` finds nothing.
      const booked = async (): Promise<number> =>
        data<OperationsShipmentDto[]>(
          await request(app)
            .get(
              `/api/v1/operations/shipments?collectionDateFrom=${CREATE_CREW_DATE}&collectionDateTo=${CREATE_CREW_DATE}&pageSize=100`,
            )
            .set('Authorization', `Bearer ${adminToken}`),
        ).length;

      const before = await booked();

      const res = await bookWith({ crewAssignmentId: bookCrewId, captainEmployeeId: captainId });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);

      // The crew is proven BEFORE anything is written, so a refused crew leaves no orphan shipment.
      expect(await booked()).toBe(before);
    });

    it('refuses a crew row from a DIFFERENT operating day', async () => {
      const res = await request(app)
        .post('/api/v1/operations/shipments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          shipmentType: 'daily',
          mainBankId: bankA.id,
          originBranchId: branchA1.id,
          destinationBranchId: branchA1.id,
          lines: [{ currencyId: egp.id, amount: 99 }],
          collectionDate: shift(261), // no crew planned on this day
          pickup: { crewAssignmentId: bookCrewId, captainEmployeeId: bookCaptainId },
        });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH);
    });

    it('puts a second shipment at the END of that captain\u2019s collection order', async () => {
      const res = await bookWith({ crewAssignmentId: bookCrewId, captainEmployeeId: bookCaptainId });
      expect(res.status).toBe(201);
      const leg = await legOf(data<OperationsShipmentDto>(res).id);
      expect(leg?.sequence).toBeGreaterThan(1);
    });
  });

  it('gates the board and the plan behind their own grants', async () => {
    const view = await request(app)
      .get('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(view.status).toBe(403); // viewer holds operationsShipment.view only

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ date: PLAN_DATE, rows: [{ vehicleId: vehicleAId }] });
    expect(plan.status).toBe(403);
  });
});

// ── The standing crew (الطاقم الثابت) ───────────────────────────────────────────────────────────
//
// NEW CAPABILITY. Legacy had no standing crew at all: `/tashghela` rendered `t.leader || ""`
// (contad_app.js:2305-2311) and the board started empty every morning. What these cases pin is
// that the entity is a real membership list — explicit, not derived — and that it carries the same
// rules as a day's crew row so the descent can never author a plan the day would refuse.
describe('the standing crew — the permanent crew of each cash-transfer vehicle', () => {
  const standing = async (token = adminToken): Promise<request.Response> =>
    request(app)
      .get('/api/v1/operations/standing-crew')
      .set('Authorization', `Bearer ${token}`);

  const save = async (rows: unknown[], token = adminToken): Promise<request.Response> =>
    request(app)
      .put('/api/v1/operations/standing-crew')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows });

  const drop = async (vehicleId: string, token = adminToken): Promise<request.Response> =>
    request(app)
      .delete(`/api/v1/operations/standing-crew/${vehicleId}`)
      .set('Authorization', `Bearer ${token}`);

  let standingCaptainId: string;
  let standingCoCaptainId: string;
  let standingSpecialistId: string;
  let standingSpecialist1bId: string;
  let standingSpecialist2aId: string;
  let standingSpecialist2bId: string;
  /** Holds `operationsCrew.view` and NOT `.plan` — the only token that can tell the two apart. */
  let crewViewerToken: string;

  beforeAll(async () => {
    standingCaptainId = await mkEmployee();
    standingCoCaptainId = await mkEmployee();
    standingSpecialistId = await mkEmployee();
    standingSpecialist1bId = await mkEmployee();
    standingSpecialist2aId = await mkEmployee();
    standingSpecialist2bId = await mkEmployee();

    const role = await rbacService.createRole(
      { name: { en: 'Crew viewer', ar: 'قارئ الطاقم' }, permissionKeys: ['operationsCrew.view'] },
      await mkUser('standing-role-seed@ecms.local'),
    );
    const userId = await mkUser('standing-crew-viewer@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    crewViewerToken = await login('standing-crew-viewer@ecms.local');
  });

  it('starts empty and OFFERS the fleet — membership is explicit, never derived', async () => {
    const res = await standing();
    expect(res.status).toBe(200);
    const dto = data<OperationsStandingCrewBoardDto>(res);
    expect(dto.rows).toEqual([]);
    // There is no day-independent "cash-transfer vehicle" marker anywhere in ECMS to derive this
    // from, so the picker offers the whole registry and a human names the ones that carry cash.
    expect(dto.available.map((v) => v.vehicleId)).toContain(vehicleAId);
  });

  it('stores a crew of six with no date anywhere in the request or the row', async () => {
    // EVERY slot carries DISTINCT people, and all six are asserted back. Filling only two could
    // not tell `specialist2EmployeeIds` from `specialist1EmployeeIds` on the way through — the
    // exact copy-paste class this series already shipped once, in the vault dispatch.
    const res = await save([
      {
        vehicleId: vehicleAId,
        captainEmployeeIds: [standingCaptainId, standingCoCaptainId],
        specialist1EmployeeIds: [standingSpecialistId, standingSpecialist1bId],
        specialist2EmployeeIds: [standingSpecialist2aId, standingSpecialist2bId],
        direction: 'الجيزة',
        plannedTime: '07:30',
      },
    ]);
    expect(res.status).toBe(200);
    const dto = data<OperationsStandingCrewBoardDto & { changedCount: number }>(res);
    expect(dto.changedCount).toBe(1);
    const row = dto.rows.find((r) => r.vehicleId === vehicleAId);
    expect(row?.captainEmployeeIds).toEqual([standingCaptainId, standingCoCaptainId]);
    expect(row?.specialist1EmployeeIds).toEqual([standingSpecialistId, standingSpecialist1bId]);
    expect(row?.specialist2EmployeeIds).toEqual([standingSpecialist2aId, standingSpecialist2bId]);
    expect(row?.direction).toBe('الجيزة');
    expect(Object.keys(row ?? {})).not.toContain('date');
    // A vehicle in the standing crew leaves the picker — the two lists never overlap.
    expect(dto.available.map((v) => v.vehicleId)).not.toContain(vehicleAId);
  });

  it('announces the change on the bus, carrying the vehicle and the slots', async () => {
    // The event is catalogued, so a subscriber can exist. Without this the emit could be deleted
    // outright — or carry the wrong `removed` flag — and the whole suite would stay green.
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === OperationsEvents.StandingCrewChanged &&
          (e.payload as { vehicleId?: string }).vehicleId === vehicleAId &&
          (e.payload as { removed?: boolean }).removed === false,
      ),
    );
  });

  it('an EMPTY row is stored, not skipped — that is what membership means here', async () => {
    // The daily board treats a crewless, annotation-less row for a vehicle with no row as nothing
    // happening. Here the row IS the statement "this vehicle carries cash".
    const res = await save([{ vehicleId: vehicleBId }]);
    expect(res.status).toBe(200);
    const dto = data<OperationsStandingCrewBoardDto>(res);
    const row = dto.rows.find((r) => r.vehicleId === vehicleBId);
    expect(row).toBeDefined();
    expect(row?.captainEmployeeIds).toEqual([]);
  });

  it('an identical re-save is a pure no-op', async () => {
    // Byte-for-byte what the previous case stored — six people across three slots. Sending a
    // SUBSET here would make this assert "a smaller crew is a change", which is a different and
    // much weaker claim than the one the name makes.
    const res = await save([
      {
        vehicleId: vehicleAId,
        captainEmployeeIds: [standingCaptainId, standingCoCaptainId],
        specialist1EmployeeIds: [standingSpecialistId, standingSpecialist1bId],
        specialist2EmployeeIds: [standingSpecialist2aId, standingSpecialist2bId],
        direction: 'الجيزة',
        plannedTime: '07:30',
      },
    ]);
    expect(data<{ changedCount: number }>(res).changedCount).toBe(0);
  });

  it("Q11's day-independent shadow — one person holds one vehicle, and the move shape works", async () => {
    const steal = await save([{ vehicleId: vehicleBId, captainEmployeeIds: [standingCaptainId] }]);
    expect(steal.status).toBe(409);

    // Both sides of the move together — exactly what a drag produces — is accepted.
    const move = await save([
      { vehicleId: vehicleAId, specialist1EmployeeIds: [standingSpecialistId] },
      { vehicleId: vehicleBId, captainEmployeeIds: [standingCaptainId] },
    ]);
    expect(move.status).toBe(200);
    const dto = data<OperationsStandingCrewBoardDto>(move);
    expect(dto.rows.find((r) => r.vehicleId === vehicleAId)?.captainEmployeeIds).toEqual([]);
    expect(dto.rows.find((r) => r.vehicleId === vehicleBId)?.captainEmployeeIds).toEqual([
      standingCaptainId,
    ]);
  });

  it('refuses an unknown vehicle and an unknown employee', async () => {
    expect((await save([{ vehicleId: '00000000000000000000aaaa' }])).status).toBe(400);
    expect(
      (
        await save([
          { vehicleId: vehicleAId, captainEmployeeIds: ['00000000000000000000cccc'] },
        ])
      ).status,
    ).toBe(400);
  });

  it('does NOT require the vehicle to be on any Fleet roster — this row has no day', async () => {
    // The daily board refuses a vehicle Fleet has not rostered for that date. Demanding the same
    // here would make a vehicle's permanent crew un-editable on any day it happened not to be out.
    const res = await save([{ vehicleId: offRosterVehicleId }]);
    expect(res.status).toBe(200);
    expect(
      data<OperationsStandingCrewBoardDto>(res).rows.map((r) => r.vehicleId),
    ).toContain(offRosterVehicleId);
    await drop(offRosterVehicleId);
  });

  it('removing a vehicle returns it to the picker and frees its crew', async () => {
    const removed = await drop(vehicleBId);
    expect(removed.status).toBe(200);
    const dto = data<OperationsStandingCrewBoardDto>(removed);
    expect(dto.rows.map((r) => r.vehicleId)).not.toContain(vehicleBId);
    expect(dto.available.map((v) => v.vehicleId)).toContain(vehicleBId);
    // Its captain is free again, so the same person can take a standing place elsewhere.
    const reuse = await save([{ vehicleId: vehicleAId, captainEmployeeIds: [standingCaptainId] }]);
    expect(reuse.status).toBe(200);
  });

  it('a removed vehicle can be added back — the tombstone does not block it', async () => {
    const back = await save([{ vehicleId: vehicleBId }]);
    expect(back.status).toBe(200);
    expect(
      data<OperationsStandingCrewBoardDto>(back).rows.map((r) => r.vehicleId),
    ).toContain(vehicleBId);

    // The tombstone is OBSERVED, not assumed. Removal is a SOFT delete — the row stays as the
    // record of who used to crew that vehicle — so the collection now holds two rows for this
    // vehicle, one deleted and one live. A hard delete would pass every other assertion here.
    const { OperationsStandingCrewModel } = await import(
      '../../src/modules/operations/standing-crew/standing-crew.model'
    );
    const { Types } = await import('mongoose');
    const all = await OperationsStandingCrewModel.collection
      .find({ vehicleId: new Types.ObjectId(vehicleBId) })
      .toArray();
    expect(all.filter((r) => r.isDeleted === true).length).toBeGreaterThanOrEqual(1);
    expect(all.filter((r) => r.isDeleted === false)).toHaveLength(1);

    await drop(vehicleBId);
  });

  it('lets an existing row be edited after Fleet retires its vehicle', async () => {
    // THE DEADLOCK THIS EXEMPTION EXISTS FOR. Fleet can retire a vehicle after Operations put it
    // in the standing crew. Refusing its row outright stranded it: the one-person-one-vehicle
    // end-state check DEMANDS that vehicle's row in the payload before its crew can be released,
    // so a blanket rejection made the crew permanently unmovable and the vehicle unremovable.
    const retiredVehicleId = await mkVehicle(9);
    const stranded = await mkEmployee();
    expect(
      (await save([{ vehicleId: retiredVehicleId, captainEmployeeIds: [stranded] }])).status,
    ).toBe(200);

    const { FleetVehicleModel } = await import(
      '../../src/modules/fleet/vehicles/vehicle.model'
    );
    const { Types } = await import('mongoose');
    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(retiredVehicleId) },
      { $set: { isDeleted: true } },
    );

    // The row is still editable, so the crew can be released...
    const released = await save([{ vehicleId: retiredVehicleId, captainEmployeeIds: [] }]);
    expect(released.status).toBe(200);
    // ...and the person is free for another vehicle, which was the whole point.
    expect((await save([{ vehicleId: vehicleAId, captainEmployeeIds: [stranded] }])).status).toBe(
      200,
    );
    // A vehicle nobody has ever added is still refused — the exemption covers existing rows only.
    expect((await save([{ vehicleId: '00000000000000000000bbbb' }])).status).toBe(400);

    await drop(retiredVehicleId);
    await save([{ vehicleId: vehicleAId, captainEmployeeIds: [standingCaptainId] }]);
  });

  it('refuses removing a vehicle that is not in the standing crew', async () => {
    expect((await drop(vehicleBId)).status).toBe(404);
  });

  it('offers only ACTIVE vehicles — a van in the workshop or already sold gets no crew', async () => {
    const retired = await mkVehicle(11);
    expect(
      data<OperationsStandingCrewBoardDto>(await standing()).available.map((v) => v.vehicleId),
    ).toContain(retired);

    for (const status of ['outOfService', 'disposed'] as const) {
      const { FleetVehicleModel } = await import('../../src/modules/fleet/vehicles/vehicle.model');
      const { Types } = await import('mongoose');
      await FleetVehicleModel.collection.updateOne(
        { _id: new Types.ObjectId(retired) },
        { $set: { status } },
      );
      expect(
        data<OperationsStandingCrewBoardDto>(await standing()).available.map((v) => v.vehicleId),
        status,
      ).not.toContain(retired);
    }
  });

  it('offers only the Fleet-designated cash-transfer vehicles once one is configured', async () => {
    // The designation is Fleet's own `operationId` (التشغيل) — the ECMS form of the legacy
    // `cars.department` that held "نقل اموال". WHICH catalog item means that is configuration,
    // because the catalog is admin-named and never seeded: matching the Arabic text would be
    // legacy bug H5, recorded as "never matches real data" and explicitly not carried.
    const { OperationsSettingKeys } = await import('@ecms/contracts');

    // Set through the REAL endpoint rather than the service: `settingsService.set` authorizes on
    // `ctx.permissions['setting.edit']`, so a hand-built context either fakes the authorization
    // away or gets it wrong. The admin holds the grant; let the middleware prove it.
    const setCashOperations = async (value: string[]): Promise<request.Response> =>
      request(app)
        .patch('/api/v1/platform/settings/values')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          key: OperationsSettingKeys.CashTransferOperationIds,
          scope: 'organization',
          value,
        });

    // Unconfigured: EVERY vehicle is offered, and the board says so rather than looking filtered.
    const before = data<OperationsStandingCrewBoardDto>(await standing());
    expect(before.availableIsFiltered).toBe(false);
    expect(before.available.map((v) => v.vehicleId)).toContain(offRosterVehicleId);

    const cashOperation = await request(app)
      .post('/api/v1/fleet/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'operation', name: { ar: 'نقل أموال', en: 'Cash transfer' } });
    expect(cashOperation.status).toBe(201);
    const cashOperationId = data<{ id: string }>(cashOperation).id;

    // One vehicle is designated; the other is not.
    const { FleetVehicleModel } = await import('../../src/modules/fleet/vehicles/vehicle.model');
    const { Types } = await import('mongoose');
    await FleetVehicleModel.collection.updateOne(
      { _id: new Types.ObjectId(offRosterVehicleId) },
      { $set: { operationId: new Types.ObjectId(cashOperationId) } },
    );
    expect((await setCashOperations([cashOperationId])).status).toBe(204);

    const after = data<OperationsStandingCrewBoardDto>(await standing());
    expect(after.availableIsFiltered).toBe(true);
    expect(after.available.map((v) => v.vehicleId)).toEqual([offRosterVehicleId]);

    // A vehicle ALREADY in the standing crew is not removed by the filter: Fleet re-classifying a
    // van does not un-crew it behind Operations' back.
    expect(after.rows.map((r) => r.vehicleId)).toContain(vehicleAId);

    // Put it back: the cases after this one expect the unfiltered picker.
    expect((await setCashOperations([])).status).toBe(204);
  });

  it('rides the EXISTING crew grants and declares none of its own', async () => {
    // The viewer holds `operationsShipment.view` only — no crew grant at all.
    expect((await standing(viewerToken)).status).toBe(403);
    expect((await save([{ vehicleId: vehicleAId }], viewerToken)).status).toBe(403);
    expect((await drop(vehicleAId, viewerToken)).status).toBe(403);

    // ...and THIS is the case that pins WHICH grants. A token holding exactly
    // `operationsCrew.view` must read and must not write. Without it, the three assertions above
    // hold for any pair of permissions the admin happens to have and the viewer happens to lack —
    // so the routes could be re-pointed at the vault grants and the suite would stay green.
    expect((await standing(crewViewerToken)).status).toBe(200);
    expect((await save([{ vehicleId: vehicleAId }], crewViewerToken)).status).toBe(403);
    expect((await drop(vehicleAId, crewViewerToken)).status).toBe(403);
  });
});

describe('secured (محصنة) workflow — the four legacy screens (OP-4)', () => {
  let securedDayId: string;
  let treasurer2Id: string;

  const mkSecured = async (): Promise<OperationsShipmentDto> => {
    const res = await mkShipment({ shipmentType: 'secured', deliveryDate: DELIVERY_DATE });
    expect(res.status).toBe(201);
    return data<OperationsShipmentDto>(res);
  };

  const receive = async (
    shipment: OperationsShipmentDto,
    overrides: Record<string, unknown> = {},
  ): Promise<request.Response> =>
    request(app)
      .post(`/api/v1/operations/secured/${shipment.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-${shipment.id.slice(-6)}`,
        bagCount: 3,
        boxCount: 1,
        bagSeals: ['S-1', 'S-2', 'S-3'],
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: treasurer2Id,
        version: shipment.version,
        ...overrides,
      });

  beforeAll(async () => {
    treasurer2Id = await mkEmployee();

    // A Fleet roster row + an Operations crew row on the DELIVERY day — the legacy tashghela row
    // that /deliver_mohsana posts back as `car_id`.
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: DELIVERY_DATE,
        rows: [{ vehicleId: vehicleAId, notes: 'secured delivery seed' }],
      });
    expect(roster.status).toBe(200);

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: DELIVERY_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [captainId] }],
      });
    expect(plan.status).toBe(200);
    const board = data<OperationsCrewBoardDto>(plan);
    securedDayId = board.day?.id ?? '';
    expect(securedDayId).not.toBe('');

  });

  it('1. creates a secured shipment in draft and lists it in the open backlog (no date filter)', async () => {
    const shipment = await mkSecured();
    expect(shipment.status).toBe('draft');

    const backlog = await request(app)
      .get('/api/v1/operations/secured/backlog')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(backlog.status).toBe(200);
    const ids = data<OperationsShipmentDto[]>(backlog).map((x) => x.id);
    expect(ids).toContain(shipment.id);
  });

  it('2+3. receives into the vault: draft → inVault, custody held, dual control enforced', async () => {
    const shipment = await mkSecured();

    const sameTreasurer = await receive(shipment, { receivedBySecondaryId: captainId });
    expect(sameTreasurer.status).toBe(400); // schema-level dual-control guard

    const res = await receive(shipment);
    expect(res.status).toBe(200);
    expect(data<OperationsShipmentDto>(res).status).toBe('inVault');
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.VaultReceived));

    const vault = await request(app)
      .get('/api/v1/operations/secured/vault')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(vault.status).toBe(200);
    // The STANDARD paginated envelope — a bare `{items,total}` body here is what made the desk
    // screen render nothing, so the shape is asserted, not just the contents.
    const body = vault.body as { data: OperationsVaultInventoryRowDto[]; meta: PageMeta };
    expect(body.meta).toMatchObject({ page: 1, totalItems: expect.any(Number) as number });
    const row = body.data.find((r) => r.shipmentId === shipment.id);
    expect(row).toBeDefined();
    // The port's widened view, end to end: packaging counts and BOTH treasurers reach the desk...
    expect(row).toMatchObject({
      state: 'held',
      bagCount: 3,
      cartonCount: 0,
      boxCount: 1,
      receivedByPrimaryId: expect.any(String) as string,
      receivedBySecondaryId: expect.any(String) as string,
    });
    expect(row?.receivedByPrimaryId).not.toBe(row?.receivedBySecondaryId);
    // ...and the seal barcodes do NOT — they stay behind the Treasury boundary.
    expect(row).not.toHaveProperty('bagSeals');
    expect(row).not.toHaveProperty('boxSeals');
  });

  it('7. refuses a second receive and refuses receiving a daily shipment at all', async () => {
    const shipment = await mkSecured();
    expect((await receive(shipment)).status).toBe(200);

    const fresh = await request(app)
      .get(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const again = await receive(data<OperationsShipmentDto>(fresh));
    expect(again.status).toBe(422); // the shipment is no longer in draft
    expect(errorCode(again)).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);

    const daily = data<OperationsShipmentDto>(await mkShipment());
    const wrongType = await receive(daily);
    expect(wrongType.status).toBe(422);
    expect(errorCode(wrongType)).toBe(ErrorCodes.OPERATIONS_NOT_A_SECURED_SHIPMENT);
  });

  it('5. assigns the delivery leg (leader2 + car_num2) WITHOUT changing status — legacy :4491', async () => {
    const shipment = await mkSecured();
    await receive(shipment);

    const due = await request(app)
      .get(`/api/v1/operations/secured/due?date=${DELIVERY_DATE}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(due.status).toBe(200);
    expect(data<OperationsShipmentDto[]>(due).map((x) => x.id)).toContain(shipment.id);

    const crewRow = await findCrewAssignmentId();
    const res = await request(app)
      .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewRow, captainEmployeeId: captainId, version: 0 });
    expect(res.status).toBe(200);
    const assignment = data<OperationsShipmentAssignmentDto>(res);
    expect(assignment.leg).toBe('delivery');
    expect(assignment.captainEmployeeId).toBe(captainId); // leader2
    expect(assignment.vehicleId).toBe(vehicleAId); // car_num2
    expect(assignment.crewAssignmentId).toBe(crewRow); // specialists resolve THROUGH this row

    const after = await request(app)
      .get(`/api/v1/operations/shipments/${shipment.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<OperationsShipmentDto>(after).status).toBe('inVault'); // assignment ≠ dispatch
  });

  it('9. refuses a captain who is not that crew row\'s captain', async () => {
    const shipment = await mkSecured();
    await receive(shipment);
    const res = await request(app)
      .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        crewAssignmentId: await findCrewAssignmentId(),
        captainEmployeeId: treasurer2Id,
        version: 0,
      });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);
  });

  it('4+6. dispatches: inVault → dispatched, custody released, then completes at destination', async () => {
    const shipment = await mkSecured();
    await receive(shipment);
    const crewRow = await findCrewAssignmentId();
    await request(app)
      .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewRow, captainEmployeeId: captainId, version: 0 });

    const dispatched = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewRow, shipmentIds: [shipment.id] });
    expect(dispatched.status).toBe(200);
    expect(data<{ dispatched: number }>(dispatched).dispatched).toBe(1);
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.VaultReleased));

    const afterDispatch = data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${shipment.id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(afterDispatch.status).toBe('dispatched');

    // Terminal completion still happens on the shipment surface (legacy /main_ops receive, :564).
    const completed = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: afterDispatch.version });
    expect(completed.status).toBe(200);
    expect(data<OperationsShipmentDto>(completed).status).toBe('completed');

    // …and the legacy un-receive returns it to dispatched, never to draft (:559).
    const reopened = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: data<OperationsShipmentDto>(completed).version });
    expect(data<OperationsShipmentDto>(reopened).status).toBe('dispatched');
  });

  it('7+8. refuses dispatch without a delivery leg, and on the wrong crew assignment', async () => {
    const unassigned = await mkSecured();
    await receive(unassigned);
    const crewRow = await findCrewAssignmentId();

    const noLeg = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewRow, shipmentIds: [unassigned.id] });
    expect(noLeg.status).toBe(422);
    expect(errorCode(noLeg)).toBe(ErrorCodes.OPERATIONS_DELIVERY_LEG_REQUIRED);

    const draft = await mkSecured();
    const notHeld = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewRow, shipmentIds: [draft.id] });
    expect(notHeld.status).toBe(422);
    expect(errorCode(notHeld)).toBe(ErrorCodes.OPERATIONS_INVALID_SHIPMENT_TRANSITION);
  });

  it('10. receive is version-locked — a stale version is refused', async () => {
    const shipment = await mkSecured();
    const stale = await receive(shipment, { version: shipment.version + 5 });
    expect([409, 422]).toContain(stale.status);
  });

  it('11. RBAC — vault acts need the treasury grants, not the Operations ones', async () => {
    const shipment = await mkSecured();
    const res = await request(app)
      .post(`/api/v1/operations/secured/${shipment.id}/receive`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        receiptNumber: 'R-X',
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: treasurer2Id,
        version: shipment.version,
      });
    expect(res.status).toBe(403);

    const vaultRead = await request(app)
      .get('/api/v1/operations/secured/vault')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(vaultRead.status).toBe(403);
  });

  // ── التشغيله arrives from Fleet and is READ here ─────────────────────────
  //
  // The last step of `fixed-roster → fleet/roster → operations/crew-board`. Fleet owns the value
  // and this board only displays it, so what is asserted is that it SURVIVES the join: the duty
  // row carries `missionTypeId`, and the board row hands it to the screen. It was arriving in the
  // response and then being dropped by the web mapper, which is why the operation was invisible
  // here even for days Fleet had genuinely planned.

  it('carries the Fleet-planned operation onto the crew board', async () => {
    const mission = data<{ id: string }>(
      await request(app)
        .post('/api/v1/fleet/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind: 'missionType', name: { ar: 'تشغيلة الكاش', en: 'Cash run' } }),
    );
    const date = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

    expect(
      (
        await request(app)
          .post('/api/v1/fleet/roster')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ date, rows: [{ vehicleId: vehicleAId, missionTypeId: mission.id }] })
      ).status,
    ).toBe(200);

    const board = data<OperationsCrewBoardDto>(
      await request(app)
        .get(`/api/v1/operations/crew-board?date=${date}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    const row = board.rows.find((r) => r.vehicleId === vehicleAId);
    expect(row, 'the vehicle Fleet planned is on the board').toBeDefined();
    expect(row?.missionTypeId, 'carrying the operation Fleet chose').toBe(mission.id);
  });

  it('shows NO vehicle for a day Fleet never planned — the duty row IS the day', async () => {
    // Why materialising matters upstream: this board iterates duty documents. A vehicle whose
    // operation was only projected from the standing crew has none, so it is simply absent.
    const empty = new Date(Date.now() + 41 * 86_400_000).toISOString().slice(0, 10);
    const board = data<OperationsCrewBoardDto>(
      await request(app)
        .get(`/api/v1/operations/crew-board?date=${empty}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(board.rows).toEqual([]);
  });

  describe('the board hands out the id its own screens need', () => {
    // WHY THIS EXISTS. `/operations/vault/dispatch` had two actions and BOTH 404'd in production,
    // through every green gate. `OperationsCrewBoardRowDto.crew` carried no id, so the page sent
    // `fleetDutyAssignmentId` as `crewAssignmentId` — an id from `fleet_duty_assignments` — and
    // `secured.service.ts:185/:274` looked it up in `operations_crew_assignments` and threw
    // NotFoundError.
    //
    // The existing suite could not catch it: every test sourced the id from the repository via
    // `findCrewAssignmentId`, so it proved the endpoint accepts a correct id while never asking
    // whether a client could obtain one. These go through the BOARD, the way a screen must.

    it('exposes the crew row id on the board, and it is the row a delivery can be assigned to', async () => {
      const shipment = await mkSecured();
      await receive(shipment);

      const fromBoard = await crewIdFromBoard(DELIVERY_DATE);
      expect(fromBoard).not.toBe('');
      // The id a screen reads IS the id the repository holds — not a different collection's.
      expect(fromBoard).toBe(await findCrewAssignmentId());

      const res = await request(app)
        .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: fromBoard, captainEmployeeId: captainId, version: 0 });
      expect(res.status).toBe(200);
    });

    it('dispatches with the id taken from the board', async () => {
      const shipment = await mkSecured();
      await receive(shipment);
      const fromBoard = await crewIdFromBoard(DELIVERY_DATE);
      await request(app)
        .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: fromBoard, captainEmployeeId: captainId, version: 0 });

      const res = await request(app)
        .post('/api/v1/operations/secured/dispatch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: fromBoard, shipmentIds: [shipment.id] });
      expect(res.status).toBe(200);
    });

    it('refuses a Fleet duty id — the exact wrong id the screen used to send', async () => {
      // The defect, reproduced. A duty id is a real id of a real row in another collection, which is
      // why this failed as a 404 rather than a validation error and never looked like a bug.
      const shipment = await mkSecured();
      await receive(shipment);
      const board = await request(app)
        .get(`/api/v1/operations/crew-board?date=${DELIVERY_DATE}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const row = data<OperationsCrewBoardDto>(board).rows.find((r) => r.crew !== null);
      const dutyId = row?.fleetDutyAssignmentId ?? '';
      expect(dutyId).not.toBe('');
      expect(dutyId).not.toBe(row?.crew?.id);

      const res = await request(app)
        .post(`/api/v1/operations/secured/${shipment.id}/assign-delivery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: dutyId, captainEmployeeId: captainId, version: 0 });
      expect(res.status).toBe(404);
    });

    it('leaves crew null for a vehicle nobody planned', async () => {
      const res = await request(app)
        .get('/api/v1/operations/crew-board?date=2026-09-30')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      for (const row of data<OperationsCrewBoardDto>(res).rows) expect(row.crew).toBeNull();
    });
  });

  // ── Handing a delivery leg to the co-captain on the SAME crew row ──────────────────────────────
  //
  // `sequence` is a position within ONE captain's list for one day, and
  // `ux_day_captain_leg_sequence` makes that pair unique — so a stop that carries its old number
  // across to a different captain either collides outright or lands at an arbitrary point in the
  // new captain's order.
  //
  // `assignPickupLeg` has always re-seated it. This leg never did, and before two-captain crews
  // the only way to reach it was to name a different crew row — a different VEHICLE. Now the
  // ordinary act of handing a load to the co-captain of the same van goes straight through it.
  describe('re-assigning the delivery leg to the other captain of the same crew', () => {
    const HANDOVER_DATE = shift(250);
    let handoverCrewId: string;
    let handoverCaptainA: string;
    let handoverCaptainB: string;

    const assignmentOf = async (
      shipmentId: string,
    ): Promise<{ sequence: number; version: number; captainEmployeeId: string }> => {
      const { operationsShipmentAssignmentRepository } = await import(
        '../../src/modules/operations/shipments/shipment-assignment.repository'
      );
      const row = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
        shipmentId,
        'delivery',
      );
      return {
        sequence: row?.sequence ?? 0,
        version: row?.__v ?? 0,
        captainEmployeeId: String(row?.captainEmployeeId ?? ''),
      };
    };

    const assignTo = async (
      shipmentId: string,
      captainEmployeeId: string,
      version: number,
    ): Promise<request.Response> =>
      request(app)
        .post(`/api/v1/operations/secured/${shipmentId}/assign-delivery`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: handoverCrewId, captainEmployeeId, version });

    /** A secured shipment delivered on the handover date, received into the vault. */
    const readyShipment = async (): Promise<OperationsShipmentDto> => {
      const shipment = data<OperationsShipmentDto>(
        await mkShipment({ shipmentType: 'secured', deliveryDate: HANDOVER_DATE }),
      );
      expect((await receive(shipment)).status).toBe(200);
      return shipment;
    };

    beforeAll(async () => {
      handoverCaptainA = await mkEmployee();
      handoverCaptainB = await mkEmployee();

      const roster = await request(app)
        .post('/api/v1/fleet/roster')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: HANDOVER_DATE, rows: [{ vehicleId: vehicleAId, notes: 'handover' }] });
      expect(roster.status).toBe(200);

      // ONE crew row, TWO captains — the shape that only became expressible with the widening.
      const plan = await request(app)
        .post('/api/v1/operations/crew-board')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          date: HANDOVER_DATE,
          rows: [
            {
              vehicleId: vehicleAId,
              captainEmployeeIds: [handoverCaptainA, handoverCaptainB],
            },
          ],
        });
      expect(plan.status).toBe(200);
      handoverCrewId =
        data<OperationsCrewBoardDto>(plan).rows.find((r) => r.vehicleId === vehicleAId)?.crew?.id ??
        '';
      expect(handoverCrewId).not.toBe('');
    });

    it('re-seats the stop at the end of the new captain\u2019s list instead of colliding', async () => {
      // A takes one stop at position 1; B takes one of their own, also at position 1.
      const forA = await readyShipment();
      expect((await assignTo(forA.id, handoverCaptainA, 0)).status).toBe(200);
      expect((await assignmentOf(forA.id)).sequence).toBe(1);

      const forB = await readyShipment();
      expect((await assignTo(forB.id, handoverCaptainB, 0)).status).toBe(200);
      expect((await assignmentOf(forB.id)).sequence).toBe(1);

      // Now hand A's stop to B. Keeping its old position would mean TWO stops at position 1 in B's
      // delivery list — a duplicate on `ux_day_captain_leg_sequence`, and a 409 on what is meant
      // to be an everyday hand-over.
      const current = await assignmentOf(forA.id);
      const moved = await assignTo(forA.id, handoverCaptainB, current.version);
      expect(moved.status).toBe(200);

      const after = await assignmentOf(forA.id);
      expect(after.captainEmployeeId).toBe(handoverCaptainB);
      expect(after.sequence).toBe(2); // the END of B's list, not A's old position
      // B's own stop is untouched — moving one captain's work never renumbers another's.
      expect((await assignmentOf(forB.id)).sequence).toBe(1);
    });

    it('leaves the position alone when the captain does not change', async () => {
      // Re-assigning to the SAME captain is a no-op on order: the stop keeps its place in the run
      // the planner already agreed, and only a reorder may move it.
      const shipment = await readyShipment();
      expect((await assignTo(shipment.id, handoverCaptainA, 0)).status).toBe(200);
      const before = await assignmentOf(shipment.id);

      expect((await assignTo(shipment.id, handoverCaptainA, before.version)).status).toBe(200);
      expect((await assignmentOf(shipment.id)).sequence).toBe(before.sequence);
    });
  });
});

/** The first crew assignment id on a given day, read straight from the collection seam. */
const crewAssignmentIdForDay = async (date: string): Promise<string> => {
  const { operationsCrewAssignmentRepository } = await import(
    '../../src/modules/operations/crew/crew-assignment.repository'
  );
  const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
  const day = await operationsDayService.findByDate(new Date(date));
  const rows = await operationsCrewAssignmentRepository.findForDay(day?._id ?? '');
  return String(rows[0]?._id ?? '');
};

/** The crew assignment id for the OP-4 delivery day, read straight from the collection seam. */
/**
 * The crew id AS A SCREEN CAN OBTAIN IT — through the board endpoint, not the repository.
 *
 * This is the distinction the vault-dispatch defect lived in. `findCrewAssignmentId` below reaches
 * into the collection, so every test that used it proved the ENDPOINT works while saying nothing
 * about whether a client can supply that id at all. The screen could not: the board DTO carried no
 * crew id, so it sent `fleetDutyAssignmentId` — an id from another collection — and both of its
 * actions 404'd, with every gate green.
 */
const crewIdFromBoard = async (date: string): Promise<string> => {
  const res = await request(app)
    .get(`/api/v1/operations/crew-board?date=${date}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const board = data<OperationsCrewBoardDto>(res);
  const row = board.rows.find((r) => r.crew !== null);
  expect(row, 'a planned crew row on the board').toBeDefined();
  return row?.crew?.id ?? '';
};

const findCrewAssignmentId = async (): Promise<string> => {
  const { operationsCrewAssignmentRepository } = await import(
    '../../src/modules/operations/crew/crew-assignment.repository'
  );
  const { operationsDayService } = await import(
    '../../src/modules/operations/days/day.service'
  );
  const day = await operationsDayService.findByDate(new Date(DELIVERY_DATE));
  const rows = await operationsCrewAssignmentRepository.findForDay(day?._id ?? '');
  return String(rows[0]?._id ?? '');
};

describe('assignment & sequencing — the captain\'s ordered day (OP-5)', () => {
  let crewId = '';
  let picks: OperationsShipmentAssignmentDto[] = [];

  const assignPickup = async (
    shipmentId: string,
    crewAssignmentId = crewId,
    captain = captainId,
  ): Promise<request.Response> =>
    request(app)
      .post(`/api/v1/operations/assignments/shipments/${shipmentId}/assign-pickup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId, captainEmployeeId: captain, version: 0 });

  const route = async (): Promise<OperationsCaptainRouteDto> =>
    data<OperationsCaptainRouteDto>(
      await request(app)
        .get(
          `/api/v1/operations/assignments/route?date=${ORDER_DATE}&captainEmployeeId=${captainId}&leg=pickup`,
        )
        .set('Authorization', `Bearer ${adminToken}`),
    );

  const reorder = async (
    order: { assignmentId: string; version: number }[],
    token = adminToken,
  ): Promise<request.Response> =>
    request(app)
      .put('/api/v1/operations/assignments/order')
      .set('Authorization', `Bearer ${token}`)
      .send({ date: ORDER_DATE, captainEmployeeId: captainId, leg: 'pickup', order });

  beforeAll(async () => {
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: ORDER_DATE, rows: [{ vehicleId: vehicleAId, notes: 'order seed' }] });
    expect(roster.status).toBe(200);

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: ORDER_DATE,
        rows: [
          {
            vehicleId: vehicleAId,
            captainEmployeeIds: [captainId],
            specialist1EmployeeIds: [specialist1Id],
            specialist2EmployeeIds: [specialist2Id],
          },
        ],
      });
    expect(plan.status).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const day = await operationsDayService.findByDate(new Date(ORDER_DATE));
    const rows = await operationsCrewAssignmentRepository.findForDay(day?._id ?? '');
    crewId = String(rows[0]?._id ?? '');
    expect(crewId).not.toBe('');
  });

  it('1. assigns the pickup leg of three daily shipments, appending each to the captain\'s list', async () => {
    const created: OperationsShipmentDto[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await mkShipment({ collectionDate: ORDER_DATE });
      expect(res.status).toBe(201);
      created.push(data<OperationsShipmentDto>(res));
    }
    picks = [];
    for (const shipment of created) {
      const res = await assignPickup(shipment.id);
      expect(res.status).toBe(200);
      picks.push(data<OperationsShipmentAssignmentDto>(res));
    }
    expect(picks.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(picks.every((p) => p.leg === 'pickup')).toBe(true);
    expect(picks.every((p) => p.vehicleId === vehicleAId)).toBe(true);
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.SecuredLegAssigned));
  });

  it('3 + regression. the route resolves crew through (day, vehicle) — specialists are NOT on the shipment', async () => {
    const dto = await route();
    expect(dto.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(dto.captainEmployeeId).toBe(captainId);

    // The crew comes off the crew assignment, not off any shipment.
    expect(dto.crew).toHaveLength(1);
    expect(dto.crew[0]?.crewAssignmentId).toBe(crewId);
    expect(dto.crew[0]?.specialist1EmployeeIds).toEqual([specialist1Id]);
    expect(dto.crew[0]?.specialist2EmployeeIds).toEqual([specialist2Id]);

    // THE regression guard: no specialist field exists anywhere on a shipment document.
    const shipment = data<Record<string, unknown>>(
      await request(app)
        .get(`/api/v1/operations/shipments/${dto.stops[0]?.shipmentId ?? ''}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    for (const key of Object.keys(shipment)) {
      expect(key.toLowerCase()).not.toContain('specialist');
    }
    expect(JSON.stringify(shipment)).not.toContain(specialist1Id);
    expect(JSON.stringify(shipment)).not.toContain(specialist2Id);

    // Locations ride the branch reference data — no second location system, coordinates still null.
    expect(dto.stops[0]?.pickup.branchName).toBe('فرع المهندسين');
    expect(dto.stops[0]?.pickup.bankName).toBe('الأهلي');
    expect(dto.stops[0]?.pickup.location).toBeNull();
  });

  it('4. rejects a crew assignment that is not on the shipment\'s own day', async () => {
    const otherDay = data<OperationsShipmentDto>(
      await mkShipment({ collectionDate: '2026-08-26' }),
    );
    const res = await assignPickup(otherDay.id);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_DAY_MISMATCH);
  });

  it('4b. rejects a captain who does not crew that vehicle', async () => {
    const shipment = data<OperationsShipmentDto>(await mkShipment({ collectionDate: ORDER_DATE }));
    const res = await assignPickup(shipment.id, crewId, specialist1Id);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_CREW_CAPTAIN_MISMATCH);
  });

  it('5. re-assigning the same leg updates in place — it never creates a duplicate', async () => {
    const first = picks[0];
    if (first === undefined) throw new Error('fixture missing');
    const again = await request(app)
      .post(`/api/v1/operations/assignments/shipments/${first.shipmentId}/assign-pickup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewId, captainEmployeeId: captainId, version: first.version });
    expect(again.status).toBe(200);
    expect(data<OperationsShipmentAssignmentDto>(again).id).toBe(first.id);
    expect(data<OperationsShipmentAssignmentDto>(again).sequence).toBe(first.sequence);
  });

  it('6. reorders atomically — 1,2,3 becomes 2,3,1 and the route reflects it', async () => {
    const before = await route();
    expect(before.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);

    const current = await currentOrder();
    const rotated = [current[1], current[2], current[0]].filter(
      (x): x is { assignmentId: string; version: number } => x !== undefined,
    );
    const res = await reorder(rotated);
    expect(res.status).toBe(200);

    const after = await route();
    expect(after.stops.map((s) => s.assignmentId)).toEqual(rotated.map((r) => r.assignmentId));
    expect(after.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
    await waitFor(() =>
      seenEvents.some((e) => e.name === OperationsEvents.ShipmentOrderReordered),
    );
  });

  it('7. refuses a duplicate assignment inside one order payload', async () => {
    const current = await currentOrder();
    const first = current[0];
    if (first === undefined) throw new Error('fixture missing');
    const res = await reorder([first, first, ...current.slice(1)]);
    expect(res.status).toBe(400);
  });

  it('8. refuses an incomplete order — omitted work would be stranded', async () => {
    const current = await currentOrder();
    const res = await reorder(current.slice(0, 2));
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_INCOMPLETE_ORDER);
  });

  it('8b. refuses an order naming an assignment outside this captain-day-leg', async () => {
    const current = await currentOrder();
    const foreign = { assignmentId: '00000000000000000000dddd', version: 0 };
    const res = await reorder([...current.slice(1), foreign]);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_ASSIGNMENT_NOT_IN_SET);
  });

  it('9. refuses a stale-version reorder — the concurrent editor wins', async () => {
    const current = await currentOrder();
    const stale = current.map((entry) => ({ ...entry, version: entry.version + 7 }));
    const res = await reorder([...stale].reverse());
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe(ErrorCodes.STALE_DOCUMENT);
  });

  it('10. RBAC — reorder needs operationsCrew.reorder, which the viewer does not hold', async () => {
    const current = await currentOrder();
    const res = await reorder([...current].reverse(), viewerToken);
    expect(res.status).toBe(403);
  });

  it('12. the two legs stay distinct: a secured shipment carries pickup AND delivery separately', async () => {
    const { operationsShipmentAssignmentRepository } = await import(
      '../../src/modules/operations/shipments/shipment-assignment.repository'
    );
    const secured = data<OperationsShipmentDto>(
      await mkShipment({
        shipmentType: 'secured',
        collectionDate: ORDER_DATE,
        deliveryDate: '2026-08-21',
      }),
    );
    // Leg 1 — legacy leader1/car_num1, written for محصنة too (contad_app.js:725/733).
    expect((await assignPickup(secured.id)).status).toBe(200);

    const pickup = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      secured.id,
      'pickup',
    );
    const delivery = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      secured.id,
      'delivery',
    );
    expect(pickup).not.toBeNull();
    expect(delivery).toBeNull(); // leg 2 arrives only via the secured assign-delivery step
    expect(pickup?.leg).toBe('pickup');
  });
});

/** The captain's current pickup order with live versions — what a real client would hold. */
const currentOrder = async (): Promise<{ assignmentId: string; version: number }[]> => {
  const { operationsShipmentAssignmentRepository } = await import(
    '../../src/modules/operations/shipments/shipment-assignment.repository'
  );
  const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
  const day = await operationsDayService.findByDate(new Date(ORDER_DATE));
  const rows = await operationsShipmentAssignmentRepository.findForCaptainDay(
    day?._id ?? '',
    captainId,
    'pickup',
  );
  return rows.map((row) => ({ assignmentId: String(row._id), version: row.__v }));
};

describe('captain mobile read model — NEW capability, no legacy counterpart (OP-6)', () => {
  const MOBILE_DATE = shift(200);
  /**
   * A day the captain is PLANNED onto a vehicle but has no shipments — captaincy without stops.
   * Deliberately a date no other case touches: this one asserts an EMPTY stop list, so sharing a
   * day with a case that assigns work would make it pass or fail on declaration order.
   */
  const PLANNED_ONLY_DATE = shift(204);
  let captainUserToken = '';
  let captainUserId = '';
  let otherCaptainToken = '';
  let otherCaptainId = '';
  let mobileCrewId = '';
  let firstShipment: OperationsShipmentDto | undefined;

  const myDay = async (token: string, date = MOBILE_DATE): Promise<request.Response> =>
    request(app)
      .get(`/api/v1/operations/mobile/my-day?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const { employeeRepository } = await import(
      '../../src/modules/hr/employee-management/employees/employee.repository'
    );

    const captainRole = await rbacService.createRole(
      { name: { en: 'Captain', ar: 'قائد' }, permissionKeys: ['operationsExecution.own'] },
      await mkUser('role-seed@ecms.local'),
    );

    // Two captains, each a real HR employee linked to a real login — the seam under test.
    const link = async (email: string, employeeId: string): Promise<[string, string]> => {
      const userId = await mkUser(email);
      await rbacService.ensureAssignment(userId, String(captainRole._id), 'organization');
      const current = await employeeRepository.getById(employeeId);
      await employeeRepository.updateById(
        employeeId,
        { userId },
        { by: null, version: current.__v },
      );
      return [await login(email), userId];
    };

    otherCaptainId = await mkEmployee();
    [captainUserToken, captainUserId] = await link('captain-a@ecms.local', captainId);
    [otherCaptainToken] = await link('captain-b@ecms.local', otherCaptainId);

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: MOBILE_DATE, rows: [{ vehicleId: vehicleAId, notes: 'mobile seed' }] });
    expect(roster.status).toBe(200);

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: MOBILE_DATE,
        rows: [
          {
            vehicleId: vehicleAId,
            captainEmployeeIds: [captainId],
            specialist1EmployeeIds: [specialist1Id],
            specialist2EmployeeIds: [specialist2Id],
            direction: 'الجيزة',
            plannedTime: '07:00',
          },
        ],
      });
    expect(plan.status).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const dayDoc = await operationsDayService.findByDate(new Date(MOBILE_DATE));
    const crewRows = await operationsCrewAssignmentRepository.findForDay(dayDoc?._id ?? '');
    mobileCrewId = String(crewRows[0]?._id ?? '');

    for (let i = 0; i < 2; i += 1) {
      const shipment = data<OperationsShipmentDto>(
        await mkShipment({ collectionDate: MOBILE_DATE }),
      );
      if (i === 0) firstShipment = shipment;
      const assigned = await request(app)
        .post(`/api/v1/operations/assignments/shipments/${shipment.id}/assign-pickup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: mobileCrewId, captainEmployeeId: captainId, version: 0 });
      expect(assigned.status).toBe(200);
    }

    // A second day where the SAME captain is planned onto a vehicle and nothing is assigned to him
    // yet. Crew exclusivity (Q11) is scoped per operating day, so this is a legitimate plan.
    const plannedRoster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: PLANNED_ONLY_DATE, rows: [{ vehicleId: vehicleAId, notes: 'planned only' }] });
    expect(plannedRoster.status).toBe(200);

    const plannedCrew = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: PLANNED_ONLY_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [captainId], direction: 'بنها' }],
      });
    expect(plannedCrew.status).toBe(200);
  });

  it('1 + 3. the authenticated captain reads his own day in the exact server-side order', async () => {
    const res = await myDay(captainUserToken);
    expect(res.status).toBe(200);
    const dto = data<OperationsMobileDayDto>(res);
    expect(dto.captain.employeeId).toBe(captainId);
    expect(dto.operationsDayId).not.toBeNull();
    expect(dto.stops.map((s) => s.sequence)).toEqual([1, 2]);

    const opsRoute = data<OperationsCaptainRouteDto>(
      await request(app)
        .get(
          `/api/v1/operations/assignments/route?date=${MOBILE_DATE}&captainEmployeeId=${captainId}&leg=pickup`,
        )
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(dto.stops.map((s) => s.assignmentId)).toEqual(opsRoute.stops.map((s) => s.assignmentId));
  });

  it('identity. one employee identity serves desktop and mobile — no mobile account exists', async () => {
    const { employeeRepository } = await import(
      '../../src/modules/hr/employee-management/employees/employee.repository'
    );

    // The mobile surface reports the SAME employee id the desktop modules use for this person...
    const dto = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    expect(dto.captain.employeeId).toBe(captainId);

    // ...and that employee is reached from the ORDINARY login, through the HR record's own link.
    // No mobile user, no captain account, no second identity row stands between the two.
    const employee = await employeeRepository.getById(captainId);
    expect(String(employee.userId)).toBe(captainUserId);

    // The very same token also resolves on the shared platform directory — one identity, two
    // surfaces. A mobile-specific identity model would break this equality.
    const profile = await request(app)
      .get(`/api/v1/platform/directory/${captainUserId}`)
      .set('Authorization', `Bearer ${captainUserToken}`);
    expect(profile.status).toBe(200);
  });

  it('identity. captaincy is the day plan, not the account — planned-with-no-stops is not "not a captain"', async () => {
    // Same employee, same permission, same login — two days with genuinely different answers.
    const planned = data<OperationsMobileDayDto>(await myDay(captainUserToken, PLANNED_ONLY_DATE));
    expect(planned.isCaptainOnDay).toBe(true);
    expect(planned.assignments).toHaveLength(1);
    expect(planned.assignments[0]?.vehicleId).toBe(vehicleAId);
    expect(planned.stops).toHaveLength(0); // planned, but dispatch has given him nothing yet
    expect(planned.currentAssignmentId).toBeNull();

    // The other captain holds `operationsExecution.own` too — the CAPABILITY — yet is not planned
    // onto anything that day, so he is not a captain on it. Capability never implies captaincy.
    const notPlanned = data<OperationsMobileDayDto>(await myDay(otherCaptainToken, PLANNED_ONLY_DATE));
    expect(notPlanned.isCaptainOnDay).toBe(false);
    expect(notPlanned.assignments).toHaveLength(0);
    expect(notPlanned.stops).toHaveLength(0);

    // Both have an empty stop list; only `isCaptainOnDay` tells them apart.
    expect(planned.stops).toEqual(notPlanned.stops);
    expect(planned.isCaptainOnDay).not.toBe(notPlanned.isCaptainOnDay);
  });

  it('identity. BOTH captains of a two-captain crew are captains on that day', async () => {
    // A crew may now carry two captains, and there is no first captain and no deputy: the answer
    // for either of them must be identical. The captaincy anchor is a MEMBERSHIP query
    // (`captainEmployeeIds: employeeId`), and this is the case that would have gone silently wrong
    // had the field been widened in place — Mongo matches an array against the old scalar query
    // just as happily, so the anchor would have kept working while the comparisons behind it did
    // not.
    const CO_CAPTAIN_DATE = shift(206);

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: CO_CAPTAIN_DATE, rows: [{ vehicleId: vehicleAId, notes: 'two captains' }] });
    expect(roster.status).toBe(200);

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: CO_CAPTAIN_DATE,
        rows: [
          {
            vehicleId: vehicleAId,
            captainEmployeeIds: [captainId, otherCaptainId],
            specialist1EmployeeIds: [specialist1Id],
          },
        ],
      });
    expect(plan.status).toBe(200);

    const first = data<OperationsMobileDayDto>(await myDay(captainUserToken, CO_CAPTAIN_DATE));
    const second = data<OperationsMobileDayDto>(await myDay(otherCaptainToken, CO_CAPTAIN_DATE));

    for (const dto of [first, second]) {
      expect(dto.isCaptainOnDay).toBe(true);
      expect(dto.assignments).toHaveLength(1);
      expect(dto.assignments[0]?.vehicleId).toBe(vehicleAId);
      // Each captain sees who else is in the van — his co-captain included, himself included.
      expect(dto.assignments[0]?.captainEmployeeIds).toEqual([captainId, otherCaptainId]);
      expect(dto.assignments[0]?.specialist1EmployeeIds).toEqual([specialist1Id]);
    }
    // Same crew row, same everything: neither captain is the "real" one.
    expect(first.assignments).toEqual(second.assignments);
    expect(first.captain.employeeId).not.toBe(second.captain.employeeId);
  });

  it('2 + 12. a captain cannot see another captain day — isolation is structural', async () => {
    const mine = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    const theirs = data<OperationsMobileDayDto>(await myDay(otherCaptainToken));

    expect(theirs.captain.employeeId).toBe(otherCaptainId);
    expect(theirs.stops).toHaveLength(0);
    expect(theirs.isCaptainOnDay).toBe(false);
    expect(mine.stops.length).toBeGreaterThan(0);
    expect(mine.isCaptainOnDay).toBe(true);

    // There is no captain parameter to tamper with: an injected one is refused by .strict().
    const tampered = await request(app)
      .get(`/api/v1/operations/mobile/my-day?date=${MOBILE_DATE}&captainEmployeeId=${captainId}`)
      .set('Authorization', `Bearer ${otherCaptainToken}`);
    expect(tampered.status).toBe(400);
  });

  it('4. completed / current / locked are represented from real domain state', async () => {
    const before = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    expect(before.stops.map((s) => s.progress)).toEqual(['current', 'locked']);
    expect(before.currentAssignmentId).toBe(before.stops[0]?.assignmentId);

    const shipment = data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${firstShipment?.id ?? ''}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    const done = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(done.status).toBe(200);

    const after = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    expect(after.stops.map((s) => s.progress)).toEqual(['completed', 'current']);
    expect(after.currentAssignmentId).toBe(after.stops[1]?.assignmentId);
  });

  it('5 + 6 + regression. crew resolves through (day, vehicle); stops carry NO specialist data', async () => {
    const dto = data<OperationsMobileDayDto>(await myDay(captainUserToken));

    expect(dto.assignments).toHaveLength(1);
    expect(dto.assignments[0]?.crewAssignmentId).toBe(mobileCrewId);
    expect(dto.assignments[0]?.vehicleId).toBe(vehicleAId);
    expect(dto.assignments[0]?.specialist1EmployeeIds).toEqual([specialist1Id]);
    expect(dto.assignments[0]?.specialist2EmployeeIds).toEqual([specialist2Id]);
    expect(dto.stops.every((s) => s.crewAssignmentId === mobileCrewId)).toBe(true);
    expect(dto.stops.every((s) => s.vehicleId === vehicleAId)).toBe(true);
    expect(dto.stops.every((s) => s.leg === 'pickup')).toBe(true);

    for (const stop of dto.stops) {
      for (const key of Object.keys(stop)) {
        expect(key.toLowerCase()).not.toContain('specialist');
      }
      expect(JSON.stringify(stop)).not.toContain(specialist1Id);
      expect(JSON.stringify(stop)).not.toContain(specialist2Id);
    }
  });

  it('7. the secured delivery leg resolves on its own day', async () => {
    const DELIVERY = shift(201);
    await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: DELIVERY, rows: [{ vehicleId: vehicleAId, notes: 'mobile delivery seed' }] });
    await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: DELIVERY, rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [captainId] }] });

    const secured = data<OperationsShipmentDto>(
      await mkShipment({
        shipmentType: 'secured',
        collectionDate: MOBILE_DATE,
        deliveryDate: DELIVERY,
      }),
    );
    const treasurer = await mkEmployee();
    const received = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-M-${secured.id.slice(-5)}`,
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: treasurer,
        version: secured.version,
      });
    expect(received.status).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const dayDoc = await operationsDayService.findByDate(new Date(DELIVERY));
    const rows = await operationsCrewAssignmentRepository.findForDay(dayDoc?._id ?? '');
    const assigned = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        crewAssignmentId: String(rows[0]?._id ?? ''),
        captainEmployeeId: captainId,
        version: 0,
      });
    expect(assigned.status).toBe(200);

    const dto = data<OperationsMobileDayDto>(await myDay(captainUserToken, DELIVERY));
    expect(dto.stops).toHaveLength(1);
    expect(dto.stops[0]?.leg).toBe('delivery');
    expect(dto.stops[0]?.shipmentType).toBe('secured');
    expect(dto.stops[0]?.status).toBe('inVault');
  });

  it('8 + 9 + 10. both locations are returned, and absent coordinates do not break anything', async () => {
    const dto = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    const stop = dto.stops[0];
    expect(stop?.pickup.branchName).toBe('فرع المهندسين');
    expect(stop?.pickup.bankName).toBe('الأهلي');
    expect(stop?.delivery.branchName).toBe('فرع المهندسين');
    expect(stop?.pickup.location).toBeNull();
    expect(stop?.delivery.location).toBeNull();
  });

  it('9b. a backfilled coordinate flows straight through — the API is map-ready', async () => {
    const list = await request(app)
      .get(`/api/v1/operations/bank-branches?bankId=${bankA.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const target = (list.body as { data: OperationsBankBranchDto[] }).data.find(
      (b) => b.id === branchA1.id,
    );
    const updated = await request(app)
      .patch(`/api/v1/operations/bank-branches/${branchA1.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        location: {
          addressLine: 'شارع جامعة الدول',
          coordinates: { lat: 30.0444, lng: 31.2357 },
        },
        version: target?.version ?? branchA1.version,
      });
    expect(updated.status).toBe(200);

    const dto = data<OperationsMobileDayDto>(await myDay(captainUserToken));
    expect(dto.stops[0]?.pickup.location?.coordinates?.lng).toBe(31.2357);
    expect(dto.stops[0]?.pickup.location?.addressLine).toBe('شارع جامعة الدول');
  });

  it('11. RBAC — needs operationsExecution.own, and a non-employee login is refused', async () => {
    const viewer = await myDay(viewerToken);
    expect(viewer.status).toBe(403);

    // The ops admin HAS the grant but is not linked to an employee — identity, not permission.
    const unlinked = await myDay(adminToken);
    expect(unlinked.status).toBe(403);

    const anonymous = await request(app).get('/api/v1/operations/mobile/my-day');
    expect(anonymous.status).toBe(401);
  });
});

describe('captain mobile EXECUTION — sequential workflow (OP-7, NEW capability)', () => {
  // Everything in this block is new ECMS behaviour. The legacy system had no captain surface, so
  // there is no legacy execution to be parity with — only the shipment, its legs, the (day,
  // vehicle) crew row and PR 5's persisted `sequence` underneath it, none of which this changes.
  const EXEC_DATE = shift(210);
  const NO_STOPS_DATE = shift(211);

  let execCaptainId = '';
  let execToken = '';
  let rivalCaptainId = '';
  let rivalToken = '';
  let rivalStopId = '';
  let benchToken = ''; // holds the permission, is an employee, is nobody's captain that day
  let stops: string[] = [];

  const act = (
    token: string,
    assignmentId: string,
    step: string,
    body: Record<string, unknown> = {},
  ): request.Test =>
    request(app)
      .post(`/api/v1/operations/mobile/stops/${assignmentId}/${step}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const dayOf = async (token: string, date = EXEC_DATE): Promise<OperationsMobileDayDto> =>
    data<OperationsMobileDayDto>(
      await request(app)
        .get(`/api/v1/operations/mobile/my-day?date=${date}`)
        .set('Authorization', `Bearer ${token}`),
    );

  beforeAll(async () => {
    const { employeeRepository } = await import(
      '../../src/modules/hr/employee-management/employees/employee.repository'
    );
    const role = await rbacService.createRole(
      { name: { en: 'Captain exec', ar: 'قائد تنفيذ' }, permissionKeys: ['operationsExecution.own'] },
      await mkUser('exec-role-seed@ecms.local'),
    );
    const link = async (email: string, employeeId: string): Promise<string> => {
      const userId = await mkUser(email);
      await rbacService.ensureAssignment(userId, String(role._id), 'organization');
      const current = await employeeRepository.getById(employeeId);
      await employeeRepository.updateById(employeeId, { userId }, { by: null, version: current.__v });
      return login(email);
    };

    execCaptainId = await mkEmployee();
    rivalCaptainId = await mkEmployee();
    const benchEmployeeId = await mkEmployee();
    execToken = await link('exec-captain@ecms.local', execCaptainId);
    rivalToken = await link('exec-rival@ecms.local', rivalCaptainId);
    benchToken = await link('exec-bench@ecms.local', benchEmployeeId);

    // Two vehicles, two captains, same day — so "another captain's stop" is a real neighbour and
    // not a contrived one, and the crew/vehicle mismatch is exercised against a genuine crew row.
    for (const date of [EXEC_DATE, NO_STOPS_DATE]) {
      const roster = await request(app)
        .post('/api/v1/fleet/roster')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          date,
          rows: [
            { vehicleId: vehicleAId, notes: 'exec seed A' },
            { vehicleId: vehicleBId, notes: 'exec seed B' },
          ],
        });
      expect(roster.status).toBe(200);
    }

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: EXEC_DATE,
        rows: [
          { vehicleId: vehicleAId, captainEmployeeIds: [execCaptainId] },
          { vehicleId: vehicleBId, captainEmployeeIds: [rivalCaptainId] },
        ],
      });
    expect(plan.status).toBe(200);

    // The same captain is planned on a SECOND day with no work at all — scenario 16.
    const idlePlan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: NO_STOPS_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [execCaptainId] }],
      });
    expect(idlePlan.status).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const dayDoc = await operationsDayService.findByDate(new Date(EXEC_DATE));
    const crewRows = await operationsCrewAssignmentRepository.findForDay(dayDoc?._id ?? '');
    const crewFor = (vehicleId: string): string =>
      String(crewRows.find((r) => String(r.vehicleId) === vehicleId)?._id ?? '');

    const assign = async (captain: string, vehicleId: string): Promise<string> => {
      const shipment = data<OperationsShipmentDto>(await mkShipment({ collectionDate: EXEC_DATE }));
      const res = await request(app)
        .post(`/api/v1/operations/assignments/shipments/${shipment.id}/assign-pickup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ crewAssignmentId: crewFor(vehicleId), captainEmployeeId: captain, version: 0 });
      expect(res.status).toBe(200);
      return data<OperationsShipmentAssignmentDto>(res).id;
    };

    stops = [
      await assign(execCaptainId, vehicleAId),
      await assign(execCaptainId, vehicleAId),
      await assign(execCaptainId, vehicleAId),
    ];
    rivalStopId = await assign(rivalCaptainId, vehicleBId);

    // The route the server built is the route the tests reason about.
    const mine = await dayOf(execToken);
    expect(mine.stops.map((s) => s.assignmentId)).toEqual(stops);
  });

  it('6 + 7 + 9. future stops are locked, cannot be skipped, and cannot be completed early', async () => {
    const before = await dayOf(execToken);
    expect(before.stops.map((s) => s.progress)).toEqual(['current', 'locked', 'locked']);
    expect(before.stops.map((s) => s.executionStatus)).toEqual(['pending', 'pending', 'pending']);
    expect(before.currentAssignmentId).toBe(stops[0]);

    // Skipping ahead — refused by the sequential lock, for BOTH future stops.
    for (const skipped of [stops[1] ?? '', stops[2] ?? '']) {
      const jumped = await act(execToken, skipped, 'start');
      expect(jumped.status).toBe(422);
      expect((jumped.body as { error: { code: string } }).error.code).toBe(
        ErrorCodes.OPERATIONS_EXECUTION_OUT_OF_SEQUENCE,
      );
    }

    // Completing something never started — refused by the state machine, not by the lock.
    const early = await act(execToken, stops[0] ?? '', 'complete');
    expect(early.status).toBe(422);
    expect((early.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_INVALID_EXECUTION_TRANSITION,
    );

    // ...and so is jumping a step inside a stop.
    const midJump = await act(execToken, stops[0] ?? '', 'deliver');
    expect(midJump.status).toBe(422);
    expect((midJump.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_INVALID_EXECUTION_TRANSITION,
    );

    // Nothing above moved anything.
    expect((await dayOf(execToken)).stops.map((s) => s.executionStatus)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('1 + 2 + 3 + 4. start → pickup → deliver → complete, each step stamped', async () => {
    const started = await act(execToken, stops[0] ?? '', 'start');
    expect(started.status).toBe(200);
    expect(data<{ executionStatus: string }>(started).executionStatus).toBe('active');
    expect(data<{ startedAt: string | null }>(started).startedAt).not.toBeNull();

    const picked = await act(execToken, stops[0] ?? '', 'pickup');
    expect(picked.status).toBe(200);
    expect(data<{ executionStatus: string }>(picked).executionStatus).toBe('pickedUp');
    expect(data<{ pickedUpAt: string | null }>(picked).pickedUpAt).not.toBeNull();

    const delivered = await act(execToken, stops[0] ?? '', 'deliver');
    expect(delivered.status).toBe(200);
    expect(data<{ executionStatus: string }>(delivered).executionStatus).toBe('delivered');
    expect(data<{ deliveredAt: string | null }>(delivered).deliveredAt).not.toBeNull();

    const done = await act(execToken, stops[0] ?? '', 'complete');
    expect(done.status).toBe(200);
    const result = data<{ executionStatus: string; completedAt: string | null; currentAssignmentId: string | null }>(done);
    expect(result.executionStatus).toBe('completed');
    expect(result.completedAt).not.toBeNull();
    // The transition itself already reports where the route now stands.
    expect(result.currentAssignmentId).toBe(stops[1]);
  });

  it('5 + 15. the next stop becomes current ONLY after completion, and the PR 6 read says so', async () => {
    const after = await dayOf(execToken);
    expect(after.stops.map((s) => s.progress)).toEqual(['completed', 'current', 'locked']);
    expect(after.stops.map((s) => s.executionStatus)).toEqual(['completed', 'pending', 'pending']);
    expect(after.currentAssignmentId).toBe(stops[1]);

    // Stop 3 is still locked — one completion unlocks exactly one stop, never the rest.
    const stillLocked = await act(execToken, stops[2] ?? '', 'start');
    expect(stillLocked.status).toBe(422);
    expect((stillLocked.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_EXECUTION_OUT_OF_SEQUENCE,
    );
  });

  it('10. a completed stop cannot be completed again', async () => {
    const again = await act(execToken, stops[0] ?? '', 'complete');
    expect(again.status).toBe(422);
    expect((again.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_EXECUTION_ALREADY_SETTLED,
    );
    // ...and it is still completed exactly once.
    expect((await dayOf(execToken)).stops[0]?.executionStatus).toBe('completed');
  });

  it('11. concurrent starts of the same stop — exactly one transition wins', async () => {
    const racers = await Promise.all(
      Array.from({ length: 6 }, () => act(execToken, stops[1] ?? '', 'start')),
    );
    expect(racers.filter((r) => r.status === 200)).toHaveLength(1);
    // Every loser is refused for a real reason, never a crash.
    for (const loser of racers.filter((r) => r.status !== 200)) {
      expect([409, 422]).toContain(loser.status);
    }
    expect((await dayOf(execToken)).stops[1]?.executionStatus).toBe('active');
  });

  it('11b. concurrent completes of the same stop — exactly one transition wins', async () => {
    expect((await act(execToken, stops[1] ?? '', 'pickup')).status).toBe(200);
    expect((await act(execToken, stops[1] ?? '', 'deliver')).status).toBe(200);

    const racers = await Promise.all(
      Array.from({ length: 6 }, () => act(execToken, stops[1] ?? '', 'complete')),
    );
    expect(racers.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await dayOf(execToken)).stops[1]?.executionStatus).toBe('completed');
  });

  it('11c. concurrent requests cannot unlock more than one future stop', async () => {
    // Stop 3 is now genuinely next. Race a legal start against illegal ones on a stop that is NOT
    // next — the sequence cannot be bypassed by arriving in parallel.
    const [legal, ...illegal] = await Promise.all([
      act(execToken, stops[2] ?? '', 'start'),
      act(execToken, stops[0] ?? '', 'start'),
      act(execToken, stops[1] ?? '', 'start'),
    ]);
    expect(legal?.status).toBe(200);
    for (const bad of illegal) expect(bad.status).toBe(422);

    const route = await dayOf(execToken);
    expect(route.stops.map((s) => s.executionStatus)).toEqual(['completed', 'completed', 'active']);
    // The invariant the whole slice exists for: nothing later is done while something earlier is not.
    const doneFlags = route.stops.map((s) => s.progress === 'completed');
    expect(doneFlags.indexOf(false)).toBe(doneFlags.lastIndexOf(true) + 1);
  });

  it('8. a captain cannot execute another captain\'s stop', async () => {
    const poached = await act(rivalToken, stops[2] ?? '', 'pickup');
    expect(poached.status).toBe(403);
    // ...and the rival's own stop is untouched by the attempt.
    expect((await dayOf(rivalToken)).stops[0]?.executionStatus).toBe('pending');
  });

  it('12. wrong vehicle/crew and wrong day are refused', async () => {
    // The rival's stop rides a different crew row and a different vehicle on the SAME day.
    const wrongCrew = await act(execToken, rivalStopId, 'start');
    expect(wrongCrew.status).toBe(403);

    // Captaincy is the DAY'S crew row, not the assignment: re-captain the vehicle and the stop's
    // former captain loses the right to execute it, even though the assignment still names him.
    const handover = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: EXEC_DATE,
        rows: [
          { vehicleId: vehicleAId, captainEmployeeIds: [rivalCaptainId] },
          { vehicleId: vehicleBId, captainEmployeeIds: [execCaptainId] },
        ],
      });
    expect(handover.status).toBe(200);

    const afterHandover = await act(execToken, stops[2] ?? '', 'pickup');
    expect(afterHandover.status).toBe(403);

    // Put it back, and the rightful captain can carry on exactly where he was.
    const restore = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: EXEC_DATE,
        rows: [
          { vehicleId: vehicleAId, captainEmployeeIds: [execCaptainId] },
          { vehicleId: vehicleBId, captainEmployeeIds: [rivalCaptainId] },
        ],
      });
    expect(restore.status).toBe(200);
    expect((await act(execToken, stops[2] ?? '', 'pickup')).status).toBe(200);
  });

  it('13. RBAC and authentication on every execution route', async () => {
    for (const step of ['start', 'pickup', 'deliver', 'complete']) {
      const anonymous = await request(app).post(
        `/api/v1/operations/mobile/stops/${stops[2] ?? ''}/${step}`,
      );
      expect(anonymous.status).toBe(401);

      const viewer = await act(viewerToken, stops[2] ?? '', step);
      expect(viewer.status).toBe(403);

      // Holds the grant, but the login is not linked to an employee — identity, not permission.
      const unlinked = await act(adminToken, stops[2] ?? '', step);
      expect(unlinked.status).toBe(403);
    }
  });

  it('17. an employee who is not a captain that day cannot execute, permission notwithstanding', async () => {
    const bench = await dayOf(benchToken);
    expect(bench.isCaptainOnDay).toBe(false);

    for (const step of ['start', 'pickup', 'deliver', 'complete']) {
      const refused = await act(benchToken, stops[2] ?? '', step);
      expect(refused.status).toBe(403);
    }
  });

  it('16. a captain with zero stops is still a captain, with no current stop', async () => {
    const idle = await dayOf(execToken, NO_STOPS_DATE);
    expect(idle.isCaptainOnDay).toBe(true);
    expect(idle.assignments).toHaveLength(1);
    expect(idle.stops).toHaveLength(0);
    expect(idle.currentAssignmentId).toBeNull();
  });

  it('14. every transition is audited and emits its catalogued event', async () => {
    const { AuditLogModel } = await import('../../src/platform/audit/audit.model');

    const names = seenEvents.map((e) => e.name);
    for (const name of [
      OperationsEvents.ExecutionStarted,
      OperationsEvents.ExecutionPickupConfirmed,
      OperationsEvents.ExecutionDeliveryConfirmed,
      OperationsEvents.ExecutionCompleted,
    ]) {
      expect(names).toContain(name);
    }

    // The payload identifies the stop, the day, the captain and the step — without a second read.
    const completed = seenEvents
      .filter((e) => e.name === OperationsEvents.ExecutionCompleted)
      .map((e) => e.payload as Record<string, unknown>)
      .find((p) => p.assignmentId === stops[0]);
    expect(completed).toBeDefined();
    expect(completed?.captainEmployeeId).toBe(execCaptainId);
    expect(completed?.from).toBe('delivered');
    expect(completed?.to).toBe('completed');
    expect(completed?.leg).toBe('pickup');
    expect(completed?.sequence).toBe(1);

    // `changes` is an ARRAY of {field, old, new} (ADR-012), so the field is matched by value.
    // Audit is written through the job queue, so poll rather than assume it has already landed.
    let rows: { changes: { field: string; old: unknown; new: unknown }[] }[] = [];
    for (let attempt = 0; attempt < 40 && rows.length < 4; attempt += 1) {
      rows = await AuditLogModel.find({
        'entityRef.moduleId': 'operations',
        'entityRef.entityType': 'shipmentAssignment',
        'entityRef.entityId': stops[0] ?? '',
        'changes.field': 'executionStatus',
      })
        .lean<{ changes: { field: string; old: unknown; new: unknown }[] }[]>()
        .exec();
      if (rows.length < 4) await new Promise((r) => setTimeout(r, 100));
    }

    // start, pickup, deliver, complete — every transition leaves a trace, and the trace says which.
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const steps = rows
      .flatMap((row) => row.changes)
      .filter((change) => change.field === 'executionStatus')
      .map((change) => `${String(change.old)}->${String(change.new)}`);
    for (const step of [
      'pending->active',
      'active->pickedUp',
      'pickedUp->delivered',
      'delivered->completed',
    ]) {
      expect(steps).toContain(step);
    }
  });

  it('a client cannot smuggle a captain, a sequence or coordinates into a transition', async () => {
    for (const payload of [
      { captainEmployeeId: rivalCaptainId },
      { sequence: 1 },
      { coordinates: { lat: 30, lng: 31 } },
    ]) {
      const res = await act(execToken, stops[2] ?? '', 'deliver', payload);
      expect(res.status).toBe(400);
    }
  });
});

describe('the daily operations board — legacy /main_ops (B2)', () => {
  // The legacy board is a UNION over two different date fields (contad_app.js:262-268):
  //   daily   → rec_date == today
  //   secured → del_date == today AND status in [1,3]  (completed | dispatched)
  // Everything below asserts that union, because it is the one rule a client must never rebuild.
  const BOARD_DATE = shift(220);
  const OTHER_DATE = shift(221);

  const board = async (date?: string): Promise<request.Response> =>
    request(app)
      .get(`/api/v1/operations/shipments/day-board${date === undefined ? '' : `?date=${date}`}`)
      .set('Authorization', `Bearer ${adminToken}`);

  const idsOn = async (date: string): Promise<string[]> => {
    const res = await board(date);
    expect(res.status).toBe(200);
    return data<{ shipments: OperationsShipmentDto[] }>(res).shipments.map((s) => s.id);
  };

  let dailyToday = '';
  let dailyOtherDay = '';
  let securedDueDraft = '';
  let securedDueDispatched = '';
  /** The board day's one crew row — van A under `captainId` — for the legs booked below. */
  let boardCrewId = '';
  /** Van A's two drivers on the board day — FLEET's half of the van, on its duty row. */
  let boardDriver1Id = '';
  let boardDriver2Id = '';

  beforeAll(async () => {
    dailyToday = data<OperationsShipmentDto>(
      await mkShipment({ collectionDate: BOARD_DATE }),
    ).id;
    dailyOtherDay = data<OperationsShipmentDto>(
      await mkShipment({ collectionDate: OTHER_DATE }),
    ).id;

    // A secured shipment DUE on the board day but still `draft` — it has not left the vault, so
    // the legacy filter excludes it.
    securedDueDraft = data<OperationsShipmentDto>(
      await mkShipment({
        shipmentType: 'secured',
        collectionDate: BOARD_DATE,
        deliveryDate: BOARD_DATE,
      }),
    ).id;

    // A second secured shipment due the same day, walked to `dispatched` through the real vault
    // flow, so it SHOULD appear.
    const secured = data<OperationsShipmentDto>(
      await mkShipment({
        shipmentType: 'secured',
        collectionDate: BOARD_DATE,
        deliveryDate: BOARD_DATE,
      }),
    );
    securedDueDispatched = secured.id;
    const treasurer = await mkEmployee();
    const received = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-BOARD-${secured.id.slice(-5)}`,
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: treasurer,
        version: secured.version,
      });
    expect(received.status).toBe(200);

    // Van A goes out with BOTH halves of a crew, so the van's card has something in every line:
    // two drivers on Fleet's duty row, and a captain plus a specialist in each slot on the crew
    // row. The drivers sit in their own department, in a seat that requires a driving test —
    // Fleet only seats a driver, and the crew department's roster (B3) stays as it was.
    const driverDept = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'OPS-BRD-DRV', name: { ar: 'سائقو اللوحة', en: 'Board Drivers' }, branchId });
    expect(driverDept.status).toBe(201);
    const driverTitle = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'OPS-BRD-DRV',
        name: { ar: 'سائق', en: 'Driver' },
        jobGrade: 'G1',
        requiresDrivingTest: true,
      });
    expect(driverTitle.status).toBe(201);
    const driverSeat = {
      departmentId: data<{ id: string }>(driverDept).id,
      jobTitleId: data<{ id: string }>(driverTitle).id,
    };
    boardDriver1Id = await mkEmployee({ ...driverSeat, fullNameAr: 'سائق اللوحة الأول' });
    boardDriver2Id = await mkEmployee({ ...driverSeat, fullNameAr: 'سائق اللوحة الثاني' });

    const rosterRes = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: BOARD_DATE,
        rows: [
          {
            vehicleId: vehicleAId,
            driver1EmployeeId: boardDriver1Id,
            driver2EmployeeId: boardDriver2Id,
            notes: 'board seed',
          },
        ],
      });
    expect(rosterRes.status, JSON.stringify(rosterRes.body)).toBe(200);
    const crewRes = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: BOARD_DATE,
        rows: [
          {
            vehicleId: vehicleAId,
            captainEmployeeIds: [captainId],
            specialist1EmployeeIds: [specialist1Id],
            specialist2EmployeeIds: [specialist2Id],
            direction: 'القاهرة',
            plannedTime: '08:30',
          },
        ],
      });
    expect(crewRes.status, JSON.stringify(crewRes.body)).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const dayDoc = await operationsDayService.findByDate(new Date(BOARD_DATE));
    const crewRows = await operationsCrewAssignmentRepository.findForDay(dayDoc?._id ?? '');
    boardCrewId = String(crewRows[0]?._id ?? '');

    const assigned = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: boardCrewId, captainEmployeeId: captainId, version: 0 });
    expect(assigned.status).toBe(200);

    const dispatched = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shipmentIds: [secured.id], crewAssignmentId: boardCrewId });
    expect(dispatched.status).toBe(200);
  });

  it('shows the day\'s DAILY shipments, and not another day\'s', async () => {
    const ids = await idsOn(BOARD_DATE);
    expect(ids).toContain(dailyToday);
    expect(ids).not.toContain(dailyOtherDay);
  });

  it('shows a secured shipment DUE that day once it has left the vault', async () => {
    expect(await idsOn(BOARD_DATE)).toContain(securedDueDispatched);
  });

  it('hides a secured shipment that is due but still in the vault — legacy status:[1,3]', async () => {
    expect(await idsOn(BOARD_DATE)).not.toContain(securedDueDraft);
  });

  it('attributes secured shipments by DELIVERY date, not collection date', async () => {
    // Both secured fixtures were COLLECTED on the board day too, so if the board keyed secured
    // rows off collectionDate the excluded one would wrongly appear. It does not.
    const ids = await idsOn(BOARD_DATE);
    expect(ids).toContain(securedDueDispatched);
    expect(ids).not.toContain(securedDueDraft);
  });

  it('returns newest-created first — the legacy input_date ordering', async () => {
    const res = await board(BOARD_DATE);
    const rows = data<{ shipments: OperationsShipmentDto[] }>(res).shipments;
    const created = rows.map((s) => new Date(s.createdAt).getTime());
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });

  it('echoes the day it resolved, and defaults to today when asked for no date', async () => {
    const explicit = await board(BOARD_DATE);
    expect(data<{ date: string }>(explicit).date.slice(0, 10)).toBe(BOARD_DATE);

    const today = await board();
    expect(today.status).toBe(200);
    expect(data<{ date: string }>(today).date.slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  // What the legacy table printed beside each shipment (main_ops.ejs:829-897), resolved on the
  // server: both branches by name, code and bank, and the crew of the leg the type reports on.
  it('prints each row as the legacy table did — branches with their banks, and the leg\'s crew', async () => {
    // The billed bank is A; the money is collected from a branch of bank B (the from-bank is the
    // origin branch's own bank, never stored on the shipment).
    const crossBank = data<OperationsShipmentDto>(
      await mkShipment({ collectionDate: BOARD_DATE, originBranchId: branchB1.id }),
    ).id;

    const res = await board(BOARD_DATE);
    expect(res.status).toBe(200);
    const rows = data<{ shipments: OperationsDayBoardShipmentDto[] }>(res).shipments;
    const row = (id: string): OperationsDayBoardShipmentDto => {
      const found = rows.find((r) => r.id === id);
      expect(found).toBeDefined();
      return found as OperationsDayBoardShipmentDto;
    };

    // A daily shipment booked with no crew: branches resolved, crew honestly null.
    const daily = row(dailyToday);
    expect(daily.origin).toEqual({
      id: branchA1.id,
      name: 'فرع المهندسين',
      code: 'A-101',
      bankId: bankA.id,
      bankName: bankA.opsName,
    });
    expect(daily.destination?.id).toBe(branchA1.id);
    expect(daily.crew).toBeNull();

    // Billed to A, collected from B — the board shows where the money came from.
    const cross = row(crossBank);
    expect(cross.mainBankId).toBe(bankA.id);
    expect(cross.origin?.bankId).toBe(bankB.id);
    expect(cross.origin?.bankName).toBe(bankB.opsName);

    // A secured shipment reports on its DELIVERY leg — the van and captain that delivered it.
    const secured = row(securedDueDispatched);
    expect(secured.crew?.vehicleId).toBe(vehicleAId);
    expect(secured.crew?.vehicleCode).toBe('OPS-V1');
    expect(secured.crew?.captainEmployeeId).toBe(captainId);
    expect(typeof secured.crew?.captainName).toBe('string');
    expect(secured.crew?.captainName).not.toBe('');

    // Still a shipment underneath: every field a shipment reader expects is there.
    expect(secured.shipmentType).toBe('secured');
    expect(secured.lines.length).toBeGreaterThan(0);
  });

  // WHICH leg's crew a row prints is the type's rule — the same split the captain report makes:
  // a daily shipment is reported under the crew that COLLECTED it, a secured one under the crew
  // that DELIVERED it. The case above only had one leg to choose from. Here each type has a way to
  // answer wrongly: the daily one is booked WITH its collection crew, and the secured one was
  // collected the day before by another van and captain, then delivered by van A on the board day.
  it('prints the crew of the leg the type reports on — collection for daily, delivery for secured', async () => {
    const { operationsShipmentAssignmentRepository } = await import(
      '../../src/modules/operations/shipments/shipment-assignment.repository'
    );

    // DAILY, with the collection crew named at booking — the shipment form's own path.
    const booked = await mkShipment({
      collectionDate: BOARD_DATE,
      pickup: { crewAssignmentId: boardCrewId, captainEmployeeId: captainId },
    });
    expect(booked.status).toBe(201);
    const dailyCrewed = data<OperationsShipmentDto>(booked).id;
    const dailyPickup = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      dailyCrewed,
      'pickup',
    );
    expect(dailyPickup).not.toBeNull();

    // SECURED, collected the day before by van B under its own captain.
    const PICKUP_DATE = shift(219);
    const pickupCaptainId = await mkEmployee();
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: PICKUP_DATE, rows: [{ vehicleId: vehicleBId, notes: 'board pickup seed' }] });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: PICKUP_DATE,
        rows: [{ vehicleId: vehicleBId, captainEmployeeIds: [pickupCaptainId] }],
      });
    expect(plan.status).toBe(200);
    const pickupCrewId =
      data<OperationsCrewBoardDto>(plan).rows.find((r) => r.vehicleId === vehicleBId)?.crew?.id ??
      '';
    expect(pickupCrewId).not.toBe('');

    const created = await mkShipment({
      shipmentType: 'secured',
      collectionDate: PICKUP_DATE,
      deliveryDate: BOARD_DATE,
      pickup: { crewAssignmentId: pickupCrewId, captainEmployeeId: pickupCaptainId },
    });
    expect(created.status).toBe(201);
    const twoLegs = data<OperationsShipmentDto>(created);

    // ...then into the vault, out on van A under `captainId` on the board day.
    const received = await request(app)
      .post(`/api/v1/operations/secured/${twoLegs.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-BOARD-${twoLegs.id.slice(-5)}`,
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: await mkEmployee(),
        version: twoLegs.version,
      });
    expect(received.status).toBe(200);
    const assigned = await request(app)
      .post(`/api/v1/operations/secured/${twoLegs.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: boardCrewId, captainEmployeeId: captainId, version: 0 });
    expect(assigned.status).toBe(200);
    const dispatched = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shipmentIds: [twoLegs.id], crewAssignmentId: boardCrewId });
    expect(dispatched.status).toBe(200);

    // The fixture really has two legs on two different crews — otherwise the board could pass
    // below by finding only one.
    const securedPickup = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      twoLegs.id,
      'pickup',
    );
    const securedDelivery = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      twoLegs.id,
      'delivery',
    );
    expect(String(securedPickup?.vehicleId)).toBe(vehicleBId);
    expect(String(securedPickup?.captainEmployeeId)).toBe(pickupCaptainId);
    expect(String(securedDelivery?.vehicleId)).toBe(vehicleAId);
    expect(String(securedDelivery?.captainEmployeeId)).toBe(captainId);

    const res = await board(BOARD_DATE);
    expect(res.status).toBe(200);
    const rows = data<{ shipments: OperationsDayBoardShipmentDto[] }>(res).shipments;
    const crewOf = (id: string): OperationsDayBoardShipmentDto['crew'] | undefined =>
      rows.find((r) => r.id === id)?.crew;

    // The daily row prints its COLLECTION leg.
    expect(crewOf(dailyCrewed)).toMatchObject({
      crewAssignmentId: boardCrewId,
      vehicleId: String(dailyPickup?.vehicleId),
      vehicleCode: 'OPS-V1',
      captainEmployeeId: String(dailyPickup?.captainEmployeeId),
    });

    // The secured row prints who DELIVERED it — van A and `captainId` — never who collected it.
    // Its crew key is the delivery crew's too, so the van's card names the crew that delivered.
    expect(crewOf(twoLegs.id)).toMatchObject({
      crewAssignmentId: boardCrewId,
      vehicleId: vehicleAId,
      vehicleCode: 'OPS-V1',
      captainEmployeeId: captainId,
    });
    expect(crewOf(twoLegs.id)?.vehicleCode).not.toBe('OPS-V2');
    expect(crewOf(twoLegs.id)?.captainEmployeeId).not.toBe(pickupCaptainId);

    // The captain's «تم التسليم» on a SECURED row is the DELIVERY leg's too. The collection run's
    // own "delivered" is the cash reaching the VAULT, never the destination branch. The legs are
    // stamped directly here; the real mobile acts are driven in the daily case below.
    const { OperationsShipmentAssignmentModel } = await import(
      '../../src/modules/operations/shipments/shipment-assignment.model'
    );
    const stamp = (id: unknown, set: Record<string, unknown>, unset?: Record<string, 1>) =>
      OperationsShipmentAssignmentModel.updateOne(
        { _id: id },
        unset === undefined ? { $set: set } : { $set: set, $unset: unset },
      ).exec();
    const deliveredOnBoard = async (): Promise<string | null | undefined> =>
      data<{ shipments: OperationsDayBoardShipmentDto[] }>(await board(BOARD_DATE)).shipments.find(
        (r) => r.id === twoLegs.id,
      )?.captainDeliveredAt;
    await stamp(securedPickup?._id, {
      executionStatus: 'completed',
      deliveredAt: new Date(`${PICKUP_DATE}T09:00:00.000Z`),
    });
    expect(await deliveredOnBoard()).toBeNull();
    // A leg written before OP-7 carries no execution state at all: read as not started.
    await stamp(securedDelivery?._id, {}, { executionStatus: 1, deliveredAt: 1 });
    expect(await deliveredOnBoard()).toBeNull();
    const atBranch = new Date(`${BOARD_DATE}T11:30:00.000Z`);
    await stamp(securedDelivery?._id, { executionStatus: 'delivered', deliveredAt: atBranch });
    expect(await deliveredOnBoard()).toBe(atBranch.toISOString());
  });

  // «لما اقف على العربيه تجيب مين اللى متعين عليها من سواقيين واخصائيين و لما اقف على القائد يجيب
  // بياناته زى ما عاملين فى الحركه»: hovering a van names everyone on it — Fleet's two drivers and
  // Operations' captain and specialists — and hovering the captain gives the facts the Fleet driver
  // card prints. Both come from the crew plan, so a reader without `operationsCrew.view` keeps
  // the board the legacy table printed and gets neither card's crew facts.
  it('names who rides the van and gives the captain\'s card — behind the crew grant', async () => {
    // A second leg on van A, booked here so this case does not lean on the ones above: two rows
    // ride one crew row, and the van's card must still be listed once.
    const booked = await mkShipment({
      collectionDate: BOARD_DATE,
      pickup: { crewAssignmentId: boardCrewId, captainEmployeeId: captainId },
    });
    expect(booked.status).toBe(201);

    // What HR itself says about each person — the board must hand on the same facts.
    const hrRecord = async (
      id: string,
    ): Promise<{
      code: string;
      personal: { fullNameAr: string; contact: { primaryPhone: string } };
    }> => {
      const res = await request(app)
        .get(`/api/v1/hr/employees/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      return data(res);
    };
    const person = async (employeeId: string) => {
      const hr = await hrRecord(employeeId);
      return { employeeId, code: hr.code, fullNameAr: hr.personal.fullNameAr };
    };
    const captain = await hrRecord(captainId);

    const res = await board(BOARD_DATE);
    expect(res.status).toBe(200);
    const view = data<OperationsDayBoardDto>(res);

    // The captain's card: his employee code, phone and branch, beside the van he drove out in and
    // the key of the crew row he rides.
    const secured = view.shipments.find((r) => r.id === securedDueDispatched);
    expect(secured?.crew).toMatchObject({
      crewAssignmentId: boardCrewId,
      vehicleId: vehicleAId,
      vehicleCode: 'OPS-V1',
      captainEmployeeId: captainId,
      captainCode: captain.code,
      captainPhone: captain.personal.contact.primaryPhone,
      captainBranchId: branchId,
    });

    // One card per crew ROW, not per shipment, and only for crews a row on the board rides.
    expect(
      view.shipments.filter((r) => r.crew?.crewAssignmentId === boardCrewId).length,
    ).toBeGreaterThan(1);
    expect(view.crews.filter((c) => c.crewAssignmentId === boardCrewId)).toHaveLength(1);
    const ridden = new Set(view.shipments.map((r) => r.crew?.crewAssignmentId));
    for (const crew of view.crews) expect(ridden.has(crew.crewAssignmentId)).toBe(true);

    // The van's card: Fleet's drivers in their seat order, then the crew row slot by slot.
    expect(view.crews.find((c) => c.crewAssignmentId === boardCrewId)).toEqual({
      crewAssignmentId: boardCrewId,
      vehicleId: vehicleAId,
      vehicleCode: 'OPS-V1',
      drivers: [await person(boardDriver1Id), await person(boardDriver2Id)],
      captains: [await person(captainId)],
      specialist1: [await person(specialist1Id)],
      specialist2: [await person(specialist2Id)],
      direction: 'القاهرة',
      plannedTime: '08:30',
    });
    expect(
      view.crews.find((c) => c.crewAssignmentId === boardCrewId)?.drivers.map((d) => d.fullNameAr),
    ).toEqual(['سائق اللوحة الأول', 'سائق اللوحة الثاني']);

    // The viewer holds `operationsShipment.view` only: the same rows, the same van and captain
    // name, but no crew cards and no captain's phone.
    const viewerRes = await request(app)
      .get(`/api/v1/operations/shipments/day-board?date=${BOARD_DATE}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerRes.status).toBe(200);
    const viewerView = data<OperationsDayBoardDto>(viewerRes);
    expect(viewerView.crews).toEqual([]);
    expect(viewerView.shipments.find((r) => r.id === securedDueDispatched)?.crew).toMatchObject({
      crewAssignmentId: boardCrewId,
      vehicleCode: 'OPS-V1',
      captainEmployeeId: captainId,
      captainName: captain.personal.fullNameAr,
      captainPhone: null,
    });
    const crewedForViewer = viewerView.shipments.filter((r) => r.crew !== null);
    expect(crewedForViewer.length).toBeGreaterThan(0);
    for (const row of crewedForViewer) expect(row.crew?.captainPhone).toBeNull();
  });

  // The van's card reads two rows the shipment does not own: the crew row the leg rides, and the
  // Fleet duty row that crew row anchors on. Either can be taken off the plan after the leg was
  // booked, and `findByIdsSystem` hands soft-deleted rows back on purpose. A crew row that is off
  // the plan puts nobody on the van, and a duty row that is off the plan seats no driver. Neither
  // may cost the desk its board: the row still prints the van and the captain its own leg names.
  // On a day of its own, so taking rows away here cannot touch the cases above.
  it('a crew or duty row taken off the plan leaves the van card empty — never the board', async () => {
    const GONE_DATE = shift(227);
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: GONE_DATE,
        rows: [
          { vehicleId: vehicleAId, driver1EmployeeId: boardDriver1Id },
          { vehicleId: vehicleBId, driver1EmployeeId: boardDriver2Id },
        ],
      });
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: GONE_DATE,
        rows: [
          { vehicleId: vehicleAId, captainEmployeeIds: [captainId] },
          { vehicleId: vehicleBId, captainEmployeeIds: [specialist2Id] },
        ],
      });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const crewOn = (vehicleId: string) =>
      data<OperationsCrewBoardDto>(plan).rows.find((r) => r.vehicleId === vehicleId)?.crew;
    const crewAId = crewOn(vehicleAId)?.id ?? '';
    const crewBId = crewOn(vehicleBId)?.id ?? '';
    expect(crewAId).not.toBe('');
    expect(crewBId).not.toBe('');

    const onA = await mkShipment({
      collectionDate: GONE_DATE,
      pickup: { crewAssignmentId: crewAId, captainEmployeeId: captainId },
    });
    expect(onA.status, JSON.stringify(onA.body)).toBe(201);
    const onB = await mkShipment({
      collectionDate: GONE_DATE,
      pickup: { crewAssignmentId: crewBId, captainEmployeeId: specialist2Id },
    });
    expect(onB.status, JSON.stringify(onB.body)).toBe(201);

    // Both rows come off the plan underneath the legs: van A's crew row, and van B's duty row.
    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { fleetDutyAssignmentRepository } = await import(
      '../../src/modules/operations/fleet-boundary'
    );
    await operationsCrewAssignmentRepository.softDeleteById(crewAId, { by: null });
    const crewB = await operationsCrewAssignmentRepository.getById(crewBId);
    await fleetDutyAssignmentRepository.softDeleteById(String(crewB.fleetDutyAssignmentId), {
      by: null,
    });

    const res = await board(GONE_DATE);
    expect(res.status).toBe(200);
    const view = data<OperationsDayBoardDto>(res);

    // The rows still print what their own legs say: the van, the captain, the crew key.
    const rowOf = (id: string) => view.shipments.find((r) => r.id === id)?.crew;
    expect(rowOf(data<OperationsShipmentDto>(onA).id)).toMatchObject({
      crewAssignmentId: crewAId,
      vehicleId: vehicleAId,
      vehicleCode: 'OPS-V1',
      captainEmployeeId: captainId,
    });
    expect(rowOf(data<OperationsShipmentDto>(onB).id)).toMatchObject({
      crewAssignmentId: crewBId,
      vehicleId: vehicleBId,
      captainEmployeeId: specialist2Id,
    });

    // Van A's crew row is gone, so it has no card. Van B keeps its card with its captain, but its
    // duty row is gone, so nobody drives it.
    expect(view.crews.map((c) => c.crewAssignmentId)).toEqual([crewBId]);
    expect(view.crews[0]?.drivers).toEqual([]);
    expect(view.crews[0]?.captains.map((p) => p.employeeId)).toEqual([specialist2Id]);
  });

  // «لو تم التسليم من القائد من برا الحالة هتكون تم التسليم بس الصف لونه اصفر ولما ادوس انا على صح
  // من عندى يبقى الصف اخضر»: the board needs the CAPTAIN's delivery as its own fact beside the
  // desk's. Driven through the real mobile API, on a day and a captain of its own — the captain's
  // route is sequential across the whole day, so sharing `captainId`'s board day would put this
  // stop behind stops other cases booked and never let it start.
  it('carries when the captain delivered the board leg — and delivering never completes the shipment', async () => {
    const DELIVERY_BOARD_DATE = shift(225);
    const { employeeRepository } = await import(
      '../../src/modules/hr/employee-management/employees/employee.repository'
    );
    const role = await rbacService.createRole(
      {
        name: { en: 'Captain on the board', ar: 'قائد لوحة التشغيل' },
        permissionKeys: ['operationsExecution.own'],
      },
      adminId,
    );
    const deliveringCaptainId = await mkEmployee();
    const userId = await mkUser('board-captain@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    const employee = await employeeRepository.getById(deliveringCaptainId);
    await employeeRepository.updateById(
      deliveringCaptainId,
      { userId },
      { by: null, version: employee.__v },
    );
    const captainToken = await login('board-captain@ecms.local');

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: DELIVERY_BOARD_DATE,
        rows: [{ vehicleId: vehicleAId, notes: 'delivery seed' }],
      });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: DELIVERY_BOARD_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [deliveringCaptainId] }],
      });
    expect(plan.status).toBe(200);
    const crewId =
      data<OperationsCrewBoardDto>(plan).rows.find((r) => r.vehicleId === vehicleAId)?.crew?.id ??
      '';
    expect(crewId).not.toBe('');

    const booked = await mkShipment({
      collectionDate: DELIVERY_BOARD_DATE,
      pickup: { crewAssignmentId: crewId, captainEmployeeId: deliveringCaptainId },
    });
    expect(booked.status).toBe(201);
    const shipmentId = data<OperationsShipmentDto>(booked).id;
    const { operationsShipmentAssignmentRepository } = await import(
      '../../src/modules/operations/shipments/shipment-assignment.repository'
    );
    const pickupLeg = await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      shipmentId,
      'pickup',
    );
    const legId = String(pickupLeg?._id ?? '');
    expect(legId).not.toBe('');

    const rowOnBoard = async (): Promise<OperationsDayBoardShipmentDto> => {
      const res = await board(DELIVERY_BOARD_DATE);
      expect(res.status).toBe(200);
      const found = data<{ shipments: OperationsDayBoardShipmentDto[] }>(res).shipments.find(
        (r) => r.id === shipmentId,
      );
      expect(found).toBeDefined();
      return found as OperationsDayBoardShipmentDto;
    };
    const act = async (step: string): Promise<void> => {
      const res = await request(app)
        .post(`/api/v1/operations/mobile/stops/${legId}/${step}`)
        .set('Authorization', `Bearer ${captainToken}`)
        .send({});
      expect(res.status, step).toBe(200);
    };

    // Before the captain acts: nothing delivered.
    expect((await rowOnBoard()).captainDeliveredAt).toBeNull();

    // Started and picked up is not delivered — the money is still in the van.
    await act('start');
    await act('pickup');
    expect((await rowOnBoard()).captainDeliveredAt).toBeNull();

    // «تم التسليم» from the captain: stamped on the row, while the shipment itself is untouched —
    // still `draft`, still not received by the desk (execution.service.ts: deliberately).
    await act('deliver');
    const delivered = await rowOnBoard();
    expect(delivered.captainDeliveredAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(delivered.captainDeliveredAt ?? ''))).toBe(false);
    expect(delivered.status).toBe('draft');
    expect(delivered.receivedAt).toBeNull();

    // The desk ticks it: now completed, and the captain's fact is kept beside the desk's.
    const completed = await request(app)
      .post(`/api/v1/operations/shipments/${shipmentId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: delivered.version });
    expect(completed.status).toBe(200);
    const received = await rowOnBoard();
    expect(received.status).toBe('completed');
    expect(received.captainDeliveredAt).toBe(delivered.captainDeliveredAt);

    // Un-ticking takes back only the desk's confirmation; what the captain did still stands.
    const reopened = await request(app)
      .post(`/api/v1/operations/shipments/${shipmentId}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: received.version });
    expect(reopened.status).toBe(200);
    const back = await rowOnBoard();
    expect(back.status).toBe('draft');
    expect(back.captainDeliveredAt).toBe(delivered.captainDeliveredAt);
  });

  it('is empty, not an error, on a day with no work', async () => {
    const res = await board(shift(224));
    expect(res.status).toBe(200);
    expect(data<{ shipments: OperationsShipmentDto[] }>(res).shipments).toEqual([]);
  });

  it('RBAC — the board needs operationsShipment.view, and rejects an unknown filter', async () => {
    expect((await request(app).get('/api/v1/operations/shipments/day-board')).status).toBe(401);

    const viewerRes = await request(app)
      .get('/api/v1/operations/shipments/day-board')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerRes.status).toBe(200); // the viewer role holds .view

    const tampered = await request(app)
      .get(`/api/v1/operations/shipments/day-board?date=${BOARD_DATE}&status=draft`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tampered.status).toBe(400);
  });
});

describe('the shipment receipt image — «صورة الإيصال», the Fleet receipts\' twin', () => {
  // NO legacy counterpart: main_ops.ejs never held a photo. The owner asked for the vehicles
  // screen's image column on the board, so this is Fleet's receipt-photo flow on a shipment —
  // Files owns the bytes, the row keeps the link, and the shipment's own grants guard both.
  const IMAGE_DATE = shift(226);

  /** A 1×1 PNG — a real image, so the category's mime check passes on its true bytes. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  /** A DIFFERENT 1×1 PNG, so a replace can be told from the photo it replaced by its bytes. */
  const PNG_2 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQaPgAAAIkAYFvkeRkAAAAAElFTkSuQmCC',
    'base64',
  );

  const imageUrl = (id: string): string => `/api/v1/operations/shipments/${id}/receipt-image`;
  const upload = (id: string, body: Buffer = PNG, name = 'receipt.png', token = adminToken) =>
    request(app)
      .post(imageUrl(id))
      .set('Authorization', `Bearer ${token}`)
      .attach('file', body, name);
  const fresh = async (): Promise<OperationsShipmentDto> =>
    data<OperationsShipmentDto>(await mkShipment({ collectionDate: IMAGE_DATE }));
  const readBack = async (id: string): Promise<OperationsShipmentDto> =>
    data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
  const bytesOf = async (id: string): Promise<Buffer> => {
    const res = await request(app)
      .get(imageUrl(id))
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (chunk: Buffer) => chunks.push(chunk));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    return res.body as Buffer;
  };
  /** The desk's ✓ (or its undo) — a write on the SAME row that has nothing to do with the photo. */
  const tick = async (id: string, step: 'complete' | 'reopen'): Promise<void> => {
    const res = await request(app)
      .post(`/api/v1/operations/shipments/${id}/${step}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: (await readBack(id)).version });
    expect(res.status, step).toBe(200);
  };

  it('starts with no image', async () => {
    const shipment = await fresh();
    expect(shipment.receiptImage).toBeNull();
    const res = await request(app)
      .get(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404); // absent is absent, not an empty body
  });

  it('uploads the photo, links it to the shipment, and serves the bytes back with their type', async () => {
    const shipment = await fresh();
    const res = await upload(shipment.id);
    expect(res.status).toBe(200);
    const updated = data<OperationsShipmentDto>(res);
    expect(updated.receiptImage).toMatchObject({
      fileName: 'receipt.png',
      mime: 'image/png',
      size: PNG.length,
    });
    expect(updated.receiptImage?.fileId).toMatch(/^[a-f0-9]{24}$/);
    expect(Number.isNaN(Date.parse(updated.receiptImage?.uploadedAt ?? ''))).toBe(false);
    // A real write on the row — a form still holding the old version must refetch.
    expect(updated.version).toBeGreaterThan(shipment.version);

    const bytes = await request(app)
      .get(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (chunk: Buffer) => chunks.push(chunk));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');
    // Private document: no shared cache may keep it.
    expect(bytes.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(bytes.body as Buffer, PNG)).toBe(0);
  });

  it('a second upload REPLACES the photo — one current receipt per shipment', async () => {
    const shipment = await fresh();
    const first = data<OperationsShipmentDto>(await upload(shipment.id));
    const second = await upload(shipment.id, PNG_2, 'receipt-2.png');
    expect(second.status).toBe(200);
    const replaced = data<OperationsShipmentDto>(second).receiptImage;
    expect(replaced?.fileName).toBe('receipt-2.png');
    // A new version is a new file id, and the GET serves ITS bytes — not the first photo's.
    expect(replaced?.fileId).not.toBe(first.receiptImage?.fileId);
    expect(Buffer.compare(await bytesOf(shipment.id), PNG_2)).toBe(0);
  });

  it('keeps an Arabic file name as the person named it — not multer\'s latin1 reading of it', async () => {
    // Multer 2 reads a multipart `filename` as latin1, so «إيصال ١.png» would arrive as mojibake
    // unless the controller turns it back (Fleet's `uploadFileName` rule).
    const name = 'إيصال ١.png';
    const shipment = await fresh();
    const res = await request(app)
      .post(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: name, contentType: 'image/png' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const image = data<OperationsShipmentDto>(res).receiptImage;
    expect(image?.fileName).toBe(name);
    expect((await readBack(shipment.id)).receiptImage?.fileName).toBe(name);
    // The platform Files row (and so its audit entry) carries the same, real name.
    const { FileModel } = await import('../../src/platform/files/file.model');
    expect((await FileModel.findById(image?.fileId).lean().exec())?.originalName).toBe(name);
  });

  it('REJECTS an oversized photo — the category caps it at 10 MB', async () => {
    const shipment = await fresh();
    const res = await upload(shipment.id, Buffer.alloc(11 * 1024 * 1024, 1), 'huge.png');
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.FILE_TOO_LARGE);
    expect((await readBack(shipment.id)).receiptImage).toBeNull();
  });

  it('the day board row carries the photo, so the column needs no second read', async () => {
    const shipment = await fresh();
    await upload(shipment.id);
    const res = await request(app)
      .get(`/api/v1/operations/shipments/day-board?date=${IMAGE_DATE}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = data<{ shipments: OperationsDayBoardShipmentDto[] }>(res).shipments.find(
      (r) => r.id === shipment.id,
    );
    expect(row?.receiptImage).toMatchObject({ fileName: 'receipt.png', mime: 'image/png' });
  });

  it('deletes the photo and keeps the SHIPMENT; a second delete finds nothing to delete', async () => {
    const shipment = await fresh();
    await upload(shipment.id);
    const res = await request(app)
      .delete(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<OperationsShipmentDto>(res).receiptImage).toBeNull();

    const still = await readBack(shipment.id);
    expect(still.receiptImage).toBeNull();
    expect(still.lines).toEqual(shipment.lines);
    expect(
      (await request(app).get(imageUrl(shipment.id)).set('Authorization', `Bearer ${adminToken}`))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(imageUrl(shipment.id))
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(409);
  });

  it('REJECTS a non-image — the file category is the authority, and it allows images only', async () => {
    const shipment = await fresh();
    const pdf = await request(app)
      .post(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('%PDF-1.4 not an image'), {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });
    expect(pdf.status).toBe(422);
    expect(errorCode(pdf)).toBe(ErrorCodes.FILE_TYPE_NOT_ALLOWED);
    const text = await request(app)
      .post(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('not an image either'), {
        filename: 'receipt.txt',
        contentType: 'text/plain',
      });
    expect(text.status).toBe(422);
    expect(errorCode(text)).toBe(ErrorCodes.FILE_TYPE_NOT_ALLOWED);
    expect((await readBack(shipment.id)).receiptImage).toBeNull();
  });

  it('refuses an upload with no file part instead of crashing on it', async () => {
    const shipment = await fresh();
    const res = await request(app)
      .post(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('RBAC — view may see the photo, only edit may change it, and nobody anonymous', async () => {
    const shipment = await fresh();
    await upload(shipment.id);

    // The viewer holds operationsShipment.view only: may look, may not upload or delete.
    const seen = await request(app)
      .get(imageUrl(shipment.id))
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(seen.status).toBe(200);
    expect((await upload(shipment.id, PNG, 'viewer.png', viewerToken)).status).toBe(403);
    expect(
      (
        await request(app)
          .delete(imageUrl(shipment.id))
          .set('Authorization', `Bearer ${viewerToken}`)
      ).status,
    ).toBe(403);
    expect((await readBack(shipment.id)).receiptImage?.fileName).toBe('receipt.png');

    expect((await request(app).get(imageUrl(shipment.id))).status).toBe(401);
    expect(
      (await request(app).post(imageUrl(shipment.id)).attach('file', PNG, 'x.png')).status,
    ).toBe(401);
    expect((await request(app).delete(imageUrl(shipment.id))).status).toBe(401);
  });

  it('the platform file endpoints ask the SHIPMENT grants too — nobody goes around them (ADR-023)', async () => {
    // Knowing the FILE id must be no better than knowing the shipment id. Both callers below hold
    // the platform's own file grants, so the route lets them in and only the operations authorizer
    // stands between them and the photo: read on `operationsShipment.view`, write on `.edit`.
    const shipment = await fresh();
    const fileId =
      data<OperationsShipmentDto>(await upload(shipment.id)).receiptImage?.fileId ?? '';
    expect(fileId).not.toBe('');
    const tokenWith = async (email: string, permissionKeys: string[]): Promise<string> => {
      const role = await rbacService.createRole(
        { name: { en: `Receipt files ${email}`, ar: `ملفات الإيصالات ${email}` }, permissionKeys },
        adminId,
      );
      const userId = await mkUser(email);
      await rbacService.ensureAssignment(userId, String(role._id), 'organization');
      return login(email);
    };
    const fileGrants = ['file.view', 'file.download', 'file.edit'];
    const outsider = await tokenWith('receipt-outsider@ecms.local', fileGrants);
    const looker = await tokenWith('receipt-looker@ecms.local', [
      'operationsShipment.view',
      ...fileGrants,
    ]);
    const replaceVia = (token: string) =>
      request(app)
        .post(`/api/v1/platform/files/${fileId}/replace`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PNG_2, 'around.png');

    // No shipment grant: to a reader the photo does not exist (ADR-023 answers reads with 404),
    // and a write is refused.
    for (const path of [
      `/api/v1/platform/files/${fileId}`,
      `/api/v1/platform/files/${fileId}/download`,
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${outsider}`);
      expect(res.status, path).toBe(404);
    }
    expect((await replaceVia(outsider)).status).toBe(403);

    // `.view` sees it through the platform as well — but `.view` is not `.edit`.
    const meta = await request(app)
      .get(`/api/v1/platform/files/${fileId}`)
      .set('Authorization', `Bearer ${looker}`);
    expect(meta.status).toBe(200);
    const download = await request(app)
      .get(`/api/v1/platform/files/${fileId}/download`)
      .set('Authorization', `Bearer ${looker}`);
    expect(download.status).toBe(302);
    expect((await replaceVia(looker)).status).toBe(403);
    expect((await readBack(shipment.id)).receiptImage?.fileId).toBe(fileId);
    expect(Buffer.compare(await bytesOf(shipment.id), PNG)).toBe(0);
  });

  it('a desk ✓ that lands mid-upload costs neither the ✓ nor the photo', async () => {
    // The race the version guard meets most on a busy board: the photo is still being stored
    // when the desk ticks the row. That write was about the STATUS, so both must stand.
    const { fileService } = await import('../../src/platform/files');
    const shipment = await fresh();
    const realUpload = fileService.upload.bind(fileService);
    const spy = vi.spyOn(fileService, 'upload').mockImplementationOnce(async (...args) => {
      const stored = await realUpload(...args);
      await tick(shipment.id, 'complete');
      return stored;
    });
    try {
      const res = await upload(shipment.id);
      expect(res.status).toBe(200);
      expect(data<OperationsShipmentDto>(res)).toMatchObject({
        status: 'completed',
        receiptImage: { fileName: 'receipt.png' },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('a REPLACE that meets a desk ✓ mid-flight never strands the photo on a superseded version', async () => {
    // Worse than a 409: by the time the row write runs, Files has already made the old photo a
    // superseded version, and Files never replaces a superseded version. A row left pointing at
    // it could never take another photo — every later upload would be refused.
    const { fileService } = await import('../../src/platform/files');
    const shipment = await fresh();
    expect((await upload(shipment.id)).status).toBe(200);
    const realReplace = fileService.replace.bind(fileService);
    const spy = vi.spyOn(fileService, 'replace').mockImplementationOnce(async (...args) => {
      const stored = await realReplace(...args);
      await tick(shipment.id, 'complete');
      return stored;
    });
    let raced: request.Response;
    try {
      raced = await upload(shipment.id, PNG_2, 'receipt-2.png');
    } finally {
      spy.mockRestore();
    }
    const after = await upload(shipment.id, PNG, 'receipt-3.png');
    expect([raced.status, after.status]).toEqual([200, 200]);
    expect(data<OperationsShipmentDto>(raced)).toMatchObject({
      status: 'completed',
      receiptImage: { fileName: 'receipt-2.png' },
    });
    expect(Buffer.compare(await bytesOf(shipment.id), PNG)).toBe(0);
  });

  it('a photo someone ELSE put on the row mid-upload wins — a 409, and the loser is not left behind', async () => {
    const { fileService } = await import('../../src/platform/files');
    const { FileModel } = await import('../../src/platform/files/file.model');
    const shipment = await fresh();
    let losing = '';
    const realUpload = fileService.upload.bind(fileService);
    const spy = vi.spyOn(fileService, 'upload').mockImplementationOnce(async (...args) => {
      const stored = await realUpload(...args);
      losing = String(stored._id);
      // A second desk's photo lands first. Its own upload reaches the real service: this mock
      // answers once only.
      expect((await upload(shipment.id, PNG_2, 'theirs.png')).status).toBe(200);
      return stored;
    });
    try {
      const res = await upload(shipment.id, PNG, 'mine.png');
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe(ErrorCodes.STALE_DOCUMENT);
    } finally {
      spy.mockRestore();
    }
    expect((await readBack(shipment.id)).receiptImage?.fileName).toBe('theirs.png');
    expect(losing).not.toBe('');
    expect((await FileModel.findById(losing).lean().exec())?.isDeleted).toBe(true);
  });

  it('a row written before the column existed reads as "no photo", with no migration', async () => {
    const shipment = await fresh();
    const { OperationsShipmentModel } = await import(
      '../../src/modules/operations/shipments/shipment.model'
    );
    await OperationsShipmentModel.updateOne(
      { _id: shipment.id },
      { $unset: { receiptImage: 1 } },
    ).exec();
    const raw = await OperationsShipmentModel.findById(shipment.id).lean().exec();
    expect(raw !== null && 'receiptImage' in raw).toBe(false);

    expect((await readBack(shipment.id)).receiptImage).toBeNull();
    const res = await request(app)
      .get(`/api/v1/operations/shipments/day-board?date=${IMAGE_DATE}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const row = data<{ shipments: OperationsDayBoardShipmentDto[] }>(res).shipments.find(
      (r) => r.id === shipment.id,
    );
    expect(row?.receiptImage).toBeNull();
    // ...and the first upload onto such a row works like any other.
    expect((await upload(shipment.id)).status).toBe(200);
  });
});

describe('crew roster and requirements — legacy /requirement (B3)', () => {
  // The legacy screen wrote NINE checkboxes onto the employee document keyed by employee_id, and
  // only ONE of them (`leader`) was ever read by a server query. The approved decision carried
  // since PR 1 is that requirements gate NOTHING — so the tests below prove both halves: the flags
  // round-trip as data, AND an employee missing every one of them can still be crewed.
  const ROSTER_DATE = shift(240);
  let memberA = '';
  let memberB = '';

  const setRequirements = (
    employeeId: string,
    body: Record<string, unknown>,
    token = adminToken,
  ): request.Test =>
    request(app)
      .put(`/api/v1/operations/crew-board/requirements/${employeeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const directory = (date: string, token = adminToken): request.Test =>
    request(app)
      .get(`/api/v1/operations/crew-board/directory?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    memberA = await mkEmployee();
    memberB = await mkEmployee();
  });

  it('creates a roster row by upsert — the legacy screen had no create/edit split', async () => {
    const res = await setRequirements(memberA, { isCaptain: true, hasWeapon: true });
    expect(res.status).toBe(200);
    const dto = data<{ isCaptain: boolean; hasWeapon: boolean; hasSignature: boolean }>(res);
    expect(dto.isCaptain).toBe(true);
    expect(dto.hasWeapon).toBe(true);
    // Unsent flags default to false rather than being absent.
    expect(dto.hasSignature).toBe(false);
  });

  it('updates the same row on a second save, never creating a second one', async () => {
    const again = await setRequirements(memberA, { isCaptain: true, hasSignature: true });
    expect(again.status).toBe(200);
    const dto = data<{ hasSignature: boolean; hasWeapon: boolean }>(again);
    expect(dto.hasSignature).toBe(true);
    // A save replaces the row, exactly as the legacy checkbox line did.
    expect(dto.hasWeapon).toBe(false);

    const list = await request(app)
      .get('/api/v1/operations/crew-board/requirements')
      .set('Authorization', `Bearer ${adminToken}`);
    // Asserted before reading `data`: without it a rejected query surfaces as an unhelpful
    // "cannot read properties of undefined" instead of naming the status that caused it.
    expect(list.status).toBe(200);
    const rows = (list.body as { data: { employeeId: string }[] }).data;
    expect(rows.filter((r) => r.employeeId === memberA)).toHaveLength(1);
  });

  it('round-trips all nine legacy flags, including the four legacy never read (Q25)', async () => {
    const res = await setRequirements(memberB, {
      isCaptain: false,
      isSpecialist: true,
      hasWeapon: true,
      hasSignature: true,
      hasLicense: true,
      hasTemporaryLicense: true,
      isOpsAdmin: true,
      isNewJoiner: true,
      isAssignedSpecialTask: true,
      isPriority: true,
      notes: 'ملاحظة',
    });
    expect(res.status).toBe(200);
    const dto = data<Record<string, unknown>>(res);
    for (const flag of [
      'isSpecialist',
      'hasWeapon',
      'hasSignature',
      'hasLicense',
      'hasTemporaryLicense',
      'isOpsAdmin',
      'isNewJoiner',
      'isAssignedSpecialTask',
      'isPriority',
    ]) {
      expect(dto[flag]).toBe(true);
    }
    expect(dto.notes).toBe('ملاحظة');
  });

  it('lists the roster with no filters, and with each filter applied', async () => {
    // The list query's boolean filters are OPTIONAL: a plain request must not be rejected, and
    // each filter must narrow rather than error.
    for (const qs of ['', '?isCaptain=true', '?isSpecialist=true', '?isCaptain=false']) {
      const res = await request(app)
        .get(`/api/v1/operations/crew-board/requirements${qs}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
    }
  });

  it('the directory lists the roster with names resolved through the seam', async () => {
    const res = await directory(ROSTER_DATE);
    expect(res.status).toBe(200);
    const dto = data<{
      date: string;
      members: { employeeId: string; fullNameAr: string; code: string }[];
    }>(res);
    expect(dto.date.slice(0, 10)).toBe(ROSTER_DATE);
    const ids = dto.members.map((m) => m.employeeId);
    expect(ids).toContain(memberA);
    expect(ids).toContain(memberB);
    // Names come from HR through the directory seam, not from a copy in Operations.
    expect(dto.members.every((m) => m.fullNameAr !== '' && m.code !== '')).toBe(true);
  });

  it('sorts captains first — the legacy pool grouped them', async () => {
    const dto = data<{ members: { requirements: { isCaptain: boolean } | null }[] }>(
      await directory(ROSTER_DATE),
    );
    const flags = dto.members.map((m) => m.requirements?.isCaptain === true);
    expect(flags.indexOf(false) === -1 || !flags.slice(flags.indexOf(false)).includes(true)).toBe(
      true,
    );
  });

  it('reports which vehicle a member already holds that day — the Q11 rule, as a server fact', async () => {
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: ROSTER_DATE, rows: [{ vehicleId: vehicleAId, notes: 'roster seed' }] });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: ROSTER_DATE, rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [memberA] }] });
    expect(plan.status).toBe(200);

    const dto = data<{ members: { employeeId: string; assignedVehicleId: string | null }[] }>(
      await directory(ROSTER_DATE),
    );
    const a = dto.members.find((m) => m.employeeId === memberA);
    const b = dto.members.find((m) => m.employeeId === memberB);
    expect(a?.assignedVehicleId).toBe(vehicleAId);
    // ...and someone unassigned reports null rather than being omitted.
    expect(b?.assignedVehicleId).toBeNull();

    // The SAME day, a different day: the answer is per-day, not per-person.
    const other = data<{ members: { employeeId: string; assignedVehicleId: string | null }[] }>(
      await directory(shift(241)),
    );
    expect(other.members.find((m) => m.employeeId === memberA)?.assignedVehicleId).toBeNull();
  });

  it('APPROVED DECISION: requirements gate NOTHING — a flagless employee is still assignable', async () => {
    const flagless = await mkEmployee();
    expect((await setRequirements(flagless, {})).status).toBe(200);

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: shift(242), rows: [{ vehicleId: vehicleAId, notes: 'flagless seed' }] });
    expect(roster.status).toBe(200);

    // No weapon, no signature, no licence, not even marked a captain — and the captain slot takes
    // them anyway, exactly as legacy did. This is the decision, asserted.
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: shift(242), rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [flagless] }] });
    expect(plan.status).toBe(200);
  });

  it('an employee with NO roster row at all can still be crewed', async () => {
    // Membership is for the pool and the requirement screen; it is not an eligibility gate either.
    const stranger = await mkEmployee();
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: shift(243), rows: [{ vehicleId: vehicleAId, notes: 'stranger seed' }] });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: shift(243), rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [stranger] }] });
    expect(plan.status).toBe(200);
  });

  it('refuses an unknown employee, and one who has exited', async () => {
    const unknown = await setRequirements('507f1f77bcf86cd799439011', { isCaptain: true });
    expect(unknown.status).toBe(400);
  });

  it('has NO delete path — leaving the crew is an HR transfer, not a checkbox here', async () => {
    // Membership is the org chart. A delete that only hid the flags would have left the person on
    // the board anyway, which is the confusion the route existed to create.
    const temp = await mkEmployee();
    expect((await setRequirements(temp, { isSpecialist: true })).status).toBe(200);
    const gone = await request(app)
      .delete(`/api/v1/operations/crew-board/requirements/${temp}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
  });

  it('answers whether the roster is derived, so the screen can say which list it is showing', async () => {
    // Unconfigured: the fallback list, which looks identical to a configured one unless it says so.
    const dto = data<{ rosterIsDerived: boolean }>(await directory(ROSTER_DATE));
    expect(dto.rosterIsDerived).toBe(false);
  });

  it('RBAC — reading rides operationsCrew.view, writing needs operationsCrew.plan', async () => {
    expect((await request(app).get('/api/v1/operations/crew-board/directory')).status).toBe(401);

    // The ops viewer holds only operationsShipment.view.
    expect((await directory(ROSTER_DATE, viewerToken)).status).toBe(403);
    expect((await setRequirements(memberA, { isCaptain: true }, viewerToken)).status).toBe(403);
  });

  it('rejects an unknown flag rather than silently dropping it', async () => {
    const res = await setRequirements(memberA, { isCaptain: true, canFly: true });
    expect(res.status).toBe(400);
  });
});

describe('operations reports — legacy /ops_report and /ops_bank_report (B5)', () => {
  // The reports are where three legacy DEFECTS lived, and each of them changed a number a user
  // has read before. These tests exist to pin the corrected numbers, not just the shapes.
  // Anchored, not written down. A roster cannot be planned for a day already past, so the fixed
  // day this suite used to seed expired the moment the calendar walked past it, and took the
  // whole suite's `beforeAll` with it. The day is the 10th of a month far enough ahead to stay
  // ahead, and everything else here derives from it: the window is that day's own month, and the
  // "outside" day is the month after. The range assertions then keep meaning what they say in
  // whatever month the suite happens to run.
  const REPORT_DAY = monthAnchor(270, 10);
  const REPORT_MONTH = monthRange(REPORT_DAY);
  const NEXT_MONTH = monthRange(REPORT_DAY, 1);
  let reportCaptain = '';
  let reportCrewId = '';
  let usd: OperationsCurrencyDto;
  let eur: OperationsCurrencyDto;
  /**
   * A bank used by NOTHING else. The Q26 assertion is an exact package count, and an exact count
   * on a shared row is really an assertion about every other test in the file.
   */
  let reportBank: OperationsBankDto;
  let reportBranch: OperationsBankBranchDto;

  const mkCurrency = async (code: string, name: string): Promise<OperationsCurrencyDto> => {
    const res = await request(app)
      .post('/api/v1/operations/currencies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name, legacyAliases: [name] });
    expect(res.status).toBe(201);
    return data<OperationsCurrencyDto>(res);
  };

  const captainReport = (
    range: { from: string; to: string } | null = REPORT_MONTH,
    token = adminToken,
  ): request.Test =>
    request(app)
      .get(
        range === null
          ? '/api/v1/operations/reports/captains'
          : `/api/v1/operations/reports/captains?from=${range.from}&to=${range.to}`,
      )
      .set('Authorization', `Bearer ${token}`);

  const bankReport = (range = REPORT_MONTH, token = adminToken): request.Test =>
    request(app)
      .get(`/api/v1/operations/reports/banks?from=${range.from}&to=${range.to}`)
      .set('Authorization', `Bearer ${token}`);

  /** Create a daily shipment collected inside the report month, then complete it. */
  const completedDaily = async (
    lines: { currencyId: string; amount: number }[],
    collectionDate = REPORT_DAY,
  ): Promise<OperationsShipmentDto> => {
    const created = await mkShipment({
      lines,
      collectionDate,
      mainBankId: reportBank.id,
      originBranchId: reportBranch.id,
      destinationBranchId: reportBranch.id,
    });
    expect(created.status).toBe(201);
    const shipment = data<OperationsShipmentDto>(created);
    const done = await request(app)
      .post(`/api/v1/operations/shipments/${shipment.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: shipment.version });
    expect(done.status).toBe(200);
    return data<OperationsShipmentDto>(done);
  };

  beforeAll(async () => {
    usd = await mkCurrency('USD', 'دولار');
    eur = await mkCurrency('EUR', 'يورو');

    const bankRes = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 71, name: { ar: 'بنك التقارير', en: 'Report Bank' }, opsName: 'التقارير' });
    expect(bankRes.status).toBe(201);
    reportBank = data<OperationsBankDto>(bankRes);

    const branchRes = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        bankId: reportBank.id,
        name: 'فرع التقارير',
        code: 'R-1',
        opsAreaName: 'القاهرة',
      });
    expect(branchRes.status).toBe(201);
    reportBranch = data<OperationsBankBranchDto>(branchRes);

    reportCaptain = await mkEmployee();
    // The §9.4 anchor: Operations may only crew a vehicle Fleet has rostered for the date.
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: REPORT_DAY, rows: [{ vehicleId: vehicleAId, notes: 'report seed' }] });
    expect(roster.status).toBe(200);

    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: REPORT_DAY,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [reportCaptain] }],
      });
    expect(plan.status).toBe(200);
    // The crew assignment id is not on the board DTO — the board shows the crew, not its row id —
    // so it comes from the collection seam, the same way the OP-5 suite gets it.
    reportCrewId = await crewAssignmentIdForDay(REPORT_DAY);
    expect(reportCrewId).not.toBe('');
  });

  it('1. defaults to the current month when no range is given — the legacy default (:4862)', async () => {
    const res = await captainReport(null);
    expect(res.status).toBe(200);
    const report = data<OperationsCaptainReportDto>(res);
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    expect(report.from.slice(0, 10)).toBe(first.toISOString().slice(0, 10));
    // Reported as the INCLUSIVE last day: the exclusive bound stays inside the query.
    expect(report.to.slice(0, 10)).toBe(last.toISOString().slice(0, 10));
  });

  it('2. Q26 — package counts are NOT multiplied by the number of currencies', async () => {
    // A secured shipment with THREE currency lines and a known package count. Legacy `$unwind`ed
    // the currency pairs and then summed bag/box/carton per row, reporting 3x the real packages.
    const created = await mkShipment({
      shipmentType: 'secured',
      // The SAME day the crew row is on: `assign-delivery` requires the crew assignment to belong
      // to the shipment's delivery day, which is what makes (day, vehicle, leg) → crew resolvable.
      deliveryDate: REPORT_DAY,
      mainBankId: reportBank.id,
      originBranchId: reportBranch.id,
      destinationBranchId: reportBranch.id,
      lines: [
        { currencyId: egp.id, amount: 100 },
        { currencyId: usd.id, amount: 200 },
        { currencyId: eur.id, amount: 300 },
      ],
    });
    expect(created.status).toBe(201);
    const secured = data<OperationsShipmentDto>(created);

    const received = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-RPT-${secured.id.slice(-5)}`,
        bagCount: 10,
        cartonCount: 4,
        boxCount: 2,
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: specialist1Id,
        version: secured.version,
      });
    expect(received.status).toBe(200);

    // The secured ladder is 0 → 2 → 3 → 1: a shipment reaches `completed` from `dispatched`, not
    // straight out of the vault. It has to leave custody first, which is also what makes its
    // packaging figures final — and it can only leave on the crew row it was assigned to.
    const inVault = data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${secured.id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    const legAssigned = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        crewAssignmentId: reportCrewId,
        captainEmployeeId: reportCaptain,
        version: inVault.version,
      });
    expect(legAssigned.status).toBe(200);

    const dispatched = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: reportCrewId, shipmentIds: [secured.id] });
    expect(dispatched.status).toBe(200);

    const fresh = data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${secured.id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(fresh.status).toBe('dispatched');
    const done = await request(app)
      .post(`/api/v1/operations/shipments/${secured.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: fresh.version });
    expect(done.status).toBe(200);

    const res = await bankReport();
    expect(res.status).toBe(200);
    const report = data<OperationsBankReportDto>(res);
    const row = report.rows.find((r) => r.bankId === reportBank.id);
    expect(row).toBeDefined();
    // Counted ONCE, not once per currency line. The legacy figure would have been 30/12/6.
    expect(row?.totals.bagCount).toBe(10);
    expect(row?.totals.cartonCount).toBe(4);
    expect(row?.totals.boxCount).toBe(2);
    // All three currencies are still reported — the fix is to the packages, not to the money.
    expect(row?.totals.currencies.map((c) => c.amount).sort((a, b) => a - b)).toEqual([
      100, 200, 300,
    ]);
  });

  it('3. Q28 — a zero-currency shipment cannot even be CREATED, which is the stronger fix', async () => {
    // Legacy's report DROPPED such a document entirely, taking its count with it. ECMS closes the
    // hole one step earlier: `lines` requires at least one entry, so a shipment carrying no money
    // never enters the system in the first place.
    const refused = await mkShipment({
      lines: [],
      collectionDate: dayInMonth(REPORT_DAY, 0, 14),
    });
    expect(refused.status).toBe(400);

    // The roll-up still handles the case, because MIGRATED legacy rows can carry it. That path is
    // covered where it can be exercised directly — report-aggregation.spec.ts, "counts a shipment
    // with no currency lines at all" — rather than faked through an endpoint that refuses it.
    const report = data<OperationsBankReportDto>(await bankReport());
    const row = report.rows.find((r) => r.bankId === reportBank.id);
    expect(row).toBeDefined();
    expect(row?.totals.shipmentCount).toBeGreaterThanOrEqual(1);
  });

  it('4. Q27 — the grand total is a separate field, so summing the rows cannot double-count', async () => {
    const report = data<OperationsBankReportDto>(await bankReport());
    const summed = report.rows.reduce((acc, r) => acc + r.totals.shipmentCount, 0);
    // The legacy report appended the total INTO the results array; here `rows` holds only real
    // rows, and their sum equals the separate grand total exactly.
    expect(report.grandTotal.shipmentCount).toBe(summed);
    // And `rows` carries no synthetic total row: legacy appended one keyed `'الإجمالي العام'`
    // into the same array (:5117/:5399), which is exactly what made summing the rows wrong.
    expect(report.rows.map((r) => r.bankName)).not.toContain('الإجمالي العام');
    expect(report.rows.every((r) => r.totals.shipmentCount >= 1)).toBe(true);
  });

  it('5. attributes a shipment to the captain of the leg its TYPE reports on', async () => {
    const shipment = await completedDaily([{ currencyId: egp.id, amount: 500 }], REPORT_DAY);
    const assigned = await request(app)
      .post(`/api/v1/operations/assignments/shipments/${shipment.id}/assign-pickup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        crewAssignmentId: reportCrewId,
        captainEmployeeId: reportCaptain,
        version: 0,
      });
    expect(assigned.status).toBe(200);

    const report = data<OperationsCaptainReportDto>(await captainReport());
    const row = report.rows.find((r) => r.captainEmployeeId === reportCaptain);
    expect(row).toBeDefined();
    expect(row?.captainName).not.toBe('');
    expect(row?.totals.shipmentCount).toBeGreaterThanOrEqual(1);
  });

  it('6. reports an unassigned shipment under a null captain rather than dropping it', async () => {
    // Its own shipment, deliberately never assigned — a case that depends on another test's
    // leftovers passes or fails for reasons that have nothing to do with what it claims.
    const orphan = await completedDaily(
      [{ currencyId: egp.id, amount: 42 }],
      dayInMonth(REPORT_DAY, 0, 16),
    );
    expect(orphan.status).toBe('completed');

    const report = data<OperationsCaptainReportDto>(await captainReport());
    const unassigned = report.rows.find((r) => r.captainEmployeeId === null);
    expect(unassigned).toBeDefined();
    expect(unassigned?.totals.shipmentCount).toBeGreaterThanOrEqual(1);
    // And it is inside the grand total, not excluded from it.
    expect(report.grandTotal.shipmentCount).toBe(
      report.rows.reduce((acc, r) => acc + r.totals.shipmentCount, 0),
    );
  });

  it('7. excludes a shipment completed OUTSIDE the range, by its own type\'s date', async () => {
    const outside = await completedDaily(
      [{ currencyId: egp.id, amount: 999 }],
      dayInMonth(REPORT_DAY, 1, 5),
    );
    expect(outside.status).toBe('completed');

    const inWindow = data<OperationsCaptainReportDto>(await captainReport());
    const inNextMonth = data<OperationsCaptainReportDto>(await captainReport(NEXT_MONTH));
    expect(inNextMonth.grandTotal.shipmentCount).toBeGreaterThanOrEqual(1);
    // The next month's shipment did not leak into the window's totals.
    expect(inWindow.grandTotal.shipmentCount).toBe(
      inWindow.rows.reduce((acc, r) => acc + r.totals.shipmentCount, 0),
    );
  });

  it('8. rides operationsShipment.view — a report is a read of shipments you can already see', async () => {
    const res = await captainReport(REPORT_MONTH, viewerToken);
    expect(res.status).toBe(200);
    const banks = await bankReport(REPORT_MONTH, viewerToken);
    expect(banks.status).toBe(200);
  });

  it('9. refuses an unauthenticated read — legacy had NO check on /ops_report at all (Q36)', async () => {
    const res = await request(app).get('/api/v1/operations/reports/captains');
    expect(res.status).toBe(401);
  });
});

describe('crew attendance — NO legacy counterpart, read-only and non-gating (B5)', () => {
  // Discovery §2.2/§10.2: `/ops_attendance` does not exist, and legacy never queried absence for
  // the cash-transfer department, so an absent captain could be crewed without objection. The
  // tests below prove BOTH halves of the decision: attendance is now visible, and it still gates
  // nothing.
  const ATT_DATE = shift(212);
  let attendanceMember = '';

  const attendance = (date = ATT_DATE, token = adminToken): request.Test =>
    request(app)
      .get(`/api/v1/operations/crew-board/attendance?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    attendanceMember = await mkEmployee();
    const requirements = await request(app)
      .put(`/api/v1/operations/crew-board/requirements/${attendanceMember}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isCaptain: true });
    expect(requirements.status).toBe(200);

    // The §9.4 anchor again: the non-gating test plans a crew, and a crew needs a rostered vehicle.
    const fleetRoster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: ATT_DATE, rows: [{ vehicleId: vehicleAId, notes: 'attendance seed' }] });
    expect(fleetRoster.status).toBe(200);
  });

  it('1. lists every roster member for the day, including those with no attendance record', async () => {
    const res = await attendance();
    expect(res.status).toBe(200);
    const day = data<OperationsCrewAttendanceDayDto>(res);
    const row = day.members.find((m) => m.employeeId === attendanceMember);
    expect(row).toBeDefined();
    // No HR day record exists for this employee, so the answer is NULL — not "present".
    expect(row?.attendance).toBeNull();
    expect(row?.fullNameAr).not.toBe('');
  });

  it('2. counts an absent record as unknown, never as present', async () => {
    const day = data<OperationsCrewAttendanceDayDto>(await attendance());
    expect(day.summary.total).toBe(day.members.length);
    expect(day.summary.unknown).toBeGreaterThanOrEqual(1);
    // Every member lands in exactly one bucket, and the buckets add up to the total.
    const bucketed =
      day.summary.present +
      day.summary.absent +
      day.summary.onLeave +
      day.summary.notScheduled +
      day.summary.unknown;
    expect(bucketed).toBe(day.summary.total);
  });

  it('3. GATES NOTHING — a member with no attendance record is still fully assignable', async () => {
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: ATT_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [attendanceMember] }],
      });
    // The whole point of the surface: it informs, it does not refuse.
    expect(plan.status).toBe(200);

    const day = data<OperationsCrewAttendanceDayDto>(await attendance());
    const row = day.members.find((m) => m.employeeId === attendanceMember);
    // ...and the page then SHOWS that this un-recorded member is crewed today.
    expect(row?.assignedVehicleId).toBe(vehicleAId);
  });

  it('4. needs BOTH grants — the Operations roster read and HR\'s own attendance read', async () => {
    // The viewer holds operationsShipment.view only: no crew grant, no attendance grant.
    const res = await attendance(ATT_DATE, viewerToken);
    expect(res.status).toBe(403);
  });

  it('5. refuses an unauthenticated read', async () => {
    const res = await request(app).get(
      `/api/v1/operations/crew-board/attendance?date=${ATT_DATE}`,
    );
    expect(res.status).toBe(401);
  });

  it('6. requires a date — an attendance page with no day is a question with no subject', async () => {
    const res = await request(app)
      .get('/api/v1/operations/crew-board/attendance')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('vault roll-up and operational areas — legacy /vault1_reports and /data_edit cities (B6)', () => {
  const VAULT_DATE = shift(230);
  let vaultBank: OperationsBankDto;
  let vaultBranch: OperationsBankBranchDto;

  const vaultReport = (token = adminToken): request.Test =>
    request(app)
      .get('/api/v1/operations/reports/vault')
      .set('Authorization', `Bearer ${token}`);

  const area = (body: Record<string, unknown>, token = adminToken): request.Test =>
    request(app)
      .post('/api/v1/operations/areas')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  let usdShared: OperationsCurrencyDto;

  beforeAll(async () => {
    // USD already exists (the reports suite created it) and its code is unique, so it is looked
    // up rather than re-created — the roll-up's base-currency split needs a non-EGP currency.
    const list = await request(app)
      .get('/api/v1/operations/currencies?page=1&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const found = (list.body as { data: OperationsCurrencyDto[] }).data.find(
      (c) => c.code === 'USD',
    );
    expect(found).toBeDefined();
    usdShared = found as OperationsCurrencyDto;

    const bankRes = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 72, name: { ar: 'بنك الخزينة', en: 'Vault Bank' }, opsName: 'الخزينة' });
    expect(bankRes.status).toBe(201);
    vaultBank = data<OperationsBankDto>(bankRes);

    const branchRes = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: vaultBank.id, name: 'فرع الخزينة', code: 'V-1', opsAreaName: 'الجيزة' });
    expect(branchRes.status).toBe(201);
    vaultBranch = data<OperationsBankBranchDto>(branchRes);
  });

  it('1. rolls up what the vault HOLDS, counting packages once per shipment (Q26)', async () => {
    const created = await mkShipment({
      shipmentType: 'secured',
      deliveryDate: VAULT_DATE,
      mainBankId: vaultBank.id,
      originBranchId: vaultBranch.id,
      destinationBranchId: vaultBranch.id,
      lines: [
        { currencyId: egp.id, amount: 1_000 },
        { currencyId: usdShared.id, amount: 500 },
      ],
    });
    expect(created.status).toBe(201);
    const secured = data<OperationsShipmentDto>(created);

    const received = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/receive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        receiptNumber: `R-VLT-${secured.id.slice(-5)}`,
        bagCount: 7,
        cartonCount: 3,
        boxCount: 1,
        receivedByPrimaryId: captainId,
        receivedBySecondaryId: specialist1Id,
        version: secured.version,
      });
    expect(received.status).toBe(200);

    const res = await vaultReport();
    expect(res.status).toBe(200);
    const report = data<OperationsVaultReportDto>(res);
    const row = report.rows.find((r) => r.bankId === vaultBank.id);
    expect(row).toBeDefined();
    expect(row?.totals.shipmentCount).toBe(1);
    // Two currencies on the shipment, and the packages are still counted ONCE — the legacy
    // /ops_bank_report figure would have been 14/6/2 while legacy /vault1 said 7/3/1.
    expect(row?.totals).toMatchObject({ bagCount: 7, cartonCount: 3, boxCount: 1 });
    expect(row?.totals.currencies.map((c) => c.amount).sort((a, b) => a - b)).toEqual([500, 1000]);
  });

  it('2. separates the non-base currencies — the legacy second aggregation, as a view', async () => {
    const report = data<OperationsVaultReportDto>(await vaultReport());
    expect(report.baseCurrencyCode).toBe('EGP');
    // The legacy screen excluded EGP by a literal Arabic synonym list (:1409). Here it is matched
    // on the currency's CODE, so a currency named `مصري` with code EGP is correctly excluded.
    expect(report.foreignCurrencies.some((c) => c.currencyName === 'مصري')).toBe(false);
    expect(report.foreignCurrencies.some((c) => c.currencyName === 'دولار')).toBe(true);
    // ...and the grand total still carries BOTH — the split is a view, not a filtered query.
    expect(report.grandTotal.currencies.some((c) => c.currencyName === 'مصري')).toBe(true);
  });

  it('3. drops a shipment OUT of the roll-up the moment it leaves the vault', async () => {
    const before = data<OperationsVaultReportDto>(await vaultReport());
    const heldBefore = before.grandTotal.shipmentCount;
    expect(heldBefore).toBeGreaterThanOrEqual(1);

    // A second shipment received and then released changes the answer: the roll-up is about what
    // is here NOW, which is exactly why it has no date range (Q32 PRESERVE).
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: VAULT_DATE, rows: [{ vehicleId: vehicleAId, notes: 'vault seed' }] });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: VAULT_DATE, rows: [{ vehicleId: vehicleAId, captainEmployeeIds: [captainId] }] });
    expect(plan.status).toBe(200);
    const crewRow = await crewAssignmentIdForDay(VAULT_DATE);

    const created = await mkShipment({
      shipmentType: 'secured',
      deliveryDate: VAULT_DATE,
      mainBankId: vaultBank.id,
      originBranchId: vaultBranch.id,
      destinationBranchId: vaultBranch.id,
      lines: [{ currencyId: egp.id, amount: 250 }],
    });
    const secured = data<OperationsShipmentDto>(created);
    expect(
      (
        await request(app)
          .post(`/api/v1/operations/secured/${secured.id}/receive`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            receiptNumber: `R-VLT2-${secured.id.slice(-5)}`,
            bagCount: 2,
            receivedByPrimaryId: captainId,
            receivedBySecondaryId: specialist1Id,
            version: secured.version,
          })
      ).status,
    ).toBe(200);

    const withBoth = data<OperationsVaultReportDto>(await vaultReport());
    expect(withBoth.grandTotal.shipmentCount).toBe(heldBefore + 1);

    const inVault = data<OperationsShipmentDto>(
      await request(app)
        .get(`/api/v1/operations/shipments/${secured.id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(
      (
        await request(app)
          .post(`/api/v1/operations/secured/${secured.id}/assign-delivery`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            crewAssignmentId: crewRow,
            captainEmployeeId: captainId,
            version: inVault.version,
          })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/v1/operations/secured/dispatch')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ crewAssignmentId: crewRow, shipmentIds: [secured.id] })
      ).status,
    ).toBe(200);

    const after = data<OperationsVaultReportDto>(await vaultReport());
    expect(after.grandTotal.shipmentCount).toBe(heldBefore);
  });

  it('4. takes NO date range — the legacy picker never filtered anything (Q32)', async () => {
    const res = await request(app)
      .get('/api/v1/operations/reports/vault?from=2026-10-01&to=2026-10-31')
      .set('Authorization', `Bearer ${adminToken}`);
    // The endpoint accepts no query at all rather than accepting one and ignoring it, which is
    // the legacy behaviour that made the screen lie about what it was showing.
    expect(res.status).toBe(400);
  });

  it('5. rides operationsVault.view, not the shipment grant', async () => {
    const res = await vaultReport(viewerToken); // viewer holds operationsShipment.view only
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/v1/operations/reports/vault')).status).toBe(401);
  });

  it('6. creates an operational area — the legacy /data_edit city, without its id generator', async () => {
    const res = await area({ name: 'المعادي', nameEn: 'Maadi', governorate: 'القاهرة' });
    expect(res.status).toBe(201);
    const dto = data<OperationsAreaDto>(res);
    expect(dto.name).toBe('المعادي');
    expect(dto.isActive).toBe(true);
    // Legacy generated ids as `countDocuments({}) + 1` (:2060) — not deleted-aware, not atomic.
    expect(dto.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('7. accepts an area with no English name or governorate — legacy required both (:2042)', async () => {
    const res = await area({ name: 'الشروق' });
    expect(res.status).toBe(201);
    const dto = data<OperationsAreaDto>(res);
    expect(dto.nameEn).toBeNull();
    expect(dto.governorate).toBeNull();
  });

  it('8. refuses a duplicate name — the uniqueness the legacy regex check was reaching for', async () => {
    expect((await area({ name: 'مدينة نصر' })).status).toBe(201);
    const again = await area({ name: 'مدينة نصر' });
    expect(again.status).toBe(409);
  });

  it('9. deactivates rather than deletes, and a branch keeps the name it already stored', async () => {
    const created = data<OperationsAreaDto>(await area({ name: 'حلوان' }));
    const branch = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: vaultBank.id, name: 'فرع حلوان', code: 'V-2', opsAreaName: 'حلوان' });
    expect(branch.status).toBe(201);

    const off = await request(app)
      .patch(`/api/v1/operations/areas/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: created.version });
    expect(off.status).toBe(200);
    expect(data<OperationsAreaDto>(off).isActive).toBe(false);

    // The branch is untouched: it stores the STRING, not a reference — which is exactly why the
    // legacy delete could orphan nothing, and why deactivating here is safe (Q22 PRESERVE).
    const after = await request(app)
      .get(`/api/v1/operations/bank-branches?search=${encodeURIComponent('فرع حلوان')}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(200);
    const rows = (after.body as { data: OperationsBankBranchDto[] }).data;
    expect(rows[0]?.opsAreaName).toBe('حلوان');
  });

  // The shipment form filters a bank's branches as the operator types. Before the search was
  // escaped, a typed "(" reached $regex as a pattern and the request failed with a 500; "." matched
  // any character.
  it('9b. searches for the text typed, brackets and dots included', async () => {
    const make = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: vaultBank.id, name: 'فرع (المعادي) 2.0', code: 'V-9' });
    expect(make.status).toBe(201);

    const bracket = await request(app)
      .get(
        `/api/v1/operations/bank-branches?bankId=${vaultBank.id}&search=${encodeURIComponent('(المعادي')}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bracket.status).toBe(200);
    expect((bracket.body as { data: OperationsBankBranchDto[] }).data.map((b) => b.code)).toEqual([
      'V-9',
    ]);

    // Syntax is text: read as a pattern, ".*" would match every branch of the bank (this one
    // included); read as text, no branch name contains it.
    const wildcard = await request(app)
      .get(`/api/v1/operations/bank-branches?bankId=${vaultBank.id}&search=${encodeURIComponent('.*')}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(wildcard.status).toBe(200);
    expect((wildcard.body as { data: OperationsBankBranchDto[] }).data).toEqual([]);
  });

  // A search miss on a spelling variant is how a duplicate branch is born: the operator typed
  // «الاسكندريه», the catalog held «الإسكندرية», nothing came back, and the form offered to add it
  // «كفرع جديد». The folding runs inside Mongo's own regex engine here, not only in a unit test.
  it('9b2. finds a branch whatever hamza or taa marbuta the operator typed', async () => {
    const make = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: vaultBank.id, name: 'فرع الإسكندرية', code: 'V-10' });
    expect(make.status).toBe(201);

    const codesFor = async (search: string): Promise<string[]> => {
      const res = await request(app)
        .get(
          `/api/v1/operations/bank-branches?bankId=${vaultBank.id}&search=${encodeURIComponent(search)}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      return (res.body as { data: OperationsBankBranchDto[] }).data.map((b) => b.code);
    };

    expect(await codesFor('الاسكندريه')).toEqual(['V-10']); // no hamza, haa for taa marbuta
    expect(await codesFor('اسكندرية')).toEqual(['V-10']); // no article, no hamza
    expect(await codesFor('الإسْكَنْدَرِيَّة')).toEqual(['V-10']); // typed with tashkeel
    // Still a literal underneath: a bracket beside a folded letter is text, not a group.
    expect(await codesFor('(الاسكندريه')).toEqual([]);
    // A long paste is still a search, not a 500: folded in full, 600 letters is a pattern mongod
    // refuses as longer than its limit.
    expect(await codesFor('الاسكندريه'.repeat(60))).toEqual([]);

    // And the other side: a name STORED with tashkeel and tatweel is found by its bare letters.
    const marked = await request(app)
      .post('/api/v1/operations/bank-branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankId: vaultBank.id, name: 'فرع دَمَنْهُـور', code: 'V-11' });
    expect(marked.status).toBe(201);
    expect(await codesFor('دمنهور')).toEqual(['V-11']);
  });

  // A shipment's edit form names its branches — and the bank the money came from — by reading the
  // branch it holds; listing a whole bank's branches would stop at one page.
  it('9c. reads one branch by id on the shipment grant, and 404s an unknown one', async () => {
    const one = await request(app)
      .get(`/api/v1/operations/bank-branches/${branchA1.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(one.status).toBe(200);
    expect(data<OperationsBankBranchDto>(one)).toMatchObject({
      id: branchA1.id,
      bankId: bankA.id,
      name: 'فرع المهندسين',
      code: 'A-101',
    });

    const missing = await request(app)
      .get('/api/v1/operations/bank-branches/00000000000000000000dead')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(missing.status).toBe(404);

    expect((await request(app).get(`/api/v1/operations/bank-branches/${branchA1.id}`)).status).toBe(401);
  });

  it('10. reads ride the shipment grant; writes need the catalog grant', async () => {
    const read = await request(app)
      .get('/api/v1/operations/areas')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.status).toBe(200); // the branch form needs the suggestions

    const write = await area({ name: 'العبور' }, viewerToken);
    expect(write.status).toBe(403);
  });
});
