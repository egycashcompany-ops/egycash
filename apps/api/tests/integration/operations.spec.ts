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
