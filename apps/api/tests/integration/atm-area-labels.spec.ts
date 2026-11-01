// The areas the register and the machines carry reach data-edit's lists (DEC-38), and the labels API
// around them (DEC-35, DEC-39) — over real HTTP, real RBAC and a real replica set.
//
// The owner, on data-edit's area and bank lists: «مش مسمعه» — what Efficiency typed into the
// register, and the workbook's raw areas, never showed there. What this proves:
//   · the boot backfill: one label per EXACT trimmed value per branch (MOHNDESSEN ≠ Mohndessen ≠
//     المهندسين, EG-6 as amended), its display name by script; idempotent; `#` values, ended entries
//     and archived machines skipped; and a name Operations deleted, archived or renamed is NEVER
//     brought back — by the backfill or by a later save;
//   · a register save writes its area's label after commit, once even when two saves race;
//   · the labels API: a dialog area stores its ENGLISH name (the owner: «الإنجليزي تمام»), a rename
//     keeps the old name in `formerNames` across a reboot, Efficiency add areas with the register
//     keys (never a bank spelling), a spelling needs an ACTIVE catalog bank and may not be a text a
//     catalog bank already answers to, and `GET /options` answers one branch, whole, to the page's
//     audience only.
//
// Every machine code and area below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  AtmSettingKeys,
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type AtmBankDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { seedAtm } from '../../src/modules/atm/atm.seed';
import {
  backfillAtmAreaLabels,
  ensureAreaLabels,
} from '../../src/modules/atm/catalogs/area-labels';
import {
  AtmRefLabelModel,
  type AtmRefLabelDoc,
} from '../../src/modules/atm/catalogs/ref-label.model';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import {
  AtmRegisterEntryModel,
  type AtmRegisterEntryDoc,
} from '../../src/modules/atm/register/register.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // super-admin, organization scope, placed nowhere
let effAlexToken: string; // atmRegister.view + create, BRANCH scope, placed in Alex — no label key
let labelOnlyToken: string; // atmRefLabel.create alone, BRANCH scope, Alex — no atmMachine.view
let registerViewToken: string; // atmRegister.view alone, BRANCH scope, Alex
let alexBranchId: string;
let tantaBranchId: string;
let unmappedBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-area-labels-test-${Date.now()}`;
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
  (res.body as { error: { code: string } }).error.code;
const details = (res: request.Response): { field: string; code: string }[] =>
  (res.body as { error: { details?: { field: string; code: string }[] } }).error.details ?? [];

const call = (
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  activeBranch?: string,
): request.Test => {
  let req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body);
};

/** Every area label of a branch, in ANY state (deleted and archived included). */
const areaLabels = async (branchId: string): Promise<AtmRefLabelDoc[]> =>
  AtmRefLabelModel.find({ branchId: new Types.ObjectId(branchId), kind: 'area' })
    .lean<AtmRefLabelDoc[]>()
    .exec();

const liveAreaNames = async (branchId: string): Promise<string[]> =>
  (await areaLabels(branchId))
    .filter((label) => !label.isDeleted)
    .map((label) => label.name)
    .sort();

const labelNamed = async (branchId: string, name: string): Promise<AtmRefLabelDoc> => {
  const found = (await areaLabels(branchId)).find((label) => label.name === name);
  if (found === undefined) throw new Error(`no area label ${name}`);
  return found;
};

const options = async (branchId?: string, token = adminToken): Promise<request.Response> =>
  call(
    'get',
    `/atm/ref-labels/options${branchId === undefined ? '' : `?branchId=${branchId}`}`,
    token,
  );

const insertMachine = async (
  branchId: string,
  machineCode: string,
  area: string,
  over: Record<string, unknown> = {},
): Promise<void> => {
  await AtmMachineModel.create([
    {
      branchId: new Types.ObjectId(branchId),
      bankName: 'NBE',
      machineCode,
      name: `ATM ${machineCode}`,
      zone: '',
      area,
      isActive: true,
      ...over,
    },
  ]);
};

const insertEntry = async (
  branchId: string,
  machineCode: string,
  over: Partial<AtmRegisterEntryDoc>,
): Promise<void> => {
  await AtmRegisterEntryModel.create([
    {
      branchId: new Types.ObjectId(branchId),
      bankCode: 'NBE',
      machineCode,
      name: `Entry ${machineCode}`,
      status: 'open',
      startDate: new Date('2025-06-01T00:00:00.000Z'),
      source: 'import',
      ...over,
    },
  ]);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('area-labels-admin@ecms.local');
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
  adminToken = await login('area-labels-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await post('/platform/branches', {
    code: '60',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
  });
  tantaBranchId = await post('/platform/branches', {
    code: '61',
    name: { ar: 'طنطا', en: 'Tanta' },
  });
  unmappedBranchId = await post('/platform/branches', {
    code: '62',
    name: { ar: 'أسوان', en: 'Aswan' },
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
  const efficiency = await role('Efficiency receipts', ['atmRegister.view', 'atmRegister.create']);
  const effAlexId = await mkUser('area-labels-eff@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(effAlexId, efficiency, 'branch');
  effAlexToken = await login('area-labels-eff@ecms.local');

  const labelOnly = await role('Label adder only', ['atmRefLabel.create']);
  const labelOnlyId = await mkUser('area-labels-label@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(labelOnlyId, labelOnly, 'branch');
  labelOnlyToken = await login('area-labels-label@ecms.local');

  const registerView = await role('Register reader', ['atmRegister.view']);
  const registerViewId = await mkUser('area-labels-reader@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(registerViewId, registerView, 'branch');
  registerViewToken = await login('area-labels-reader@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the boot backfill (DEC-38)', () => {
  it('one label per EXACT trimmed value per branch, named by script; ended and archived skipped', async () => {
    await insertMachine(alexBranchId, '66660001', 'MOHNDESSEN');
    await insertMachine(alexBranchId, '66660002', 'Mohndessen');
    await insertMachine(alexBranchId, '66660003', 'المهندسين');
    await insertMachine(alexBranchId, '66660004', '  Smouha  ');
    await insertMachine(alexBranchId, '66660005', 'Smouha');
    await insertMachine(alexBranchId, '66660006', '#N/A');
    await insertMachine(alexBranchId, '66660007', 'Only Archived', { isActive: false });
    await insertMachine(tantaBranchId, '66660008', 'Smouha');
    await insertEntry(alexBranchId, '66660009', { area: 'Open Area' });
    await insertEntry(alexBranchId, '66660010', {
      area: 'Pending Area',
      status: 'pending',
      startDate: null,
    });
    await insertEntry(alexBranchId, '66660011', {
      area: 'Ended Area',
      status: 'ended',
      endDate: new Date('2025-07-01T00:00:00.000Z'),
    });
    await insertEntry(alexBranchId, '66660012', { area: '#REF!' });

    const first = await backfillAtmAreaLabels();
    expect(first.inserted).toBe(7);
    expect(await liveAreaNames(alexBranchId)).toEqual(
      ['MOHNDESSEN', 'Mohndessen', 'Open Area', 'Pending Area', 'Smouha', 'المهندسين'].sort(),
    );
    expect(await liveAreaNames(tantaBranchId)).toEqual(['Smouha']);
    expect(await labelNamed(alexBranchId, 'المهندسين')).toMatchObject({
      nameAr: 'المهندسين',
      nameEn: null,
      formerNames: [],
      bankCode: null,
      origin: 'backfill',
      isActive: true,
      isDeleted: false,
      __v: 0,
    });
    expect(await labelNamed(alexBranchId, 'MOHNDESSEN')).toMatchObject({
      nameAr: null,
      nameEn: 'MOHNDESSEN',
    });

    // Served like any label (the raw insert wrote every base field).
    const listed = await call(
      'get',
      `/atm/ref-labels/area?pageSize=100&branchId=${tantaBranchId}`,
      adminToken,
    );
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(data<AtmRefLabelDto[]>(listed).map((label) => [label.name, label.origin])).toEqual([
      ['Smouha', 'backfill'],
    ]);
  });

  it('is idempotent: a second boot writes nothing', async () => {
    const before = (await areaLabels(alexBranchId)).length;
    expect((await backfillAtmAreaLabels()).inserted).toBe(0);
    await seedAtm();
    expect((await areaLabels(alexBranchId)).length).toBe(before);
  });

  it('a deleted, archived or renamed name is NEVER brought back — by a boot or by a save', async () => {
    const deleted = await labelNamed(alexBranchId, 'Mohndessen');
    expect(
      (await call('delete', `/atm/ref-labels/area/${String(deleted._id)}`, adminToken)).status,
    ).toBe(204);
    const archived = await labelNamed(alexBranchId, 'MOHNDESSEN');
    expect(
      (
        await call('patch', `/atm/ref-labels/area/${String(archived._id)}`, adminToken, {
          isActive: false,
          version: archived.__v,
        })
      ).status,
    ).toBe(200);
    const renamed = await labelNamed(alexBranchId, 'المهندسين');
    const res = await call('patch', `/atm/ref-labels/area/${String(renamed._id)}`, adminToken, {
      name: 'Mohandessin',
      version: renamed.__v,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmRefLabelDto>(res)).toMatchObject({
      name: 'Mohandessin',
      formerNames: ['المهندسين'],
    });

    // A boot, and a save of every one of those names, insert nothing.
    expect((await backfillAtmAreaLabels()).inserted).toBe(0);
    await ensureAreaLabels(
      ['Mohndessen', 'MOHNDESSEN', 'المهندسين'].map((area) => ({ branchId: alexBranchId, area })),
      { actorId: null, origin: 'machine' },
    );
    const machine = await AtmMachineModel.findOne({ machineCode: '66660005' }).lean().exec();
    const moved = await call('patch', `/atm/machines/${String(machine?._id)}/area`, adminToken, {
      area: 'Mohndessen',
      version: machine?.__v ?? 0,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const names = (await areaLabels(alexBranchId)).map((label) => label.name);
    expect(names.filter((name) => name === 'Mohndessen')).toHaveLength(1);
    expect(names.filter((name) => name === 'MOHNDESSEN')).toHaveLength(1);
    expect(names).not.toContain('المهندسين');
    expect(await liveAreaNames(alexBranchId)).not.toContain('Mohndessen');
    expect((await labelNamed(alexBranchId, 'MOHNDESSEN')).isActive).toBe(false);

    // The rename survives a reboot: still renamed, the old name still remembered, not re-created.
    await seedAtm();
    expect(await labelNamed(alexBranchId, 'Mohandessin')).toMatchObject({
      formerNames: ['المهندسين'],
    });
    expect((await areaLabels(alexBranchId)).map((label) => label.name)).not.toContain('المهندسين');
  });
});

describe('an area renamed BEFORE this release (review finding: the first boot revived it)', () => {
  it('the old name is recovered from the audit trail, so neither boot brings it back', async () => {
    // The pre-release shape: the old PATCH set `name` alone — no `formerNames` field at all — and
    // audited `{ name, isActive }`; the branch's machine still carries the old text.
    const now = new Date();
    const inserted = await AtmRefLabelModel.collection.insertOne({
      branchId: new Types.ObjectId(alexBranchId),
      kind: 'area',
      name: 'ZIZINIA',
      isActive: true,
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      __v: 1,
      createdAt: now,
      updatedAt: now,
    });
    const labelId = String(inserted.insertedId);
    await AuditLogModel.create({
      entityRef: { moduleId: 'atm', entityType: 'refLabel', entityId: labelId },
      action: 'update',
      changes: [{ field: 'name', old: 'Zizinia', new: 'ZIZINIA' }],
      actor: { userId: null, ip: null, userAgent: null },
      at: now,
    });
    // A legacy row nobody ever renamed: no trail, so it remembers nothing.
    const untouched = await AtmRefLabelModel.collection.insertOne({
      branchId: new Types.ObjectId(alexBranchId),
      kind: 'area',
      name: 'Bolkly',
      isActive: true,
      isDeleted: false,
    });
    await AtmMachineModel.create([
      {
        branchId: new Types.ObjectId(alexBranchId),
        bankName: 'NBE',
        machineCode: '66669901',
        name: 'Pre-release rename',
        zone: '',
        area: 'Zizinia',
        isActive: true,
      },
    ]);

    await seedAtm();
    const renamed = await AtmRefLabelModel.findById(labelId).lean<AtmRefLabelDoc>().exec();
    expect(renamed?.formerNames).toEqual(['Zizinia']);
    expect(
      (await AtmRefLabelModel.findById(untouched.insertedId).lean<AtmRefLabelDoc>().exec())
        ?.formerNames,
    ).toEqual([]);
    expect((await areaLabels(alexBranchId)).map((label) => label.name)).not.toContain('Zizinia');

    // A second boot reads nothing and still brings nothing back.
    await seedAtm();
    expect((await areaLabels(alexBranchId)).map((label) => label.name)).not.toContain('Zizinia');
    expect(
      (await AtmRefLabelModel.findById(labelId).lean<AtmRefLabelDoc>().exec())?.formerNames,
    ).toEqual(['Zizinia']);
  });
});

describe('labels written on save (DEC-38)', () => {
  it('a register receipt with a NEW area: its label exists and the data-edit options offer it', async () => {
    const res = await call('post', '/atm/register/entries', effAlexToken, {
      branchId: alexBranchId,
      bankCode: 'NBE',
      machineCode: '66661001',
      area: 'Brand New Area',
      name: 'Register ATM',
      startDate: '2026-09-01',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const label = await labelNamed(alexBranchId, 'Brand New Area');
    expect(label).toMatchObject({ origin: 'register', nameEn: 'Brand New Area', isActive: true });
    const audits = await AuditLogModel.find({ 'entityRef.entityId': String(label._id) })
      .lean()
      .exec();
    expect(audits.map((row) => row.action)).toEqual(['create']);

    const offered = await options(alexBranchId);
    expect(offered.status, JSON.stringify(offered.body)).toBe(200);
    expect(data<AtmRefLabelOptionsDto>(offered).areas).toContainEqual({
      name: 'Brand New Area',
      nameAr: null,
      nameEn: 'Brand New Area',
    });
  });

  it('two saves of one new area at once end with ONE label', async () => {
    const pending = (code: string): request.Test =>
      call('post', '/atm/register/entries', effAlexToken, {
        branchId: alexBranchId,
        machineCode: code,
        area: 'Racing Area',
        name: `Pending ${code}`,
      });
    const results = await Promise.all([pending('66662001'), pending('66662002')]);
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    await Promise.all(
      [1, 2, 3, 4].map(() =>
        ensureAreaLabels([{ branchId: alexBranchId, area: 'Racing Area' }], {
          actorId: null,
          origin: 'register',
        }),
      ),
    );
    expect((await areaLabels(alexBranchId)).filter((l) => l.name === 'Racing Area')).toHaveLength(
      1,
    );
  });
});

describe('the labels API (DEC-35, DEC-39)', () => {
  it('a dialog area stores its ENGLISH name and shows both; a live duplicate is 409', async () => {
    const res = await call(
      'post',
      '/atm/ref-labels/area',
      adminToken,
      { nameAr: 'كفر عبده', nameEn: 'Kafr Abdo' },
      alexBranchId,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(data<AtmRefLabelDto>(res)).toMatchObject({
      kind: 'area',
      name: 'Kafr Abdo',
      nameAr: 'كفر عبده',
      nameEn: 'Kafr Abdo',
      origin: 'manual',
    });
    const again = await call(
      'post',
      '/atm/ref-labels/area',
      adminToken,
      { nameAr: 'كفر عبده ٢', nameEn: 'Kafr Abdo' },
      alexBranchId,
    );
    expect(again.status).toBe(409);

    // Display names are edited apart from the stored name — no rename, no former name.
    const label = data<AtmRefLabelDto>(res);
    const edited = await call('patch', `/atm/ref-labels/area/${label.id}`, adminToken, {
      nameAr: '',
      nameEn: 'Kafr Abdu',
      version: label.version,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<AtmRefLabelDto>(edited)).toMatchObject({
      name: 'Kafr Abdo',
      nameAr: null,
      nameEn: 'Kafr Abdu',
      formerNames: [],
    });
  });

  it('Efficiency add an AREA with the register keys in a branch they reach — not elsewhere, never a spelling', async () => {
    const inAlex = await call('post', '/atm/ref-labels/area', effAlexToken, {
      nameAr: 'سموحة الجديدة',
      nameEn: 'New Smouha',
      branchId: alexBranchId,
    });
    expect(inAlex.status, JSON.stringify(inAlex.body)).toBe(201);
    expect(data<AtmRefLabelDto>(inAlex)).toMatchObject({
      branchId: alexBranchId,
      name: 'New Smouha',
    });
    const inTanta = await call('post', '/atm/ref-labels/area', effAlexToken, {
      nameAr: 'طنطا الجديدة',
      nameEn: 'New Tanta',
      branchId: tantaBranchId,
    });
    expect(inTanta.status).toBe(403);
    const spelling = await call('post', '/atm/ref-labels/bank', effAlexToken, {
      name: 'NBE FOREX',
      bankCode: 'NBE',
    });
    expect(spelling.status).toBe(403);
    // A register READER holds no add at all.
    const reader = await call('post', '/atm/ref-labels/area', registerViewToken, { name: 'X' });
    expect(reader.status).toBe(403);
  });

  it('a spelling needs an ACTIVE catalog bank, and may not be a text a catalog bank answers to', async () => {
    const unknown = await call(
      'post',
      '/atm/ref-labels/bank',
      adminToken,
      { name: 'ZZZ FOREX', bankCode: 'ZZZ' },
      alexBranchId,
    );
    expect(unknown.status).toBe(400);
    expect(details(unknown)).toContainEqual(
      expect.objectContaining({ field: 'body.bankCode', code: 'UNKNOWN' }),
    );

    const qnb = await call('post', '/atm/banks', adminToken, {
      code: 'QNB',
      name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
    });
    expect(qnb.status, JSON.stringify(qnb.body)).toBe(201);
    const archived = await call('patch', '/atm/banks/QNB', adminToken, {
      isActive: false,
      version: data<AtmBankDto>(qnb).version,
    });
    expect(archived.status).toBe(200);
    const inactive = await call(
      'post',
      '/atm/ref-labels/bank',
      adminToken,
      { name: 'QNB ATM', bankCode: 'QNB' },
      alexBranchId,
    );
    expect(inactive.status).toBe(400);
    expect(details(inactive)).toContainEqual(
      expect.objectContaining({ field: 'body.bankCode', code: 'INACTIVE' }),
    );

    // MISR is BM's label, NBE is NBE's own: neither is a spelling (catalog keys resolve first).
    for (const [name, bankCode] of [
      [' misr ', 'NBE'],
      ['NBE', 'NBE'],
    ] as const) {
      const taken = await call(
        'post',
        '/atm/ref-labels/bank',
        adminToken,
        { name, bankCode },
        alexBranchId,
      );
      expect(taken.status, name).toBe(409);
      expect(errorCode(taken)).toBe(ErrorCodes.ATM_BANK_LABEL_TAKEN);
    }

    const created = await call(
      'post',
      '/atm/ref-labels/bank',
      adminToken,
      { name: 'NBE FOREX', bankCode: 'nbe' },
      alexBranchId,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const spelling = data<AtmRefLabelDto>(created);
    expect(spelling).toMatchObject({ kind: 'bank', name: 'NBE FOREX', bankCode: 'NBE' });

    // Re-mapped to an archived bank → 400; to null → unmapped; to another ACTIVE bank → saved.
    const toArchived = await call('patch', `/atm/ref-labels/bank/${spelling.id}`, adminToken, {
      bankCode: 'QNB',
      version: spelling.version,
    });
    expect(toArchived.status).toBe(400);
    const unmapped = await call('patch', `/atm/ref-labels/bank/${spelling.id}`, adminToken, {
      bankCode: null,
      version: spelling.version,
    });
    expect(unmapped.status, JSON.stringify(unmapped.body)).toBe(200);
    expect(data<AtmRefLabelDto>(unmapped).bankCode).toBeNull();
    const remapped = await call('patch', `/atm/ref-labels/bank/${spelling.id}`, adminToken, {
      bankCode: 'NBE',
      version: data<AtmRefLabelDto>(unmapped).version,
    });
    expect(data<AtmRefLabelDto>(remapped).bankCode).toBe('NBE');
    // A rename onto a catalog label is refused like a create.
    const renamed = await call('patch', `/atm/ref-labels/bank/${spelling.id}`, adminToken, {
      name: 'CIB',
      version: data<AtmRefLabelDto>(remapped).version,
    });
    expect(renamed.status).toBe(409);
    expect(errorCode(renamed)).toBe(ErrorCodes.ATM_BANK_LABEL_TAKEN);
  });
});

describe('GET /atm/ref-labels/options — one branch, whole, to the page’s audience', () => {
  it('answers the acting branch: catalog banks, mapped spellings, areas uncapped, unmapped bank texts', async () => {
    await AtmRefLabelModel.insertMany(
      Array.from({ length: 105 }, (_, i) => ({
        branchId: new Types.ObjectId(alexBranchId),
        kind: 'area',
        name: `Bulk Area ${String(i).padStart(3, '0')}`,
        origin: 'manual',
      })),
    );
    await insertMachine(alexBranchId, '66663001', 'Smouha', { bankName: 'OLD TEXT BANK' });
    await insertMachine(alexBranchId, '66663002', 'Smouha', { bankName: 'NBE FOREX' });
    await insertMachine(alexBranchId, '66663003', 'Smouha', { bankName: 'misr' });

    const res = await options(undefined, labelOnlyToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<AtmRefLabelOptionsDto>(res);
    expect(dto.branchId).toBe(alexBranchId);
    // Named for the top of the add dialogs (2026-10-28): where an add from them is filed.
    expect(dto.branch).toEqual({ id: alexBranchId, name: { ar: 'الإسكندرية', en: 'Alexandria' } });
    expect(dto.registerMapped).toBe(true);
    // The six seeds (QNB is archived), each as its Operations label, then the branch's spelling.
    expect(dto.banks.filter((bank) => bank.kind === 'bank').map((bank) => bank.bankCode)).toEqual([
      'NBE',
      'BM',
      'CIB',
      'HDB',
      'BRK',
      'NXT',
    ]);
    expect(dto.banks).toContainEqual({ value: 'MISR', bankCode: 'BM', kind: 'bank' });
    expect(dto.banks.filter((bank) => bank.kind === 'spelling')).toEqual([
      { value: 'NBE FOREX', bankCode: 'NBE', kind: 'spelling' },
    ]);
    expect(dto.areas.length).toBeGreaterThan(105);
    expect(dto.areas.map((area) => area.name)).not.toContain('MOHNDESSEN'); // archived
    expect(dto.unmappedBankNames).toEqual(['OLD TEXT BANK']);

    const unmapped = await options(unmappedBranchId);
    expect(data<AtmRefLabelOptionsDto>(unmapped)).toMatchObject({
      branchId: unmappedBranchId,
      branch: { id: unmappedBranchId, name: { ar: 'أسوان', en: 'Aswan' } },
      registerMapped: false,
    });
  });

  // «ربط ببنك» edits the row that already holds the text IN THIS BRANCH — an archived spelling or
  // one never linked — wherever the list's page or status filter would hide it, and never another
  // branch's row of the same name (review finding).
  it('names the acting branch’s row that holds each unmapped text, archived ones included', async () => {
    const now = { schemaVersion: 1, origin: 'manual', formerNames: [] };
    await AtmRefLabelModel.insertMany([
      {
        branchId: new Types.ObjectId(alexBranchId),
        kind: 'bank',
        name: 'SYN ARCHIVED',
        bankCode: 'NBE',
        isActive: false,
        ...now,
      },
      {
        branchId: new Types.ObjectId(alexBranchId),
        kind: 'bank',
        name: 'SYN LEGACY',
        bankCode: null,
        isActive: true,
        ...now,
      },
      // Another branch's unlinked row with the text Alexandria's machines carry.
      {
        branchId: new Types.ObjectId(tantaBranchId),
        kind: 'bank',
        name: 'OLD TEXT BANK',
        bankCode: null,
        isActive: true,
        ...now,
      },
    ]);
    await insertMachine(alexBranchId, '66663101', 'Smouha', { bankName: 'SYN ARCHIVED' });
    await insertMachine(alexBranchId, '66663102', 'Smouha', { bankName: 'SYN LEGACY' });

    const dto = data<AtmRefLabelOptionsDto>(await options(undefined, labelOnlyToken));
    const holder = (name: string) =>
      dto.unmappedBankLabels.find((entry) => entry.name === name)?.label;
    expect(dto.unmappedBankLabels.map((entry) => entry.name)).toEqual(dto.unmappedBankNames);
    expect(holder('OLD TEXT BANK')).toBeNull();
    expect(holder('SYN ARCHIVED')).toMatchObject({
      branchId: alexBranchId,
      kind: 'bank',
      bankCode: 'NBE',
      isActive: false,
    });
    expect(holder('SYN LEGACY')).toMatchObject({ branchId: alexBranchId, bankCode: null });

    // Re-activating the archived row (what the dialog's save does) clears it from the callout.
    const archived = holder('SYN ARCHIVED');
    const back = await call('patch', `/atm/ref-labels/bank/${archived?.id ?? ''}`, adminToken, {
      isActive: true,
      version: archived?.version,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(
      data<AtmRefLabelOptionsDto>(await options(undefined, labelOnlyToken)).unmappedBankNames,
    ).not.toContain('SYN ARCHIVED');
  });

  it('refuses a branch the caller’s keys do not reach, and a caller outside the page', async () => {
    expect((await options(tantaBranchId, labelOnlyToken)).status).toBe(403);
    expect((await options(alexBranchId, registerViewToken)).status).toBe(403);
    // The page's labels list still asks `atmMachine.view` — the options are what the dialogs read.
    expect((await call('get', '/atm/ref-labels/area', labelOnlyToken)).status).toBe(403);
  });
});
