// «تعديل الجهاز» over real HTTP with real RBAC — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد
// التسليم», and the memo «تتحدّث بالجهاز الجديد» (owner, 2026-11-17): a reprint shows the new device,
// the change is recorded (who, when, from which device to which), and the signed copy already filed
// stays as it is.
//
// What a mocked spec cannot see: the ledger row and its memo line changed by ONE transaction and
// read back as the screens read them — the ledger, the memo, the asset page's card on both devices
// — the version that refuses a change made on a stale read, the two audit rows, a signed copy left
// alone, and the grants as the router and the scopes apply them: the issue's own (`assign`, scoped
// by the store's read grant), a device only within the caller's own `itAsset.view`, and clearing
// with none.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItConsumableDto,
  type ItConsumableIssueResultDto,
  type ItConsumableMemoDto,
  type ItConsumableMovementDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // itConsumable.view at BRANCH scope, placed in branch A — nothing else
// itConsumable.view + .assign, and itAsset.view, at BRANCH scope, placed in branch A
let keeperAToken: string;
// itConsumable.view + .assign at BRANCH scope, placed in branch A — and NO asset grant
let storeOnlyKeeperToken: string;
let branchAId: string;
let branchBId: string;
let typeId: string;
let categoryId: string;

const EMPLOYEE = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-consumables-installed-on-test-${Date.now()}`;
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

const plantEmployee = async (_id: Types.ObjectId, code: string, fullNameAr: string) => {
  const branch = new Types.ObjectId(branchAId);
  const department = new Types.ObjectId();
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status: 'active',
    personal: { fullNameAr, nationalId: '28001010101010' },
    employment: {
      jobTitleId: new Types.ObjectId(),
      departmentId: department,
      sectionId: null,
      branchId: branch,
    },
    branchId: branch,
    departmentId: department,
    sectionId: null,
    userId: null,
    exit: null,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

let names = 0;
const nextName = (): string => {
  names += 1;
  return `حبر طابعة ${String(names)}`;
};

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body: Record<string, unknown>, token = adminToken) =>
    request(app).patch(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  delete: (path: string, token = adminToken) =>
    request(app).delete(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
};

const stock = async (overrides: Record<string, unknown> = {}): Promise<ItConsumableDto> => {
  const res = await api.post('/consumables', {
    name: nextName(),
    typeId,
    unit: 'قطعة',
    branchId: branchAId,
    openingQty: 10,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return data<ItConsumableDto>(res);
};

const device = async (name: string, branchId = branchAId): Promise<ItAssetDto> => {
  const res = await api.post('/assets', { name, categoryId, branchId });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

/** One item issued to the employee, on `assetId` when given: the memo and its one movement. */
const issueOne = async (
  item: ItConsumableDto,
  assetId?: string,
): Promise<{ memo: ItConsumableMemoDto; movement: ItConsumableMovementDto }> => {
  const res = await api.post('/consumables/issue', {
    employeeId: String(EMPLOYEE),
    lines: [{ consumableId: item.id, qty: 1, ...(assetId === undefined ? {} : { assetId }) }],
  });
  expect(res.status).toBe(201);
  const { memo } = data<ItConsumableIssueResultDto>(res);
  const [movement] = data<ItConsumableMovementDto[]>(
    await api.get(`/consumables/${item.id}/movements?kind=issued`),
  );
  expect(movement?.memoId).toBe(memo.id);
  return { memo, movement: movement as ItConsumableMovementDto };
};

const setDevice = (
  movement: Pick<ItConsumableMovementDto, 'id' | 'version'>,
  assetId: string | null,
  token = adminToken,
  version = movement.version,
) => api.patch(`/consumable-movements/${movement.id}/installed-on`, { assetId, version }, token);

const cardOf = async (assetId: string): Promise<ItConsumableMovementDto[]> =>
  data<ItConsumableMovementDto[]>(
    await api.get(`/consumable-movements?assetId=${assetId}&pageSize=100`),
  );

const rowOf = async (movement: ItConsumableMovementDto): Promise<ItConsumableMovementDto> => {
  const rows = data<ItConsumableMovementDto[]>(
    await api.get(`/consumables/${movement.consumableId}/movements?pageSize=100`),
  );
  const row = rows.find((entry) => entry.id === movement.id);
  expect(row).toBeDefined();
  return row as ItConsumableMovementDto;
};

const memoOf = async (id: string): Promise<ItConsumableMemoDto> =>
  data<ItConsumableMemoDto>(await api.get(`/consumable-memos/${id}`));

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('installed-on-admin@ecms.local');
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
  adminToken = await login('installed-on-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('92', 'فرع ج', 'Branch C');
  branchBId = await mkBranch('93', 'فرع د', 'Branch D');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Store viewer', ar: 'مطالع مخزن' }, permissionKeys: ['itConsumable.view'] },
    adminId,
  );
  const viewerId = await mkUser('installed-on-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  viewerToken = await login('installed-on-viewer@ecms.local');

  const keeperRole = await rbacService.createRole(
    {
      name: { en: 'Store keeper', ar: 'أمين مخزن' },
      permissionKeys: ['itConsumable.view', 'itConsumable.assign', 'itAsset.view'],
    },
    adminId,
  );
  const keeperId = await mkUser('installed-on-keeper@ecms.local', branchAId);
  await rbacService.ensureAssignment(keeperId, String(keeperRole._id), 'branch');
  keeperAToken = await login('installed-on-keeper@ecms.local');

  const storeOnlyRole = await rbacService.createRole(
    {
      name: { en: 'Store keeper, no assets', ar: 'أمين مخزن بلا أصول' },
      permissionKeys: ['itConsumable.view', 'itConsumable.assign'],
    },
    adminId,
  );
  const storeOnlyId = await mkUser('installed-on-store-only@ecms.local', branchAId);
  await rbacService.ensureAssignment(storeOnlyId, String(storeOnlyRole._id), 'branch');
  storeOnlyKeeperToken = await login('installed-on-store-only@ecms.local');

  await plantEmployee(EMPLOYEE, '0101007', 'وليد صفوت جلال');

  const type = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'inks',
    name: { ar: 'حبارات', en: 'Inks' },
  });
  expect(type.status).toBe(201);
  typeId = data<ItCatalogItemDto>(type).id;

  const category = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'طابعات', en: 'Printers' },
  });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«تعديل الجهاز» — the device an issued unit sits in, after the issue', () => {
  it('moves the ledger row, the memo line and both asset cards together — and records it twice', async () => {
    const item = await stock();
    const before = await device('HP LaserJet 400');
    const after = await device('HP LaserJet 500');
    const { memo, movement } = await issueOne(item, before.id);
    expect(movement).toMatchObject({ assetId: before.id, version: 0 });
    expect(await cardOf(before.id)).toHaveLength(1);

    const res = await setDevice(movement, after.id);
    expect(res.status).toBe(200);
    // Answered as the ledger shows it: the new device named, the version moved on.
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({
      id: movement.id,
      kind: 'issued',
      qty: 1,
      assetId: after.id,
      assetCode: after.assetCode,
      assetName: 'HP LaserJet 500',
      employeeId: String(EMPLOYEE),
      memoId: memo.id,
      version: 1,
    });

    // The ledger row — and nothing of it but the device.
    const row = await rowOf(movement);
    expect(row).toEqual({
      ...movement,
      assetId: after.id,
      assetCode: after.assetCode,
      assetName: 'HP LaserJet 500',
      version: 1,
    });
    // The stock never moved: it is a description, not a quantity.
    expect(data<ItConsumableDto>(await api.get(`/consumables/${item.id}`))).toMatchObject({
      onHandQty: 9,
      issuedQty: 1,
      scrappedQty: 0,
    });

    // The memo: its line re-snapshotted from the register, so a reprint prints the new device.
    const paper = await memoOf(memo.id);
    expect(paper.lines).toEqual([
      {
        ...memo.lines[0],
        assetId: after.id,
        assetCode: after.assetCode,
        assetName: 'HP LaserJet 500',
      },
    ]);
    expect(paper.memoNumber).toBe(memo.memoNumber);
    expect(paper.version).toBe(memo.version + 1);
    const reprint = await api.post(`/consumable-memos/${memo.id}/print`);
    expect(data<ItConsumableMemoDto>(reprint).lines[0]?.assetCode).toBe(after.assetCode);

    // The asset page's card: gone from the old device, on the new one.
    expect(await cardOf(before.id)).toEqual([]);
    expect((await cardOf(after.id)).map((entry) => entry.id)).toEqual([movement.id]);

    // Recorded twice — the item's trail and the paper's — from which device to which, by whom.
    const onItem = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'consumable',
      'entityRef.entityId': item.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(onItem).toHaveLength(1);
    expect(onItem[0]?.changes).toEqual([
      { field: 'installedOn', old: before.id, new: after.id },
      { field: 'movementId', old: null, new: movement.id },
    ]);
    expect(onItem[0]?.actor.userId).not.toBeNull();
    const onMemo = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'consumableMemo',
      'entityRef.entityId': memo.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(onMemo).toHaveLength(1);
    expect(onMemo[0]?.changes).toEqual([
      {
        field: 'installedOn',
        old: { assetId: before.id, assetCode: before.assetCode, assetName: 'HP LaserJet 400' },
        new: { assetId: after.id, assetCode: after.assetCode, assetName: 'HP LaserJet 500' },
      },
      { field: 'movementId', old: null, new: movement.id },
    ]);
  });

  it('the device it was moved off is still not «registered in error»: FR-5 keeps it', async () => {
    const item = await stock();
    const first = await device('HP LaserJet 600');
    const second = await device('HP LaserJet 700');
    const untouched = await device('HP LaserJet 800');
    const { movement } = await issueOne(item, first.id);

    // Corrected to the second, then cleared: neither card lists the unit any more…
    const moved = data<ItConsumableMovementDto>(await setDevice(movement, second.id));
    expect((await setDevice(moved, null)).status).toBe(200);
    expect(await cardOf(first.id)).toHaveLength(0);
    expect(await cardOf(second.id)).toHaveLength(0);

    // …but the signed copy and the trail still name both, so neither may be deleted as an error.
    for (const named of [first, second]) {
      const res = await api.delete(`/assets/${named.id}`);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('has consumables installed on it');
    }
    // A device no issue ever named is still deletable.
    expect((await api.delete(`/assets/${untouched.id}`)).status).toBe(204);
  });

  it('clears it with null («بدون جهاز») — the row, the line and the card', async () => {
    const item = await stock();
    const printer = await device('Shared printer');
    const { memo, movement } = await issueOne(item, printer.id);

    const res = await setDevice(movement, null);
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({
      assetId: null,
      assetCode: null,
      assetName: null,
      version: 1,
    });
    expect((await memoOf(memo.id)).lines[0]).toMatchObject({
      assetId: null,
      assetCode: null,
      assetName: null,
    });
    expect(await cardOf(printer.id)).toEqual([]);

    // And back on a device it never had.
    const again = await setDevice({ id: movement.id, version: 1 }, printer.id);
    expect(again.status).toBe(200);
    expect(data<ItConsumableMovementDto>(again)).toMatchObject({
      assetId: printer.id,
      version: 2,
    });
    expect((await memoOf(memo.id)).lines[0]).toMatchObject({
      assetId: printer.id,
      assetCode: printer.assetCode,
    });
  });

  it('the same device as now is answered with nothing written', async () => {
    const item = await stock();
    const printer = await device('Front desk printer');
    const { memo, movement } = await issueOne(item, printer.id);

    const res = await setDevice(movement, printer.id);
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({ assetId: printer.id, version: 0 });
    expect((await memoOf(memo.id)).version).toBe(memo.version);
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityId': { $in: [item.id, memo.id] },
        action: 'update',
      }),
    ).toBe(0);
  });

  it('leaves the signed copy already filed exactly as it is', async () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const item = await stock();
    const { memo, movement } = await issueOne(item);
    const uploaded = await request(app)
      .post(`/api/v1/it/consumable-memos/${memo.id}/signed-copy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'signed.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    const filed = data<ItConsumableMemoDto>(uploaded).signedCopy;
    expect(filed).not.toBeNull();

    const printer = await device('Accounts printer');
    expect((await setDevice(movement, printer.id)).status).toBe(200);

    const paper = await memoOf(memo.id);
    expect(paper.signedCopy).toEqual(filed);
    expect(paper.lines[0]?.assetId).toBe(printer.id);
    expect((await rowOf(movement)).memoSigned).toBe(true);
  });

  it('refuses a version somebody else moved on — 409, nothing written', async () => {
    const item = await stock();
    const first = await device('Printer one');
    const second = await device('Printer two');
    const { memo, movement } = await issueOne(item);

    expect((await setDevice(movement, first.id)).status).toBe(200);
    // The same screen, still holding version 0.
    const stale = await setDevice(movement, second.id);
    expect(stale.status).toBe(409);
    expect((await rowOf(movement)).assetId).toBe(first.id);
    expect((await memoOf(memo.id)).lines[0]?.assetId).toBe(first.id);
  });

  it('refuses any movement but an issue — 422', async () => {
    const item = await stock();
    const printer = await device('Store printer');
    const [received] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements?kind=received`),
    );
    expect(received).toBeDefined();
    const res = await setDevice(received as ItConsumableMovementDto, printer.id);
    expect(res.status).toBe(422);
    expect((await setDevice(received as ItConsumableMovementDto, null)).status).toBe(422);
    expect((await rowOf(received as ItConsumableMovementDto)).version).toBe(0);
  });

  it('refuses a disposed device — 422, nothing written', async () => {
    const item = await stock();
    const { movement } = await issueOne(item);
    const scrapped = await device('Old printer');
    expect(
      (await api.post(`/assets/${scrapped.id}/dispose`, { method: 'scrapped', reason: 'تالف' }))
        .status,
    ).toBe(200);

    expect((await setDevice(movement, scrapped.id)).status).toBe(422);
    expect(await rowOf(movement)).toMatchObject({ assetId: null, version: 0 });
  });

  it('answers 404 for a movement that does not exist', async () => {
    const res = await setDevice({ id: String(new Types.ObjectId()), version: 0 }, null);
    expect(res.status).toBe(404);
  });

  it('a malformed body is the schema’s refusal — 400', async () => {
    const item = await stock();
    const { movement } = await issueOne(item);
    const missingVersion = await api.patch(`/consumable-movements/${movement.id}/installed-on`, {
      assetId: null,
    });
    expect(missingVersion.status).toBe(400);
    const extra = await api.patch(`/consumable-movements/${movement.id}/installed-on`, {
      assetId: null,
      version: 0,
      qty: 5,
    });
    expect(extra.status).toBe(400);
  });
});

describe('who may change it', () => {
  it('a reader with only itConsumable.view is refused — 403', async () => {
    const item = await stock();
    const printer = await device('Viewer printer');
    const { movement } = await issueOne(item);
    expect((await setDevice(movement, printer.id, viewerToken)).status).toBe(403);
    expect((await setDevice(movement, null, viewerToken)).status).toBe(403);
    expect((await rowOf(movement)).version).toBe(0);
  });

  it('a store keeper without itAsset.view: 404 for any device, 200 for clearing', async () => {
    const item = await stock();
    const printer = await device('Branch printer');
    const other = await device('Branch printer 2');
    const { movement } = await issueOne(item, printer.id);

    // A device in their own branch — one `itAsset.view` would show them, had they held it.
    const named = await setDevice(movement, other.id, storeOnlyKeeperToken);
    expect(named.status).toBe(404);
    expect((await rowOf(movement)).assetId).toBe(printer.id);

    const cleared = await setDevice(movement, null, storeOnlyKeeperToken);
    expect(cleared.status).toBe(200);
    expect(data<ItConsumableMovementDto>(cleared)).toMatchObject({ assetId: null, version: 1 });
  });

  it('a branch keeper changes their own store’s issue to a device they can see — and nothing beyond', async () => {
    const item = await stock();
    const { movement } = await issueOne(item);
    const inA = await device('Branch A printer');
    const inB = await device('Branch B printer', branchBId);

    // A device in a branch their `itAsset.view` does not reach is «not found».
    expect((await setDevice(movement, inB.id, keeperAToken)).status).toBe(404);
    const res = await setDevice(movement, inA.id, keeperAToken);
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res).assetId).toBe(inA.id);

    // Another store's issue is outside their read scope — «not found», whatever they send.
    const itemInB = await stock({ branchId: branchBId });
    const { movement: inBMovement } = await issueOne(itemInB);
    expect((await setDevice(inBMovement, inA.id, keeperAToken)).status).toBe(404);
    expect((await setDevice(inBMovement, null, keeperAToken)).status).toBe(404);
    expect((await rowOf(inBMovement)).version).toBe(0);
  });
});
