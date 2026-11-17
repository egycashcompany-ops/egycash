// «نقل إلى فرع» over real HTTP with real RBAC — «هنا /it/assets … عايز إمكانية نقل أصل … إلى فرع
// تاني» (2026-11-11): several at once («كذا حاجة مرة واحدة»), recorded at once («فوراً»), no paper
// («لا، السجل كفاية»), and a held asset moving WITH its custody («ينتقل مع عهدته»).
//
// What a mocked spec cannot see: ONE transaction for the whole list — a refused or conflicting
// asset leaves every other one where it was — the asset in stock changing branch and losing its
// place in the branch it left, the held one through custody's own transfer (the open interval
// closed, the next open in the new branch for the same holder on the same receipt, one
// `transferred` entry), the audit rows and the platform event after the commit, and the scope:
// an asset the caller cannot see, and a branch their grant does not reach.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  ItEvents,
  SettingKeys,
  platformPermissions,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItAssetHistoryEntryDto,
  type ItAssetsBranchMoveResultDto,
  type ItCatalogItemDto,
  type ItMoveTargetsDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { itAssetRepository } from '../../src/modules/it/assets/asset.repository';
import { StaleDocumentError } from '../../src/shared/errors';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let keeperAToken: string; // itAsset.view + itAsset.assign at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
let branchCId: string;
let categoryId: string;
const transferred: { assetId: string; payload: Record<string, unknown> }[] = [];

// Unknown to HR, as the custody suite's holders are: the directory answers nothing, and custody
// is handed over all the same.
const EMPLOYEE_A = '000000000000000000000a11';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-move-branch-test-${Date.now()}`;
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

// In-process events fan out fire-and-forget — poll, never assert immediately (the fleet lesson).
const waitFor = async (predicate: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
};

let assets = 0;
const mkAsset = async (overrides: Record<string, unknown> = {}): Promise<ItAssetDto> => {
  assets += 1;
  const res = await api.post('/assets', {
    name: `Lenovo ThinkCentre ${String(assets)}`,
    categoryId,
    branchId: branchAId,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

const assetOf = async (id: string): Promise<ItAssetDto> =>
  data<ItAssetDto>(await api.get(`/assets/${id}`));

const historyOf = async (id: string): Promise<ItAssetHistoryEntryDto[]> =>
  data<ItAssetHistoryEntryDto[]>(await api.get(`/assets/${id}/history`));

const intervalsOf = async (id: string): Promise<ItAssetAssignmentDto[]> =>
  data<ItAssetAssignmentDto[]>(await api.get(`/assets/${id}/assignments`));

const transferAudits = (id: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'it',
    'entityRef.entityType': 'asset',
    'entityRef.entityId': id,
    action: 'transfer',
  })
    .lean()
    .exec();

const move = (body: Record<string, unknown>, token = adminToken) =>
  api.post('/assets/move-branch', body, token);

/** Hand an asset to EMPLOYEE_A on a receipt, as the custody screen does. */
const handOver = async (
  id: string,
  facts: Record<string, unknown> = {},
): Promise<ItAssetAssignmentDto> => {
  expect(
    (await api.post(`/assets/${id}/assign`, { employeeId: EMPLOYEE_A, ...facts })).status,
  ).toBe(200);
  const open = (await intervalsOf(id)).filter((row) => row.returnedAt === null);
  expect(open).toHaveLength(1);
  return open[0] as ItAssetAssignmentDto;
};

/** Nothing about the asset changed: its branch, its place, and no `transferred` entry. */
const untouched = async (before: ItAssetDto): Promise<void> => {
  const now = await assetOf(before.id);
  expect(now.branchId).toBe(before.branchId);
  expect(now.location).toBe(before.location);
  expect(now.version).toBe(before.version);
  expect((await historyOf(before.id)).some((entry) => entry.type === 'transferred')).toBe(false);
  expect(await transferAudits(before.id)).toHaveLength(0);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  subscribe(ItEvents.AssetTransferred, 'spec.itAssetMovedBranch', (envelope) => {
    const payload = envelope.payload as Record<string, unknown>;
    transferred.push({ assetId: String(payload.assetId), payload });
  });

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  adminId = await mkUser('move-admin@ecms.local');
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
  adminToken = await login('move-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('70', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('71', 'فرع ب', 'Branch B');
  branchCId = await mkBranch('72', 'فرع ج', 'Branch C');

  const keeperRole = await rbacService.createRole(
    {
      name: { en: 'Branch IT keeper', ar: 'أمين أصول فرع' },
      permissionKeys: ['itAsset.view', 'itAsset.assign'],
    },
    adminId,
  );
  const keeperId = await mkUser('move-keeper@ecms.local', branchAId);
  await rbacService.ensureAssignment(keeperId, String(keeperRole._id), 'branch');
  keeperAToken = await login('move-keeper@ecms.local');

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

describe('an asset in stock', () => {
  it('changes branch, leaves its place in the branch it left, and the history and the trail say so', async () => {
    const asset = await mkAsset({ location: 'مخزن IT' });

    const res = await move({
      assetIds: [asset.id],
      toBranchId: branchBId,
      notes: 'نقل إلى فرع ب',
    });
    expect(res.status).toBe(200);
    expect(data<ItAssetsBranchMoveResultDto>(res)).toEqual({
      toBranchId: branchBId,
      moved: [
        {
          assetId: asset.id,
          assetCode: asset.assetCode,
          fromBranchId: branchAId,
          toBranchId: branchBId,
          holderEmployeeId: null,
        },
      ],
    });

    expect(await assetOf(asset.id)).toMatchObject({
      status: 'inStock',
      branchId: branchBId,
      location: null,
      currentAssignmentId: null,
    });
    // A branch-only transfer: the two branches and nobody — no employee keys at all.
    const entries = (await historyOf(asset.id)).filter((entry) => entry.type === 'transferred');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toEqual({ fromBranchId: branchAId, toBranchId: branchBId });
    expect(entries[0]?.notes).toBe('نقل إلى فرع ب');
    // No paper: nobody was handed anything.
    expect(await intervalsOf(asset.id)).toHaveLength(0);

    const audits = await transferAudits(asset.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes).toEqual([
      { field: 'branchId', old: branchAId, new: branchBId },
      { field: 'location', old: 'مخزن IT', new: null },
    ]);

    await waitFor(() => transferred.some((event) => event.assetId === asset.id));
    expect(transferred.find((event) => event.assetId === asset.id)?.payload).toEqual({
      assetId: asset.id,
      assetCode: asset.assetCode,
      fromEmployeeId: null,
      toEmployeeId: null,
      fromBranchId: branchAId,
      toBranchId: branchBId,
    });
  });
});

describe('a held asset — «ينتقل مع عهدته»', () => {
  it('moves with its custody: the interval closed, the next open in the new branch, same holder and receipt', async () => {
    const asset = await mkAsset({ location: 'مكتب المدير' });
    const before = await handOver(asset.id, {
      expectedReturnAt: '2027-01-31T00:00:00.000Z',
      conditionOnIssue: 'بحالة جيدة',
      notes: 'مع الحقيبة والشاحن',
    });
    expect(before.receiptId).not.toBeNull();

    const res = await move({ assetIds: [asset.id], toBranchId: branchBId, notes: 'نقل مع العهدة' });
    expect(res.status).toBe(200);
    expect(data<ItAssetsBranchMoveResultDto>(res).moved).toEqual([
      {
        assetId: asset.id,
        assetCode: asset.assetCode,
        fromBranchId: branchAId,
        toBranchId: branchBId,
        holderEmployeeId: EMPLOYEE_A,
      },
    ]);

    const intervals = await intervalsOf(asset.id);
    expect(intervals).toHaveLength(2);
    const closed = intervals.find((row) => row.returnedAt !== null);
    const open = intervals.filter((row) => row.returnedAt === null);
    expect(closed).toMatchObject({ id: before.id, branchId: branchAId });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      assignedToEmployeeId: EMPLOYEE_A,
      branchId: branchBId,
      receiptId: before.receiptId,
      // The custody they signed for, as it was — when it is due back above all. The move's notes
      // are the move's, not the interval's.
      expectedReturnAt: '2027-01-31T00:00:00.000Z',
      conditionOnIssue: 'بحالة جيدة',
      notes: 'مع الحقيبة والشاحن',
    });

    expect(await assetOf(asset.id)).toMatchObject({
      status: 'assigned',
      branchId: branchBId,
      location: null,
      currentAssignmentId: open[0]?.id,
    });

    // ONE `transferred` entry — never return + assign — naming the holder on both sides.
    const history = await historyOf(asset.id);
    expect(history.filter((entry) => entry.type === 'returned')).toHaveLength(0);
    const entries = history.filter((entry) => entry.type === 'transferred');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      fromEmployeeId: EMPLOYEE_A,
      toEmployeeId: EMPLOYEE_A,
      fromBranchId: branchAId,
      toBranchId: branchBId,
      assignmentId: open[0]?.id,
      receiptId: before.receiptId,
    });
    expect(entries[0]?.notes).toBe('نقل مع العهدة');

    const audits = await transferAudits(asset.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.changes).toEqual([
      { field: 'holder', old: EMPLOYEE_A, new: EMPLOYEE_A },
      { field: 'branchId', old: branchAId, new: branchBId },
      { field: 'location', old: 'مكتب المدير', new: null },
    ]);

    await waitFor(() => transferred.some((event) => event.assetId === asset.id));
    expect(transferred.find((event) => event.assetId === asset.id)?.payload).toMatchObject({
      fromEmployeeId: EMPLOYEE_A,
      toEmployeeId: EMPLOYEE_A,
      fromBranchId: branchAId,
      toBranchId: branchBId,
    });
  });
});

describe('several at once — «كذا حاجة مرة واحدة»', () => {
  it('moves one in stock and one held to ONE branch in one step, answered in the order named', async () => {
    const shelved = await mkAsset();
    const held = await mkAsset();
    await handOver(held.id);

    const res = await move({ assetIds: [held.id, shelved.id], toBranchId: branchCId });
    expect(res.status).toBe(200);
    const result = data<ItAssetsBranchMoveResultDto>(res);
    expect(result.moved.map((entry) => [entry.assetId, entry.holderEmployeeId])).toEqual([
      [held.id, EMPLOYEE_A],
      [shelved.id, null],
    ]);
    expect((await assetOf(held.id)).branchId).toBe(branchCId);
    expect((await assetOf(shelved.id)).branchId).toBe(branchCId);
  });

  it('refuses an asset named twice — the body is unreadable, 400', async () => {
    const asset = await mkAsset();
    const res = await move({ assetIds: [asset.id, asset.id], toBranchId: branchBId });
    expect(res.status).toBe(400);
    await untouched(asset);
  });
});

describe('a refused move moves nothing', () => {
  it('a disposed asset — 422, naming it, and the other asset stays where it was', async () => {
    const fine = await mkAsset({ location: 'مخزن IT' });
    const gone = await mkAsset();
    expect(
      (await api.post(`/assets/${gone.id}/dispose`, { method: 'scrapped', reason: 'تالف' })).status,
    ).toBe(200);

    const res = await move({ assetIds: [fine.id, gone.id], toBranchId: branchBId });
    expect(res.status).toBe(422);
    expect(message(res)).toContain(gone.assetCode);
    await untouched(fine);
  });

  it('one under an open maintenance order — 409, custody’s own answer', async () => {
    const fine = await mkAsset();
    const repairing = await mkAsset();
    expect((await api.post('/maintenance-orders', { assetId: repairing.id })).status).toBe(201);

    // Said on the asset before the move is asked — its status alone does not say it: an open
    // order leaves it in stock. On its own record, and on the register's page.
    expect(await assetOf(repairing.id)).toMatchObject({
      status: 'inStock',
      hasActiveMaintenance: true,
    });
    expect((await assetOf(fine.id)).hasActiveMaintenance).toBe(false);
    const page = data<ItAssetDto[]>(await api.get(`/assets?branchId=${branchAId}&pageSize=100`));
    const row = (id: string) => page.find((entry) => entry.id === id);
    expect(row(repairing.id)?.hasActiveMaintenance).toBe(true);
    expect(row(fine.id)?.hasActiveMaintenance).toBe(false);

    const res = await move({ assetIds: [fine.id, repairing.id], toBranchId: branchBId });
    expect(res.status).toBe(409);
    expect(message(res)).toContain(repairing.assetCode);
    await untouched(fine);
  });

  it('a held asset dated before its custody began — 422, naming every one, and nothing moves', async () => {
    const shelved = await mkAsset({ location: 'مخزن IT' });
    const first = await mkAsset();
    const second = await mkAsset();
    await handOver(first.id);
    await handOver(second.id);
    const before = [await assetOf(shelved.id), await assetOf(first.id), await assetOf(second.id)];

    // Handed over today; the move says it happened years ago.
    const res = await move({
      assetIds: [shelved.id, first.id, second.id],
      toBranchId: branchBId,
      at: '2020-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(422);
    // ONE refusal for the batch, naming each — not the first one the transfer happened to reach.
    expect(message(res)).toContain(first.assetCode);
    expect(message(res)).toContain(second.assetCode);
    for (const asset of before) await untouched(asset);
    for (const asset of [first, second]) {
      const intervals = await intervalsOf(asset.id);
      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.returnedAt).toBeNull();
    }
  });

  it('an upper-case copy of the branch they are in is that branch — 422, already there', async () => {
    const shelved = await mkAsset({ location: 'مخزن IT' });
    const held = await mkAsset();
    await handOver(held.id);
    const heldBefore = await assetOf(held.id);

    const res = await move({
      assetIds: [shelved.id, held.id],
      toBranchId: branchAId.toUpperCase(),
    });
    expect(res.status).toBe(422);
    expect(message(res)).toContain(shelved.assetCode);
    expect(message(res)).toContain(held.assetCode);
    await untouched(shelved);
    await untouched(heldBefore);
  });

  it('one already in the branch chosen — 422', async () => {
    const fine = await mkAsset();
    const there = await mkAsset({ branchId: branchBId });

    const res = await move({ assetIds: [fine.id, there.id], toBranchId: branchBId });
    expect(res.status).toBe(422);
    expect(message(res)).toContain(there.assetCode);
    await untouched(fine);
  });

  it('a branch the caller’s itAsset.assign does not reach — 403', async () => {
    const mine = await mkAsset();
    const res = await move({ assetIds: [mine.id], toBranchId: branchBId }, keeperAToken);
    expect(res.status).toBe(403);
    await untouched(mine);
  });

  it('a branch that is not there — 400', async () => {
    const asset = await mkAsset();
    const res = await move({ assetIds: [asset.id], toBranchId: '6563a1b2c3d4e5f6a7b8c9d0' });
    expect(res.status).toBe(400);
    await untouched(asset);
  });

  it('an asset outside the caller’s scope — the whole request’s 404, and the one in scope stays', async () => {
    const inA = await mkAsset();
    const inB = await mkAsset({ branchId: branchBId });
    // The command bar narrowed to branch A: the caller sees A's assets alone, and may still send
    // them to any branch their organization-wide grant reaches.
    const res = await request(app)
      .post('/api/v1/it/assets/move-branch')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-active-branch', branchAId)
      .send({ assetIds: [inA.id, inB.id], toBranchId: branchCId });
    expect(res.status).toBe(404);
    await untouched(inA);
    await untouched(inB);
  });

  it('without the custody grant at all — 403', async () => {
    const viewerRole = await rbacService.createRole(
      { name: { en: 'Asset reader', ar: 'مطالع أصول' }, permissionKeys: ['itAsset.view'] },
      adminId,
    );
    const viewerId = await mkUser('move-viewer@ecms.local');
    await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'organization');
    const viewer = await login('move-viewer@ecms.local');
    const asset = await mkAsset();
    expect((await move({ assetIds: [asset.id], toBranchId: branchBId }, viewer)).status).toBe(403);
    await untouched(asset);
  });

  it('a version conflict on any asset rolls the whole move back', async () => {
    const first = await mkAsset({ location: 'مخزن IT' });
    const second = await mkAsset();
    await handOver(second.id);
    const firstBefore = await assetOf(first.id);
    const secondBefore = await assetOf(second.id);

    // The second asset's write meets somebody else's save: its version no longer matches.
    const original = itAssetRepository.updateById.bind(itAssetRepository);
    let writes = 0;
    const spy = vi
      .spyOn(itAssetRepository, 'updateById')
      .mockImplementation(async (...args: Parameters<typeof original>) => {
        writes += 1;
        if (writes === 2) throw new StaleDocumentError();
        return original(...args);
      });
    try {
      const res = await move({ assetIds: [first.id, second.id], toBranchId: branchBId });
      expect(res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }

    // The first asset's write was in the same transaction: gone with it.
    await untouched(firstBefore);
    expect((await assetOf(second.id)).branchId).toBe(branchAId);
    expect((await assetOf(second.id)).version).toBe(secondBefore.version);
    const intervals = await intervalsOf(second.id);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.returnedAt).toBeNull();
    expect(transferred.some((event) => event.assetId === first.id)).toBe(false);
  });
});

describe('where a move may go — GET /assets/move-targets', () => {
  it('every active branch the custody grant reaches, as the branch options order them — nothing the move refuses', async () => {
    // A branch closed since it opened: still in the organisation, never somewhere to move to.
    const opened = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '73', name: { ar: 'فرع د', en: 'Branch D' } });
    expect(opened.status).toBe(201);
    const closedId = (opened.body as { data: { id: string } }).data.id;
    await BranchModel.updateOne({ _id: closedId }, { $set: { status: 'inactive' } }).exec();

    const targets = (token: string) => api.get('/assets/move-targets', token);

    // Organization-wide: every active branch — exactly the pickers' branch options, in their order.
    const options = await request(app)
      .get('/api/v1/platform/branches/options')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(options.status).toBe(200);
    const all = await targets(adminToken);
    expect(all.status).toBe(200);
    const { branchIds } = data<ItMoveTargetsDto>(all);
    expect(branchIds).toEqual(data<OrgUnitOptionDto[]>(options).map((branch) => branch.id));
    expect(branchIds.filter((id) => [branchAId, branchBId, branchCId].includes(id))).toEqual([
      branchAId,
      branchBId,
      branchCId,
    ]);
    expect(branchIds).not.toContain(closedId);
    // …and the move agrees: the closed branch is refused.
    const asset = await mkAsset();
    expect((await move({ assetIds: [asset.id], toBranchId: closedId })).status).toBe(400);
    await untouched(asset);

    // A branch-scoped keeper: their own branch alone — the move sends them 403 for any other.
    const mine = await targets(keeperAToken);
    expect(mine.status).toBe(200);
    expect(data<ItMoveTargetsDto>(mine)).toEqual({ branchIds: [branchAId] });
  });
});
