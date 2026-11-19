// A hand-over to somebody in ANOTHER branch, over real HTTP with real RBAC — «لما حد فى فرع بيسلم
// جهاز لحد فى فرع تاني مش بيعرف يشوف اسمه سواء فى الأصول أو المستهلكات .. أسمح إنه يعرف يسلم لحد
// فى فرع تاني» (owner, 2026-11-18), and his four answers: whoever holds a register's hand-over grant
// searches every branch, inside the hand-over boxes only; the device stays registered in the
// sender's branch; the sender opens the recipient's page and sees there only what their own reach
// holds; and a single asset's «نقل» goes only where «نقل إلى فرع» may.
//
// What a mocked spec cannot see: the HR directory answering the box unscoped and the register
// still scoped, side by side; the command bar's branch left out of the box; each hand-over written
// in the sender's branch for a person HR places in another; the person page opened by what the
// reader's own registers name — and only by those — and the branch limit as the router and the
// grants apply it.
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
  type ItConsumableDto,
  type ItConsumableIssueResultDto,
  type ItConsumableMovementDto,
  type ItMobileLineAssignResultDto,
  type ItMobileLineDto,
  type ItPersonDto,
  type ItRecipientDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
/** The view AND hand-over grants of the three registers, at BRANCH scope, placed in branch A. */
let keeperAToken: string;
/** The same role, placed in branch B. */
let keeperBToken: string;
/** The same role, ORGANIZATION-wide — asked with branch A chosen in the command bar. */
let orgKeeperToken: string;
/** The three registers' read grants alone, at BRANCH scope in A — no hand-over grant. */
let viewerAToken: string;
/** `itConsumable.view` + `.assign` alone, at BRANCH scope in A — neither custody register. */
let storeKeeperAToken: string;
let branchAId: string;
let branchBId: string;
let closedBranchId: string;
let categoryId: string;
let typeId: string;

// Every code under one prefix, so one search finds them all — whichever branch HR places them in.
const IN_A = new Types.ObjectId();
const B_ASSET = new Types.ObjectId();
const B_LINE = new Types.ObjectId();
const B_STORE = new Types.ObjectId();
const B_LEAVER = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-cross-branch-recipients-test-${Date.now()}`;
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

/** An HR employee placed in `branchId`, written as HR stores one. */
const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  branchId: string,
  status: 'active' | 'exited' = 'active',
): Promise<void> => {
  const branch = new Types.ObjectId(branchId);
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
    hiredAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const api = {
  get: (path: string, token = adminToken, activeBranch?: string) => {
    const req = request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`);
    return activeBranch === undefined ? req : req.set('X-Active-Branch', activeBranch);
  },
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
};

let serials = 0;
const device = async (): Promise<ItAssetDto> => {
  serials += 1;
  const res = await api.post('/assets', {
    name: `Dell Latitude ${String(serials)}`,
    categoryId,
    branchId: branchAId,
  });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

const recipients = (search: string, token: string, activeBranch?: string) =>
  api.get(`/people/recipients?search=${encodeURIComponent(search)}`, token, activeBranch);

const idsOf = (rows: { employeeId: string }[]): string[] => rows.map((row) => row.employeeId);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('recipients-admin@ecms.local');
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
  adminToken = await login('recipients-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('94', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('95', 'فرع ب', 'Branch B');
  closedBranchId = await mkBranch('96', 'فرع مغلق', 'Closed branch');
  await BranchModel.updateOne({ _id: closedBranchId }, { $set: { status: 'inactive' } }).exec();

  /** A role of `keys` assigned at `scope` to a new account placed in `branchId`; its token. */
  const holder = async (
    email: string,
    name: { en: string; ar: string },
    keys: string[],
    scope: 'branch' | 'organization',
    branchId: string | null,
  ): Promise<string> => {
    const role = await rbacService.createRole({ name, permissionKeys: keys }, adminId);
    const userId = await mkUser(email, branchId);
    await rbacService.ensureAssignment(userId, String(role._id), scope);
    return login(email);
  };
  const keeperKeys = [
    'itAsset.view',
    'itAsset.assign',
    'itMobileLine.view',
    'itMobileLine.assign',
    'itConsumable.view',
    'itConsumable.assign',
  ];
  keeperAToken = await holder(
    'recipients-keeper-a@ecms.local',
    { en: 'Keeper A', ar: 'أمين عهد أ' },
    keeperKeys,
    'branch',
    branchAId,
  );
  keeperBToken = await holder(
    'recipients-keeper-b@ecms.local',
    { en: 'Keeper B', ar: 'أمين عهد ب' },
    keeperKeys,
    'branch',
    branchBId,
  );
  orgKeeperToken = await holder(
    'recipients-keeper-org@ecms.local',
    { en: 'Keeper, organization', ar: 'أمين عهد عام' },
    keeperKeys,
    'organization',
    null,
  );
  viewerAToken = await holder(
    'recipients-viewer-a@ecms.local',
    { en: 'Viewer A', ar: 'مطالع أ' },
    ['itAsset.view', 'itMobileLine.view', 'itConsumable.view'],
    'branch',
    branchAId,
  );
  storeKeeperAToken = await holder(
    'recipients-store-a@ecms.local',
    { en: 'Store keeper A', ar: 'أمين مخزن أ' },
    ['itConsumable.view', 'itConsumable.assign'],
    'branch',
    branchAId,
  );

  await plantEmployee(IN_A, '0309001', 'وليد صفوت جلال', branchAId);
  await plantEmployee(B_ASSET, '0309002', 'شريف ممدوح فاروق', branchBId);
  await plantEmployee(B_LINE, '0309003', 'سامح نبيل عزت', branchBId);
  await plantEmployee(B_STORE, '0309004', 'حازم فكري منصور', branchBId);
  await plantEmployee(B_LEAVER, '0309005', 'ماجد رشدي حلمي', branchBId, 'exited');

  const category = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'لاب توب', en: 'Laptops' },
  });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;

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

describe('the hand-over box — every branch, the act’s grant, four facts', () => {
  it('the register finds only the keeper’s branch; the box finds the other branch too', async () => {
    // The employees register and every filter box: unchanged — branch A's people alone.
    const register = await api.get('/people?search=0309&status=all', keeperAToken);
    expect(register.status).toBe(200);
    expect(idsOf(data<ItPersonDto[]>(register))).toEqual([String(IN_A)]);

    const box = await recipients('0309', keeperAToken);
    expect(box.status).toBe(200);
    const rows = data<ItRecipientDto[]>(box);
    // Employed only — the leaver in B is not offered — and by name.
    expect(idsOf(rows).sort()).toEqual(
      [String(IN_A), String(B_ASSET), String(B_LINE), String(B_STORE)].sort(),
    );
    expect(idsOf(rows)).not.toContain(String(B_LEAVER));
    const names = rows.map((row) => row.fullNameAr);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // Exactly the four facts the box prints — no dates, no login, no placement ids, no counts.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['branchId', 'code', 'employeeId', 'fullNameAr']);
    }
    expect(rows.find((row) => row.employeeId === String(B_ASSET))).toEqual({
      employeeId: String(B_ASSET),
      code: '0309002',
      fullNameAr: 'شريف ممدوح فاروق',
      branchId: branchBId,
    });
    // No meta, no paging: the answer is the array.
    expect((box.body as { meta?: unknown }).meta).toBeUndefined();
  });

  it('honours the page size, and answers only what is typed', async () => {
    const two = await api.get('/people/recipients?search=0309&pageSize=2', keeperAToken);
    expect(two.status).toBe(200);
    expect(data<ItRecipientDto[]>(two)).toHaveLength(2);
    expect((await api.get('/people/recipients', keeperAToken)).status).toBe(400);
    expect((await api.get('/people/recipients?search=%20%20', keeperAToken)).status).toBe(400);
    expect((await api.get('/people/recipients?search=0309&pageSize=21', keeperAToken)).status).toBe(
      400,
    );
  });

  it('opens on ANY hand-over grant — a store keeper alone gets it, a reader who may only look does not', async () => {
    expect((await recipients('0309', viewerAToken)).status).toBe(403);
    const store = await recipients('0309002', storeKeeperAToken);
    expect(store.status).toBe(200);
    expect(idsOf(data<ItRecipientDto[]>(store))).toEqual([String(B_ASSET)]);
  });

  it('is not narrowed by the command bar’s branch', async () => {
    // An org-wide keeper who chose branch A: the register follows the choice, the box does not.
    const register = await api.get('/people?search=0309&status=all', orgKeeperToken, branchAId);
    expect(idsOf(data<ItPersonDto[]>(register))).toEqual([String(IN_A)]);
    const box = await recipients('0309002', orgKeeperToken, branchAId);
    expect(box.status).toBe(200);
    expect(idsOf(data<ItRecipientDto[]>(box))).toEqual([String(B_ASSET)]);
  });
});

describe('a hand-over to another branch — registered in the sender’s, the page opened by it', () => {
  it('an asset: handed over in A, the B person’s page opens for the A keeper — with A’s custody', async () => {
    // Before anything is handed over, the B person is nobody the A keeper may open.
    expect((await api.get(`/people/${String(B_ASSET)}`, keeperAToken)).status).toBe(404);

    const laptop = await device();
    const handed = await api.post(
      `/assets/${laptop.id}/assign`,
      { employeeId: String(B_ASSET) },
      keeperAToken,
    );
    expect(handed.status).toBe(200);
    // Registered where it was: the asset and its interval stay in branch A.
    expect(data<ItAssetDto>(handed)).toMatchObject({ status: 'assigned', branchId: branchAId });

    const page = await api.get(`/people/${String(B_ASSET)}`, keeperAToken);
    expect(page.status).toBe(200);
    expect(data<ItPersonDto>(page)).toMatchObject({
      employeeId: String(B_ASSET),
      code: '0309002',
      branchId: branchBId,
      openCustodyCount: 1,
    });
    const custody = data<ItAssetAssignmentDto[]>(
      await api.get(`/assignments?employeeId=${String(B_ASSET)}`, keeperAToken),
    );
    expect(custody.map((row) => row.assetId)).toEqual([laptop.id]);
    expect(custody[0]?.branchId).toBe(branchAId);

    // The recipient's own branch finds the person and sees nothing of the A asset — unchanged.
    const theirs = await api.get(`/people/${String(B_ASSET)}`, keeperBToken);
    expect(theirs.status).toBe(200);
    expect(data<ItPersonDto>(theirs).openCustodyCount).toBe(0);
    const theirCustody = data<ItAssetAssignmentDto[]>(
      await api.get(`/assignments?employeeId=${String(B_ASSET)}`, keeperBToken),
    );
    expect(theirCustody.map((row) => row.assetId)).not.toContain(laptop.id);

    // Only the registers the reader holds name a person: a store keeper of A, who reads no
    // custody, still cannot open them.
    expect((await api.get(`/people/${String(B_ASSET)}`, storeKeeperAToken)).status).toBe(404);
  });

  it('a line: handed over in A, and the page opens on the lines’ register', async () => {
    expect((await api.get(`/people/${String(B_LINE)}`, keeperAToken)).status).toBe(404);

    const registered = await api.post('/mobile-lines', {
      network: 'vodafone',
      phoneNumber: '01100000091',
      accountNumber: '8.29280625.1',
      ratePlan: '2025 Business Flex 80',
      branchId: branchAId,
    });
    expect(registered.status).toBe(201);
    const line = data<ItMobileLineDto>(registered);
    const handed = await api.post(
      `/mobile-lines/${line.id}/assign`,
      { employeeId: String(B_LINE) },
      keeperAToken,
    );
    expect(handed.status).toBe(200);
    expect(data<ItMobileLineAssignResultDto>(handed).line).toMatchObject({
      status: 'assigned',
      branchId: branchAId,
    });

    const page = await api.get(`/people/${String(B_LINE)}`, keeperAToken);
    expect(page.status).toBe(200);
    // Named by a line, not by an asset: no device counted.
    expect(data<ItPersonDto>(page)).toMatchObject({
      employeeId: String(B_LINE),
      openCustodyCount: 0,
    });
  });

  it('consumables: issued from A’s store, and the page opens on the ledger — for a store keeper too', async () => {
    expect((await api.get(`/people/${String(B_STORE)}`, keeperAToken)).status).toBe(404);
    expect((await api.get(`/people/${String(B_STORE)}`, storeKeeperAToken)).status).toBe(404);

    const stocked = await api.post('/consumables', {
      name: 'Logitech B100',
      typeId,
      unit: 'قطعة',
      branchId: branchAId,
      openingQty: 5,
    });
    expect(stocked.status).toBe(201);
    const item = data<ItConsumableDto>(stocked);
    const issued = await api.post(
      '/consumables/issue',
      { employeeId: String(B_STORE), lines: [{ consumableId: item.id, qty: 1 }] },
      keeperAToken,
    );
    expect(issued.status).toBe(201);
    // The stock left A's store, and the movement is A's.
    expect(data<ItConsumableIssueResultDto>(issued).consumables[0]?.branchId).toBe(branchAId);
    const [movement] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${item.id}/movements?kind=issued`, keeperAToken),
    );
    expect(movement).toMatchObject({ employeeId: String(B_STORE), branchId: branchAId });

    expect((await api.get(`/people/${String(B_STORE)}`, keeperAToken)).status).toBe(200);
    expect((await api.get(`/people/${String(B_STORE)}`, storeKeeperAToken)).status).toBe(200);
  });

  it('nobody the reader’s registers name stays a 404 — the leaver in B included', async () => {
    expect((await api.get(`/people/${String(B_LEAVER)}`, keeperAToken)).status).toBe(404);
    expect(
      (await api.get(`/people/${new Types.ObjectId().toHexString()}`, keeperAToken)).status,
    ).toBe(404);
  });
});

describe('a single asset’s «نقل» goes only where «نقل إلى فرع» may', () => {
  it('to a branch the A keeper does not reach — 403, and the asset stays', async () => {
    const laptop = await device();
    expect(
      (await api.post(`/assets/${laptop.id}/assign`, { employeeId: String(B_ASSET) }, keeperAToken))
        .status,
    ).toBe(200);

    const refused = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toBranchId: branchBId },
      keeperAToken,
    );
    expect(refused.status).toBe(403);
    // …with a new holder too: the person may work anywhere, the device may not go anywhere.
    const withHolder = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toEmployeeId: String(IN_A), toBranchId: branchBId },
      keeperAToken,
    );
    expect(withHolder.status).toBe(403);
    expect(data<ItAssetDto>(await api.get(`/assets/${laptop.id}`, keeperAToken)).branchId).toBe(
      branchAId,
    );

    // The same branch, or none named, as before: handed on to somebody new.
    const same = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toEmployeeId: String(IN_A), toBranchId: branchAId },
      keeperAToken,
    );
    expect(same.status).toBe(200);
    expect(data<ItAssetDto>(same).branchId).toBe(branchAId);
    const none = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toEmployeeId: String(B_ASSET) },
      keeperAToken,
    );
    expect(none.status).toBe(200);
    expect(data<ItAssetDto>(none).branchId).toBe(branchAId);
  });

  it('to an inactive branch — 400, even organization-wide; to a live one it reaches — 200', async () => {
    const laptop = await device();
    expect(
      (await api.post(`/assets/${laptop.id}/assign`, { employeeId: String(IN_A) }, orgKeeperToken))
        .status,
    ).toBe(200);

    const closed = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toBranchId: closedBranchId },
      orgKeeperToken,
    );
    expect(closed.status).toBe(400);

    const moved = await api.post(
      `/assets/${laptop.id}/transfer`,
      { toBranchId: branchBId },
      orgKeeperToken,
    );
    expect(moved.status).toBe(200);
    expect(data<ItAssetDto>(moved).branchId).toBe(branchBId);
  });
});
