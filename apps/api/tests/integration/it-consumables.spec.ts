// Consumables (FR-20) over real HTTP with real RBAC — «وعايز بقى شاشة تانية تحت خطوط المحمول تكون
// للمستهلكات … وأقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك وأتبدل لمين واطبعله مذكره ولو حاجة
// بتتركب فى حاجة تانية … أقدر أذكر الجهاز اللى أتركب عليه من اللأصول».
//
// What a mocked spec cannot see: the catalog taking the new kind, one stock per item per store held
// by the unique index (and another store's item of the same name being its own), an opening
// quantity written as a delivery, the counters moved with every movement and never below zero —
// two people issuing the last unit at once, one of them refused — a replacement counted as scrap,
// ONE memo per issue on its own unbroken series, the ledger naming the person, the asset and the
// memo, a leaver refused through HR's own answer, a disposed asset refused, the signed copy, and
// the branch scope.
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
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchAToken: string; // itAsset.view at BRANCH scope, placed in branch A — nothing else
let keeperAToken: string; // itAsset.view + itAsset.assign at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
let typeId: string; // a consumable type — «كابلات»
let categoryId: string; // an ASSET category, for the devices things are installed on

// Planted in HR, so the leaver rule is judged on HR's own answer and the memo names a real code.
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-consumables-test-${Date.now()}`;
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

const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  status: 'active' | 'exited',
): Promise<void> => {
  const branch = new Types.ObjectId(branchAId);
  const department = new Types.ObjectId();
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status,
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

// Every item its own name: two tests never share a stock.
let names = 0;
const nextName = (): string => {
  names += 1;
  return `كابل HDMI ${String(names)} متر`;
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

const current = async (id: string): Promise<ItConsumableDto> =>
  data<ItConsumableDto>(await api.get(`/consumables/${id}`));

const issue = (body: Record<string, unknown>, token = adminToken) =>
  api.post('/consumables/issue', { employeeId: String(EMPLOYEE), ...body }, token);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('consumables-admin@ecms.local');
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
  adminToken = await login('consumables-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('90', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('91', 'فرع ب', 'Branch B');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Store viewer', ar: 'مطالع مخزن' }, permissionKeys: ['itAsset.view'] },
    adminId,
  );
  const viewerId = await mkUser('consumables-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  branchAToken = await login('consumables-viewer@ecms.local');

  const keeperRole = await rbacService.createRole(
    {
      name: { en: 'Store keeper', ar: 'أمين مخزن' },
      permissionKeys: ['itAsset.view', 'itAsset.assign'],
    },
    adminId,
  );
  const keeperId = await mkUser('consumables-keeper@ecms.local', branchAId);
  await rbacService.ensureAssignment(keeperId, String(keeperRole._id), 'branch');
  keeperAToken = await login('consumables-keeper@ecms.local');

  await plantEmployee(EMPLOYEE, '0101002', 'وليد صفوت جلال', 'active');
  await plantEmployee(LEAVER, '0100001', 'شريف ممدوح فاروق', 'exited');

  // «كابلات بأنواعها» — the catalog's third kind.
  const type = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'cables',
    name: { ar: 'كابلات', en: 'Cables' },
  });
  expect(type.status).toBe(201);
  typeId = data<ItCatalogItemDto>(type).id;

  const category = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'أجهزة مكتبية', en: 'Desktops' },
  });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the catalog', () => {
  it('keeps the consumables’ types as a kind of its own', async () => {
    const types = data<ItCatalogItemDto[]>(await api.get('/catalog-items?kind=consumableType'));
    expect(types.map((row) => row.id)).toEqual([typeId]);
    expect(types[0]).toMatchObject({ kind: 'consumableType', code: 'cables' });
  });
});

describe('the store', () => {
  it('adds an item with its opening quantity written as a delivery', async () => {
    const item = await stock({ minQty: 10 });
    expect(item.code).toMatch(/^CON-\d{5}$/u);
    expect(item).toMatchObject({
      typeId,
      branchId: branchAId,
      unit: 'قطعة',
      active: true,
      onHandQty: 10,
      issuedQty: 0,
      scrappedQty: 0,
      minQty: 10,
      // At its own minimum — the reorder hint, not a block.
      belowMin: true,
    });

    const movements = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements`),
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      kind: 'received',
      qty: 10,
      consumableCode: item.code,
      memoId: null,
    });

    // The register's own filters find it.
    const low = data<ItConsumableDto[]>(
      await api.get(`/consumables?belowMin=true&branchId=${branchAId}&pageSize=100`),
    );
    expect(low.map((row) => row.id)).toContain(item.id);
    const byCode = data<ItConsumableDto[]>(await api.get(`/consumables?search=${item.code}`));
    expect(byCode.map((row) => row.id)).toEqual([item.id]);
  });

  it('keeps one stock per item per store — another branch’s item of the same name is its own', async () => {
    const name = nextName();
    await stock({ name });
    expect(
      (await api.post('/consumables', { name, typeId, unit: 'قطعة', branchId: branchAId })).status,
    ).toBe(409);
    const elsewhere = await api.post('/consumables', {
      name,
      typeId,
      unit: 'قطعة',
      branchId: branchBId,
    });
    expect(elsewhere.status).toBe(201);
    expect(data<ItConsumableDto>(elsewhere)).toMatchObject({ branchId: branchBId, onHandQty: 0 });
  });

  it('never takes a quantity as a field, nor an asset category as a type, nor a branch in an edit', async () => {
    const sneaky = await api.post('/consumables', {
      name: nextName(),
      typeId,
      unit: 'قطعة',
      branchId: branchAId,
      onHandQty: 500,
    });
    expect(sneaky.status).toBe(400);
    const wrongKind = await api.post('/consumables', {
      name: nextName(),
      typeId: categoryId,
      unit: 'قطعة',
      branchId: branchAId,
    });
    expect(wrongKind.status).toBe(422);

    const item = await stock();
    const moved = await api.patch(`/consumables/${item.id}`, {
      branchId: branchBId,
      version: item.version,
    });
    expect(moved.status).toBe(400);
    const counted = await api.patch(`/consumables/${item.id}`, {
      onHandQty: 3,
      version: item.version,
    });
    expect(counted.status).toBe(400);
  });

  it('edits an item’s facts under its version, and refuses a name its store already has', async () => {
    const taken = await stock();
    const item = await stock();
    const edited = await api.patch(`/consumables/${item.id}`, {
      unit: 'متر',
      minQty: 3,
      notes: 'رف 2',
      version: item.version,
    });
    expect(edited.status).toBe(200);
    expect(data<ItConsumableDto>(edited)).toMatchObject({
      unit: 'متر',
      minQty: 3,
      notes: 'رف 2',
      onHandQty: 10,
    });
    // A stale version is a conflict, not a silent overwrite.
    expect(
      (await api.patch(`/consumables/${item.id}`, { unit: 'علبة', version: item.version })).status,
    ).toBe(409);
    const renamed = await api.patch(`/consumables/${item.id}`, {
      name: taken.name,
      version: (await current(item.id)).version,
    });
    expect(renamed.status).toBe(409);
  });
});

describe('stock in and out', () => {
  it('receives, scraps and takes back — each a movement, each counter moved with it', async () => {
    const item = await stock();

    const received = await api.post(`/consumables/${item.id}/receive`, {
      qty: 5,
      notes: 'فاتورة 77',
    });
    expect(received.status).toBe(200);
    expect(data<ItConsumableDto>(received).onHandQty).toBe(15);

    const scrapped = await api.post(`/consumables/${item.id}/scrap`, {
      qty: 2,
      reason: 'كسر أثناء النقل',
    });
    expect(scrapped.status).toBe(200);
    expect(data<ItConsumableDto>(scrapped)).toMatchObject({ onHandQty: 13, scrappedQty: 2 });

    // More than the shelf holds is refused, and nothing moves.
    expect(
      (await api.post(`/consumables/${item.id}/scrap`, { qty: 99, reason: 'جرد' })).status,
    ).toBe(422);
    expect((await current(item.id)).onHandQty).toBe(13);

    const back = await api.post(`/consumables/${item.id}/return`, {
      qty: 1,
      employeeId: String(EMPLOYEE),
    });
    expect(back.status).toBe(200);
    expect(data<ItConsumableDto>(back)).toMatchObject({ onHandQty: 14, issuedQty: 0 });

    const movements = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements`),
    );
    expect(movements.map((row) => row.kind)).toEqual([
      'returned',
      'scrapped',
      'received',
      'received',
    ]);
    expect(movements[0]).toMatchObject({ employeeCode: '0101002', employeeName: 'وليد صفوت جلال' });
    expect(movements[1]?.reason).toBe('كسر أثناء النقل');
  });

  it('takes no delivery for a retired item — but still lets what is left of it be scrapped', async () => {
    const item = await stock();
    const retired = await api.patch(`/consumables/${item.id}`, {
      active: false,
      version: item.version,
    });
    expect(retired.status).toBe(200);
    expect((await api.post(`/consumables/${item.id}/receive`, { qty: 1 })).status).toBe(422);
    const scrapped = await api.post(`/consumables/${item.id}/scrap`, {
      qty: 10,
      reason: 'إيقاف الصنف',
    });
    expect(scrapped.status).toBe(200);
    expect(data<ItConsumableDto>(scrapped).onHandQty).toBe(0);
    expect((await issue({ lines: [{ consumableId: item.id, qty: 1 }] })).status).toBe(422);
  });
});

describe('issuing to an employee — «وأتبدل لمين واطبعله مذكره»', () => {
  it('writes ONE memo for every line, names the asset a part went on, and counts a replacement as scrap', async () => {
    const cable = await stock();
    const mouse = await stock({ name: 'Mouse — ' + nextName() });
    const desktop = data<ItAssetDto>(
      await api.post('/assets', { name: 'Lenovo ThinkCentre', categoryId, branchId: branchAId }),
    );

    const res = await issue({
      notes: 'للمكتب الأمامي',
      lines: [
        { consumableId: cable.id, qty: 3 },
        { consumableId: mouse.id, qty: 1, reason: 'replacement', assetId: desktop.id },
      ],
    });
    expect(res.status).toBe(201);
    const { memo, consumables } = data<ItConsumableIssueResultDto>(res);

    expect(Number.isInteger(memo.memoNumber) && memo.memoNumber > 0).toBe(true);
    expect(memo).toMatchObject({
      employeeId: String(EMPLOYEE),
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      branchId: branchAId,
      notes: 'للمكتب الأمامي',
      signedCopy: null,
    });
    expect(memo).not.toHaveProperty('nationalId');
    expect(memo.lines).toEqual([
      expect.objectContaining({
        consumableId: cable.id,
        code: cable.code,
        typeName: { ar: 'كابلات', en: 'Cables' },
        qty: 3,
        reason: 'new',
        assetId: null,
      }),
      expect.objectContaining({
        consumableId: mouse.id,
        qty: 1,
        reason: 'replacement',
        assetId: desktop.id,
        assetCode: desktop.assetCode,
        assetName: 'Lenovo ThinkCentre',
      }),
    ]);
    // The cable: three off the shelf. The mouse: one off the shelf, and the broken one it
    // replaced counted as scrap though it was never on hand.
    expect(consumables).toEqual([
      expect.objectContaining({ id: cable.id, onHandQty: 7, issuedQty: 3, scrappedQty: 0 }),
      expect.objectContaining({ id: mouse.id, onHandQty: 9, issuedQty: 1, scrappedQty: 1 }),
    ]);

    // Read back and printed again: the same paper, under the same number.
    const stored = data<ItConsumableMemoDto>(await api.get(`/consumable-memos/${memo.id}`));
    expect(stored.lines).toEqual(memo.lines);
    const again = await api.post(`/consumable-memos/${memo.id}/print`);
    expect(again.status).toBe(200);
    expect(data<ItConsumableMemoDto>(again).memoNumber).toBe(memo.memoNumber);

    // The ledger, from the person's side and from the asset's.
    const theirs = data<ItConsumableMovementDto[]>(
      await api.get(
        `/consumable-movements?employeeId=${String(EMPLOYEE)}&kind=issued&pageSize=100`,
      ),
    ).filter((row) => row.memoId === memo.id);
    expect(theirs).toHaveLength(2);
    expect(theirs[0]).toMatchObject({
      memoNumber: memo.memoNumber,
      memoSigned: false,
      employeeCode: '0101002',
    });
    const installed = data<ItConsumableMovementDto[]>(
      await api.get(`/consumable-movements?assetId=${desktop.id}`),
    );
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      consumableId: mouse.id,
      reason: 'replacement',
      assetCode: desktop.assetCode,
      assetName: 'Lenovo ThinkCentre',
    });
    // Something went into it, so it was used: no longer a registered-in-error asset (FR-5) — the
    // ledger and the signed memo name it.
    expect((await api.delete(`/assets/${desktop.id}`)).status).toBe(422);
    expect((await api.get(`/assets/${desktop.id}`)).status).toBe(200);

    // The next issue takes the next number — one series, no gap.
    const next = data<ItConsumableIssueResultDto>(
      await issue({ lines: [{ consumableId: cable.id, qty: 1 }] }),
    );
    expect(next.memo.memoNumber).toBe(memo.memoNumber + 1);
  });

  it('refuses a leaver, more than the shelf holds, two stores on one memo and a disposed asset — moving nothing', async () => {
    const item = await stock();
    const inB = await stock({ branchId: branchBId });
    const before = data<ItConsumableIssueResultDto>(
      await issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
    ).memo.memoNumber;

    expect(
      (await issue({ employeeId: String(LEAVER), lines: [{ consumableId: item.id, qty: 1 }] }))
        .status,
    ).toBe(422);
    expect((await issue({ lines: [{ consumableId: item.id, qty: 99 }] })).status).toBe(422);
    expect(
      (
        await issue({
          lines: [
            { consumableId: item.id, qty: 1 },
            { consumableId: inB.id, qty: 1 },
          ],
        })
      ).status,
    ).toBe(422);
    // An item twice on one memo is the schema's refusal.
    expect(
      (
        await issue({
          lines: [
            { consumableId: item.id, qty: 1 },
            { consumableId: item.id, qty: 1 },
          ],
        })
      ).status,
    ).toBe(400);

    const scrapped = data<ItAssetDto>(
      await api.post('/assets', { name: 'Old printer', categoryId, branchId: branchAId }),
    );
    expect(
      (await api.post(`/assets/${scrapped.id}/dispose`, { method: 'scrapped', reason: 'تالف' }))
        .status,
    ).toBe(200);
    expect(
      (await issue({ lines: [{ consumableId: item.id, qty: 1, assetId: scrapped.id }] })).status,
    ).toBe(422);

    // Nothing moved, and no number was taken by any refusal.
    expect((await current(item.id)).onHandQty).toBe(9);
    const after = data<ItConsumableIssueResultDto>(
      await issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
    ).memo.memoNumber;
    expect(after).toBe(before + 1);
  });

  it('gives the last unit to one of two people issuing it at once — never below zero, and no number lost', async () => {
    const item = await stock({ openingQty: 1 });
    const [first, second] = await Promise.all([
      issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
      issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([201, 422]);
    expect(await current(item.id)).toMatchObject({ onHandQty: 0, issuedQty: 1 });

    const winner = data<ItConsumableIssueResultDto>(first.status === 201 ? first : second);
    await api.post(`/consumables/${item.id}/receive`, { qty: 1 });
    const next = data<ItConsumableIssueResultDto>(
      await issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
    );
    expect(next.memo.memoNumber).toBe(winner.memo.memoNumber + 1);
  });

  it('files the signed copy, shows it on the ledger, and withdraws it', async () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const item = await stock();
    const { memo } = data<ItConsumableIssueResultDto>(
      await issue({ lines: [{ consumableId: item.id, qty: 1 }] }),
    );

    const uploaded = await request(app)
      .post(`/api/v1/it/consumable-memos/${memo.id}/signed-copy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'signed.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(data<ItConsumableMemoDto>(uploaded).signedCopy?.mime).toBe('image/png');
    const [row] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements?kind=issued`),
    );
    expect(row).toMatchObject({ memoId: memo.id, memoSigned: true });

    const bytes = await api.get(`/consumable-memos/${memo.id}/signed-copy`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');

    const withdrawn = await api.delete(`/consumable-memos/${memo.id}/signed-copy`);
    expect(withdrawn.status).toBe(200);
    expect(data<ItConsumableMemoDto>(withdrawn).signedCopy).toBeNull();
  });
});

describe('scope', () => {
  it('a branch-A reader sees neither branch B’s store nor its ledger, and changes nothing', async () => {
    const inB = await stock({ branchId: branchBId });
    expect((await api.get(`/consumables/${inB.id}`, branchAToken)).status).toBe(404);
    expect((await api.get(`/consumables/${inB.id}/movements`, branchAToken)).status).toBe(404);
    const listed = data<ItConsumableDto[]>(
      await api.get('/consumables?pageSize=100', branchAToken),
    );
    expect(listed.some((row) => row.id === inB.id)).toBe(false);
    expect(listed.every((row) => row.branchId === branchAId)).toBe(true);
    const ledger = data<ItConsumableMovementDto[]>(
      await api.get('/consumable-movements?pageSize=100', branchAToken),
    );
    expect(ledger.every((row) => row.branchId === branchAId)).toBe(true);

    const inA = await stock();
    expect(
      (await api.post(`/consumables/${inA.id}/receive`, { qty: 1 }, branchAToken)).status,
    ).toBe(403);
    expect((await issue({ lines: [{ consumableId: inA.id, qty: 1 }] }, branchAToken)).status).toBe(
      403,
    );
  });

  it('a branch-A keeper issues from their own store only, and installs only on an asset they can see', async () => {
    const inA = await stock();
    const inB = await stock({ branchId: branchBId });
    expect((await issue({ lines: [{ consumableId: inB.id, qty: 1 }] }, keeperAToken)).status).toBe(
      404,
    );

    const assetInB = data<ItAssetDto>(
      await api.post('/assets', { name: 'Branch B desktop', categoryId, branchId: branchBId }),
    );
    expect(
      (
        await issue(
          { lines: [{ consumableId: inA.id, qty: 1, assetId: assetInB.id }] },
          keeperAToken,
        )
      ).status,
    ).toBe(404);
    expect((await current(inA.id)).onHandQty).toBe(10);

    const issued = await issue({ lines: [{ consumableId: inA.id, qty: 1 }] }, keeperAToken);
    expect(issued.status).toBe(201);
  });
});
