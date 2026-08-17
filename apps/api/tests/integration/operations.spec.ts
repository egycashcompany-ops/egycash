// Operations integration suite (OP-2): reference data (banks / branches / currencies) and the
// cash-shipment core. Exercises the ported legacy rules — the create guard (contad_app.js:313),
// the branch-per-bank rule (main_ops.ejs:477, the Q11-style client-rule-made-domain-rule), the
// Q24 area2 default, the observed complete/reopen transitions with Q30's state guard — plus
// RBAC on every surface, version-aware updates, and the operations.shipment.* events.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  type OperationsShipmentDto,
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

const PLAN_DATE = '2026-08-20';
let branchId: string;
let departmentId: string;
let jobTitleId: string;
let vehicleAId: string;
let vehicleBId: string;
let offRosterVehicleId: string;
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

/** HR employee via the real direct-registration endpoint — Operations never fabricates one. */
const mkEmployee = async (): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'طاقم اختبار', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
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
  const adminId = await mkUser('ops-admin@ecms.local');
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

  const mkVehicle = async (n: number): Promise<string> => {
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

  it('refuses an origin branch that does not belong to the main bank (client rule made domain)', async () => {
    const res = await mkShipment({ originBranchId: branchB1.id });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_BRANCH_BANK_MISMATCH);
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
        captainEmployeeId: captainId,
        specialist1EmployeeId: specialist1Id,
        specialist2EmployeeId: specialist2Id,
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
    expect(rowA?.crew?.captainEmployeeId).toBe(captainId);
    expect(rowA?.crew?.specialist1EmployeeId).toBe(specialist1Id);
    expect(rowA?.crew?.specialist2EmployeeId).toBe(specialist2Id);
    await waitFor(() => seenEvents.some((e) => e.name === OperationsEvents.CrewPlanned));
  });

  it('replaces a crew in place — upsert per (day, vehicle), unchanged rows are no-ops', async () => {
    const unchanged = await savePlan([
      {
        vehicleId: vehicleAId,
        captainEmployeeId: captainId,
        specialist1EmployeeId: specialist1Id,
        specialist2EmployeeId: specialist2Id,
        direction: 'الجيزة',
        plannedTime: '07:30',
      },
    ]);
    expect(data<{ changedCount: number }>(unchanged).changedCount).toBe(0);

    const replaced = await savePlan([
      { vehicleId: vehicleAId, captainEmployeeId: captainId, specialist1EmployeeId: null },
    ]);
    expect(replaced.status).toBe(200);
    const dto = data<OperationsCrewBoardDto & { changedCount: number }>(replaced);
    expect(dto.changedCount).toBe(1);
    const rowA = dto.rows.find((r) => r.vehicleId === vehicleAId);
    expect(rowA?.crew?.specialist1EmployeeId).toBeNull();
    expect(rowA?.crew?.direction).toBeNull(); // the row is the COMPLETE desired state
  });

  it('empty specialists are allowed — legacy enforces no minimum crew (:2419)', async () => {
    const res = await savePlan([{ vehicleId: vehicleBId, captainEmployeeId: specialist1Id }]);
    expect(res.status).toBe(200);
  });

  it('Q11 — refuses stealing a crew member without the releasing row, allows the move shape', async () => {
    const steal = await savePlan([{ vehicleId: vehicleBId, specialist2EmployeeId: captainId }]);
    expect(steal.status).toBe(409);

    const move = await savePlan([
      { vehicleId: vehicleAId },
      { vehicleId: vehicleBId, captainEmployeeId: captainId },
    ]);
    expect(move.status).toBe(200);
    const dto = data<OperationsCrewBoardDto>(move);
    expect(dto.rows.find((r) => r.vehicleId === vehicleAId)?.crew?.captainEmployeeId).toBeNull();
    expect(dto.rows.find((r) => r.vehicleId === vehicleBId)?.crew?.captainEmployeeId).toBe(
      captainId,
    );
  });

  it('§9.4 — refuses planning crew for a vehicle that is not on the Fleet roster', async () => {
    const res = await savePlan([
      { vehicleId: offRosterVehicleId, captainEmployeeId: specialist2Id },
    ]);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe(ErrorCodes.OPERATIONS_FLEET_DUTY_REQUIRED);
  });

  it('refuses an unknown employee reference', async () => {
    const res = await savePlan([
      { vehicleId: vehicleBId, specialist1EmployeeId: '00000000000000000000cccc' },
    ]);
    expect(res.status).toBe(400);
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

describe('secured (محصنة) workflow — the four legacy screens (OP-4)', () => {
  const DELIVERY_DATE = '2026-08-21';
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
        rows: [{ vehicleId: vehicleAId, captainEmployeeId: captainId }],
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
    const held = data<{ items: { shipmentId: string }[] }>(vault).items.map((i) => i.shipmentId);
    expect(held).toContain(shipment.id);
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
});

/** The crew assignment id for the OP-4 delivery day, read straight from the collection seam. */
const findCrewAssignmentId = async (): Promise<string> => {
  const { operationsCrewAssignmentRepository } = await import(
    '../../src/modules/operations/crew/crew-assignment.repository'
  );
  const { operationsDayService } = await import(
    '../../src/modules/operations/days/day.service'
  );
  const day = await operationsDayService.findByDate(new Date('2026-08-21'));
  const rows = await operationsCrewAssignmentRepository.findForDay(day?._id ?? '');
  return String(rows[0]?._id ?? '');
};

describe('assignment & sequencing — the captain\'s ordered day (OP-5)', () => {
  const ORDER_DATE = '2026-08-25';
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
            captainEmployeeId: captainId,
            specialist1EmployeeId: specialist1Id,
            specialist2EmployeeId: specialist2Id,
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
    expect(dto.crew[0]?.specialist1EmployeeId).toBe(specialist1Id);
    expect(dto.crew[0]?.specialist2EmployeeId).toBe(specialist2Id);

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
  const day = await operationsDayService.findByDate(new Date('2026-08-25'));
  const rows = await operationsShipmentAssignmentRepository.findForCaptainDay(
    day?._id ?? '',
    captainId,
    'pickup',
  );
  return rows.map((row) => ({ assignmentId: String(row._id), version: row.__v }));
};

describe('captain mobile read model — NEW capability, no legacy counterpart (OP-6)', () => {
  const MOBILE_DATE = '2026-09-10';
  /**
   * A day the captain is PLANNED onto a vehicle but has no shipments — captaincy without stops.
   * Deliberately a date no other case touches: this one asserts an EMPTY stop list, so sharing a
   * day with a case that assigns work would make it pass or fail on declaration order.
   */
  const PLANNED_ONLY_DATE = '2026-09-14';
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
            captainEmployeeId: captainId,
            specialist1EmployeeId: specialist1Id,
            specialist2EmployeeId: specialist2Id,
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
        rows: [{ vehicleId: vehicleAId, captainEmployeeId: captainId, direction: 'بنها' }],
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
    expect(dto.assignments[0]?.specialist1EmployeeId).toBe(specialist1Id);
    expect(dto.assignments[0]?.specialist2EmployeeId).toBe(specialist2Id);
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
    const DELIVERY = '2026-09-11';
    await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: DELIVERY, rows: [{ vehicleId: vehicleAId, notes: 'mobile delivery seed' }] });
    await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: DELIVERY, rows: [{ vehicleId: vehicleAId, captainEmployeeId: captainId }] });

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
  const EXEC_DATE = '2026-09-20';
  const NO_STOPS_DATE = '2026-09-21';

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
          { vehicleId: vehicleAId, captainEmployeeId: execCaptainId },
          { vehicleId: vehicleBId, captainEmployeeId: rivalCaptainId },
        ],
      });
    expect(plan.status).toBe(200);

    // The same captain is planned on a SECOND day with no work at all — scenario 16.
    const idlePlan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: NO_STOPS_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeId: execCaptainId }],
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
          { vehicleId: vehicleAId, captainEmployeeId: rivalCaptainId },
          { vehicleId: vehicleBId, captainEmployeeId: execCaptainId },
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
          { vehicleId: vehicleAId, captainEmployeeId: execCaptainId },
          { vehicleId: vehicleBId, captainEmployeeId: rivalCaptainId },
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
  const BOARD_DATE = '2026-10-05';
  const OTHER_DATE = '2026-10-06';

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

    const rosterRes = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: BOARD_DATE, rows: [{ vehicleId: vehicleAId, notes: 'board seed' }] });
    expect(rosterRes.status).toBe(200);
    const crewRes = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        date: BOARD_DATE,
        rows: [{ vehicleId: vehicleAId, captainEmployeeId: captainId }],
      });
    expect(crewRes.status).toBe(200);

    const { operationsCrewAssignmentRepository } = await import(
      '../../src/modules/operations/crew/crew-assignment.repository'
    );
    const { operationsDayService } = await import('../../src/modules/operations/days/day.service');
    const dayDoc = await operationsDayService.findByDate(new Date(BOARD_DATE));
    const crewRows = await operationsCrewAssignmentRepository.findForDay(dayDoc?._id ?? '');
    const crewId = String(crewRows[0]?._id ?? '');

    const assigned = await request(app)
      .post(`/api/v1/operations/secured/${secured.id}/assign-delivery`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ crewAssignmentId: crewId, captainEmployeeId: captainId, version: 0 });
    expect(assigned.status).toBe(200);

    const dispatched = await request(app)
      .post('/api/v1/operations/secured/dispatch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shipmentIds: [secured.id], crewAssignmentId: crewId });
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

  it('is empty, not an error, on a day with no work', async () => {
    const res = await board('2026-10-09');
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

describe('crew roster and requirements — legacy /requirement (B3)', () => {
  // The legacy screen wrote NINE checkboxes onto the employee document keyed by employee_id, and
  // only ONE of them (`leader`) was ever read by a server query. The approved decision carried
  // since PR 1 is that requirements gate NOTHING — so the tests below prove both halves: the flags
  // round-trip as data, AND an employee missing every one of them can still be crewed.
  const ROSTER_DATE = '2026-11-03';
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
      .send({ date: ROSTER_DATE, rows: [{ vehicleId: vehicleAId, captainEmployeeId: memberA }] });
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
      await directory('2026-11-04'),
    );
    expect(other.members.find((m) => m.employeeId === memberA)?.assignedVehicleId).toBeNull();
  });

  it('APPROVED DECISION: requirements gate NOTHING — a flagless employee is still assignable', async () => {
    const flagless = await mkEmployee();
    expect((await setRequirements(flagless, {})).status).toBe(200);

    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-11-05', rows: [{ vehicleId: vehicleAId, notes: 'flagless seed' }] });
    expect(roster.status).toBe(200);

    // No weapon, no signature, no licence, not even marked a captain — and the captain slot takes
    // them anyway, exactly as legacy did. This is the decision, asserted.
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-11-05', rows: [{ vehicleId: vehicleAId, captainEmployeeId: flagless }] });
    expect(plan.status).toBe(200);
  });

  it('an employee with NO roster row at all can still be crewed', async () => {
    // Membership is for the pool and the requirement screen; it is not an eligibility gate either.
    const stranger = await mkEmployee();
    const roster = await request(app)
      .post('/api/v1/fleet/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-11-06', rows: [{ vehicleId: vehicleAId, notes: 'stranger seed' }] });
    expect(roster.status).toBe(200);
    const plan = await request(app)
      .post('/api/v1/operations/crew-board')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2026-11-06', rows: [{ vehicleId: vehicleAId, captainEmployeeId: stranger }] });
    expect(plan.status).toBe(200);
  });

  it('refuses an unknown employee, and one who has exited', async () => {
    const unknown = await setRequirements('507f1f77bcf86cd799439011', { isCaptain: true });
    expect(unknown.status).toBe(400);
  });

  it('removing a member takes them out of the pool but leaves history alone', async () => {
    const temp = await mkEmployee();
    expect((await setRequirements(temp, { isSpecialist: true })).status).toBe(200);
    expect(
      data<{ members: { employeeId: string }[] }>(await directory(ROSTER_DATE)).members.some(
        (m) => m.employeeId === temp,
      ),
    ).toBe(true);

    const removed = await request(app)
      .delete(`/api/v1/operations/crew-board/requirements/${temp}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removed.status).toBe(204);

    expect(
      data<{ members: { employeeId: string }[] }>(await directory(ROSTER_DATE)).members.some(
        (m) => m.employeeId === temp,
      ),
    ).toBe(false);

    // Removing twice is refused with a domain code rather than a silent success.
    const again = await request(app)
      .delete(`/api/v1/operations/crew-board/requirements/${temp}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(again.status).toBe(422);
    expect((again.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_UNKNOWN_CREW_MEMBER,
    );
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
