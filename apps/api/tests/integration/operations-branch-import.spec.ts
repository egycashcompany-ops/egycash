// «استيراد فروع من شيت» (Round 29) over real HTTP, real RBAC, a real transaction and a real
// workbook: POST /operations/bank-branches/import/compare and …/import/apply.
//
// The owner: «عاوز اضيف دول فى البيانات المرجعية تبع (الفروع والبنوك والمناطق) ملحوظه هتلاقى area دى
// ضيفها ل منطقة العمليات و منطقة الحسابات» and «وعاوز جمب اضافة فرع فوق يقدر يضيف شيت ويقارن زى بتاع
// كروت الشحن كدا». Pinned here: the compare writes nothing and says what each row comes to; the apply
// needs the compare's hashes and refuses a plan that moved since (nothing written); it writes the
// new areas and the branches in one go — both areas on each branch, suffixed codes, the held branch
// updated, its address kept — audited as the catalog's own add and edit; the same sheet compared
// again is all «بدون تغيير»; and both calls are `operationsCatalog.manage`. Synthetic sheets only.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type OperationsAreaDto,
  type OperationsBankBranchDto,
  type OperationsBranchImportAppliedDto,
  type OperationsBranchImportCompareDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { BRANCH_SHEET_HEADER, buildBranchSheet } from './helpers/branch-sheet-workbook';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // operationsShipment.view only — reads the branches, never imports them
let bankId: string;
let otherBankId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-operations-branch-import-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
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

const FILE_NAME = 'فروع البنك التجريبي.xlsx';

const compare = (file: Buffer, opts: { token?: string; bank?: string } = {}) =>
  request(app)
    .post('/api/v1/operations/bank-branches/import/compare')
    .set('Authorization', `Bearer ${opts.token ?? adminToken}`)
    .field('bankId', opts.bank ?? bankId)
    .attach('file', file, FILE_NAME);

const apply = (
  file: Buffer,
  hashes: { fileSha256?: string; planDigest?: string },
  opts: { token?: string; bank?: string } = {},
) => {
  let req = request(app)
    .post('/api/v1/operations/bank-branches/import/apply')
    .set('Authorization', `Bearer ${opts.token ?? adminToken}`)
    .field('bankId', opts.bank ?? bankId);
  if (hashes.fileSha256 !== undefined) req = req.field('fileSha256', hashes.fileSha256);
  if (hashes.planDigest !== undefined) req = req.field('planDigest', hashes.planDigest);
  return req.attach('file', file, FILE_NAME);
};

const branchesOf = async (bank: string): Promise<Map<string, OperationsBankBranchDto>> => {
  const res = await request(app)
    .get(`/api/v1/operations/bank-branches?bankId=${bank}&pageSize=100`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return new Map(data<OperationsBankBranchDto[]>(res).map((b) => [b.name, b]));
};

const areas = async (): Promise<Map<string, OperationsAreaDto>> => {
  const res = await request(app)
    .get('/api/v1/operations/areas?pageSize=100')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return new Map(data<OperationsAreaDto[]>(res).map((a) => [a.name, a]));
};

const mkBranch = async (body: Record<string, unknown>): Promise<OperationsBankBranchDto> => {
  const res = await request(app)
    .post('/api/v1/operations/bank-branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ bankId, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<OperationsBankBranchDto>(res);
};

/**
 * The sheet: a held branch by name (its code and area to update, its address kept), three rows of
 * one code, two placeholders «0», an area merged down two rows, a Latin-only area, an area the
 * catalog holds under another spelling, one it holds with no English name, and a row without a
 * name.
 */
const SHEET_ROWS = [
  BRANCH_SHEET_HEADER,
  ['فرع النخلة', '116', 'منطقة الأفق', 'Horizon', 'شارع الأمل ١'],
  ['فرع السنديان', '116', null, null, null],
  ['فرع  الزيتونـة', '116', 'الواحه', 'Oasis', 'شارع ٢'],
  ['فرع قائم', '084', 'منطقة النجمة', 'Star', 'عنوان جديد'],
  ['فرع الصفصاف', '0', 'منطقة الجبل', null, null],
  ['فرع البلوط', '0', null, null, null],
  ['فرع الريحان', '7', 'Riverside', null, null],
  [null, '9', 'منطقة الأفق', null, null],
];

let sheet: Buffer;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...operationsPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('branch-import-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  const viewerRole = await rbacService.createRole(
    {
      name: { en: 'Shipments viewer', ar: 'مشاهد الشحنات' },
      permissionKeys: ['operationsShipment.view'],
    },
    adminId,
  );
  const viewerId = await mkUser('branch-import-viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'organization');
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
  adminToken = await login('branch-import-admin@ecms.local');
  viewerToken = await login('branch-import-viewer@ecms.local');

  const mkBank = async (code: number, opsName: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: opsName, en: `Bank ${String(code)}` }, opsName });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<{ id: string }>(res).id;
  };
  bankId = await mkBank(901, 'البنك التجريبي');
  otherBankId = await mkBank(902, 'بنك آخر');

  // What the bank and «المناطق» hold before the sheet.
  await mkBranch({
    name: 'فرع قائم',
    code: '500',
    opsAreaName: 'منطقة قديمة',
    location: { addressLine: 'عنوان قديم', coordinates: null },
  });
  await mkBranch({ name: 'فرع خارج الشيت', code: '0' });
  const mkArea = async (body: Record<string, unknown>): Promise<void> => {
    const res = await request(app)
      .post('/api/v1/operations/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  await mkArea({ name: 'الواحة', nameEn: 'Oasis' });
  await mkArea({ name: 'منطقة النجمة' });

  sheet = await buildBranchSheet({ rows: SHEET_ROWS, merges: ['C2:C3', 'D2:D3'] });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('POST /operations/bank-branches/import/compare', () => {
  it('is the catalog’s grant', async () => {
    expect((await compare(sheet, { token: viewerToken })).status).toBe(403);
    const anonymous = await request(app)
      .post('/api/v1/operations/bank-branches/import/compare')
      .field('bankId', bankId)
      .attach('file', sheet, FILE_NAME);
    expect(anonymous.status).toBe(401);
    expect(
      (
        await apply(
          sheet,
          { fileSha256: 'a'.repeat(64), planDigest: 'a'.repeat(64) },
          { token: viewerToken },
        )
      ).status,
    ).toBe(403);
  });

  it('says what every row comes to and writes nothing', async () => {
    const before = await branchesOf(bankId);
    const res = await compare(sheet);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<OperationsBranchImportCompareDto>(res);
    expect(dto).toMatchObject({
      bankId,
      bankName: 'البنك التجريبي',
      fileName: FILE_NAME,
      sheetName: 'الفروع',
      headerRow: 1,
      counts: { rows: 8, new: 6, update: 1, unchanged: 0, problem: 1, suffixed: 4 },
    });
    expect(dto.fileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(dto.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      dto.rows.map((r) => [r.row, r.outcome, r.after?.code ?? null, r.after?.opsAreaName ?? null]),
    ).toEqual([
      [2, 'new', '116', 'منطقة الأفق'],
      // The area merged down from row 2 to row 3.
      [3, 'new', '116-2', 'منطقة الأفق'],
      // «الواحه» is the catalog's «الواحة».
      [4, 'new', '116-3', 'الواحة'],
      [5, 'update', '084', 'منطقة النجمة'],
      // «0» is «فرع خارج الشيت»'s: both placeholders take a suffix.
      [6, 'new', '0-2', 'منطقة الجبل'],
      [7, 'new', '0-3', null],
      [8, 'new', '7', 'Riverside'],
      [9, 'problem', null, null],
    ]);
    expect(dto.rows[4 - 2]?.name).toBe('فرع الزيتونة');
    expect(dto.rows[5 - 2]).toMatchObject({
      before: { code: '500', opsAreaName: 'منطقة قديمة', address: 'عنوان قديم' },
      after: { code: '084', financeAreaName: 'منطقة النجمة', address: 'عنوان قديم' },
      changes: ['code', 'opsAreaName', 'financeAreaName'],
    });
    expect(dto.rows[9 - 2]?.problem).toBe('noName');
    expect(dto.newAreas).toEqual([
      { name: 'منطقة الأفق', nameEn: 'Horizon', rows: 2, latinOnly: false },
      { name: 'منطقة الجبل', nameEn: null, rows: 1, latinOnly: false },
      { name: 'Riverside', nameEn: 'Riverside', rows: 1, latinOnly: true },
    ]);
    expect(dto.filledAreas).toEqual([
      expect.objectContaining({ name: 'منطقة النجمة', nameEn: 'Star' }),
    ]);
    expect(await branchesOf(bankId)).toEqual(before);
    expect([...(await areas()).keys()].sort()).toEqual(['الواحة', 'منطقة النجمة']);
  });

  it('refuses a bank that does not exist, and a sheet with no branch column', async () => {
    const unknown = await compare(sheet, { bank: '0123456789abcdef01234567' });
    expect(unknown.status).toBe(422);
    expect((unknown.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_UNKNOWN_BANK,
    );
    const layout = await compare(await buildBranchSheet({ rows: [['البنك'], ['بنك']] }));
    expect(layout.status).toBe(422);
    expect((layout.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.OPERATIONS_BRANCH_IMPORT_LAYOUT,
    );
  });
});

describe('POST /operations/bank-branches/import/apply', () => {
  it('needs both of the comparison’s hashes', async () => {
    const res = await apply(sheet, { fileSha256: 'a'.repeat(64) });
    expect(res.status).toBe(400);
  });

  it('refuses another file than the one compared, writing nothing', async () => {
    const dto = data<OperationsBranchImportCompareDto>(await compare(sheet));
    const other = await buildBranchSheet({ rows: [BRANCH_SHEET_HEADER, ['فرع غريب', '1']] });
    const res = await apply(other, { fileSha256: dto.fileSha256, planDigest: dto.planDigest });
    expect(res.status).toBe(409);
    const body = res.body as { error: { code: string; details: { code: string }[] } };
    expect(body.error.code).toBe(ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED);
    expect(body.error.details[0]?.code).toBe('FILE_CHANGED');
    expect((await branchesOf(bankId)).has('فرع غريب')).toBe(false);
  });

  it('refuses a plan the bank moved away from since the compare, writing nothing', async () => {
    const dto = data<OperationsBranchImportCompareDto>(await compare(sheet));
    // A colleague adds a branch with the sheet's code: the plan's suffixes move.
    const added = await mkBranch({ name: 'فرع أضافه زميل', code: '116' });
    const res = await apply(sheet, { fileSha256: dto.fileSha256, planDigest: dto.planDigest });
    expect(res.status).toBe(409);
    const body = res.body as {
      error: { code: string; message: string; details: { code: string }[] };
    };
    expect(body.error.code).toBe(ErrorCodes.OPERATIONS_BRANCH_IMPORT_CHANGED);
    expect(body.error.details[0]?.code).toBe('PLAN_CHANGED');
    expect(body.error.message).toMatch(/compare again/u);
    const held = await branchesOf(bankId);
    expect(held.has('فرع النخلة')).toBe(false);
    expect(held.get('فرع قائم')?.code).toBe('500');
    // Out of the way again, for the apply below.
    const off = await request(app)
      .patch(`/api/v1/operations/bank-branches/${added.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'X-1', name: 'فرع أضافه زميل', version: added.version });
    expect(off.status).toBe(200);
  });

  it('writes the areas and the branches in one go, audited, and the sheet compares again as unchanged', async () => {
    const dto = data<OperationsBranchImportCompareDto>(await compare(sheet));
    const res = await apply(sheet, { fileSha256: dto.fileSha256, planDigest: dto.planDigest });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<OperationsBranchImportAppliedDto>(res)).toEqual({
      bankId,
      branchesCreated: 6,
      branchesUpdated: 1,
      unchanged: 0,
      problems: 1,
      areasCreated: 3,
      areasFilled: 1,
    });

    const held = await branchesOf(bankId);
    expect(
      [
        'فرع النخلة',
        'فرع السنديان',
        'فرع الزيتونة',
        'فرع قائم',
        'فرع الصفصاف',
        'فرع البلوط',
        'فرع الريحان',
      ].map((name) => {
        const b = held.get(name);
        return [
          name,
          b?.code,
          b?.opsAreaName,
          b?.financeAreaName,
          b?.location?.addressLine ?? null,
        ];
      }),
    ).toEqual([
      ['فرع النخلة', '116', 'منطقة الأفق', 'منطقة الأفق', 'شارع الأمل ١'],
      ['فرع السنديان', '116-2', 'منطقة الأفق', 'منطقة الأفق', null],
      ['فرع الزيتونة', '116-3', 'الواحة', 'الواحة', 'شارع ٢'],
      ['فرع قائم', '084', 'منطقة النجمة', 'منطقة النجمة', 'عنوان قديم'],
      ['فرع الصفصاف', '0-2', 'منطقة الجبل', 'منطقة الجبل', null],
      ['فرع البلوط', '0-3', null, null, null],
      ['فرع الريحان', '7', 'Riverside', 'Riverside', null],
    ]);
    expect(held.get('فرع خارج الشيت')?.code).toBe('0');
    // Another bank's branches are another bank's.
    expect((await branchesOf(otherBankId)).size).toBe(0);

    const catalog = await areas();
    expect(catalog.get('منطقة الأفق')?.nameEn).toBe('Horizon');
    expect(catalog.get('منطقة الجبل')?.nameEn).toBeNull();
    expect(catalog.get('Riverside')?.nameEn).toBe('Riverside');
    expect(catalog.get('منطقة النجمة')?.nameEn).toBe('Star');

    const trail = async (entityType: string, id: string) =>
      (
        await AuditLogModel.find({
          'entityRef.moduleId': 'operations',
          'entityRef.entityType': entityType,
          'entityRef.entityId': id,
        })
          .sort({ at: 1 })
          .lean()
          .exec()
      ).map((row) => row.action);
    expect(await trail('bankBranch', held.get('فرع النخلة')?.id ?? '')).toEqual(['create']);
    expect(await trail('bankBranch', held.get('فرع قائم')?.id ?? '')).toEqual(['create', 'update']);
    expect(await trail('area', catalog.get('منطقة الأفق')?.id ?? '')).toEqual(['create']);
    expect(await trail('area', catalog.get('منطقة النجمة')?.id ?? '')).toEqual([
      'create',
      'update',
    ]);

    // The same sheet, compared again: nothing to do.
    const again = data<OperationsBranchImportCompareDto>(await compare(sheet));
    expect(again.counts).toMatchObject({
      new: 0,
      update: 0,
      unchanged: 7,
      problem: 1,
      // Round 29 critic: the held «116-2», «116-3», «0-2», «0-3» are written nothing.
      suffixed: 0,
      areasNew: 0,
      areasFilled: 0,
    });
    const twice = await apply(sheet, {
      fileSha256: again.fileSha256,
      planDigest: again.planDigest,
    });
    expect(data<OperationsBranchImportAppliedDto>(twice)).toMatchObject({
      branchesCreated: 0,
      branchesUpdated: 0,
      unchanged: 7,
      areasCreated: 0,
    });
  });

  it('swaps two held codes inside the one transaction', async () => {
    const swap = await buildBranchSheet({
      rows: [BRANCH_SHEET_HEADER, ['فرع النخلة', '116-2'], ['فرع السنديان', '116']],
    });
    const dto = data<OperationsBranchImportCompareDto>(await compare(swap));
    expect(dto.rows.map((r) => [r.outcome, r.before?.code, r.after?.code])).toEqual([
      ['update', '116', '116-2'],
      ['update', '116-2', '116'],
    ]);
    const res = await apply(swap, { fileSha256: dto.fileSha256, planDigest: dto.planDigest });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const held = await branchesOf(bankId);
    expect([held.get('فرع النخلة')?.code, held.get('فرع السنديان')?.code]).toEqual([
      '116-2',
      '116',
    ]);
  });

  it('marks a name the bank spells another way, and an area pair the catalog splits (Round 29 critic)', async () => {
    // Another bank, so the sheet above stays as it is.
    await mkBranch({ bankId: otherBankId, name: 'فرع النرجسى', code: '2' });
    const book = await buildBranchSheet({
      rows: [
        BRANCH_SHEET_HEADER,
        ['فرع النرجسي', '2', null, null, null],
        // «Horizon» is «منطقة الأفق»'s English name, «منطقة الكروم» no area's.
        ['فرع الكروم', '10', 'منطقة الكروم', 'horizon', null],
        // «Star» is «منطقة النجمة»'s: never «منطقة الجبل»'s too.
        ['فرع الجبل', '11', 'منطقة الجبل', 'Star', null],
        // Latin only, and given in Arabic by the next row.
        ['فرع أول', '12', null, 'Coral', null],
        ['فرع ثان', '13', 'منطقة المرجان', 'Coral', null],
      ],
    });
    const res = await compare(book, { bank: otherBankId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<OperationsBranchImportCompareDto>(res);
    expect(dto.counts).toMatchObject({
      rows: 5,
      new: 5,
      suffixed: 1,
      similar: 1,
      areaNotes: 2,
      areasNew: 1,
      areasFilled: 0,
    });
    expect(
      dto.rows.map((r) => [
        r.after?.code,
        r.after?.opsAreaName ?? null,
        r.areaNote,
        r.similarTo?.name ?? null,
      ]),
    ).toEqual([
      ['2-2', null, null, 'فرع النرجسى'],
      ['10', 'منطقة الأفق', 'byEnglish', null],
      ['11', 'منطقة الجبل', 'englishElsewhere', null],
      ['12', 'منطقة المرجان', null, null],
      ['13', 'منطقة المرجان', null, null],
    ]);
    expect(dto.newAreas).toEqual([
      { name: 'منطقة المرجان', nameEn: 'Coral', rows: 2, latinOnly: false },
    ]);

    // A held branch spelt like a new row, added after the compare (its own code, so no suffix
    // moves): the reader never saw that row marked — nothing is written, compare again.
    await mkBranch({ bankId: otherBankId, name: 'فرع الكرومِ', code: 'L-1' });
    const stale = await apply(
      book,
      { fileSha256: dto.fileSha256, planDigest: dto.planDigest },
      { bank: otherBankId },
    );
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect((stale.body as { error: { details: { code: string }[] } }).error.details[0]?.code).toBe(
      'PLAN_CHANGED',
    );
    expect((await branchesOf(otherBankId)).size).toBe(2);
    const again = data<OperationsBranchImportCompareDto>(
      await compare(book, { bank: otherBankId }),
    );
    expect(again.rows[1]?.similarTo?.name).toBe('فرع الكرومِ');
    expect(again.counts.similar).toBe(2);

    const applied = await apply(
      book,
      { fileSha256: again.fileSha256, planDigest: again.planDigest },
      { bank: otherBankId },
    );
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(data<OperationsBranchImportAppliedDto>(applied)).toMatchObject({
      branchesCreated: 5,
      areasCreated: 1,
      areasFilled: 0,
    });
    const catalog = await areas();
    expect(catalog.get('منطقة المرجان')?.nameEn).toBe('Coral');
    expect(catalog.get('منطقة الجبل')?.nameEn).toBeNull();
    expect(catalog.has('Coral')).toBe(false);
    expect(catalog.has('منطقة الكروم')).toBe(false);
    const held = await branchesOf(otherBankId);
    expect([held.get('فرع النرجسى')?.code, held.get('فرع النرجسي')?.code]).toEqual(['2', '2-2']);
  });
});
