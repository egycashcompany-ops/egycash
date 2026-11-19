// «عداد الطابعة» over real HTTP with real RBAC — «عند صرف الصنف : حبارة أو النوع : حبارات .. عايز يبقى
// فى Counter لعدد لورق المطبوع للطابعة اللى بيركب عليها الحبارة — يعني إجبارى أدخل عدد الورق المطبوع
// عند تركيب الحبارة», and «وأكيد مش هيدخل عدد ورق أقل أو مساوي للى موجود» (owner, 2026-11-19).
//
// What a mocked spec cannot see: the flag on the type as the catalog stores it, the refusals as the
// screen receives them (the codes and their figures), the readings read back through both endpoints
// and the ledger — paired by item name across two stores, computed system-wide for a branch
// reader — the scopes and grants as the router applies them, and the printer's lock doing its work:
// two writes on one printer at once, of which exactly one may land.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ApiErrorDetail,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItConsumableCartridgesDto,
  type ItConsumableDto,
  type ItConsumableIssueResultDto,
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
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
// itAsset.view + itConsumable.view at BRANCH scope, placed in branch A
let branchReaderToken: string;
// itConsumable.view at BRANCH scope, placed in branch A — and NO asset grant
let storeViewerToken: string;
let branchAId: string;
let branchBId: string;
let tonerTypeId: string;
let cableTypeId: string;
let categoryId: string;

const EMPLOYEE = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-consumables-counter-test-${Date.now()}`;
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
const failure = (res: request.Response) =>
  (res.body as { error: { code: string; message: string; details?: ApiErrorDetail[] } }).error;

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body: Record<string, unknown>, token = adminToken) =>
    request(app).patch(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
};

let names = 0;
/** A toner of the counted type, in a branch's store, under a name of its own unless given one. */
const toner = async (
  over: { name?: string; branchId?: string; typeId?: string } = {},
): Promise<ItConsumableDto> => {
  names += 1;
  const res = await api.post('/consumables', {
    name: over.name ?? `حبر ليزر ${String(names)}`,
    typeId: over.typeId ?? tonerTypeId,
    unit: 'قطعة',
    branchId: over.branchId ?? branchAId,
    openingQty: 10,
  });
  expect(res.status).toBe(201);
  return data<ItConsumableDto>(res);
};

let printers = 0;
const printer = async (branchId = branchAId): Promise<ItAssetDto> => {
  printers += 1;
  const res = await api.post('/assets', {
    name: `HP LaserJet M40${String(printers)}`,
    categoryId,
    branchId,
  });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

type Line = Record<string, unknown>;
const issue = (lines: Line[], extra: Record<string, unknown> = {}, token = adminToken) =>
  api.post('/consumables/issue', { employeeId: String(EMPLOYEE), lines, ...extra }, token);

/** One toner onto a printer at a reading — answered 201 — and the movement it wrote. */
const fit = async (
  item: ItConsumableDto,
  device: ItAssetDto,
  counterReading: number,
  extra: { counterReset?: boolean; issuedAt?: string } = {},
): Promise<ItConsumableMovementDto> => {
  const { issuedAt, ...line } = extra;
  const res = await issue(
    [{ consumableId: item.id, qty: 1, assetId: device.id, counterReading, ...line }],
    issuedAt === undefined ? {} : { issuedAt },
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { memo } = data<ItConsumableIssueResultDto>(res);
  const movementId = memo.lines[0]?.movementId;
  const rows = data<ItConsumableMovementDto[]>(
    await api.get(`/consumables/${item.id}/movements?kind=issued&pageSize=100`),
  );
  const row = rows.find((entry) => entry.id === movementId);
  expect(row).toBeDefined();
  return row as ItConsumableMovementDto;
};

const counterOf = async (device: ItAssetDto, token = adminToken): Promise<ItPrinterCounterDto> => {
  const res = await api.get(`/assets/${device.id}/counter-readings`, token);
  expect(res.status).toBe(200);
  return data<ItPrinterCounterDto>(res);
};

const onHand = async (item: ItConsumableDto): Promise<number> =>
  data<ItConsumableDto>(await api.get(`/consumables/${item.id}`)).onHandQty;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('counter-admin@ecms.local');
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
  adminToken = await login('counter-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('94', 'فرع هـ', 'Branch E');
  branchBId = await mkBranch('95', 'فرع و', 'Branch F');

  const readerRole = await rbacService.createRole(
    {
      name: { en: 'Branch reader', ar: 'مطالع فرع' },
      permissionKeys: ['itAsset.view', 'itConsumable.view'],
    },
    adminId,
  );
  const readerId = await mkUser('counter-reader@ecms.local', branchAId);
  await rbacService.ensureAssignment(readerId, String(readerRole._id), 'branch');
  branchReaderToken = await login('counter-reader@ecms.local');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Store viewer', ar: 'مطالع مخزن' }, permissionKeys: ['itConsumable.view'] },
    adminId,
  );
  const viewerId = await mkUser('counter-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  storeViewerToken = await login('counter-viewer@ecms.local');

  const branch = new Types.ObjectId(branchAId);
  const department = new Types.ObjectId();
  await EmployeeModel.collection.insertOne({
    _id: EMPLOYEE,
    employeeNumber: '1009',
    code: '0101009',
    status: 'active',
    personal: { fullNameAr: 'شريف ممدوح فاروق', nationalId: '28001010101010' },
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

  // «يتطلب عداد الطباعة» — ticked on the toners' type, as the catalog stores it.
  const type = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'ink',
    name: { ar: 'حبارات', en: 'Ink & toner' },
    requiresCounterReading: true,
  });
  expect(type.status).toBe(201);
  expect(data<ItCatalogItemDto>(type).requiresCounterReading).toBe(true);
  tonerTypeId = data<ItCatalogItemDto>(type).id;

  const cables = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'cables',
    name: { ar: 'كابلات', en: 'Cables' },
  });
  expect(cables.status).toBe(201);
  cableTypeId = data<ItCatalogItemDto>(cables).id;

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

describe('«صرف» a toner — the printer, its reading and one cartridge are required', () => {
  it('refuses a toner with no printer, no reading and two cartridges — every gap named, nothing moved', async () => {
    const item = await toner();
    const res = await issue([{ consumableId: item.id, qty: 2 }]);
    expect(res.status).toBe(422);
    expect(failure(res).code).toBe('IT_CONSUMABLE_COUNTER_REQUIRED');
    expect(failure(res).details?.map((d) => [d.field, d.code])).toEqual([
      ['lines.0.assetId', 'REQUIRED'],
      ['lines.0.counterReading', 'REQUIRED'],
      ['lines.0.qty', 'ONE_CARTRIDGE'],
    ]);
    expect(await onHand(item)).toBe(10);
  });

  it('refuses a printer with no reading', async () => {
    const item = await toner();
    const device = await printer();
    const res = await issue([{ consumableId: item.id, qty: 1, assetId: device.id }]);
    expect(res.status).toBe(422);
    expect(failure(res).details).toEqual([
      expect.objectContaining({ field: 'lines.0.counterReading', code: 'REQUIRED' }),
    ]);
    expect(await onHand(item)).toBe(10);
  });

  it('refuses a reading on an item whose type takes none — and the schema refuses a reading with no printer', async () => {
    const cable = await toner({ typeId: cableTypeId });
    const device = await printer();
    const sent = await issue([
      { consumableId: cable.id, qty: 1, assetId: device.id, counterReading: 10 },
    ]);
    expect(sent.status).toBe(422);
    expect(failure(sent).code).toBe('BUSINESS_RULE_VIOLATION');
    // …while a cable goes out as it always did.
    expect((await issue([{ consumableId: cable.id, qty: 3 }])).status).toBe(201);
    const loose = await issue([{ consumableId: cable.id, qty: 1, counterReading: 10 }]);
    expect(loose.status).toBe(400);
  });
});

describe('the printer’s readings', () => {
  it('a first reading, then a higher one of the same item: the printer shows what the first printed — and so does the ledger', async () => {
    const item = await toner();
    const device = await printer();
    const first = await fit(item, device, 15000);
    const second = await fit(item, device, 18200);
    // The ledger rows carry the reading.
    expect(first).toMatchObject({ counterReading: 15000, counterReset: false, assetId: device.id });
    expect(second.counterReading).toBe(18200);
    const card = data<ItConsumableMovementDto[]>(
      await api.get(`/consumable-movements?assetId=${device.id}&pageSize=100`),
    );
    expect(card.map((row) => row.counterReading).sort()).toEqual([15000, 18200]);

    const counter = await counterOf(device);
    expect(counter.latest).toMatchObject({
      movementId: second.id,
      reading: 18200,
      reset: false,
      consumableId: item.id,
      consumableCode: item.code,
      consumableName: item.name,
    });
    expect(counter.readings).toEqual([
      expect.objectContaining({
        movementId: second.id,
        reading: 18200,
        replaced: { movementId: first.id, at: first.at, reading: 15000, pages: 3200 },
      }),
      expect.objectContaining({ movementId: first.id, reading: 15000, replaced: null }),
    ]);
  });

  it('refuses a reading below — or EQUAL to — the last one, with its figures; a reset may read lower', async () => {
    const item = await toner();
    const device = await printer();
    const last = await fit(item, device, 15000);

    for (const reading of [14000, 15000]) {
      const res = await issue([
        { consumableId: item.id, qty: 1, assetId: device.id, counterReading: reading },
      ]);
      expect(res.status).toBe(422);
      expect(failure(res)).toMatchObject({
        code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
        details: [
          { field: 'lines.0.counterReading', code: 'PREVIOUS_READING', message: '15000' },
          { field: 'lines.0.counterReading', code: 'PREVIOUS_AT', message: last.at },
        ],
      });
    }
    expect(await onHand(item)).toBe(9);

    // «تم تصفير عداد الطابعة»: a new baseline — the pages across it are unknown.
    const reset = await fit(item, device, 120, { counterReset: true });
    expect(reset).toMatchObject({ counterReading: 120, counterReset: true });
    const after = await counterOf(device);
    expect(after.readings[0]).toMatchObject({
      reading: 120,
      reset: true,
      replaced: { movementId: last.id, pages: null },
    });
    // …and the next reading is held above the reset's.
    const below = await issue([
      { consumableId: item.id, qty: 1, assetId: device.id, counterReading: 120 },
    ]);
    expect(failure(below).code).toBe('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS');
    const next = await fit(item, device, 2120);
    expect((await counterOf(device)).readings[0]).toMatchObject({
      movementId: next.id,
      replaced: { movementId: reset.id, pages: 2000 },
    });
  });

  it('a colour printer: K, C, K — each colour pairs with its own', async () => {
    const black = await toner();
    const cyan = await toner();
    const device = await printer();
    const k1 = await fit(black, device, 1000);
    const c1 = await fit(cyan, device, 1500);
    const k2 = await fit(black, device, 4000);
    const { readings } = await counterOf(device);
    expect(
      readings.map((r) => [
        r.movementId,
        r.replaced?.movementId ?? null,
        r.replaced?.pages ?? null,
      ]),
    ).toEqual([
      [k2.id, k1.id, 3000],
      [c1.id, null, null],
      [k1.id, null, null],
    ]);
  });

  it('a backdated issue is held between the readings around its date', async () => {
    const item = await toner();
    const device = await printer();
    const early = await fit(item, device, 1000, { issuedAt: '2026-10-01T09:00:00.000Z' });
    const late = await fit(item, device, 5000, { issuedAt: '2026-10-20T09:00:00.000Z' });

    const above = await issue(
      [{ consumableId: item.id, qty: 1, assetId: device.id, counterReading: 5000 }],
      { issuedAt: '2026-10-10T09:00:00.000Z' },
    );
    expect(above.status).toBe(422);
    expect(failure(above)).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
      details: [
        { field: 'lines.0.counterReading', code: 'NEXT_READING', message: '5000' },
        { field: 'lines.0.counterReading', code: 'NEXT_AT', message: late.at },
      ],
    });
    const between = await fit(item, device, 3000, { issuedAt: '2026-10-10T09:00:00.000Z' });
    // The pairing follows the dates: 1000 → 3000 → 5000.
    const { readings } = await counterOf(device);
    expect(readings.map((r) => [r.movementId, r.replaced?.pages ?? null])).toEqual([
      [late.id, 2000],
      [between.id, 2000],
      [early.id, null],
    ]);
  });

  it('two lines of ONE memo on one printer share its reading — and the next issue must read above it', async () => {
    const black = await toner();
    const cyan = await toner();
    const device = await printer();
    const res = await issue([
      { consumableId: black.id, qty: 1, assetId: device.id, counterReading: 700 },
      { consumableId: cyan.id, qty: 1, assetId: device.id, counterReading: 700 },
    ]);
    expect(res.status).toBe(201);
    expect((await counterOf(device)).readings.map((r) => r.reading)).toEqual([700, 700]);
    // Two readings on one printer in one memo is the schema's refusal.
    const split = await issue([
      { consumableId: black.id, qty: 1, assetId: device.id, counterReading: 800 },
      { consumableId: cyan.id, qty: 1, assetId: device.id, counterReading: 900 },
    ]);
    expect(split.status).toBe(400);
    const equal = await issue([
      { consumableId: black.id, qty: 1, assetId: device.id, counterReading: 700 },
    ]);
    expect(failure(equal).code).toBe('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS');
  });

  it('a four-colour memo reset at 0 is ONE reset: the next memo’s four colours each pair with their own', async () => {
    const colours: ItConsumableDto[] = [];
    for (let i = 0; i < 4; i += 1) colours.push(await toner());
    const device = await printer();
    /** One memo: the four colours onto the printer at one reading. */
    const memoAt = async (counterReading: number, counterReset = false) => {
      const res = await issue(
        colours.map((item) => ({
          consumableId: item.id,
          qty: 1,
          assetId: device.id,
          counterReading,
          ...(counterReset ? { counterReset: true } : {}),
        })),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    };
    await memoAt(9000);
    await memoAt(0, true);
    await memoAt(5000);

    const { readings } = await counterOf(device);
    const byColour = (rows: typeof readings) =>
      colours.map((item) => {
        const found = rows.find((r) => r.consumableId === item.id);
        return [found?.reading, found?.replaced?.reading, found?.replaced?.pages];
      });
    // Newest first: the last memo's four, each replacing its own colour's reset cartridge.
    expect(byColour(readings.slice(0, 4))).toEqual(colours.map(() => [5000, 0, 5000]));
    // The reset memo's four: across the reset, every colour unknown.
    expect(byColour(readings.slice(4, 8))).toEqual(colours.map(() => [0, 9000, null]));

    // One colour's cartridges: the reset one printed 5000, the first is unknown, the last is in.
    const [black] = colours;
    const cartridges = data<ItConsumableCartridgesDto>(
      await api.get(`/consumables/${String(black?.id)}/cartridges`),
    );
    expect(cartridges.cartridges.map((c) => [c.installReading, c.pages])).toEqual([
      [5000, null],
      [0, 5000],
      [9000, null],
    ]);
    expect(cartridges).toMatchObject({ averagePages: 5000, counted: 1 });
  });
});

describe('across stores, and who reads it', () => {
  it('the same item name from two stores pairs on one printer; the item’s cartridges give the average', async () => {
    const name = 'حبر HP 26A';
    const ours = await toner({ name });
    const theirs = await toner({ name, branchId: branchBId });
    const device = await printer();
    const first = await fit(ours, device, 1000);
    const second = await fit(theirs, device, 3000);
    const third = await fit(ours, device, 7000);

    const { readings } = await counterOf(device);
    expect(readings[1]).toMatchObject({
      movementId: second.id,
      consumableId: theirs.id,
      replaced: { movementId: first.id, pages: 2000 },
    });
    expect(readings[0]).toMatchObject({ replaced: { movementId: second.id, pages: 4000 } });

    // Our item's two cartridges: the first ended by the other store's twin, the last still in.
    const res = await api.get(`/consumables/${ours.id}/cartridges`, branchReaderToken);
    expect(res.status).toBe(200);
    expect(data<ItConsumableCartridgesDto>(res)).toEqual({
      consumableId: ours.id,
      averagePages: 2000,
      counted: 1,
      cartridges: [
        {
          movementId: third.id,
          at: third.at,
          assetId: device.id,
          assetCode: device.assetCode,
          assetName: device.name,
          installReading: 7000,
          removedAt: null,
          removedReading: null,
          pages: null,
        },
        {
          movementId: first.id,
          at: first.at,
          assetId: device.id,
          assetCode: device.assetCode,
          assetName: device.name,
          installReading: 1000,
          removedAt: second.at,
          removedReading: 3000,
          pages: 2000,
        },
      ],
    });
    // The other store's item is out of a branch reader's scope: not found.
    expect((await api.get(`/consumables/${theirs.id}/cartridges`, branchReaderToken)).status).toBe(
      404,
    );
  });

  it('a branch reader reads its printer’s counter system-wide — another store’s toner included', async () => {
    const ours = await toner();
    const theirs = await toner({ branchId: branchBId });
    const device = await printer();
    await fit(ours, device, 100);
    await fit(theirs, device, 900);
    const counter = await counterOf(device, branchReaderToken);
    expect(counter.readings.map((r) => [r.consumableId, r.consumableName])).toEqual([
      [theirs.id, theirs.name],
      [ours.id, ours.name],
    ]);
  });

  it('the counter reads on itAsset.view: another branch’s printer is not found, and no grant is 403', async () => {
    const elsewhere = await printer(branchBId);
    expect(
      (await api.get(`/assets/${elsewhere.id}/counter-readings`, branchReaderToken)).status,
    ).toBe(404);
    const ours = await printer();
    expect((await api.get(`/assets/${ours.id}/counter-readings`, storeViewerToken)).status).toBe(
      403,
    );
    // A printer with no reading yet answers none.
    expect(await counterOf(ours)).toEqual({ assetId: ours.id, latest: null, readings: [] });
  });
});

describe('the printer’s lock', () => {
  it('two issues on one printer at once, at the same reading: exactly one lands', async () => {
    const black = await toner();
    const cyan = await toner();
    const device = await printer();
    const results = await Promise.all([
      issue([{ consumableId: black.id, qty: 1, assetId: device.id, counterReading: 5000 }]),
      issue([{ consumableId: cyan.id, qty: 1, assetId: device.id, counterReading: 5000 }]),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 422]);
    const refused = results.find((res) => res.status === 422) as request.Response;
    expect(['IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS', 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT']).toContain(
      failure(refused).code,
    );
    expect((await counterOf(device)).readings).toHaveLength(1);
  });

  // The device change writes no row an issue also writes — the lock is all that orders them. Whether
  // two requests overlap is the scheduler's call, so the race is run on several printers: without
  // the lock, one of them lets both land.
  it('«تعديل الجهاز» and an issue on one printer at once, at the same reading: exactly one lands', async () => {
    const first = await toner();
    const moving = await toner();
    const third = await toner();
    // Ten rounds: each toner opens with ten in stock.
    for (let round = 0; round < 10; round += 1) {
      const device = await printer();
      const other = await printer();
      const base = 15000 + round * 100000;
      await fit(first, device, base);
      const onOther = await fit(moving, other, base + 50000);

      const results = await Promise.all([
        api.patch(`/consumable-movements/${onOther.id}/installed-on`, {
          assetId: device.id,
          counterReading: base + 5000,
          version: onOther.version,
        }),
        issue([
          { consumableId: third.id, qty: 1, assetId: device.id, counterReading: base + 5000 },
        ]),
      ]);
      // Whichever landed first, the other read its row under the lock — and is refused.
      const [moved, issued] = results.map((res) => res.status);
      expect(
        [moved, issued].filter((status) => status === 422),
        `round ${String(round)}`,
      ).toHaveLength(1);
      expect(moved === 200 || issued === 201).toBe(true);
      const readings = (await counterOf(device)).readings.map((r) => r.reading);
      expect(readings).toEqual([base + 5000, base]);
    }
  });
});
