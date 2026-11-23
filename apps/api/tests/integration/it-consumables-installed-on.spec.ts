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
  type ItPrinterCounterDto,
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
/** A type that takes the printer's counter («يتطلب عداد الطباعة», 2026-11-19). */
let tonerTypeId: string;
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

  const toners = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'laser',
    name: { ar: 'حبارات ليزر', en: 'Laser toners' },
    requiresCounterReading: true,
  });
  expect(toners.status).toBe(201);
  tonerTypeId = data<ItCatalogItemDto>(toners).id;

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

// «عداد الطابعة» (2026-11-19) — on a counted issue the reading taken on the device is part of the one
// correctable fact: it moves with the device and is checked again where it lands, the same device
// with a new reading corrects it, and «بدون جهاز» takes it off with the device.
describe('a counted toner — the device and the reading taken on it', () => {
  /** A toner onto a printer at a reading, and its ledger row. */
  const fit = async (
    item: ItConsumableDto,
    assetId: string,
    counterReading: number,
    counterReset = false,
  ): Promise<{ memo: ItConsumableMemoDto; movement: ItConsumableMovementDto }> => {
    const res = await api.post('/consumables/issue', {
      employeeId: String(EMPLOYEE),
      lines: [
        {
          consumableId: item.id,
          qty: 1,
          assetId,
          counterReading,
          ...(counterReset ? { counterReset: true } : {}),
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { memo } = data<ItConsumableIssueResultDto>(res);
    const rows = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements?kind=issued&pageSize=100`),
    );
    const movement = rows.find((row) => row.id === memo.lines[0]?.movementId);
    expect(movement).toBeDefined();
    return { memo, movement: movement as ItConsumableMovementDto };
  };
  const counterOf = async (assetId: string): Promise<ItPrinterCounterDto> =>
    data<ItPrinterCounterDto>(await api.get(`/assets/${assetId}/counter-readings`));
  const move = (
    movement: Pick<ItConsumableMovementDto, 'id' | 'version'>,
    body: Record<string, unknown>,
  ) =>
    api.patch(`/consumable-movements/${movement.id}/installed-on`, {
      version: movement.version,
      ...body,
    });
  const errorOf = (res: request.Response) =>
    (res.body as { error: { code: string; details?: unknown[] } }).error;

  it('moves to another printer with that printer’s reading — off the old one’s counter, onto the new', async () => {
    const item = await stock({ typeId: tonerTypeId });
    const before = await device('Counted printer 1');
    const after = await device('Counted printer 2');
    const { memo, movement } = await fit(item, before.id, 15000);

    const res = await move(movement, { assetId: after.id, counterReading: 42000 });
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({
      assetId: after.id,
      counterReading: 42000,
      counterReset: false,
      version: 1,
    });
    expect((await counterOf(before.id)).readings).toEqual([]);
    expect((await counterOf(after.id)).latest).toMatchObject({
      movementId: movement.id,
      reading: 42000,
    });
    // The paper follows the device; it never carried the reading.
    expect((await memoOf(memo.id)).lines[0]?.assetId).toBe(after.id);
    const audit = await AuditLogModel.find({
      'entityRef.entityType': 'consumable',
      'entityRef.entityId': item.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(audit[0]?.changes).toEqual([
      { field: 'installedOn', old: before.id, new: after.id },
      { field: 'counterReading', old: 15000, new: 42000 },
      { field: 'movementId', old: null, new: movement.id },
    ]);
  });

  it('refuses a move with no reading — and a reading the new printer’s counter is already past', async () => {
    const item = await stock({ typeId: tonerTypeId });
    const before = await device('Counted printer 3');
    const after = await device('Counted printer 4');
    const { movement } = await fit(item, before.id, 15000);
    // A later reading on the new printer: the moved toner's issue is dated before it.
    await fit(await stock({ typeId: tonerTypeId }), after.id, 50000);

    const bare = await move(movement, { assetId: after.id });
    expect(bare.status).toBe(422);
    expect(errorOf(bare)).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
      details: [expect.objectContaining({ field: 'counterReading', code: 'REQUIRED' })],
    });
    // Backdated against the later 50000 on the new printer: refused with that figure.
    const past = await move(movement, { assetId: after.id, counterReading: 50000 });
    expect(past.status).toBe(422);
    expect(errorOf(past)).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
      details: [
        expect.objectContaining({
          field: 'counterReading',
          code: 'NEXT_READING',
          message: '50000',
        }),
        expect.objectContaining({ field: 'counterReading', code: 'NEXT_AT' }),
      ],
    });
    expect(await rowOf(movement)).toMatchObject({ assetId: before.id, counterReading: 15000 });
  });

  it('«بدون جهاز» takes the reading off with the device', async () => {
    const item = await stock({ typeId: tonerTypeId });
    const printer = await device('Counted printer 5');
    const { movement } = await fit(item, printer.id, 15000);

    // A reading for «no device» is the schema's refusal.
    expect((await move(movement, { assetId: null, counterReading: 1 })).status).toBe(400);
    const res = await move(movement, { assetId: null });
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({
      assetId: null,
      counterReading: null,
      counterReset: false,
    });
    expect(await counterOf(printer.id)).toMatchObject({ latest: null, readings: [] });
  });

  it('a reset the later readings rest on cannot leave its printer', async () => {
    const printer = await device('Counted printer 6');
    const target = await device('Counted printer 7');
    await fit(await stock({ typeId: tonerTypeId }), printer.id, 90000);
    const { movement: reset } = await fit(
      await stock({ typeId: tonerTypeId }),
      printer.id,
      10,
      true,
    );
    await fit(await stock({ typeId: tonerTypeId }), printer.id, 900);

    for (const body of [{ assetId: null }, { assetId: target.id, counterReading: 5 }]) {
      const res = await move(reset, body);
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('BUSINESS_RULE_VIOLATION');
      expect(JSON.stringify(res.body)).toContain('counter again');
    }
    expect(await rowOf(reset)).toMatchObject({
      assetId: printer.id,
      counterReading: 10,
      counterReset: true,
      version: 0,
    });
  });

  it('corrects a mistyped reading on the device it already names — the paper left as it is', async () => {
    const item = await stock({ typeId: tonerTypeId });
    const printer = await device('Counted printer 8');
    const { memo, movement } = await fit(item, printer.id, 15000);

    const res = await move(movement, { assetId: printer.id, counterReading: 15500 });
    expect(res.status).toBe(200);
    expect(data<ItConsumableMovementDto>(res)).toMatchObject({
      assetId: printer.id,
      counterReading: 15500,
      version: 1,
    });
    expect((await memoOf(memo.id)).version).toBe(memo.version);
    // The same again is nothing to write.
    const again = await move(
      { id: movement.id, version: 1 },
      {
        assetId: printer.id,
        counterReading: 15500,
      },
    );
    expect(data<ItConsumableMovementDto>(again).version).toBe(1);
    // A device named with no reading is a refusal even when it is the same one.
    expect((await move({ id: movement.id, version: 1 }, { assetId: printer.id })).status).toBe(422);
  });

  // «One memo, one printer, one reading» — the lines of one memo on one printer are one display read
  // once: a write of the reading of one of them is a write of it on all of them.
  describe('one memo, one printer, one reading', () => {
    /** One memo of several toners, each line onto a printer at a reading; its ledger rows in order. */
    const fitMemo = async (
      lines: { item: ItConsumableDto; assetId: string; counterReading: number }[],
    ): Promise<{ memo: ItConsumableMemoDto; rows: ItConsumableMovementDto[] }> => {
      const res = await api.post('/consumables/issue', {
        employeeId: String(EMPLOYEE),
        lines: lines.map(({ item, assetId, counterReading }) => ({
          consumableId: item.id,
          qty: 1,
          assetId,
          counterReading,
        })),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const { memo } = data<ItConsumableIssueResultDto>(res);
      const rows = await Promise.all(
        lines.map(async ({ item }, index) => {
          const found = data<ItConsumableMovementDto[]>(
            await api.get(`/consumables/${item.id}/movements?kind=issued&pageSize=100`),
          ).find((row) => row.id === memo.lines[index]?.movementId);
          expect(found).toBeDefined();
          return found as ItConsumableMovementDto;
        }),
      );
      return { memo, rows };
    };
    const readingsOf = async (assetId: string) =>
      (await counterOf(assetId)).readings.map((r) => [r.movementId, r.reading]).sort();

    it('correcting one line’s reading corrects the memo’s other line on that printer — and a later issue is held above it', async () => {
      const black = await stock({ typeId: tonerTypeId });
      const cyan = await stock({ typeId: tonerTypeId });
      const printer = await device('Counted printer 9');
      const {
        rows: [k, c],
      } = await fitMemo([
        { item: black, assetId: printer.id, counterReading: 1000 },
        { item: cyan, assetId: printer.id, counterReading: 1000 },
      ]);
      if (k === undefined || c === undefined) throw new Error('two rows expected');

      const res = await move(k, { assetId: printer.id, counterReading: 1500 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      // The printer's counter: one memo, one reading — both lines at 1500.
      expect(await readingsOf(printer.id)).toEqual(
        [
          [k.id, 1500],
          [c.id, 1500],
        ].sort(),
      );
      expect((await counterOf(printer.id)).latest).toMatchObject({ reading: 1500 });
      // The ledger: the other line moved with it, and its version moved on.
      expect(await rowOf(c)).toMatchObject({
        assetId: printer.id,
        counterReading: 1500,
        counterReset: false,
        version: 1,
      });
      const ledger = data<ItConsumableMovementDto[]>(
        await api.get(`/consumable-movements?assetId=${printer.id}&pageSize=100`),
      );
      expect(ledger.map((row) => [row.id, row.counterReading]).sort()).toEqual(
        [
          [k.id, 1500],
          [c.id, 1500],
        ].sort(),
      );
      // Its item's trail names the change and the row.
      const audit = await AuditLogModel.find({
        'entityRef.entityType': 'consumable',
        'entityRef.entityId': cyan.id,
        action: 'update',
      })
        .lean()
        .exec();
      expect(audit.map((row) => row.changes)).toEqual([
        [
          { field: 'counterReading', old: 1000, new: 1500 },
          { field: 'movementId', old: null, new: c.id },
        ],
      ]);
      // A dialog opened on the other line before is now a stale read.
      expect((await move(c, { assetId: printer.id, counterReading: 1600 })).status).toBe(409);

      // The timeline reads 1500 at that moment: a later 1200 is below it.
      const later = await api.post('/consumables/issue', {
        employeeId: String(EMPLOYEE),
        lines: [
          {
            consumableId: (await stock({ typeId: tonerTypeId })).id,
            qty: 1,
            assetId: printer.id,
            counterReading: 1200,
          },
        ],
      });
      expect(later.status).toBe(422);
      expect(errorOf(later)).toMatchObject({
        code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
        details: [
          expect.objectContaining({ code: 'PREVIOUS_READING', message: '1500' }),
          expect.objectContaining({ code: 'PREVIOUS_AT' }),
        ],
      });
    });

    it('a line moved onto the printer where another line of its memo sits rewrites that one to the reading typed — and a move off leaves it', async () => {
      const black = await stock({ typeId: tonerTypeId });
      const cyan = await stock({ typeId: tonerTypeId });
      const first = await device('Counted printer 10');
      const second = await device('Counted printer 11');
      const {
        memo,
        rows: [k, c],
      } = await fitMemo([
        { item: black, assetId: first.id, counterReading: 1000 },
        { item: cyan, assetId: second.id, counterReading: 3000 },
      ]);
      if (k === undefined || c === undefined) throw new Error('two rows expected');

      const res = await move(c, { assetId: first.id, counterReading: 1200 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await readingsOf(first.id)).toEqual(
        [
          [k.id, 1200],
          [c.id, 1200],
        ].sort(),
      );
      expect((await counterOf(second.id)).readings).toEqual([]);
      const black1 = await rowOf(k);
      expect(black1).toMatchObject({ assetId: first.id, counterReading: 1200, version: 1 });
      // The paper's line followed the moved one only.
      expect((await memoOf(memo.id)).lines.map((line) => line.assetId)).toEqual([
        first.id,
        first.id,
      ]);

      // Off the printer again: the line left there keeps the reading.
      expect((await move(black1, { assetId: null })).status).toBe(200);
      expect(await readingsOf(first.id)).toEqual([[c.id, 1200]]);
      expect(await rowOf(c)).toMatchObject({ assetId: first.id, counterReading: 1200 });
    });
  });

  it('an issue recorded without a reading takes none afterwards — and moves as it always did', async () => {
    const item = await stock();
    const printer = await device('Uncounted printer');
    const { movement } = await issueOne(item, printer.id);
    expect(movement).toMatchObject({ counterReading: null, counterReset: false });

    const res = await move(movement, { assetId: printer.id, counterReading: 100 });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('recorded without a counter reading');
    expect((await move(movement, { assetId: null })).status).toBe(200);
  });
});
