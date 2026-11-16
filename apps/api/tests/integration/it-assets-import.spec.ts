// «رفع جماعي» over real HTTP with real RBAC — «في الأصول عايز زرار Bulk Upload للأصول بنفس شكل عهدة
// الأفرع ويكون فى Preview الأول للى هيتضاف ويوضح لو فى تكرار أو تضارب مع بيانات موجوده وهكذا»
// (2026-11-16), and the owner's two answers: the branch is chosen on the screen (the sheet's name
// «عهدة فرع X» suggests it), and a device the register holds in another branch «يتنقل لفرع الملف»
// when it is in stock — held by somebody, it stays — the reviewer free to untick any move.
//
// What a pure spec cannot see: the workbook read from a multipart upload, the preview against the
// live register writing nothing, the apply writing ONLY the rows kept — a new asset in the
// branch's stock, a fill, the move with its place cleared and its history, the caller as the
// actor of the history and the audit — nothing for an unticked line, the 409 when the register
// changed between the preview and the apply, the 403 for a branch the caller's grant does not
// reach, and nothing written on any refusal.
//
// EVERY WORKBOOK IS BUILT HERE, with ExcelJS; its serials and tags are invented.
import ExcelJS from 'exceljs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  IT_ASSET_IMPORT_COLUMNS,
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItAssetHistoryEntryDto,
  type ItAssetImportPreviewDto,
  type ItAssetImportResultDto,
  type ItCatalogItemDto,
  type ItMoveTargetsDto,
  type OrgUnitOptionDto,
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
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import {
  CUSTODY_FIELD_LABELS,
  filledHistoryNote,
} from '../../src/modules/it/go-live/branch-custody-import';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const FILE_NAME = 'tanta-custody.xlsx';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let creatorAToken: string; // itAsset.view + itAsset.create at BRANCH scope, placed in Tanta
let tantaId: string;
let benhaId: string;
let screenCategoryId: string;
let phoneCategoryId: string;

// Unknown to HR, as the custody suites' holders are: the directory answers nothing, and custody
// is handed over all the same.
const EMPLOYEE_A = '000000000000000000000a12';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-assets-import-test-${Date.now()}`;
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

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
};

const mkAsset = async (body: Record<string, unknown>): Promise<ItAssetDto> => {
  const res = await api.post('/assets', { categoryId: screenCategoryId, ...body });
  expect(res.status, res.text).toBe(201);
  return data<ItAssetDto>(res);
};

const assetOf = async (id: string): Promise<ItAssetDto> =>
  data<ItAssetDto>(await api.get(`/assets/${id}`));

const historyOf = async (id: string): Promise<ItAssetHistoryEntryDto[]> =>
  data<ItAssetHistoryEntryDto[]>(await api.get(`/assets/${id}/history`));

const countBySerial = (serialNumber: string): Promise<number> =>
  ItAssetModel.countDocuments({ serialNumber, isDeleted: false }).exec();

/** One line of the sheet, A..M — the custody sheets' columns. */
const cells = (line: {
  kind?: string | null;
  name?: string | null;
  serial?: string | null;
  maker?: string | null;
  model?: string | null;
  tag?: string | null;
  processor?: string | null;
  memory?: string | null;
  accessories?: string[];
}): (string | null)[] => [
  line.kind ?? 'شاشة',
  line.name === undefined ? 'Dell E2020H' : line.name,
  line.serial ?? null,
  line.maker === undefined ? 'Dell' : line.maker,
  line.model === undefined ? 'E2020H' : line.model,
  line.tag ?? null,
  line.processor ?? null,
  line.memory ?? null,
  null,
  null,
  null,
  line.accessories?.[0] ?? null,
  line.accessories?.[1] ?? null,
];

const workbook = async (sheetName: string, lines: (string | null)[][]): Promise<Buffer> => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName);
  sheet.addRow([...IT_ASSET_IMPORT_COLUMNS]);
  for (const line of lines) sheet.addRow(line);
  return Buffer.from(await book.xlsx.writeBuffer());
};

/** POST the workbook with its text fields — a preview unless `apply` says otherwise. */
const upload = (
  file: Buffer,
  fields: Record<string, string> = {},
  token = adminToken,
): request.Test => {
  let req = request(app).post('/api/v1/it/assets/import').set('Authorization', `Bearer ${token}`);
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  return req.attach('file', file, FILE_NAME);
};

const preview = async (
  file: Buffer,
  fields: Record<string, string> = {},
  token = adminToken,
): Promise<ItAssetImportPreviewDto> => {
  const res = await upload(file, fields, token);
  expect(res.status, res.text).toBe(200);
  return data<ItAssetImportPreviewDto>(res);
};

const apply = (
  file: Buffer,
  seen: ItAssetImportPreviewDto,
  rows: number[],
  token = adminToken,
): request.Test =>
  upload(
    file,
    {
      branchId: seen.branchId,
      apply: 'true',
      fileSha256: seen.fileSha256,
      planHash: seen.planHash,
      rows: JSON.stringify(rows),
    },
    token,
  );

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  adminId = await mkUser('import-admin@ecms.local');
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
  adminToken = await login('import-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  tantaId = await mkBranch('80', 'طنطا', 'Tanta');
  benhaId = await mkBranch('81', 'بنها', 'Benha');

  const creatorRole = await rbacService.createRole(
    {
      name: { en: 'Branch asset registrar', ar: 'مسجل أصول فرع' },
      permissionKeys: ['itAsset.view', 'itAsset.create'],
    },
    adminId,
  );
  const creatorId = await mkUser('import-creator@ecms.local', tantaId);
  await rbacService.ensureAssignment(creatorId, String(creatorRole._id), 'branch');
  creatorAToken = await login('import-creator@ecms.local');

  const mkCategory = async (ar: string, en: string): Promise<string> => {
    const res = await api.post('/catalog-items', { kind: 'assetCategory', name: { ar, en } });
    expect(res.status).toBe(201);
    return data<ItCatalogItemDto>(res).id;
  };
  // «شاشة» on the sheet is filed here through the go-live's names for a screen.
  screenCategoryId = await mkCategory('شاشات', 'Monitors');
  phoneCategoryId = await mkCategory('هاتف IP', 'IP phone');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('preview, then apply the lines kept', () => {
  it('decides every line against the register, writes nothing, and then writes only what was kept', async () => {
    // Registered by hand with no maker, model or specifications: the sheet has them.
    const toFill = await mkAsset({
      name: 'Dell OptiPlex 7090',
      branchId: tantaId,
      serialNumber: 'TA1FILL1',
    });
    const toMove = await mkAsset({
      name: 'Dell E2020H',
      manufacturer: 'Dell',
      model: 'E2020H',
      branchId: benhaId,
      serialNumber: 'TB2MOVE1',
      location: 'مخزن IT',
    });
    const held = await mkAsset({
      name: 'Dell E2020H',
      manufacturer: 'Dell',
      model: 'E2020H',
      branchId: benhaId,
      serialNumber: 'TB3HELD1',
    });
    expect((await api.post(`/assets/${held.id}/assign`, { employeeId: EMPLOYEE_A })).status).toBe(
      200,
    );
    const heldBefore = await assetOf(held.id);

    const file = await workbook('عهدة فرع طنطا', [
      // 2 — a device the register does not hold.
      cells({
        serial: 'CN0NEW001',
        model: 'Dell E2020H',
        tag: 'NEWTAG01',
        accessories: ['كابل باور'],
      }),
      // 3 — one of Tanta's, lacking its specifications, maker and model.
      cells({
        kind: 'كمبيوتر مكتبي',
        name: 'Dell OptiPlex 7090',
        model: 'Dell OptiPlex 7090',
        tag: 'TA1FILL1',
        processor: 'Intel Core i5-10500',
        memory: '8 GB',
      }),
      // 4 — in stock in Benha: «يتنقل لفرع الملف».
      cells({ tag: 'TB2MOVE1' }),
      // 5 — somebody holds it in Benha: it stays, and gets what it lacks.
      cells({ tag: 'TB3HELD1', accessories: ['كابل باور'] }),
      // 6 — line 2's device again.
      cells({ serial: 'newtag01' }),
      // 7 — nothing identifies it.
      cells({}),
      // 8 — a kind no category answers to.
      cells({
        kind: 'راوتر',
        name: 'TP-Link Archer C6',
        maker: 'TP-Link',
        model: 'Archer C6',
        tag: 'RTR00001',
      }),
      // 9 — a phone, left unticked on the screen.
      cells({
        kind: 'هاتف IP',
        name: 'Grandstream GXP1615',
        maker: 'Grandstream',
        model: 'GXP1615',
        serial: '271FVCWQ90AB12CD',
      }),
    ]);

    // No branch sent: the sheet's name suggests Tanta.
    const seen = await preview(file);
    expect(seen).toMatchObject({
      sheetName: 'عهدة فرع طنطا',
      branchId: tantaId,
      suggestedBranchId: tantaId,
    });
    expect(seen.kinds).toEqual([
      { kind: 'شاشة', categoryId: screenCategoryId, rows: 5 },
      { kind: 'كمبيوتر مكتبي', categoryId: null, rows: 1 },
      { kind: 'راوتر', categoryId: null, rows: 1 },
      { kind: 'هاتف IP', categoryId: phoneCategoryId, rows: 1 },
    ]);
    expect(seen.rows.map((row) => [row.row, row.decision, row.selectable, row.selected])).toEqual([
      [2, 'new', true, true],
      [3, 'fill', true, true],
      [4, 'move', true, true],
      [5, 'heldElsewhere', true, true],
      [6, 'duplicateInFile', false, false],
      [7, 'noIdentifier', false, false],
      [8, 'unknownKind', false, false],
      [9, 'new', true, true],
    ]);
    const byRow = new Map(seen.rows.map((row) => [row.row, row]));
    expect(byRow.get(2)).toMatchObject({
      serialNumber: 'NEWTAG01',
      externalTag: 'CN0NEW001',
      categoryId: screenCategoryId,
      asset: null,
    });
    expect(byRow.get(3)).toMatchObject({
      asset: { id: toFill.id, assetCode: toFill.assetCode, branchId: tantaId },
      fills: ['specs.processor', 'specs.memory', 'manufacturer', 'model'],
    });
    expect(byRow.get(4)).toMatchObject({ asset: { id: toMove.id }, fromBranchId: benhaId });
    expect(byRow.get(5)).toMatchObject({
      asset: { id: held.id, status: 'assigned' },
      fromBranchId: benhaId,
      fills: ['accessories'],
    });
    expect(byRow.get(6)?.firstRow).toBe(2);
    expect(seen.counts).toMatchObject({
      new: 2,
      fill: 1,
      move: 1,
      heldElsewhere: 1,
      duplicateInFile: 1,
      noIdentifier: 1,
      unknownKind: 1,
      complete: 0,
      outOfScope: 0,
    });
    // A preview writes nothing.
    expect(await countBySerial('NEWTAG01')).toBe(0);
    expect((await assetOf(toMove.id)).branchId).toBe(benhaId);

    // A row that cannot be written refuses the whole apply — 422, nothing written.
    const refused = await apply(file, seen, [2, 6]);
    expect(refused.status).toBe(422);
    expect(message(refused)).toContain('6');
    expect(await countBySerial('NEWTAG01')).toBe(0);

    // The kept rows — the phone on row 9 unticked.
    const res = await apply(file, seen, [2, 3, 4, 5]);
    expect(res.status, res.text).toBe(201);
    const result = data<ItAssetImportResultDto>(res);
    expect(result).toMatchObject({ created: 1, filled: 2, moved: 1, unchanged: 4 });
    expect(result.assets.map((entry) => [entry.row, entry.action])).toEqual([
      [2, 'created'],
      [3, 'filled'],
      [4, 'moved'],
      [5, 'filled'],
    ]);

    // A new asset in Tanta's stock — the tag its serial number, the serial its printed tag, the
    // file named in its notes, and no history entry, like every registration.
    const createdId = result.assets[0]?.assetId ?? '';
    expect(await assetOf(createdId)).toMatchObject({
      assetCode: result.assets[0]?.assetCode,
      name: 'Dell E2020H',
      categoryId: screenCategoryId,
      status: 'inStock',
      serialNumber: 'NEWTAG01',
      externalTag: 'CN0NEW001',
      manufacturer: 'Dell',
      model: 'E2020H',
      branchId: tantaId,
      location: null,
      accessories: ['كابل باور'],
      notes: `من ملف «${FILE_NAME}» — رفع جماعي`,
    });
    expect(await historyOf(createdId)).toHaveLength(0);
    const createAudit = await AuditLogModel.findOne({
      'entityRef.entityId': createdId,
      action: 'create',
    })
      .lean()
      .exec();
    expect(String(createAudit?.actor?.userId)).toBe(adminId);
    expect(createAudit?.changes).toContainEqual({
      field: 'source',
      old: null,
      new: `it:assets-import «${FILE_NAME}»`,
    });

    // «أكمّل الناقص بس» — what it lacked, the maker's name off its model; the caller the actor.
    expect(await assetOf(toFill.id)).toMatchObject({
      specs: { processor: 'Intel Core i5-10500', memory: '8 GB' },
      manufacturer: 'Dell',
      model: 'OptiPlex 7090',
      branchId: tantaId,
    });
    const filled = ['specs.processor', 'specs.memory', 'manufacturer', 'model'] as const;
    expect(await historyOf(toFill.id)).toMatchObject([
      {
        type: 'updated',
        actorUserId: adminId,
        metadata: { fields: filled },
        // The go-live's sentence, with the upload's source: «… المعالج، إجمالي ذاكرة النظام، …».
        notes: filledHistoryNote(`من ملف «${FILE_NAME}» — رفع جماعي`, filled),
      },
    ]);
    expect(filledHistoryNote('X', filled)).toBe(
      `أُضيفت X: ${filled.map((field) => CUSTODY_FIELD_LABELS[field]).join('، ')}`,
    );

    // Moved to Tanta, its place in Benha cleared — and said so.
    expect(await assetOf(toMove.id)).toMatchObject({
      branchId: tantaId,
      location: null,
      status: 'inStock',
    });
    const moved = (await historyOf(toMove.id)).filter((entry) => entry.type === 'transferred');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      actorUserId: adminId,
      metadata: { fromBranchId: benhaId, toBranchId: tantaId },
      notes: `نُقل إلى فرع طنطا حسب ملف «${FILE_NAME}» — رفع جماعي — وأُزيل الموقع السابق «مخزن IT»`,
    });
    const transfer = await AuditLogModel.find({
      'entityRef.entityId': toMove.id,
      action: 'transfer',
    })
      .lean()
      .exec();
    expect(transfer).toHaveLength(1);
    expect(transfer[0]?.changes).toEqual([
      { field: 'branchId', old: benhaId, new: tantaId },
      { field: 'location', old: 'مخزن IT', new: null },
      { field: 'source', old: null, new: `it:assets-import «${FILE_NAME}»` },
    ]);

    // Held in Benha: still there, still theirs — and what it lacked is filled.
    expect(await assetOf(held.id)).toMatchObject({
      branchId: benhaId,
      status: 'assigned',
      currentAssignmentId: heldBefore.currentAssignmentId,
      accessories: ['كابل باور'],
    });

    // Nothing for the unticked phone, the duplicate, or the lines that cannot be written.
    expect(await countBySerial('271FVCWQ90AB12CD')).toBe(0);
    expect(await countBySerial('RTR00001')).toBe(0);
    expect(await countBySerial('NEWTAG01')).toBe(1);
  });
});

describe('the apply is the preview that was seen', () => {
  it('the register changed between the preview and the apply — 409, nothing written', async () => {
    const file = await workbook('عهدة فرع طنطا', [
      cells({ tag: 'RACE0001' }),
      cells({ tag: 'RACE0002' }),
    ]);
    const seen = await preview(file, { branchId: tantaId });
    expect(seen.rows.map((row) => row.decision)).toEqual(['new', 'new']);

    // Somebody registers row 2's device by hand meanwhile — with all the sheet says of it.
    await mkAsset({
      name: 'Dell E2020H',
      manufacturer: 'Dell',
      model: 'E2020H',
      branchId: tantaId,
      serialNumber: 'RACE0001',
    });

    const res = await apply(file, seen, [2, 3]);
    expect(res.status).toBe(409);
    expect(message(res)).toBe('the register changed since the preview — preview again');
    expect(await countBySerial('RACE0001')).toBe(1);
    expect(await countBySerial('RACE0002')).toBe(0);

    // Previewed again, it is what it now is: the device found, the other line new.
    const again = await preview(file, { branchId: tantaId });
    expect(again.rows.map((row) => row.decision)).toEqual(['complete', 'new']);
    expect((await apply(file, again, [3])).status).toBe(201);
    expect(await countBySerial('RACE0002')).toBe(1);
  });

  it('another file than the one previewed — 409, nothing written', async () => {
    const file = await workbook('عهدة فرع طنطا', [
      cells({ tag: 'SWAP0001', processor: 'Intel Core i5-10500' }),
    ]);
    // Every serial and tag kept — only the new line's name and processor differ, which no plan
    // decision reads: the plan is the same plan, so only the file's own hash can refuse it.
    const other = await workbook('عهدة فرع طنطا', [
      cells({ tag: 'SWAP0001', name: 'Dell P2422H', processor: 'Intel Core i7-12700' }),
    ]);
    const seen = await preview(file, { branchId: tantaId });
    const otherSeen = await preview(other, { branchId: tantaId });
    expect(otherSeen.planHash).toBe(seen.planHash);
    expect(otherSeen.fileSha256).not.toBe(seen.fileSha256);

    const res = await apply(other, seen, [2]);
    expect(res.status).toBe(409);
    expect(message(res)).toBe('the file is not the one previewed — preview it again');
    expect(await countBySerial('SWAP0001')).toBe(0);
  });
});

describe('an asset under an open maintenance order is never moved', () => {
  it('in stock in another branch with an order open: held elsewhere — filled, never moved', async () => {
    const ordered = await mkAsset({
      name: 'Dell E2020H',
      manufacturer: 'Dell',
      model: 'E2020H',
      branchId: benhaId,
      serialNumber: 'TB4ORDR1',
      location: 'مخزن IT',
    });
    const file = await workbook('عهدة فرع طنطا', [
      cells({ tag: 'TB4ORDR1', accessories: ['كابل باور'] }),
    ]);
    // Previewed before any order: in stock in Benha — a move.
    const before = await preview(file, { branchId: tantaId });
    expect(before.rows[0]).toMatchObject({ decision: 'move', fromBranchId: benhaId });

    // An order is opened meanwhile. It leaves the asset in stock: only the order says the
    // technician has it.
    expect((await api.post('/maintenance-orders', { assetId: ordered.id })).status).toBe(201);
    expect(await assetOf(ordered.id)).toMatchObject({
      status: 'inStock',
      hasActiveMaintenance: true,
    });

    // The apply of that preview reads the order in its own transaction: not the plan seen — 409,
    // nothing moved, nothing filled.
    const stale = await apply(file, before, [2]);
    expect(stale.status).toBe(409);
    const untouched = await assetOf(ordered.id);
    expect(untouched).toMatchObject({ branchId: benhaId, location: 'مخزن IT' });
    expect(untouched.accessories).not.toContain('كابل باور');

    // Previewed again: held elsewhere, said why, and still filled where it lacks something.
    const seen = await preview(file, { branchId: tantaId });
    expect(seen.rows[0]).toMatchObject({
      decision: 'heldElsewhere',
      asset: { id: ordered.id, branchId: benhaId, status: 'inStock' },
      fromBranchId: benhaId,
      fills: ['accessories'],
      message: 'an open maintenance order holds it — it is not moved',
      selectable: true,
      selected: true,
    });
    expect(seen.counts).toMatchObject({ move: 0, heldElsewhere: 1 });

    const res = await apply(file, seen, [2]);
    expect(res.status, res.text).toBe(201);
    expect(data<ItAssetImportResultDto>(res)).toMatchObject({ created: 0, filled: 1, moved: 0 });
    expect(await assetOf(ordered.id)).toMatchObject({
      branchId: benhaId,
      location: 'مخزن IT',
      status: 'inStock',
      accessories: ['كابل باور'],
    });
    const history = await historyOf(ordered.id);
    expect(history.some((entry) => entry.type === 'transferred')).toBe(false);
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityId': ordered.id,
        action: 'transfer',
      }).exec(),
    ).toBe(0);
  });
});

describe('the branch and the categories', () => {
  it('where the caller may register — GET /assets/import/branches, as the upload judges it', async () => {
    // Organization-wide: every active branch — exactly the pickers' branch options, in their order.
    const options = await request(app)
      .get('/api/v1/platform/branches/options')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(options.status).toBe(200);
    const all = await api.get('/assets/import/branches');
    expect(all.status).toBe(200);
    const { branchIds } = data<ItMoveTargetsDto>(all);
    expect(branchIds).toEqual(data<OrgUnitOptionDto[]>(options).map((branch) => branch.id));
    expect(branchIds).toEqual(expect.arrayContaining([tantaId, benhaId]));

    // A branch-scoped registrar: their own branch alone — the upload answers 403 for any other
    // (below), and they hold no custody grant, so the move's own list is not theirs to ask.
    const mine = await api.get('/assets/import/branches', creatorAToken);
    expect(mine.status).toBe(200);
    expect(data<ItMoveTargetsDto>(mine)).toEqual({ branchIds: [tantaId] });
    expect((await api.get('/assets/move-targets', creatorAToken)).status).toBe(403);
  });

  it('a branch the caller’s itAsset.create does not reach — 403, nothing written', async () => {
    const file = await workbook('عهدة فرع بنها', [cells({ tag: 'FORB0001' })]);
    const res = await upload(file, { branchId: benhaId }, creatorAToken);
    expect(res.status).toBe(403);
    // Their own branch they may preview — and the sheet's name suggests nothing they may use.
    expect((await upload(file, {}, creatorAToken)).status).toBe(422);
    const mine = await preview(file, { branchId: tantaId }, creatorAToken);
    expect(mine.suggestedBranchId).toBeNull();
    const applied = await apply(file, { ...mine, branchId: benhaId }, [2], creatorAToken);
    expect(applied.status).toBe(403);
    expect(await countBySerial('FORB0001')).toBe(0);
  });

  it('no branch chosen and none suggested — 422', async () => {
    const file = await workbook('Sheet1', [cells({ tag: 'NOBR0001' })]);
    const res = await upload(file);
    expect(res.status).toBe(422);
    expect(message(res)).toContain('choose the branch');
  });

  it('a category chosen for a kind files its new lines — one that is no active category, 422', async () => {
    const file = await workbook('عهدة فرع طنطا', [
      cells({
        kind: 'راوتر',
        name: 'TP-Link Archer C6',
        maker: 'TP-Link',
        model: 'Archer C6',
        tag: 'RTR00009',
      }),
    ]);
    expect((await preview(file)).rows[0]?.decision).toBe('unknownKind');
    const chosen = await preview(file, {
      kindCategories: JSON.stringify({ راوتر: phoneCategoryId }),
    });
    expect(chosen.rows[0]).toMatchObject({ decision: 'new', categoryId: phoneCategoryId });
    expect(chosen.kinds).toEqual([{ kind: 'راوتر', categoryId: phoneCategoryId, rows: 1 }]);
    const unknown = await upload(file, {
      kindCategories: JSON.stringify({ راوتر: '6563a1b2c3d4e5f6a7b8c9d0' }),
    });
    expect(unknown.status).toBe(422);
  });

  it('a sheet whose header is not the custody sheets’ — 422 naming the header', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('عهدة فرع طنطا');
    sheet.addRow(IT_ASSET_IMPORT_COLUMNS.map((label) => (label === 'الموديل' ? 'Model' : label)));
    sheet.addRow(cells({ tag: 'HEAD0001' }));
    const res = await upload(Buffer.from(await book.xlsx.writeBuffer()));
    expect(res.status).toBe(422);
    expect(message(res)).toContain('«الموديل»');
  });
});
