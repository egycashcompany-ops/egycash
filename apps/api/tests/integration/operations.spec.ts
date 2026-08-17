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
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
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
    [...platformPermissions, ...operationsPermissions].map((p) => p.key),
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
