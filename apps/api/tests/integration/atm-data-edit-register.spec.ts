// A machine added on /atm/data-edit lands in the register (DEC-36) — over real HTTP, real RBAC and a
// real replica set (the intake is one transaction per machine). Spec
// docs/12-planning/atm-efficiency-register.md, the intake table; scenarios 1–14 of the design.
//
// The owner's call (final): a data-edit add is recorded as an OPEN receipt dated the add day, linked
// to the machine and flagged «بيانات ناقصة» for Efficiency to complete. What this proves:
//   · the entry itself — open, linked, today in Cairo, `source: 'operations'`, flagged, the bank
//     resolved from the Operations text (MISR → BM, a branch's `NBE FOREX` spelling → NBE with the
//     override), audited once — and what it unlocks at once (the Data Report, the settlements' bank,
//     the replenishment form);
//   · every row of the decision table: an unmapped branch, a code active or open in ANOTHER branch
//     (refused, nothing written, the branch named only to who may see it), an archived code here
//     (reactivated), an unlinked or pending entry here (linked / received — never a second entry);
//   · the bulk paste row by row, an unknown and an archived bank, all-or-nothing, the race, and the
//     `manage` reach the add now needs.
//
// Every machine code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  AtmSettingKeys,
  SettingKeys,
  platformPermissions,
  type AtmBankDto,
  type AtmMachineCreateResultDto,
  type AtmRegisterEntryDto,
  type AtmRegisterReportDto,
  type AtmRegisterWriteResultDto,
  type BulkCreateAtmMachinesResultDto,
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
import {
  AtmRegisterEntryModel,
  type AtmRegisterEntryDoc,
} from '../../src/modules/atm/register/register.model';
import { atmRegisterEntryRepository } from '../../src/modules/atm/register/register.repository';
import { machineBanks } from '../../src/modules/atm/settlements/shared/register-bank';
import { cairoDateString } from '../../src/modules/atm/shared/cairo-time';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // super-admin, organization scope, placed nowhere
let manageAlexToken: string; // atmMachine.view + manage, BRANCH scope, placed in Alex
let manageDeptToken: string; // the same bundle, DEPARTMENT scope, placed in a Tanta department
let manageReachToken: string; // view + manage DELEGATED over Alex, placed in Tanta (ADR-032)
let alexBranchId: string;
let tantaBranchId: string;
let unmappedBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-intake-test-${Date.now()}`;
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
  (res.body as { error: { code: string } }).error.code;
const errorMessage = (res: request.Response): string =>
  (res.body as { error: { message: string } }).error.message;

const call = (
  method: 'get' | 'post' | 'patch',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  activeBranch?: string,
): request.Test => {
  let req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body);
};

/** POST /atm/machines as `token`, in the branch the top bar names. */
const add = (
  token: string,
  branchId: string | undefined,
  body: { machineCode: string; name?: string; bankName?: string; area?: string },
): request.Test =>
  call(
    'post',
    '/atm/machines',
    token,
    {
      name: `ATM ${body.machineCode}`,
      bankName: 'NBE',
      area: 'Smouha',
      ...body,
    },
    branchId,
  );

const today = (): string => cairoDateString(new Date());

const entriesOf = async (machineCode: string): Promise<AtmRegisterEntryDoc[]> =>
  AtmRegisterEntryModel.find({ machineCode, isDeleted: false })
    .lean<AtmRegisterEntryDoc[]>()
    .exec();

const mastersOf = async (machineCode: string): Promise<AtmMachineDoc[]> =>
  AtmMachineModel.find({ machineCode, isDeleted: false }).lean<AtmMachineDoc[]>().exec();

const getEntry = async (id: string): Promise<AtmRegisterEntryDto> => {
  const res = await call('get', `/atm/register/entries/${id}`, adminToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmRegisterEntryDto>(res);
};

/** An Operations master with no register entry (the legacy-import state). */
const insertMaster = async (
  branchId: string,
  machineCode: string,
  over: Partial<AtmMachineDoc> = {},
): Promise<string> => {
  const [doc] = await AtmMachineModel.create([
    {
      branchId: new Types.ObjectId(branchId),
      bankName: 'NBE',
      machineCode,
      name: `Legacy ${machineCode}`,
      zone: '',
      area: 'Smouha',
      isActive: true,
      ...over,
    },
  ]);
  return String(doc?._id);
};

/** An open entry written as the IMPORT writes it — unlinked. */
const insertOpenEntry = async (
  branchId: string | null,
  machineCode: string,
  over: Partial<AtmRegisterEntryDoc> = {},
): Promise<AtmRegisterEntryDoc> => {
  const [doc] = await AtmRegisterEntryModel.create([
    {
      branchId: branchId === null ? null : new Types.ObjectId(branchId),
      area: 'Imported Area',
      bankCode: 'NBE',
      machineCode,
      machineId: null,
      name: `Imported ${machineCode}`,
      startDate: new Date('2025-06-01T00:00:00.000Z'),
      status: 'open',
      source: 'import',
      ...over,
    },
  ]);
  return (doc as unknown as { toObject: () => AtmRegisterEntryDoc }).toObject();
};

const report = async (): Promise<AtmRegisterReportDto> => {
  const res = await call('get', '/atm/register/report', adminToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmRegisterReportDto>(res);
};

const auditRows = async (entityId: string) =>
  AuditLogModel.find({ 'entityRef.entityId': entityId }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('intake-admin@ecms.local');
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
  adminToken = await login('intake-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await post('/platform/branches', {
    code: '80',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
  });
  tantaBranchId = await post('/platform/branches', {
    code: '81',
    name: { ar: 'طنطا', en: 'Tanta' },
  });
  unmappedBranchId = await post('/platform/branches', {
    code: '82',
    name: { ar: 'أسوان', en: 'Aswan' },
  });
  const tantaDept = await post('/platform/departments', {
    code: 'IN-T-OPS',
    name: { ar: 'العمليات', en: 'Operations' },
    branchId: tantaBranchId,
  });
  await settingsService.set(ctx, {
    key: AtmSettingKeys.RegisterBranchCodes,
    scope: 'organization',
    value: [
      { code: 'EGYCASH-4', branchId: alexBranchId },
      { code: 'EGYCASH-2', branchId: tantaBranchId },
    ],
  });

  const manage = String(
    (
      await rbacService.createRole(
        {
          name: { en: 'Machine administrator', ar: 'مدير الماكينات' },
          permissionKeys: ['atmMachine.view', 'atmMachine.manage'],
        },
        adminId,
      )
    )._id,
  );
  const manageAlexId = await mkUser('intake-manage-alex@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(manageAlexId, manage, 'branch');
  manageAlexToken = await login('intake-manage-alex@ecms.local');

  const manageDeptId = await mkUser('intake-manage-dept@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
  });
  await rbacService.ensureAssignment(manageDeptId, manage, 'department');
  manageDeptToken = await login('intake-manage-dept@ecms.local');

  const manageReachId = await mkUser('intake-manage-reach@ecms.local', {
    branchId: tantaBranchId,
  });
  const delegated = await request(app)
    .put(`/api/v1/platform/delegations/users/${manageReachId}/grants`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      branchId: alexBranchId,
      departmentId: null,
      permissionKeys: ['atmMachine.view', 'atmMachine.manage'],
    });
  expect(delegated.status, JSON.stringify(delegated.body)).toBe(200);
  manageReachToken = await login('intake-manage-reach@ecms.local');

  // Alexandria's Operations spelling of NBE (DEC-16).
  const spelling = await call(
    'post',
    '/atm/ref-labels/bank',
    adminToken,
    { name: 'NBE FOREX', bankCode: 'NBE' },
    alexBranchId,
  );
  expect(spelling.status, JSON.stringify(spelling.body)).toBe(201);
}, 240_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a data-edit add in a mapped branch (DEC-36 step f)', () => {
  it('1 — an active master plus ONE open, linked, flagged entry dated today; the bank from the text; audited once', async () => {
    const res = await add(manageAlexToken, undefined, {
      machineCode: '077770001',
      name: 'Smouha Mall',
      bankName: 'MISR',
      area: 'Smouha',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const added = data<AtmMachineCreateResultDto>(res);
    expect(added).toMatchObject({
      branchId: alexBranchId,
      machineCode: '77770001',
      bankName: 'MISR',
      isActive: true,
      reactivated: false,
      register: { action: 'created', reason: null, bankCode: 'BM' },
    });
    const entryId = added.register.entryId as string;
    expect(entryId).not.toBeNull();

    const entry = await getEntry(entryId);
    expect(entry).toMatchObject({
      branchId: alexBranchId,
      machineCode: '77770001',
      machineId: added.id,
      masterState: 'active',
      name: 'Smouha Mall',
      area: 'Smouha',
      bankCode: 'BM',
      // MISR IS BM's catalog label, so the entry follows the catalog (D5): no override.
      opsBankLabel: null,
      status: 'open',
      startDate: today(),
      endDate: null,
      source: 'operations',
      dataIncomplete: true,
    });
    expect(await entriesOf('77770001')).toHaveLength(1);

    // Audited once each, after commit: the machine's create, the entry's create.
    const machineAudits = await auditRows(added.id);
    expect(machineAudits.map((row) => row.action)).toEqual(['create']);
    const entryAudits = await auditRows(entryId);
    expect(entryAudits.map((row) => row.action)).toEqual(['create']);
    expect(entryAudits[0]?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'source', new: 'operations' }),
        expect.objectContaining({ field: 'dataIncomplete', new: true }),
      ]),
    );

    // The branch's own spelling → NBE, and the entry keeps the text as its override.
    const forex = await add(manageAlexToken, undefined, {
      machineCode: '77770002',
      bankName: 'NBE FOREX',
    });
    expect(forex.status, JSON.stringify(forex.body)).toBe(201);
    const fx = data<AtmMachineCreateResultDto>(forex);
    expect(fx.register).toMatchObject({ action: 'created', bankCode: 'NBE' });
    expect(await getEntry(fx.register.entryId as string)).toMatchObject({
      bankCode: 'NBE',
      opsBankLabel: 'NBE FOREX',
      effectiveOpsBankLabel: 'NBE FOREX',
    });
  });

  it('2 — the Data Report counts it at once, the settlements read its bank, a replenishment opens on it', async () => {
    const before = await report();
    const res = await add(adminToken, alexBranchId, {
      machineCode: '77770003',
      bankName: 'MISR',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const added = data<AtmMachineCreateResultDto>(res);
    const after = await report();
    expect(after.counts.section1.BM).toBe((before.counts.section1.BM ?? 0) + 1);
    expect(after.counts.section2['EGYCASH-4']).toBe((before.counts.section2['EGYCASH-4'] ?? 0) + 1);

    // Until now a data-edit machine was refused by every settlement page as `noRegisterBank`.
    expect((await machineBanks([added.id])).get(added.id)).toEqual({ bank: 'BM', reason: null });

    const opened = await call(
      'post',
      '/atm/replenishments/open',
      adminToken,
      { rows: [{ machineCode: '77770003', scheduleTime: null }], forceDate: null },
      alexBranchId,
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(data<{ unknownCodes: string[] }>(opened).unknownCodes).toEqual([]);
  });
});

describe('the decision table (DEC-36 steps a–e)', () => {
  it('3 — an unmapped branch gets the machine only (DEC-10): `none / branchUnmapped`', async () => {
    const res = await add(adminToken, unmappedBranchId, { machineCode: '77770301' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(data<AtmMachineCreateResultDto>(res)).toMatchObject({
      branchId: unmappedBranchId,
      isActive: true,
      register: { action: 'none', reason: 'branchUnmapped', entryId: null, bankCode: 'NBE' },
    });
    expect(await entriesOf('77770301')).toHaveLength(0);
  });

  it('4 — a code ACTIVE in another branch is 409, nothing written; the branch named only with reach', async () => {
    await insertMaster(tantaBranchId, '77770401');
    const res = await add(manageAlexToken, undefined, { machineCode: '77770401' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_REGISTER_CODE_ACTIVE_ELSEWHERE');
    // The Alex holder sees no Tanta row on either page: the refusal does not name it.
    expect(errorMessage(res)).not.toContain('EGYCASH-2');
    const org = await add(adminToken, alexBranchId, { machineCode: '77770401' });
    expect(errorCode(org)).toBe('ATM_REGISTER_CODE_ACTIVE_ELSEWHERE');
    expect(errorMessage(org)).toContain('EGYCASH-2');
    expect((await mastersOf('77770401')).map((m) => String(m.branchId))).toEqual([tantaBranchId]);
    expect(await entriesOf('77770401')).toHaveLength(0);
  });

  it('5 — a code OPEN in another branch’s register is 409, and no master is written', async () => {
    await insertOpenEntry(tantaBranchId, '77770501');
    const res = await add(manageAlexToken, undefined, { machineCode: '77770501' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_REGISTER_OPEN_PERIOD_EXISTS');
    expect(errorMessage(res)).not.toContain('EGYCASH-2');
    expect(await mastersOf('77770501')).toHaveLength(0);

    // A branch-less open row counts as "elsewhere" too (D6 is company-wide).
    await insertOpenEntry(null, '77770502');
    const noBranch = await add(adminToken, alexBranchId, { machineCode: '77770502' });
    expect(errorCode(noBranch)).toBe('ATM_REGISTER_OPEN_PERIOD_EXISTS');
    expect(await mastersOf('77770502')).toHaveLength(0);
  });

  it('6 — archived here with an open entry (DEC-24): the SAME master comes back, linked as `existing`', async () => {
    const receipt = await call('post', '/atm/register/entries', adminToken, {
      branchId: alexBranchId,
      bankCode: 'NBE',
      machineCode: '77770601',
      area: 'Gleem',
      name: 'Register name',
      startDate: '2026-09-01',
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    const written = data<AtmRegisterWriteResultDto>(receipt);
    const masterId = written.master.machineId as string;
    const master = await AtmMachineModel.findById(masterId).lean<AtmMachineDoc>().exec();
    const archived = await call('patch', `/atm/machines/${masterId}`, adminToken, {
      isActive: false,
      version: master?.__v,
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);

    const res = await add(adminToken, alexBranchId, {
      machineCode: '77770601',
      name: 'Back at work',
      area: 'Gleem',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(data<AtmMachineCreateResultDto>(res)).toMatchObject({
      id: masterId,
      isActive: true,
      name: 'Back at work',
      reactivated: true,
      register: { action: 'existing', entryId: written.entry.id },
    });
    // The entry's data wins: untouched, not flagged, still the one open period.
    expect(await getEntry(written.entry.id)).toMatchObject({
      name: 'Register name',
      dataIncomplete: false,
      masterState: 'active',
    });
    expect(await entriesOf('77770601')).toHaveLength(1);
  });

  it('7 — an unlinked imported open row here is linked to the new machine, its data untouched', async () => {
    const imported = await insertOpenEntry(alexBranchId, '77770701', { area: 'Miami' });
    const res = await add(adminToken, alexBranchId, { machineCode: '77770701', area: 'Miami' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const added = data<AtmMachineCreateResultDto>(res);
    expect(added.register).toMatchObject({ action: 'linked', entryId: String(imported._id) });
    expect(await getEntry(String(imported._id))).toMatchObject({
      machineId: added.id,
      masterState: 'active',
      name: 'Imported 77770701',
      source: 'import',
      dataIncomplete: false,
    });
    expect(await entriesOf('77770701')).toHaveLength(1);
    expect((await auditRows(String(imported._id))).map((row) => row.action)).toEqual(['update']);
  });

  it('8 — a PENDING entry of the code is RECEIVED — today, linked, flagged — never duplicated', async () => {
    const pending = await call('post', '/atm/register/entries', adminToken, {
      branchId: alexBranchId,
      machineCode: '77770801',
      name: 'Pending name',
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    const pendingId = data<AtmRegisterWriteResultDto>(pending).entry.id;

    const res = await add(adminToken, alexBranchId, {
      machineCode: '77770801',
      name: 'Form name',
      bankName: 'CIB',
      area: 'Sporting',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const added = data<AtmMachineCreateResultDto>(res);
    expect(added.register).toMatchObject({
      action: 'received',
      entryId: pendingId,
      bankCode: 'CIB',
    });
    expect(await getEntry(pendingId)).toMatchObject({
      status: 'open',
      startDate: today(),
      machineId: added.id,
      // Only the blanks are filled from the form; the entry's own name wins.
      name: 'Pending name',
      bankCode: 'CIB',
      area: 'Sporting',
      dataIncomplete: true,
      // `source` is where the ENTRY came from — a manual pending receipt.
      source: 'manual',
    });
    expect(await entriesOf('77770801')).toHaveLength(1);
    expect((await auditRows(pendingId)).map((row) => row.action).sort()).toEqual([
      'create',
      'statusChange',
    ]);
  });

  it('9 — a code ACTIVE here: 409 on the single add, a named skip in the bulk paste', async () => {
    expect((await add(adminToken, alexBranchId, { machineCode: '77770901' })).status).toBe(201);
    const again = await add(adminToken, alexBranchId, { machineCode: '77770901' });
    expect(again.status).toBe(409);
    const bulk = await call(
      'post',
      '/atm/machines/bulk',
      adminToken,
      { bankName: 'NBE', area: 'Smouha', machines: [{ machineCode: '77770901', name: 'Again' }] },
      alexBranchId,
    );
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);
    expect(data<BulkCreateAtmMachinesResultDto>(bulk)).toMatchObject({
      created: [],
      skippedCodes: ['77770901'],
      reactivatedCodes: [],
      refused: [],
    });
    expect(await entriesOf('77770901')).toHaveLength(1);
  });
});

describe('the bulk paste, banks, atomicity and races', () => {
  it('10 — a mixed batch: each row its own unit, each outcome named', async () => {
    await insertMaster(alexBranchId, '77771002', { isActive: false, name: 'Archived' });
    await insertMaster(tantaBranchId, '77771003');
    await insertOpenEntry(tantaBranchId, '77771004');
    await insertMaster(alexBranchId, '77771005');
    const res = await call(
      'post',
      '/atm/machines/bulk',
      adminToken,
      {
        bankName: 'MISR',
        area: 'Laurent',
        machines: [
          { machineCode: '77771001', name: 'New' },
          { machineCode: '77771002', name: 'Back' },
          { machineCode: '77771003', name: 'Active in Tanta' },
          { machineCode: '77771004', name: 'Open in Tanta' },
          { machineCode: '77771005', name: 'Active here' },
        ],
      },
      alexBranchId,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = data<BulkCreateAtmMachinesResultDto>(res);
    expect(result.created.map((m) => m.machineCode)).toEqual(['77771001']);
    expect(result.reactivatedCodes).toEqual(['77771002']);
    expect(result.skippedCodes).toEqual(['77771005']);
    expect(result.refused).toEqual([
      { machineCode: '77771003', reason: 'activeElsewhere' },
      { machineCode: '77771004', reason: 'openElsewhere' },
    ]);
    expect(result.register).toEqual({
      created: ['77771001', '77771002'],
      received: [],
      linked: [],
      existing: [],
      notRecorded: [],
    });
    // The refused rows wrote nothing; the others are committed with their entries.
    expect((await mastersOf('77771003')).map((m) => String(m.branchId))).toEqual([tantaBranchId]);
    expect(await mastersOf('77771004')).toHaveLength(0);
    for (const code of ['77771001', '77771002']) {
      const [entry] = await entriesOf(code);
      expect(entry).toMatchObject({ status: 'open', bankCode: 'BM', dataIncomplete: true });
    }
    expect(await entriesOf('77771005')).toHaveLength(0);
  });

  it('11 — an unknown bank text adds the machine (`noBank`); an ARCHIVED bank is 400', async () => {
    const unknown = await add(adminToken, alexBranchId, {
      machineCode: '77771101',
      bankName: 'SOME OTHER BANK',
    });
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(201);
    expect(data<AtmMachineCreateResultDto>(unknown).register).toEqual({
      action: 'none',
      reason: 'noBank',
      entryId: null,
      bankCode: null,
    });
    expect(await entriesOf('77771101')).toHaveLength(0);

    const created = await call('post', '/atm/banks', adminToken, {
      code: 'QNB',
      name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const archived = await call('patch', '/atm/banks/QNB', adminToken, {
      isActive: false,
      version: data<AtmBankDto>(created).version,
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const refused = await add(adminToken, alexBranchId, {
      machineCode: '77771102',
      bankName: 'QNB',
    });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { details: unknown[] } }).error.details).toContainEqual(
      expect.objectContaining({ field: 'body.bankName', code: 'INACTIVE' }),
    );
    expect(await mastersOf('77771102')).toHaveLength(0);
  });

  it('12 — a failed entry write rolls the master back with it (one unit)', async () => {
    const spy = vi
      .spyOn(atmRegisterEntryRepository, 'create')
      .mockRejectedValueOnce(new Error('forced entry failure'));
    const res = await add(adminToken, alexBranchId, { machineCode: '77771201' });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await mastersOf('77771201')).toHaveLength(0);
    expect(await entriesOf('77771201')).toHaveLength(0);
    // The same add, now unhindered, goes through.
    expect((await add(adminToken, alexBranchId, { machineCode: '77771201' })).status).toBe(201);
  });

  it('13 — two adds of one code in two mapped branches at once: exactly one wins', async () => {
    const [alex, tanta] = await Promise.all([
      add(adminToken, alexBranchId, { machineCode: '77771301' }),
      add(adminToken, tantaBranchId, { machineCode: '77771301' }),
    ]);
    expect([alex.status, tanta.status].sort()).toEqual([201, 409]);
    const loser = alex.status === 409 ? alex : tanta;
    expect(['ATM_REGISTER_OPEN_PERIOD_EXISTS', 'ATM_REGISTER_CODE_ACTIVE_ELSEWHERE']).toContain(
      errorCode(loser),
    );
    expect(await mastersOf('77771301')).toHaveLength(1);
    const open = (await entriesOf('77771301')).filter((entry) => entry.status === 'open');
    expect(open).toHaveLength(1);
  });

  it('14 — `manage` must reach the acting branch; a finer-scoped holder still adds at home', async () => {
    // Delegated over Alexandria, placed in Tanta: acting in Tanta by placement, the key reaches it not.
    const placed = await add(manageReachToken, undefined, { machineCode: '77771401' });
    expect(placed.status, JSON.stringify(placed.body)).toBe(403);
    expect(await mastersOf('77771401')).toHaveLength(0);
    const reached = await add(manageReachToken, alexBranchId, { machineCode: '77771401' });
    expect(reached.status, JSON.stringify(reached.body)).toBe(201);
    expect(data<AtmMachineCreateResultDto>(reached).branchId).toBe(alexBranchId);

    // Department scope reaches no whole branch, but the branch they are placed in is theirs (F1).
    const atHome = await add(manageDeptToken, undefined, { machineCode: '77771402' });
    expect(atHome.status, JSON.stringify(atHome.body)).toBe(201);
    expect(data<AtmMachineCreateResultDto>(atHome)).toMatchObject({
      branchId: tantaBranchId,
      register: { action: 'created' },
    });
    const bulkAway = await call('post', '/atm/machines/bulk', manageReachToken, {
      bankName: 'NBE',
      area: 'Smouha',
      machines: [{ machineCode: '77771403', name: 'X' }],
    });
    expect(bulkAway.status).toBe(403);
  });
});
