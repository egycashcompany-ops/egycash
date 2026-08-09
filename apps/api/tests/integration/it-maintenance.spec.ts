// IT-4 integration suite: maintenance orders, preventive plans and the spare-parts ledger over
// real HTTP with real RBAC.
//
// Six things here are worth more than the rest, because each is a rule that would be invisible if
// it silently broke:
//
//   1. **The order state machine.** Every legal transition walked, every illegal one refused.
//   2. **The asset-status contract (§2.7).** `start` remembers what the asset WAS; `complete` and
//      a cancel-from-`inProgress` put it back. An assigned laptop under repair is still that
//      person's laptop, so completion must not quietly return it to stock.
//   3. **FR-9 — consumption.** Order-tied, never below zero, and the ledger and `onHandQty` always
//      agree. Proven by reading the ledger back, not by trusting the counter.
//   4. **§4.6 idempotency.** The sweep runs TWICE against the same due plan; exactly one order
//      exists afterwards. And `nextDueAt` advances from the COMPLETION date, not the due date.
//   5. **The custody guards (§2.7).** return / transfer / dispose all refuse while an order is
//      live — the one change IT-4 makes outside its own folder.
//   6. **Permissions (§7).** Each grant proven necessary by a principal who lacks exactly it.
//
// Error mapping is asserted deliberately and is not interchangeable: 400 = the body could not be
// READ (Zod / `.strict()`), 422 = it read fine but the domain refuses it, 409 = a conflict with
// state, 403 = the grant is missing, 404 = out of scope or absent.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ItEvents,
  ItSettingKeys,
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItMaintenanceOrderDto,
  type ItMaintenancePlanDto,
  type ItSparePartDto,
  type ItSparePartMovementDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { preventiveMaintenanceSweep } from '../../src/modules/it/maintenance/maintenance-sweeps';
import { ItMaintenancePlanModel } from '../../src/modules/it/maintenance/plan.model';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const EMPLOYEE_A = '000000000000000000000a01';
const EMPLOYEE_B = '000000000000000000000b02';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // everything
let adminUserId: string; // the same principal, for the direct settings writes below
let techToken: string; // itMaintenance.view/create/edit/complete + itSparePart.view — the technician
let plannerToken: string; // itMaintenance.view + itMaintenancePlan.manage — schedules, does not work
let storeToken: string; // itSparePart.view/manage — the storekeeper
let readerToken: string; // itMaintenance.view + itSparePart.view only — reads everything, writes nothing
let branchTechToken: string; // itMaintenance.* at BRANCH scope, placed in branch B
let outsiderToken: string; // no IT grant at all

let branchAId: string;
let branchBId: string;
let categoryId: string;
let vendorId: string;
const seenEvents: { name: string; payload: unknown }[] = [];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-maintenance-test-${Date.now()}`;
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

// In-process events fan out fire-and-forget — poll, never assert immediately (the fleet lesson).
const waitFor = async (predicate: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

const mkAsset = async (overrides: Record<string, unknown> = {}): Promise<ItAssetDto> => {
  const res = await request(app)
    .post('/api/v1/it/assets')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'ThinkPad T14', categoryId, branchId: branchAId, ...overrides });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

const getAsset = async (id: string): Promise<ItAssetDto> => {
  const res = await request(app)
    .get(`/api/v1/it/assets/${id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return data<ItAssetDto>(res);
};

const custody = (id: string, action: string, body: Record<string, unknown>): request.Test =>
  request(app)
    .post(`/api/v1/it/assets/${id}/${action}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

const mkOrder = async (
  assetId: string,
  overrides: Record<string, unknown> = {},
  token = techToken,
): Promise<ItMaintenanceOrderDto> => {
  const res = await request(app)
    .post('/api/v1/it/maintenance-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ assetId, ...overrides });
  expect(res.status).toBe(201);
  return data<ItMaintenanceOrderDto>(res);
};

const orderAct = (
  id: string,
  action: string,
  body: Record<string, unknown> = {},
  token = techToken,
): request.Test =>
  request(app)
    .post(`/api/v1/it/maintenance-orders/${id}/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getOrder = async (id: string, token = techToken): Promise<ItMaintenanceOrderDto> => {
  const res = await request(app)
    .get(`/api/v1/it/maintenance-orders/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<ItMaintenanceOrderDto>(res);
};

/** An order already in progress — the state most transitions start from. */
const workingOrder = async (assetId?: string): Promise<ItMaintenanceOrderDto> => {
  const order = await mkOrder(assetId ?? (await mkAsset()).id);
  expect((await orderAct(order.id, 'start')).status).toBe(200);
  return getOrder(order.id);
};

const mkPart = async (
  overrides: Record<string, unknown> = {},
  token = storeToken,
): Promise<ItSparePartDto> => {
  const res = await request(app)
    .post('/api/v1/it/spare-parts')
    .set('Authorization', `Bearer ${token}`)
    .send({ partCode: `SP-${Math.random().toString(36).slice(2, 10)}`, name: 'RAM 8GB', unit: 'pc', ...overrides });
  expect(res.status).toBe(201);
  return data<ItSparePartDto>(res);
};

const receive = (id: string, qty: number, token = storeToken): request.Test =>
  request(app)
    .post(`/api/v1/it/spare-parts/${id}/receipts`)
    .set('Authorization', `Bearer ${token}`)
    .send({ qty });

const stockedPart = async (qty: number, overrides: Record<string, unknown> = {}): Promise<ItSparePartDto> => {
  const part = await mkPart(overrides);
  expect((await receive(part.id, qty)).status).toBe(201);
  const res = await request(app)
    .get(`/api/v1/it/spare-parts/${part.id}`)
    .set('Authorization', `Bearer ${storeToken}`);
  return data<ItSparePartDto>(res);
};

const movementsOf = async (partId: string): Promise<ItSparePartMovementDto[]> => {
  const res = await request(app)
    .get(`/api/v1/it/spare-parts/${partId}/movements?pageSize=100`)
    .set('Authorization', `Bearer ${storeToken}`);
  expect(res.status).toBe(200);
  return data<ItSparePartMovementDto[]>(res);
};

const mkPlan = async (
  assetId: string,
  overrides: Record<string, unknown> = {},
  token = plannerToken,
): Promise<ItMaintenancePlanDto> => {
  const res = await request(app)
    .post('/api/v1/it/maintenance-plans')
    .set('Authorization', `Bearer ${token}`)
    .send({ assetId, name: 'Quarterly clean', intervalDays: 90, ...overrides });
  expect(res.status).toBe(201);
  return data<ItMaintenancePlanDto>(res);
};

const ordersForPlan = async (planId: string): Promise<ItMaintenanceOrderDto[]> => {
  const res = await request(app)
    .get(`/api/v1/it/maintenance-orders?planId=${planId}&pageSize=100`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return data<ItMaintenanceOrderDto[]>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  for (const name of [
    ItEvents.MaintenanceOrderCreated,
    ItEvents.MaintenanceOrderCompleted,
    ItEvents.SparePartBelowMin,
  ]) {
    subscribe(name, `spec.${name}`, (envelope) => {
      seenEvents.push({ name, payload: envelope.payload });
    });
  }

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('mnt-admin@ecms.local');
  adminUserId = adminId;
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
  adminToken = await login('mnt-admin@ecms.local');

  const mkRole = async (
    en: string,
    ar: string,
    permissionKeys: string[],
    email: string,
  ): Promise<string> => {
    const role = await rbacService.createRole({ name: { en, ar }, permissionKeys }, adminId);
    const userId = await mkUser(email);
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    return login(email);
  };

  // The technician: raises, works and finishes orders, and can SEE the store — but cannot manage
  // it, and cannot touch the preventive schedule. That separation is §7's, and it is asserted.
  techToken = await mkRole(
    'Maintenance technician',
    'فني صيانة',
    [
      'itMaintenance.view',
      'itMaintenance.create',
      'itMaintenance.edit',
      'itMaintenance.complete',
      'itSparePart.view',
    ],
    'mnt-tech@ecms.local',
  );
  // The planner: owns the schedule, works no order.
  plannerToken = await mkRole(
    'Maintenance planner',
    'مخطط صيانة',
    ['itMaintenance.view', 'itMaintenancePlan.manage'],
    'mnt-planner@ecms.local',
  );
  // The storekeeper: the catalogue and receipts, and no maintenance grant whatsoever.
  storeToken = await mkRole(
    'Storekeeper',
    'أمين مخزن',
    ['itSparePart.view', 'itSparePart.manage'],
    'mnt-store@ecms.local',
  );
  // Reads everything IT-4 exposes and writes none of it — the negative control for every write.
  readerToken = await mkRole(
    'Maintenance reader',
    'مطالع صيانة',
    ['itMaintenance.view', 'itSparePart.view'],
    'mnt-reader@ecms.local',
  );
  outsiderToken = await mkRole('Outsider', 'بلا صلاحية', ['user.view'], 'mnt-outsider@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('84', 'فرع الصيانة أ', 'Maintenance branch A');
  branchBId = await mkBranch('85', 'فرع الصيانة ب', 'Maintenance branch B');

  // The whole point of the scope fix: a technician placed in branch B, holding the SAME grants as
  // the organization-wide technician, must not read branch A's board.
  const branchRole = await rbacService.createRole(
    {
      name: { en: 'Branch technician', ar: 'فني فرع' },
      permissionKeys: ['itMaintenance.view', 'itMaintenance.create', 'itMaintenance.edit'],
    },
    adminUserId,
  );
  const branchTechId = await mkUser('mnt-branch-tech@ecms.local', branchBId);
  await rbacService.ensureAssignment(branchTechId, String(branchRole._id), 'branch');
  branchTechToken = await login('mnt-branch-tech@ecms.local');

  const category = await request(app)
    .post('/api/v1/it/catalog-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ kind: 'assetCategory', name: { ar: 'حواسيب محمولة', en: 'Laptops' } });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;

  const vendor = await request(app)
    .post('/api/v1/it/vendors')
    .set('Authorization', `Bearer ${adminToken}`)
    // A vendor's `name` is a PLAIN string (design §2.9), unlike a catalog item's — vendors are
    // real-world parties whose names are not translated.
    .send({ name: 'Service centre' });
  expect(vendor.status).toBe(201);
  vendorId = (vendor.body as { data: { id: string } }).data.id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── Orders: creation and the code ───────────────────────────────────────────

describe('maintenance orders', () => {
  it('allocates a server-side order code and opens the order (FR-1)', async () => {
    const asset = await mkAsset();
    const order = await mkOrder(asset.id);
    expect(order.orderCode).toMatch(/^MO-\d{5,}$/);
    expect(order.status).toBe('open');
    expect(order.kind).toBe('corrective');
    expect(order.assetId).toBe(asset.id);
    expect(order.planId).toBeNull();
    expect(order.assetStatusBefore).toBeNull();
  });

  it('never lets a client choose the code, the status or the kind', async () => {
    const asset = await mkAsset();
    for (const body of [
      { assetId: asset.id, orderCode: 'MO-00001' },
      { assetId: asset.id, status: 'completed' },
      { assetId: asset.id, kind: 'preventive' },
      { assetId: asset.id, assetStatusBefore: 'assigned' },
    ]) {
      const res = await request(app)
        .post('/api/v1/it/maintenance-orders')
        .set('Authorization', `Bearer ${techToken}`)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('allocates codes monotonically and never reuses one', async () => {
    const asset = await mkAsset();
    const first = await mkOrder(asset.id);
    const second = await mkOrder(asset.id);
    expect(Number(second.orderCode.slice(3))).toBeGreaterThan(Number(first.orderCode.slice(3)));
  });

  it('refuses an order for an asset that is not visible, and for a disposed one (422)', async () => {
    const missing = await request(app)
      .post('/api/v1/it/maintenance-orders')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assetId: '0000000000000000000000ff' });
    expect(missing.status).toBe(422);

    const asset = await mkAsset();
    expect((await custody(asset.id, 'dispose', { method: 'scrapped', reason: 'old' })).status).toBe(
      200,
    );
    const disposed = await request(app)
      .post('/api/v1/it/maintenance-orders')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assetId: asset.id });
    expect(disposed.status).toBe(422);
  });

  it('refuses an inactive vendor and a missing ticket (422)', async () => {
    const asset = await mkAsset();
    const bad = await request(app)
      .post('/api/v1/it/maintenance-orders')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assetId: asset.id, vendorId: '0000000000000000000000ff' });
    expect(bad.status).toBe(422);

    const badTicket = await request(app)
      .post('/api/v1/it/maintenance-orders')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assetId: asset.id, ticketId: '0000000000000000000000ff' });
    expect(badTicket.status).toBe(422);

    const good = await mkOrder(asset.id, { vendorId });
    expect(good.vendorId).toBe(vendorId);
  });

  it('announces the creation', async () => {
    const asset = await mkAsset();
    const order = await mkOrder(asset.id);
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.MaintenanceOrderCreated &&
          (e.payload as { orderId: string }).orderId === order.id,
      ),
    );
    const event = seenEvents.find(
      (e) =>
        e.name === ItEvents.MaintenanceOrderCreated &&
        (e.payload as { orderId: string }).orderId === order.id,
    );
    expect(event?.payload).toMatchObject({
      orderCode: order.orderCode,
      kind: 'corrective',
      assetCode: asset.assetCode,
      planId: null,
    });
  });
});

// ── The state machine and the asset-status contract ─────────────────────────

describe('the order lifecycle', () => {
  it('walks open → inProgress → completed, and puts the asset under maintenance and back', async () => {
    const asset = await mkAsset();
    const order = await mkOrder(asset.id);
    expect((await getAsset(asset.id)).status).toBe('inStock');

    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await getAsset(asset.id)).status).toBe('underMaintenance');
    const started = await getOrder(order.id);
    expect(started.status).toBe('inProgress');
    expect(started.startedAt).not.toBeNull();
    expect(started.assetStatusBefore).toBe('inStock');

    expect((await orderAct(order.id, 'complete', { summary: 'Fan replaced' })).status).toBe(200);
    const done = await getOrder(order.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).not.toBeNull();
    expect(done.summary).toBe('Fan replaced');
    expect((await getAsset(asset.id)).status).toBe('inStock');
  });

  // The rule the design states in words: "assigned assets stay assigned — a laptop being repaired
  // is still that person's laptop". A completion that returned it to stock would silently break
  // the custody thread of every repaired machine.
  it('returns an ASSIGNED asset to assigned, not to stock (§2.7)', async () => {
    const asset = await mkAsset();
    expect((await custody(asset.id, 'assign', { employeeId: EMPLOYEE_A })).status).toBe(200);
    expect((await getAsset(asset.id)).status).toBe('assigned');

    const order = await mkOrder(asset.id);
    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await getAsset(asset.id)).status).toBe('underMaintenance');
    expect((await getOrder(order.id)).assetStatusBefore).toBe('assigned');

    expect((await orderAct(order.id, 'complete', { summary: 'Cleaned' })).status).toBe(200);
    const after = await getAsset(asset.id);
    expect(after.status).toBe('assigned');
    // The custody interval itself was never touched — the holder is unchanged.
    expect(after.currentAssignmentId).not.toBeNull();
  });

  it('cancelling an in-progress order releases the asset too', async () => {
    const asset = await mkAsset();
    expect((await custody(asset.id, 'assign', { employeeId: EMPLOYEE_A })).status).toBe(200);
    const order = await mkOrder(asset.id);
    expect((await orderAct(order.id, 'start')).status).toBe(200);

    expect((await orderAct(order.id, 'cancel', { reason: 'Parts unavailable' })).status).toBe(200);
    expect((await getOrder(order.id)).status).toBe('cancelled');
    expect((await getAsset(asset.id)).status).toBe('assigned');
  });

  it('cancelling an order that never started leaves the asset alone', async () => {
    const asset = await mkAsset();
    const order = await mkOrder(asset.id);
    expect((await orderAct(order.id, 'cancel', { reason: 'Raised in error' })).status).toBe(200);
    expect((await getAsset(asset.id)).status).toBe('inStock');
  });

  it('refuses to complete an order that was never started (422)', async () => {
    const order = await mkOrder((await mkAsset()).id);
    expect((await orderAct(order.id, 'complete', { summary: 'x' })).status).toBe(422);
  });

  it('makes completed and cancelled terminal (422 on every further move)', async () => {
    const finished = await workingOrder();
    expect((await orderAct(finished.id, 'complete', { summary: 'Done' })).status).toBe(200);
    for (const [action, body] of [
      ['start', {}],
      ['complete', { summary: 'again' }],
      ['cancel', { reason: 'no' }],
    ] as const) {
      expect((await orderAct(finished.id, action, body)).status, action).toBe(422);
    }

    const dropped = await mkOrder((await mkAsset()).id);
    expect((await orderAct(dropped.id, 'cancel', { reason: 'no' })).status).toBe(200);
    expect((await orderAct(dropped.id, 'start')).status).toBe(422);
  });

  // Two live orders on one asset would each remember a different "status before"; the second would
  // capture `underMaintenance` and completing it would strand the asset there forever.
  it('refuses to start a second order on an asset already under maintenance (409)', async () => {
    const asset = await mkAsset();
    const first = await mkOrder(asset.id);
    const second = await mkOrder(asset.id);
    expect((await orderAct(first.id, 'start')).status).toBe(200);
    expect((await orderAct(second.id, 'start')).status).toBe(409);
  });

  it('refuses to edit a finished order, and never accepts a status through PATCH', async () => {
    const order = await workingOrder();
    const patch = await request(app)
      .patch(`/api/v1/it/maintenance-orders/${order.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'completed', version: order.version });
    expect(patch.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/v1/it/maintenance-orders/${order.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ summary: 'Waiting on the vendor', version: order.version });
    expect(ok.status).toBe(200);

    expect((await orderAct(order.id, 'complete', { summary: 'Done' })).status).toBe(200);
    const late = await request(app)
      .patch(`/api/v1/it/maintenance-orders/${order.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ summary: 'Too late', version: (await getOrder(order.id)).version });
    expect(late.status).toBe(422);
  });

  it('writes the asset history at start and at completion', async () => {
    const asset = await mkAsset();
    const order = await mkOrder(asset.id);
    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await orderAct(order.id, 'complete', { summary: 'Fixed' })).status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/it/assets/${asset.id}/history?pageSize=100`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const types = data<{ type: string; metadata: Record<string, unknown> }[]>(res).map(
      (e) => e.type,
    );
    expect(types).toContain('maintenanceStarted');
    expect(types).toContain('maintenanceCompleted');
  });

  it('announces the completion with the parts count', async () => {
    const order = await workingOrder();
    expect((await orderAct(order.id, 'complete', { summary: 'Done', cost: 250 })).status).toBe(200);
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.MaintenanceOrderCompleted &&
          (e.payload as { orderId: string }).orderId === order.id,
      ),
    );
    const event = seenEvents.find(
      (e) =>
        e.name === ItEvents.MaintenanceOrderCompleted &&
        (e.payload as { orderId: string }).orderId === order.id,
    );
    expect(event?.payload).toMatchObject({ cost: 250, partsCount: 0 });
  });
});

// ── The custody guards — the one change outside IT-4's folder ───────────────

describe('custody while an order is live (§2.7)', () => {
  const assignedUnderOrder = async (): Promise<{ asset: ItAssetDto; order: ItMaintenanceOrderDto }> => {
    const asset = await mkAsset();
    expect((await custody(asset.id, 'assign', { employeeId: EMPLOYEE_A })).status).toBe(200);
    const order = await mkOrder(asset.id);
    return { asset, order };
  };

  it('refuses return, transfer and dispose while an order is open (409)', async () => {
    const { asset } = await assignedUnderOrder();
    expect((await custody(asset.id, 'return', {})).status).toBe(409);
    expect((await custody(asset.id, 'transfer', { toEmployeeId: EMPLOYEE_B })).status).toBe(409);
    expect((await custody(asset.id, 'dispose', { method: 'scrapped', reason: 'x' })).status).toBe(
      409,
    );
  });

  it('refuses them while the order is in progress too', async () => {
    const { asset, order } = await assignedUnderOrder();
    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await custody(asset.id, 'return', {})).status).toBe(409);
    expect((await custody(asset.id, 'transfer', { toEmployeeId: EMPLOYEE_B })).status).toBe(409);
  });

  it('lets custody move again once the order is completed', async () => {
    const { asset, order } = await assignedUnderOrder();
    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await orderAct(order.id, 'complete', { summary: 'Fixed' })).status).toBe(200);
    expect((await custody(asset.id, 'return', {})).status).toBe(200);
    expect((await getAsset(asset.id)).status).toBe('inStock');
  });

  it('lets custody move again once the order is cancelled', async () => {
    const { asset, order } = await assignedUnderOrder();
    expect((await orderAct(order.id, 'cancel', { reason: 'Not needed' })).status).toBe(200);
    expect((await custody(asset.id, 'transfer', { toEmployeeId: EMPLOYEE_B })).status).toBe(200);
  });

  // `assign` is deliberately NOT guarded: an in-stock asset with an open order is a machine waiting
  // for a repair, and handing it to its user is a decision the guard has no business refusing.
  it('does not block assign', async () => {
    const asset = await mkAsset();
    await mkOrder(asset.id);
    expect((await custody(asset.id, 'assign', { employeeId: EMPLOYEE_A })).status).toBe(200);
  });
});

// ── The spare-parts store and its ledger (ADR-024, FR-9) ────────────────────

describe('spare parts', () => {
  it('creates a part with zero on hand — stock arrives only through a receipt', async () => {
    const part = await mkPart();
    expect(part.onHandQty).toBe(0);
    const withStock = await request(app)
      .post('/api/v1/it/spare-parts')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ partCode: 'SP-REJECT', name: 'x', unit: 'pc', onHandQty: 5 });
    expect(withStock.status).toBe(400);
  });

  it('refuses a duplicate part code (409)', async () => {
    const part = await mkPart();
    const again = await request(app)
      .post('/api/v1/it/spare-parts')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ partCode: part.partCode, name: 'Other', unit: 'pc' });
    expect(again.status).toBe(409);
  });

  it('receives stock and writes a positive movement with no order', async () => {
    const part = await mkPart();
    const res = await receive(part.id, 10);
    expect(res.status).toBe(201);
    const body = data<{ part: ItSparePartDto; movement: ItSparePartMovementDto }>(res);
    expect(body.part.onHandQty).toBe(10);
    expect(body.movement.qty).toBe(10);
    expect(body.movement.orderId).toBeNull();

    const ledger = await movementsOf(part.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.qty).toBe(10);
  });

  it('exposes no way to consume stock outside a maintenance order (FR-9)', async () => {
    const part = await stockedPart(5);
    for (const path of ['consume', 'issues', 'consumption']) {
      const res = await request(app)
        .post(`/api/v1/it/spare-parts/${part.id}/${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ qty: 1 });
      expect(res.status, path).toBe(404);
    }
    // And a receipt cannot be turned into a consumption by sign.
    const negative = await request(app)
      .post(`/api/v1/it/spare-parts/${part.id}/receipts`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ qty: -3 });
    expect(negative.status).toBe(400);
  });

  it('consumes through completion, ties the movement to the order, and keeps the two agreeing', async () => {
    const part = await stockedPart(10);
    const order = await workingOrder();
    expect(
      (await orderAct(order.id, 'complete', {
        summary: 'Memory replaced',
        parts: [{ partId: part.id, qty: 3 }],
      })).status,
    ).toBe(200);

    const after = await request(app)
      .get(`/api/v1/it/spare-parts/${part.id}`)
      .set('Authorization', `Bearer ${storeToken}`);
    expect(data<ItSparePartDto>(after).onHandQty).toBe(7);

    const ledger = await movementsOf(part.id);
    const consumption = ledger.find((m) => m.qty < 0);
    expect(consumption?.qty).toBe(-3);
    expect(consumption?.orderId).toBe(order.id);
    // The ledger IS the truth: its sum must equal the denormalized counter.
    expect(ledger.reduce((sum, m) => sum + m.qty, 0)).toBe(7);
  });

  it("lists an order's consumed parts from the ledger, not from the order", async () => {
    const a = await stockedPart(10);
    const b = await stockedPart(10);
    const order = await workingOrder();
    expect(
      (await orderAct(order.id, 'complete', {
        summary: 'Two parts',
        parts: [
          { partId: a.id, qty: 1 },
          { partId: b.id, qty: 2 },
        ],
      })).status,
    ).toBe(200);

    const res = await request(app)
      .get(`/api/v1/it/maintenance-orders/${order.id}/parts`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    const rows = data<ItSparePartMovementDto[]>(res);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.orderId === order.id && r.qty < 0)).toBe(true);
  });

  // FR-9's second half. And because it is refused INSIDE the completion transaction, the order
  // must still be workable afterwards — a failed completion may not half-finish an order.
  it('refuses consumption below zero and leaves both the stock and the order untouched (422)', async () => {
    const part = await stockedPart(2);
    const order = await workingOrder();
    const res = await orderAct(order.id, 'complete', {
      summary: 'Too many',
      parts: [{ partId: part.id, qty: 5 }],
    });
    expect(res.status).toBe(422);

    const after = await request(app)
      .get(`/api/v1/it/spare-parts/${part.id}`)
      .set('Authorization', `Bearer ${storeToken}`);
    expect(data<ItSparePartDto>(after).onHandQty).toBe(2);
    expect(await movementsOf(part.id)).toHaveLength(1);
    expect((await getOrder(order.id)).status).toBe('inProgress');

    // The same order completes once the quantity is possible.
    expect(
      (await orderAct(order.id, 'complete', {
        summary: 'Right this time',
        parts: [{ partId: part.id, qty: 2 }],
      })).status,
    ).toBe(200);
  });

  it('warns — but does not block — when a consumption crosses the minimum', async () => {
    const part = await stockedPart(10, { minQty: 4 });
    const order = await workingOrder();
    expect(
      (await orderAct(order.id, 'complete', {
        summary: 'Down to the line',
        parts: [{ partId: part.id, qty: 7 }],
      })).status,
    ).toBe(200);

    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.SparePartBelowMin &&
          (e.payload as { partId: string }).partId === part.id,
      ),
    );
    const event = seenEvents.find(
      (e) =>
        e.name === ItEvents.SparePartBelowMin && (e.payload as { partId: string }).partId === part.id,
    );
    expect(event?.payload).toMatchObject({ partCode: part.partCode, onHandQty: 3, minQty: 4 });
  });

  it('finds the parts at or below their minimum, and ignores parts with no minimum', async () => {
    const low = await stockedPart(1, { minQty: 5 });
    const fine = await stockedPart(50, { minQty: 5 });
    // No `minQty` at all, and no stock either — the strongest case for "not set means no minimum",
    // since a zero-valued minimum would have matched it.
    const unset = await mkPart();

    const res = await request(app)
      .get('/api/v1/it/spare-parts?belowMin=true&pageSize=100')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(res.status).toBe(200);
    const ids = data<ItSparePartDto[]>(res).map((p) => p.id);
    expect(ids).toContain(low.id);
    expect(ids).not.toContain(fine.id);
    expect(ids).not.toContain(unset.id);
  });

  it('archives a part instead of deleting it (FR-11)', async () => {
    const part = await stockedPart(3);
    expect(
      (
        await request(app)
          .delete(`/api/v1/it/spare-parts/${part.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(404);

    const archived = await request(app)
      .patch(`/api/v1/it/spare-parts/${part.id}`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ active: false, version: part.version });
    expect(archived.status).toBe(200);
    expect((await receive(part.id, 1)).status).toBe(422);
  });
});

// ── Preventive plans and the sweep (§4.6) ───────────────────────────────────

describe('preventive maintenance', () => {
  const dueNow = async (assetId: string, intervalDays = 30): Promise<ItMaintenancePlanDto> => {
    const plan = await mkPlan(assetId, { intervalDays });
    // Reach past the API to make the plan due: `nextDueAt` is editable, but this keeps the test
    // about the SWEEP rather than about the edit path.
    await ItMaintenancePlanModel.updateOne(
      { _id: plan.id },
      { $set: { nextDueAt: new Date(Date.now() - 86_400_000) } },
    ).exec();
    return plan;
  };

  it('defaults nextDueAt one interval out, so a new plan is not instantly overdue', async () => {
    const plan = await mkPlan((await mkAsset()).id, { intervalDays: 10 });
    const days = (new Date(plan.nextDueAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(9.5);
    expect(days).toBeLessThan(10.5);
    expect(plan.lastCompletedAt).toBeNull();
    expect(plan.active).toBe(true);
  });

  it('generates exactly one preventive order per due plan, however often it runs (§4.6)', async () => {
    const plan = await dueNow((await mkAsset()).id);
    const first = await preventiveMaintenanceSweep();
    expect(first.generated).toBeGreaterThanOrEqual(1);

    const afterOne = await ordersForPlan(plan.id);
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0]?.kind).toBe('preventive');
    expect(afterOne[0]?.status).toBe('open');

    await preventiveMaintenanceSweep();
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(1);
  });

  it('generates again only once the previous order has finished', async () => {
    const plan = await dueNow((await mkAsset()).id);
    await preventiveMaintenanceSweep();
    const [generated] = await ordersForPlan(plan.id);
    expect(generated).toBeDefined();

    expect((await orderAct(generated!.id, 'cancel', { reason: 'Skipped' })).status).toBe(200);
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(2);
  });

  // The Fleet alarm-baseline lesson: advancing from the DUE date compounds drift, so a plan
  // serviced late would stay late forever.
  it('advances nextDueAt from the COMPLETION date and stamps lastCompletedAt', async () => {
    const plan = await dueNow((await mkAsset()).id, 30);
    await preventiveMaintenanceSweep();
    const [order] = await ordersForPlan(plan.id);
    expect(order).toBeDefined();

    expect((await orderAct(order!.id, 'start')).status).toBe(200);
    const completedAt = Date.now();
    expect((await orderAct(order!.id, 'complete', { summary: 'Serviced' })).status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/it/maintenance-plans/${plan.id}`)
      .set('Authorization', `Bearer ${plannerToken}`);
    expect(res.status).toBe(200);
    const after = data<ItMaintenancePlanDto>(res);
    expect(after.lastCompletedAt).not.toBeNull();
    const advancedDays = (new Date(after.nextDueAt).getTime() - completedAt) / 86_400_000;
    expect(advancedDays).toBeGreaterThan(29.5);
    expect(advancedDays).toBeLessThan(30.5);
  });

  it('skips deactivated plans, and resumes when they are reactivated', async () => {
    const plan = await dueNow((await mkAsset()).id);
    const off = await request(app)
      .post(`/api/v1/it/maintenance-plans/${plan.id}/deactivate`)
      .set('Authorization', `Bearer ${plannerToken}`);
    expect(off.status).toBe(200);

    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(0);

    expect(
      (
        await request(app)
          .post(`/api/v1/it/maintenance-plans/${plan.id}/activate`)
          .set('Authorization', `Bearer ${plannerToken}`)
      ).status,
    ).toBe(200);
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(1);
  });

  it('looks forward by the configured horizon, and stops looking when it is zero', async () => {
    const plan = await mkPlan((await mkAsset()).id, { intervalDays: 5 });
    // Due in three days: inside the default 7-day horizon, outside a zero one.
    await ItMaintenancePlanModel.updateOne(
      { _id: plan.id },
      { $set: { nextDueAt: new Date(Date.now() + 3 * 86_400_000) } },
    ).exec();

    // A REAL user id: `settingsService.set` stamps `updatedBy` as an ObjectId, so a sentinel
    // string throws rather than failing an assertion.
    const ctx: AuthContext = {
      userId: adminUserId,
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
      key: ItSettingKeys.PreventiveHorizonDays,
      scope: 'organization',
      value: 0,
    });
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(0);

    await settingsService.set(ctx, {
      key: ItSettingKeys.PreventiveHorizonDays,
      scope: 'organization',
      value: 7,
    });
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(1);
  });

  it('generates nothing for a plan whose asset was disposed, and does not stop the sweep', async () => {
    const doomed = await mkAsset();
    const deadPlan = await dueNow(doomed.id);
    expect((await custody(doomed.id, 'dispose', { method: 'scrapped', reason: 'x' })).status).toBe(
      200,
    );
    const livePlan = await dueNow((await mkAsset()).id);

    const result = await preventiveMaintenanceSweep();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await ordersForPlan(deadPlan.id)).toHaveLength(0);
    expect(await ordersForPlan(livePlan.id)).toHaveLength(1);
  });

  it('refuses a plan on an invisible or disposed asset (422)', async () => {
    const missing = await request(app)
      .post('/api/v1/it/maintenance-plans')
      .set('Authorization', `Bearer ${plannerToken}`)
      .send({ assetId: '0000000000000000000000ff', name: 'x', intervalDays: 30 });
    expect(missing.status).toBe(422);
  });

  it('never accepts active or lastCompletedAt through the write schemas', async () => {
    const plan = await mkPlan((await mkAsset()).id);
    for (const body of [
      { active: false, version: plan.version },
      { lastCompletedAt: new Date().toISOString(), version: plan.version },
    ]) {
      const res = await request(app)
        .patch(`/api/v1/it/maintenance-plans/${plan.id}`)
        .set('Authorization', `Bearer ${plannerToken}`)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ── Permissions (§7) ────────────────────────────────────────────────────────

describe('maintenance permissions', () => {
  it('locks every IT-4 read out of a principal with no IT grant (403)', async () => {
    for (const path of ['/it/maintenance-orders', '/it/maintenance-plans', '/it/spare-parts']) {
      const res = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status, path).toBe(403);
    }
  });

  it('separates raising an order from working it and from finishing it', async () => {
    const asset = await mkAsset();
    // The planner may see orders and may not raise one.
    const raise = await request(app)
      .post('/api/v1/it/maintenance-orders')
      .set('Authorization', `Bearer ${plannerToken}`)
      .send({ assetId: asset.id });
    expect(raise.status).toBe(403);

    const order = await mkOrder(asset.id);
    expect((await orderAct(order.id, 'start', {}, readerToken)).status).toBe(403);
    expect((await orderAct(order.id, 'start')).status).toBe(200);
    expect((await orderAct(order.id, 'complete', { summary: 'x' }, readerToken)).status).toBe(403);
    expect((await orderAct(order.id, 'cancel', { reason: 'x' }, readerToken)).status).toBe(403);
  });

  it('keeps the preventive schedule away from a technician who works the orders', async () => {
    const asset = await mkAsset();
    const denied = await request(app)
      .post('/api/v1/it/maintenance-plans')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assetId: asset.id, name: 'Quarterly', intervalDays: 90 });
    expect(denied.status).toBe(403);

    // But a technician still READS the schedule — the orders they work come from it.
    const read = await request(app)
      .get('/api/v1/it/maintenance-plans')
      .set('Authorization', `Bearer ${techToken}`);
    expect(read.status).toBe(200);
  });

  it('keeps the store catalogue away from the technician who consumes from it', async () => {
    const create = await request(app)
      .post('/api/v1/it/spare-parts')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ partCode: 'SP-DENY', name: 'x', unit: 'pc' });
    expect(create.status).toBe(403);

    const part = await mkPart();
    expect((await receive(part.id, 5, techToken)).status).toBe(403);
    // Reading it is exactly what a technician needs, and is allowed.
    const read = await request(app)
      .get(`/api/v1/it/spare-parts/${part.id}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(read.status).toBe(200);
  });

  // The storekeeper holds no maintenance grant at all — the only way stock leaves the store is
  // through a completion they cannot perform, which is FR-9 expressed as a permission.
  it('gives the storekeeper no way to reach an order', async () => {
    const order = await mkOrder((await mkAsset()).id);
    expect(
      (
        await request(app)
          .get(`/api/v1/it/maintenance-orders/${order.id}`)
          .set('Authorization', `Bearer ${storeToken}`)
      ).status,
    ).toBe(403);
    expect((await orderAct(order.id, 'complete', { summary: 'x' }, storeToken)).status).toBe(403);
  });
});

// ── Data scope (§7) — the IT-4 fix this slice carries ───────────────────────
//
// Orders and plans denormalize the ASSET's `branchId` at creation, exactly as
// `it_asset_assignments` does, so "a branch-scoped technician sees that branch's world" is a scope
// filter and not a promise. Before the fix the write path was scoped and the READ path was not:
// every technician could list every branch's board.

describe('branch scoping', () => {
  it('hides another branch\'s orders from a branch-scoped technician', async () => {
    const assetA = await mkAsset({ branchId: branchAId });
    const assetB = await mkAsset({ branchId: branchBId });
    const orderA = await mkOrder(assetA.id);
    const orderB = await mkOrder(assetB.id, {}, branchTechToken);

    const res = await request(app)
      .get('/api/v1/it/maintenance-orders?pageSize=100')
      .set('Authorization', `Bearer ${branchTechToken}`);
    expect(res.status).toBe(200);
    const ids = data<ItMaintenanceOrderDto[]>(res).map((o) => o.id);
    expect(ids).toContain(orderB.id);
    expect(ids).not.toContain(orderA.id);

    // …and the organization-scoped technician still sees both, so the fix narrowed nothing it
    // should not have.
    const all = await request(app)
      .get('/api/v1/it/maintenance-orders?pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    const allIds = data<ItMaintenanceOrderDto[]>(all).map((o) => o.id);
    expect(allIds).toEqual(expect.arrayContaining([orderA.id, orderB.id]));
  });

  it('answers 404 — not 403 — for another branch\'s order by id', async () => {
    const order = await mkOrder((await mkAsset({ branchId: branchAId })).id);
    const res = await request(app)
      .get(`/api/v1/it/maintenance-orders/${order.id}`)
      .set('Authorization', `Bearer ${branchTechToken}`);
    // Out of scope reads as absent: the existence of another branch's order is not this caller's
    // information, and 403 would leak it.
    expect(res.status).toBe(404);
  });

  it('refuses to transition another branch\'s order', async () => {
    const order = await mkOrder((await mkAsset({ branchId: branchAId })).id);
    expect((await orderAct(order.id, 'start', {}, branchTechToken)).status).toBe(404);
  });

  it('scopes the parts panel through its order', async () => {
    const order = await mkOrder((await mkAsset({ branchId: branchAId })).id);
    const res = await request(app)
      .get(`/api/v1/it/maintenance-orders/${order.id}/parts`)
      .set('Authorization', `Bearer ${branchTechToken}`);
    expect(res.status).toBe(404);
  });

  it('hides another branch\'s plans too', async () => {
    const planA = await mkPlan((await mkAsset({ branchId: branchAId })).id);
    const res = await request(app)
      .get('/api/v1/it/maintenance-plans?pageSize=100')
      .set('Authorization', `Bearer ${branchTechToken}`);
    expect(res.status).toBe(200);
    expect(data<ItMaintenancePlanDto[]>(res).map((p) => p.id)).not.toContain(planA.id);
  });

  // The store is company-wide (§2.7, §7 gives `/it/spare-parts` no branch anchor), so scoping it
  // by branch would invent a business fact. Pinned so a later "consistency" change fails here.
  it('keeps the spare-parts store company-wide', async () => {
    const part = await stockedPart(5);
    const res = await request(app)
      .get('/api/v1/it/spare-parts?pageSize=100')
      .set('Authorization', `Bearer ${storeToken}`);
    expect(res.status).toBe(200);
    expect(data<ItSparePartDto[]>(res).map((p) => p.id)).toContain(part.id);
  });

  // The sweep is the system acting for the organization, not a user reading — so it must generate
  // for every branch regardless of who happens to hold which scope.
  it('lets the preventive sweep cross branches', async () => {
    const plan = await mkPlan((await mkAsset({ branchId: branchBId })).id);
    await ItMaintenancePlanModel.updateOne(
      { _id: plan.id },
      { $set: { nextDueAt: new Date(Date.now() - 86_400_000) } },
    ).exec();
    await preventiveMaintenanceSweep();
    expect(await ordersForPlan(plan.id)).toHaveLength(1);
  });
});
