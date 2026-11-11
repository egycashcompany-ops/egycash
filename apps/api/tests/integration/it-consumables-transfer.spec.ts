// «تحويل إلى فرع» over real HTTP with real RBAC — «هنا /it/consumables … وطبعاً المستهلكات لو مثلاً فى
// 10 ماوس .. فممكن أنقل 5 لفرع تاني وهكذا» (2026-11-11): at once («فوراً»), no paper («لا، السجل
// كفاية»), several items in one step («كذا حاجة مرة واحدة»).
//
// What a mocked spec cannot see: ONE transaction for the whole transfer — a refused line leaves
// every other line, and the item a line would have made, unwritten — the two stores' counters
// moved together and never below zero, the receiving store's item found by its exact name (the
// unique index's) or made there with a new code, the pair of movements on both ledgers sharing one
// `transferId` and naming each other, the audit trail of both stores, and the reach of the grant.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type ItCatalogItemDto,
  type ItConsumableDto,
  type ItConsumableMovementDto,
  type ItConsumableTransferResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let keeperAToken: string; // itAsset.view + itAsset.assign at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
let typeId: string; // «ماوس»

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-consumables-transfer-test-${Date.now()}`;
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
const message = (res: request.Response): string =>
  (res.body as { error: { message: string } }).error.message;

// Every item its own name: two tests never share a stock — and no name is the start of another's.
let names = 0;
const nextName = (): string => {
  names += 1;
  return `ماوس لاسلكي — ${String(names)} —`;
};

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body: Record<string, unknown>, token = adminToken) =>
    request(app).patch(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
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

const movementsOf = async (id: string): Promise<ItConsumableMovementDto[]> =>
  data<ItConsumableMovementDto[]>(await api.get(`/consumables/${id}/movements?pageSize=100`));

/** The store's items of exactly this name — the search matches part of a name, so it is checked. */
const storeItems = async (branchId: string, name: string): Promise<ItConsumableDto[]> =>
  data<ItConsumableDto[]>(
    await api.get(
      `/consumables?branchId=${branchId}&search=${encodeURIComponent(name)}&pageSize=100`,
    ),
  ).filter((row) => row.name === name);

const transfer = (body: Record<string, unknown>, token = adminToken) =>
  api.post('/consumables/transfer', { toBranchId: branchBId, ...body }, token);

/** Nothing moved: the item's counters as they were, and no movement beyond the ones it had. */
const untouched = async (before: ItConsumableDto, movements: number): Promise<void> => {
  expect(await current(before.id)).toMatchObject({
    onHandQty: before.onHandQty,
    issuedQty: before.issuedQty,
    scrappedQty: before.scrappedQty,
  });
  expect(await movementsOf(before.id)).toHaveLength(movements);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('transfer-admin@ecms.local');
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
  adminToken = await login('transfer-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('60', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('61', 'فرع ب', 'Branch B');

  const keeperRole = await rbacService.createRole(
    {
      name: { en: 'Store keeper', ar: 'أمين مخزن' },
      permissionKeys: ['itAsset.view', 'itAsset.assign'],
    },
    adminId,
  );
  const keeperId = await mkUser('transfer-keeper@ecms.local', branchAId);
  await rbacService.ensureAssignment(keeperId, String(keeperRole._id), 'branch');
  keeperAToken = await login('transfer-keeper@ecms.local');

  const type = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'mice',
    name: { ar: 'ماوس', en: 'Mice' },
  });
  expect(type.status).toBe(201);
  typeId = data<ItCatalogItemDto>(type).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('«لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني»', () => {
  it('moves five of ten — five left here, five there — the other store’s item made when it has none', async () => {
    const mice = await stock({ minQty: 2, notes: 'رف 1' });
    expect(await storeItems(branchBId, mice.name)).toHaveLength(0);

    const res = await transfer({
      notes: 'تحويل لفرع ب',
      lines: [{ consumableId: mice.id, qty: 5 }],
    });
    expect(res.status).toBe(201);
    const result = data<ItConsumableTransferResultDto>(res);
    expect(result).toMatchObject({ fromBranchId: branchAId, toBranchId: branchBId });
    expect(result.lines).toHaveLength(1);
    const [line] = result.lines;
    expect(line).toMatchObject({
      fromConsumableId: mice.id,
      fromCode: mice.code,
      name: mice.name,
      unit: 'قطعة',
      qty: 5,
      created: true,
    });

    // Here: five left, and nothing issued or written off.
    expect(await current(mice.id)).toMatchObject({ onHandQty: 5, issuedQty: 0, scrappedQty: 0 });

    // There: the same name, type and unit, a code of its own — and nothing else carried over.
    const [made] = await storeItems(branchBId, mice.name);
    expect(made).toMatchObject({
      id: line?.toConsumableId,
      code: line?.toCode,
      typeId,
      unit: 'قطعة',
      branchId: branchBId,
      onHandQty: 5,
      issuedQty: 0,
      scrappedQty: 0,
      minQty: null,
      notes: null,
      active: true,
    });
    expect(made?.code).toMatch(/^CON-\d{5}$/u);
    expect(made?.code).not.toBe(mice.code);

    // The pair, one on each ledger, sharing the transfer's id and naming each other.
    const [out] = await movementsOf(mice.id);
    expect(out).toMatchObject({
      kind: 'transferredOut',
      qty: 5,
      branchId: branchAId,
      transferId: result.transferId,
      counterpartBranchId: branchBId,
      counterpartConsumableId: made?.id,
      counterpartConsumableCode: made?.code,
      notes: 'تحويل لفرع ب',
      employeeId: null,
      memoId: null,
    });
    const theirs = await movementsOf(made?.id ?? '');
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      kind: 'transferredIn',
      qty: 5,
      branchId: branchBId,
      transferId: result.transferId,
      counterpartBranchId: branchAId,
      counterpartConsumableId: mice.id,
      counterpartConsumableCode: mice.code,
    });

    // The ledger across items takes the new kinds as a filter.
    const inbound = data<ItConsumableMovementDto[]>(
      await api.get(`/consumable-movements?kind=transferredIn&branchId=${branchBId}&pageSize=100`),
    );
    expect(inbound.map((row) => row.consumableId)).toContain(made?.id);
    expect(inbound.every((row) => row.kind === 'transferredIn')).toBe(true);

    // The trail: both items' `transfer` rows, and the made item's registration.
    const madeId = made?.id ?? '';
    const audits = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'consumable',
      'entityRef.entityId': { $in: [mice.id, madeId] },
      action: { $in: ['transfer', 'create'] },
    })
      .lean()
      .exec();
    const rows = audits.map((row) => `${row.entityRef.entityId}:${row.action}`).sort();
    expect(rows).toEqual(
      [`${mice.id}:create`, `${mice.id}:transfer`, `${madeId}:create`, `${madeId}:transfer`].sort(),
    );
  });

  it('adds to the other store’s item of the same name when it has one — no second item', async () => {
    const name = nextName();
    const mine = await stock({ name });
    const theirs = await stock({ name, branchId: branchBId, openingQty: 3 });

    const res = await transfer({ lines: [{ consumableId: mine.id, qty: 4 }] });
    expect(res.status).toBe(201);
    expect(data<ItConsumableTransferResultDto>(res).lines[0]).toMatchObject({
      toConsumableId: theirs.id,
      toCode: theirs.code,
      created: false,
    });
    expect((await current(mine.id)).onHandQty).toBe(6);
    expect((await current(theirs.id)).onHandQty).toBe(7);
    expect(await storeItems(branchBId, name)).toHaveLength(1);
  });

  it('carries several items in one step, under ONE transfer id', async () => {
    const first = await stock();
    const second = await stock({ openingQty: 4 });

    const res = await transfer({
      lines: [
        { consumableId: first.id, qty: 2 },
        { consumableId: second.id, qty: 4 },
      ],
    });
    expect(res.status).toBe(201);
    const result = data<ItConsumableTransferResultDto>(res);
    expect(result.lines.map((line) => [line.fromConsumableId, line.qty])).toEqual([
      [first.id, 2],
      [second.id, 4],
    ]);
    const ids = [
      ...(await movementsOf(first.id)),
      ...(await movementsOf(second.id)),
      ...(await movementsOf(result.lines[0]?.toConsumableId ?? '')),
      ...(await movementsOf(result.lines[1]?.toConsumableId ?? '')),
    ]
      .filter((row) => row.kind === 'transferredOut' || row.kind === 'transferredIn')
      .map((row) => row.transferId);
    expect(ids).toHaveLength(4);
    expect(new Set(ids)).toEqual(new Set([result.transferId]));
    expect((await current(second.id)).onHandQty).toBe(0);
  });

  it('lets a retired item send what is left of it to another shelf', async () => {
    const item = await stock();
    const retired = await api.patch(`/consumables/${item.id}`, {
      active: false,
      version: item.version,
    });
    expect(retired.status).toBe(200);

    const res = await transfer({ lines: [{ consumableId: item.id, qty: 10 }] });
    expect(res.status).toBe(201);
    expect(await current(item.id)).toMatchObject({
      onHandQty: 0,
      issuedQty: 0,
      scrappedQty: 0,
      active: false,
    });
    const [made] = await storeItems(branchBId, item.name);
    // What it reaches is an item that takes stock: the store it reached has not retired it.
    expect(made).toMatchObject({ onHandQty: 10, active: true });
  });
});

describe('a refused transfer writes nothing', () => {
  it('a receiving item that counts in another unit — 422, naming both', async () => {
    const name = nextName();
    const mine = await stock({ name });
    const theirs = await stock({ name, branchId: branchBId, unit: 'علبة', openingQty: 1 });

    const res = await transfer({ lines: [{ consumableId: mine.id, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(message(res)).toContain('«قطعة»');
    expect(message(res)).toContain('«علبة»');
    await untouched(mine, 1);
    await untouched(theirs, 1);
  });

  it('a receiving item that is retired — 422', async () => {
    const name = nextName();
    const mine = await stock({ name });
    const theirs = await stock({ name, branchId: branchBId, openingQty: 1 });
    expect(
      (await api.patch(`/consumables/${theirs.id}`, { active: false, version: theirs.version }))
        .status,
    ).toBe(200);

    const res = await transfer({ lines: [{ consumableId: mine.id, qty: 1 }] });
    expect(res.status).toBe(422);
    await untouched(mine, 1);
    await untouched(theirs, 1);
  });

  it('more than the shelf holds — 422, and the line before it is not moved nor its item made', async () => {
    const fine = await stock();
    const short = await stock({ openingQty: 2 });

    const res = await transfer({
      lines: [
        { consumableId: fine.id, qty: 3 },
        { consumableId: short.id, qty: 3 },
      ],
    });
    expect(res.status).toBe(422);
    expect(message(res)).toContain(short.code);
    await untouched(fine, 1);
    await untouched(short, 1);
    // The item the first line would have made in the other store was made in the same
    // transaction: gone with it.
    expect(await storeItems(branchBId, fine.name)).toHaveLength(0);
  });

  it('items of two stores — 422', async () => {
    const inA = await stock();
    const inB = await stock({ branchId: branchBId });
    const res = await transfer({
      toBranchId: branchBId,
      lines: [
        { consumableId: inA.id, qty: 1 },
        { consumableId: inB.id, qty: 1 },
      ],
    });
    expect(res.status).toBe(422);
    await untouched(inA, 1);
    await untouched(inB, 1);
  });

  it('a transfer to the store the items are already in — 422', async () => {
    const item = await stock();
    const res = await transfer({
      toBranchId: branchAId,
      lines: [{ consumableId: item.id, qty: 1 }],
    });
    expect(res.status).toBe(422);
    await untouched(item, 1);
  });

  it('a branch the caller’s itAsset.assign does not reach — 403', async () => {
    const mine = await stock();
    const res = await transfer({ lines: [{ consumableId: mine.id, qty: 1 }] }, keeperAToken);
    expect(res.status).toBe(403);
    await untouched(mine, 1);
    expect(await storeItems(branchBId, mine.name)).toHaveLength(0);
  });

  it('an item the caller cannot see — 404, and nothing written in either store', async () => {
    // There, in branch B — and the caller's command bar narrowed to branch A: not theirs to read,
    // though their organization-wide grant would reach A as the target.
    const inB = await stock({ branchId: branchBId });
    const res = await request(app)
      .post('/api/v1/it/consumables/transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-active-branch', branchAId)
      .send({ toBranchId: branchAId, lines: [{ consumableId: inB.id, qty: 1 }] });
    expect(res.status).toBe(404);
    await untouched(inB, 1);
    expect(await storeItems(branchAId, inB.name)).toHaveLength(0);
  });

  it('an item that is nowhere at all — 404', async () => {
    const res = await transfer({
      lines: [{ consumableId: '6563a1b2c3d4e5f6a7b8c9d0', qty: 1 }],
    });
    expect(res.status).toBe(404);
  });

  it('an upper-case copy of the store the items are in is that store — 422', async () => {
    const item = await stock();
    const res = await transfer({
      toBranchId: branchAId.toUpperCase(),
      lines: [{ consumableId: item.id, qty: 1 }],
    });
    expect(res.status).toBe(422);
    await untouched(item, 1);
  });

  it('an item named twice — the body is unreadable, 400', async () => {
    const item = await stock();
    const res = await transfer({
      lines: [
        { consumableId: item.id, qty: 1 },
        { consumableId: item.id, qty: 1 },
      ],
    });
    expect(res.status).toBe(400);
    await untouched(item, 1);
  });
});
