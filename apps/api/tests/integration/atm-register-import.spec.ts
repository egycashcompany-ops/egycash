// The register workbook import over real HTTP, real RBAC and a real replica set — spec
// docs/12-planning/atm-efficiency-register.md §10.3 (import suite, scenarios 1–20).
//
// What is worth proving end to end is what the owner decided (D8) and what the review found:
//   · preview first, nothing written; apply only the categories named, one by one; idempotent;
//   · the 57-number check blocks unless explicitly overridden; every other blocker has no override;
//   · secrets: no key value or combination in any response, sealed at rest, revealable afterwards;
//     an apply needs viewSecrets, and per branch (DEC-7);
//   · the importer's reach bounds everything the import reads and writes (review finding F-3);
//   · nothing is written to the temp directory, ever (§6.2).
//
// EVERY WORKBOOK IS BUILT IN-TEST (tests/integration/helpers/atm-register-workbook.ts). Codes,
// names, key codes and combinations are synthetic; no value of the owner's workbook is used.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ATM_REGISTER_IMPORT_ISSUES,
  AtmSettingKeys,
  SettingKeys,
  platformPermissions,
  type AtmRegisterEntryDto,
  type AtmRegisterImportCategoryDto,
  type AtmRegisterImportResultDto,
  type AtmRegisterImportRunDto,
  type AtmRegisterRevealDto,
  type AtmRegisterWriteResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AtmMachineModel, type AtmMachineDoc } from '../../src/modules/atm/machines/machine.model';
import { AtmRefLabelModel } from '../../src/modules/atm/catalogs/ref-label.model';
import {
  AtmRegisterEntryModel,
  type AtmRegisterEntryDoc,
} from '../../src/modules/atm/register/register.model';
import { AtmRegisterImportRunModel } from '../../src/modules/atm/register/import/register-import-run.model';
import { type AuthContext } from '../../src/shared/types';
import {
  atmRow,
  buildRegisterWorkbook,
  cell,
  excelDate,
  excelTime,
  type RegisterWorkbookSpec,
  type SyntheticRow,
} from './helpers/atm-register-workbook';

const PASSWORD = 'Str0ng#Pass!';
// Synthetic secrets — asserted ABSENT from every response.
const COMBO_NUMBER = 135792; // AO typed as a number under `00 - 00 - 00`
const COMBO_SHOWN = '13 - 57 - 92';
const COMBO_TEXT = '24 - 68 - 02';
const FAKE_KEYS = [
  'FAKE-SUP-1001',
  'FAKE-NUM-1002',
  'FAKE-ALANKI-1003',
  'FAKE-CMB-1004',
  'FAKE-CASH-1005',
  'FAKE-NOTE-RECV-1006',
  'FAKE-NOTE-DLVR-1007',
  'FAKE-SUP-2002',
];

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // super-admin: every key, organization
let importerToken: string; // import + viewSecrets + view, organization
let noSecretsToken: string; // import + view, organization — no viewSecrets
let viewerToken: string; // register view only — no import
let tantaImporterToken: string; // import + viewSecrets + view, BRANCH scope, placed in Tanta
let tantaSecretsToken: string; // import organization-wide, viewSecrets only in Tanta
let alexBranchId: string;
let tantaBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-register-import-test-${Date.now()}`;
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
const errorCode = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';
const errorDetails = (res: request.Response): { field?: string; code: string; message: string }[] =>
  (res.body as { error?: { details?: { field?: string; code: string; message: string }[] } }).error
    ?.details ?? [];

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

/** POST the workbook — a preview unless `apply` names categories. */
const upload = (
  token: string,
  workbook: Buffer,
  fields: { apply?: string; fileSha256?: string; reportOverride?: boolean } = {},
): request.Test => {
  let req = request(app)
    .post('/api/v1/atm/register/import')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', workbook, 'register-test.xlsx');
  if (fields.apply !== undefined) req = req.field('apply', fields.apply);
  if (fields.fileSha256 !== undefined) req = req.field('fileSha256', fields.fileSha256);
  if (fields.reportOverride === true) req = req.field('reportOverride', 'true');
  return req;
};

const preview = async (
  token: string,
  workbook: Buffer,
): Promise<{ dto: AtmRegisterImportResultDto; text: string }> => {
  const res = await upload(token, workbook);
  expect(res.status, res.text).toBe(200);
  return { dto: data<AtmRegisterImportResultDto>(res), text: res.text };
};

const applyImport = async (
  token: string,
  workbook: Buffer,
  categories: string[],
): Promise<{ dto: AtmRegisterImportResultDto; text: string }> => {
  const res = await upload(token, workbook, {
    apply: categories.join(','),
    fileSha256: sha256(workbook),
    reportOverride: true,
  });
  expect(res.status, res.text).toBe(200);
  return { dto: data<AtmRegisterImportResultDto>(res), text: res.text };
};

const category = (
  dto: AtmRegisterImportResultDto,
  key: AtmRegisterImportCategoryDto['key'],
): AtmRegisterImportCategoryDto => {
  const found = dto.categories.find((c) => c.key === key);
  if (found === undefined) throw new Error(`no category ${key}`);
  return found;
};

const entryOfRow = async (importRow: number): Promise<AtmRegisterEntryDoc | null> =>
  AtmRegisterEntryModel.findOne({ importRow }).lean<AtmRegisterEntryDoc>().exec();

const masterOf = async (branchId: string, machineCode: string): Promise<AtmMachineDoc | null> =>
  AtmMachineModel.findOne({
    branchId: new Types.ObjectId(branchId),
    machineCode,
    isDeleted: false,
  })
    .lean<AtmMachineDoc>()
    .exec();

const runRows = async (runId: string): Promise<{ importRow: number; outcome: string }[]> =>
  ((await AtmRegisterImportRunModel.findById(runId).lean().exec())?.rows ?? []).map((r) => ({
    importRow: r.importRow,
    outcome: r.outcome,
  }));

/** Admin adds an Operations machine in a branch, through the data-edit route. */
const addMachine = async (
  branchId: string,
  body: { machineCode: string; name: string; bankName: string; area: string },
): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/atm/machines')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('x-active-branch', branchId)
    .send(body);
  expect(res.status, res.text).toBe(201);
  return data<{ id: string }>(res).id;
};

/** A complete open row in Alexandria; override any field. */
const alexOpen = (fields: Parameters<typeof atmRow>[0], extra: SyntheticRow = {}): SyntheticRow =>
  atmRow(
    {
      branchCode: 'EGYCASH-4',
      area: 'Smouha',
      bankCode: 'NBE',
      name: 'Synthetic ATM',
      startDate: excelDate('2025-02-01'),
      ...fields,
    },
    extra,
  );
const tantaOpen = (fields: Parameters<typeof atmRow>[0], extra: SyntheticRow = {}): SyntheticRow =>
  alexOpen({ branchCode: 'EGYCASH-2', area: 'Tanta Center', ...fields }, extra);
const ended = (fields: Parameters<typeof atmRow>[0]): SyntheticRow =>
  alexOpen({ endDate: excelDate('2025-06-01'), ...fields });

const workbook = (
  rows: (SyntheticRow | null)[],
  over: Partial<RegisterWorkbookSpec> = {},
): Promise<Buffer> => buildRegisterWorkbook({ rows, ...over });

const expectNoSecret = (text: string): void => {
  for (const secret of [...FAKE_KEYS, COMBO_SHOWN, String(COMBO_NUMBER), COMBO_TEXT]) {
    expect(text).not.toContain(secret);
  }
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('import-admin@ecms.local');
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

  const post = async (url: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1${url}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status, `${url}: ${res.text}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await post('/platform/branches', {
    code: '90',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
  });
  tantaBranchId = await post('/platform/branches', {
    code: '91',
    name: { ar: 'طنطا', en: 'Tanta' },
  });
  await settingsService.set(ctx, {
    key: AtmSettingKeys.RegisterBranchCodes,
    scope: 'organization',
    value: [
      { code: 'EGYCASH-4', branchId: alexBranchId },
      { code: 'EGYCASH-2', branchId: tantaBranchId },
    ],
  });

  const role = async (en: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId))._id);
  const importer = await role('Register importer', [
    'atmRegister.view',
    'atmRegister.import',
    'atmRegister.viewSecrets',
    'atmMachine.view',
  ]);
  const importNoSecrets = await role('Register importer without secrets', [
    'atmRegister.view',
    'atmRegister.import',
  ]);
  const importOnly = await role('Register import only', ['atmRegister.import']);
  const secretsOnly = await role('Register secrets only', ['atmRegister.viewSecrets']);
  const viewer = await role('Register viewer', ['atmRegister.view']);

  const importerId = await mkUser('import-org@ecms.local');
  await rbacService.ensureAssignment(importerId, importer, 'organization');
  importerToken = await login('import-org@ecms.local');

  const noSecretsId = await mkUser('import-nosecrets@ecms.local');
  await rbacService.ensureAssignment(noSecretsId, importNoSecrets, 'organization');
  noSecretsToken = await login('import-nosecrets@ecms.local');

  const viewerId = await mkUser('import-viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, viewer, 'organization');
  viewerToken = await login('import-viewer@ecms.local');

  const tantaId = await mkUser('import-tanta@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaId, importer, 'branch');
  tantaImporterToken = await login('import-tanta@ecms.local');

  const tantaSecretsId = await mkUser('import-tanta-secrets@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaSecretsId, importOnly, 'organization');
  await rbacService.ensureAssignment(tantaSecretsId, secretsOnly, 'branch');
  tantaSecretsToken = await login('import-tanta-secrets@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// Each scenario starts from an empty register and an empty Operations list: Excel row numbers are
// the import's identity (`ux_import_row`), and every fixture starts at row 3.
beforeEach(async () => {
  await AtmRegisterEntryModel.deleteMany({}).exec();
  await AtmMachineModel.deleteMany({}).exec();
  await AtmRefLabelModel.deleteMany({}).exec();
  await AtmRegisterImportRunModel.deleteMany({}).exec();
});

/** One row per issue code (§10.3 fixture), rows 3..32. */
const everyIssueRows = (): SyntheticRow[] => [
  // 3 — a complete open row carrying every K value and the combination as a number.
  alexOpen({
    machineCode: 99990101,
    name: 'Alpha',
    operationType: 'Offsite',
    vendor: 'NCR',
    model: 'SelfServ 22',
    serial: 'SN-A1',
    'keys.supervisorCode': 'FAKE-SUP-1001',
    'keys.supervisorCount': 'FAKE-NUM-1002',
    'keys.safeDoorCount': '2',
    'keys.alanki': 'FAKE-ALANKI-1003',
    'keys.combinationKeyCode': 'FAKE-CMB-1004',
    'keys.combinationKeyCount': '1',
    'keys.cashUnitCode': 'FAKE-CASH-1005',
    'keys.cashUnitCount': '1',
    openTime: excelTime(8 / 24),
    closeTime: excelTime(1), // timeOverDay
    receiptNotes: 'FAKE-NOTE-RECV-1006',
    safeCombination: cell(COMBO_NUMBER, { numFmt: '00 - 00 - 00' }),
    receivedByName: 'Receiver',
    handoverNotes: 'FAKE-NOTE-DLVR-1007',
    hub: 'HUB-1',
  }),
  ended({ branchCode: null, machineCode: 99990102, name: 'Bravo' }), // 4 noBranch
  ended({ branchCode: 'EGYCASH-9', machineCode: 99990103 }), // 5 unknownBranchCode
  alexOpen({ area: { error: '#N/A' }, machineCode: 99990104 }), // 6 areaError + openNoArea
  alexOpen({ bankCode: 'نيكست', machineCode: 'ATM9901' }), // 7 bankAlias
  alexOpen({ bankCode: 'QNB', machineCode: 99990106 }), // 8 unknownBank + noBank
  alexOpen({ machineCode: null }), // 9 noCode
  ended({ machineCode: '#' }), // 10 placeholderCode
  ended({ machineCode: ' 99990111' }), // 11 codeWhitespace
  ended({ machineCode: '123' }), // 12 idFormat
  ended({ bankCode: 'HDB', machineCode: 'HDB - 9902' }), // 13 hdbSpelling
  alexOpen({ bankCode: 'HDB', machineCode: 'HDB-ATM9902' }), // 14 hdbSpelling
  alexOpen({ machineCode: 99990115 }), // 15 duplicateOpen
  alexOpen({ machineCode: 99990115, name: 'Second period' }), // 16 duplicateOpen
  alexOpen({ machineCode: 99990117, startDate: excelDate('2024-01-01') }), // 17 openNotNewest
  ended({
    machineCode: 99990117,
    startDate: excelDate('2025-01-01'),
    endDate: excelDate('2025-03-01'),
  }), // 18
  alexOpen({ machineCode: 99990119, serial: 'SN-DUP' }), // 19 serialDuplicate
  alexOpen({ machineCode: 99990120, serial: 'sn-dup' }), // 20 serialDuplicate
  ended({
    machineCode: 99990121,
    'keys.supervisorCode': 'FAKE-SUP-2002',
    safeCombination: COMBO_TEXT,
  }), // 21 exactDuplicate
  ended({
    machineCode: 99990121,
    'keys.supervisorCode': 'FAKE-SUP-2002',
    safeCombination: COMBO_TEXT,
  }), // 22
  ended({ machineCode: 99990123, safeCombination: 1234567 }), // 23 aoShape
  alexOpen({ bankCode: 'BM', machineCode: 9999124, startDate: 46034 }), // 24 dateSerial
  alexOpen({ machineCode: 99990125, endDate: 'next week' }), // 25 dateInvalid
  ended({
    machineCode: 99990126,
    startDate: excelDate('2025-05-01'),
    endDate: excelDate('2025-04-01'),
  }), // 26 endBeforeStart
  alexOpen({ machineCode: 99990127, startDate: excelDate('2099-01-01') }), // 27 futureStart
  ended({ machineCode: 99990128, endDate: excelDate('2099-12-31') }), // 28 futureEnd
  ended({ machineCode: 99990129, operationType: excelDate('2024-02-03') }), // 29 dateInText
  ended({
    machineCode: 99990130,
    vendor: { error: '#VALUE!' },
    'keys.supervisorCode': { error: '#REF!' },
  }), // 30 errorValue
  ended({ machineCode: 99990131, name: null }), // 31 noName
  atmRow({ branchCode: 'EGYCASH-4', bankCode: 'NBE', machineCode: 99990132, name: 'Planned' }), // 32 pending
];

describe('preview and refusals', () => {
  it('1 — preview: counts, every issue code, 57 cells, reportMismatch — and no secret in the response', async () => {
    const file = await workbook(everyIssueRows(), {
      trailing: [alexOpen({ machineCode: 99990999, 'keys.supervisorCode': 'FAKE-AFTER-END' })],
    });
    const { dto, text } = await preview(importerToken, file);
    expect(dto.mode).toBe('preview');
    expect(dto.fileSha256).toBe(sha256(file));
    expect(dto.sheet).toEqual({ firstDataRow: 3, lastDataRow: 32, sentinelRow: 33 });
    expect(dto.counts).toEqual({ rows: 30, open: 14, ended: 15, pending: 1, alreadyImported: 0 });
    expect(dto.report.cells).toHaveLength(57);
    expect(dto.report.allMatch).toBe(false);
    expect(dto.blockers).toContain('reportMismatch');
    expect(dto.blockers).toContain('dateUnreadable');

    const seen = new Set(dto.issues.byCode.map((i) => i.code));
    expect([...ATM_REGISTER_IMPORT_ISSUES].filter((code) => !seen.has(code))).toEqual([]);
    const issuesOf = (row: number): string[] =>
      dto.issues.rows.find((r) => r.importRow === row)?.issues.map((i) => i.code) ?? [];
    expect(issuesOf(3)).toEqual(['timeOverDay']);
    expect(issuesOf(4)).toContain('noBranch');
    expect(issuesOf(6)).toEqual(expect.arrayContaining(['areaError', 'openNoArea']));
    expect(issuesOf(21)).toContain('exactDuplicate');
    expect(issuesOf(24)).toContain('dateSerial');
    expect(issuesOf(25)).toContain('dateInvalid');
    // K-column issues carry no detail.
    const row30 = dto.issues.rows.find((r) => r.importRow === 30)?.issues ?? [];
    expect(row30).toContainEqual({ code: 'errorValue', column: 'J', detail: null });

    expectNoSecret(text);
    expect(text).not.toContain('FAKE-AFTER-END');
    // A preview writes nothing.
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(0);
    expect(await AtmRegisterImportRunModel.countDocuments({}).exec()).toBe(0);
  });

  it('2 — a renamed header is 422 ATM_REGISTER_IMPORT_LAYOUT naming the column', async () => {
    const res = await upload(importerToken, await workbook([], { headers: { AN: 'Notes' } }));
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ATM_REGISTER_IMPORT_LAYOUT');
    expect(errorDetails(res)).toEqual([
      { field: 'AN', code: 'MISSING_HEADER', message: 'Notes Received' },
    ]);
  });

  it('3 — an unmapped branch code / a branch outside the importer’s reach block, and apply is 422', async () => {
    const unmapped = await workbook([alexOpen({ branchCode: 'EGYCASH-7', machineCode: 99990301 })]);
    expect((await preview(importerToken, unmapped)).dto.blockers).toContain('branchUnmapped');
    const refused = await upload(importerToken, unmapped, {
      apply: 'entries',
      fileSha256: sha256(unmapped),
      reportOverride: true,
    });
    expect(refused.status).toBe(422);
    expect(errorCode(refused)).toBe('ATM_REGISTER_IMPORT_BLOCKED');
    expect(errorDetails(refused).map((d) => d.code)).toEqual(['branchUnmapped']);

    const alex = await workbook([alexOpen({ machineCode: 99990302 })]);
    const { dto } = await preview(tantaImporterToken, alex);
    expect(dto.blockers).toContain('branchOutOfReach');
    expect(dto.branches).toEqual([
      expect.objectContaining({ code: 'EGYCASH-4', inReach: false, rows: 1 }),
    ]);
    const outside = await upload(tantaImporterToken, alex, {
      apply: 'entries',
      fileSha256: sha256(alex),
      reportOverride: true,
    });
    expect(outside.status).toBe(422);
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(0);
  });

  it('4 — apply without the override is blocked; with it the entries are written, the run completes, one audit row', async () => {
    const file = await workbook([
      alexOpen({ machineCode: 99990401 }),
      ended({ machineCode: 99990402 }),
    ]);
    const blocked = await upload(importerToken, file, {
      apply: 'entries',
      fileSha256: sha256(file),
    });
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked)).toBe('ATM_REGISTER_IMPORT_BLOCKED');
    expect(errorDetails(blocked).map((d) => d.code)).toEqual(['reportMismatch']);
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(0);

    const { dto } = await applyImport(importerToken, file, ['entries']);
    expect(dto.mode).toBe('applied');
    expect(dto.applied).toMatchObject({ categories: ['entries'], reportOverride: true });
    expect(dto.applied?.counts).toMatchObject({ imported: 2, alreadyImported: 0 });
    expect(dto.counts.alreadyImported).toBe(2);
    const run = await AtmRegisterImportRunModel.findById(dto.applied?.runId).lean().exec();
    expect(run).toMatchObject({
      state: 'completed',
      reportOverride: true,
      fileSha256: sha256(file),
    });
    const audits = await AuditLogModel.find({ action: 'atmRegisterImport' }).lean().exec();
    expect(audits.filter((a) => a.entityRef.entityId === dto.applied?.runId)).toHaveLength(1);
    expect(audits[0]?.entityRef).toMatchObject({ moduleId: 'atm', entityType: 'registerImport' });
    const open = await entryOfRow(3);
    expect(open).toMatchObject({ status: 'open', source: 'import', importRow: 3, machineId: null });
  });

  it('5 — apply needs atmRegister.viewSecrets', async () => {
    const file = await workbook([alexOpen({ machineCode: 99990501 })]);
    expect((await upload(noSecretsToken, file)).status).toBe(200);
    const res = await upload(noSecretsToken, file, {
      apply: 'entries',
      fileSha256: sha256(file),
      reportOverride: true,
    });
    expect(res.status).toBe(403);
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(0);
  });

  it('8 — a file that changed since the preview is 409 ATM_REGISTER_IMPORT_FILE_CHANGED', async () => {
    const file = await workbook([alexOpen({ machineCode: 99990801 })]);
    const res = await upload(importerToken, file, {
      apply: 'entries',
      fileSha256: sha256(Buffer.from('another file')),
      reportOverride: true,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_REGISTER_IMPORT_FILE_CHANGED');
  });

  it('12 — 403 without atmRegister.import; GET /runs lists the run without its rows', async () => {
    const file = await workbook([alexOpen({ machineCode: 99991201 })]);
    expect((await upload(viewerToken, file)).status).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/atm/register/import/runs')
          .set('Authorization', `Bearer ${viewerToken}`)
      ).status,
    ).toBe(403);
    const { dto } = await applyImport(importerToken, file, ['entries']);
    const res = await request(app)
      .get('/api/v1/atm/register/import/runs')
      .set('Authorization', `Bearer ${importerToken}`);
    expect(res.status).toBe(200);
    const runs = data<AtmRegisterImportRunDto[]>(res);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: dto.applied?.runId,
      state: 'completed',
      categories: ['entries'],
    });
    expect(runs[0]).not.toHaveProperty('rows');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('categories, idempotency, coupling', () => {
  it('6 — each category applies on its own; the others are recorded notApproved', async () => {
    await addMachine(alexBranchId, {
      machineCode: '99990601',
      name: 'Synthetic ATM',
      bankName: 'NBE',
      area: 'Smouha',
    });
    const archivedId = await addMachine(alexBranchId, {
      machineCode: '99990602',
      name: 'Old name',
      bankName: 'NBE',
      area: 'Old area',
    });
    await AtmMachineModel.updateOne(
      { _id: new Types.ObjectId(archivedId) },
      { isActive: false },
    ).exec();
    const file = await workbook([
      alexOpen({ machineCode: 99990601 }), // 3 link
      alexOpen({ machineCode: 99990602 }), // 4 reactivate
      alexOpen({ machineCode: 99990603 }), // 5 create
    ]);
    const before = await preview(importerToken, file);
    expect(category(before.dto, 'link').items.map((i) => i.importRow)).toEqual([3]);
    expect(category(before.dto, 'reactivate').items.map((i) => i.importRow)).toEqual([4]);
    expect(category(before.dto, 'create').items.map((i) => i.importRow)).toEqual([5]);

    await applyImport(importerToken, file, ['entries']);
    expect(await AtmMachineModel.countDocuments({}).exec()).toBe(2);
    expect((await masterOf(alexBranchId, '99990602'))?.isActive).toBe(false);
    for (const row of [3, 4, 5]) expect((await entryOfRow(row))?.machineId).toBeNull();

    const link = await applyImport(importerToken, file, ['link']);
    expect(link.dto.applied?.counts).toMatchObject({
      linked: 1,
      notApproved: 2,
      imported: 0,
      alreadyImported: 3,
    });
    expect(String((await entryOfRow(3))?.machineId)).toBe(
      String((await masterOf(alexBranchId, '99990601'))?._id),
    );
    expect((await entryOfRow(3))?.opsBankLabel).toBe('NBE');
    expect((await masterOf(alexBranchId, '99990602'))?.isActive).toBe(false);
    expect(await masterOf(alexBranchId, '99990603')).toBeNull();
    expect(await runRows(link.dto.applied?.runId ?? '')).toEqual(
      expect.arrayContaining([
        { importRow: 3, outcome: 'linked' },
        { importRow: 4, outcome: 'notApproved' },
        { importRow: 5, outcome: 'notApproved' },
      ]),
    );
    // The recomputed plan no longer offers the linked row.
    expect(category(link.dto, 'link').count).toBe(0);

    const create = await applyImport(importerToken, file, ['create']);
    expect(create.dto.applied?.counts).toMatchObject({ created: 1, notApproved: 1 });
    expect(await masterOf(alexBranchId, '99990603')).toMatchObject({
      isActive: true,
      bankName: 'NBE',
      area: 'Smouha',
    });
    expect((await masterOf(alexBranchId, '99990602'))?.isActive).toBe(false);

    const reactivate = await applyImport(importerToken, file, ['reactivate']);
    expect(reactivate.dto.applied?.counts).toMatchObject({ reactivated: 1 });
    expect(await masterOf(alexBranchId, '99990602')).toMatchObject({
      isActive: true,
      name: 'Synthetic ATM',
      area: 'Smouha',
    });
    // Each master write is audited on the machine.
    expect(
      await AuditLogModel.countDocuments({
        'entityRef.entityType': 'machine',
        action: 'create',
      }).exec(),
    ).toBeGreaterThanOrEqual(1);
  });

  it('7 — re-applying the same file is idempotent', async () => {
    const file = await workbook([
      alexOpen({ machineCode: 99990701 }),
      ended({ machineCode: 99990702 }),
      atmRow({ branchCode: 'EGYCASH-4', bankCode: 'NBE', machineCode: 99990703, name: 'Pending' }),
    ]);
    await applyImport(importerToken, file, ['entries', 'create']);
    const masters = await AtmMachineModel.countDocuments({}).exec();
    const again = await applyImport(importerToken, file, ['entries', 'create']);
    expect(again.dto.applied?.counts).toMatchObject({
      imported: 0,
      alreadyImported: 3,
      created: 0,
    });
    expect(again.dto.counts.alreadyImported).toBe(3);
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(3);
    expect(await AtmMachineModel.countDocuments({}).exec()).toBe(masters);
    expect(again.dto.blockers).not.toContain('changedSinceImport');
  });

  it('9 — nbeForex: with the branch label the created master is NBE FOREX; without it, labelMissing', async () => {
    await AtmRefLabelModel.create({
      branchId: new Types.ObjectId(alexBranchId),
      kind: 'bank',
      name: 'NBE FOREX',
    });
    const file = await workbook([
      alexOpen({ machineCode: 99990901, area: 'Smouha FX' }),
      tantaOpen({ machineCode: 99990902, area: 'Tanta FX' }),
    ]);
    const { dto } = await preview(importerToken, file);
    expect(category(dto, 'nbeForex').items.map((i) => [i.importRow, i.reason])).toEqual([
      [3, null],
      [4, 'labelMissing'],
    ]);
    const applied = await applyImport(importerToken, file, ['entries', 'create', 'nbeForex']);
    expect(applied.dto.applied?.counts).toMatchObject({ created: 2, nbeForex: 1 });
    expect((await masterOf(alexBranchId, '99990901'))?.bankName).toBe('NBE FOREX');
    expect((await entryOfRow(3))?.opsBankLabel).toBe('NBE FOREX');
    expect((await masterOf(tantaBranchId, '99990902'))?.bankName).toBe('NBE');
  });

  it('9b — nbeForex relabels a master an earlier pass created under the default label', async () => {
    await AtmRefLabelModel.create({
      branchId: new Types.ObjectId(alexBranchId),
      kind: 'bank',
      name: 'NBE FOREX',
    });
    const file = await workbook([alexOpen({ machineCode: 99990903, area: 'Smouha FX' })]);
    await applyImport(importerToken, file, ['entries', 'create']);
    expect((await masterOf(alexBranchId, '99990903'))?.bankName).toBe('NBE');
    const relabel = await applyImport(importerToken, file, ['nbeForex']);
    expect(relabel.dto.applied?.counts).toMatchObject({ nbeForex: 1 });
    expect((await masterOf(alexBranchId, '99990903'))?.bankName).toBe('NBE FOREX');
    expect((await entryOfRow(3))?.opsBankLabel).toBe('NBE FOREX');
  });

  it('10 — a duplicate-open pair: both exempt, one master, both linked', async () => {
    const file = await workbook([
      alexOpen({ machineCode: 99991001 }),
      alexOpen({ machineCode: 99991001, name: 'Second period' }),
    ]);
    const { dto } = await applyImport(importerToken, file, ['entries', 'create', 'link']);
    expect(dto.applied?.counts).toMatchObject({ imported: 2, created: 1, linked: 1 });
    const [first, second] = [await entryOfRow(3), await entryOfRow(4)];
    expect(first?.openPeriodExempt).toBe(true);
    expect(second?.openPeriodExempt).toBe(true);
    expect(await AtmMachineModel.countDocuments({ machineCode: '99991001' }).exec()).toBe(1);
    expect(String(first?.machineId)).toBe(String(second?.machineId));
    expect(first?.machineId).not.toBeNull();
  });

  it('11 — AO is sealed at rest and the reveal returns what Excel showed', async () => {
    const file = await workbook([
      alexOpen({
        machineCode: 99991101,
        safeCombination: cell(COMBO_NUMBER, { numFmt: '00 - 00 - 00' }),
      }),
    ]);
    const applied = await applyImport(importerToken, file, ['entries']);
    expectNoSecret(applied.text);
    const raw = await AtmRegisterEntryModel.collection.findOne({ importRow: 3 });
    expect(raw?.safeCombination).toMatchObject({ provider: expect.any(String) as string });
    expect(JSON.stringify(raw)).not.toContain(COMBO_SHOWN);
    expect(JSON.stringify(raw)).not.toContain(String(COMBO_NUMBER));
    const res = await request(app)
      .post(`/api/v1/atm/register/entries/${String(raw?._id)}/reveal`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status, res.text).toBe(200);
    expect(data<AtmRegisterRevealDto>(res).safeCombination).toBe(COMBO_SHOWN);
  });

  it('13 — nothing is written to the temp directory, with a secret sheet before the shared strings', async () => {
    const file = await workbook(
      [alexOpen({ machineCode: 99991301, 'keys.supervisorCode': 'FAKE-SUP-1001' })],
      {
        sheetBefore: { name: 'Sheet1', cells: { A1: 'FAKE-SUP-1001', B1: COMBO_TEXT } },
      },
    );
    const original = process.env.TMPDIR;
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'atm-register-import-'));
    const systemBefore = new Set(readdirSync(original ?? os.tmpdir()));
    process.env.TMPDIR = scratch;
    try {
      await preview(importerToken, file);
      await applyImport(importerToken, file, ['entries']);
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = original;
      rmSync(scratch, { recursive: true, force: true });
    }
    const leftovers = readdirSync(original ?? os.tmpdir()).filter(
      (name) => !systemBefore.has(name) && name.startsWith('tmp-'),
    );
    expect(leftovers).toEqual([]);
  });

  it('14 — coupling stays inside the file’s in-reach branches (F-3)', async () => {
    const alexFile = await workbook([alexOpen({ machineCode: 99991401 })]);
    await applyImport(importerToken, alexFile, ['entries']);
    expect((await entryOfRow(3))?.machineId).toBeNull();

    // A Tanta-only file at later rows, applied by the Tanta-scoped importer with `create`.
    const tantaFile = await workbook([null, null, tantaOpen({ machineCode: 99991402 })]);
    const { dto, text } = await preview(tantaImporterToken, tantaFile);
    expect(dto.blockers.filter((b) => b !== 'reportMismatch')).toEqual([]);
    expect(text).not.toContain('99991401');
    const applied = await applyImport(tantaImporterToken, tantaFile, ['entries', 'create']);
    expect(applied.dto.applied?.counts).toMatchObject({ imported: 1, created: 1 });
    expect((await entryOfRow(5))?.machineId).not.toBeNull();
    // The Alex entry is untouched and no master was written in Alex.
    expect((await entryOfRow(3))?.machineId).toBeNull();
    expect(
      await AtmMachineModel.countDocuments({ branchId: new Types.ObjectId(alexBranchId) }).exec(),
    ).toBe(0);
    expect(applied.text).not.toContain('99991401');
  });

  it('15 — secretsOutOfReach: Tanta-only viewSecrets cannot import Alex or no-branch key values', async () => {
    const alexKeys = await workbook([
      alexOpen({ machineCode: 99991501, 'keys.supervisorCode': 'FAKE-SUP-1001' }),
    ]);
    const alexPreview = await preview(tantaSecretsToken, alexKeys);
    expect(alexPreview.dto.blockers).toContain('secretsOutOfReach');
    expectNoSecret(alexPreview.text);
    const refused = await upload(tantaSecretsToken, alexKeys, {
      apply: 'entries',
      fileSha256: sha256(alexKeys),
      reportOverride: true,
    });
    expect(refused.status).toBe(422);
    expect(errorDetails(refused).map((d) => d.code)).toContain('secretsOutOfReach');

    const noBranch = await workbook([
      ended({ branchCode: null, machineCode: 99991502, receiptNotes: 'FAKE-NOTE-RECV-1006' }),
    ]);
    expect((await preview(tantaSecretsToken, noBranch)).dto.blockers).toContain(
      'secretsOutOfReach',
    );

    const tantaKeys = await workbook([
      tantaOpen({ machineCode: 99991503, 'keys.supervisorCode': 'FAKE-SUP-1001' }),
    ]);
    expect((await preview(tantaSecretsToken, tantaKeys)).dto.blockers).not.toContain(
      'secretsOutOfReach',
    );
    expect(await AtmRegisterEntryModel.countDocuments({}).exec()).toBe(0);
  });
});

describe('the blockers that guard the register (DEC-31)', () => {
  it('16 — openInRegister: a code already open in the register by a manual receipt', async () => {
    const receipt = await request(app)
      .post('/api/v1/atm/register/entries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        branchId: tantaBranchId,
        machineCode: '99991601',
        bankCode: 'NBE',
        area: 'Tanta Center',
        name: 'Manual receipt',
        startDate: '2026-09-01',
      });
    expect(receipt.status, receipt.text).toBe(201);
    const entryId = data<AtmRegisterWriteResultDto>(receipt).entry.id;
    const file = await workbook([alexOpen({ machineCode: 99991601 })]);
    const { dto } = await preview(importerToken, file);
    expect(dto.blockers).toContain('openInRegister');
    expect(category(dto, 'openInRegister').items).toEqual([
      expect.objectContaining({ importRow: 3, entryId, otherBranchCode: 'EGYCASH-2' }),
    ]);
    const res = await upload(importerToken, file, {
      apply: 'entries',
      fileSha256: sha256(file),
      reportOverride: true,
    });
    expect(res.status).toBe(422);
    expect(errorDetails(res).map((d) => d.code)).toEqual(['openInRegister']);
    expect(await AtmRegisterEntryModel.countDocuments({ source: 'import' }).exec()).toBe(0);
  });

  it('17 — changedSinceImport lists the rows and the column letters, never the values', async () => {
    const file1 = await workbook([
      ended({ machineCode: 99991701 }),
      ended({ machineCode: 99991702, handoverName: 'First name' }),
    ]);
    await applyImport(importerToken, file1, ['entries']);
    const file2 = await workbook([
      ended({ machineCode: 99991701, endDate: excelDate('2025-07-07') }),
      ended({ machineCode: 99991702, handoverName: 'Changed delivered name' }),
    ]);
    const { dto, text } = await preview(importerToken, file2);
    expect(dto.blockers).toContain('changedSinceImport');
    expect(category(dto, 'changedSinceImport').items.map((i) => [i.importRow, i.columns])).toEqual([
      [3, ['AR']],
      [4, ['AT']],
    ]);
    expect(text).not.toContain('Changed delivered name');
    expect(text).not.toContain('2025-07-07');
  });

  it('18 — dateUnreadable: a text end date on an otherwise ended row', async () => {
    const file = await workbook([ended({ machineCode: 99991801, endDate: 'returned in May' })]);
    const { dto } = await preview(importerToken, file);
    expect(dto.blockers).toContain('dateUnreadable');
    expect(dto.issues.rows.find((r) => r.importRow === 3)?.issues).toContainEqual(
      expect.objectContaining({ code: 'dateInvalid', column: 'AR' }),
    );
  });

  it('19 — noName: imported blank names stay null; the open one cannot couple and stays unlinked', async () => {
    const file = await workbook([
      ended({ machineCode: 99991901, name: null }),
      alexOpen({ machineCode: 99991902, name: null }),
    ]);
    const { dto } = await applyImport(importerToken, file, ['entries', 'create']);
    expect(dto.applied?.counts).toMatchObject({ imported: 2, cannotCouple: 1, created: 0 });
    for (const row of [3, 4]) {
      const entry = await entryOfRow(row);
      expect(entry?.name).toBeNull();
      expect(entry?.importIssues.map((i) => i.code)).toContain('noName');
    }
    expect(await runRows(dto.applied?.runId ?? '')).toContainEqual({
      importRow: 4,
      outcome: 'cannotCouple:noName',
    });
    const res = await request(app)
      .get(`/api/v1/atm/register/entries/${String((await entryOfRow(4))?._id)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(data<AtmRegisterEntryDto>(res).masterState).toBe('unlinked');
    expect(category(dto, 'cannotCouple').items.map((i) => [i.importRow, i.reason])).toEqual([
      [4, 'noName'],
    ]);
  });

  it('20 — activeElsewhere: a master active in Tanta, the code open in Alex', async () => {
    await addMachine(tantaBranchId, {
      machineCode: '99992001',
      name: 'Tanta ATM',
      bankName: 'NBE',
      area: 'Tanta Center',
    });
    const file = await workbook([alexOpen({ machineCode: 99992001 })]);
    const { dto } = await preview(importerToken, file);
    const elsewhere = category(dto, 'activeElsewhere');
    expect(elsewhere.pairs).toEqual([
      expect.objectContaining({ fromBranchCode: 'EGYCASH-2', toBranchCode: 'EGYCASH-4', count: 1 }),
    ]);
    const applied = await applyImport(importerToken, file, [
      'entries',
      'link',
      'reactivate',
      'create',
    ]);
    expect(await runRows(applied.dto.applied?.runId ?? '')).toContainEqual({
      importRow: 3,
      outcome: 'cannotCouple:activeElsewhere',
    });
    expect((await entryOfRow(3))?.machineId).toBeNull();
    expect(await masterOf(alexBranchId, '99992001')).toBeNull();
  });
});
