// The IT home dashboard (design §11) over real HTTP with real RBAC — «عايزك تعمل فى الـ /it
// الرئيسية.. Dashboard بدل اللى موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر
// بـالفئة.. من خلال Drop Down بـ Multiselection».
//
// What a mocked spec cannot see: the counts by status out of the register itself; the categories
// (several) and the branch, and which section each one narrows; a branch-scoped reader counting
// their branch alone; each «يحتاج متابعة» row — the leavers judged on HR's own answer, the papers
// awaiting their signed copy, the overdue returns, the warranties ending inside the warn window —
// agreeing with the list its «عرض» opens; «آخر الحركات» newest first, eight at most, labelled; the
// two new list filters; and the grant and the query refused at the edge.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItDashboardActivityDto,
  type ItDashboardAssetsDto,
  type ItMaintenanceOrderDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { ItAssetAssignmentModel } from '../../src/modules/it/assets/assignment.model';
import { ItCustodyReceiptModel } from '../../src/modules/it/assets/receipt.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const DAY = 86_400_000;
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchAToken: string; // itAsset.view at BRANCH scope, placed in branch A — nothing else
let outsiderToken: string; // no IT grant at all
let branchAId: string;
let branchBId: string;
let desktops: string;
let screens: string;

// Planted in HR, so the leaver rule is judged on HR's own answer. The leaver is employed when
// handed their devices — custody is never handed to a leaver — and leaves afterwards.
const HOLDER = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

/**
 * The register this file counts, by the name each asset is registered under:
 *
 *   branch A — D1 in stock (warranty ended yesterday) · D2 handed to the holder 10 days ago, due
 *              back 2 days ago, its paper signed · D3 and D5 handed to the leaver, papers unsigned
 *              · S1 in stock (warranty ends in 10 days) · S2 disposed (warranty ends in 10 days)
 *              · S3 under maintenance
 *   branch B — D4 handed to the holder before receipts (no paper) · S4 in stock (warranty ends in
 *              60 days)
 */
const asset: Record<string, ItAssetDto> = {};
const idOf = (key: string): string => asset[key]?.id ?? '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-dashboard-test-${Date.now()}`;
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
const totalItems = (res: request.Response): number =>
  (res.body as { meta: { totalItems: number } }).meta.totalItems;

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

const get = (path: string, query: Record<string, string> = {}, token = adminToken) =>
  request(app).get(`/api/v1/it${path}`).query(query).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
  request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body);

const dashboard = async (
  query: Record<string, string> = {},
  token = adminToken,
): Promise<ItDashboardAssetsDto> => {
  const res = await get('/dashboard/assets', query, token);
  expect(res.status).toBe(200);
  return data<ItDashboardAssetsDto>(res);
};
const activity = async (
  query: Record<string, string> = {},
  token = adminToken,
): Promise<ItDashboardActivityDto['items']> => {
  const res = await get('/dashboard/activity', query, token);
  expect(res.status).toBe(200);
  return data<ItDashboardActivityDto>(res).items;
};

const counts = (inStock: number, assigned: number, underMaintenance: number, disposed: number) => ({
  inStock,
  assigned,
  underMaintenance,
  disposed,
  total: inStock + assigned + underMaintenance + disposed,
});

const warranty = (endsInDays: number) => {
  const end = new Date(Date.now() + endsInDays * DAY);
  return { start: new Date(end.getTime() - 365 * DAY).toISOString(), end: end.toISOString() };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('dash-admin@ecms.local');
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
  adminToken = await login('dash-admin@ecms.local');

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

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Dashboard viewer', ar: 'مطالع اللوحة' }, permissionKeys: ['itAsset.view'] },
    adminId,
  );
  const viewerId = await mkUser('dash-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  branchAToken = await login('dash-viewer@ecms.local');

  const outsiderRole = await rbacService.createRole(
    { name: { en: 'IT outsider', ar: 'بلا صلاحية' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const outsiderId = await mkUser('dash-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(outsiderRole._id), 'organization');
  outsiderToken = await login('dash-outsider@ecms.local');

  await plantEmployee(HOLDER, '0101002', 'وليد صفوت جلال', 'active');
  await plantEmployee(LEAVER, '0100001', 'شريف ممدوح فاروق', 'active');

  const category = async (ar: string, en: string): Promise<string> => {
    const res = await post('/catalog-items', { kind: 'assetCategory', name: { ar, en } });
    expect(res.status).toBe(201);
    return data<ItCatalogItemDto>(res).id;
  };
  desktops = await category('كمبيوتر مكتبي', 'Desktops');
  screens = await category('شاشة', 'Screens');

  // Every registration first, then every movement — so «آخر الحركات» below knows its order.
  const register: [string, string, string, string, Record<string, unknown>][] = [
    ['D1', 'Dell OptiPlex 7070', desktops, branchAId, { warranty: warranty(-1) }],
    ['D2', 'Lenovo ThinkCentre neo 50a 24', desktops, branchAId, {}],
    ['D3', 'HP ProDesk 400', desktops, branchAId, {}],
    ['D4', 'Dell OptiPlex 3080', desktops, branchBId, {}],
    ['D5', 'HP EliteDesk 800', desktops, branchAId, {}],
    ['S1', 'شاشة Dell E2423H', screens, branchAId, { warranty: warranty(10) }],
    ['S2', 'شاشة HP P22', screens, branchAId, { warranty: warranty(10) }],
    ['S3', 'شاشة Samsung S24', screens, branchAId, {}],
    ['S4', 'شاشة Lenovo L24', screens, branchBId, { warranty: warranty(60) }],
  ];
  for (const [key, name, categoryId, branchId, extra] of register) {
    const res = await post('/assets', { name, categoryId, branchId, ...extra });
    expect(res.status).toBe(201);
    asset[key] = data<ItAssetDto>(res);
  }
  const assign = async (key: string, body: Record<string, unknown>): Promise<void> => {
    const res = await post(`/assets/${idOf(key)}/assign`, body);
    expect(res.status).toBe(200);
  };

  await assign('D2', {
    employeeId: String(HOLDER),
    assignedAt: new Date(Date.now() - 10 * DAY).toISOString(),
    expectedReturnAt: new Date(Date.now() - 2 * DAY).toISOString(),
  });
  await assign('D3', { employeeId: String(LEAVER) });
  await assign('D4', { employeeId: String(HOLDER) });
  await assign('D5', { employeeId: String(LEAVER) });

  // D2's paper is signed and filed; D4's interval is one from before receipts — it has no paper.
  const d2 = await ItAssetAssignmentModel.findOne({ assetId: idOf('D2'), returnedAt: null }).exec();
  expect(d2?.receiptId).toBeInstanceOf(Types.ObjectId);
  await ItCustodyReceiptModel.updateOne(
    { _id: d2?.receiptId },
    {
      $set: {
        signedCopy: {
          fileId: new Types.ObjectId(),
          fileName: 'signed.pdf',
          mime: 'application/pdf',
          size: 1024,
          uploadedAt: new Date(),
        },
      },
    },
  ).exec();
  await ItAssetAssignmentModel.updateOne(
    { assetId: idOf('D4'), returnedAt: null },
    { $set: { receiptId: null } },
  ).exec();

  const disposed = await post(`/assets/${idOf('S2')}/dispose`, {
    method: 'scrapped',
    reason: 'شاشة مكسورة',
  });
  expect(disposed.status).toBe(200);

  const order = await post('/maintenance-orders', { assetId: idOf('S3') });
  expect(order.status).toBe(201);
  expect(
    (await post(`/maintenance-orders/${data<ItMaintenanceOrderDto>(order).id}/start`)).status,
  ).toBe(200);

  // The leaver leaves — after the hand-over, as people do.
  await EmployeeModel.collection.updateOne({ _id: LEAVER }, { $set: { status: 'exited' } });
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the counts', () => {
  it('counts every asset by status — the total is all four, the disposed included', async () => {
    const answer = await dashboard();
    expect(answer.totals).toEqual(counts(3, 4, 1, 1));
    expect(answer.byCategory).toEqual([
      { categoryId: desktops, ...counts(1, 4, 0, 0) },
      { categoryId: screens, ...counts(2, 0, 1, 1) },
    ]);
    expect(answer.byBranch).toEqual([
      { branchId: branchAId, ...counts(2, 3, 1, 1) },
      { branchId: branchBId, ...counts(1, 1, 0, 0) },
    ]);
  });

  it('narrows the totals by the branch — and by category under that branch, while by branch keeps both', async () => {
    const answer = await dashboard({ branchId: branchAId });
    expect(answer.totals).toEqual(counts(2, 3, 1, 1));
    expect(answer.byCategory).toEqual([
      { categoryId: desktops, ...counts(1, 3, 0, 0) },
      { categoryId: screens, ...counts(1, 0, 1, 1) },
    ]);
    // The branch filter does not apply here: a click picks another branch from the same list.
    expect(answer.byBranch.map((row) => row.branchId)).toEqual([branchAId, branchBId]);
  });

  it('narrows the totals by the categories — and by branch under them, while by category keeps both', async () => {
    const answer = await dashboard({ categoryId: screens });
    expect(answer.totals).toEqual(counts(2, 0, 1, 1));
    expect(answer.byBranch).toEqual([
      { branchId: branchAId, ...counts(1, 0, 1, 1) },
      { branchId: branchBId, ...counts(1, 0, 0, 0) },
    ]);
    // The categories not chosen still show, so a click adds one beside the chosen.
    expect(answer.byCategory.map((row) => row.categoryId)).toEqual([desktops, screens]);
  });

  it('takes several categories — an asset in ANY of them — and both filters together', async () => {
    expect((await dashboard({ categoryId: `${desktops},${screens}` })).totals).toEqual(
      counts(3, 4, 1, 1),
    );
    const both = await dashboard({ categoryId: screens, branchId: branchAId });
    expect(both.totals).toEqual(counts(1, 0, 1, 1));
    expect(both.byCategory).toEqual([
      { categoryId: desktops, ...counts(1, 3, 0, 0) },
      { categoryId: screens, ...counts(1, 0, 1, 1) },
    ]);
    expect(both.byBranch).toEqual([
      { branchId: branchAId, ...counts(1, 0, 1, 1) },
      { branchId: branchBId, ...counts(1, 0, 0, 0) },
    ]);
  });

  it('counts only their branch for a branch-scoped reader — and nothing of another branch they ask for', async () => {
    const mine = await dashboard({}, branchAToken);
    expect(mine.totals).toEqual(counts(2, 3, 1, 1));
    expect(mine.byBranch.map((row) => row.branchId)).toEqual([branchAId]);
    expect(mine.attention).toMatchObject({
      heldByLeavers: 2,
      receiptsAwaitingSignature: 2,
      overdueReturns: 1,
      warrantyEndingSoon: 1,
    });

    const elsewhere = await dashboard({ branchId: branchBId }, branchAToken);
    expect(elsewhere.totals).toEqual(counts(0, 0, 0, 0));
    expect(elsewhere.byCategory).toEqual([]);
    expect(elsewhere.attention).toMatchObject({
      heldByLeavers: 0,
      receiptsAwaitingSignature: 0,
      overdueReturns: 0,
      warrantyEndingSoon: 0,
    });
  });
});

describe('«يحتاج متابعة»', () => {
  it('counts each row: the leavers’ devices, the unsigned papers, the overdue returns, the warranties ending', async () => {
    expect((await dashboard()).attention).toEqual({
      // D3 and D5: HR shows their holder as gone, and they are still out.
      heldByLeavers: 2,
      // D3 and D5 again — D2's paper is filed, D4 has none to sign.
      receiptsAwaitingSignature: 2,
      // D2: due back two days ago.
      overdueReturns: 1,
      // S1: S2 is disposed, D1's warranty has ended, S4's ends after the window.
      warrantyEndingSoon: 1,
      warrantyWindowDays: 30,
    });
  });

  it('counts each row under both filters', async () => {
    expect((await dashboard({ categoryId: screens })).attention).toMatchObject({
      heldByLeavers: 0,
      receiptsAwaitingSignature: 0,
      overdueReturns: 0,
      warrantyEndingSoon: 1,
    });
    expect(
      (await dashboard({ categoryId: desktops, branchId: branchAId })).attention,
    ).toMatchObject({
      heldByLeavers: 2,
      receiptsAwaitingSignature: 2,
      overdueReturns: 1,
      warrantyEndingSoon: 0,
    });
    expect((await dashboard({ branchId: branchBId })).attention).toMatchObject({
      heldByLeavers: 0,
      receiptsAwaitingSignature: 0,
      overdueReturns: 0,
      warrantyEndingSoon: 0,
    });
  });

  it('agrees with the list each «عرض» opens, filters carried', async () => {
    for (const filters of [
      {},
      { categoryId: desktops, branchId: branchAId },
      { branchId: branchBId },
    ]) {
      const { attention } = await dashboard(filters);
      const leavers = await get('/assignments', { open: 'true', holderExited: 'true', ...filters });
      const unsigned = await get('/assignments', { open: 'true', receipt: 'unsigned', ...filters });
      const overdue = await get('/assignments', { overdue: 'true', ...filters });
      const ending = await get('/assets', {
        warrantyEndsWithinDays: String(attention.warrantyWindowDays),
        ...filters,
      });
      expect(totalItems(leavers)).toBe(attention.heldByLeavers);
      expect(totalItems(unsigned)).toBe(attention.receiptsAwaitingSignature);
      expect(totalItems(overdue)).toBe(attention.overdueReturns);
      expect(totalItems(ending)).toBe(attention.warrantyEndingSoon);
    }
  });
});

describe('the two new list filters', () => {
  const heldAssets = async (query: Record<string, string>, token = adminToken) => {
    const res = await get('/assignments', { pageSize: '100', ...query }, token);
    expect(res.status).toBe(200);
    return data<ItAssetAssignmentDto[]>(res)
      .map((row) => row.assetId)
      .sort();
  };
  const listed = async (query: Record<string, string>) => {
    const res = await get('/assets', { pageSize: '100', ...query });
    expect(res.status).toBe(200);
    return data<ItAssetDto[]>(res)
      .map((row) => row.id)
      .sort();
  };
  const ids = (...keys: string[]) => keys.map(idOf).sort();

  it('/it/assignments «حالة المستلِم»: the leavers’ intervals, or every other one', async () => {
    expect(await heldAssets({ open: 'true', holderExited: 'true' })).toEqual(ids('D3', 'D5'));
    expect(await heldAssets({ open: 'true', holderExited: 'false' })).toEqual(ids('D2', 'D4'));
    // ANDed with the others: the category, the branch — and a branch-scoped reader's own scope.
    expect(await heldAssets({ holderExited: 'true', categoryId: screens, open: 'true' })).toEqual(
      [],
    );
    expect(await heldAssets({ holderExited: 'false', branchId: branchBId })).toEqual(ids('D4'));
    expect(await heldAssets({ holderExited: 'false', open: 'true' }, branchAToken)).toEqual(
      ids('D2'),
    );
    expect((await get('/assignments', { holderExited: 'maybe' })).status).toBe(400);
  });

  it('/it/assets «الضمان»: ending within the days asked — none ended, none disposed', async () => {
    expect(await listed({ warrantyEndsWithinDays: '30' })).toEqual(ids('S1'));
    expect(await listed({ warrantyEndsWithinDays: '90' })).toEqual(ids('S1', 'S4'));
    expect(await listed({ warrantyEndsWithinDays: '90', branchId: branchAId })).toEqual(ids('S1'));
    expect(await listed({ warrantyEndsWithinDays: '90', categoryId: desktops })).toEqual([]);
    for (const days of ['0', '366', 'soon']) {
      expect((await get('/assets', { warrantyEndsWithinDays: days })).status).toBe(400);
    }
  });
});

describe('«آخر الحركات»', () => {
  const codeOf = (key: string): string => asset[key]?.assetCode ?? '';
  const isNewestFirst = (items: { at: string }[]): boolean =>
    items.every((item, n) => n === 0 || (items[n - 1]?.at ?? '') >= item.at);

  it('shows the branch-scoped reader their branch’s movements alone', async () => {
    const items = await activity({}, branchAToken);
    expect(items).toHaveLength(8);
    expect(isNewestFirst(items)).toBe(true);
    const branchB = [codeOf('D4'), codeOf('S4')];
    expect(items.some((item) => branchB.includes(item.assetCode))).toBe(false);
  });

  it('shows the newest eight first, a move between branches labelled with both and the person', async () => {
    // D4 moves to branch A with its holder — the newest thing that happened.
    const moved = await post(`/assets/${idOf('D4')}/transfer`, { toBranchId: branchAId });
    expect(moved.status).toBe(200);

    const items = await activity();
    expect(items).toHaveLength(8);
    expect(isNewestFirst(items)).toBe(true);
    expect(items[0]).toMatchObject({
      kind: 'transferred',
      assetId: idOf('D4'),
      assetCode: codeOf('D4'),
      assetName: 'Dell OptiPlex 3080',
      branchId: branchAId,
      employeeId: String(HOLDER),
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      fromBranchId: branchBId,
      toBranchId: branchAId,
    });
    // The six movements, then the two newest registrations; D2's hand-over ten days ago is past
    // the cut, and so are the seven older registrations.
    const kinds = items.map((item) => item.kind).sort();
    expect(kinds).toEqual(
      [
        'assigned',
        'assigned',
        'assigned',
        'disposed',
        'maintenanceStarted',
        'registered',
        'registered',
        'transferred',
      ].sort(),
    );
    const leaver = items.find(
      (item) => item.kind === 'assigned' && item.assetCode === codeOf('D5'),
    );
    expect(leaver).toMatchObject({ employeeCode: '0100001', employeeName: 'شريف ممدوح فاروق' });
    const registered = items.find((item) => item.kind === 'registered');
    expect(registered).toMatchObject({
      id: idOf('S4'),
      assetId: idOf('S4'),
      branchId: branchBId,
      employeeId: null,
      fromBranchId: null,
      toBranchId: null,
    });

    // It is in branch A now, and so is its move: the branch-scoped reader sees it.
    expect((await activity({}, branchAToken))[0]?.assetCode).toBe(codeOf('D4'));
  });

  it('follows the categories and the branch', async () => {
    const shown = await activity({ categoryId: screens });
    const screenCodes = ['S1', 'S2', 'S3', 'S4'].map(codeOf);
    expect(shown.every((item) => screenCodes.includes(item.assetCode))).toBe(true);
    expect(shown.map((item) => item.kind).sort()).toEqual(
      [
        'disposed',
        'maintenanceStarted',
        'registered',
        'registered',
        'registered',
        'registered',
      ].sort(),
    );
    const inB = await activity({ branchId: branchBId });
    expect(inB.map((item) => [item.kind, item.assetCode])).toEqual([['registered', codeOf('S4')]]);
  });
});

describe('the edge', () => {
  it('refuses a reader without itAsset.view', async () => {
    expect((await get('/dashboard/assets', {}, outsiderToken)).status).toBe(403);
    expect((await get('/dashboard/activity', {}, outsiderToken)).status).toBe(403);
  });

  it('refuses a query it cannot read', async () => {
    for (const path of ['/dashboard/assets', '/dashboard/activity']) {
      expect((await get(path, { categoryId: `${desktops},nope` })).status).toBe(400);
      expect((await get(path, { branchId: 'nope' })).status).toBe(400);
      expect((await get(path, { status: 'inStock' })).status).toBe(400);
    }
  });
});
