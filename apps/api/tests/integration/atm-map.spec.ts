// /atm/map — the machine map, its owner-drawn zones and the machines' locations, end to end
// (docs/12-planning/atm-map-zones.md §9.3).
//
// Proven over real HTTP, real RBAC and a real mongod:
//
//   1. permissions — every route behind its keys; the locate routes behind BOTH keys; super-admin
//      widened with the three new keys by `seedAtm`;
//   2. read scope — the register's rule (DM-10): a branch or department grant reads its branch, a
//      delegated department copy reads the WHOLE branch it sits in and cannot write there, `own`
//      reads nothing, the top bar narrows an organization grant, a browser branch only narrows
//      (400 `OUT_OF_REACH`), archived machines on request, deleted never, and the points carry no
//      register text;
//   3. context — the branches, what each allows, and the ONE edit branch (DM-12);
//   4. zone save — the diff, the revision CAS (409, one of two concurrent saves), the geometry and
//      size limits, DM-8 names, the branch rule (case A, BRANCH_MISMATCH, 422, 403), the audits and
//      the rate limit;
//   5. sync — every kind of register text, idempotency, one run audit, the version guard (a pin
//      placed between the load and the write survives), the batch error contract, and the
//      register projection;
//   6. precedence (DM-2) through the register's own routes;
//   7. pins — create, versions, the 1 km reason, text mode, approval and its two 409s, 403/404;
//   8. detail — the source text only with `atmRegister.view`, never to the entry's mere creator;
//   9. resolver — with injected fake DNS and hops (never the network): one pass, 20 per call, the
//      lease, archived machines left alone, a URL-free audit, the rate limit;
//  10. summary — the counts agree with the points, and `pendingSync` sees what moved;
//  11. indexes — dropped, then built by the boot step, then reported present;
//  12. faults — a sync or a resolver run that fails part-way keeps its run row and the replaced
//      pins' trail; the resolver's lease is never a successor's; and a sync is a fixed point even
//      where a secondary short code disagrees with its AV pin (DM-44c).
//
// Every machine, area, text and link below is synthetic: codes 1001–1050 and SYN-…, «ماكينة تجريبية n»,
// «منطقة تجريبية n» (the research checked that none of these codes occurs in the workbook).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types, type Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  AtmSettingKeys,
  SettingKeys,
  platformPermissions,
  type AtmMachineLocationDetailDto,
  type AtmMapContextDto,
  type AtmMapLatLng,
  type AtmMapLinkResolveResultDto,
  type AtmMapLocationSummaryDto,
  type AtmMapParseResultDto,
  type AtmMapPointDto,
  type AtmMapPointsDto,
  type AtmMapSyncResultDto,
  type AtmMapZoneSetDto,
  type AtmMapZonesDto,
  type AtmRegisterEntryDto,
  type AtmRegisterWriteResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { seedAtm } from '../../src/modules/atm/atm.seed';
import { migrateAtmIndexes } from '../../src/modules/atm/atm-indexes';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { AtmRegisterEntryModel } from '../../src/modules/atm/register/register.model';
import {
  AtmMachineLocationModel,
  type AtmMachineLocationDoc,
} from '../../src/modules/atm/map/machine-location.model';
import { AtmMapZoneModel } from '../../src/modules/atm/map/zone.model';
import { AtmMapZoneSetModel } from '../../src/modules/atm/map/zone-set.model';
import {
  RESOLVE_LEASE_KEY,
  openEntryLocationTexts,
  setShortLinkDepsForTests,
  setSyncBeforeWriteForTests,
} from '../../src/modules/atm/map/location.service';
import { type ShortLinkDeps } from '../../src/modules/atm/map/location/short-link-resolver';
import { encode } from '../../src/modules/atm/map/location/plus-code';

const PASSWORD = 'Str0ng#Pass!';
const MAP_KEYS = ['atmMap.view', 'atmZone.manage', 'atmMachine.locate'];
// Synthetic secrets — asserted ABSENT from what the register helper returns.
const KEY_CODE = 'SUP-FAKE-7731';
const NOTE = 'note-fake-map-55';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let adminCtx: AuthContext;

const branch: Record<
  'alex' | 'tanta' | 'sync' | 'empty' | 'review' | 'links' | 'prec' | 'zones' | 'idem' | 'faults',
  string
> = {
  alex: '',
  tanta: '',
  sync: '',
  empty: '',
  review: '',
  links: '',
  prec: '',
  zones: '',
  idem: '',
  faults: '',
};

/** Every caller the suite acts as. */
const token: Record<string, string> = {};
const userIdOf: Record<string, string> = {};

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-map-${String(Date.now())}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (
  email: string,
  placement: { branchId?: string; departmentId?: string } = {},
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: {
        branchId: placement.branchId ?? null,
        departmentId: placement.departmentId ?? null,
        sectionId: null,
        jobTitleId: null,
      },
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
  (res.body as { error?: { code?: string } }).error?.code ?? '';
const detailsOf = (res: request.Response): { field?: string; code: string; message: string }[] =>
  (res.body as { error?: { details?: { field?: string; code: string; message: string }[] } }).error
    ?.details ?? [];
const detailCodes = (res: request.Response): string[] => detailsOf(res).map((d) => d.code);

const call = (
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  as: string,
  body?: unknown,
  activeBranch?: string,
): request.Test => {
  const agent = request(app);
  let req = agent[method](`/api/v1${path}`).set('Authorization', `Bearer ${token[as] ?? as}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body as object);
};

const okData = async <T>(test: request.Test, status = 200): Promise<T> => {
  const res = await test;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const square = (lat: number, lng: number, size = 0.01): AtmMapLatLng[] => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
];

/** A regular n-gon — a valid zone of any size up to the 500-point cap. */
const ring = (lat: number, lng: number, n: number, r = 0.01): AtmMapLatLng[] =>
  Array.from({ length: n }, (_, i) => ({
    lat: Math.round((lat + r * Math.sin((2 * Math.PI * i) / n)) * 1e6) / 1e6,
    lng: Math.round((lng + r * Math.cos((2 * Math.PI * i) / n)) * 1e6) / 1e6,
  }));

const addMachine = async (
  branchId: string,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const [doc] = await AtmMachineModel.create([
    {
      branchId: oid(branchId),
      bankName: 'SYN BANK',
      machineCode: code,
      name: `ماكينة تجريبية ${code}`,
      zone: '',
      area: 'منطقة تجريبية 1',
      isActive: true,
      ...extra,
    },
  ]);
  return String(doc?._id);
};

/** An OPEN entry written as the import writes it, carrying synthetic K values. */
const addEntry = async (
  machineId: string,
  branchId: string,
  code: string,
  texts: { url?: string | null; plusCode?: string | null },
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const [doc] = await AtmRegisterEntryModel.create([
    {
      branchId: oid(branchId),
      area: 'منطقة تجريبية 1',
      bankCode: 'NBE',
      machineCode: code,
      machineId: oid(machineId),
      name: `ماكينة تجريبية ${code}`,
      keys: { supervisorCode: KEY_CODE },
      receiptNotes: NOTE,
      handoverNotes: NOTE,
      locationUrl: texts.url ?? null,
      locationPlusCode: texts.plusCode ?? null,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      status: 'open',
      source: 'import',
      ...extra,
    },
  ]);
  return String(doc?._id);
};

const locationOf = async (machineId: string): Promise<AtmMachineLocationDoc | null> =>
  AtmMachineLocationModel.findOne({ machineId: oid(machineId), isDeleted: false })
    .lean<AtmMachineLocationDoc>()
    .exec();

const auditsOf = async (filter: Record<string, unknown>) =>
  AuditLogModel.find(filter).sort({ _id: 1 }).lean().exec();

const points = async (as: string, query = '', activeBranch?: string): Promise<AtmMapPointDto[]> =>
  (
    await okData<AtmMapPointsDto>(
      call('get', `/atm/map/points${query}`, as, undefined, activeBranch),
    )
  ).points;

const zones = async (as: string, query = '', activeBranch?: string): Promise<AtmMapZonesDto> =>
  okData<AtmMapZonesDto>(call('get', `/atm/map/zones${query}`, as, undefined, activeBranch));

const zoneSet = async (as: string, branchId: string, activeBranch?: string) => {
  const sets = (await zones(as, `?branchId=${branchId}`, activeBranch)).sets;
  const set = sets.find((s) => s.branchId === branchId);
  expect(set).toBeDefined();
  return set as AtmMapZoneSetDto;
};

const sync = (as: string, branchId?: string): request.Test =>
  call('post', '/atm/map/locations/sync', as, branchId === undefined ? {} : { branchId });

const syncOk = async (as: string, branchId: string): Promise<AtmMapSyncResultDto> =>
  okData<AtmMapSyncResultDto>(sync(as, branchId));

const detail = async (as: string, machineId: string): Promise<AtmMachineLocationDetailDto> =>
  okData<AtmMachineLocationDetailDto>(call('get', `/atm/map/machines/${machineId}/location`, as));

const place = (as: string, machineId: string, body: Record<string, unknown>): request.Test =>
  call('put', `/atm/map/machines/${machineId}/location`, as, body);

const summary = async (as: string, query = ''): Promise<AtmMapLocationSummaryDto> =>
  okData<AtmMapLocationSummaryDto>(call('get', `/atm/map/locations/summary${query}`, as));

// ── Machines of the read-scope, pins and zone tests (no register entry) ────────────────────────
const machine: Record<string, string> = {};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  // Super-admin WITHOUT the three map keys: `seedAtm` must be what adds them (§9.3 #1).
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions]
      .map((p) => p.key)
      .filter((key) => !MAP_KEYS.includes(key)),
  );
  adminId = await mkUser('atm-map-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  adminCtx = {
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
  await settingsService.set(adminCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  await seedAtm();
  adminToken = await login('atm-map-admin@ecms.local');
  token.admin = adminToken;

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  const names: Record<keyof typeof branch, [string, string, string]> = {
    alex: ['70', 'الإسكندرية', 'Alexandria'],
    tanta: ['71', 'طنطا', 'Tanta'],
    sync: ['72', 'فرع تجريبي 1', 'SYN Sync'],
    empty: ['73', 'فرع تجريبي 2', 'SYN Empty'],
    review: ['74', 'فرع تجريبي 3', 'SYN Review'],
    links: ['75', 'فرع تجريبي 4', 'SYN Links'],
    prec: ['76', 'فرع تجريبي 5', 'SYN Precedence'],
    zones: ['77', 'فرع تجريبي 6', 'SYN Zones'],
    idem: ['78', 'فرع تجريبي 7', 'SYN Idempotent'],
    faults: ['79', 'فرع تجريبي 8', 'SYN Faults'],
  };
  for (const key of Object.keys(names) as (keyof typeof branch)[]) {
    const [code, ar, en] = names[key];
    branch[key] = await post('/platform/branches', { code, name: { ar, en } });
  }
  const alexDept = await post('/platform/departments', {
    code: 'MAP-A-OPS',
    name: { ar: 'التشغيل', en: 'Operations' },
    branchId: branch.alex,
  });
  const catalog = await post('/platform/department-catalog', {
    code: 'MAP-OPS',
    name: { ar: 'تشغيل الماكينات', en: 'Machine operations' },
  });
  await post('/platform/departments', {
    code: 'MAP-OPS-T',
    branchId: branch.tanta,
    catalogId: catalog,
  });

  const role = async (en: string, keys: string[]): Promise<string> =>
    String(
      (await rbacService.createRole({ name: { en, ar: en }, permissionKeys: keys }, adminId))._id,
    );
  const users: {
    name: string;
    keys: string[];
    scope: 'organization' | 'branch' | 'department' | 'own';
    placement?: { branchId?: string; departmentId?: string };
  }[] = [
    { name: 'noMap', keys: ['atmMachine.view'], scope: 'organization' },
    {
      name: 'alexViewer',
      keys: ['atmMap.view'],
      scope: 'branch',
      placement: { branchId: branch.alex },
    },
    {
      name: 'deptViewer',
      keys: ['atmMap.view', 'atmMachine.view'],
      scope: 'department',
      placement: { branchId: branch.alex, departmentId: alexDept },
    },
    {
      name: 'ownViewer',
      keys: ['atmMap.view'],
      scope: 'own',
      placement: { branchId: branch.alex },
    },
    { name: 'orgViewer', keys: ['atmMap.view'], scope: 'organization' },
    {
      name: 'orgEditor',
      keys: ['atmMap.view', 'atmZone.manage'],
      scope: 'organization',
      placement: { branchId: branch.alex },
    },
    { name: 'orgEditorNoHome', keys: ['atmMap.view', 'atmZone.manage'], scope: 'organization' },
    {
      name: 'alexEditor',
      keys: ['atmMap.view', 'atmZone.manage'],
      scope: 'branch',
      placement: { branchId: branch.alex },
    },
    {
      name: 'deptEditor',
      keys: ['atmMap.view', 'atmZone.manage'],
      scope: 'department',
      placement: { branchId: branch.alex, departmentId: alexDept },
    },
    {
      name: 'locator',
      keys: ['atmMap.view', 'atmMachine.locate', 'atmRegister.view'],
      scope: 'organization',
    },
    { name: 'locatorNoReg', keys: ['atmMap.view', 'atmMachine.locate'], scope: 'organization' },
    {
      name: 'alexLocator',
      keys: ['atmMap.view', 'atmMachine.locate'],
      scope: 'branch',
      placement: { branchId: branch.alex },
    },
    {
      name: 'deptLocator',
      keys: ['atmMap.view', 'atmMachine.locate'],
      scope: 'department',
      placement: { branchId: branch.alex, departmentId: alexDept },
    },
    { name: 'locateOnly', keys: ['atmMachine.locate'], scope: 'organization' },
  ];
  for (const user of users) {
    const id = await mkUser(`atm-map-${user.name.toLowerCase()}@ecms.local`, user.placement);
    await rbacService.ensureAssignment(id, await role(user.name, user.keys), user.scope);
    userIdOf[user.name] = id;
    token[user.name] = await login(`atm-map-${user.name.toLowerCase()}@ecms.local`);
  }
  // The map read organization-wide, the locate key in Alex only: readable everywhere, writable in
  // one branch (§6.3 error contract; §9.3 #7 403).
  const mixedId = await mkUser('atm-map-mixed@ecms.local', { branchId: branch.alex });
  await rbacService.ensureAssignment(
    mixedId,
    await role('Map reader', ['atmMap.view']),
    'organization',
  );
  await rbacService.ensureAssignment(
    mixedId,
    await role('Locator', ['atmMachine.locate']),
    'branch',
  );
  userIdOf.mixed = mixedId;
  token.mixed = await login('atm-map-mixed@ecms.local');
  // A department copy granted by delegation (ADR-032): «Machine operations» in Tanta, held by
  // somebody placed in Alex.
  const delegatedId = await mkUser('atm-map-delegated@ecms.local', {
    branchId: branch.alex,
    departmentId: alexDept,
  });
  await rbacService.assignRole(
    {
      userId: delegatedId,
      roleId: await role('Delegated', ['atmMap.view', 'atmMachine.locate']),
      scope: 'department',
      departmentCatalogId: catalog,
      branchIds: [branch.tanta],
    },
    adminId,
  );
  token.delegated = await login('atm-map-delegated@ecms.local');

  // The read-scope machines: three active, one archived and one deleted in Alex; two in Tanta.
  for (const code of ['1001', '1002', '1003'])
    machine[`alex${code}`] = await addMachine(branch.alex, code);
  machine.alexArchived = await addMachine(branch.alex, '1004', { isActive: false });
  machine.alexDeleted = await addMachine(branch.alex, '1005-D', {
    isDeleted: true,
    deletedAt: new Date(),
  });
  machine.tanta1001 = await addMachine(branch.tanta, '1001');
  machine.tanta1002 = await addMachine(branch.tanta, '1002');

  // Tanta's zones, as an earlier save left them.
  await AtmMapZoneSetModel.create([{ branchId: oid(branch.tanta), revision: 1 }]);
  await AtmMapZoneModel.create([
    {
      branchId: oid(branch.tanta),
      name: 'قطاع طنطا',
      color: '#483bba',
      order: 0,
      points: square(30.78, 31.0),
    },
  ]);
}, 240_000);

afterAll(async () => {
  setShortLinkDepsForTests(null);
  setSyncBeforeWriteForTests(null);
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// The per-user limits (DM-47) would otherwise count across the whole suite.
beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── 1. Permissions ──────────────────────────────────────────────────────────────────────────────

describe('1. permissions', () => {
  const locateRoutes = (machineId: string): [string, string, unknown][] => [
    ['get', '/atm/map/locations/summary', undefined],
    ['post', '/atm/map/locations/parse', { machineId, text: '30.0444, 31.2357' }],
    ['post', '/atm/map/locations/sync', {}],
    ['post', '/atm/map/locations/resolve-links', {}],
    ['get', `/atm/map/machines/${machineId}/location`, undefined],
    [
      'put',
      `/atm/map/machines/${machineId}/location`,
      { mode: 'pin', lat: 30, lng: 31, version: null },
    ],
    ['post', `/atm/map/machines/${machineId}/location/approve`, { version: 0 }],
  ];

  it('without atmMap.view, the map reads are 403', async () => {
    for (const path of ['/atm/map/points', '/atm/map/zones', '/atm/map/context']) {
      expect((await call('get', path, 'noMap')).status, path).toBe(403);
    }
  });

  it('without atmZone.manage, the zone save is 403', async () => {
    const res = await call('put', '/atm/map/zones', 'alexViewer', {
      branchId: branch.alex,
      revision: 0,
      creates: [],
      updates: [],
      deletes: [],
      order: [],
    });
    expect(res.status).toBe(403);
  });

  it('without atmMachine.locate — or with it but without atmMap.view — every locate route is 403', async () => {
    for (const as of ['alexViewer', 'locateOnly']) {
      for (const [method, path, body] of locateRoutes(machine.alex1001 ?? '')) {
        const res = await call(method as 'get', path, as, body);
        expect(res.status, `${as} ${method} ${path}`).toBe(403);
      }
    }
  });

  it('super-admin holds the three keys after boot (seedAtm)', async () => {
    const me = await call('get', '/auth/me', 'admin');
    expect(me.status).toBe(200);
    const permissions = data<{ permissions: Record<string, string> }>(me).permissions;
    for (const key of MAP_KEYS) expect(permissions[key], key).toBe('organization');
  });
});

// ── 4. Zone save (before the read-scope block, which reads what it saved) ──────────────────────

const save = (as: string, body: Record<string, unknown>, activeBranch?: string): request.Test =>
  call(
    'put',
    '/atm/map/zones',
    as,
    { creates: [], updates: [], deletes: [], ...body },
    activeBranch,
  );

describe('4. zone save', () => {
  let a = '';
  let b = '';

  it('a first save at revision 0 creates the set at revision 1, in the order sent, audited per zone', async () => {
    const set = await okData<AtmMapZoneSetDto>(
      save('alexEditor', {
        branchId: branch.alex,
        revision: 0,
        creates: [
          { tempId: 'new-a', name: 'قطاع أ', color: '#483BBA', points: square(31.2, 29.9) },
          { tempId: 'new-b', name: 'قطاع ب', color: '#d3a813', points: square(31.25, 29.95) },
        ],
        order: ['new-b', 'new-a'],
      }),
    );
    expect(set.branchId).toBe(branch.alex);
    expect(set.revision).toBe(1);
    expect(set.zones.map((z) => z.name)).toEqual(['قطاع ب', 'قطاع أ']);
    expect(set.zones.map((z) => z.order)).toEqual([0, 1]);
    expect(set.zones[1]?.color).toBe('#483bba');
    b = set.zones[0]?.id ?? '';
    a = set.zones[1]?.id ?? '';
    const created = await auditsOf({ 'entityRef.entityType': 'mapZone', action: 'create' });
    expect(created.map((row) => row.entityRef.entityId).sort()).toEqual([a, b].sort());
    const orderOf = (id: string) =>
      created.find((row) => row.entityRef.entityId === id)?.changes.find((c) => c.field === 'order')
        ?.new;
    expect(orderOf(b)).toBe(0);
    expect(orderOf(a)).toBe(1);
  });

  it('a second first save is 409 ATM_MAP_ZONES_STALE and writes nothing', async () => {
    const res = await save('alexEditor', {
      branchId: branch.alex,
      revision: 0,
      creates: [{ tempId: 'new-c', name: 'قطاع ج', color: '#5bc4a3', points: square(31.3, 29.9) }],
      order: [b, a, 'new-c'],
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_MAP_ZONES_STALE');
    expect((await zoneSet('alexEditor', branch.alex)).zones).toHaveLength(2);
  });

  it('refuses bad shapes with field paths: a bow-tie, 2 points, 501 points, lat 91, < 100 m²', async () => {
    const attempt = async (points: unknown) =>
      save('alexEditor', {
        branchId: branch.alex,
        revision: 1,
        creates: [{ tempId: 'new-x', name: 'قطاع س', color: '#5bc4a3', points }],
        order: [b, a, 'new-x'],
      });
    const bowTie = [
      { lat: 31.3, lng: 29.9 },
      { lat: 31.31, lng: 29.91 },
      { lat: 31.3, lng: 29.91 },
      { lat: 31.31, lng: 29.9 },
    ];
    const cases: [unknown, string, string][] = [
      [bowTie, 'body.creates.0.points', 'SELF_INTERSECTION'],
      [square(31.3, 29.9).slice(0, 2), 'body.creates.0.points', 'TOO_SMALL'],
      [ring(31.3, 29.9, 501), 'body.creates.0.points', 'TOO_BIG'],
      [square(91, 29.9), 'body.creates.0.points.0.lat', 'TOO_BIG'],
      [square(31.3, 29.9, 0.00009), 'body.creates.0.points', 'TOO_SMALL'],
    ];
    for (const [shape, field, code] of cases) {
      const res = await attempt(shape);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(detailsOf(res), field).toContainEqual(expect.objectContaining({ field, code }));
    }
    expect((await zoneSet('alexEditor', branch.alex)).revision).toBe(1);
  });

  it('caps the points of one save (20,001 → TOO_MANY_POINTS_IN_SAVE) and of the branch', async () => {
    const many = (count: number, size: number) =>
      Array.from({ length: count }, (_, i) => ({
        tempId: `new-p${String(i)}`,
        name: `قطاع كبير ${String(i)}`,
        color: '#4ba3f7',
        points: ring(31.4, 29.9, size),
      }));
    const over = [...many(40, 500), { ...many(1, 3)[0], tempId: 'new-q', name: 'قطاع صغير' }];
    const tooMany = await save('alexEditor', {
      branchId: branch.alex,
      revision: 1,
      creates: over,
      order: [b, a, ...over.map((c) => c.tempId)],
    });
    expect(tooMany.status).toBe(400);
    // A refinement's code rides the detail's message (Zod custom issues are all `custom`).
    expect(detailsOf(tooMany)).toContainEqual(
      expect.objectContaining({ message: 'TOO_MANY_POINTS_IN_SAVE' }),
    );

    // 20,000 points pass the save's cap; with the branch's 8 they exceed the branch's.
    const exact = many(40, 500);
    const branchOver = await save('alexEditor', {
      branchId: branch.alex,
      revision: 1,
      creates: exact,
      order: [b, a, ...exact.map((c) => c.tempId)],
    });
    expect(branchOver.status, JSON.stringify(branchOver.body).slice(0, 300)).toBe(400);
    expect(detailCodes(branchOver)).toContain('TOO_MANY_POINTS_IN_BRANCH');
    expect(detailCodes(branchOver)).not.toContain('CUSTOM');
    expect((await zoneSet('alexEditor', branch.alex)).zones).toHaveLength(2);
  }, 60_000);

  it('names are unique per branch after trimming, collapsing spaces and case-folding (DM-8)', async () => {
    const res = await save('alexEditor', {
      branchId: branch.alex,
      revision: 1,
      creates: [
        { tempId: 'new-d', name: '  قطاع  أ ', color: '#5bc4a3', points: square(31.3, 29.9) },
      ],
      order: [b, a, 'new-d'],
    });
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toContainEqual(
      expect.objectContaining({ field: 'body.creates.0.name', code: 'DUPLICATE_NAME' }),
    );
  });

  it('a swap of two names in one save is fine', async () => {
    const set = await okData<AtmMapZoneSetDto>(
      save('alexEditor', {
        branchId: branch.alex,
        revision: 1,
        updates: [
          { id: a, name: 'قطاع ب' },
          { id: b, name: 'قطاع أ' },
        ],
        order: [b, a],
      }),
    );
    expect(set.revision).toBe(2);
    expect(set.zones.find((z) => z.id === a)?.name).toBe('قطاع ب');
    expect(set.zones.find((z) => z.id === b)?.name).toBe('قطاع أ');
  });

  it('an id from another branch is UNKNOWN_ZONE; an order missing an id is ORDER_MISMATCH', async () => {
    const tantaZone = (await zoneSet('orgViewer', branch.tanta)).zones[0]?.id ?? '';
    const unknown = await save('alexEditor', {
      branchId: branch.alex,
      revision: 2,
      updates: [{ id: tantaZone, name: 'قطاع مسروق' }],
      order: [b, a],
    });
    expect(unknown.status).toBe(400);
    expect(detailsOf(unknown)).toContainEqual(
      expect.objectContaining({ field: 'body.updates.0.id', code: 'UNKNOWN_ZONE' }),
    );
    const missing = await save('alexEditor', { branchId: branch.alex, revision: 2, order: [b] });
    expect(missing.status).toBe(400);
    expect(detailCodes(missing)).toEqual(['ORDER_MISMATCH']);
  });

  it('two concurrent saves at the same revision: exactly one 200 and one 409', async () => {
    const [x, y] = await Promise.all([
      save('alexEditor', {
        branchId: branch.alex,
        revision: 2,
        updates: [{ id: a, color: '#8a1586' }],
        order: [b, a],
      }),
      save('alexEditor', {
        branchId: branch.alex,
        revision: 2,
        updates: [{ id: b, color: '#406113' }],
        order: [b, a],
      }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(errorCode(x.status === 409 ? x : y)).toBe('ATM_MAP_ZONES_STALE');
    expect((await zoneSet('alexEditor', branch.alex)).revision).toBe(3);
  });

  it('update + delete + reorder in one request: revision 2, one delete audit, an update per moved zone', async () => {
    // The org editor placed in Alex works on the branch its top bar names.
    const first = await okData<AtmMapZoneSetDto>(
      save(
        'orgEditor',
        {
          branchId: branch.zones,
          revision: 0,
          creates: ['A', 'B', 'C', 'D'].map((n, i) => ({
            tempId: `new-${n.toLowerCase()}`,
            name: `قطاع ${n}`,
            color: '#007ca5',
            points: square(30.5 + i * 0.02, 31.5),
          })),
          order: ['new-a', 'new-b', 'new-c', 'new-d'],
        },
        branch.zones,
      ),
    );
    const id = (n: string) => first.zones.find((z) => z.name === `قطاع ${n}`)?.id ?? '';
    const [za, zb, zc, zd] = [id('A'), id('B'), id('C'), id('D')];
    const moved = square(30.49, 31.49, 0.015);
    const second = await okData<AtmMapZoneSetDto>(
      save(
        'orgEditor',
        {
          branchId: branch.zones,
          revision: 1,
          updates: [{ id: za, name: 'قطاع A2', points: moved }],
          deletes: [zb],
          order: [za, zd, zc],
        },
        branch.zones,
      ),
    );
    expect(second.revision).toBe(2);
    expect(second.zones.map((z) => z.id)).toEqual([za, zd, zc]);
    expect(second.zones.map((z) => z.order)).toEqual([0, 1, 2]);

    const deleted = await auditsOf({ 'entityRef.entityType': 'mapZone', action: 'delete' });
    expect(deleted.map((row) => row.entityRef.entityId)).toEqual([zb]);
    const updated = await auditsOf({
      'entityRef.entityType': 'mapZone',
      action: 'update',
      'entityRef.entityId': { $in: [za, zb, zc, zd] },
    });
    // A keeps order 0 but changed its name and points; D moved 3 → 1; C stayed at 2 — no row.
    const byZone = new Map(
      updated.map((row) => [row.entityRef.entityId, row.changes.map((c) => c.field).sort()]),
    );
    expect(byZone.get(za)).toEqual(['name', 'points']);
    expect(byZone.get(zd)).toEqual(['order']);
    expect(byZone.has(zc)).toBe(false);
    expect(
      (await zoneSet('orgEditor', branch.zones, branch.zones)).zones.map((z) => z.id),
    ).not.toContain(zb);

    // Revision 1 again: 409, and the database is unchanged.
    const before = await AtmMapZoneModel.find({ branchId: oid(branch.zones) })
      .lean()
      .exec();
    const stale = await save(
      'orgEditor',
      { branchId: branch.zones, revision: 1, deletes: [za], order: [zd, zc] },
      branch.zones,
    );
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('ATM_MAP_ZONES_STALE');
    expect(
      await AtmMapZoneModel.find({ branchId: oid(branch.zones) })
        .lean()
        .exec(),
    ).toEqual(before);
    expect((await zoneSet('orgEditor', branch.zones, branch.zones)).revision).toBe(2);
  });

  it('case A: an organization editor placed in Alex with the top bar at Tanta saves under Tanta', async () => {
    const set = await zoneSet('orgEditor', branch.tanta, branch.tanta);
    const saved = await okData<AtmMapZoneSetDto>(
      save(
        'orgEditor',
        {
          branchId: branch.tanta,
          revision: set.revision,
          creates: [
            { tempId: 'new-t', name: 'قطاع طنطا 2', color: '#ed7665', points: square(30.8, 31.0) },
          ],
          order: [...set.zones.map((z) => z.id), 'new-t'],
        },
        branch.tanta,
      ),
    );
    expect(saved.branchId).toBe(branch.tanta);
    expect(saved.revision).toBe(set.revision + 1);
  });

  it('an Alex branch editor with the top bar at Tanta still files under Alex → BRANCH_MISMATCH', async () => {
    const res = await save(
      'alexEditor',
      { branchId: branch.tanta, revision: 1, order: [] },
      branch.tanta,
    );
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toContainEqual(
      expect.objectContaining({ field: 'body.branchId', code: 'BRANCH_MISMATCH' }),
    );
  });

  it('an organization editor with no home and no top bar in a multi-branch company → 422', async () => {
    const res = await save('orgEditorNoHome', {
      branchId: branch.alex,
      revision: 3,
      order: [b, a],
    });
    expect(res.status).toBe(422);
  });

  it('a department-scoped zone key edits nothing → 403', async () => {
    const res = await save('deptEditor', { branchId: branch.alex, revision: 3, order: [b, a] });
    expect(res.status).toBe(403);
  });

  it('a branch with no set reads as revision 0 and no zones', async () => {
    const set = await zoneSet('orgViewer', branch.empty);
    expect(set).toEqual({ branchId: branch.empty, revision: 0, zones: [] });
  });

  it('a 1.1 MB body is not accepted, and nothing is written', async () => {
    const res = await save('alexEditor', {
      branchId: branch.alex,
      revision: 3,
      order: [b, a],
      pad: 'x'.repeat(1_150_000),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await zoneSet('alexEditor', branch.alex)).revision).toBe(3);
  });

  it('the 31st save in a minute by one user is 429', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await save('alexEditor', { revision: -1 })).status).toBe(400);
    }
    expect((await save('alexEditor', { revision: -1 })).status).toBe(429);
  });
});

// ── 2. Read scope ───────────────────────────────────────────────────────────────────────────────

describe('2. read scope', () => {
  const codes = (rows: AtmMapPointDto[]) => rows.map((p) => p.code).sort();

  it('an Alex branch viewer sees only Alex points and zones', async () => {
    const rows = await points('alexViewer');
    expect(rows.every((p) => p.branchId === branch.alex)).toBe(true);
    expect(codes(rows)).toEqual(['1001', '1002', '1003']);
    const sets = (await zones('alexViewer')).sets;
    expect(sets.map((s) => s.branchId)).toEqual([branch.alex]);
    expect(sets[0]?.zones.length).toBeGreaterThan(0);
  });

  it('an Alex department viewer sees Alex only, while the same grant on /atm/machines widens', async () => {
    expect((await points('deptViewer')).every((p) => p.branchId === branch.alex)).toBe(true);
    const machines = await call('get', '/atm/machines?isActive=true&pageSize=100', 'deptViewer');
    expect(machines.status).toBe(200);
    const branchIds = new Set(data<{ branchId: string }[]>(machines).map((m) => m.branchId));
    expect(branchIds.has(branch.tanta)).toBe(true);
  });

  it('a delegated department copy in Tanta reads all of Tanta and cannot place a pin there', async () => {
    const rows = await points('delegated');
    expect(codes(rows)).toEqual(['1001', '1002']);
    expect(rows.every((p) => p.branchId === branch.tanta)).toBe(true);
    const res = await place('delegated', machine.tanta1001 ?? '', {
      mode: 'pin',
      lat: 30.79,
      lng: 31.0,
      version: null,
    });
    expect(res.status).toBe(403);
  });

  it('an own viewer reads nothing', async () => {
    expect(await points('ownViewer')).toEqual([]);
    expect(
      (await okData<AtmMapContextDto>(call('get', '/atm/map/context', 'ownViewer'))).branches,
    ).toEqual([]);
  });

  it('an organization viewer narrowed by the top bar sees that branch only', async () => {
    const rows = await points('orgViewer', '', branch.tanta);
    expect(rows.every((p) => p.branchId === branch.tanta)).toBe(true);
    expect(rows).toHaveLength(2);
    const context = await okData<AtmMapContextDto>(
      call('get', '/atm/map/context', 'orgViewer', undefined, branch.tanta),
    );
    expect(context.organizationWide).toBe(false);
  });

  it('a browser branch only narrows: outside the reach is 400 OUT_OF_REACH', async () => {
    const res = await call('get', `/atm/map/points?branchId=${branch.tanta}`, 'alexViewer');
    expect(res.status).toBe(400);
    expect(detailsOf(res)).toContainEqual(
      expect.objectContaining({ field: 'query.branchId', code: 'OUT_OF_REACH' }),
    );
    const zonesRes = await call('get', `/atm/map/zones?branchId=${branch.tanta}`, 'alexViewer');
    expect(zonesRes.status).toBe(400);
    const narrowed = await points('orgViewer', `?branchId=${branch.tanta}`);
    expect(codes(narrowed)).toEqual(['1001', '1002']);
  });

  it('archived machines on request, deleted ones never', async () => {
    expect(codes(await points('alexViewer', '?status=archived'))).toEqual(['1004']);
    expect(codes(await points('alexViewer', '?status=all'))).toEqual([
      '1001',
      '1002',
      '1003',
      '1004',
    ]);
    for (const status of ['active', 'archived', 'all']) {
      const rows = await points('orgViewer', `?status=${status}`);
      expect(rows.some((p) => p.machineId === machine.alexDeleted)).toBe(false);
    }
  });
});

// ── 3. Context ──────────────────────────────────────────────────────────────────────────────────

describe('3. context', () => {
  const context = async (as: string, activeBranch?: string) =>
    okData<AtmMapContextDto>(call('get', '/atm/map/context', as, undefined, activeBranch));

  it('a branch user: their branch, nothing to edit or locate', async () => {
    const c = await context('alexViewer');
    expect(c.branches).toHaveLength(1);
    expect(c.branches[0]).toMatchObject({
      id: branch.alex,
      name: { ar: 'الإسكندرية', en: 'Alexandria' },
      canManageZones: false,
      canLocate: false,
    });
    expect(c.organizationWide).toBe(false);
    expect(c.editBranchId).toBeNull();
    expect(c.editBlocked).toBe('branchNotEditable');
    const editor = await context('alexEditor', branch.tanta);
    expect(editor.editBranchId).toBe(branch.alex);
    expect(editor.branches.map((x) => x.canManageZones)).toEqual([true]);
  });

  it('an organization user with a top bar edits that branch', async () => {
    const c = await context('orgEditor', branch.tanta);
    expect(c.editBranchId).toBe(branch.tanta);
    expect(c.editBlocked).toBeNull();
    expect(c.organizationWide).toBe(false);
    expect(c.branches.map((x) => x.id)).toEqual([branch.tanta]);
  });

  it('a placed organization user without a top bar must choose a branch', async () => {
    const c = await context('orgEditor');
    expect(c.editBranchId).toBeNull();
    expect(c.editBlocked).toBe('chooseBranch');
    expect(c.organizationWide).toBe(true);
    expect(c.branches.map((x) => x.id).sort()).toEqual(Object.values(branch).sort());
    expect(c.branches.every((x) => x.canManageZones && !x.canLocate)).toBe(true);
  });

  it('an own user: no branch at all', async () => {
    const c = await context('ownViewer');
    expect(c).toEqual({
      branches: [],
      organizationWide: false,
      editBranchId: null,
      editBlocked: 'branchNotEditable',
    });
  });
});

// ── 5. Sync ─────────────────────────────────────────────────────────────────────────────────────

describe('5. sync', () => {
  const s: Record<string, string> = {};
  const entryOf: Record<string, string> = {};

  beforeAll(async () => {
    const fixtures: [string, string, { url?: string | null; plusCode?: string | null } | null][] = [
      ['urlCoordinates', '1006', { url: 'https://www.google.com/maps?q=30.0444,31.2357' }],
      ['urlCoordinates2', '1007', { url: 'https://maps.google.com/?q=30.0500,31.2400' }],
      ['fullCode', '1008', { plusCode: '8G2H26VP+Q7' }],
      ['shortCode', '1009', { plusCode: '26VP+Q7 منطقة تجريبية' }],
      ['shortLink', '1010', { url: 'https://maps.app.goo.gl/SynSync1' }],
      ['otherLink', '1011', { url: 'https://example.com/branch/1011' }],
      ['viewport', '1012', { url: 'https://www.google.com/maps/@30.0600,31.2500,15z' }],
      ['unreadable', '1013', { plusCode: 'hello' }],
      ['empty', '1014', { url: null, plusCode: null }],
      ['noEntry', '1015', null],
      ['endedOnly', '1016', null],
      ['conflicting', '1017', null],
      ['detail', '1018', { url: 'https://www.google.com/maps?q=30.0450,31.2360' }],
    ];
    for (const [key, code, texts] of fixtures) {
      s[key] = await addMachine(branch.sync, code);
      if (texts !== null) {
        entryOf[key] = await addEntry(
          s[key] ?? '',
          branch.sync,
          code,
          texts,
          key === 'detail' ? { createdBy: oid(userIdOf.locatorNoReg ?? '') } : {},
        );
      }
    }
    await addEntry(
      s.endedOnly ?? '',
      branch.sync,
      '1016',
      {
        url: 'https://www.google.com/maps?q=30.0444,31.2357',
      },
      { status: 'ended', endDate: new Date('2026-07-01T00:00:00.000Z') },
    );
    // An exempt duplicate-open pair whose AV texts differ (EG-8).
    for (const url of [
      'https://www.google.com/maps?q=30.01,31.01',
      'https://www.google.com/maps?q=30.02,31.02',
    ]) {
      await addEntry(s.conflicting ?? '', branch.sync, '1017', { url }, { openPeriodExempt: true });
    }
    // A short code in a branch with no located pin at all.
    s.lonelyShortCode = await addMachine(branch.empty, '1019');
    await addEntry(s.lonelyShortCode, branch.empty, '1019', { plusCode: '26VP+Q7' });
  });

  it('derives every kind of register text', async () => {
    const result = await syncOk('locator', branch.sync);
    expect(result).toMatchObject({ processed: 13, changed: 13, kept: 0, conflicts: 0 });
    expect(result.located + result.review + result.unlocated).toBe(13);

    const expectDoc = async (
      key: string,
      want: Partial<AtmMachineLocationDoc>,
    ): Promise<AtmMachineLocationDoc> => {
      const doc = await locationOf(s[key] ?? '');
      expect(doc, key).not.toBeNull();
      expect(doc, key).toMatchObject(want);
      return doc as AtmMachineLocationDoc;
    };
    await expectDoc('urlCoordinates', {
      status: 'located',
      source: 'registerUrl',
      lat: 30.0444,
      lng: 31.2357,
      needsReview: false,
      warnings: [],
      pinned: false,
    });
    await expectDoc('fullCode', {
      status: 'located',
      source: 'registerPlusCode',
      needsReview: false,
    });
    const short = await expectDoc('shortCode', {
      status: 'located',
      source: 'registerShortCode',
      needsReview: true,
      warnings: [],
    });
    expect(short.reference).toMatchObject({ basis: 'area', machines: 4 });
    const link = await expectDoc('shortLink', { status: 'unlocated', reason: 'shortLink' });
    expect(link.shortLink).toMatchObject({
      url: 'https://maps.app.goo.gl/SynSync1',
      status: 'pending',
      attempts: 0,
    });
    await expectDoc('otherLink', { status: 'unlocated', reason: 'noCoordinates', shortLink: null });
    await expectDoc('viewport', {
      status: 'located',
      source: 'registerUrl',
      needsReview: true,
      warnings: ['viewportOnly'],
    });
    await expectDoc('unreadable', { status: 'unlocated', reason: 'unreadable' });
    await expectDoc('empty', { status: 'unlocated', reason: 'none' });
    await expectDoc('noEntry', { status: 'unlocated', reason: 'noEntry', seenText: null });
    await expectDoc('endedOnly', { status: 'unlocated', reason: 'noEntry', seenText: null });
    const conflicting = await expectDoc('conflicting', {
      status: 'unlocated',
      reason: 'conflictingEntries',
      seenText: null,
    });
    expect(conflicting.seenEntryIds).toHaveLength(2);

    const lonely = await syncOk('locator', branch.empty);
    expect(lonely).toMatchObject({ processed: 1, changed: 1, unlocated: 1 });
    await expectDoc('lonelyShortCode', { status: 'unlocated', reason: 'shortPlusCodeNoReference' });
  });

  it('writes exactly one run audit row listing every changed machine', async () => {
    const runs = await auditsOf({
      'entityRef.entityType': 'mapLocationSync',
      action: 'atmMapLocationSync',
    });
    const ofBranch = runs.filter((row) =>
      row.changes.some(
        (c) => c.field === 'branchIds' && JSON.stringify(c.new) === JSON.stringify([branch.sync]),
      ),
    );
    expect(ofBranch).toHaveLength(1);
    const changed = ofBranch[0]?.changes.find((c) => c.field === 'changedMachineIds')
      ?.new as string[];
    const syncMachines = Object.entries(s)
      .filter(([key]) => key !== 'lonelyShortCode')
      .map(([, id]) => id);
    expect([...changed].sort()).toEqual(syncMachines.sort());
  });

  it('a second sync changes nothing, and moves «آخر مزامنة»', async () => {
    const before = await summary('locator', `?branchId=${branch.sync}`);
    const again = await syncOk('locator', branch.sync);
    expect(again).toMatchObject({ processed: 13, changed: 0, conflicts: 0, kept: 13 });
    const after = await summary('locator', `?branchId=${branch.sync}`);
    expect(after.lastSyncAt).not.toBeNull();
    expect(new Date(after.lastSyncAt ?? 0).getTime()).toBeGreaterThan(
      new Date(before.lastSyncAt ?? 0).getTime(),
    );
    const derived = await AtmMachineLocationModel.distinct('derivedAt', {
      branchId: oid(branch.sync),
    }).exec();
    expect(derived.map((d) => new Date(d as Date).toISOString())).toEqual([after.lastSyncAt]);
  });

  it('a pinned point the sync replaces gets its own machineLocation update audit', async () => {
    const id = s.urlCoordinates ?? '';
    const loaded = await detail('locator', id);
    await okData(
      place('locator', id, {
        mode: 'pin',
        lat: 30.0445,
        lng: 31.2358,
        version: loaded.version,
      }),
    );
    await AtmRegisterEntryModel.updateOne(
      { _id: oid(entryOf.urlCoordinates ?? '') },
      { $set: { locationUrl: 'https://www.google.com/maps?q=30.0460,31.2370' } },
    ).exec();
    const result = await syncOk('locator', branch.sync);
    // The short code's reference moves with this pin too (DM-34), so more than one may change.
    expect(result.changed).toBeGreaterThanOrEqual(1);
    const doc = await locationOf(id);
    expect(doc).toMatchObject({
      lat: 30.046,
      lng: 31.237,
      source: 'registerUrl',
      pinned: false,
      pinText: null,
    });
    const trail = await auditsOf({
      'entityRef.entityType': 'machineLocation',
      'entityRef.entityId': id,
      action: 'update',
    });
    expect(trail.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        { field: 'lat', old: 30.0445, new: 30.046 },
        { field: 'source', old: 'manual', new: 'registerUrl' },
        { field: 'pinned', old: true, new: false },
      ]),
    );
  });

  it('version guard: a pin placed between the load and the write survives, as one conflict', async () => {
    // The machine that had no open entry gets one, so this sync has a write to make for it.
    const id = s.noEntry ?? '';
    await addEntry(id, branch.sync, '1015', {
      url: 'https://www.google.com/maps?q=30.0470,31.2380',
    });
    setSyncBeforeWriteForTests(async () => {
      const loaded = await detail('locator', id);
      await okData(
        place('locator', id, { mode: 'pin', lat: 30.05, lng: 31.24, version: loaded.version }),
      );
    });
    let result: AtmMapSyncResultDto;
    try {
      result = await syncOk('locator', branch.sync);
    } finally {
      setSyncBeforeWriteForTests(null);
    }
    expect(result.conflicts).toBe(1);
    expect(await locationOf(id)).toMatchObject({
      source: 'manual',
      lat: 30.05,
      lng: 31.24,
      pinned: true,
    });
  });

  it('the batch error contract (routes 7 and 8)', async () => {
    for (const path of ['/atm/map/locations/sync', '/atm/map/locations/resolve-links']) {
      expect((await call('post', path, 'deptLocator', {})).status, path).toBe(403);
      expect(
        (await call('post', path, 'deptLocator', { branchId: branch.alex })).status,
        path,
      ).toBe(403);
      const outside = await call('post', path, 'alexLocator', { branchId: branch.tanta });
      expect(outside.status, path).toBe(400);
      expect(detailCodes(outside)).toEqual(['OUT_OF_REACH']);
      expect((await call('post', path, 'mixed', { branchId: branch.tanta })).status, path).toBe(
        403,
      );
    }
  });

  it('the register rows the feature reads carry no keys, notes or combination', async () => {
    const rows = await openEntryLocationTexts([
      oid(s.urlCoordinates ?? ''),
      oid(s.conflicting ?? ''),
    ]);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        '_id',
        'locationPlusCode',
        'locationUrl',
        'machineId',
      ]);
    }
    const text = JSON.stringify(rows);
    expect(text).not.toContain(KEY_CODE);
    expect(text).not.toContain(NOTE);
  });
});

// ── 6. Precedence (DM-2), through the register's own routes ────────────────────────────────────

describe('6. precedence', () => {
  let entryId = '';
  let machineId = '';

  const editEntry = async (body: Record<string, unknown>) => {
    const entry = await okData<AtmRegisterEntryDto>(
      call('get', `/atm/register/entries/${entryId}`, 'admin'),
    );
    await okData(
      call('patch', `/atm/register/entries/${entryId}`, 'admin', {
        ...body,
        version: entry.version,
      }),
    );
  };
  const pin = async (lat: number, lng: number) => {
    const loaded = await detail('locator', machineId);
    return okData<AtmMachineLocationDetailDto>(
      place('locator', machineId, {
        mode: 'pin',
        lat,
        lng,
        version: loaded.version,
        reason: 'SYN',
      }),
    );
  };

  beforeAll(async () => {
    // A receipt needs its branch mapped to an EGYCASH code (register D4).
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.RegisterBranchCodes,
      scope: 'organization',
      value: [{ code: 'EGYCASH-5', branchId: branch.prec }],
    });
    const received = await okData<AtmRegisterWriteResultDto>(
      call('post', '/atm/register/entries', 'admin', {
        branchId: branch.prec,
        bankCode: 'NBE',
        area: 'منطقة تجريبية 2',
        name: 'ماكينة تجريبية 1049',
        machineCode: '1049',
        startDate: '2026-09-01',
        locationUrl: 'https://www.google.com/maps?q=30.3000,31.3000',
      }),
      201,
    );
    entryId = received.entry.id;
    machineId = received.master.machineId ?? '';
    await syncOk('locator', branch.prec);
  });

  it('a manual pin + a sync over the same text: the pin is kept', async () => {
    await pin(30.31, 31.31);
    expect((await syncOk('locator', branch.prec)).changed).toBe(0);
    expect(await locationOf(machineId)).toMatchObject({ lat: 30.31, lng: 31.31, pinned: true });
  });

  it('a changed AP + a sync: re-derived', async () => {
    await editEntry({ locationPlusCode: '8G2H26VP+Q7' });
    expect((await syncOk('locator', branch.prec)).changed).toBe(1);
    expect(await locationOf(machineId)).toMatchObject({
      lat: 30.3,
      lng: 31.3,
      source: 'registerUrl',
      pinned: false,
    });
  });

  it('AP and AV cleared + a sync: the pin is kept, seenText follows, pinText does not', async () => {
    await pin(30.32, 31.32);
    const pinText = (await locationOf(machineId))?.pinText;
    expect(pinText).toEqual({
      url: 'https://www.google.com/maps?q=30.3000,31.3000',
      plusCode: '8G2H26VP+Q7',
    });
    await editEntry({ locationPlusCode: '', locationUrl: '' });
    await syncOk('locator', branch.prec);
    const doc = await locationOf(machineId);
    expect(doc).toMatchObject({ lat: 30.32, lng: 31.32, pinned: true, source: 'manual' });
    expect(doc?.seenText).toEqual({ url: null, plusCode: null });
    expect(doc?.pinText).toEqual(pinText);
  });

  it('a re-receipt with the same text, then one sync: nothing waits for a sync', async () => {
    const receipt = {
      branchId: branch.prec,
      bankCode: 'NBE',
      area: 'منطقة تجريبية 2',
      name: 'ماكينة تجريبية 1050',
      machineCode: '1050',
      locationUrl: 'https://www.google.com/maps?q=30.3300,31.3300',
    };
    const first = await okData<AtmRegisterWriteResultDto>(
      call('post', '/atm/register/entries', 'admin', { ...receipt, startDate: '2026-09-01' }),
      201,
    );
    await syncOk('locator', branch.prec);
    expect((await summary('locator', `?branchId=${branch.prec}`)).pendingSync).toBe(0);
    await okData(
      call('post', `/atm/register/entries/${first.entry.id}/handover`, 'admin', {
        endDate: '2026-09-20',
        version: first.entry.version,
      }),
    );
    const again = await okData<AtmRegisterWriteResultDto>(
      call('post', '/atm/register/entries', 'admin', { ...receipt, startDate: '2026-09-21' }),
      201,
    );
    expect(again.master).toMatchObject({ action: 'reactivate', machineId: first.master.machineId });
    expect((await summary('locator', `?branchId=${branch.prec}`)).pendingSync).toBe(1);
    await syncOk('locator', branch.prec);
    expect((await summary('locator', `?branchId=${branch.prec}`)).pendingSync).toBe(0);
  });
});

// ── 7. Pins ─────────────────────────────────────────────────────────────────────────────────────

describe('7. pins', () => {
  it('PUT with version null creates, audited per machine', async () => {
    const id = machine.alex1001 ?? '';
    const created = await okData<AtmMachineLocationDetailDto>(
      place('locator', id, { mode: 'pin', lat: 30.0444, lng: 31.2357, version: null }),
    );
    expect(created).toMatchObject({
      version: 0,
      state: 'located',
      source: 'manual',
      pinned: true,
      needsReview: false,
      lat: 30.0444,
      lng: 31.2357,
    });
    const audits = await auditsOf({
      'entityRef.entityType': 'machineLocation',
      'entityRef.entityId': id,
    });
    expect(audits.map((row) => row.action)).toEqual(['create']);
  });

  it('a stale version is 409, and so is version null over an existing document', async () => {
    const id = machine.alex1001 ?? '';
    for (const version of [5, null]) {
      const res = await place('locator', id, { mode: 'pin', lat: 30.0444, lng: 31.2357, version });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('STALE_DOCUMENT');
    }
  });

  it('a move of 1000.76 m needs a reason; one of 989.64 m does not', async () => {
    const id = machine.alex1001 ?? '';
    const loaded = await detail('locator', id);
    const far = await place('locator', id, {
      mode: 'pin',
      lat: 30.0534,
      lng: 31.2357,
      version: loaded.version,
    });
    expect(far.status).toBe(400);
    expect(detailsOf(far)).toContainEqual(
      expect.objectContaining({ field: 'body.reason', code: 'REQUIRED' }),
    );
    const near = await okData<AtmMachineLocationDetailDto>(
      place('locator', id, { mode: 'pin', lat: 30.0533, lng: 31.2357, version: loaded.version }),
    );
    expect(near.lat).toBe(30.0533);
    const audits = await auditsOf({ 'entityRef.entityId': id, action: 'update' });
    expect(audits.at(-1)?.changes).toContainEqual({ field: 'distanceMeters', old: null, new: 990 });
  });

  it('text mode: a short link is 400, a moved parse is 409, a pasted short code is the review', async () => {
    const id = machine.alex1002 ?? '';
    const link = await place('locator', id, {
      mode: 'text',
      text: 'https://maps.app.goo.gl/SynPaste',
      expected: { lat: 30, lng: 31 },
      version: null,
    });
    expect(link.status).toBe(400);
    expect(detailsOf(link)).toContainEqual(
      expect.objectContaining({ field: 'body.text', code: 'shortLink' }),
    );

    const moved = await place('locator', id, {
      mode: 'text',
      text: '30.0444, 31.2357',
      expected: { lat: 30.044445, lng: 31.2357 },
      version: null,
    });
    expect(moved.status).toBe(409);
    expect(errorCode(moved)).toBe('ATM_MAP_PARSE_CHANGED');

    const short = machine.alex1003 ?? '';
    const preview = await okData<AtmMapParseResultDto>(
      call('post', '/atm/map/locations/parse', 'locator', { machineId: short, text: '26VP+Q7' }),
    );
    expect(preview).toMatchObject({ ok: true, kind: 'shortPlusCode', needsReview: true });
    if (!preview.ok) return;
    const confirmed = await okData<AtmMachineLocationDetailDto>(
      place('locator', short, {
        mode: 'text',
        text: '26VP+Q7',
        expected: { lat: preview.lat, lng: preview.lng },
        version: null,
      }),
    );
    expect(confirmed).toMatchObject({
      needsReview: false,
      pinned: true,
      source: 'manual',
      manualText: '26VP+Q7',
    });
    expect(confirmed.reviewedAt).not.toBeNull();
    expect(String((await locationOf(short))?.reviewedBy)).toBe(userIdOf.locator);
  });

  describe('approval', () => {
    const r: Record<string, string> = {};
    const entryOf: Record<string, string> = {};

    beforeAll(async () => {
      const viewports: [string, string, string][] = [
        ['plain', '1021', 'https://www.google.com/maps/@30.1000,31.1000,15z'],
        ['movedBySync', '1022', 'https://www.google.com/maps/@30.1100,31.1100,15z'],
        ['textChanged', '1020', 'https://www.google.com/maps/@30.1300,31.1300,15z'],
      ];
      for (const [key, code, url] of viewports) {
        r[key] = await addMachine(branch.review, code);
        entryOf[key] = await addEntry(r[key] ?? '', branch.review, code, { url });
      }
      await syncOk('locator', branch.review);
    });

    it('approves a review pin once; a second approval is 422', async () => {
      const loaded = await detail('locator', r.plain ?? '');
      expect(loaded).toMatchObject({
        state: 'review',
        needsReview: true,
        warnings: ['viewportOnly'],
      });
      const approved = await okData<AtmMachineLocationDetailDto>(
        call('post', `/atm/map/machines/${r.plain ?? ''}/location/approve`, 'locator', {
          version: loaded.version,
        }),
      );
      expect(approved).toMatchObject({ needsReview: false, pinned: true, state: 'located' });
      const again = await call(
        'post',
        `/atm/map/machines/${r.plain ?? ''}/location/approve`,
        'locator',
        {
          version: approved.version,
        },
      );
      expect(again.status).toBe(422);
      expect(errorCode(again)).toBe('ATM_MAP_NOT_UNDER_REVIEW');
      const point = (await points('locator', `?branchId=${branch.review}`)).find(
        (p) => p.machineId === r.plain,
      );
      expect(point?.lastSet?.kind).toBe('approved');
    });

    it('the version loaded before a sync moved the point is 409 STALE_DOCUMENT', async () => {
      const loaded = await detail('locator', r.movedBySync ?? '');
      await AtmRegisterEntryModel.updateOne(
        { _id: oid(entryOf.movedBySync ?? '') },
        { $set: { locationUrl: 'https://www.google.com/maps/@30.1200,31.1200,15z' } },
      ).exec();
      await syncOk('locator', branch.review);
      const res = await call(
        'post',
        `/atm/map/machines/${r.movedBySync ?? ''}/location/approve`,
        'locator',
        {
          version: loaded.version,
        },
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('STALE_DOCUMENT');
    });

    it('a register text that moved without a sync is 409 ATM_MAP_SOURCE_CHANGED', async () => {
      const loaded = await detail('locator', r.textChanged ?? '');
      await AtmRegisterEntryModel.updateOne(
        { _id: oid(entryOf.textChanged ?? '') },
        { $set: { locationUrl: 'https://www.google.com/maps/@30.1400,31.1400,15z' } },
      ).exec();
      const res = await call(
        'post',
        `/atm/map/machines/${r.textChanged ?? ''}/location/approve`,
        'locator',
        {
          version: loaded.version,
        },
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ATM_MAP_SOURCE_CHANGED');
    });
  });

  it('a key that does not reach the branch is 403; a machine outside the read scope is 404', async () => {
    const body = { mode: 'pin', lat: 30.79, lng: 31.0, version: null };
    expect((await place('mixed', machine.tanta1001 ?? '', body)).status).toBe(403);
    expect((await place('alexLocator', machine.tanta1001 ?? '', body)).status).toBe(404);
    expect(
      (await call('get', `/atm/map/machines/${machine.tanta1001 ?? ''}/location`, 'alexLocator'))
        .status,
    ).toBe(404);
  });

  it('the points carry only their allowlisted fields', async () => {
    const rows = await points('locator', `?branchId=${branch.alex}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'active',
          'area',
          'bankCode',
          'bankName',
          'branchId',
          'code',
          'lastSet',
          'lat',
          'lng',
          'machineId',
          'name',
          'reason',
          'source',
          'state',
          'warnings',
        ].sort(),
      );
    }
    const text = JSON.stringify(rows);
    for (const field of [
      'sourceText',
      'seenText',
      'pinText',
      'manualText',
      'moveReason',
      'shortLink',
    ]) {
      expect(text).not.toContain(field);
    }
    expect(text).not.toContain('26VP+Q7');
    expect(rows.find((p) => p.machineId === machine.alex1001)?.lastSet?.kind).toBe('moved');
  });
});

// ── 8. Detail ───────────────────────────────────────────────────────────────────────────────────

describe('8. detail', () => {
  it('shows the source text with atmRegister.view, never to the entry’s mere creator', async () => {
    const id = (
      await AtmMachineModel.findOne({ branchId: oid(branch.sync), machineCode: '1018' })
        .lean()
        .exec()
    )?._id;
    const withKey = await detail('locator', String(id));
    expect(withKey.sourceVisible).toBe(true);
    expect(withKey.sourceText).toEqual({
      url: 'https://www.google.com/maps?q=30.0450,31.2360',
      plusCode: null,
    });
    const creator = await detail('locatorNoReg', String(id));
    expect(creator.sourceVisible).toBe(false);
    expect(creator.sourceText).toBeNull();
  });
});

// ── 9. Resolver (fake DNS and hops — never the network) ─────────────────────────────────────────

describe('9. resolver', () => {
  const requested: string[] = [];
  const fake: ShortLinkDeps = {
    lookup: async () => ['142.250.74.46'],
    hop: async (url) => {
      requested.push(url.pathname);
      const fail = url.pathname.includes('Fail');
      return {
        status: fail ? 404 : 302,
        location: fail
          ? null
          : 'https://www.google.com/maps/place/SYN/@30.2,31.3,17z/data=!3d30.2!4d31.3',
        cancel: async () => undefined,
      };
    },
    sleep: async () => undefined,
    now: () => Date.now(),
  };
  const l: Record<string, string> = {};
  const resolve = (as = 'locator', branchId = branch.links): request.Test =>
    call('post', '/atm/map/locations/resolve-links', as, { branchId });

  beforeAll(async () => {
    setShortLinkDepsForTests(fake);
    // 25 active machines — the first one's link fails — and one archived with a pending link.
    for (let n = 0; n < 26; n += 1) {
      const code = String(1023 + n);
      const id = await addMachine(branch.links, code);
      l[code] = id;
      const path = n === 0 ? 'SynLinkFail' : n === 25 ? 'SynArchived' : `SynLink${String(n)}`;
      await addEntry(id, branch.links, code, { url: `https://maps.app.goo.gl/${path}` });
    }
    expect((await syncOk('locator', branch.links)).unlocated).toBe(26);
    await AtmMachineModel.updateOne(
      { _id: oid(l['1048'] ?? '') },
      { $set: { isActive: false } },
    ).exec();
  });

  afterAll(() => {
    setShortLinkDepsForTests(null);
  });

  let firstRun: AtmMapLinkResolveResultDto;

  it('opens 20 links of 25 in one call', async () => {
    firstRun = await okData<AtmMapLinkResolveResultDto>(resolve());
    expect(firstRun).toMatchObject({
      attempted: 20,
      remaining: 5,
      conflicts: 0,
      busy: false,
      stopReason: null,
    });
    expect(firstRun.resolved + firstRun.failed).toBe(20);
    expect(requested).toHaveLength(20);
  });

  it('writes one run audit row, with no URL in it', async () => {
    const rows = await auditsOf({
      'entityRef.entityType': 'mapLinkResolution',
      action: 'atmMapLinkResolve',
    });
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]?.changes);
    expect(text).not.toContain('goo.gl');
    expect(text).not.toContain('https');
    expect(text).not.toContain('SynLink');
    const outcomes = rows[0]?.changes.find((c) => c.field === 'outcomes')?.new as unknown[];
    expect(outcomes).toHaveLength(20);
  });

  it('one pass: the next call opens the remaining 5, and no link is ever opened twice', async () => {
    const run = await okData<AtmMapLinkResolveResultDto>(resolve());
    expect(run).toMatchObject({ attempted: 5, remaining: 0 });
    expect(firstRun.failed + run.failed).toBe(1);
    expect(firstRun.resolved + run.resolved).toBe(24);
    expect(requested).toHaveLength(25);
    expect(new Set(requested).size).toBe(25);
    const idle = await okData<AtmMapLinkResolveResultDto>(resolve());
    expect(idle).toMatchObject({ attempted: 0, remaining: 0 });
    expect(requested).toHaveLength(25);
  });

  it('stores what each link gave: a failure with its code, a point as registerShortLink', async () => {
    const failed = await locationOf(l['1023'] ?? '');
    expect(failed).toMatchObject({ status: 'unlocated', reason: 'shortLinkFailed' });
    expect(failed?.shortLink).toMatchObject({
      status: 'failed',
      failure: 'httpStatus',
      attempts: 1,
    });
    const resolved = await locationOf(l['1024'] ?? '');
    expect(resolved).toMatchObject({
      status: 'located',
      source: 'registerShortLink',
      lat: 30.2,
      lng: 31.3,
      needsReview: false,
    });
    expect(resolved?.shortLink).toMatchObject({ status: 'resolved', attempts: 1, claimedAt: null });
  });

  it('the link of an archived machine is never selected', async () => {
    expect(requested).not.toContain('/SynArchived');
    expect((await locationOf(l['1048'] ?? ''))?.shortLink).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
  });

  it('a call while the lease is held answers busy and touches nothing', async () => {
    await getCache().set(RESOLVE_LEASE_KEY, 'another-run', 60);
    try {
      const run = await okData<AtmMapLinkResolveResultDto>(resolve());
      expect(run).toMatchObject({ attempted: 0, busy: true });
    } finally {
      await getCache().del(RESOLVE_LEASE_KEY);
    }
  });

  it('the 11th call in a minute by one user is 429', async () => {
    for (let i = 0; i < 10; i += 1) expect((await resolve()).status).toBe(200);
    expect((await resolve()).status).toBe(429);
  });
});

// ── 10. Summary ─────────────────────────────────────────────────────────────────────────────────

describe('10. summary', () => {
  it('counts what the points show, inside the view ∩ locate-writable scope', async () => {
    const counts = (rows: AtmMapPointDto[]) => ({
      totalActive: rows.length,
      located: rows.filter((p) => p.state === 'located').length,
      review: rows.filter((p) => p.state === 'review').length,
      unlocated: rows.filter((p) => p.state === 'unlocated').length,
    });
    const syncRows = await points('locator', `?branchId=${branch.sync}`);
    expect(await summary('locator', `?branchId=${branch.sync}`)).toMatchObject(counts(syncRows));

    // Readable everywhere, writable in Alex: the summary is Alex's.
    const alexRows = await points('mixed', `?branchId=${branch.alex}`);
    expect(await summary('mixed')).toMatchObject(counts(alexRows));
    expect((await summary('deptLocator')).totalActive).toBe(0);
  });

  it('pendingSync sees a machine created after the sync and an entry whose AV changed', async () => {
    await syncOk('locator', branch.sync);
    const base = (await summary('locator', `?branchId=${branch.sync}`)).pendingSync;
    await addMachine(branch.sync, '1001');
    const fullCode = await AtmMachineModel.findOne({
      branchId: oid(branch.sync),
      machineCode: '1008',
    })
      .lean()
      .exec();
    await AtmRegisterEntryModel.updateOne(
      { machineId: fullCode?._id, status: 'open' },
      { $set: { locationUrl: 'https://www.google.com/maps?q=30.0490,31.2390' } },
    ).exec();
    expect((await summary('locator', `?branchId=${branch.sync}`)).pendingSync).toBe(base + 2);
  });
});

// ── 11. Indexes (the fleet-indexes trap: autoIndex is off outside development) ─────────────────

describe('11. indexes', () => {
  it('builds the five map indexes the boot step owns, then reports them present', async () => {
    const owned: [Model<never>, string][] = [
      [AtmMachineLocationModel as unknown as Model<never>, 'ux_machine'],
      [AtmMapZoneSetModel as unknown as Model<never>, 'ux_branch'],
      [AtmMapZoneModel as unknown as Model<never>, 'ix_branch_order'],
      [AtmMachineLocationModel as unknown as Model<never>, 'ix_branch_status'],
      [AtmMachineLocationModel as unknown as Model<never>, 'ix_branch_link'],
    ];
    for (const [model, name] of owned) await model.collection.dropIndex(name);
    const first = await migrateAtmIndexes();
    expect(first.built).toBeGreaterThanOrEqual(5);
    for (const [model, name] of owned) {
      const names = (await model.collection.listIndexes().toArray()).map((i) => String(i.name));
      expect(names, name).toContain(name);
    }
    const second = await migrateAtmIndexes();
    expect(second.built).toBe(0);
    expect(second.alreadyPresent).toBeGreaterThanOrEqual(first.alreadyPresent + 5);
  });
});

// ── 12. Faults and the fixed point ──────────────────────────────────────────────────────────────

describe('12. faults', () => {
  const pinned = async (id: string, lat: number, lng: number): Promise<void> => {
    const loaded = await detail('locator', id);
    await okData(place('locator', id, { mode: 'pin', lat, lng, version: loaded.version }));
  };
  const trailOf = async (id: string) =>
    auditsOf({ 'entityRef.entityType': 'machineLocation', 'entityRef.entityId': id });
  const point = 'https://www.google.com/maps/place/SYN/@30.5,31.5,17z/data=!3d30.5!4d31.5';

  it('a sync that fails part-way keeps its run row and the replaced pin’s own trail', async () => {
    const id = await addMachine(branch.faults, 'SYN-F1');
    const entry = await addEntry(id, branch.faults, 'SYN-F1', {
      url: 'https://www.google.com/maps?q=30.1,31.1',
    });
    await syncOk('locator', branch.faults);
    await pinned(id, 30.101, 31.101);
    await AtmRegisterEntryModel.updateOne(
      { _id: oid(entry) },
      { $set: { locationUrl: 'https://www.google.com/maps?q=30.2,31.2' } },
    ).exec();
    const before = (await trailOf(id)).length;
    const runsBefore = await AuditLogModel.countDocuments({ action: 'atmMapLocationSync' }).exec();
    // A transient database error after the pin's write landed («آخر مزامنة», step 5).
    const updateMany = vi
      .spyOn(AtmMachineLocationModel, 'updateMany')
      .mockImplementationOnce(() => {
        throw new Error('simulated MongoNetworkError');
      });
    let status = 0;
    try {
      status = (await sync('locator', branch.faults)).status;
    } finally {
      updateMany.mockRestore();
    }
    expect(status).toBe(500);
    expect(await locationOf(id)).toMatchObject({ lat: 30.2, lng: 31.2, pinned: false });
    const trail = await trailOf(id);
    expect(trail).toHaveLength(before + 1);
    expect(trail.at(-1)?.changes).toEqual(
      expect.arrayContaining([{ field: 'pinned', old: true, new: false }]),
    );
    const runs = await auditsOf({ action: 'atmMapLocationSync' });
    expect(runs).toHaveLength(runsBefore + 1);
    expect(runs.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        { field: 'changedMachineIds', old: null, new: [id] },
        { field: 'failed', old: null, new: true },
      ]),
    );
  });

  it('a resolver run that fails part-way keeps its run row and the replaced pin’s own trail', async () => {
    const first = await addMachine(branch.faults, 'SYN-F2');
    const firstEntry = await addEntry(first, branch.faults, 'SYN-F2', {
      url: 'https://www.google.com/maps?q=30.1,31.1',
    });
    const second = await addMachine(branch.faults, 'SYN-F3');
    await addEntry(second, branch.faults, 'SYN-F3', { url: 'https://maps.app.goo.gl/SynFault2' });
    await syncOk('locator', branch.faults);
    await pinned(first, 30.101, 31.101);
    // The AV becomes a short link; the sync queues it and keeps the pin (row 5).
    await AtmRegisterEntryModel.updateOne(
      { _id: oid(firstEntry) },
      { $set: { locationUrl: 'https://maps.app.goo.gl/SynFault1' } },
    ).exec();
    await syncOk('locator', branch.faults);
    expect((await locationOf(first))?.shortLink?.status).toBe('pending');
    // The second link's claim meets a transient database error.
    await AtmMachineLocationModel.updateOne(
      { machineId: oid(second) },
      { $set: { 'shortLink.lastAttemptAt': new Date('2099-01-01T00:00:00.000Z') } },
    ).exec();
    setShortLinkDepsForTests({
      lookup: async () => ['142.250.74.46'],
      hop: async () => ({ status: 302, location: point, cancel: async () => undefined }),
      sleep: async () => undefined,
      now: () => Date.now(),
    });
    const claim = AtmMachineLocationModel.findOneAndUpdate.bind(AtmMachineLocationModel);
    let claims = 0;
    const spy = vi.spyOn(AtmMachineLocationModel, 'findOneAndUpdate').mockImplementation(((
      ...args: Parameters<typeof claim>
    ) => {
      claims += 1;
      if (claims === 2) throw new Error('simulated MongoNetworkError');
      return claim(...args);
    }) as never);
    const before = (await trailOf(first)).length;
    const runsBefore = await AuditLogModel.countDocuments({ action: 'atmMapLinkResolve' }).exec();
    let status = 0;
    try {
      status = (
        await call('post', '/atm/map/locations/resolve-links', 'locator', {
          branchId: branch.faults,
        })
      ).status;
    } finally {
      spy.mockRestore();
      setShortLinkDepsForTests(null);
    }
    expect(status).toBe(500);
    expect(await locationOf(first)).toMatchObject({ lat: 30.5, lng: 31.5, pinned: false });
    expect(await trailOf(first)).toHaveLength(before + 1);
    const runs = await auditsOf({ action: 'atmMapLinkResolve' });
    expect(runs).toHaveLength(runsBefore + 1);
    const counts = runs.at(-1)?.changes.find((c) => c.field === 'counts')?.new;
    expect(counts).toMatchObject({ attempted: 1, resolved: 1, stopReason: 'error' });
    expect(runs.at(-1)?.changes.find((c) => c.field === 'outcomes')?.new).toEqual([
      { machineId: first, status: 'resolved', failure: null },
    ]);
    // The lease went with the run: the next call is not busy.
    expect(await getCache().get(RESOLVE_LEASE_KEY)).toBeNull();
  });

  it('the lease is released only while it is still this run’s', async () => {
    const id = await addMachine(branch.faults, 'SYN-F4');
    await addEntry(id, branch.faults, 'SYN-F4', { url: 'https://maps.app.goo.gl/SynFault4' });
    await syncOk('locator', branch.faults);
    // The run outlives its lease, which another run then takes.
    setShortLinkDepsForTests({
      lookup: async () => ['142.250.74.46'],
      hop: async () => {
        await getCache().set(RESOLVE_LEASE_KEY, 'successor', 60);
        return { status: 302, location: point, cancel: async () => undefined };
      },
      sleep: async () => undefined,
      now: () => Date.now(),
    });
    try {
      const run = await okData<AtmMapLinkResolveResultDto>(
        call('post', '/atm/map/locations/resolve-links', 'locator', { branchId: branch.faults }),
      );
      expect(run.busy).toBe(false);
      expect(run.resolved).toBeGreaterThan(0);
      expect(await getCache().get(RESOLVE_LEASE_KEY)).toBe('successor');
    } finally {
      setShortLinkDepsForTests(null);
      await getCache().del(RESOLVE_LEASE_KEY);
    }
  });

  it('a first sync already flags an AP short code far from the AV pin; the next one writes nothing', async () => {
    // Three trustworthy pins around (30.10, 31.30), then X: an AV pin and an AP short code for a
    // spot ≈ 3.6 km away (DM-44c).
    const basis: [string, string][] = [
      ['SYN-I1', '30.100000,31.300000'],
      ['SYN-I2', '30.101000,31.301000'],
      ['SYN-I3', '30.099000,31.299000'],
    ];
    for (const [code, q] of basis) {
      await addEntry(await addMachine(branch.idem, code), branch.idem, code, {
        url: `https://www.google.com/maps?q=${q}`,
      });
    }
    const x = await addMachine(branch.idem, 'SYN-I4');
    await addEntry(x, branch.idem, 'SYN-I4', {
      url: 'https://www.google.com/maps?q=30.100000,31.310000',
      plusCode: encode(30.08, 31.28).slice(4),
    });
    const first = await syncOk('locator', branch.idem);
    expect(first).toMatchObject({ processed: 4, changed: 4, located: 3, review: 1 });
    expect(await locationOf(x)).toMatchObject({
      source: 'registerUrl',
      needsReview: true,
      warnings: ['sourcesDisagree'],
    });
    expect(await syncOk('locator', branch.idem)).toMatchObject({ changed: 0, kept: 4 });
  });
});
