// The bank catalog (DEC-35) over real HTTP, real RBAC and a real replica set — design
// atm-catalog WP-2.
//
// What is worth proving end to end is what the owner decided and what the review found:
//   · a bank added at runtime is a FULL bank, so adding one is a fact about the company — the keys
//     must be held at ORGANIZATION scope, a branch-scoped holder is refused;
//   · the boot seed inserts the workbook's six once and never overwrites a curated edit, carries a
//     label the retired setting held, and does not fail the boot when that setting gave two banks
//     one label (its schema allowed it; the catalog's unique label index does not);
//   · one text can never mean two banks: a code, a label (current, former, or a branch spelling
//     mapped to a bank) or a name already taken is a 409;
//   · a label change keeps the old text resolving, because machines keep the text they were given;
//   · reading takes ANY ATM key, and no key outside ATM;
//   · the spellings written before spellings carried a bank get one at boot, once.
//
// Every bank code, label and name below is synthetic except the workbook's six seeds.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ATM_DEFAULT_BANK_LABELS_SETTING,
  AtmSettingKeys,
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type AtmBankDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { seedAtm } from '../../src/modules/atm/atm.seed';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AtmBankModel, type AtmBankDoc } from '../../src/modules/atm/catalogs/bank.model';
import { AtmRefLabelModel } from '../../src/modules/atm/catalogs/ref-label.model';
import {
  loadAtmBankCatalog,
  resolveBankOfLabel,
} from '../../src/modules/atm/catalogs/bank-catalog';
import {
  backfillBankLabelCodes,
  seedAtmBankCatalog,
} from '../../src/modules/atm/catalogs/catalog.migration';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let settingsCtx: AuthContext;
let bankOrgToken: string; // atmBank.create + .edit at ORGANIZATION scope
let bankBranchToken: string; // the same keys at BRANCH scope, placed in Alexandria
let maintenanceToken: string; // one unrelated ATM key, branch scope
let outsiderToken: string; // no ATM key at all
let alexBranchId: string;
let tantaBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-banks-test-${Date.now()}`;
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

const call = (
  method: 'get' | 'post' | 'patch',
  path: string,
  token: string,
  body?: Record<string, unknown>,
): request.Test => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

const listBanks = async (token = bankOrgToken): Promise<AtmBankDto[]> => {
  const res = await call('get', '/atm/banks', token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmBankDto[]>(res);
};

const bankOf = async (code: string): Promise<AtmBankDto> => {
  const bank = (await listBanks()).find((row) => row.code === code);
  if (bank === undefined) throw new Error(`no bank ${code}`);
  return bank;
};

const storedBank = async (code: string): Promise<AtmBankDoc | null> =>
  AtmBankModel.findOne({ code }).lean<AtmBankDoc>().exec();

const setBankLabelsSetting = async (value: unknown): Promise<void> => {
  await settingsService.set(settingsCtx, {
    key: AtmSettingKeys.RegisterBankLabels,
    scope: 'organization',
    value,
  });
};

/** A first boot for the given seeds: their rows removed, then the seed run again. */
const reseed = async (codes: string[]): Promise<Awaited<ReturnType<typeof seedAtmBankCatalog>>> => {
  await AtmBankModel.collection.deleteMany({ code: { $in: codes } });
  return seedAtmBankCatalog();
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  adminId = await mkUser('banks-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  settingsCtx = {
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
  await settingsService.set(settingsCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('banks-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
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

  const role = async (en: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId))._id);
  const curator = await role('Bank curator', ['atmBank.create', 'atmBank.edit']);
  const maintenance = await role('Maintenance reader', ['atmMaintenance.view']);
  const outsider = await role('User reader', ['user.view']);

  const orgId = await mkUser('banks-org@ecms.local');
  await rbacService.ensureAssignment(orgId, curator, 'organization');
  bankOrgToken = await login('banks-org@ecms.local');

  const branchId = await mkUser('banks-branch@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(branchId, curator, 'branch');
  bankBranchToken = await login('banks-branch@ecms.local');

  const maintenanceId = await mkUser('banks-maint@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(maintenanceId, maintenance, 'branch');
  maintenanceToken = await login('banks-maint@ecms.local');

  const outsiderId = await mkUser('banks-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, outsider, 'organization');
  outsiderToken = await login('banks-outsider@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the boot seed (DEC-35)', () => {
  it('the boot seeded the workbook’s six, with their sheet facts', async () => {
    expect(await AtmBankModel.countDocuments({}).exec()).toBe(6);
    const banks = await listBanks();
    expect(banks.map((b) => [b.code, b.opsLabel, b.sortOrder, b.isSeed, b.isActive])).toEqual([
      ['NBE', 'NBE', 10, true, true],
      ['BM', 'MISR', 20, true, true],
      ['CIB', 'CIB', 30, true, true],
      ['HDB', 'HDB', 40, true, true],
      ['BRK', 'BRK', 50, true, true],
      ['NXT', 'NXT', 60, true, true],
    ]);
    expect(banks.find((b) => b.code === 'BM')).toMatchObject({
      name: { ar: 'بنك مصر', en: 'Banque Misr' },
      color: '#AC2100',
      formerOpsLabels: [],
      hasIdFormat: true,
      version: 0,
    });
  });

  it('a second boot writes nothing, and a curated edit survives it', async () => {
    const nxt = await bankOf('NXT');
    const res = await call('patch', '/atm/banks/NXT', bankOrgToken, {
      name: { ar: 'بنك إن إكس تي', en: 'NXT Bank' },
      color: '#000088',
      version: nxt.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await seedAtmBankCatalog()).inserted).toBe(0);
    await seedAtm(); // the whole boot step, indexes and backfills included
    expect(await AtmBankModel.countDocuments({}).exec()).toBe(6);
    expect(await bankOf('NXT')).toMatchObject({
      name: { ar: 'بنك إن إكس تي', en: 'NXT Bank' },
      color: '#000088',
      version: nxt.version + 1,
    });
  });

  it('a label the retired setting held is seeded, and the D5 default kept as a former label', async () => {
    await setBankLabelsSetting([{ bankCode: 'BM', label: 'BANQUE MISR' }]);
    expect((await reseed(['BM'])).inserted).toBe(1);
    expect(await storedBank('BM')).toMatchObject({
      opsLabel: 'BANQUE MISR',
      formerOpsLabels: ['MISR'],
      opsLabelKeys: ['BANQUE MISR', 'MISR'],
      isSeed: true,
      __v: 0,
    });
    // Machines carrying the legacy MISR still resolve to Banque Misr.
    expect((await loadAtmBankCatalog()).bankOfLabel('MISR')?.code).toBe('BM');

    await setBankLabelsSetting(ATM_DEFAULT_BANK_LABELS_SETTING);
    await reseed(['BM']);
    expect((await storedBank('BM'))?.opsLabel).toBe('MISR');
  });

  it('a setting that gave two banks one label does not fail the boot — both get their defaults', async () => {
    await setBankLabelsSetting([
      { bankCode: 'CIB', label: 'SHARED' },
      { bankCode: 'HDB', label: 'shared' },
    ]);
    const result = await reseed(['CIB', 'HDB']);
    expect(result.inserted).toBe(2);
    expect([...result.reverted].sort()).toEqual(['CIB', 'HDB']);
    expect((await storedBank('CIB'))?.opsLabel).toBe('CIB');
    expect((await storedBank('HDB'))?.opsLabel).toBe('HDB');
    await setBankLabelsSetting(ATM_DEFAULT_BANK_LABELS_SETTING);
  });

  it('an E11000 at insert (a label a curated bank holds) is logged and skipped, never thrown', async () => {
    await AtmBankModel.collection.deleteOne({ code: 'BRK' });
    await AtmBankModel.collection.insertOne({
      code: 'TMPBRK',
      name: { ar: 'مؤقت', en: 'Temporary' },
      opsLabel: 'BRK',
      formerOpsLabels: [],
      opsLabelKeys: ['BRK'],
      color: '#7030A0',
      sortOrder: 999,
      isActive: true,
      isSeed: false,
      isDeleted: false,
    });
    const result = await seedAtmBankCatalog();
    expect(result.skipped).toEqual(['BRK']);
    expect(await storedBank('BRK')).toBeNull();

    await AtmBankModel.collection.deleteOne({ code: 'TMPBRK' });
    expect((await seedAtmBankCatalog()).inserted).toBe(1);
    expect(await AtmBankModel.countDocuments({}).exec()).toBe(6);
  });
});

describe('adding and curating banks (DEC-35)', () => {
  const qnb = {
    code: 'qnb',
    name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
  };

  it('a branch-scoped holder cannot add a company-wide bank (403); organization scope can (201)', async () => {
    const refused = await call('post', '/atm/banks', bankBranchToken, qnb);
    expect(refused.status).toBe(403);
    expect(await storedBank('QNB')).toBeNull();

    const res = await call('post', '/atm/banks', bankOrgToken, qnb);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const bank = data<AtmBankDto>(res);
    // The code is upper-cased, the label defaults to the code, the colour to the first extra no
    // bank wears, the order to the last + 10.
    expect(bank).toMatchObject({
      code: 'QNB',
      name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
      opsLabel: 'QNB',
      formerOpsLabels: [],
      color: '#7030A0',
      sortOrder: 70,
      isActive: true,
      isSeed: false,
      hasIdFormat: false,
      version: 0,
    });
    const audits = await AuditLogModel.find({
      'entityRef.moduleId': 'atm',
      'entityRef.entityType': 'bank',
      'entityRef.entityId': bank.id,
      action: 'create',
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(1);
  });

  it('a branch-scoped holder cannot edit a bank either (403)', async () => {
    const bank = await bankOf('QNB');
    const res = await call('patch', '/atm/banks/QNB', bankBranchToken, {
      color: '#00B0F0',
      version: bank.version,
    });
    expect(res.status).toBe(403);
  });

  it('a taken code is 409 ATM_BANK_CODE_TAKEN', async () => {
    for (const code of ['QNB', 'nbe']) {
      const res = await call('post', '/atm/banks', bankOrgToken, {
        code,
        name: { ar: `اسم ${code}`, en: `Name ${code}` },
        opsLabel: `FREE ${code}`,
      });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe(ErrorCodes.ATM_BANK_CODE_TAKEN);
    }
  });

  it('a label another bank holds — any case — is 409 ATM_BANK_LABEL_TAKEN', async () => {
    const res = await call('post', '/atm/banks', bankOrgToken, {
      code: 'MSR',
      name: { ar: 'مصر الجديد', en: 'Misr New' },
      opsLabel: ' misr ',
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe(ErrorCodes.ATM_BANK_LABEL_TAKEN);
  });

  it('a label change keeps the old text resolving, and the old text stays taken', async () => {
    const before = await bankOf('QNB');
    const res = await call('patch', '/atm/banks/QNB', bankOrgToken, {
      opsLabel: 'QNB ALAHLI',
      version: before.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmBankDto>(res)).toMatchObject({
      opsLabel: 'QNB ALAHLI',
      formerOpsLabels: ['QNB'],
      version: before.version + 1,
    });
    const catalog = await loadAtmBankCatalog();
    expect((await resolveBankOfLabel(alexBranchId, 'QNB', catalog))?.code).toBe('QNB');
    expect((await resolveBankOfLabel(alexBranchId, 'qnb alahli', catalog))?.code).toBe('QNB');

    const taken = await call('post', '/atm/banks', bankOrgToken, {
      code: 'QNBB',
      name: { ar: 'قطر ب', en: 'Qatar B' },
      opsLabel: 'qnb',
    });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe(ErrorCodes.ATM_BANK_LABEL_TAKEN);
  });

  it('a label a branch spelling MAPPED to a bank holds is taken; an unmapped spelling’s is not', async () => {
    await AtmRefLabelModel.create([
      {
        branchId: new Types.ObjectId(alexBranchId),
        kind: 'bank',
        name: 'NBE FOREX',
        bankCode: 'NBE',
      },
      {
        branchId: new Types.ObjectId(alexBranchId),
        kind: 'bank',
        name: 'LOOSE TEXT',
        bankCode: null,
      },
    ]);
    const taken = await call('post', '/atm/banks', bankOrgToken, {
      code: 'NBEFX',
      name: { ar: 'فوركس', en: 'Forex' },
      opsLabel: 'nbe forex',
    });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe(ErrorCodes.ATM_BANK_LABEL_TAKEN);

    // An unmapped spelling meant no bank; a bank taking its text gives those machines one.
    const free = await call('post', '/atm/banks', bankOrgToken, {
      code: 'LOOSE',
      name: { ar: 'بنك سائب', en: 'Loose Bank' },
      opsLabel: 'LOOSE TEXT',
    });
    expect(free.status, JSON.stringify(free.body)).toBe(201);
    expect(data<AtmBankDto>(free).color).toBe('#00B0F0');
  });

  it('a taken Arabic or English name — case ignored — is 409 ATM_BANK_NAME_TAKEN', async () => {
    for (const name of [
      { ar: 'بنك جديد', en: ' national bank of egypt ' },
      { ar: 'بنك مصر', en: 'Another Bank' },
    ]) {
      const res = await call('post', '/atm/banks', bankOrgToken, {
        code: 'AAIB',
        name,
        opsLabel: 'AAIB',
      });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe(ErrorCodes.ATM_BANK_NAME_TAKEN);
    }
    const bank = await bankOf('QNB');
    const rename = await call('patch', '/atm/banks/QNB', bankOrgToken, {
      name: { ar: 'بنك مصر', en: 'QNB Al Ahli' },
      version: bank.version,
    });
    expect(rename.status).toBe(409);
    expect(errorCode(rename)).toBe(ErrorCodes.ATM_BANK_NAME_TAKEN);
  });

  it('refuses a malformed body (400) and a stale version (409)', async () => {
    const bad = await call('post', '/atm/banks', bankOrgToken, {
      code: 'Q',
      name: { ar: 'قصير', en: '' },
    });
    expect(bad.status).toBe(400);
    const bank = await bankOf('QNB');
    const stale = await call('patch', '/atm/banks/QNB', bankOrgToken, {
      color: '#00B050',
      version: bank.version - 1,
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe(ErrorCodes.STALE_DOCUMENT);
    const missing = await call('patch', '/atm/banks/ZZZ', bankOrgToken, {
      color: '#00B050',
      version: 0,
    });
    expect(missing.status).toBe(404);
  });

  it('archives and brings back — nothing is deleted, the bank is still listed and named', async () => {
    const bank = await bankOf('QNB');
    const archived = await call('patch', '/atm/banks/QNB', bankOrgToken, {
      isActive: false,
      version: bank.version,
    });
    expect(archived.status).toBe(200);
    expect(await bankOf('QNB')).toMatchObject({ isActive: false, name: bank.name });
    const audits = await AuditLogModel.find({
      'entityRef.entityType': 'bank',
      'entityRef.entityId': bank.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(audits.length).toBeGreaterThan(0);

    const back = await call('patch', '/atm/banks/QNB', bankOrgToken, {
      isActive: true,
      version: bank.version + 1,
    });
    expect(back.status).toBe(200);
    expect((await bankOf('QNB')).isActive).toBe(true);
  });
});

describe('reading the catalog', () => {
  it('ANY ATM key reads it (200); a key outside ATM does not (403)', async () => {
    const banks = await listBanks(maintenanceToken);
    expect(banks.map((b) => b.code)).toEqual([
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
      'QNB',
      'LOOSE',
    ]);
    const res = await call('get', '/atm/banks', outsiderToken);
    expect(res.status).toBe(403);
  });
});

describe('the spellings’ bank backfill (DEC-35)', () => {
  it('maps NBE FOREX → NBE, the alias → NXT, a catalog key → its bank, anything else → null — once', async () => {
    const tanta = new Types.ObjectId(tantaBranchId);
    const now = new Date();
    const raw = (name: string, extra: Record<string, unknown> = {}) => ({
      branchId: tanta,
      kind: 'bank',
      name,
      isActive: true,
      isDeleted: false,
      __v: 0,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    // As `npm run atm:import` writes them: the raw driver, no `bankCode` field at all.
    await AtmRefLabelModel.collection.insertMany([
      raw('NBE FOREX'),
      raw('نيكست'),
      raw('MISR '),
      raw('QNB'), // QNB's former label: still QNB's
      raw('SOMETHING ELSE'),
      raw('ALREADY', { bankCode: 'CIB' }),
    ]);
    const first = await backfillBankLabelCodes();
    expect(first).toEqual({ mapped: 4, unmapped: 1 });
    const codes = Object.fromEntries(
      (
        await AtmRefLabelModel.find({ branchId: tanta, kind: 'bank' })
          .lean<{ name: string; bankCode: string | null }[]>()
          .exec()
      ).map((row) => [row.name, row.bankCode]),
    );
    expect(codes).toEqual({
      'NBE FOREX': 'NBE',
      نيكست: 'NXT',
      'MISR ': 'BM',
      QNB: 'QNB',
      'SOMETHING ELSE': null,
      ALREADY: 'CIB',
    });
    expect(await backfillBankLabelCodes()).toEqual({ mapped: 0, unmapped: 0 });
  });
});
