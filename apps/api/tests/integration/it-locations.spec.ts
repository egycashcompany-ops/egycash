// «المواقع» over real HTTP with real RBAC — each branch's places, where a department keeps what it
// holds: «أعينها فى مكان بس تبقى على عهده الإدارة .. زى السيرفرات والكاميرات والسويتشات» (the owner,
// 2026-11-19; design §2).
//
// What a mocked spec cannot see: the rows themselves — one Arabic name per branch held by the
// service AND by the unique index (two saves at once), the same name free in another branch; the
// branch reach of `itCatalog.manage` judged on the real grant (403 outside it, the list scoped to
// it, the create dialog's branch list); the pickers' names on any IT read; and the retire rule over
// real custody intervals — refused while one is OPEN at the place, «في عهدته الآن» counted under the
// reader's own `itAsset.view`.
//
// The intervals are written into `it_asset_assignments` as the department hand-over writes them
// (design §1.1: `holderKind: 'department'`, `locationId` in the interval's branch), straight to the
// collection: the hand-over itself — its paper, its refusals — is `it-department-custody.spec.ts`;
// this file pins only what a PLACE answers about the intervals that name it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type ItLocationDto,
  type ItLocationOptionDto,
  type ItMoveTargetsDto,
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
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { ItAssetAssignmentModel } from '../../src/modules/it/assets/assignment.model';
import { ItLocationModel } from '../../src/modules/it/locations/location.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
/** `itCatalog.manage` at BRANCH scope, placed in A — and no `itAsset.view`. */
let keeperAToken: string;
/** `itCatalog.manage` company-wide, but `itAsset.view` only over branch B. */
let viewerBToken: string;
/** `itAsset.view` alone — the asset hand-over's pickers. */
let assetReaderToken: string;
/** `itConsumable.view` alone — the consumables issue's pickers. */
let storeReaderToken: string;
/** An IT key that opens no picker naming a place. */
let ticketReaderToken: string;
let branchAId: string;
let branchBId: string;
let closedBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-locations-test-${Date.now()}`;
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
const errorOf = (res: request.Response) =>
  (
    res.body as {
      error: { code: string; message: string; details?: { field: string; code: string }[] };
    }
  ).error;

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it/locations${path}`).set('Authorization', `Bearer ${token}`),
  post: (body: Record<string, unknown>, token = adminToken) =>
    request(app).post('/api/v1/it/locations').set('Authorization', `Bearer ${token}`).send(body),
  patch: (id: string, body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .patch(`/api/v1/it/locations/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body),
};

let places = 0;
/** A new place in `branchId` (A by default), made by the administrator. */
const mkPlace = async (over: Record<string, unknown> = {}): Promise<ItLocationDto> => {
  places += 1;
  const res = await api.post({
    branchId: branchAId,
    name: { ar: `غرفة رقم ${String(places)}`, en: `Room ${String(places)}` },
    ...over,
  });
  expect(res.status).toBe(201);
  return data<ItLocationDto>(res);
};

/** One page of the tab, as `token` reads it. */
const tab = async (query: string, token = adminToken): Promise<ItLocationDto[]> => {
  const res = await api.get(`?pageSize=100&${query}`, token);
  expect(res.status).toBe(200);
  return data<ItLocationDto[]>(res);
};

const rowOf = async (id: string, token = adminToken): Promise<ItLocationDto | undefined> =>
  (await tab('', token)).find((row) => row.id === id);

/**
 * An OPEN department interval at `place`, as the hand-over writes it — straight to the
 * collection (see the header). Its own asset, so the one-open-interval index never meets it.
 */
const holdAt = async (place: ItLocationDto): Promise<Types.ObjectId> => {
  const now = new Date();
  const id = new Types.ObjectId();
  await ItAssetAssignmentModel.collection.insertOne({
    _id: id,
    assetId: new Types.ObjectId(),
    holderKind: 'department',
    assignedToEmployeeId: null,
    departmentId: new Types.ObjectId(),
    locationId: new Types.ObjectId(place.id),
    responsibleEmployeeId: new Types.ObjectId(),
    assignedByUserId: new Types.ObjectId(adminId),
    assignedAt: now,
    conditionOnIssue: null,
    expectedReturnAt: null,
    returnedAt: null,
    returnedToUserId: null,
    conditionOnReturn: null,
    notes: null,
    branchId: new Types.ObjectId(place.branchId),
    receiptId: null,
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: new Types.ObjectId(adminId),
    updatedBy: new Types.ObjectId(adminId),
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  return id;
};

/** The interval given back — closed, as a return closes it. */
const giveBack = async (intervalId: Types.ObjectId): Promise<void> => {
  await ItAssetAssignmentModel.collection.updateOne(
    { _id: intervalId },
    { $set: { returnedAt: new Date() } },
  );
};

const auditsOf = (id: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'it',
    'entityRef.entityType': 'location',
    'entityRef.entityId': id,
  })
    .sort({ at: 1 })
    .lean()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  // The unique name index is what holds two saves at once; have it built before they race.
  await ItLocationModel.init();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  adminId = await mkUser('locations-admin@ecms.local');
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
  adminToken = await login('locations-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('81', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('82', 'فرع ب', 'Branch B');
  closedBranchId = await mkBranch('83', 'فرع مغلق', 'Closed branch');
  await BranchModel.updateOne({ _id: closedBranchId }, { $set: { status: 'inactive' } }).exec();

  /** An account placed in `branchId` holding each role of `grants` at its scope; its token. */
  const holder = async (
    email: string,
    branchId: string | null,
    grants: { keys: string[]; scope: 'branch' | 'organization' }[],
  ): Promise<string> => {
    const userId = await mkUser(email, branchId);
    for (const [index, grant] of grants.entries()) {
      const role = await rbacService.createRole(
        {
          name: { en: `${email} ${String(index)}`, ar: `دور ${email} ${String(index)}` },
          permissionKeys: grant.keys,
        },
        adminId,
      );
      await rbacService.ensureAssignment(userId, String(role._id), grant.scope);
    }
    return login(email);
  };
  keeperAToken = await holder('locations-keeper-a@ecms.local', branchAId, [
    { keys: ['itCatalog.manage'], scope: 'branch' },
  ]);
  viewerBToken = await holder('locations-viewer-b@ecms.local', branchBId, [
    { keys: ['itCatalog.manage'], scope: 'organization' },
    { keys: ['itAsset.view'], scope: 'branch' },
  ]);
  assetReaderToken = await holder('locations-asset-reader@ecms.local', branchAId, [
    { keys: ['itAsset.view'], scope: 'branch' },
  ]);
  storeReaderToken = await holder('locations-store-reader@ecms.local', branchAId, [
    { keys: ['itConsumable.view'], scope: 'branch' },
  ]);
  ticketReaderToken = await holder('locations-ticket-reader@ecms.local', branchAId, [
    { keys: ['itTicket.view'], scope: 'branch' },
  ]);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a place, added and edited', () => {
  it('is filed in its branch, active and holding nothing — and the trail says so', async () => {
    const res = await api.post({
      branchId: branchAId,
      name: { ar: ' غرفة السيرفرات ', en: 'Server room' },
      code: 'SRV',
      description: 'الدور الثاني',
      sortOrder: 10,
    });
    expect(res.status).toBe(201);
    const place = data<ItLocationDto>(res);
    expect(place).toMatchObject({
      branchId: branchAId,
      name: { ar: 'غرفة السيرفرات', en: 'Server room' },
      code: 'SRV',
      description: 'الدور الثاني',
      sortOrder: 10,
      isActive: true,
      heldAssets: 0,
      version: 0,
    });

    const audits = await auditsOf(place.id);
    expect(audits.map((row) => row.action)).toEqual(['create']);
    expect(audits[0]?.changes).toContainEqual({ field: 'branchId', old: null, new: branchAId });

    const edited = await api.patch(place.id, {
      name: { ar: 'غرفة السيرفرات الرئيسية', en: 'Main server room' },
      code: null,
      sortOrder: 5,
      version: 0,
    });
    expect(edited.status).toBe(200);
    expect(data<ItLocationDto>(edited)).toMatchObject({
      branchId: branchAId,
      name: { ar: 'غرفة السيرفرات الرئيسية', en: 'Main server room' },
      code: null,
      description: 'الدور الثاني',
      sortOrder: 5,
      version: 1,
    });
    const update = (await auditsOf(place.id)).find((row) => row.action === 'update');
    expect(update?.changes).toEqual(
      expect.arrayContaining([
        { field: 'code', old: 'SRV', new: null },
        { field: 'sortOrder', old: 10, new: 5 },
      ]),
    );

    // An old version is someone else's edit — 409, nothing written.
    const stale = await api.patch(place.id, { sortOrder: 1, version: 0 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('STALE_DOCUMENT');
  });

  it('never changes branch, and is never created already retired — the contract refuses both', async () => {
    const place = await mkPlace();
    const moved = await api.patch(place.id, { branchId: branchBId, version: place.version });
    expect(moved.status).toBe(400);
    const retired = await api.post({
      branchId: branchAId,
      name: { ar: 'غرفة مغلقة', en: 'Closed room' },
      isActive: false,
    });
    expect(retired.status).toBe(400);
  });

  it('refuses a branch that does not exist, or is closed — body.branchId UNKNOWN', async () => {
    for (const branchId of [String(new Types.ObjectId()), closedBranchId]) {
      const res = await api.post({ branchId, name: { ar: 'غرفة الشبكة', en: 'Network room' } });
      expect(res.status).toBe(400);
      expect(errorOf(res).details).toContainEqual(
        expect.objectContaining({ field: 'body.branchId', code: 'UNKNOWN' }),
      );
    }
  });
});

describe('one name per branch', () => {
  it('refuses a name the branch already has, spaces and all — and allows it in another branch', async () => {
    const first = await api.post({
      branchId: branchAId,
      name: { ar: 'غرفة الكاميرات', en: 'Camera room' },
    });
    expect(first.status).toBe(201);

    const again = await api.post({
      branchId: branchAId,
      name: { ar: 'غرفة الكاميرات  ', en: 'Cameras' },
    });
    expect(again.status).toBe(409);
    expect(errorOf(again).message).toBe('"غرفة الكاميرات" is already a place in this branch');

    const elsewhere = await api.post({
      branchId: branchBId,
      name: { ar: 'غرفة الكاميرات', en: 'Camera room' },
    });
    expect(elsewhere.status).toBe(201);
    expect(data<ItLocationDto>(elsewhere).branchId).toBe(branchBId);
  });

  it('refuses a rename onto another place’s name in the branch, and allows keeping its own', async () => {
    const switches = await mkPlace({ name: { ar: 'غرفة السويتشات', en: 'Switch room' } });
    const store = await mkPlace({ name: { ar: 'مخزن الشبكة', en: 'Network store' } });

    const clash = await api.patch(store.id, {
      name: { ar: 'غرفة السويتشات', en: 'Switches' },
      version: store.version,
    });
    expect(clash.status).toBe(409);

    const own = await api.patch(switches.id, {
      name: { ar: 'غرفة السويتشات', en: 'Switches' },
      version: switches.version,
    });
    expect(own.status).toBe(200);
    expect(data<ItLocationDto>(own).name.en).toBe('Switches');
  });

  it('holds two saves of one name at once: one place is made, the other refused', async () => {
    const body = { branchId: branchBId, name: { ar: 'غرفة الطوارئ', en: 'Standby room' } };
    const answers = await Promise.all([api.post(body), api.post(body)]);
    expect(answers.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(
      await ItLocationModel.countDocuments({
        branchId: new Types.ObjectId(branchBId),
        'name.ar': 'غرفة الطوارئ',
      }),
    ).toBe(1);
  });
});

describe('the branch reach of itCatalog.manage', () => {
  it('lets a branch keeper add and edit places in their branch, and nowhere else (403)', async () => {
    const own = await api.post(
      { branchId: branchAId, name: { ar: 'غرفة البصمة', en: 'Attendance room' } },
      keeperAToken,
    );
    expect(own.status).toBe(201);
    // Without itAsset.view nothing is counted for them: the column reads null.
    expect(data<ItLocationDto>(own).heldAssets).toBeNull();

    const other = await api.post(
      { branchId: branchBId, name: { ar: 'غرفة البصمة', en: 'Attendance room' } },
      keeperAToken,
    );
    expect(other.status).toBe(403);

    const inB = await mkPlace({ branchId: branchBId });
    const edit = await api.patch(inB.id, { sortOrder: 3, version: inB.version }, keeperAToken);
    expect(edit.status).toBe(403);
    expect(await auditsOf(inB.id)).toHaveLength(1); // its create alone
  });

  it('lists a branch keeper only their branch’s places', async () => {
    await mkPlace({ branchId: branchBId });
    const rows = await tab('', keeperAToken);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.branchId === branchAId)).toBe(true);
    expect(rows.every((row) => row.heldAssets === null)).toBe(true);
  });

  it('offers the create dialog exactly the live branches the key reaches', async () => {
    const keeper = await api.get('/branch-targets', keeperAToken);
    expect(keeper.status).toBe(200);
    expect(data<ItMoveTargetsDto>(keeper).branchIds).toEqual([branchAId]);

    const admin = data<ItMoveTargetsDto>(await api.get('/branch-targets'));
    expect(admin.branchIds).toEqual(expect.arrayContaining([branchAId, branchBId]));
    expect(admin.branchIds).not.toContain(closedBranchId);

    expect((await api.get('/branch-targets', assetReaderToken)).status).toBe(403);
  });

  it('opens the tab on itCatalog.manage alone — an asset reader is refused it', async () => {
    expect((await api.get('', assetReaderToken)).status).toBe(403);
    expect((await api.get('', storeReaderToken)).status).toBe(403);
  });
});

describe('the tab’s filters', () => {
  it('filters by branch, by status, and by either name or the code — any digit set', async () => {
    const lab = await mkPlace({
      branchId: branchBId,
      name: { ar: 'معمل الصيانة 3', en: 'Repair lab 3' },
      code: 'LAB-3',
    });
    const retired = await mkPlace({ branchId: branchBId });
    expect((await api.patch(retired.id, { isActive: false, version: 0 })).status).toBe(200);

    const inB = await tab(`branchId=${branchBId}`);
    expect(inB.every((row) => row.branchId === branchBId)).toBe(true);
    expect(inB.map((row) => row.id)).toEqual(expect.arrayContaining([lab.id, retired.id]));

    const active = await tab(`branchId=${branchBId}&isActive=true`);
    expect(active.map((row) => row.id)).toContain(lab.id);
    expect(active.map((row) => row.id)).not.toContain(retired.id);
    expect((await tab(`branchId=${branchBId}&isActive=false`)).map((row) => row.id)).toEqual([
      retired.id,
    ]);

    for (const search of ['الصيانة ٣', 'repair lab', 'lab-3']) {
      const found = await tab(`search=${encodeURIComponent(search)}`);
      expect(found.map((row) => row.id)).toEqual([lab.id]);
    }
  });
});

describe('the pickers', () => {
  it('list names on any IT read that opens a picker naming a place — and on no other key', async () => {
    for (const token of [adminToken, assetReaderToken, storeReaderToken, keeperAToken]) {
      expect((await api.get('/options', token)).status).toBe(200);
    }
    expect((await api.get('/options', ticketReaderToken)).status).toBe(403);
  });

  it('answer every branch’s active places — a branch-scoped reader too — or one branch’s, in order', async () => {
    const late = await mkPlace({ branchId: branchBId, sortOrder: 90 });
    const early = await mkPlace({ branchId: branchBId, sortOrder: 1 });

    // A hand-over may name a place in a branch the reader's keys do not reach: names, unscoped.
    const all = data<ItLocationOptionDto[]>(await api.get('/options', assetReaderToken));
    expect(all.map((row) => row.id)).toEqual(expect.arrayContaining([late.id, early.id]));
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(['branchId', 'id', 'isActive', 'name']);

    const inB = data<ItLocationOptionDto[]>(await api.get(`/options?branchId=${branchBId}`));
    expect(inB.every((row) => row.branchId === branchBId && row.isActive)).toBe(true);
    const ids = inB.map((row) => row.id);
    expect(ids.indexOf(early.id)).toBeLessThan(ids.indexOf(late.id));
  });

  it('leave a retired place out unless asked to include it, to name an old row', async () => {
    const old = await mkPlace({ branchId: branchBId });
    expect((await api.patch(old.id, { isActive: false, version: 0 })).status).toBe(200);

    const live = data<ItLocationOptionDto[]>(await api.get(`/options?branchId=${branchBId}`));
    expect(live.map((row) => row.id)).not.toContain(old.id);

    const named = data<ItLocationOptionDto[]>(
      await api.get(`/options?branchId=${branchBId}&includeInactive=true`),
    );
    expect(named.find((row) => row.id === old.id)).toMatchObject({ isActive: false });
  });
});

describe('retiring a place', () => {
  it('is refused while an asset is held there, counted whoever may see it — and allowed once it is given back', async () => {
    const place = await mkPlace({ name: { ar: 'غرفة الخوادم الاحتياطية', en: 'Backup room' } });
    const first = await holdAt(place);
    const second = await holdAt(place);

    // «في عهدته الآن» — the tab counts the open intervals at the place.
    expect((await rowOf(place.id))?.heldAssets).toBe(2);

    const refused = await api.patch(place.id, { isActive: false, version: place.version });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).message).toBe(
      '2 assets are held at this place; transfer or return them first',
    );
    expect((await rowOf(place.id))?.isActive).toBe(true);

    // A reader whose asset key reaches only branch B counts none of A's intervals — but the rule
    // counts every one, whoever asks.
    expect((await rowOf(place.id, viewerBToken))?.heldAssets).toBe(0);
    const stillRefused = await api.patch(
      place.id,
      { isActive: false, version: place.version },
      viewerBToken,
    );
    expect(stillRefused.status).toBe(409);
    expect(errorOf(stillRefused).message).toBe(
      '2 assets are held at this place; transfer or return them first',
    );

    await giveBack(first);
    expect((await rowOf(place.id))?.heldAssets).toBe(1);
    expect(
      errorOf(await api.patch(place.id, { isActive: false, version: place.version })).message,
    ).toBe('1 asset is held at this place; transfer or return it first');

    await giveBack(second);
    const retired = await api.patch(place.id, { isActive: false, version: place.version });
    expect(retired.status).toBe(200);
    expect(data<ItLocationDto>(retired)).toMatchObject({ isActive: false, heldAssets: 0 });
    const audit = (await auditsOf(place.id)).find((row) => row.action === 'update');
    expect(audit?.changes).toEqual([{ field: 'isActive', old: true, new: false }]);

    // Brought back, it is offered again.
    const back = await api.patch(place.id, { isActive: true, version: place.version + 1 });
    expect(back.status).toBe(200);
    const offered = data<ItLocationOptionDto[]>(await api.get(`/options?branchId=${branchAId}`));
    expect(offered.map((row) => row.id)).toContain(place.id);
  });

  it('counts only the place’s own intervals — another place’s custody does not block it', async () => {
    const busy = await mkPlace();
    const idle = await mkPlace();
    await holdAt(busy);

    const rows = await tab(`branchId=${branchAId}`);
    expect(rows.find((row) => row.id === busy.id)?.heldAssets).toBe(1);
    expect(rows.find((row) => row.id === idle.id)?.heldAssets).toBe(0);
    expect((await api.patch(idle.id, { isActive: false, version: idle.version })).status).toBe(200);
  });
});
